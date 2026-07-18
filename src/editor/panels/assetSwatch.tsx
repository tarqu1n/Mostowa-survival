import { TILE_SIZE } from '../../config';
import type { ParsedNodeDef } from '../../systems/nodeDefs';
import { parseAssetId, tilesetAssetUrl } from '../textureLoading';
import { colorToHex, resolveSkinPreviewUrl } from '../nodeTypesUi';
import type { TerrainCatalog } from '../terrainCatalog';
import { catalogTileCols, type AssetCatalog } from '../catalog';
import type { RecentEntry } from '../libraryViewStore';

/**
 * Shared asset-swatch renderer (extracted from `LibraryPanel.tsx`, plan 033 step 3). The one place the
 * per-kind preview crop math lives, so the Library (Recent strip / Favourites) and the tile-palette
 * strip draw pixel-identical swatches from a single source of truth — the plan's "reuse, don't
 * reimplement frame rendering" decision. Kept in a non-panel module: `resolveRecentSwatch`/
 * `nodePreviewUrl` are pure helpers and `AssetSwatch` is a leaf component, so panels can import them
 * without pulling in `LibraryPanel`'s whole module (and without adding a stray non-component export to
 * a panel file, which would break its Fast Refresh — see `nodePreviewUrl`'s doc).
 */

/** Fallback sheet column count for a terrain preview crop when the asset catalog hasn't resolved a
 *  matching entry yet (a load-order race, not a normal steady state) — Floors/Wall sheets are 25 cols
 *  @ TILE_SIZE (see `src/data/tileset.ts`'s module doc). */
export const TERRAIN_SHEET_COLS_FALLBACK = 25;

/** Size-independent description of how to draw a library pick's preview (plan 030 step 4).
 *  `resolveRecentSwatch` produces one of these; `AssetSwatch` turns it into a sized `<span>`. Keeping
 *  it size-free means the same descriptor renders at any swatch size (strip vs favourites grid). */
export type RecentSwatch =
  | { mode: 'crop'; url: string; col: number; row: number; cols: number; rows: number }
  | {
      mode: 'region';
      url: string;
      x: number;
      y: number;
      w: number;
      h: number;
      sheetW: number;
      sheetH: number;
    }
  | { mode: 'contain'; url: string }
  | { mode: 'color'; color: string };

/** Empty node-def map for `resolveRecentSwatch` call sites that can't produce a `node` entry (e.g.
 *  `FavouriteItem`, whose favourites are always catalog asset ids; the palette strip, whose slots are
 *  always tiles) — a module const so it isn't reallocated per render. */
export const EMPTY_NODE_DEFS: Record<string, ParsedNodeDef> = {};

/**
 * Resolve a `RecentEntry` (or any pick describable as one) to a size-free `RecentSwatch`, or `null`
 * when its asset no longer exists in the catalog (pack removed/regenerated, a node/terrain deleted) —
 * the one place the 6-kind preview crop math lives, reused by the Recent strip, `FavouriteItem`
 * (critique #3), and the tile-palette strip (plan 033). Mirrors the per-kind card math: tiles/terrains
 * crop a frame out of their sheet, a decor region crops its sub-rect, a decor anim shows frame 0, plain
 * decor/node show the whole image, and a node with no resolvable sprite falls back to its `color`
 * swatch (see `nodePreviewUrl`).
 */
export function resolveRecentSwatch(
  entry: RecentEntry,
  catalog: AssetCatalog,
  nodeDefsParsed: Record<string, ParsedNodeDef>,
  terrainCatalog: TerrainCatalog | null,
): RecentSwatch | null {
  switch (entry.kind) {
    case 'tile': {
      let parsed: ReturnType<typeof parseAssetId>;
      try {
        parsed = parseAssetId(entry.assetId);
      } catch {
        return null;
      }
      const asset = catalog.assets.find((a) => a.id === `${parsed.pack}/${parsed.path}`);
      if (!asset || parsed.frame === undefined) return null;
      const cols = catalogTileCols(asset, TILE_SIZE);
      const rows = Math.max(1, Math.round(asset.h / TILE_SIZE));
      const sheetPath = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
      return {
        mode: 'crop',
        url: tilesetAssetUrl(asset.pack, sheetPath),
        col: parsed.frame % cols,
        row: Math.floor(parsed.frame / cols),
        cols,
        rows,
      };
    }
    case 'decor': {
      const asset = catalog.assets.find((a) => a.id === entry.assetId);
      if (!asset) return null;
      const sheetPath = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
      const url = tilesetAssetUrl(asset.pack, sheetPath);
      if (entry.region) {
        return {
          mode: 'region',
          url,
          x: entry.region.x,
          y: entry.region.y,
          w: entry.region.w,
          h: entry.region.h,
          sheetW: asset.w,
          sheetH: asset.h,
        };
      }
      if (entry.anim) {
        // Show the first frame (cell 0) — the region-crop path fits it to the swatch, matching
        // `AnimatedStripPicker`'s static fallback rather than trying to animate in the strip.
        return {
          mode: 'region',
          url,
          x: 0,
          y: 0,
          w: entry.anim.frameWidth,
          h: entry.anim.frameHeight,
          sheetW: asset.w,
          sheetH: asset.h,
        };
      }
      return { mode: 'contain', url };
    }
    case 'node': {
      const def = nodeDefsParsed[entry.ref];
      if (!def) return null;
      const url = nodePreviewUrl(def);
      return url ? { mode: 'contain', url } : { mode: 'color', color: colorToHex(def.color) };
    }
    case 'terrain': {
      if (!terrainCatalog) return null;
      const def = terrainCatalog.terrains.find((t) => t.id === entry.id);
      if (!def) return null;
      const sheetAsset = catalog.assets.find(
        (a) =>
          a.pack === def.pack && a.source.kind === 'sheetFrame' && a.source.sheet === def.sheet,
      );
      const cols = sheetAsset
        ? catalogTileCols(sheetAsset, TILE_SIZE)
        : TERRAIN_SHEET_COLS_FALLBACK;
      const rows = sheetAsset ? Math.max(1, Math.round(sheetAsset.h / TILE_SIZE)) : cols;
      return {
        mode: 'crop',
        url: tilesetAssetUrl(def.pack, def.sheet),
        col: def.fillFrame % cols,
        row: Math.floor(def.fillFrame / cols),
        cols,
        rows,
      };
    }
  }
}

/** A node's preview image URL — its default (first) skin's catalog sprite (plan 021 step 6), which
 *  matches how it renders in-game/in-editor. A skin with a `region` crop would show its whole source
 *  sheet here rather than the single cropped frame — an acceptable simplification since the palette
 *  only needs *a* preview (the `_derived` node sprites are single-sprite images with no region).
 *  Delegates the actual (never-throwing) resolve to `resolveSkinPreviewUrl` (`nodeTypesUi.ts`) rather
 *  than inlining `parseAssetId` here — see that function's doc for why: it returns `null` for a skin
 *  whose `asset` isn't resolvable (most notably the Node Types panel's `PLACEHOLDER_SKIN_ASSET`, which
 *  every freshly-created def starts with), and keeping the resolver in a non-component module lets it
 *  be unit-tested without giving a component file a stray non-component export (which would break Vite
 *  Fast Refresh for it). */
export function nodePreviewUrl(def: ParsedNodeDef): string | null {
  return resolveSkinPreviewUrl(def.skins[0].asset);
}

/** Renders a resolved `RecentSwatch` as a sized pixel-art `<span>` (plan 030 step 4) — no label, no
 *  heart, no button (callers wrap it). `crop`/`contain`/`color` fill a `sizePx` square; `region` scales
 *  its sub-rect to fit within `sizePx` (so a non-square region keeps its aspect, ≤ the box). */
export function AssetSwatch({ swatch, sizePx }: { swatch: RecentSwatch; sizePx: number }) {
  if (swatch.mode === 'color') {
    return (
      <span
        className="pixelated flex items-center justify-center rounded-[2px] text-[0.6rem] font-semibold text-fg-dim"
        style={{ width: sizePx, height: sizePx, backgroundColor: swatch.color }}
        title="No sprite assigned yet — set one in the Node Types panel"
      >
        ?
      </span>
    );
  }
  if (swatch.mode === 'contain') {
    return (
      <span
        className="pixelated rounded-[2px] bg-inset bg-contain bg-center bg-no-repeat"
        style={{ width: sizePx, height: sizePx, backgroundImage: `url(${swatch.url})` }}
      />
    );
  }
  if (swatch.mode === 'crop') {
    // Per-frame sprite crop — computed background props stay inline (mirrors `TileFrameGrid`).
    return (
      <span
        className="pixelated block rounded-[2px] bg-inset"
        style={{
          width: sizePx,
          height: sizePx,
          backgroundImage: `url(${swatch.url})`,
          backgroundPosition: `-${swatch.col * sizePx}px -${swatch.row * sizePx}px`,
          backgroundSize: `${swatch.cols * sizePx}px ${swatch.rows * sizePx}px`,
        }}
      />
    );
  }
  // region — scale the sub-rect so its larger side fills the box, keeping aspect ratio.
  const scale = sizePx / Math.max(swatch.w, swatch.h);
  return (
    <span
      className="pixelated block rounded-[2px] bg-inset bg-no-repeat"
      style={{
        width: Math.round(swatch.w * scale),
        height: Math.round(swatch.h * scale),
        backgroundImage: `url(${swatch.url})`,
        backgroundSize: `${Math.round(swatch.sheetW * scale)}px ${Math.round(swatch.sheetH * scale)}px`,
        backgroundPosition: `-${Math.round(swatch.x * scale)}px -${Math.round(swatch.y * scale)}px`,
      }}
    />
  );
}
