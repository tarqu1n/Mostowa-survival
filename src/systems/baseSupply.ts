import { EventEmitter } from 'eventemitter3';

/** The resource kinds the shared base-supply pool tracks. Counts-only, a fixed set (no arbitrary ids
 *  like {@link Inventory}) — the companion gathers wood/rock into it and repairs walls out of it. */
export type SupplyItem = 'wood' | 'rock';

/** Plain-object copy of the pool's counts (safe to hand to HUD/DebugState listeners). */
export type SupplySnapshot = { wood: number; rock: number };

/**
 * The shared base-supply stockpile (plan 042 Step 3): a small pure store of `wood`/`rock` counts the
 * AI companion deposits harvested resources into (Step 4) and repairs base walls out of (Step 5).
 *
 * **Deliberately separate from the player {@link Inventory}** (owner-reaffirmed, critique #3): it's a
 * shared base pool, not the player's bag, and needs neither slots/stacking nor icons — just per-kind
 * counts. So it's a much simpler store: `count` / `add` / `take` over a fixed `{wood, rock}` record.
 *
 * Anchored at the campfire — `GameScene.litHearth()` is the walk-to deposit tile (Step 4) — but the
 * store itself is GLOBAL: deposits succeed even with no lit hearth (the hearth is only the destination
 * a gathering companion walks to, not a gate on the count). Owned by `GameScene` (constructed fresh per
 * `buildWorld()`, so a death-restart starts empty) and surfaced to `CompanionManager` when Steps 4/5
 * need it; the HUD reads it via a `supply:changed` game-event GameScene bridges from `'change'`.
 *
 * Emits `'change'` (payload: {@link snapshot}) after any real mutation so the HUD reacts without
 * polling. Extends `eventemitter3` directly (like {@link Inventory}) so this file imports no Phaser —
 * keeping it plain-Node unit-testable with no scene. See vitest.config.ts.
 */
export class BaseSupply extends EventEmitter {
  private readonly counts: SupplySnapshot = { wood: 0, rock: 0 };

  /** Count currently pooled of `item` (0 or more). */
  count(item: SupplyItem): number {
    return this.counts[item];
  }

  /** Deposit `n` (default 1) of `item` into the pool. No-op for `n <= 0`. Emits `'change'` when
   *  anything was actually added. */
  add(item: SupplyItem, n = 1): void {
    if (n <= 0) return;
    this.counts[item] += n;
    this.emit('change', this.snapshot());
  }

  /**
   * Withdraw `n` (default 1) of `item`. Returns `false` and leaves the pool untouched when fewer than
   * `n` are pooled (the repair loop then knows the base is short); else deducts, emits `'change'`, and
   * returns `true`. `n <= 0` is a trivial success (nothing to take, no mutation, no event).
   */
  take(item: SupplyItem, n = 1): boolean {
    if (n <= 0) return true;
    if (this.counts[item] < n) return false;
    this.counts[item] -= n;
    this.emit('change', this.snapshot());
    return true;
  }

  /** Plain-object copy of the current counts (safe to hand to listeners / DebugState). */
  snapshot(): SupplySnapshot {
    return { ...this.counts };
  }

  /** Overwrite both counts wholesale (scenario seeding). Emits `'change'`. */
  set(snapshot: SupplySnapshot): void {
    this.counts.wood = snapshot.wood;
    this.counts.rock = snapshot.rock;
    this.emit('change', this.snapshot());
  }

  /** Empty the pool (world reset). Emits `'change'`. */
  reset(): void {
    this.set({ wood: 0, rock: 0 });
  }
}
