import { describe, it, expect } from 'vitest';
import {
  parseMap,
  serializeMap,
  createEmptyMap,
  cellIndex,
  getCell,
  isInside,
  planResize,
  applyResize,
  MAX_MAP_DIM,
  type MapFile,
  type ResizeEdges,
} from '../mapFormat';

const NO_RESIZE: ResizeEdges = { top: 0, right: 0, bottom: 0, left: 0 };

/** A 3x3 all-inside (no shape) map: one ground layer with a distinct value at every cell (so a
 *  remap's source cell is identifiable at its destination), a blocked walkability cell, a zone
 *  cell, and one node object — enough surface to exercise every grid + the object translation. */
function makeMap(): MapFile {
  const map = createEmptyMap('resize-test', 'Resize Test', 3, 3);
  // A palette entry for every non-zero cell value the fixture uses below (1..8), so the layer
  // stays parseMap-valid — createEmptyMap only ships the reserved null slot at index 0.
  for (let i = 1; i <= 8; i++) {
    map.palette.push({ pack: 'test', source: { kind: 'image', path: `test-${i}.png` } });
  }
  // Distinct per-cell values 0..8 so a remapped cell's origin is unambiguous.
  map.layers[0].cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  map.walkability.cells = [0, 0, 0, 0, 1, 0, 0, 0, 0]; // cell (1,1) blocked
  map.zones = {
    defs: [{ id: 1, name: 'Camp', colour: '#88aa44', favourites: [] }],
    cells: [0, 0, 0, 0, 1, 0, 0, 0, 0], // cell (1,1) zoned
  };
  map.objects = [{ id: 'node_0001', kind: 'node', ref: 'tree', col: 1, row: 1 }];
  return map;
}

/** Same as `makeMap` but with an explicit shape mask (all cells inside, i.e. equivalent to an
 *  absent shape) so shape-remap behaviour can be exercised independently of void-consistency. */
function makeShapedMap(): MapFile {
  const map = makeMap();
  map.shape = { cells: [1, 1, 1, 1, 1, 1, 1, 1, 1] };
  return map;
}

describe('planResize', () => {
  it('computes newWidth/newHeight and dLeft/dTop for a pure expand', () => {
    const map = makeMap();
    const plan = planResize(map, { top: 2, right: 1, bottom: 0, left: 3 });
    expect(plan.dLeft).toBe(3);
    expect(plan.dTop).toBe(2);
    expect(plan.newWidth).toBe(3 + 3 + 1);
    expect(plan.newHeight).toBe(3 + 2 + 0);
    expect(plan.dimsValid).toBe(true);
    expect(plan.offendingObjectIds).toEqual([]);
  });

  it('computes newWidth/newHeight for a pure crop', () => {
    const map = makeMap();
    const plan = planResize(map, { top: 0, right: -1, bottom: -1, left: 0 });
    expect(plan.newWidth).toBe(2);
    expect(plan.newHeight).toBe(2);
    expect(plan.dLeft).toBe(0);
    expect(plan.dTop).toBe(0);
  });

  it('flags dimsValid=false when a dimension would be <= 0', () => {
    const map = makeMap();
    const plan = planResize(map, { top: 0, right: 0, bottom: 0, left: -3 }); // 3-3=0 width
    expect(plan.newWidth).toBe(0);
    expect(plan.dimsValid).toBe(false);
  });

  it('flags dimsValid=false when a dimension would exceed MAX_MAP_DIM', () => {
    const map = makeMap();
    const plan = planResize(map, { top: 0, right: MAX_MAP_DIM, bottom: 0, left: 0 });
    expect(plan.newWidth).toBeGreaterThan(MAX_MAP_DIM);
    expect(plan.dimsValid).toBe(false);
  });

  it('dimsValid=true at exactly MAX_MAP_DIM (inclusive upper bound)', () => {
    const map = makeMap();
    const plan = planResize(map, { top: 0, right: MAX_MAP_DIM - 3, bottom: 0, left: 0 });
    expect(plan.newWidth).toBe(MAX_MAP_DIM);
    expect(plan.dimsValid).toBe(true);
  });

  it('flags an object cropped off the left edge as offending (Apply-block)', () => {
    const map = makeMap(); // node at col=1
    const plan = planResize(map, { top: 0, right: 0, bottom: 0, left: -2 }); // shifts col by -2
    expect(plan.offendingObjectIds).toEqual(['node_0001']);
  });

  it('does not flag an object that stays in bounds after translation', () => {
    const map = makeMap();
    const plan = planResize(map, { top: 1, right: 1, bottom: 1, left: 1 });
    expect(plan.offendingObjectIds).toEqual([]);
  });

  it('a no-op resize plans no changes and no offenders', () => {
    const map = makeMap();
    const plan = planResize(map, NO_RESIZE);
    expect(plan.newWidth).toBe(3);
    expect(plan.newHeight).toBe(3);
    expect(plan.offendingObjectIds).toEqual([]);
    expect(plan.discardsNonEmpty).toBe(false);
  });

  describe('discardsNonEmpty', () => {
    it('is true when cropping removes a non-empty tile layer cell', () => {
      const map = makeMap();
      // Crop the right column (col 2) which has non-zero layer values (2,5,8).
      const plan = planResize(map, { top: 0, right: -1, bottom: 0, left: 0 });
      expect(plan.discardsNonEmpty).toBe(true);
    });

    it('is true when cropping removes a blocked walkability cell', () => {
      const map = makeMap();
      map.layers[0].cells = new Array<number>(9).fill(0); // isolate: no layer/zone content to confuse the signal
      map.zones.cells = new Array<number>(9).fill(0);
      // Blocked cell is (1,1); shrink to a 1-row map (keeping row 0 only) so row 1 is cropped away.
      const plan = planResize(map, { top: 0, right: 0, bottom: -2, left: 0 });
      expect(plan.discardsNonEmpty).toBe(true);
    });

    it('is true when cropping removes a non-zero zone cell', () => {
      const map = makeMap();
      map.layers[0].cells = new Array<number>(9).fill(0);
      map.walkability.cells = new Array<number>(9).fill(0);
      const plan = planResize(map, { top: 0, right: 0, bottom: -2, left: 0 }); // drops row (1,1)
      expect(plan.discardsNonEmpty).toBe(true);
    });

    it('is false when cropping removes only all-empty cells', () => {
      const map = makeMap();
      map.layers[0].cells = new Array<number>(9).fill(0);
      map.walkability.cells = new Array<number>(9).fill(0);
      map.zones.cells = new Array<number>(9).fill(0);
      const plan = planResize(map, { top: 0, right: -1, bottom: 0, left: 0 });
      expect(plan.discardsNonEmpty).toBe(false);
    });

    it('is false for a pure expand (nothing is cropped)', () => {
      const map = makeMap();
      const plan = planResize(map, { top: 1, right: 1, bottom: 1, left: 1 });
      expect(plan.discardsNonEmpty).toBe(false);
    });

    it('void removal does not count even if the void cell stores a blocked/zoned value', () => {
      // A dedicated, otherwise-empty 2x2 map so every OTHER cropped cell is genuinely empty and
      // the only thing under test is the void corner (1,1) with a stray walkability=1 under it
      // (parseMap would reject inconsistent layer/zone data on a void cell, but walkability is
      // deliberately unchecked there — see mapFormat's validateVoidConsistency doc).
      const map = createEmptyMap('void-crop-test', 'Void Crop Test', 2, 2);
      map.shape = { cells: [1, 1, 1, 0] }; // (1,1) is void
      map.walkability.cells[cellIndex(1, 1, 2)] = 1; // stray — should be ignored, it's void
      const plan = planResize(map, { top: 0, right: -1, bottom: -1, left: 0 }); // crops col1+row1
      expect(plan.discardsNonEmpty).toBe(false);
    });
  });
});

describe('applyResize', () => {
  it('returns a NEW MapFile and does not mutate the input', () => {
    const map = makeMap();
    const before = JSON.parse(JSON.stringify(map)) as MapFile;
    const result = applyResize(map, { top: 1, right: 1, bottom: 1, left: 1 });
    expect(result).not.toBe(map);
    expect(map).toEqual(before);
  });

  it('sets new meta.width/height', () => {
    const map = makeMap();
    const result = applyResize(map, { top: 2, right: 1, bottom: 0, left: 3 });
    expect(result.meta.width).toBe(7);
    expect(result.meta.height).toBe(5);
  });

  it('a top+left expand shifts an interior cell to the expected new index', () => {
    const map = makeMap();
    // Old cell (1,1) holds layer value 4 (see makeMap: row-major 0..8).
    const result = applyResize(map, { top: 2, right: 0, bottom: 0, left: 3 });
    // Expected new position: (1+3, 1+2) = (4,3) in a newWidth=6 grid.
    expect(getCell(result.layers[0].cells, 4, 3, result.meta.width)).toBe(4);
  });

  it('a top+left expand shifts an object to the expected new coords', () => {
    const map = makeMap(); // node at (1,1)
    const result = applyResize(map, { top: 2, right: 0, bottom: 0, left: 3 });
    const node = result.objects.find((o) => o.id === 'node_0001');
    expect(node?.kind).toBe('node');
    if (node?.kind === 'node') {
      expect(node.col).toBe(4);
      expect(node.row).toBe(3);
    }
  });

  it('fills newly-added cells with the grid default (0 for layers/zones/walkability)', () => {
    const map = makeMap();
    const result = applyResize(map, { top: 1, right: 0, bottom: 0, left: 1 });
    // New top-left corner (0,0) was not covered by the old map — must be the empty default.
    expect(getCell(result.layers[0].cells, 0, 0, result.meta.width)).toBe(0);
    expect(getCell(result.walkability.cells, 0, 0, result.meta.width)).toBe(0);
    expect(getCell(result.zones.cells, 0, 0, result.meta.width)).toBe(0);
  });

  it('throws when the plan has invalid dims', () => {
    const map = makeMap();
    expect(() => applyResize(map, { top: 0, right: 0, bottom: 0, left: -3 })).toThrow(/invalid/);
  });

  it('throws when an object would leave the new bounds', () => {
    const map = makeMap(); // node at col=1
    expect(() => applyResize(map, { top: 0, right: 0, bottom: 0, left: -2 })).toThrow(/node_0001/);
  });

  it('keeps the palette reference identity (unchanged, not cloned)', () => {
    const map = makeMap();
    const result = applyResize(map, { top: 1, right: 1, bottom: 1, left: 1 });
    expect(result.palette).toBe(map.palette);
  });

  it('keeps an absent shape absent after a translate+crop', () => {
    const map = makeMap(); // no shape (all-inside)
    expect(map.shape).toBeUndefined();
    const result = applyResize(map, { top: 1, right: -1, bottom: 0, left: 1 });
    expect(result.shape).toBeUndefined();
  });

  it('remaps a present shape, with new (expanded) cells marked inside', () => {
    const map = makeShapedMap();
    const result = applyResize(map, { top: 1, right: 0, bottom: 0, left: 1 });
    // New corner cell (0,0) is newly-added -> must default to inside (1).
    expect(getCell(result.shape!.cells, 0, 0, result.meta.width)).toBe(1);
    // The translated original corner (0,0) -> (1,1) should still be inside (1).
    expect(getCell(result.shape!.cells, 1, 1, result.meta.width)).toBe(1);
    expect(isInside(result, 0, 0)).toBe(true);
  });

  it('applyResize output re-parses cleanly (void-consistency preserved) after a no-op resize', () => {
    const map = makeMap();
    const result = applyResize(map, NO_RESIZE);
    expect(() => parseMap(JSON.parse(serializeMap(result)))).not.toThrow();
  });

  it('applyResize output re-parses cleanly after an expand', () => {
    const map = makeMap();
    const result = applyResize(map, { top: 2, right: 3, bottom: 1, left: 2 });
    const reparsed = parseMap(JSON.parse(serializeMap(result)));
    expect(reparsed).toEqual(result);
  });

  it('applyResize output re-parses cleanly after a crop that discards non-empty content', () => {
    const map = makeMap();
    const result = applyResize(map, { top: 0, right: -1, bottom: 0, left: 0 });
    expect(() => parseMap(JSON.parse(serializeMap(result)))).not.toThrow();
  });

  it('applyResize output re-parses cleanly for a shaped map after expand+crop', () => {
    const map = makeShapedMap();
    const result = applyResize(map, { top: 1, right: -1, bottom: 0, left: 1 });
    const reparsed = parseMap(JSON.parse(serializeMap(result)));
    expect(reparsed).toEqual(result);
  });
});
