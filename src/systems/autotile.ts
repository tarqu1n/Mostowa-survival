/**
 * Pure TS port of the 8-neighbour "blob" autotiler in `scripts/pixel-crawler/autotile.py`
 * (`blob_key` + `paint_mask`) — the baking engine a future terrain brush (plan 014 step 10) calls
 * to rebake a painted terrain mask into real tile-layer frames. No Phaser imports. The Python file
 * stays untouched and keeps serving the offline extraction pipeline — this is a port, not a shared
 * implementation, so re-verify against the Python if that logic ever changes.
 *
 * Blob classification: a filled mask cell's visible edge/corner shape is read off its 8
 * neighbours. A diagonal neighbour only counts as a filled corner if BOTH adjacent cardinals are
 * also filled (Python's `ca`/`cb`/`cc`/`cd` corner-suppression) — this stops a lone diagonal
 * neighbour, with no connecting cardinal, from being misread as a rounded corner. Out-of-bounds
 * neighbours read as unfilled (0), matching Python's `m()` bounds guard in `paint_mask`.
 */

import type { Dims } from './pathfind';

// Re-exported so consumers of this module don't need a second import from `pathfind` just for the
// grid-extent shape — {cols, rows} is a generic "grid extent", not pathfinding-specific.
export type { Dims };

/** A painted terrain mask: 0/1 per cell, row-major (`row * dims.cols + col`), serializable as-is. */
export type Mask = ReadonlyArray<0 | 1>;

/**
 * blobKey -> baked tile frame index. Serializable (`Record`, not `Map`) — this is the shape
 * terrain data (a future pack.json/terrains.json) will carry, keyed by the packed key
 * {@link blobKey} returns.
 */
export type TerrainMapping = Readonly<Record<number, number>>;

/** A mask cell's resolved tile frame after painting. */
export interface PaintedCell {
  readonly col: number;
  readonly row: number;
  readonly frame: number;
}

// Neighbour bit weights making up a blob key — MSB->LSB: N,E,S,W,NE,SE,SW,NW.
const N = 1 << 7;
const E = 1 << 6;
const S = 1 << 5;
const W = 1 << 4;
const NE = 1 << 3;
const SE = 1 << 2;
const SW = 1 << 1;
const NW = 1 << 0;

/** The 4 cardinal bits, isolated — used for the cardinal-only fallback in {@link paintMask}. */
const CARDINAL_MASK = N | E | S | W;

/** The fully-surrounded interior-fill key (all 8 neighbours set) — mirrors Python's `FULL`. */
export const FULL_KEY = N | E | S | W | NE | SE | SW | NW; // 0xff

function isSet(mask: Mask, dims: Dims, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= dims.cols || row >= dims.rows) return false;
  return mask[row * dims.cols + col] === 1;
}

/**
 * The 8-bit blob key for `(col,row)`, packing N,E,S,W,NE,SE,SW,NW (MSB->LSB) as 0/1 bits — an
 * exact port of `autotile.py`'s `blob_key`, called the same way `paint_mask` calls it (cardinals
 * from the 4 orthogonal neighbours, each diagonal suppressed unless its two adjacent cardinals AND
 * the diagonal cell itself are all set). Doesn't require `(col,row)` itself to be set — like the
 * Python, it's a pure geometric read of the 8 neighbours.
 */
export function blobKey(mask: Mask, dims: Dims, col: number, row: number): number {
  const n = isSet(mask, dims, col, row - 1);
  const s = isSet(mask, dims, col, row + 1);
  const w = isSet(mask, dims, col - 1, row);
  const e = isSet(mask, dims, col + 1, row);
  const nw = isSet(mask, dims, col - 1, row - 1);
  const ne = isSet(mask, dims, col + 1, row - 1);
  const sw = isSet(mask, dims, col - 1, row + 1);
  const se = isSet(mask, dims, col + 1, row + 1);

  let key = 0;
  if (n) key |= N;
  if (e) key |= E;
  if (s) key |= S;
  if (w) key |= W;
  if (n && e && ne) key |= NE;
  if (s && e && se) key |= SE;
  if (s && w && sw) key |= SW;
  if (n && w && nw) key |= NW;
  return key;
}

/**
 * Resolve a blob key to a tile frame, with Python `pick()`'s graceful-fallback tiers: an exact key
 * match; else the lowest-keyed entry sharing the same cardinals (ignore diagonals — Python instead
 * picks *randomly* among such entries for variety, but a `terrainMapping` holds one canonical frame
 * per key, so there's nothing to vary — determinism replaces the RNG here); else the
 * fully-surrounded fill, if the mapping declares one. Returns `undefined` if none of the three
 * apply (an incomplete mapping) — the caller decides whether that's fatal.
 */
function pickFrame(terrainMapping: TerrainMapping, key: number): number | undefined {
  if (key in terrainMapping) return terrainMapping[key];
  const cardinals = key & CARDINAL_MASK;
  const fallbackKey = Object.keys(terrainMapping)
    .map(Number)
    .find((k) => (k & CARDINAL_MASK) === cardinals);
  if (fallbackKey !== undefined) return terrainMapping[fallbackKey];
  return terrainMapping[FULL_KEY];
}

/**
 * Bake every painted cell of `mask` to a tile frame via `terrainMapping`, matching Python's
 * `paint_mask` cell loop (unpainted cells produce no entry). Cells whose key resolves to no frame
 * (see {@link pickFrame}) are omitted rather than assigned a frame — an incomplete `terrainMapping`
 * shows up as missing cells, not a wrong tile.
 */
export function paintMask(mask: Mask, dims: Dims, terrainMapping: TerrainMapping): PaintedCell[] {
  const cells: PaintedCell[] = [];
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      if (mask[row * dims.cols + col] !== 1) continue;
      const key = blobKey(mask, dims, col, row);
      const frame = pickFrame(terrainMapping, key);
      if (frame !== undefined) cells.push({ col, row, frame });
    }
  }
  return cells;
}
