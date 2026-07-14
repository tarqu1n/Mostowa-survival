import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { TILE_SIZE } from '../../config';
import { NODES } from '../../data/nodes';
import { ACTIVE_TILESET } from '../../data/tileset';
import type { ResourceNodeDef } from '../../data/types';
import type { DecorAnim, DecorRegion } from '../../systems/mapFormat';
import { parseAssetId, tilesetAssetUrl } from '../textureLoading';
import { putAssetOverride, type AssetOverridePatch } from '../api';
import {
  parseCatalog,
  catalogTileCols,
  type AssetCatalog,
  type CatalogAsset,
  type CatalogAssetType,
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
 * Reclassify affordance (plan 014 step 7c): `AssetReclassify` renders a small ⚙ trigger on every
 * `AssetCard`/`AtlasSheetPicker`/`AnimatedStripPicker` (the three non-tile shapes above) that opens
 * a popover to force an asset's `type` and, for `strip`, its frame grid (`frames`/`rows`) — the
 * in-editor fix for `pack.json` `rules`-based classification getting a sheet wrong (e.g. a grid
 * animation strip matched as `strip` by filename but whose frame count can't be derived). Committing
 * calls `putAssetOverride` (patches `pack.json`, reruns both asset-pipeline generators server-side)
 * then `refetchCatalog` — the explicit refetch path this step adds alongside the original
 * fetch-once-on-mount effect, so a reclassify is visible immediately without a page reload. Known
 * limitation: already-placed decor is a catalog SNAPSHOT (`DecorObject.region`/`anim` are baked in
 * at placement time) — reclassifying a sheet after placing it does not retroactively fix that
 * instance; it must be deleted and re-placed (no texture-key collision either way, since
 * `decorTextureKey` includes the frame dims).
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
  const [catalog, setCatalogLocal] = useState<AssetCatalog | null>(null);
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

  /** Fetches + narrows `asset-catalog.json` and installs it (local state + store). Shared by the
   *  mount effect below and `AssetReclassify`'s post-commit refetch (plan 014 step 7c) — a
   *  `PUT /__editor/asset-override` regenerates the file server-side, so the panel must re-pull it
   *  rather than relying on the one-shot mount fetch. Cache-busted (`?t=`) since the browser would
   *  otherwise happily serve the pre-reclassify response it already fetched once this session. */
  const refetchCatalog = useCallback(async (): Promise<void> => {
    const res = await fetch(`${import.meta.env.BASE_URL}assets/asset-catalog.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = (await res.json()) as unknown;
    const parsed = parseCatalog(json);
    setCatalogLocal(parsed);
    useEditorStore.getState().setCatalog(parsed);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refetchCatalog().catch((e: unknown) => {
      if (!cancelled) setError((e as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [refetchCatalog]);

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
                    onReclassified={refetchCatalog}
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
                      onReclassified={refetchCatalog}
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
                      onReclassified={refetchCatalog}
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
                    onReclassified={refetchCatalog}
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
    <div className="lib-tile-sheet">
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
  onReclassified,
}: {
  asset: CatalogAsset;
  isFavourite: boolean;
  isArmed: boolean;
  onArm: () => void;
  onToggleFavourite: () => void;
  onReclassified: () => Promise<void>;
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
      <AssetReclassify asset={asset} onReclassified={onReclassified} />
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
  onReclassified,
}: {
  catalog: AssetCatalog;
  favId: string;
  brushAsset: string | null;
  armedObjectAsset: ArmedObjectAsset | null;
  onPickTile: (assetId: string) => void;
  onArmObject: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
  onReclassified: () => Promise<void>;
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
      onReclassified={onReclassified}
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
  onReclassified,
}: {
  asset: CatalogAsset;
  armedObjectAsset: ArmedObjectAsset | null;
  onArmRegion: (assetId: string, region: DecorRegion) => void;
  onReclassified: () => Promise<void>;
}) {
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="lib-tile-sheet" style={{ position: 'relative' }}>
      <div className="lib-tile-sheet-name" title={asset.id}>
        {asset.id.split('/').pop()}
      </div>
      <AssetReclassify asset={asset} onReclassified={onReclassified} />
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
      <div className="lib-atlas-viewport" ref={viewportRef}>
        <div
          className="lib-atlas-canvas pixelated"
          style={{
            width: dispW,
            height: dispH,
            backgroundImage: `url(${url})`,
            backgroundSize: `${dispW}px ${dispH}px`,
          }}
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
  onReclassified,
}: {
  asset: CatalogAsset & { frameWidth: number; frameHeight: number; frames: number };
  isArmed: boolean;
  onArm: (assetId: string, anim: Omit<DecorAnim, 'fps'>) => void;
  onReclassified: () => Promise<void>;
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
      <AssetReclassify asset={asset} onReclassified={onReclassified} />
    </div>
  );
}

// ---- Reclassify popover (plan 014 step 7c) ----------------------------------------------------
// Inline styles throughout (not `editor.css` classes): this step's side effects deliberately don't
// touch `editor.css` — see the plan step's file list. Colours are lifted straight from the existing
// dark theme's hardcoded hex values (editor.css's own :root-less palette) so the popover doesn't
// look like a foreign element despite not sharing a stylesheet rule with the rest of the panel.
const RECLASSIFY_BG = '#1b1614';
const RECLASSIFY_BORDER = '#3a2f2a';
const RECLASSIFY_INPUT_BG = '#0e0b0a';
const RECLASSIFY_TEXT = '#e8e0d8';
const RECLASSIFY_MUTED = '#8a7f76';
const RECLASSIFY_ACCENT = '#e0b020';
const RECLASSIFY_ERROR = '#e07a6a';

/** Candidate `{rows, cols}` strip grids for a sheet of size `w`×`h`, purely arithmetic (no pixel
 *  decode — plan 014 step 7c: "frame-grid geometry is deterministic integer arithmetic ... NOT an
 *  LLM job"): every `(rows, cols)` pair (capped at 8×8, i.e. up to 64 frames — plenty for any prop
 *  animation) where both `h/rows` and `w/cols` are whole numbers. Pairs whose resulting per-frame
 *  size is itself a multiple of `TILE_SIZE` sort first — the far more likely real grid for pixel-art
 *  authored at a tile-multiple size — then by ascending total frame count. `1×1` (the "unsliced
 *  whole sheet" case, not a grid) is never offered. Capped to 8 chips so the row doesn't wrap
 *  endlessly on a highly-divisible sheet size. */
function suggestGrids(w: number, h: number): { rows: number; cols: number; frames: number }[] {
  const MAX = 8;
  const out: { rows: number; cols: number; frames: number; tileAligned: boolean }[] = [];
  for (let rows = 1; rows <= MAX; rows++) {
    if (h % rows !== 0) continue;
    const frameHeight = h / rows;
    for (let cols = 1; cols <= MAX; cols++) {
      if (rows === 1 && cols === 1) continue;
      if (w % cols !== 0) continue;
      const frameWidth = w / cols;
      out.push({
        rows,
        cols,
        frames: rows * cols,
        tileAligned: frameWidth % TILE_SIZE === 0 && frameHeight % TILE_SIZE === 0,
      });
    }
  }
  out.sort((a, b) =>
    a.tileAligned !== b.tileAligned ? (a.tileAligned ? -1 : 1) : a.frames - b.frames,
  );
  return out.slice(0, MAX).map(({ rows, cols, frames }) => ({ rows, cols, frames }));
}

/**
 * Per-asset reclassify affordance (plan 014 step 7c) — the in-editor fix for lossy filename/path
 * classification: a ⚙ trigger that opens a popover with a `type` dropdown and, for `strip`,
 * `frames`/`rows` fields with a LIVE grid overlay on the full-sheet preview (updates as you type)
 * plus `suggestGrids` chips. Committing calls `putAssetOverride` (patches `pack.json`, reruns
 * `gen_regions.py` + `assets:catalog` server-side through the dev middleware) then `onReclassified`
 * (the panel's catalog refetch) so the new classification is live immediately.
 *
 * Rendered as a SIBLING of its caller's arm-button (see `AssetCard`'s doc) via an absolutely
 * positioned wrapper — callers just drop `<AssetReclassify .../>` inside any `position:relative`
 * container and it self-anchors to the top-right corner.
 */
function AssetReclassify({
  asset,
  onReclassified,
}: {
  asset: CatalogAsset;
  onReclassified: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const relPath = asset.id.slice(asset.pack.length + 1);
  const [type, setType] = useState<CatalogAssetType>(asset.type);
  // Seed frames/rows from whatever the asset already resolved to (derived, not stored — see
  // catalog.ts's frameWidth/frameHeight doc) so re-opening the popover on an already-resolved strip
  // starts from its current grid rather than a blank 1×2 guess.
  const [frames, setFrames] = useState<number>(
    asset.frames !== undefined && asset.frames >= 2 ? asset.frames : 2,
  );
  const [rows, setRows] = useState<number>(
    asset.frameHeight ? Math.max(1, Math.round(asset.h / asset.frameHeight)) : 1,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const cols = type === 'strip' ? frames / rows : undefined;
  const frameHeight = type === 'strip' ? asset.h / rows : undefined;
  const frameWidth = cols !== undefined ? asset.w / cols : undefined;
  const gridValid =
    type !== 'strip' ||
    (cols !== undefined &&
      Number.isInteger(cols) &&
      cols >= 1 &&
      Number.isInteger(frameHeight) &&
      Number.isInteger(frameWidth));

  async function commit(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const patch: AssetOverridePatch = type === 'strip' ? { type, frames, rows } : { type };
      const result = await putAssetOverride(asset.pack, relPath, patch);
      setWarnings(result.warnings);
      await onReclassified();
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: CSSProperties = {
    width: '100%',
    background: RECLASSIFY_INPUT_BG,
    color: RECLASSIFY_TEXT,
    border: `1px solid ${RECLASSIFY_BORDER}`,
    borderRadius: 4,
    boxSizing: 'border-box',
  };

  return (
    <span
      style={{ position: 'absolute', top: 2, right: 2, zIndex: 5 }}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        role="button"
        tabIndex={0}
        title="Reclassify: force type / frame grid"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((o) => !o);
        }}
        style={{
          cursor: 'pointer',
          display: 'inline-block',
          fontSize: 11,
          lineHeight: '14px',
          color: RECLASSIFY_MUTED,
          background: RECLASSIFY_INPUT_BG,
          border: `1px solid ${RECLASSIFY_BORDER}`,
          borderRadius: 3,
          padding: '1px 4px',
        }}
      >
        ⚙
      </span>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 220,
            background: RECLASSIFY_BG,
            border: `1px solid ${RECLASSIFY_BORDER}`,
            borderRadius: 6,
            padding: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            fontSize: 11,
            color: RECLASSIFY_TEXT,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <strong>Reclassify</strong>
            <span
              role="button"
              tabIndex={0}
              onClick={() => setOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setOpen(false);
              }}
              style={{ cursor: 'pointer', color: RECLASSIFY_MUTED, padding: '0 2px' }}
            >
              ✕
            </span>
          </div>
          <div
            style={{
              color: RECLASSIFY_MUTED,
              marginBottom: 6,
              wordBreak: 'break-all',
              fontSize: 10,
            }}
          >
            {relPath} ({asset.w}×{asset.h})
          </div>

          <label style={{ display: 'block', color: RECLASSIFY_MUTED, marginBottom: 2 }}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CatalogAssetType)}
            style={{ ...inputStyle, marginBottom: 8 }}
          >
            <option value="tile">tile</option>
            <option value="strip">strip</option>
            <option value="object">object</option>
          </select>

          {type === 'strip' && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', color: RECLASSIFY_MUTED }}>Frames</label>
                  <input
                    type="number"
                    min={1}
                    value={frames}
                    onChange={(e) =>
                      setFrames(Math.max(1, Math.round(Number(e.target.value) || 1)))
                    }
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', color: RECLASSIFY_MUTED }}>Rows</label>
                  <input
                    type="number"
                    min={1}
                    value={rows}
                    onChange={(e) => setRows(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {suggestGrids(asset.w, asset.h).map((s) => (
                  <span
                    key={`${s.rows}x${s.cols}`}
                    role="button"
                    tabIndex={0}
                    title={`${asset.w / s.cols}×${asset.h / s.rows} per frame`}
                    onClick={() => {
                      setFrames(s.frames);
                      setRows(s.rows);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setFrames(s.frames);
                        setRows(s.rows);
                      }
                    }}
                    style={{
                      cursor: 'pointer',
                      fontSize: 10,
                      padding: '1px 5px',
                      background: RECLASSIFY_INPUT_BG,
                      border: `1px solid ${RECLASSIFY_BORDER}`,
                      borderRadius: 3,
                      color: RECLASSIFY_TEXT,
                    }}
                  >
                    {s.cols}×{s.rows}
                  </span>
                ))}
              </div>

              {/* Live grid overlay — recomputed every render straight from the current frames/rows
                  state, so it tracks keystrokes with no debounce. */}
              <div
                className="pixelated"
                style={{
                  position: 'relative',
                  width: Math.round(asset.w * Math.min(1, 160 / Math.max(asset.w, asset.h))),
                  height: Math.round(asset.h * Math.min(1, 160 / Math.max(asset.w, asset.h))),
                  backgroundImage: `url(${tilesetAssetUrl(
                    asset.pack,
                    asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path,
                  )})`,
                  backgroundSize: '100% 100%',
                  border: `1px solid ${RECLASSIFY_BORDER}`,
                  marginBottom: 6,
                }}
              >
                {gridValid && cols !== undefined && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      gridTemplateColumns: `repeat(${cols}, 1fr)`,
                      gridTemplateRows: `repeat(${rows}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: cols * rows }, (_, i) => (
                      <div
                        key={i}
                        style={{ border: `1px solid ${RECLASSIFY_ACCENT}`, opacity: 0.85 }}
                      />
                    ))}
                  </div>
                )}
              </div>
              {!gridValid && (
                <div style={{ color: RECLASSIFY_ERROR, marginBottom: 6 }}>
                  frames ({frames}) must be a whole multiple of rows ({rows}), and both frame
                  dimensions must divide the sheet evenly.
                </div>
              )}
            </>
          )}

          {err && <div style={{ color: RECLASSIFY_ERROR, marginBottom: 6 }}>{err}</div>}
          {warnings.length > 0 && (
            <div
              style={{
                color: RECLASSIFY_MUTED,
                marginBottom: 6,
                maxHeight: 60,
                overflowY: 'auto',
              }}
            >
              {warnings.slice(0, 4).map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={busy || (type === 'strip' && !gridValid)}
            onClick={() => void commit()}
            style={{ width: '100%' }}
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      )}
    </span>
  );
}
