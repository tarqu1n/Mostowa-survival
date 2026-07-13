import { describe, it, expect } from 'vitest';
import {
  blobKey,
  paintMask,
  FULL_KEY,
  type Mask,
  type Dims,
  type TerrainMapping,
} from '../autotile';

// Expected key values below were cross-checked against the real `blob_key` in
// scripts/pixel-crawler/autotile.py (via a one-off script driving its exact `paint_mask`
// neighbour-lookup call: blob_key(N, S, W, E, ca=NW, cb=NE, cc=SW, cd=SE)), converting its
// (N,E,S,W,ne,se,sw,nw) tuple to the same MSB->LSB bit packing this module uses. Every value here
// is the Python's actual output, not a re-derivation.

describe('blobKey', () => {
  it('single isolated cell -> key 0 (no neighbours at all)', () => {
    const dims: Dims = { cols: 3, rows: 3 };
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ];
    expect(blobKey(mask, dims, 1, 1)).toBe(0);
  });

  it('2x2 block -> each cell keys as an outer corner (Python: 100, 50, 200, 145)', () => {
    const dims: Dims = { cols: 4, rows: 4 };
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0, 0,
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0,
    ];
    expect(blobKey(mask, dims, 1, 1)).toBe(100); // NW corner of the block: E+S+SE
    expect(blobKey(mask, dims, 2, 1)).toBe(50); // NE corner of the block: S+W+SW
    expect(blobKey(mask, dims, 1, 2)).toBe(200); // SW corner of the block: N+E+NE
    expect(blobKey(mask, dims, 2, 2)).toBe(145); // SE corner of the block: N+W+NW
  });

  it('straight edge (a single painted row) -> interior 80, ends 64/16', () => {
    const dims: Dims = { cols: 5, rows: 3 };
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0, 0, 0,
      1, 1, 1, 1, 1,
      0, 0, 0, 0, 0,
    ];
    expect(blobKey(mask, dims, 0, 1)).toBe(64); // left end: E only (W is out-of-bounds -> 0)
    expect(blobKey(mask, dims, 1, 1)).toBe(80); // interior: E+W, no diagonals (N/S both empty)
    expect(blobKey(mask, dims, 2, 1)).toBe(80);
    expect(blobKey(mask, dims, 3, 1)).toBe(80);
    expect(blobKey(mask, dims, 4, 1)).toBe(16); // right end: W only (E is out-of-bounds -> 0)
  });

  it('inner corner (3x3 filled minus NW) -> corner-suppression drops just the NW bit (254)', () => {
    const dims: Dims = { cols: 3, rows: 3 };
    // prettier-ignore
    const mask: Mask = [
      0, 1, 1,
      1, 1, 1,
      1, 1, 1,
    ];
    // All 4 cardinals connect (N,E,S,W all set) but the NW diagonal cell itself is empty, so the
    // NW corner bit is suppressed even though both its adjacent cardinals (N,W) are set.
    expect(blobKey(mask, dims, 1, 1)).toBe(254);
  });

  it('plus shape -> centre keys as all-cardinals/no-diagonals (240); arms key as one cardinal', () => {
    const dims: Dims = { cols: 3, rows: 3 };
    // prettier-ignore
    const mask: Mask = [
      0, 1, 0,
      1, 1, 1,
      0, 1, 0,
    ];
    // Centre: all 4 cardinals set, but every diagonal mask cell is empty -> all corner bits 0.
    expect(blobKey(mask, dims, 1, 1)).toBe(240);
    expect(blobKey(mask, dims, 1, 0)).toBe(32); // north arm: only S (the centre) connects
    expect(blobKey(mask, dims, 1, 2)).toBe(128); // south arm: only N connects
    expect(blobKey(mask, dims, 0, 1)).toBe(64); // west arm: only E connects
    expect(blobKey(mask, dims, 2, 1)).toBe(16); // east arm: only W connects
  });

  it('fully-surrounded interior cell -> FULL_KEY (255)', () => {
    const dims: Dims = { cols: 3, rows: 3 };
    // prettier-ignore
    const mask: Mask = [
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
    ];
    expect(blobKey(mask, dims, 1, 1)).toBe(255);
    expect(FULL_KEY).toBe(255);
  });
});

describe('paintMask', () => {
  it('bakes every painted cell to its exact-match frame and skips unpainted cells', () => {
    const dims: Dims = { cols: 3, rows: 3 };
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ];
    const terrainMapping: TerrainMapping = { 0: 10 };
    expect(paintMask(mask, dims, terrainMapping)).toEqual([{ col: 1, row: 1, frame: 10 }]);
  });

  it('bakes a 2x2 block using each cell’s own corner key', () => {
    const dims: Dims = { cols: 4, rows: 4 };
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0, 0,
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0,
    ];
    const terrainMapping: TerrainMapping = { 100: 1, 50: 2, 200: 3, 145: 4 };
    expect(paintMask(mask, dims, terrainMapping)).toEqual([
      { col: 1, row: 1, frame: 1 },
      { col: 2, row: 1, frame: 2 },
      { col: 1, row: 2, frame: 3 },
      { col: 2, row: 2, frame: 4 },
    ]);
  });

  it('falls back to a same-cardinal entry when the exact key is missing from the mapping', () => {
    const dims: Dims = { cols: 5, rows: 3 };
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0, 0, 0,
      1, 1, 1, 1, 1,
      0, 0, 0, 0, 0,
    ];
    // Interior straight-edge cells key as 80 (E+W). No entry for 80, but 88 (E+W+NE=80+8) shares
    // the same cardinal bits (80 & 0xf0 === 88 & 0xf0), so it's the cardinal-only fallback.
    const terrainMapping: TerrainMapping = { 88: 42 };
    const result = paintMask(mask, dims, terrainMapping);
    const interior = result.find((c) => c.col === 2 && c.row === 1);
    expect(interior?.frame).toBe(42);
  });

  it('falls back to FULL_KEY as a last resort when nothing else matches', () => {
    const dims: Dims = { cols: 3, rows: 3 };
    // prettier-ignore
    const mask: Mask = [
      0, 1, 0,
      0, 1, 0,
      0, 0, 0,
    ];
    // (1,0) keys as 32 (S only, see the plus-shape test); no exact/cardinal match, but FULL_KEY is
    // declared, so it's the last-resort pick.
    const terrainMapping: TerrainMapping = { [FULL_KEY]: 99 };
    const result = paintMask(mask, dims, terrainMapping);
    expect(result.find((c) => c.col === 1 && c.row === 0)?.frame).toBe(99);
  });

  it('omits a cell entirely when no tier of the mapping resolves it', () => {
    const dims: Dims = { cols: 1, rows: 1 };
    const mask: Mask = [1];
    const terrainMapping: TerrainMapping = {}; // empty: no exact/cardinal/FULL entry
    expect(paintMask(mask, dims, terrainMapping)).toEqual([]);
  });
});
