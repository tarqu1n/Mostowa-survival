import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TILE_SIZE } from '../../config';
import { NODES } from '../../data/nodes';
import { ACTIVE_TILESET } from '../../data/tileset';
import type { ResourceNodeDef } from '../../data/types';
import type { DecorAnim, DecorRegion } from '../../systems/mapFormat';
import { parseAssetId, tilesetAssetUrl } from '../textureLoading';
import { loadCatalog } from '../catalogSource';
import {
  catalogTileCols,
  type AssetCatalog,
  type CatalogAsset,
  type CatalogRegion,
} from '../catalog';
import {
  useEditorStore,
  DECOR_ANIM_DEFAULT_FPS,
  type ArmedObjectAsset,
} from '../store/editorStore';

/**
 * Library panel (plan 014 steps 6-7b) — loads the generated asset catalog, browses it by pack/category
 * (or text search over id/tags), a "Favourites" pseudo-category for the active zone's (or, with no
 * zone active, the map's) favourited assets, and a "Nodes" pseudo-category listing `NODES` entries
 * (previewed via their tileset role). Tile-type assets (the 5 grid tilesheets) expand into a clickable
 * frame grid; clicking a frame sets `brushAsset` and switches to the Brush tool. Non-tile assets arm
 * `decor` placement (`armedObjectAsset`/`armedNodeRef` for Nodes, mutually exclusive — see editorStore's
 * module doc) and switch to the Place tool, mirroring how a tile click switches to Brush — kept
 * deliberately separate from `brushAsset` so arming an object/node can never make the brush/rect tools
 * paint it into a tile layer. Three non-tile shapes (step 7b):
 *  - An `object` atlas (`asset.regions` present — multiple sprites detected on one sheet, e.g.
 *    `Furniture.png`/`Rocks.png`): `AtlasSheetPicker` shows the WHOLE sheet with a clickable hotspot
 *    per detected region — click the sprite ON the sheet to arm just that crop (the user's explicit
 *    "show the whole sheet, click the sprite on it" ask), rather than a swatch grid that would
 *    misrepresent irregularly-sized/positioned sprites.
 *  - A `strip` with resolvable `frameWidth`/`frameHeight`/`frames`: `AnimatedStripPicker` shows a
 *    live CSS `steps()` preview of the whole strip playing — click arms the animated decor.
 *  - Everything else (a plain single-sprite `object`, or a `strip` whose frame geometry can't be
 *    resolved) falls back to the original whole-image `AssetCard` — click arms a plain (no
 *    `region`/`anim`) decor, unchanged from step 7.
 *
 * Re-render note: `map`/`zones`/`meta.favourites` are mutated IN PLACE by store commands (stable
 * object references — see editorStore's module doc), so this component subscribes to `docRevision`/
 * `mapEpoch` purely as re-render triggers and reads the current `map` via `getState()` in the render
 * body, rather than selecting `map` itself (which wouldn't detect an in-place mutation).
 *
 * Reclassify affordance (plan 014 step 7c, rewired plan 017 steps 2-3): `AssetReclassify` renders a
 * small ⚙ trigger on every `TileFrameGrid`/`AssetCard`/`AtlasSheetPicker`/`AnimatedStripPicker`.
 * Clicking it opens the asset's full-size object-editor TAB (`openObjectTab`) instead of the old
 * cramped popover — the tab (`tabs/ObjectEditorTab.tsx`) hosts the type/frame-grid controls and does
 * the `putAssetOverride` + catalog refetch. That refetch routes through the shared `loadCatalog`
 * (`catalogSource.ts`) → `setCatalog`; this panel reads the catalog straight from the store, so a
 * reclassify committed in a tab shows up here live without a page reload.
 */

/** On-screen swatch size for tile frames — an integer upscale of TILE_SIZE for legibility (16→32). */
const PREVIEW_PX = TILE_SIZE * 2;
/** Sentinel `selectedCategory` value for the Favourites pseudo-category (never a real category
 *  string, which are always pack-relative path segments like "Environment/Tilesets"). */
const FAVOURITES = '__favourites__';
/** Sentinel `selectedCategory` value for the Nodes pseudo-category (step 7). */
const NODES_CATEGORY = '__nodes__';
/** Max on-screen width/height (px) for an atlas sheet preview (step 7b) — caps a dense sheet like
 *  `Furniture.png` (800×864) to something that fits the Library pane; hotspots scale down with it so
 *  they still land on the right sprite. Sheets already smaller than this render at native size. */
const ATLAS_PREVIEW_MAX_PX = 240;

export function LibraryPanel() {
  // The catalog lives in the store (plan 017 step 3): the object-editor tab's Apply refetches it via
  // the shared `loadCatalog` → `setCatalog`, so reading it here (rather than a local copy) is what
  // makes a reclassify show up in the Library live. `null` until the mount fetch below lands.
  const catalog = useEditorStore((s) => s.catalog);
  const [error, setError] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const brushAsset = useEditorStore((s) => s.brushAsset);
  const armedObjectAsset = useEditorStore((s) => s.armedObjectAsset);
  const armedNodeRef = useEditorStore((s) => s.armedNodeRef);
  const activeZoneId = useEditorStore((s) => s.activeZoneId);
  // Re-render triggers only — see module doc. The actual map/favourites are read fresh below.
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  // Load the catalog into the store on mount (shared `loadCatalog`, cache-busted). The object-editor
  // tab reuses the same loader after an Apply, so a reclassify refreshes both surfaces off one fetch.
  useEffect(() => {
    let cancelled = false;
    loadCatalog().catch((e: unknown) => {
      if (!cancelled) setError((e as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const map = useEditorStore.getState().map;
  const favourites: string[] = map
    ? activeZoneId !== null
      ? (map.zones.defs.find((z) => z.id === activeZoneId)?.favourites ?? [])
      : (map.meta.favourites ?? [])
    : [];
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);

  const categoriesByPack = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!catalog) return out;
    const seen = new Map<string, Set<string>>();
    for (const asset of catalog.assets) {
      if (!seen.has(asset.pack)) seen.set(asset.pack, new Set());
      seen.get(asset.pack)?.add(asset.category);
    }
    for (const [pack, cats] of seen) out.set(pack, [...cats].sort());
    return out;
  }, [catalog]);

  const searchLower = search.trim().toLowerCase();
  const showingFavourites = searchLower.length === 0 && selectedCategory === FAVOURITES;
  const showingNodes = searchLower.length === 0 && selectedCategory === NODES_CATEGORY;
  const showingCategory =
    searchLower.length === 0 &&
    selectedCategory !== null &&
    selectedCategory !== FAVOURITES &&
    selectedCategory !== NODES_CATEGORY;

  const visibleAssets: CatalogAsset[] = useMemo(() => {
    if (!catalog) return [];
    if (searchLower.length > 0) {
      return catalog.assets.filter(
        (a) =>
          a.id.toLowerCase().includes(searchLower) || a.tags.some((t) => t.includes(searchLower)),
      );
    }
    if (showingCategory && selectedPack) {
      return catalog.assets.filter(
        (a) => a.pack === selectedPack && a.category === selectedCategory,
      );
    }
    return [];
  }, [catalog, searchLower, showingCategory, selectedPack, selectedCategory]);

  function pickTile(assetId: string): void {
    const s = useEditorStore.getState();
    s.setBrushAsset(assetId);
    // Picking a tile means "I want to paint this" — switch to the Brush tool unless the user is
    // already on a brush-consuming tool (brush/rect), so a tile click never silently leaves Pan
    // active (which just drags the map).
    if (s.activeTool !== 'brush' && s.activeTool !== 'rect') s.setActiveTool('brush');
  }
  function armObject(assetId: string): void {
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId });
    s.setActiveTool('place'); // mirrors pickTile switching to Brush — arming always arms a TOOL too
  }
  /** Arms a specific atlas-sheet crop (`AtlasSheetPicker`'s hotspot click). */
  function armRegion(assetId: string, region: DecorRegion): void {
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId, region });
    s.setActiveTool('place');
  }
  /** Arms an animated strip (`AnimatedStripPicker`'s click) — `fps` is stamped at placement time
   *  (`DECOR_ANIM_DEFAULT_FPS`), never carried here (critique #6: no per-instance editable fps). */
  function armAnim(assetId: string, anim: Omit<DecorAnim, 'fps'>): void {
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId, anim });
    s.setActiveTool('place');
  }
  function armNode(ref: string): void {
    const s = useEditorStore.getState();
    s.setArmedNodeRef(ref);
    s.setActiveTool('place');
  }
  function toggleFavourite(assetId: string): void {
    useEditorStore.getState().toggleFavourite(assetId);
  }

  return (
    <>
      <h2>Library</h2>
      <input
        className="lib-search"
        type="search"
        placeholder="Search id or tag…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && <p className="editor-error-text">Catalog failed to load: {error}</p>}
      {!catalog && !error && <p className="editor-placeholder">Loading catalog…</p>}
      {catalog && (
        <>
          {searchLower.length === 0 && (
            <nav className="lib-tree">
              <button
                className={`lib-tree-item ${selectedCategory === FAVOURITES ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedPack(null);
                  setSelectedCategory(FAVOURITES);
                }}
              >
                ♥ Favourites ({favourites.length})
              </button>
              <button
                className={`lib-tree-item ${selectedCategory === NODES_CATEGORY ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedPack(null);
                  setSelectedCategory(NODES_CATEGORY);
                }}
              >
                🌲 Nodes
              </button>
              {catalog.packs.map((pack) => (
                <div key={pack.id} className="lib-tree-pack">
                  <div className="lib-tree-pack-name">{pack.name}</div>
                  {(categoriesByPack.get(pack.id) ?? []).map((category) => (
                    <button
                      key={category}
                      className={`lib-tree-item ${
                        selectedPack === pack.id && selectedCategory === category ? 'is-active' : ''
                      }`}
                      onClick={() => {
                        setSelectedPack(pack.id);
                        setSelectedCategory(category);
                      }}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          )}

          <div className="lib-results">
            {searchLower.length === 0 && selectedCategory === null && (
              <p className="editor-placeholder">Pick a category, or search above.</p>
            )}

            {showingFavourites &&
              (favourites.length === 0 ? (
                <p className="editor-placeholder">No favourites yet — click a ♡ to add one.</p>
              ) : (
                favourites.map((favId) => (
                  <FavouriteItem
                    key={favId}
                    catalog={catalog}
                    favId={favId}
                    brushAsset={brushAsset}
                    armedObjectAsset={armedObjectAsset}
                    onPickTile={pickTile}
                    onArmObject={armObject}
                    onToggleFavourite={toggleFavourite}
                  />
                ))
              ))}

            {showingNodes &&
              Object.values(NODES).map((def) => (
                <NodeCard
                  key={def.id}
                  def={def}
                  isArmed={armedNodeRef === def.id}
                  onArm={() => armNode(def.id)}
                />
              ))}

            {(showingCategory || searchLower.length > 0) &&
              visibleAssets.map((asset) => {
                if (asset.type === 'tile') {
                  return (
                    <TileFrameGrid
                      key={asset.id}
                      asset={asset}
                      brushAsset={brushAsset}
                      favourites={favouriteSet}
                      onPick={pickTile}
                      onToggleFavourite={toggleFavourite}
                    />
                  );
                }
                if (asset.type === 'object' && (asset.regions?.length ?? 0) > 0) {
                  return (
                    <AtlasSheetPicker
                      key={asset.id}
                      asset={asset}
                      armedObjectAsset={armedObjectAsset}
                      onArmRegion={armRegion}
                    />
                  );
                }
                if (isAnimatableStrip(asset)) {
                  return (
                    <AnimatedStripPicker
                      key={asset.id}
                      asset={asset}
                      isArmed={armedObjectAsset?.assetId === asset.id}
                      onArm={armAnim}
                    />
                  );
                }
                return (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    isFavourite={favouriteSet.has(asset.id)}
                    isArmed={armedObjectAsset?.assetId === asset.id}
                    onArm={() => armObject(asset.id)}
                    onToggleFavourite={() => toggleFavourite(asset.id)}
                  />
                );
              })}

            {searchLower.length > 0 && visibleAssets.length === 0 && (
              <p className="editor-placeholder">No matches.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** A tile asset's expanded frame grid — one clickable swatch per frame, each with its own favourite
 *  heart (tile favourites are frame-specific, e.g. "these 3 grass variants"). `cols` is derived from
 *  the catalog's own `w`/`tileSize`, never hardcoded. */
function TileFrameGrid({
  asset,
  brushAsset,
  favourites,
  onPick,
  onToggleFavourite,
}: {
  asset: CatalogAsset;
  brushAsset: string | null;
  favourites: ReadonlySet<string>;
  onPick: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
}) {
  const cols = catalogTileCols(asset, TILE_SIZE);
  const nativeRows = Math.max(1, Math.round(asset.h / TILE_SIZE));
  const frames = asset.frames ?? cols * nativeRows;
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const bgSize = `${cols * PREVIEW_PX}px ${nativeRows * PREVIEW_PX}px`;

  return (
    <div className="lib-tile-sheet" style={{ position: 'relative' }}>
      <AssetReclassify asset={asset} />
      <div className="lib-tile-sheet-name" title={asset.id}>
        {asset.id.split('/').pop()}
      </div>
      <div
        className="lib-frame-grid"
        style={{ gridTemplateColumns: `repeat(${cols}, ${PREVIEW_PX}px)` }}
      >
        {Array.from({ length: frames }, (_, frame) => {
          const col = frame % cols;
          const row = Math.floor(frame / cols);
          const frameId = `${asset.id}#${frame}`;
          const isFav = favourites.has(frameId);
          return (
            <button
              key={frame}
              className={`lib-frame ${brushAsset === frameId ? 'is-active' : ''}`}
              title={`frame ${frame}`}
              onClick={() => onPick(frameId)}
            >
              <span
                className="lib-frame-swatch pixelated"
                style={{
                  width: PREVIEW_PX,
                  height: PREVIEW_PX,
                  backgroundImage: `url(${url})`,
                  backgroundPosition: `-${col * PREVIEW_PX}px -${row * PREVIEW_PX}px`,
                  backgroundSize: bgSize,
                }}
              />
              <span
                className={`lib-heart ${isFav ? 'is-fav' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavourite(frameId);
                }}
              >
                {isFav ? '♥' : '♡'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A node's preview image URL, resolved via its tileset role (`ACTIVE_TILESET.tiles[def.tile]`) —
 *  matches how it actually renders in-game/in-editor. Today every node's role is a standalone `image`
 *  source (see `data/tileset.ts`'s `PIXEL_CRAWLER_TILESET.tiles`), so this always shows the exact
 *  sprite; a `sheetFrame` role (none currently) would show its whole sheet rather than one cropped
 *  frame — an acceptable simplification since the step only requires *a* tile-role preview. */
function nodePreviewUrl(def: ResourceNodeDef): string {
  const source = ACTIVE_TILESET.tiles[def.tile];
  const path = source.kind === 'image' ? source.path : source.sheet;
  return tilesetAssetUrl(ACTIVE_TILESET.id, path);
}

/** One "Nodes" pseudo-category entry (step 7) — click arms `armedNodeRef` for the Place tool. Nodes
 *  aren't favouritable (favourites are catalog asset ids; `NODES` refs are a different id space). */
function NodeCard({
  def,
  isArmed,
  onArm,
}: {
  def: ResourceNodeDef;
  isArmed: boolean;
  onArm: () => void;
}) {
  const url = nodePreviewUrl(def);
  return (
    <button className={`lib-card ${isArmed ? 'is-active' : ''}`} title={def.id} onClick={onArm}>
      <span className="lib-card-swatch pixelated" style={{ backgroundImage: `url(${url})` }} />
      <span className="lib-card-label">{def.name}</span>
    </button>
  );
}

/** A single strip/object asset preview (whole image, letterboxed) — click arms decor placement.
 *  Objects aren't split into frames in the Library; a strip shows its full sheet. Wrapped in a
 *  `position:relative` `<div>` (rather than the card itself being one) so `AssetReclassify`'s ⚙
 *  trigger + popover can render as a SIBLING of the arm `<button>`, not nested inside it — the
 *  popover holds real `<select>`/`<input>`/`<button>` elements, which can't legally nest inside
 *  another `<button>`. */
function AssetCard({
  asset,
  isFavourite,
  isArmed,
  onArm,
  onToggleFavourite,
}: {
  asset: CatalogAsset;
  isFavourite: boolean;
  isArmed: boolean;
  onArm: () => void;
  onToggleFavourite: () => void;
}) {
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const label = asset.id.split('/').pop() ?? asset.id;
  return (
    <div style={{ position: 'relative' }}>
      <button className={`lib-card ${isArmed ? 'is-active' : ''}`} title={asset.id} onClick={onArm}>
        <span className="lib-card-swatch pixelated" style={{ backgroundImage: `url(${url})` }} />
        <span className="lib-card-label">{label}</span>
        <span
          className={`lib-heart ${isFavourite ? 'is-fav' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavourite();
          }}
        >
          {isFavourite ? '♥' : '♡'}
        </span>
      </button>
      <AssetReclassify asset={asset} />
    </div>
  );
}

/** One Favourites-pseudo-category entry — resolves a favourited catalog id (which may carry
 *  `#frame`, e.g. a favourited tile frame) back to its `CatalogAsset` and renders the appropriate
 *  single-swatch view. A favourite whose asset no longer exists in the catalog (pack removed/
 *  regenerated) shows a small "missing" placeholder rather than crashing. */
function FavouriteItem({
  catalog,
  favId,
  brushAsset,
  armedObjectAsset,
  onPickTile,
  onArmObject,
  onToggleFavourite,
}: {
  catalog: AssetCatalog;
  favId: string;
  brushAsset: string | null;
  armedObjectAsset: ArmedObjectAsset | null;
  onPickTile: (assetId: string) => void;
  onArmObject: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
}) {
  let resolved: { asset: CatalogAsset; frame?: number } | null = null;
  try {
    const { pack, path, frame } = parseAssetId(favId);
    const baseId = `${pack}/${path}`;
    const asset = catalog.assets.find((a) => a.id === baseId);
    if (asset) resolved = { asset, frame };
  } catch {
    resolved = null;
  }

  if (!resolved) {
    return (
      <div className="lib-card lib-card--missing" title={favId}>
        <span className="lib-card-label">missing: {favId}</span>
        <span className="lib-heart is-fav" onClick={() => onToggleFavourite(favId)}>
          ♥
        </span>
      </div>
    );
  }

  const { asset, frame } = resolved;
  if (asset.type === 'tile' && frame !== undefined) {
    const cols = catalogTileCols(asset, TILE_SIZE);
    const nativeRows = Math.max(1, Math.round(asset.h / TILE_SIZE));
    const col = frame % cols;
    const row = Math.floor(frame / cols);
    const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
    const url = tilesetAssetUrl(asset.pack, path);
    return (
      <button
        className={`lib-frame ${brushAsset === favId ? 'is-active' : ''}`}
        title={favId}
        onClick={() => onPickTile(favId)}
      >
        <span
          className="lib-frame-swatch pixelated"
          style={{
            width: PREVIEW_PX,
            height: PREVIEW_PX,
            backgroundImage: `url(${url})`,
            backgroundPosition: `-${col * PREVIEW_PX}px -${row * PREVIEW_PX}px`,
            backgroundSize: `${cols * PREVIEW_PX}px ${nativeRows * PREVIEW_PX}px`,
          }}
        />
        <span
          className="lib-heart is-fav"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavourite(favId);
          }}
        >
          ♥
        </span>
      </button>
    );
  }

  return (
    <AssetCard
      asset={asset}
      isFavourite
      isArmed={armedObjectAsset?.assetId === favId || brushAsset === favId}
      onArm={() => onArmObject(favId)}
      onToggleFavourite={() => onToggleFavourite(favId)}
    />
  );
}

/** True if `asset` is a `strip` with fully resolvable, actually-multi-frame geometry — the only
 *  shape `AnimatedStripPicker` can safely animate (per plan guidance: don't guess frame math for a
 *  strip that lacks clean `frameWidth`/`frameHeight`/`frames`; fall back to the plain `AssetCard`
 *  instead). `frames >= 2`, not `> 0` (plan 014 step 7c bugfix): `stripFrameDims`'s "unresolved"
 *  fallback stamps `frames: 1` (the whole sheet as one unsliced frame) — `frames > 0` let THAT
 *  wrongly render via `AnimatedStripPicker` and stamp a useless `anim {…, frames: 1}` onto placed
 *  decor; a genuinely single-frame strip isn't an animation. */
function isAnimatableStrip(
  asset: CatalogAsset,
): asset is CatalogAsset & { frameWidth: number; frameHeight: number; frames: number } {
  return (
    asset.type === 'strip' &&
    typeof asset.frameWidth === 'number' &&
    typeof asset.frameHeight === 'number' &&
    typeof asset.frames === 'number' &&
    asset.frames >= 2
  );
}

/**
 * Atlas sheet picker (step 7b) — an `object` asset with detected `regions` (e.g. `Furniture.png`,
 * `Rocks.png`). Renders the WHOLE sheet with each region as an absolutely-positioned transparent
 * hotspot button — "show the whole sheet, click the sprite on it" per the user's explicit ask. A
 * swatch-per-region grid would misrepresent these sheets: regions are irregular sizes at irregular
 * positions (not a uniform tile grid), so cropping each into a same-size cell would lose the sheet's
 * actual layout/relationships. A base "fit" scale caps a big sheet down to `ATLAS_PREVIEW_MAX_PX`; a
 * `zoom` control (1–8×, via the +/− buttons, the slider, or the mouse wheel over the sheet)
 * multiplies it so the author can enlarge dense sheets enough to see/click small sprites — the canvas
 * overflows into a scrollable viewport and hotspots scale with the effective scale so they stay on
 * their sprite. Wheel-zoom is cursor-anchored (the content point under the pointer stays put) and uses
 * a native non-passive listener because React's synthetic `onWheel` is passive and can't
 * `preventDefault` the viewport's own scroll.
 */
const ATLAS_ZOOM_MIN = 1;
const ATLAS_ZOOM_MAX = 8;
const ATLAS_ZOOM_STEP = 0.5;
const clampZoom = (z: number): number =>
  Math.min(
    ATLAS_ZOOM_MAX,
    Math.max(ATLAS_ZOOM_MIN, Math.round(z / ATLAS_ZOOM_STEP) * ATLAS_ZOOM_STEP),
  );

function AtlasSheetPicker({
  asset,
  armedObjectAsset,
  onArmRegion,
}: {
  asset: CatalogAsset;
  armedObjectAsset: ArmedObjectAsset | null;
  onArmRegion: (assetId: string, region: DecorRegion) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const hoveringRef = useRef(false);
  const panRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  // Set by a wheel event, consumed by the layout effect below to keep the pointed-at content point
  // stationary across the zoom: `cx/cy` = content-space point under the cursor, `ox/oy` = its pixel
  // offset within the viewport.
  const pendingAnchor = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);

  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const fitScale = Math.min(1, ATLAS_PREVIEW_MAX_PX / Math.max(asset.w, asset.h));
  const scale = fitScale * zoom;
  const dispW = Math.round(asset.w * scale);
  const dispH = Math.round(asset.h * scale);
  const armedRegion = armedObjectAsset?.assetId === asset.id ? armedObjectAsset.region : undefined;

  // Re-anchor scroll after a wheel-zoom changes the canvas size (runs before paint, so no flicker).
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const a = pendingAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.cx * scale - a.ox;
    el.scrollTop = a.cy * scale - a.oy;
    pendingAnchor.current = null;
  }, [scale]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      pendingAnchor.current = {
        cx: (el.scrollLeft + ox) / scale,
        cy: (el.scrollTop + oy) / scale,
        ox,
        oy,
      };
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ATLAS_ZOOM_STEP : -ATLAS_ZOOM_STEP)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale]);

  // Hold Space to pan (middle-mouse-drag works too, unconditionally — see onCanvasPointerDown), mirrors
  // the object-editor tab's regions editor. Gated on `hoveringRef` rather than global focus so it never
  // steals the spacebar from another Library card while the pointer's elsewhere on the page.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || e.repeat || !hoveringRef.current) return;
      e.preventDefault();
      setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  function onCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return;
    e.preventDefault();
    const el = viewportRef.current;
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: el?.scrollLeft ?? 0,
      startTop: el?.scrollTop ?? 0,
    };
    setIsPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const p = panRef.current;
    if (!p) return;
    const el = viewportRef.current;
    if (el) {
      el.scrollLeft = p.startLeft - (e.clientX - p.startX);
      el.scrollTop = p.startTop - (e.clientY - p.startY);
    }
  }

  function onCanvasPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (!panRef.current) return;
    panRef.current = null;
    setIsPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <div className="lib-tile-sheet" style={{ position: 'relative' }}>
      <div className="lib-tile-sheet-name" title={asset.id}>
        {asset.id.split('/').pop()}
      </div>
      <AssetReclassify asset={asset} />
      <div className="lib-atlas-zoom">
        <button
          type="button"
          className="lib-atlas-zoom-btn"
          title="Zoom out"
          disabled={zoom <= ATLAS_ZOOM_MIN}
          onClick={() => setZoom((z) => clampZoom(z - ATLAS_ZOOM_STEP))}
        >
          −
        </button>
        <input
          type="range"
          min={ATLAS_ZOOM_MIN}
          max={ATLAS_ZOOM_MAX}
          step={ATLAS_ZOOM_STEP}
          value={zoom}
          aria-label="Atlas zoom"
          onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
        />
        <button
          type="button"
          className="lib-atlas-zoom-btn"
          title="Zoom in"
          disabled={zoom >= ATLAS_ZOOM_MAX}
          onClick={() => setZoom((z) => clampZoom(z + ATLAS_ZOOM_STEP))}
        >
          +
        </button>
        <span className="lib-atlas-zoom-val">{zoom}×</span>
      </div>
      <div
        className="lib-atlas-viewport"
        ref={viewportRef}
        onPointerEnter={() => {
          hoveringRef.current = true;
        }}
        onPointerLeave={() => {
          hoveringRef.current = false;
        }}
      >
        <div
          className={`lib-atlas-canvas pixelated ${spaceHeld ? 'is-pan-ready' : ''} ${
            isPanning ? 'is-panning' : ''
          }`}
          style={{
            width: dispW,
            height: dispH,
            backgroundImage: `url(${url})`,
            backgroundSize: `${dispW}px ${dispH}px`,
          }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
        >
          {(asset.regions ?? []).map((region: CatalogRegion) => {
            const isArmed =
              armedRegion !== undefined &&
              armedRegion.x === region.x &&
              armedRegion.y === region.y &&
              armedRegion.w === region.w &&
              armedRegion.h === region.h;
            return (
              <button
                key={region.key}
                className={`lib-atlas-hotspot ${isArmed ? 'is-active' : ''}`}
                title={`${region.w}×${region.h} @ (${region.x},${region.y})`}
                style={{
                  left: region.x * scale,
                  top: region.y * scale,
                  width: Math.max(4, region.w * scale),
                  height: Math.max(4, region.h * scale),
                }}
                onClick={() =>
                  onArmRegion(asset.id, { x: region.x, y: region.y, w: region.w, h: region.h })
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Animated strip picker (step 7b) — a `strip` asset with resolvable per-frame geometry
 * (`isAnimatableStrip`). Shows a live preview of the strip playing in a ONE-FRAME window via a CSS
 * `steps()` animation. The swatch is exactly one scaled frame (`dispW`×`dispH`); the sheet is drawn
 * behind it at its true scaled width (`frames * dispW`) and `background-position-x` travels the whole
 * `-frames * dispW` over `steps(frames)`, so every step lands exactly on a frame boundary. (A
 * percentage `0% → 100%` travel — the earlier approach — under-shifts by `(frames-1)/frames` of a
 * frame each step because of CSS's percentage-position formula, which showed two half-frames sliding
 * sideways instead of a clean flip.) The travel distance is handed to the shared keyframe via the
 * `--strip-travel` custom property, since @keyframes can't read component values. Clicking arms the
 * animated decor; placement stamps a fixed default `fps` (`DECOR_ANIM_DEFAULT_FPS`), never edited here
 * (critique #6).
 */
function AnimatedStripPicker({
  asset,
  isArmed,
  onArm,
}: {
  asset: CatalogAsset & { frameWidth: number; frameHeight: number; frames: number };
  isArmed: boolean;
  onArm: (assetId: string, anim: Omit<DecorAnim, 'fps'>) => void;
}) {
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const scale = PREVIEW_PX / asset.frameHeight;
  const dispW = Math.round(asset.frameWidth * scale);
  const dispH = Math.round(asset.frameHeight * scale);
  const label = asset.id.split('/').pop() ?? asset.id;

  const swatchStyle: CSSProperties & Record<'--strip-travel', string> = {
    width: dispW,
    height: dispH,
    backgroundImage: `url(${url})`,
    backgroundSize: `${asset.frames * dispW}px ${dispH}px`,
    animationDuration: `${asset.frames / DECOR_ANIM_DEFAULT_FPS}s`,
    animationTimingFunction: `steps(${asset.frames})`,
    '--strip-travel': `${-asset.frames * dispW}px`,
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        className={`lib-card lib-strip-anim ${isArmed ? 'is-active' : ''}`}
        title={asset.id}
        onClick={() =>
          onArm(asset.id, {
            frameWidth: asset.frameWidth,
            frameHeight: asset.frameHeight,
            frames: asset.frames,
          })
        }
      >
        <span className="lib-strip-swatch pixelated" style={swatchStyle} />
        <span className="lib-card-label">{label}</span>
      </button>
      <AssetReclassify asset={asset} />
    </div>
  );
}

/**
 * Per-asset reclassify affordance (plan 014 step 7c, rewired plan 017 step 2) — a small ⚙ trigger on
 * every `TileFrameGrid`/`AssetCard`/`AtlasSheetPicker`/`AnimatedStripPicker`. Clicking it opens the
 * asset's full-size object-editor TAB (`openObjectTab`) instead of the old cramped popover, so the
 * type/frame-grid reclassify controls (a placeholder in step 2, fleshed out in step 3) get the room
 * to render a correct preview. Rendered as a SIBLING of its caller's arm-button via an absolutely
 * positioned wrapper (see `AssetCard`'s doc) — callers drop `<AssetReclassify asset={…} />` inside any
 * `position:relative` container and it self-anchors to the top-right corner. Clicks are
 * `stopPropagation`'d so opening the tab never also arms/paints the underlying card.
 */
function AssetReclassify({ asset }: { asset: CatalogAsset }) {
  function open(): void {
    useEditorStore.getState().openObjectTab(asset.id);
  }
  return (
    <span
      className="lib-reclassify"
      role="button"
      tabIndex={0}
      title="Reclassify: force type / frame grid"
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      ⚙
    </span>
  );
}
