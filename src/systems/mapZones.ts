/**
 * Pure map-side zone read path (plan 014 step 11 leftover — the runtime consumption seam for
 * authored `zones`). Zones are named regions painted into `Zones.cells` (uint8 ids, `0` = none);
 * this is the runtime "what zone is this tile" query that gameplay/quests will read later. Nothing
 * consumes it yet — it proves the data path exists and is tested. Phaser-free, no side effects.
 */

import { getCell, isInside, type MapFile, type ZoneDef } from './mapFormat';

/** The zone id at map-local `(col,row)`, or `0` (no zone) when outside the map (bounds or void).
 *  Void cells always carry `0` per the `parseMap` void-consistency invariant, so the `isInside`
 *  guard is belt-and-braces against out-of-bounds indexing. */
export function zoneAt(map: MapFile, col: number, row: number): number {
  if (!isInside(map, col, row)) return 0;
  return getCell(map.zones.cells, col, row, map.meta.width);
}

/** The `ZoneDef` at map-local `(col,row)`, or `null` when the tile is in no zone. */
export function zoneDefAt(map: MapFile, col: number, row: number): ZoneDef | null {
  const id = zoneAt(map, col, row);
  if (id === 0) return null;
  return map.zones.defs.find((d) => d.id === id) ?? null;
}
