import { describe, it, expect, vi } from 'vitest';
import { BaseSupply } from '../baseSupply';

// Plain-Node tests: BaseSupply imports eventemitter3 directly (not `phaser`), so this file must
// never import `phaser` or rely on jsdom. See vitest.config.ts. Deterministic — no rng.

describe('BaseSupply', () => {
  describe('count / add accounting', () => {
    it('starts both kinds at 0', () => {
      const s = new BaseSupply();
      expect(s.count('wood')).toBe(0);
      expect(s.count('rock')).toBe(0);
    });

    it('add defaults to 1', () => {
      const s = new BaseSupply();
      s.add('wood');
      expect(s.count('wood')).toBe(1);
    });

    it('add accumulates across multiple calls', () => {
      const s = new BaseSupply();
      s.add('wood', 2);
      s.add('wood', 3);
      expect(s.count('wood')).toBe(5);
    });

    it('tracks wood and rock independently', () => {
      const s = new BaseSupply();
      s.add('wood', 4);
      s.add('rock', 1);
      expect(s.count('wood')).toBe(4);
      expect(s.count('rock')).toBe(1);
    });

    it('ignores non-positive add amounts (no-op)', () => {
      const s = new BaseSupply();
      s.add('wood', 5);
      s.add('wood', 0);
      s.add('wood', -3);
      expect(s.count('wood')).toBe(5);
    });
  });

  describe('take', () => {
    it('deducts and returns true when enough is pooled', () => {
      const s = new BaseSupply();
      s.add('wood', 5);
      expect(s.take('wood', 2)).toBe(true);
      expect(s.count('wood')).toBe(3);
    });

    it('take defaults to 1', () => {
      const s = new BaseSupply();
      s.add('rock', 2);
      expect(s.take('rock')).toBe(true);
      expect(s.count('rock')).toBe(1);
    });

    it('returns false and does NOT mutate when the pool is empty', () => {
      const s = new BaseSupply();
      expect(s.take('wood', 1)).toBe(false);
      expect(s.count('wood')).toBe(0);
    });

    it('returns false and does NOT mutate when quantity is insufficient', () => {
      const s = new BaseSupply();
      s.add('wood', 2);
      expect(s.take('wood', 3)).toBe(false);
      expect(s.count('wood')).toBe(2); // untouched — atomic all-or-nothing
    });

    it('a taken kind does not affect the other', () => {
      const s = new BaseSupply();
      s.add('wood', 3);
      s.add('rock', 3);
      s.take('wood', 3);
      expect(s.count('wood')).toBe(0);
      expect(s.count('rock')).toBe(3);
    });

    it('non-positive take is a trivial success with no mutation', () => {
      const s = new BaseSupply();
      s.add('wood', 1);
      expect(s.take('wood', 0)).toBe(true);
      expect(s.count('wood')).toBe(1);
    });
  });

  describe('snapshot / set / reset', () => {
    it('snapshot returns a plain copy of both counts', () => {
      const s = new BaseSupply();
      s.add('wood', 2);
      s.add('rock', 5);
      expect(s.snapshot()).toEqual({ wood: 2, rock: 5 });
    });

    it('snapshot is a copy — mutating it does not affect the store', () => {
      const s = new BaseSupply();
      s.add('wood', 2);
      const snap = s.snapshot();
      snap.wood = 99;
      expect(s.count('wood')).toBe(2);
    });

    it('set overwrites both counts wholesale', () => {
      const s = new BaseSupply();
      s.add('wood', 2);
      s.set({ wood: 7, rock: 4 });
      expect(s.snapshot()).toEqual({ wood: 7, rock: 4 });
    });

    it('reset empties the pool', () => {
      const s = new BaseSupply();
      s.set({ wood: 7, rock: 4 });
      s.reset();
      expect(s.snapshot()).toEqual({ wood: 0, rock: 0 });
    });
  });

  describe("emits 'change'", () => {
    it('emits a snapshot after a real add', () => {
      const s = new BaseSupply();
      const spy = vi.fn();
      s.on('change', spy);
      s.add('wood', 2);
      expect(spy).toHaveBeenCalledWith({ wood: 2, rock: 0 });
    });

    it('does NOT emit on a no-op add', () => {
      const s = new BaseSupply();
      const spy = vi.fn();
      s.on('change', spy);
      s.add('wood', 0);
      expect(spy).not.toHaveBeenCalled();
    });

    it('emits after a successful take but NOT after a failed one', () => {
      const s = new BaseSupply();
      s.add('wood', 2);
      const spy = vi.fn();
      s.on('change', spy);
      expect(s.take('wood', 5)).toBe(false); // insufficient — no emit
      expect(spy).not.toHaveBeenCalled();
      expect(s.take('wood', 1)).toBe(true);
      expect(spy).toHaveBeenCalledWith({ wood: 1, rock: 0 });
    });

    it('emits on set and reset', () => {
      const s = new BaseSupply();
      const spy = vi.fn();
      s.on('change', spy);
      s.set({ wood: 3, rock: 1 });
      s.reset();
      expect(spy).toHaveBeenNthCalledWith(1, { wood: 3, rock: 1 });
      expect(spy).toHaveBeenNthCalledWith(2, { wood: 0, rock: 0 });
    });
  });
});
