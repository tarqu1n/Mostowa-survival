/**
 * Pure tile-grid coordinate helpers. Used to snap world pixels to grid and key occupancy sets.
 */

import { TILE_SIZE } from '../config';

/** Convert pixel coordinate to tile index. */
export function worldToTile(px: number): number {
  return Math.floor(px / TILE_SIZE);
}

/** Convert tile index to world pixel at tile centre. */
export function tileToWorldCenter(tile: number): number {
  return tile * TILE_SIZE + TILE_SIZE / 2;
}

/** Snap pixel coordinate to nearest tile centre. */
export function snapToTileCenter(px: number): number {
  return tileToWorldCenter(worldToTile(px));
}

/** Stringify tile (col, row) as a map key. */
export function tileKey(col: number, row: number): string {
  return `${col},${row}`;
}
