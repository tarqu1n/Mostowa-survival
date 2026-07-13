import { describe, it, expect } from 'vitest';
import {
  parseWorldLayout,
  validateWorld,
  localToGlobal,
  globalToLocal,
  buildWorldIndex,
  metasFromMaps,
  parseManifest,
  generateManifest,
  type WorldLayout,
  type MapPlacement,
} from '../worldLayout';
import { createEmptyMap, parseMap, setCell, type MapFile } from '../mapFormat';

function placement(mapId: string, col: number, row: number): MapPlacement {
  return { mapId, origin: { col, row } };
}

function worldOf(...placements: MapPlacement[]): WorldLayout {
  return { schemaVersion: 1, placements };
}

describe('parseWorldLayout', () => {
  it('parses a valid layout', () => {
    const raw = { schemaVersion: 1, placements: [{ mapId: 'a', origin: { col: 0, row: 0 } }] };
    expect(parseWorldLayout(raw)).toEqual({
      schemaVersion: 1,
      placements: [{ mapId: 'a', origin: { col: 0, row: 0 } }],
    });
  });

  it('accepts signed (negative) origins', () => {
    const raw = { schemaVersion: 1, placements: [{ mapId: 'a', origin: { col: -5, row: -10 } }] };
    expect(() => parseWorldLayout(raw)).not.toThrow();
  });

  it('rejects an unsupported schemaVersion', () => {
    expect(() => parseWorldLayout({ schemaVersion: 2, placements: [] })).toThrow(/schemaVersion/);
  });

  it('rejects a placement referencing the same map twice', () => {
    const raw = {
      schemaVersion: 1,
      placements: [
        { mapId: 'a', origin: { col: 0, row: 0 } },
        { mapId: 'a', origin: { col: 5, row: 0 } },
      ],
    };
    expect(() => parseWorldLayout(raw)).toThrow(/duplicate placement/);
  });

  it('rejects malformed structure', () => {
    expect(() => parseWorldLayout(null)).toThrow();
    expect(() => parseWorldLayout({ schemaVersion: 1, placements: 'nope' })).toThrow();
    expect(() => parseWorldLayout({ schemaVersion: 1, placements: [{ mapId: 'a' }] })).toThrow();
  });
});

describe('localToGlobal / globalToLocal', () => {
  it('round-trip', () => {
    const origin = { col: 5, row: -3 };
    const global = localToGlobal(origin, 2, 4);
    expect(global).toEqual({ col: 7, row: 1 });
    expect(globalToLocal(origin, global.col, global.row)).toEqual({ col: 2, row: 4 });
  });
});

describe('validateWorld', () => {
  it('reports no errors or warnings for two cleanly edge-adjacent maps', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const mapB = createEmptyMap('test-forest', 'Test Forest', 2, 2);
    const world = worldOf(placement('test-camp', 0, 0), placement('test-forest', 2, 0));

    const result = validateWorld(world, { 'test-camp': mapA, 'test-forest': mapB });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('errors when a placement references an unknown map id', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const world = worldOf(placement('test-camp', 0, 0), placement('ghost-map', 5, 5));

    const result = validateWorld(world, { 'test-camp': mapA });

    expect(result.errors.some((e) => /unknown map "ghost-map"/.test(e))).toBe(true);
  });

  it('errors when two placed maps overlap', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const mapB = createEmptyMap('test-forest', 'Test Forest', 2, 2);
    // mapB at (1,0) overlaps mapA's column 1.
    const world = worldOf(placement('test-camp', 0, 0), placement('test-forest', 1, 0));

    const result = validateWorld(world, { 'test-camp': mapA, 'test-forest': mapB });

    expect(
      result.errors.some((e) => /overlap/.test(e) && /test-camp/.test(e) && /test-forest/.test(e)),
    ).toBe(true);
  });

  it('warns on a seam walkability mismatch between edge-adjacent maps', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const mapB = createEmptyMap('test-forest', 'Test Forest', 2, 2);
    // mapA's right edge (col1) is walkable (default). Block mapB's facing cell (col0, same row).
    setCell(mapB.walkability.cells, 0, 0, 2, 1);
    const world = worldOf(placement('test-camp', 0, 0), placement('test-forest', 2, 0));

    const result = validateWorld(world, { 'test-camp': mapA, 'test-forest': mapB });

    expect(result.warnings.some((w) => /seam walkability mismatch/.test(w))).toBe(true);
  });

  it('warns when two maps are only diagonally adjacent', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const mapC = createEmptyMap('test-corner', 'Test Corner', 2, 2);
    // mapA occupies (0,0)-(1,1); mapC occupies (2,2)-(3,3) -> they only touch at the (1,1)/(2,2) corner.
    const world = worldOf(placement('test-camp', 0, 0), placement('test-corner', 2, 2));

    const result = validateWorld(world, { 'test-camp': mapA, 'test-corner': mapC });

    expect(result.warnings.some((w) => /only diagonally adjacent/.test(w))).toBe(true);
  });

  it('warns on an island map with no neighbours', () => {
    const mapA = createEmptyMap('test-lonely', 'Test Lonely', 2, 2);
    const world = worldOf(placement('test-lonely', 0, 0));

    const result = validateWorld(world, { 'test-lonely': mapA });

    expect(result.warnings.some((w) => /island/.test(w))).toBe(true);
  });

  it('warns when a known map is missing from world.json', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const mapB = createEmptyMap('test-forest', 'Test Forest', 2, 2);
    const world = worldOf(placement('test-camp', 0, 0)); // test-forest never placed

    const result = validateWorld(world, { 'test-camp': mapA, 'test-forest': mapB });

    expect(result.warnings.some((w) => /"test-forest".*not placed/.test(w))).toBe(true);
  });
});

describe('buildWorldIndex', () => {
  it('mapAt answers bbox-level ownership from metas alone (no maps loaded)', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const mapB = createEmptyMap('test-forest', 'Test Forest', 3, 3);
    const placements = [placement('test-camp', 0, 0), placement('test-forest', 2, 0)];
    const metas = metasFromMaps({ 'test-camp': mapA, 'test-forest': mapB });

    const index = buildWorldIndex(placements, metas);

    expect(index.mapAt(0, 0)).toBe('test-camp');
    expect(index.mapAt(1, 1)).toBe('test-camp');
    expect(index.mapAt(2, 0)).toBe('test-forest');
    expect(index.mapAt(4, 2)).toBe('test-forest');
    expect(index.mapAt(10, 10)).toBeNull();
  });

  it('mapAt resolves shaped edges exactly when the map is loaded — a void cell in a bbox belongs to nobody', () => {
    const raw = {
      meta: {
        schemaVersion: 1,
        id: 'test-shaped',
        name: 'Test Shaped',
        width: 3,
        height: 3,
        tileSize: 16,
      },
      shape: { cells: [1, 1, 1, 1, 1, 1, 1, 1, 0] }, // (2,2) is void
      palette: [null],
      layers: [
        {
          id: 'ground',
          name: 'Ground',
          kind: 'tiles',
          overhead: false,
          cells: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      ],
      terrain: [],
      walkability: { cells: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
      zones: { defs: [], cells: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
      objects: [],
    };
    const map = parseMap(raw);
    const placements = [placement('test-shaped', 0, 0)];
    const metas = metasFromMaps({ 'test-shaped': map });

    const index = buildWorldIndex(placements, metas, { 'test-shaped': map });

    expect(index.mapAt(1, 1)).toBe('test-shaped');
    expect(index.mapAt(2, 2)).toBeNull(); // in bbox, but void -> unowned
  });

  it('seams derives adjacent-edge cell pairs between placed neighbours', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const mapB = createEmptyMap('test-forest', 'Test Forest', 2, 2);
    const placements = [placement('test-camp', 0, 0), placement('test-forest', 2, 0)];
    const metas = metasFromMaps({ 'test-camp': mapA, 'test-forest': mapB });

    const index = buildWorldIndex(placements, metas, { 'test-camp': mapA, 'test-forest': mapB });
    const seamPairs = index.seams('test-camp');

    expect(seamPairs.length).toBeGreaterThan(0);
    expect(seamPairs).toContainEqual({
      a: { col: 1, row: 0 },
      b: { mapId: 'test-forest', col: 0, row: 0 },
    });
  });

  it('seams returns [] when the map (or its neighbours) is not loaded', () => {
    const mapA = createEmptyMap('test-camp', 'Test Camp', 2, 2);
    const placements = [placement('test-camp', 0, 0)];
    const metas = metasFromMaps({ 'test-camp': mapA });

    expect(buildWorldIndex(placements, metas).seams('test-camp')).toEqual([]);
  });
});

describe('manifest', () => {
  it('generateManifest is deterministic regardless of input map order', () => {
    const world = worldOf(placement('zeta', 0, 0), placement('alpha', 5, 0));
    const maps: Record<string, MapFile> = {
      zeta: createEmptyMap('zeta', 'Zeta', 2, 2),
      alpha: createEmptyMap('alpha', 'Alpha', 3, 3),
    };

    const manifest = generateManifest(world, maps);

    expect(manifest).toEqual({
      schemaVersion: 1,
      placements: [
        { mapId: 'alpha', origin: { col: 5, row: 0 } },
        { mapId: 'zeta', origin: { col: 0, row: 0 } },
      ],
      maps: [
        { id: 'alpha', name: 'Alpha', width: 3, height: 3 },
        { id: 'zeta', name: 'Zeta', width: 2, height: 2 },
      ],
    });
  });

  it('parseManifest round-trips generateManifest output', () => {
    const world = worldOf(placement('test-camp', 0, 0));
    const maps: Record<string, MapFile> = {
      'test-camp': createEmptyMap('test-camp', 'Test Camp', 2, 2),
    };
    const manifest = generateManifest(world, maps);

    const reparsed = parseManifest(JSON.parse(JSON.stringify(manifest)));
    expect(reparsed).toEqual(manifest);
  });

  it('rejects an unsupported schemaVersion', () => {
    expect(() => parseManifest({ schemaVersion: 2, placements: [], maps: [] })).toThrow(
      /schemaVersion/,
    );
  });

  it('rejects duplicate map ids', () => {
    const raw = {
      schemaVersion: 1,
      placements: [],
      maps: [
        { id: 'a', name: 'A', width: 2, height: 2 },
        { id: 'a', name: 'A2', width: 3, height: 3 },
      ],
    };
    expect(() => parseManifest(raw)).toThrow(/duplicate id/);
  });
});
