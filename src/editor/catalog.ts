/**
 * Typed access to the generated asset catalog (`public/assets/asset-catalog.json`, plan 014 step 2)
 * for the editor's Library panel (step 6). A light structural narrow — not a strict `parseMap`-style
 * validator — since the catalog is machine-generated and committed (`npm run assets:catalog`), not
 * hand-authored; this just replaces `unknown` with real types for the Library UI.
 */

import type { TileSource } from '../data/tileset';

export interface CatalogPack {
  id: string;
  name: string;
  licence: string;
  tileSize: number;
}

export type CatalogAssetType = 'tile' | 'strip' | 'object';

/** One detected sprite bounding box within an `object` atlas's sheet (plan 014 step 7a). `key` is
 *  coordinate-derived (`"${x}_${y}"`, see `scripts/pixel-crawler/gen_regions.py`), stable across
 *  regens unless the sprite actually moves. */
export interface CatalogRegion {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CatalogAsset {
  /** `<pack>/<relative path>` — stable across regens. Tile-type ids never carry `#frame` (they name
   *  the whole sheet); the Library appends `#frame` itself when a specific tile frame is clicked. */
  id: string;
  pack: string;
  type: CatalogAssetType;
  source: TileSource;
  /** Sheet/image pixel size. */
  w: number;
  h: number;
  /** Frame count — present on `tile`/`strip` (sheet) assets, absent on standalone `object` images. */
  frames?: number;
  /** Explicit per-frame cell size for a `strip` asset (Phaser `load.spritesheet` shape) —
   *  `frameHeight = h` (a strip is one horizontal row), `frameWidth = w / frames`. Never a
   *  square/smaller-dim guess (see `src/data/tileset.ts` `StripAnim` doc and
   *  `scripts/asset-catalog.mjs`'s `stripFrameDims`). Absent on `tile`/`object` assets. */
  frameWidth?: number;
  frameHeight?: number;
  /** Present on `object` assets detected as multi-sprite atlases (>=2 regions merged from
   *  `<pack>/regions.json`) — see `scripts/pixel-crawler/gen_regions.py`. Absent ⇒ a plain
   *  single-sprite object (place the whole image), including every `object` asset with 0 or 1
   *  detected region. */
  regions?: CatalogRegion[];
  category: string;
  tags: string[];
}

export interface AssetCatalog {
  packs: CatalogPack[];
  assets: CatalogAsset[];
}

/** Narrow an unknown JSON value fetched from `asset-catalog.json` into `AssetCatalog`. Throws with a
 *  short message on an unrecognisable shape (a regen that broke the generator, wrong file, etc). */
export function parseCatalog(json: unknown): AssetCatalog {
  if (typeof json !== 'object' || json === null) {
    throw new Error('asset-catalog.json: expected an object');
  }
  const root = json as { packs?: unknown; assets?: unknown };
  if (!Array.isArray(root.packs) || !Array.isArray(root.assets)) {
    throw new Error('asset-catalog.json: expected { packs: [...], assets: [...] }');
  }
  return { packs: root.packs as CatalogPack[], assets: root.assets as CatalogAsset[] };
}

/** Column count of a tile asset's sheet at `tileSize` px per cell — derived from the catalog's own
 *  `w`, never hardcoded (different sheets use different column counts). */
export function catalogTileCols(asset: CatalogAsset, tileSize: number): number {
  return Math.max(1, Math.floor(asset.w / tileSize));
}
