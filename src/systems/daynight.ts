/**
 * Pure day/night cycle math. Time is driven by a fixed real-time loop elsewhere (a continuously
 * advancing clock, not turn-based) — these functions take every value as an argument so they stay
 * deterministic and testable without a wall clock. No Phaser imports, no module-level mutable state.
 *
 * Cycle shape: `[day: 0..DAY_MS][night: DAY_MS..DAY_MS+NIGHT_MS]`, looping. Dusk (the tint ramping
 * up) is the last TWILIGHT_MS of the day window; dawn (the tint ramping down) is the first
 * TWILIGHT_MS of the following day window. Night itself is a flat plateau at NIGHT_MAX_ALPHA.
 */

import { DAY_MS, NIGHT_MS, TWILIGHT_MS, NIGHT_MAX_ALPHA } from '../config';

/** Coarse phase of the cycle — day covers dawn/mid-day/dusk, night is the flat dark plateau. */
export type DayPhase = 'day' | 'night';

/** Total length (ms) of one full day+night cycle. */
export function cycleLengthMs(): number {
  return DAY_MS + NIGHT_MS;
}

/** Phase at a given point in the cycle (`cycleMs` already wrapped to `[0, cycleLengthMs())`). */
export function phaseAt(cycleMs: number): DayPhase {
  return cycleMs < DAY_MS ? 'day' : 'night';
}

/**
 * Night-tint overlay alpha at a given point in the cycle: `0` through mid-day, cross-fading up to
 * `NIGHT_MAX_ALPHA` over the last TWILIGHT_MS of the day (dusk), flat at `NIGHT_MAX_ALPHA` through
 * the night, then cross-fading back down to `0` over the first TWILIGHT_MS of the next day (dawn).
 * Continuous at every boundary — no jumps.
 */
export function tintAlphaAt(cycleMs: number): number {
  const duskStart = DAY_MS - TWILIGHT_MS;

  if (cycleMs < TWILIGHT_MS) {
    // Dawn: ramp NIGHT_MAX_ALPHA -> 0 over the first TWILIGHT_MS of the day.
    return NIGHT_MAX_ALPHA * (1 - cycleMs / TWILIGHT_MS);
  }
  if (cycleMs < duskStart) {
    // Mid-day plateau.
    return 0;
  }
  if (cycleMs < DAY_MS) {
    // Dusk: ramp 0 -> NIGHT_MAX_ALPHA over the last TWILIGHT_MS of the day.
    return NIGHT_MAX_ALPHA * ((cycleMs - duskStart) / TWILIGHT_MS);
  }
  // Night plateau.
  return NIGHT_MAX_ALPHA;
}

/** In-game day number for a total elapsed-ms value (not wrapped) — day 1 at t=0. */
export function dayCountForTotal(totalMs: number): number {
  return Math.floor(totalMs / cycleLengthMs()) + 1;
}
