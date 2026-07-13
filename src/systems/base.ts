/**
 * Pure base-zone math (see plan 014 Context & decisions). `BASE_ZONE` is a fixed rectangular
 * tile-bounds region that base-only buildables (e.g. the campfire) may be placed within. No Phaser
 * imports, no module-level mutable state — mirrors systems/daynight.ts.
 */

import { BASE_ZONE } from '../config';

/** Whether tile (col, row) falls inside BASE_ZONE, inclusive of both min and max on each axis. */
export function isInBase(col: number, row: number): boolean {
  return (
    col >= BASE_ZONE.minCol &&
    col <= BASE_ZONE.maxCol &&
    row >= BASE_ZONE.minRow &&
    row <= BASE_ZONE.maxRow
  );
}

/** BASE_ZONE's bounds as a tile rect (inclusive min/max cols+rows) — for outline rendering later. */
export function baseZoneTileRect(): {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
} {
  return { ...BASE_ZONE };
}
