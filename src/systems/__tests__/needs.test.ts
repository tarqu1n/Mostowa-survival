import { describe, it, expect } from 'vitest';
import { drainHunger, feed, isStarving } from '../needs';
import { HUNGER_MAX, HUNGER_DRAIN_PER_SEC } from '../../config';

describe('drainHunger', () => {
  it('drains at the given rate for a normal delta', () => {
    expect(drainHunger(HUNGER_MAX, 1000, HUNGER_DRAIN_PER_SEC, HUNGER_MAX)).toBeCloseTo(
      HUNGER_MAX - HUNGER_DRAIN_PER_SEC,
    );
  });

  it('clamps at 0 for a huge deltaMs (large-delta guard)', () => {
    expect(drainHunger(HUNGER_MAX, 10_000_000, HUNGER_DRAIN_PER_SEC, HUNGER_MAX)).toBe(0);
  });

  it('never exceeds max, even with a negative drain rate', () => {
    expect(drainHunger(HUNGER_MAX, 1000, -HUNGER_DRAIN_PER_SEC, HUNGER_MAX)).toBe(HUNGER_MAX);
  });
});

describe('feed', () => {
  it('adds nutrition below max', () => {
    expect(feed(50, 20, HUNGER_MAX)).toBe(70);
  });

  it('caps at max', () => {
    expect(feed(90, 50, HUNGER_MAX)).toBe(HUNGER_MAX);
  });
});

describe('isStarving', () => {
  it('is false just above 0', () => {
    expect(isStarving(0.1)).toBe(false);
  });

  it('is true at 0', () => {
    expect(isStarving(0)).toBe(true);
  });

  it('is true below 0', () => {
    expect(isStarving(-5)).toBe(true);
  });
});
