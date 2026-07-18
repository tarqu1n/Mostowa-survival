import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import {
  serializeMap,
  parseMap,
  type MapFile,
  type TilePaletteSlot,
} from '../../../systems/mapFormat';

const ASSET_A = 'pixel-crawler/Environment/Tilesets/Floors_Tiles.png#252';
const ASSET_B = 'pixel-crawler/Environment/Tilesets/Floors_Tiles.png#253';

/** Fresh 4x4 map for each test — `newMap` also clears history and resets palette view-state. */
function reset(width = 4, height = 4): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', width, height);
  useEditorStore.getState().setBrushAsset(null);
  useEditorStore.getState().setBrushRotation(0);
}

/** Blank map WITHOUT going through `newMap`'s side effects — lets a test load a legacy map that has
 *  never had `meta.tilePalettes` materialised. */
function emptyMapForTest(width: number, height: number): MapFile {
  useEditorStore.getState().newMap('tmp', 'Tmp', width, height);
  return useEditorStore.getState().map!;
}

describe('editorStore tile palettes (plan 033)', () => {
  beforeEach(() => reset());

  it('newMap starts with no palettes and a null active pointer', () => {
    const s = useEditorStore.getState();
    expect(s.map!.meta.tilePalettes).toBeUndefined();
    expect(s.activeTilePaletteId).toBeNull();
  });

  it('addTilePalette appends a named palette, makes it active, and dirties the map', () => {
    const rev0 = useEditorStore.getState().docRevision;
    useEditorStore.getState().addTilePalette();
    const s = useEditorStore.getState();
    expect(s.map!.meta.tilePalettes).toHaveLength(1);
    expect(s.map!.meta.tilePalettes![0]).toMatchObject({ name: 'Palette 1', slots: [] });
    expect(s.map!.meta.tilePalettes![0].id).toMatch(/^palette_\d{4}$/);
    expect(s.activeTilePaletteId).toBe(s.map!.meta.tilePalettes![0].id);
    expect(s.docRevision).toBe(rev0 + 1); // went through applyCommand
    expect(s.dirty).toBe(true);
  });

  it('addTilePalette uses "Palette N" (N = count+1) and honours an explicit name', () => {
    useEditorStore.getState().addTilePalette();
    useEditorStore.getState().addTilePalette('Walls');
    useEditorStore.getState().addTilePalette();
    const palettes = useEditorStore.getState().map!.meta.tilePalettes!;
    expect(palettes.map((p) => p.name)).toEqual(['Palette 1', 'Walls', 'Palette 3']);
    // ids scan-for-max, zero-padded, never collide
    expect(palettes.map((p) => p.id)).toEqual(['palette_0001', 'palette_0002', 'palette_0003']);
  });

  it('undo reverses a structural palette edit (proves it routed through applyCommand)', () => {
    useEditorStore.getState().addTilePalette();
    expect(useEditorStore.getState().map!.meta.tilePalettes).toHaveLength(1);
    expect(useEditorStore.getState().canUndo).toBe(true);

    useEditorStore.getState().undo();
    const s = useEditorStore.getState();
    expect(s.map!.meta.tilePalettes ?? []).toHaveLength(0);
    // pointer reconciled — no dangling id after the palette vanished
    expect(s.activeTilePaletteId).toBeNull();
  });

  it('setActiveTilePalette switches the pointer WITHOUT dirtying the map or bumping docRevision', () => {
    useEditorStore.getState().addTilePalette(); // palette_0001
    useEditorStore.getState().addTilePalette(); // palette_0002
    // Clear dirty/rev tracking by reloading from a serialise→parse round-trip (simulates "just saved").
    const saved = parseMap(JSON.parse(serializeMap(useEditorStore.getState().map!)) as unknown);
    useEditorStore.getState().loadMap(saved, 'saved-1');
    expect(useEditorStore.getState().dirty).toBe(false);

    const rev = useEditorStore.getState().docRevision;
    useEditorStore.getState().setActiveTilePalette('palette_0002');
    const s = useEditorStore.getState();
    expect(s.activeTilePaletteId).toBe('palette_0002');
    expect(s.dirty).toBe(false); // switching is pure view-state — NOT a map edit
    expect(s.docRevision).toBe(rev);
    expect(s.canUndo).toBe(false);
  });

  it('addTilesToActivePalette lazily creates "Palette 1" on a map with none, and makes it active', () => {
    expect(useEditorStore.getState().map!.meta.tilePalettes).toBeUndefined();
    useEditorStore.getState().addTilesToActivePalette([{ assetId: ASSET_A }]);
    const s = useEditorStore.getState();
    expect(s.map!.meta.tilePalettes).toHaveLength(1);
    expect(s.map!.meta.tilePalettes![0].name).toBe('Palette 1');
    expect(s.map!.meta.tilePalettes![0].slots).toEqual([{ assetId: ASSET_A }]);
    expect(s.activeTilePaletteId).toBe(s.map!.meta.tilePalettes![0].id);
  });

  it('addTilesToActivePalette bulk-appends to the active palette, deduping exact assetId+rotation', () => {
    useEditorStore.getState().addTilePalette();
    useEditorStore.getState().addTilesToActivePalette([
      { assetId: ASSET_A },
      { assetId: ASSET_B, rotation: 90 },
      { assetId: ASSET_A }, // dup within batch
    ]);
    // Re-adding an existing slot (same assetId+rotation) is a no-op; a new rotation is distinct.
    useEditorStore.getState().addTilesToActivePalette([
      { assetId: ASSET_A }, // dup vs existing
      { assetId: ASSET_A, rotation: 90 }, // distinct rotation
    ]);
    const slots = useEditorStore.getState().map!.meta.tilePalettes![0].slots;
    expect(slots).toEqual([
      { assetId: ASSET_A },
      { assetId: ASSET_B, rotation: 90 },
      { assetId: ASSET_A, rotation: 90 },
    ]);
  });

  it('addTilesToActivePalette is undoable (append + lazy creation reverse together)', () => {
    useEditorStore.getState().addTilesToActivePalette([{ assetId: ASSET_A }]);
    expect(useEditorStore.getState().map!.meta.tilePalettes).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().map!.meta.tilePalettes ?? []).toHaveLength(0);
  });

  it('removeTilePaletteSlot removes the slot at index, undoably', () => {
    useEditorStore.getState().addTilePalette();
    const id = useEditorStore.getState().map!.meta.tilePalettes![0].id;
    useEditorStore
      .getState()
      .addTilesToActivePalette([{ assetId: ASSET_A }, { assetId: ASSET_B, rotation: 180 }]);

    useEditorStore.getState().removeTilePaletteSlot(id, 0);
    expect(useEditorStore.getState().map!.meta.tilePalettes![0].slots).toEqual([
      { assetId: ASSET_B, rotation: 180 },
    ]);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().map!.meta.tilePalettes![0].slots).toEqual([
      { assetId: ASSET_A },
      { assetId: ASSET_B, rotation: 180 },
    ]);

    // Out-of-range index is a safe no-op.
    useEditorStore.getState().removeTilePaletteSlot(id, 99);
    expect(useEditorStore.getState().map!.meta.tilePalettes![0].slots).toHaveLength(2);
  });

  it('selectPaletteSlot arms the brush: sets brushAsset + brushRotation and switches to the brush tool', () => {
    useEditorStore.getState().setActiveTool('pan');
    const slot: TilePaletteSlot = { assetId: ASSET_B, rotation: 270 };
    useEditorStore.getState().selectPaletteSlot(slot);
    const s = useEditorStore.getState();
    expect(s.brushAsset).toBe(ASSET_B);
    expect(s.brushRotation).toBe(270);
    expect(s.activeTool).toBe('brush');
  });

  it('selectPaletteSlot defaults rotation to 0 and keeps a brush-consuming tool (rect) as-is', () => {
    useEditorStore.getState().setBrushRotation(90);
    useEditorStore.getState().setActiveTool('rect');
    useEditorStore.getState().selectPaletteSlot({ assetId: ASSET_A });
    const s = useEditorStore.getState();
    expect(s.brushAsset).toBe(ASSET_A);
    expect(s.brushRotation).toBe(0);
    expect(s.activeTool).toBe('rect'); // already brush-consuming — not forced to 'brush'
  });

  it('selectPaletteSlot is a pure brush-arm — no command, no dirty', () => {
    const saved = parseMap(JSON.parse(serializeMap(useEditorStore.getState().map!)) as unknown);
    useEditorStore.getState().loadMap(saved, 'saved-arm');
    expect(useEditorStore.getState().dirty).toBe(false);
    useEditorStore.getState().selectPaletteSlot({ assetId: ASSET_A });
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });

  it('reconcileActiveTilePalette: loading a map with palettes points at the FIRST one', () => {
    useEditorStore.getState().addTilePalette('A'); // palette_0001
    useEditorStore.getState().addTilePalette('B'); // palette_0002
    useEditorStore.getState().setActiveTilePalette('palette_0002');
    const saved = parseMap(JSON.parse(serializeMap(useEditorStore.getState().map!)) as unknown);

    useEditorStore.getState().loadMap(saved, 'saved-reconcile');
    // Fresh load resets the pointer to the first palette, not whatever was active before.
    expect(useEditorStore.getState().activeTilePaletteId).toBe('palette_0001');
  });

  it('opening a legacy map (no tilePalettes) leaves it clean and unmigrated', () => {
    const legacy = emptyMapForTest(3, 3);
    delete legacy.meta.tilePalettes; // ensure the key is genuinely absent
    const roundTripped = parseMap(JSON.parse(serializeMap(legacy)) as unknown);
    expect('tilePalettes' in roundTripped.meta).toBe(false);

    useEditorStore.getState().loadMap(roundTripped, 'legacy');
    const s = useEditorStore.getState();
    expect(s.dirty).toBe(false); // load never dirties
    expect(s.activeTilePaletteId).toBeNull();
    expect(s.map!.meta.tilePalettes).toBeUndefined(); // NOT materialised to []
    // Serialising the untouched map omits the key entirely (byte-identical round-trip).
    const json = JSON.parse(serializeMap(s.map!)) as { meta: Record<string, unknown> };
    expect('tilePalettes' in json.meta).toBe(false);
  });

  it('adding a tile then serialise→parse preserves the palette', () => {
    useEditorStore
      .getState()
      .addTilesToActivePalette([{ assetId: ASSET_A }, { assetId: ASSET_B, rotation: 90 }]);
    const map = useEditorStore.getState().map!;
    const parsed = parseMap(JSON.parse(serializeMap(map)) as unknown);
    expect(parsed.meta.tilePalettes).toEqual([
      {
        id: 'palette_0001',
        name: 'Palette 1',
        slots: [{ assetId: ASSET_A }, { assetId: ASSET_B, rotation: 90 }],
      },
    ]);
  });

  it('Library pick-mode state toggles and clears (transient, no command/dirty)', () => {
    const saved = parseMap(JSON.parse(serializeMap(useEditorStore.getState().map!)) as unknown);
    useEditorStore.getState().loadMap(saved, 'saved-pick');
    expect(useEditorStore.getState().palettePickMode).toBe(false);

    useEditorStore.getState().togglePalettePickMode();
    expect(useEditorStore.getState().palettePickMode).toBe(true);

    useEditorStore.getState().togglePalettePickTile(ASSET_A);
    useEditorStore.getState().togglePalettePickTile(ASSET_B);
    useEditorStore.getState().togglePalettePickTile(ASSET_A); // toggle off
    expect(useEditorStore.getState().palettePickSelection).toEqual([ASSET_B]);

    useEditorStore.getState().clearPalettePick();
    expect(useEditorStore.getState().palettePickSelection).toEqual([]);

    useEditorStore.getState().togglePalettePickTile(ASSET_A);
    useEditorStore.getState().togglePalettePickMode(); // leaving pick mode clears selection
    expect(useEditorStore.getState().palettePickMode).toBe(false);
    expect(useEditorStore.getState().palettePickSelection).toEqual([]);

    // None of this touched the document.
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });
});
