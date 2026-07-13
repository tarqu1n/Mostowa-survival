import Phaser from 'phaser';
import { TILE_SIZE, GROUND_CHUNK_ROWS } from '../config';
import { resolveTile, sheetKey, tileImageKey } from '../data/tileset';
import { cellIndex, isInside, type MapFile } from '../systems/mapFormat';
import { useEditorStore } from './store/editorStore';
import { parseAssetId, tilesetAssetUrl } from './textureLoading';

/**
 * The editor's single Phaser scene (plan 014 step 5). Renders the open map pixel-identically to the
 * game via the same `resolveTile` seam: tile layers bake into per-layer chunked `RenderTexture`s
 * with the batch API (mirroring `world/groundRenderer.ts` — per-tile `drawFrame` is pathologically
 * slow), objects draw on top with their stored transform, and overlay `Graphics` draw the void
 * checker, grid and hover cell above everything. Void cells reject the hover cursor.
 *
 * It observes the editor store (the sole React↔Phaser bridge): a `mapEpoch` change = full reload
 * (textures → bake → camera fit); a `docRevision` change = rebake in place; an `overlays` change =
 * overlay redraw. Robustness: a texture that fails to load is logged and skipped (authored maps may
 * reference assets that don't exist yet mid-development), never crashing the scene.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PAN_MARGIN_TILES = 6;

// Render depths. Tile layers occupy 0..layers.length-1; everything else sits above them.
const DEPTH_VOID = 500;
const DEPTH_OBJECTS = 1000;
const DEPTH_GRID = 9000;
const DEPTH_HOVER = 9500;

// Void checker — two near-black shades per cell plus a faint diagonal, reads as "out of bounds".
const VOID_COLOUR_A = 0x0a0807;
const VOID_COLOUR_B = 0x181113;
const VOID_HATCH = 0x2a2320;
const GRID_COLOUR = 0x4a3f38;
const HOVER_COLOUR = 0xf0d890;

// Non-tile object placeholders (real node/portal rendering lands in step 7).
const NODE_MARKER = 0x66bb66;
const PORTAL_MARKER = 0x7aa6ff;

export class EditorScene extends Phaser.Scene {
  private unsubs: Array<() => void> = [];
  private currentEpoch = -1;

  private chunkRTs: Phaser.GameObjects.RenderTexture[][] = []; // [layerIndex][chunkIndex]
  private objectSprites: Phaser.GameObjects.GameObject[] = [];
  private voidGfx?: Phaser.GameObjects.Graphics;
  private gridGfx?: Phaser.GameObjects.Graphics;
  private hoverGfx?: Phaser.GameObjects.Graphics;

  private panning = false;
  private panLast = { x: 0, y: 0 };
  private spaceDown = false;
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleSpaceKey(e, true);
  private readonly onKeyUp = (e: KeyboardEvent): void => this.handleSpaceKey(e, false);

  constructor() {
    super('Editor');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)'); // transparent — the dark pane shows through
    this.voidGfx = this.add.graphics().setDepth(DEPTH_VOID);
    this.gridGfx = this.add.graphics().setDepth(DEPTH_GRID);
    this.hoverGfx = this.add.graphics().setDepth(DEPTH_HOVER);

    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.handleWheel, this);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.handlePointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handlePointerUp, this);
    this.input.mouse?.disableContextMenu(); // right-click reserved for future tools; no browser menu
    // A texture that 404s (an authored map may reference an asset that doesn't exist yet) is logged
    // and skipped — the bake checks `textures.exists` before drawing, so a missing tile just no-ops.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      const url = typeof file.url === 'string' ? file.url : '?'; // Phaser types url as string|object
      console.warn(`[editor] texture failed to load, skipping: ${file.key} (${url})`);
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Observe the store (the sole React↔Phaser bridge). subscribeWithSelector fires only on change,
    // so we do an explicit initial sync below for the already-open map on a remount.
    this.unsubs.push(
      useEditorStore.subscribe(
        (s) => s.mapEpoch,
        () => this.syncDocument(),
      ),
      useEditorStore.subscribe(
        (s) => s.docRevision,
        () => this.onDocEdited(),
      ),
      useEditorStore.subscribe(
        (s) => s.overlays,
        () => this.redrawOverlays(),
      ),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    this.syncDocument();
  }

  private teardown(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  // ---- Document lifecycle ----

  /** Full (re)load: tear down the current render, then queue textures and bake once loaded. */
  private syncDocument(): void {
    const { map, mapEpoch } = useEditorStore.getState();
    this.currentEpoch = mapEpoch;
    this.clearRender();
    if (!map) {
      this.redrawOverlays();
      return;
    }
    this.loadTexturesThenBuild(map, mapEpoch);
  }

  private clearRender(): void {
    for (const layer of this.chunkRTs) for (const rt of layer) rt.destroy();
    this.chunkRTs = [];
    for (const obj of this.objectSprites) obj.destroy();
    this.objectSprites = [];
    this.voidGfx?.clear();
    this.gridGfx?.clear();
    this.hoverGfx?.clear();
  }

  private loadTexturesThenBuild(map: MapFile, epoch: number): void {
    const queued = this.queueTextures(map);
    const build = (): void => {
      if (this.currentEpoch !== epoch) return; // a newer reload superseded this one
      this.buildScene(map);
    };
    if (queued) {
      this.load.once(Phaser.Loader.Events.COMPLETE, build);
      this.load.start();
    } else {
      build();
    }
  }

  /** Queue every palette + decor texture the map needs (deduped by key). Returns whether anything
   *  was queued (nothing → bake synchronously). */
  private queueTextures(map: MapFile): boolean {
    const seen = new Set<string>();
    const addImage = (key: string, url: string): void => {
      if (this.textures.exists(key) || seen.has(key)) return;
      seen.add(key);
      this.load.image(key, url);
    };
    const addSheet = (key: string, url: string): void => {
      if (this.textures.exists(key) || seen.has(key)) return;
      seen.add(key);
      this.load.spritesheet(key, url, { frameWidth: TILE_SIZE, frameHeight: TILE_SIZE });
    };

    for (const entry of map.palette) {
      if (!entry) continue;
      if (entry.source.kind === 'image') {
        addImage(tileImageKey(entry.source.path), tilesetAssetUrl(entry.pack, entry.source.path));
      } else {
        addSheet(sheetKey(entry.source.sheet), tilesetAssetUrl(entry.pack, entry.source.sheet));
      }
    }

    for (const obj of map.objects) {
      if (obj.kind !== 'decor') continue;
      try {
        const { pack, path, frame } = parseAssetId(obj.asset);
        if (frame === undefined) addImage(tileImageKey(path), tilesetAssetUrl(pack, path));
        // Sheet-frame decor: best-effort TILE_SIZE frames here; the catalog (step 6) carries the
        // real frame dimensions and will supersede this.
        else addSheet(sheetKey(path), tilesetAssetUrl(pack, path));
      } catch (e) {
        console.warn(`[editor] skipping decor "${obj.id}": ${(e as Error).message}`);
      }
    }

    return seen.size > 0;
  }

  private buildScene(map: MapFile): void {
    this.bakeAllLayers(map);
    this.placeObjects(map);
    this.redrawOverlays();
    this.fitCamera(map);
  }

  /** Rebake in place after an in-map edit. Step 5 has no such edits yet; when painting lands (step
   *  6) this narrows to the dirty chunks the paint commands report. A full rebake keeps the viewport
   *  correct meanwhile. */
  private onDocEdited(): void {
    const { map } = useEditorStore.getState();
    if (!map) return;
    if (this.chunkRTs.length !== map.layers.length) {
      this.syncDocument(); // layer set changed — safest to rebuild wholesale
      return;
    }
    for (let layerIndex = 0; layerIndex < map.layers.length; layerIndex++) {
      const rts = this.chunkRTs[layerIndex];
      for (let chunk = 0; chunk < rts.length; chunk++) {
        this.bakeChunk(map, layerIndex, chunk, rts[chunk]);
      }
    }
    this.placeObjects(map);
    this.redrawOverlays();
  }

  // ---- Tile baking (chunked batch API, mirroring drawGround) ----

  private bakeAllLayers(map: MapFile): void {
    const cols = map.meta.width;
    const chunkCount = Math.ceil(map.meta.height / GROUND_CHUNK_ROWS);
    this.chunkRTs = map.layers.map((_layer, layerIndex) => {
      const rts: Phaser.GameObjects.RenderTexture[] = [];
      for (let chunk = 0; chunk < chunkCount; chunk++) {
        const startRow = chunk * GROUND_CHUNK_ROWS;
        const chunkRows = Math.min(GROUND_CHUNK_ROWS, map.meta.height - startRow);
        const rt = this.add
          .renderTexture(0, startRow * TILE_SIZE, cols * TILE_SIZE, chunkRows * TILE_SIZE)
          .setOrigin(0, 0)
          .setDepth(layerIndex);
        rts.push(rt);
        this.bakeChunk(map, layerIndex, chunk, rt);
      }
      return rts;
    });
  }

  /** Bake one layer chunk (up to GROUND_CHUNK_ROWS rows) with a single batched draw pass. */
  private bakeChunk(
    map: MapFile,
    layerIndex: number,
    chunkIndex: number,
    rt: Phaser.GameObjects.RenderTexture,
  ): void {
    const layer = map.layers[layerIndex];
    const width = map.meta.width;
    const startRow = chunkIndex * GROUND_CHUNK_ROWS;
    const chunkRows = Math.min(GROUND_CHUNK_ROWS, map.meta.height - startRow);

    rt.clear();
    rt.beginDraw();
    for (let r = 0; r < chunkRows; r++) {
      const row = startRow + r;
      for (let col = 0; col < width; col++) {
        const paletteIndex = layer.cells[cellIndex(col, row, width)];
        if (paletteIndex === 0) continue; // empty cell
        const entry = map.palette[paletteIndex];
        if (!entry) continue;
        const { key, frame } = resolveTile(entry.source);
        if (!this.textures.exists(key)) continue; // texture failed to load — skip, don't crash
        // frame is undefined for standalone images → batchDrawFrame falls back to the base frame.
        rt.batchDrawFrame(key, frame, col * TILE_SIZE, r * TILE_SIZE);
      }
    }
    rt.endDraw();
    rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp when the camera scales it
  }

  // ---- Objects ----

  private placeObjects(map: MapFile): void {
    for (const obj of this.objectSprites) obj.destroy();
    this.objectSprites = [];

    for (const obj of map.objects) {
      if (obj.kind === 'decor') {
        this.placeDecor(obj);
      } else if (obj.kind === 'node') {
        const x = obj.col * TILE_SIZE + TILE_SIZE / 2;
        const y = obj.row * TILE_SIZE + TILE_SIZE / 2;
        this.addMarker(x, y, TILE_SIZE, TILE_SIZE, NODE_MARKER, obj.ref);
      } else {
        const { col, row, w, h } = obj.rect;
        const x = (col + w / 2) * TILE_SIZE;
        const y = (row + h / 2) * TILE_SIZE;
        this.addMarker(x, y, w * TILE_SIZE, h * TILE_SIZE, PORTAL_MARKER, obj.name);
      }
    }
  }

  private placeDecor(obj: Extract<MapFile['objects'][number], { kind: 'decor' }>): void {
    let parsed: { pack: string; path: string; frame?: number };
    try {
      parsed = parseAssetId(obj.asset);
    } catch {
      return; // already warned in queueTextures
    }
    const key = parsed.frame === undefined ? tileImageKey(parsed.path) : sheetKey(parsed.path);
    if (!this.textures.exists(key)) return; // texture missing — skip cleanly
    const img =
      parsed.frame === undefined
        ? this.add.image(obj.x, obj.y, key)
        : this.add.image(obj.x, obj.y, key, parsed.frame);
    img.setScale(obj.scaleX, obj.scaleY);
    img.setAngle(obj.rotation); // stored in degrees (see mapFormat DecorObject)
    img.setFlip(obj.flipX, obj.flipY);
    img.setDepth(DEPTH_OBJECTS + obj.depth);
    this.objectSprites.push(img);
  }

  private addMarker(
    x: number,
    y: number,
    w: number,
    h: number,
    colour: number,
    label: string,
  ): void {
    const rect = this.add
      .rectangle(x, y, w, h, colour, 0.28)
      .setStrokeStyle(1, colour, 0.9)
      .setDepth(DEPTH_OBJECTS);
    this.objectSprites.push(rect);
    const text = this.add
      .text(x, y, label, { fontFamily: 'monospace', fontSize: '8px', color: '#f4ecd8' })
      .setOrigin(0.5)
      .setDepth(DEPTH_OBJECTS + 1);
    this.objectSprites.push(text);
  }

  // ---- Overlays ----

  private redrawOverlays(): void {
    const { map, overlays } = useEditorStore.getState();
    this.drawVoid(map);
    this.drawGrid(map, overlays.grid);
    if (!map) this.hoverGfx?.clear();
  }

  private drawVoid(map: MapFile | null): void {
    const g = this.voidGfx;
    if (!g) return;
    g.clear();
    if (!map?.shape) return; // absent shape ⇒ all-inside, nothing to hatch
    const { width, height } = map.meta;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (isInside(map, col, row)) continue;
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        g.fillStyle((col + row) % 2 === 0 ? VOID_COLOUR_A : VOID_COLOUR_B, 1);
        g.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        g.lineStyle(1, VOID_HATCH, 0.5);
        g.lineBetween(x, y + TILE_SIZE, x + TILE_SIZE, y);
      }
    }
  }

  private drawGrid(map: MapFile | null, show: boolean): void {
    const g = this.gridGfx;
    if (!g) return;
    g.clear();
    g.setVisible(show);
    if (!map || !show) return;
    const { width, height } = map.meta;
    g.lineStyle(1, GRID_COLOUR, 0.35);
    for (let col = 0; col <= width; col++) {
      g.lineBetween(col * TILE_SIZE, 0, col * TILE_SIZE, height * TILE_SIZE);
    }
    for (let row = 0; row <= height; row++) {
      g.lineBetween(0, row * TILE_SIZE, width * TILE_SIZE, row * TILE_SIZE);
    }
  }

  private updateHover(pointer: Phaser.Input.Pointer): void {
    const g = this.hoverGfx;
    if (!g) return;
    g.clear();
    const { map } = useEditorStore.getState();
    if (!map) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const col = Math.floor(world.x / TILE_SIZE);
    const row = Math.floor(world.y / TILE_SIZE);
    if (!isInside(map, col, row)) return; // reject the cursor on void / out-of-bounds cells
    g.lineStyle(1.5, HOVER_COLOUR, 0.9);
    g.strokeRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }

  // ---- Camera ----

  private fitCamera(map: MapFile): void {
    const cam = this.cameras.main;
    const widthPx = map.meta.width * TILE_SIZE;
    const heightPx = map.meta.height * TILE_SIZE;
    const margin = PAN_MARGIN_TILES * TILE_SIZE;
    cam.setBounds(-margin, -margin, widthPx + margin * 2, heightPx + margin * 2);
    const fit = Math.min(this.scale.width / widthPx, this.scale.height / heightPx);
    cam.setZoom(Phaser.Math.Clamp(Math.floor(fit) || MIN_ZOOM, MIN_ZOOM, MAX_ZOOM));
    cam.centerOn(widthPx / 2, heightPx / 2);
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ): void {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(pointer.x, pointer.y);
    const next = Phaser.Math.Clamp(Math.round(cam.zoom) + (dy > 0 ? -1 : 1), MIN_ZOOM, MAX_ZOOM);
    if (next === cam.zoom) return;
    cam.setZoom(next);
    const after = cam.getWorldPoint(pointer.x, pointer.y); // keep the world point under the cursor fixed
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.updateHover(pointer);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.middleButtonDown() || (this.spaceDown && pointer.leftButtonDown())) {
      this.panning = true;
      this.panLast = { x: pointer.x, y: pointer.y };
      this.setCursor('grabbing');
    }
    // Brush/paint pointer handling lands in step 6 (routes through store.applyCommand).
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.panning) {
      const cam = this.cameras.main;
      cam.scrollX -= (pointer.x - this.panLast.x) / cam.zoom;
      cam.scrollY -= (pointer.y - this.panLast.y) / cam.zoom;
      this.panLast = { x: pointer.x, y: pointer.y };
      return;
    }
    this.updateHover(pointer);
  }

  private handlePointerUp(): void {
    if (this.panning) {
      this.panning = false;
      this.setCursor(this.spaceDown ? 'grab' : 'default');
    }
  }

  private handleSpaceKey(e: KeyboardEvent, down: boolean): void {
    if (e.code !== 'Space') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      return; // don't hijack the space bar while typing in a dialog field
    }
    if (down) e.preventDefault(); // stop the page from scrolling while space-panning
    this.spaceDown = down;
    if (!this.panning) this.setCursor(down ? 'grab' : 'default');
  }

  private setCursor(cursor: string): void {
    if (this.game.canvas) this.game.canvas.style.cursor = cursor;
  }
}
