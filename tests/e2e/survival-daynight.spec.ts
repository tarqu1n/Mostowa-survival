import { test, expect } from '@playwright/test';
import { startGame, applyScenario, stepLogic, state } from './harness';
import { DAY_MS, NIGHT_MS, TWILIGHT_MS, NIGHT_MAX_ALPHA } from '../../src/config';

// Tier-2: the day/night clock advances through the REAL scene's per-frame survival tick (above the
// no-action early-return), driven deterministically via stepLogic(). The tint/phase/day math itself is
// Tier-1 (daynight.test.ts); these prove the clock is wired into update() and drives the overlay +
// derived phase/day state. Seed clockMs near a boundary so only a few driven slices cross it.

test('day flips to night and the night overlay darkens', async ({ page }) => {
  await startGame(page);
  // Seed mid-day, just before the dusk cross-fade begins (overlay fully clear).
  await applyScenario(page, { clockMs: DAY_MS - TWILIGHT_MS - 100 });

  const before = await state(page);
  expect(before.dayPhase).toBe('day');
  expect(before.nightAlpha).toBeCloseTo(0, 2); // mid-day plateau: no dim

  // Step across the dusk ramp and past the DAY_MS boundary into deep night.
  await stepLogic(page, TWILIGHT_MS + 300);

  const after = await state(page);
  expect(after.dayPhase).toBe('night');
  expect(after.nightAlpha).toBeGreaterThan(before.nightAlpha);
  expect(after.nightAlpha).toBeCloseTo(NIGHT_MAX_ALPHA, 2); // deep night plateau
});

// Regression (hunger/day-counter bug): the dial's sun/moon marker + progress ring sweep with the
// cycle position, which advances every frame — but `time:changed` fires ONLY on a phase/day
// transition, so before the `time:progress` tick the dial sat frozen for the whole 11-min day and
// read as "broken". Prove the REAL clock now moves the rendered marker mid-phase (no transition).
test('the day/night dial marker sweeps as time passes within a phase', async ({ page }) => {
  await startGame(page);
  // Seed early-day, well clear of dusk so the whole step stays in the day phase (no transition).
  await applyScenario(page, { clockMs: 1_000 });

  const marker = () =>
    page.evaluate(() => {
      const svg = document.querySelector('[data-testid="hud-daynight"] svg')!;
      const circles = svg.querySelectorAll('circle');
      const m = circles[circles.length - 1]; // the sweeping marker is the last <circle>
      return { cx: m.getAttribute('cx'), cy: m.getAttribute('cy') };
    });

  await stepLogic(page, 300); // let a first time:progress land after the seed
  const before = await marker();

  await stepLogic(page, 3_000); // advance within the day (no transition); inside the stepLogic budget
  const after = await marker();

  expect(await state(page)).toMatchObject({ dayPhase: 'day', dayCount: 1 }); // still same phase
  expect(after).not.toEqual(before); // the marker actually moved (dial is live, not frozen)
});

test('the day count increments after a full cycle', async ({ page }) => {
  await startGame(page);
  // Seed the tail of day 1's cycle (still night), just before it wraps to day 2's dawn.
  await applyScenario(page, { clockMs: DAY_MS + NIGHT_MS - 100 });

  const before = await state(page);
  expect(before.dayCount).toBe(1);
  expect(before.dayPhase).toBe('night');

  await stepLogic(page, 300); // cross the cycle boundary into day 2

  const after = await state(page);
  expect(after.dayCount).toBe(2);
  expect(after.dayPhase).toBe('day');
});
