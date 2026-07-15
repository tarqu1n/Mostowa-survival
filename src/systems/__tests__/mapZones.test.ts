import { describe, it, expect } from 'vitest';
import { createEmptyMap, setCell, type MapFile, type ZoneDef } from '../mapFormat';
import { zoneAt, zoneDefAt } from '../mapZones';

/** A 4×3 map with one zone (id 1, "Camp") painted over cells (1,0) and (2,1). */
function mapWithZone(): { map: MapFile; camp: ZoneDef } {
  const map = createEmptyMap('t', 'Test', 4, 3);
  const camp: ZoneDef = { id: 1, name: 'Camp', colour: '#88aa44', favourites: [] };
  map.zones.defs.push(camp);
  setCell(map.zones.cells, 1, 0, map.meta.width, 1);
  setCell(map.zones.cells, 2, 1, map.meta.width, 1);
  return { map, camp };
}

describe('zoneAt', () => {
  it('returns the painted zone id at a tile', () => {
    const { map } = mapWithZone();
    expect(zoneAt(map, 1, 0)).toBe(1);
    expect(zoneAt(map, 2, 1)).toBe(1);
  });

  it('returns 0 for an unpainted (no-zone) tile', () => {
    const { map } = mapWithZone();
    expect(zoneAt(map, 0, 0)).toBe(0);
    expect(zoneAt(map, 3, 2)).toBe(0);
  });

  it('returns 0 for out-of-bounds coords', () => {
    const { map } = mapWithZone();
    expect(zoneAt(map, -1, 0)).toBe(0);
    expect(zoneAt(map, 4, 0)).toBe(0);
    expect(zoneAt(map, 0, 3)).toBe(0);
  });

  it('returns 0 for a void cell (outside the shape mask)', () => {
    const { map } = mapWithZone();
    // Carve (0,0) to void; void-consistency keeps its zone id at 0, and the isInside guard
    // returns 0 regardless.
    map.shape = { cells: new Array(map.meta.width * map.meta.height).fill(1) as number[] };
    setCell(map.shape.cells, 0, 0, map.meta.width, 0);
    expect(zoneAt(map, 0, 0)).toBe(0);
  });
});

describe('zoneDefAt', () => {
  it('resolves the ZoneDef for a painted tile', () => {
    const { map, camp } = mapWithZone();
    expect(zoneDefAt(map, 1, 0)).toEqual(camp);
  });

  it('returns null for a no-zone tile', () => {
    const { map } = mapWithZone();
    expect(zoneDefAt(map, 0, 0)).toBeNull();
  });

  it('returns null when the painted id has no matching def (defensive)', () => {
    const { map } = mapWithZone();
    setCell(map.zones.cells, 0, 0, map.meta.width, 9); // no def with id 9
    expect(zoneDefAt(map, 0, 0)).toBeNull();
  });
});
