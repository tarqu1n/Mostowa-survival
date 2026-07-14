import { describe, it, expect } from 'vitest';
import type { CatalogAsset } from '../catalog';
import {
  assetRelPath,
  reclassifyGrid,
  reclassifyPatch,
  seedFrames,
  seedRows,
  suggestGrids,
} from '../reclassify';

/** A minimal `CatalogAsset` for the grid math (only `id`/`pack`/`type`/`w`/`h`/`frames`/`frameHeight`
 *  are read by the helpers under test). */
function asset(over: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id: 'pack/Furniture/furnace.png',
    pack: 'pack',
    type: 'object',
    source: { kind: 'image', path: 'Furniture/furnace.png' },
    w: 64,
    h: 64,
    category: 'misc',
    tags: [],
    ...over,
  };
}

describe('suggestGrids', () => {
  it('offers real grids for a square sheet and never 1×1', () => {
    const grids = suggestGrids(64, 64);
    expect(grids.every((g) => !(g.rows === 1 && g.cols === 1))).toBe(true);
    // The tile-aligned 2×2 (32×32 per frame, a whole TILE_SIZE multiple) should be present and sorted
    // ahead of a non-tile-aligned grid.
    expect(grids).toContainEqual({ rows: 2, cols: 2, frames: 4 });
  });

  it('only offers grids that divide the sheet evenly', () => {
    const grids = suggestGrids(48, 16);
    for (const g of grids) {
      expect(48 % g.cols).toBe(0);
      expect(16 % g.rows).toBe(0);
    }
  });
});

describe('reclassifyGrid', () => {
  it('lays a 2×2 sheet out as rows=2/cols=2 (the plan 017 fix, not a single row)', () => {
    const g = reclassifyGrid(asset(), 'strip', 4, 2);
    expect(g).toEqual({ cols: 2, frameWidth: 32, frameHeight: 32, valid: true });
  });

  it('handles a classic single-row strip', () => {
    const g = reclassifyGrid(asset({ w: 96, h: 16 }), 'strip', 6, 1);
    expect(g).toEqual({ cols: 6, frameWidth: 16, frameHeight: 16, valid: true });
  });

  it('flags an invalid grid when frames is not a whole multiple of rows', () => {
    expect(reclassifyGrid(asset(), 'strip', 5, 2).valid).toBe(false);
  });

  it('flags an invalid grid when a frame dimension does not divide the sheet', () => {
    // 64/3 cols is non-integer.
    expect(reclassifyGrid(asset(), 'strip', 3, 1).valid).toBe(false);
  });

  it('has no grid and is always valid for non-strip types', () => {
    expect(reclassifyGrid(asset(), 'object', 4, 2)).toEqual({
      cols: undefined,
      frameWidth: undefined,
      frameHeight: undefined,
      valid: true,
    });
  });
});

describe('seedFrames / seedRows', () => {
  it('seeds frames from a resolved strip, else 2', () => {
    expect(seedFrames(asset({ frames: 6 }))).toBe(6);
    expect(seedFrames(asset({ frames: 1 }))).toBe(2);
    expect(seedFrames(asset())).toBe(2);
  });

  it('recovers rows from the resolved frameHeight (rows = h / frameHeight)', () => {
    expect(seedRows(asset({ h: 64, frameHeight: 32 }))).toBe(2);
    expect(seedRows(asset({ h: 64 }))).toBe(1);
  });
});

describe('patch + relPath plumbing', () => {
  it('carries the frame grid for a strip and just the type otherwise', () => {
    expect(reclassifyPatch('strip', 4, 2)).toEqual({ type: 'strip', frames: 4, rows: 2 });
    expect(reclassifyPatch('object', 4, 2)).toEqual({ type: 'object' });
  });

  it('strips the pack prefix to form the pack.json override key', () => {
    expect(assetRelPath(asset())).toBe('Furniture/furnace.png');
  });
});
