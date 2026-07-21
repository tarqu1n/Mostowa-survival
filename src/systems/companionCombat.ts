/**
 * Pure companion-combat targeting helpers (plan 042 Step 7) — no Phaser, no scene deps, no
 * module-level mutable state. The AI companion's night combat reuses the acquire → chase →
 * telegraphed-contact SHAPE of the monster, but it is a small DEDICATED stepper driven by
 * {@link CompanionManager}: it does NOT reuse `stepMonster` (which stays enemy-only). Each tick the
 * companion engages the NEAREST live enemy within its vision.
 *
 * This module owns the two pure decisions worth testing in isolation — which enemy to target, and
 * whether the companion is in melee contact with it — mirroring how `monsterAI`'s nearest/ramp helpers
 * are unit-tested with a seeded rng. The strike's damage resolution reuses the shared
 * `resolveMeleeAttack` (`combat.ts`), so nothing is re-derived here.
 */

import type { CombatantStats } from '../data/types';
import type { Cell } from './pathfind';
import type { Vec2 } from './monsterAI';

/**
 * A live enemy the companion may engage — a plain snapshot (the 013/015 narrow-interface rule),
 * assembled scene-side from each {@link import('../entities/MonsterCharacter').MonsterCharacter}. The
 * companion never sees the raw actor. A dead/absent mob is simply omitted from the list by the caller,
 * so it's never a valid target (the mirror of how a downed NPC is omitted from a mob's threat list).
 */
export interface CombatTarget {
  /** Stable enemy id — the handle the companion's `damageEnemy` op routes the strike back through. */
  id: string;
  /** World-pixel position — the vision-acquire check is in world px (mirrors the monster's acquire). */
  pos: Vec2;
  /** Feet tile — the chase goal (the companion paths to a tile adjacent to it). */
  tile: Cell;
  /** Body tiles (feet + torso overhang) — melee contact lands on ANY of them. */
  bodyTiles: Cell[];
  /** Combat stat bag — armour/dodge for the strike's `resolveMeleeAttack`. */
  stats: CombatantStats;
}

/**
 * The nearest target within `visionPx` world px of `from`, or `null` when the list is empty or none is
 * in range. Pure: ties resolve to the first-seen (list order is caller-stable). Mirrors the monster's
 * radius-only acquire — nearest wins, no line-of-sight / wall occlusion.
 */
export function acquireNearestTarget(
  from: Vec2,
  targets: readonly CombatTarget[],
  visionPx: number,
): CombatTarget | null {
  let best: CombatTarget | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = Math.hypot(from.x - t.pos.x, from.y - t.pos.y);
    if (d <= visionPx && d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

/**
 * True if `from` (the companion's feet tile) is within melee contact — Chebyshev ≤ 1 — of ANY of
 * `bodyTiles`. The mirror of `MonsterCharacter`'s contact test, so the companion bites on the same
 * proximity a mob does (its torso overhang counts, not only its feet tile).
 */
export function inMeleeContact(from: Cell, bodyTiles: readonly Cell[]): boolean {
  return bodyTiles.some(
    (t) => Math.max(Math.abs(t.col - from.col), Math.abs(t.row - from.row)) <= 1,
  );
}
