import { describe, it, expect } from 'vitest';
import { acquireNearestTarget, inMeleeContact, type CombatTarget } from '../companionCombat';
import type { Cell } from '../pathfind';

// Pure companion-combat targeting helpers (plan 042 Step 7) — mirrors the monsterAI test style: no
// Phaser, deterministic, no rng needed (the decisions here are pure geometry; damage resolution is
// covered by combat.test.ts). A tile is 16px, so 1 tile ≈ 16 world px.

function makeTarget(id: string, x: number, y: number, tile: Cell): CombatTarget {
  return {
    id,
    pos: { x, y },
    tile,
    bodyTiles: [tile, { col: tile.col, row: tile.row - 1 }], // feet + one torso tile above
    stats: { maxHp: 3, armour: 0, speed: 45, strength: 1, dex: 0, dodge: 0 },
  };
}

describe('acquireNearestTarget', () => {
  it('returns null for an empty list', () => {
    expect(acquireNearestTarget({ x: 0, y: 0 }, [], 64)).toBeNull();
  });

  it('picks the nearest enemy within vision', () => {
    const near = makeTarget('near', 20, 0, { col: 1, row: 0 });
    const far = makeTarget('far', 50, 0, { col: 3, row: 0 });
    const picked = acquireNearestTarget({ x: 0, y: 0 }, [far, near], 100);
    expect(picked?.id).toBe('near'); // nearest wins regardless of list order
  });

  it('returns null when every enemy is beyond vision', () => {
    const t = makeTarget('t', 200, 0, { col: 12, row: 0 });
    expect(acquireNearestTarget({ x: 0, y: 0 }, [t], 64)).toBeNull();
  });

  it('includes an enemy exactly at the vision boundary (<=)', () => {
    const t = makeTarget('edge', 64, 0, { col: 4, row: 0 });
    expect(acquireNearestTarget({ x: 0, y: 0 }, [t], 64)?.id).toBe('edge');
  });

  it('measures distance in 2-D world px (diagonal), not per-axis', () => {
    const t = makeTarget('diag', 60, 60, { col: 4, row: 4 }); // hypot ≈ 84.9 px
    expect(acquireNearestTarget({ x: 0, y: 0 }, [t], 80)).toBeNull(); // outside an 80px radius
    expect(acquireNearestTarget({ x: 0, y: 0 }, [t], 90)?.id).toBe('diag'); // inside a 90px radius
  });
});

describe('inMeleeContact', () => {
  const from: Cell = { col: 5, row: 5 };

  it('is true when a body tile is orthogonally adjacent (Chebyshev 1)', () => {
    expect(inMeleeContact(from, [{ col: 6, row: 5 }])).toBe(true);
  });

  it('is true when a body tile is diagonally adjacent (Chebyshev 1)', () => {
    expect(inMeleeContact(from, [{ col: 6, row: 6 }])).toBe(true);
  });

  it('is true on the same tile (Chebyshev 0)', () => {
    expect(inMeleeContact(from, [{ col: 5, row: 5 }])).toBe(true);
  });

  it('is false when every body tile is 2+ tiles away', () => {
    expect(
      inMeleeContact(from, [
        { col: 7, row: 5 },
        { col: 5, row: 8 },
      ]),
    ).toBe(false);
  });

  it('lands on the torso overhang even when the feet tile is out of reach', () => {
    // Feet at row 7 (2 away), torso tile at row 6 (Chebyshev 1) → in contact via the overhang.
    expect(
      inMeleeContact(from, [
        { col: 5, row: 7 },
        { col: 5, row: 6 },
      ]),
    ).toBe(true);
  });

  it('is false for an empty body-tile list', () => {
    expect(inMeleeContact(from, [])).toBe(false);
  });
});
