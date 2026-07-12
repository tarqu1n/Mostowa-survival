import { EventEmitter } from 'eventemitter3';

/** One occupied inventory slot: a stack of `count` units of item `id`. `null` = empty slot. */
export type Slot = { id: string; count: number } | null;

/** Options for {@link Inventory}. Both are injected so this system stays data-agnostic. */
export interface InventoryOptions {
  /** Number of slots the bag holds. Defaults large enough to behave unbounded. */
  capacity?: number;
  /** Per-item max stack size resolver. Defaults to `Infinity` (single unbounded stack per id). */
  maxStackOf?: (id: string) => number;
}

/** Default capacity when constructed with no options — large enough to never block in practice. */
const DEFAULT_CAPACITY = 1000;

/**
 * Character inventory: a bounded grid of stacking slots. Pure world logic, no scene deps.
 *
 * Slots are the single source of truth — an `Array<Slot>` of length `capacity`. Each stack fills
 * one slot up to that item's `maxStack`; overflow spills into the next free slot, so the bag can
 * genuinely fill up. `get`/`snapshot` aggregate across slots; `slots()` hands the UI a copy.
 *
 * `maxStack` is per-item *data*, but this system must not import the item catalogue (that would pull
 * data into a pure system and break the plain-Node tests). So the constructor takes an injected
 * `maxStackOf` resolver; production wires it from `ITEMS`, tests pass tiny resolvers inline. Called
 * with **no args** it defaults to a large capacity + `Infinity` max stack, so it behaves like the
 * old unbounded bag and every existing caller/test stays green.
 *
 * Emits `'change'` (payload: {@link snapshot}) after any real mutation so UI can react without
 * polling. Shared across scenes via `this.registry`; the UIScene subscribes to `'change'` directly.
 *
 * Extends `eventemitter3` directly (rather than `Phaser.Events.EventEmitter`, which is that same
 * package re-exported) so this file imports no Phaser — keeps it plain-Node testable. See
 * vitest.config.ts.
 */
export class Inventory extends EventEmitter {
  private readonly maxStackOf: (id: string) => number;
  private readonly bag: Slot[];

  constructor({ capacity = DEFAULT_CAPACITY, maxStackOf = () => Infinity }: InventoryOptions = {}) {
    super();
    this.maxStackOf = maxStackOf;
    this.bag = new Array<Slot>(capacity).fill(null);
  }

  /** Count held of `id` across every slot (0 if none). */
  get(id: string): number {
    let total = 0;
    for (const slot of this.bag) {
      if (slot && slot.id === id) total += slot.count;
    }
    return total;
  }

  /**
   * Add `n` of `id` (default 1): tops up existing partial stacks of `id` first, then fills empty
   * slots, each up to the item's `maxStack`. **Returns the amount actually added** (leftover =
   * `n - added` when capacity/stacks are exhausted). Emits `'change'` only if something was added.
   */
  add(id: string, n = 1): number {
    if (n <= 0) return 0;
    const maxStack = this.maxStackOf(id);
    let remaining = n;

    // Top up existing partial stacks of this id first.
    for (const slot of this.bag) {
      if (remaining <= 0) break;
      if (slot && slot.id === id && slot.count < maxStack) {
        const put = Math.min(maxStack - slot.count, remaining);
        slot.count += put;
        remaining -= put;
      }
    }
    // Then spill into empty slots.
    for (let i = 0; i < this.bag.length && remaining > 0; i++) {
      if (this.bag[i] === null) {
        const put = Math.min(maxStack, remaining);
        this.bag[i] = { id, count: put };
        remaining -= put;
      }
    }

    const added = n - remaining;
    if (added > 0) this.emit('change', this.snapshot());
    return added;
  }

  /** True iff all `n` (default 1) of `id` would fit given current free space + partial stacks. */
  canAccept(id: string, n = 1): boolean {
    if (n <= 0) return true;
    const maxStack = this.maxStackOf(id);
    let room = 0;
    for (const slot of this.bag) {
      if (slot === null) room += maxStack;
      else if (slot.id === id) room += Math.max(0, maxStack - slot.count);
      if (room >= n) return true;
    }
    return room >= n;
  }

  /** True if at least `n` (default 1) of `id` is held. */
  has(id: string, n = 1): boolean {
    return this.get(id) >= n;
  }

  /** True iff every id in `cost` is held in at least the required amount. */
  canAfford(cost: Record<string, number>): boolean {
    return Object.entries(cost).every(([id, amount]) => this.get(id) >= amount);
  }

  /**
   * Deduct `cost` atomically across slots (clearing any slot emptied to 0). No-op returning false if
   * unaffordable; else emits `'change'` once (when anything actually changed) and returns true.
   */
  spend(cost: Record<string, number>): boolean {
    if (!this.canAfford(cost)) return false;
    let changed = false;
    for (const [id, amount] of Object.entries(cost)) {
      let need = amount;
      for (let i = 0; i < this.bag.length && need > 0; i++) {
        const slot = this.bag[i];
        if (slot && slot.id === id) {
          const take = Math.min(slot.count, need);
          slot.count -= take;
          need -= take;
          changed = true;
          if (slot.count === 0) this.bag[i] = null;
        }
      }
    }
    if (changed) this.emit('change', this.snapshot());
    return true;
  }

  /** Plain-object copy of aggregate counts (safe to hand to listeners). */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const slot of this.bag) {
      if (slot) out[slot.id] = (out[slot.id] ?? 0) + slot.count;
    }
    return out;
  }

  /** Copy of the raw slot layout (for the grid UI). Each entry is a fresh object or `null`. */
  slots(): ReadonlyArray<Slot> {
    return this.bag.map((slot) => (slot ? { ...slot } : null));
  }
}
