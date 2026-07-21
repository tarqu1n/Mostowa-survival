import { describe, it, expect } from 'vitest';
import { drainFuel, feedFuel, isLit, fuelFrac } from '../campfire';
import {
  CAMPFIRE_FUEL_MAX,
  CAMPFIRE_FUEL_BURN_PER_SEC,
  CAMPFIRE_FUEL_PER_WOOD,
  CAMPFIRE_LIGHT_MIN_FRAC,
  CLAIM_LIGHT_FRAC,
  NIGHT_MS,
} from '../../config';

describe('drainFuel', () => {
  it('subtracts burnPerSec * seconds elapsed', () => {
    expect(drainFuel(10, 1000, 1)).toBe(9);
    expect(drainFuel(CAMPFIRE_FUEL_MAX, 1000, CAMPFIRE_FUEL_BURN_PER_SEC)).toBe(
      CAMPFIRE_FUEL_MAX - CAMPFIRE_FUEL_BURN_PER_SEC,
    );
  });

  it('clamps at 0 rather than going negative', () => {
    expect(drainFuel(1, 5000, 1)).toBe(0);
    expect(drainFuel(0, 1000, 1)).toBe(0);
  });

  // Plan 038 Step 2 fuel-retune intent, encoded against the live config: a full tank must *just*
  // outlast a whole night on natural burn (so a well-fed fire survives an undefended night), but a
  // half tank must NOT (so keeping it lit through a defended night — burn + mob attacks — is a real
  // ask). If a future retune breaks either end, this fails loudly rather than silently drifting.
  it('a full tank outlasts a night on natural burn; a half tank does not (retune anchor)', () => {
    expect(drainFuel(CAMPFIRE_FUEL_MAX, NIGHT_MS, CAMPFIRE_FUEL_BURN_PER_SEC)).toBeGreaterThan(0);
    expect(drainFuel(CAMPFIRE_FUEL_MAX / 2, NIGHT_MS, CAMPFIRE_FUEL_BURN_PER_SEC)).toBe(0);
  });
});

describe('feedFuel', () => {
  it('adds perWood to the current fuel', () => {
    expect(feedFuel(0, CAMPFIRE_FUEL_PER_WOOD, CAMPFIRE_FUEL_MAX)).toBe(CAMPFIRE_FUEL_PER_WOOD);
  });

  it('clamps at max', () => {
    expect(feedFuel(CAMPFIRE_FUEL_MAX - 5, CAMPFIRE_FUEL_PER_WOOD, CAMPFIRE_FUEL_MAX)).toBe(
      CAMPFIRE_FUEL_MAX,
    );
  });
});

describe('isLit', () => {
  it('is true whenever fuel is greater than 0', () => {
    expect(isLit(1)).toBe(true);
    expect(isLit(0.1)).toBe(true);
  });

  it('is false at exactly 0 (and below)', () => {
    expect(isLit(0)).toBe(false);
    expect(isLit(-1)).toBe(false);
  });
});

describe('fuelFrac', () => {
  it('is 1 at a full tank and the floor at empty (drives both flame scale and light radius)', () => {
    expect(fuelFrac(CAMPFIRE_FUEL_MAX, CAMPFIRE_FUEL_MAX, CAMPFIRE_LIGHT_MIN_FRAC)).toBe(1);
    expect(fuelFrac(0, CAMPFIRE_FUEL_MAX, CAMPFIRE_LIGHT_MIN_FRAC)).toBe(CAMPFIRE_LIGHT_MIN_FRAC);
  });

  it('lerps between the floor and 1 with fuel (half tank = midpoint)', () => {
    expect(fuelFrac(CAMPFIRE_FUEL_MAX / 2, CAMPFIRE_FUEL_MAX, 0.4)).toBeCloseTo(0.7);
  });

  it('rises monotonically with fuel', () => {
    expect(fuelFrac(30, CAMPFIRE_FUEL_MAX, 0.4)).toBeLessThan(fuelFrac(90, CAMPFIRE_FUEL_MAX, 0.4));
  });

  it('never drops below the floor even past empty', () => {
    expect(fuelFrac(-10, CAMPFIRE_FUEL_MAX, 0.4)).toBe(0.4);
  });
});

// Plan 039 (base claim). The `baseOnly` claim tests a lit hearth's BRIGHT CORE — the light radius ×
// CLAIM_LIGHT_FRAC — not the full geometric radius (decision #7: never let placement fall in the
// soft-gradient fringe you can't see). Both the light radius and its claim core are `light-base ×
// fuelFrac`, so the base cancels and the invariants below hold for any base. These are the pure
// anchors behind the Tier-2 e2e (bright-core accept/reject + fuel-shrink); they catch a config drift
// (e.g. CLAIM_LIGHT_FRAC bumped to ≥ 1) that would silently break the "inside the visible core" rule.
describe('claim bright-core (CLAIM_LIGHT_FRAC)', () => {
  // Claim-core / light-radius, both as multiples of the (cancelled) light base.
  const light = (fuel: number) => fuelFrac(fuel, CAMPFIRE_FUEL_MAX, CAMPFIRE_LIGHT_MIN_FRAC);
  const claimCore = (fuel: number) => light(fuel) * CLAIM_LIGHT_FRAC;

  it('is a strict subset of the light radius (decision #7 — no claiming the invisible fringe)', () => {
    expect(CLAIM_LIGHT_FRAC).toBeGreaterThan(0);
    expect(CLAIM_LIGHT_FRAC).toBeLessThan(1);
    for (const fuel of [0, 30, 60, CAMPFIRE_FUEL_MAX]) {
      expect(claimCore(fuel)).toBeLessThan(light(fuel));
    }
  });

  it('breathes with fuel — a fuller fire claims strictly more ground', () => {
    expect(claimCore(30)).toBeLessThan(claimCore(90));
    expect(claimCore(CAMPFIRE_FUEL_MAX)).toBeGreaterThan(claimCore(CAMPFIRE_FUEL_MAX / 2));
  });
});
