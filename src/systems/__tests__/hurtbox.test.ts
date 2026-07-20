import { describe, it, expect } from 'vitest';
import { hurtboxContains, hurtboxTiles, attackTiles, DEFAULT_HURTBOX } from '../hurtbox';
import type { AttackShape } from '../../data/types';
import type { Cell } from '../pathfind';

const at = (col: number, row: number): Cell => ({ col, row });

/** Order-insensitive comparison of tile sets. */
const sameTiles = (actual: Cell[], expected: Cell[]): void => {
  const key = (c: Cell): string => `${c.col},${c.row}`;
  expect([...actual].map(key).sort()).toEqual([...expected].map(key).sort());
};

describe('hurtboxContains', () => {
  const feet = at(10, 10);

  it('a 1x1 box covers only the feet tile', () => {
    expect(hurtboxContains(feet, DEFAULT_HURTBOX, at(10, 10))).toBe(true);
    expect(hurtboxContains(feet, DEFAULT_HURTBOX, at(10, 9))).toBe(false); // one up
    expect(hurtboxContains(feet, DEFAULT_HURTBOX, at(11, 10))).toBe(false); // one right
  });

  it('a 1x2 box adds the tile directly above (the drawn torso), not below', () => {
    const box = { width: 1, height: 2 };
    expect(hurtboxContains(feet, box, at(10, 10))).toBe(true); // feet
    expect(hurtboxContains(feet, box, at(10, 9))).toBe(true); // torso (up)
    expect(hurtboxContains(feet, box, at(10, 8))).toBe(false); // two up — beyond height
    expect(hurtboxContains(feet, box, at(10, 11))).toBe(false); // below feet — never
    expect(hurtboxContains(feet, box, at(11, 9))).toBe(false); // torso but off-column
  });

  it('an odd width is centred on the feet column', () => {
    const box = { width: 3, height: 1 };
    expect(hurtboxContains(feet, box, at(9, 10))).toBe(true);
    expect(hurtboxContains(feet, box, at(10, 10))).toBe(true);
    expect(hurtboxContains(feet, box, at(11, 10))).toBe(true);
    expect(hurtboxContains(feet, box, at(12, 10))).toBe(false);
    expect(hurtboxContains(feet, box, at(8, 10))).toBe(false);
  });

  it('an even width extends one further right of centre', () => {
    const box = { width: 2, height: 1 };
    expect(hurtboxContains(feet, box, at(10, 10))).toBe(true); // feet column
    expect(hurtboxContains(feet, box, at(11, 10))).toBe(true); // extends right
    expect(hurtboxContains(feet, box, at(9, 10))).toBe(false); // not left
  });

  it('a large 2x3 box covers footprint plus body upward', () => {
    const box = { width: 2, height: 3 };
    const covered = hurtboxTiles(feet, box);
    for (const t of covered) expect(hurtboxContains(feet, box, t)).toBe(true);
    expect(hurtboxContains(feet, box, at(10, 7))).toBe(false); // three up — beyond height
  });
});

describe('hurtboxTiles', () => {
  it('enumerates exactly width*height tiles rising up from the feet', () => {
    const tiles = hurtboxTiles(at(5, 5), { width: 1, height: 2 });
    expect(tiles).toHaveLength(2);
    expect(tiles).toContainEqual(at(5, 5));
    expect(tiles).toContainEqual(at(5, 4));
  });

  it('DEFAULT_HURTBOX enumerates just the feet tile', () => {
    expect(hurtboxTiles(at(3, 7), DEFAULT_HURTBOX)).toEqual([at(3, 7)]);
  });

  it('every enumerated tile is contained, and count matches width*height', () => {
    const box = { width: 3, height: 2 };
    const tiles = hurtboxTiles(at(0, 0), box);
    expect(tiles).toHaveLength(box.width * box.height);
    for (const t of tiles) expect(hurtboxContains(at(0, 0), box, t)).toBe(true);
  });
});

describe('attackTiles', () => {
  const feet = at(10, 10);
  // Cardinal facing units.
  const DOWN = { dCol: 0, dRow: 1 };
  const UP = { dCol: 0, dRow: -1 };
  const RIGHT = { dCol: 1, dRow: 0 };
  const LEFT = { dCol: -1, dRow: 0 };
  const single = (reach: number): AttackShape => ({ reach, arc: 'single' });
  const line = (reach: number): AttackShape => ({ reach, arc: 'line' });
  const wide = (reach: number): AttackShape => ({ reach, arc: 'wide' });

  it("reach:1 arc:'single' is exactly the one feet+facing tile (today's behaviour)", () => {
    sameTiles(attackTiles(feet, RIGHT, single(1)), [at(11, 10)]);
    sameTiles(attackTiles(feet, LEFT, single(1)), [at(9, 10)]);
    sameTiles(attackTiles(feet, UP, single(1)), [at(10, 9)]);
    sameTiles(attackTiles(feet, DOWN, single(1)), [at(10, 11)]);
  });

  it("'single' is just the tip at reach, per facing", () => {
    sameTiles(attackTiles(feet, DOWN, single(2)), [at(10, 12)]);
    sameTiles(attackTiles(feet, UP, single(2)), [at(10, 8)]);
    sameTiles(attackTiles(feet, RIGHT, single(2)), [at(12, 10)]);
    sameTiles(attackTiles(feet, LEFT, single(2)), [at(8, 10)]);
  });

  it("'line' is the straight column out to reach, per facing", () => {
    sameTiles(attackTiles(feet, DOWN, line(1)), [at(10, 11)]);
    sameTiles(attackTiles(feet, DOWN, line(2)), [at(10, 11), at(10, 12)]);
    sameTiles(attackTiles(feet, UP, line(2)), [at(10, 9), at(10, 8)]);
    sameTiles(attackTiles(feet, RIGHT, line(2)), [at(11, 10), at(12, 10)]);
    sameTiles(attackTiles(feet, LEFT, line(2)), [at(9, 10), at(8, 10)]);
  });

  it("'wide' is a 3-wide swath to depth reach, per facing", () => {
    sameTiles(attackTiles(feet, DOWN, wide(1)), [at(10, 11), at(9, 11), at(11, 11)]);
    sameTiles(attackTiles(feet, DOWN, wide(2)), [
      at(10, 11),
      at(9, 11),
      at(11, 11),
      at(10, 12),
      at(9, 12),
      at(11, 12),
    ]);
    sameTiles(attackTiles(feet, UP, wide(1)), [at(10, 9), at(9, 9), at(11, 9)]);
    sameTiles(attackTiles(feet, RIGHT, wide(1)), [at(11, 10), at(11, 9), at(11, 11)]);
    sameTiles(attackTiles(feet, LEFT, wide(1)), [at(9, 10), at(9, 9), at(9, 11)]);
  });

  it('snaps a diagonal facing to the dominant axis', () => {
    // {1,1}: |dCol| >= |dRow| → snaps to RIGHT.
    sameTiles(attackTiles(feet, { dCol: 1, dRow: 1 }, wide(2)), attackTiles(feet, RIGHT, wide(2)));
    // {-1,2}: |dRow| dominates → snaps to DOWN.
    sameTiles(attackTiles(feet, { dCol: -1, dRow: 2 }, line(2)), attackTiles(feet, DOWN, line(2)));
    // {-2,-1}: |dCol| dominates → snaps to LEFT.
    sameTiles(
      attackTiles(feet, { dCol: -2, dRow: -1 }, single(2)),
      attackTiles(feet, LEFT, single(2)),
    );
  });

  it('clamps reach below 1 up to 1', () => {
    sameTiles(attackTiles(feet, RIGHT, { reach: 0, arc: 'single' }), [at(11, 10)]);
  });

  it('returns distinct cells (no repeats)', () => {
    for (const shape of [single(2), line(2), wide(2)]) {
      const tiles = attackTiles(feet, RIGHT, shape);
      const keys = tiles.map((t) => `${t.col},${t.row}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
