import { test, expect } from '@playwright/test';
import { startGame, applyScenario, step, state, beginWave, blocked } from './harness';

// Tier-2: the night wave (plan 038 Step 3). WaveDirector meters skeleton spawns from the "treeline" (a
// band off the defended centre — the lit hearth) during a wave, started by the night phase edge, the
// first-tick reconcile (a scenario seeded into night), or the dev/test force seam `beginWave`.
//
// Assertions are rng- and geography-agnostic on purpose: spec `rng` can't cross the Playwright bridge
// (so spawn tiles are Math.random), and on the-moon the biased treeline direction can be void, so a
// spawn may fall back to the nearest walkable tile. So we assert the invariants — spawns are WALKABLE,
// LOCAL to the defended centre (within the spawn band), PACED (metered, not a burst), and never happen
// by day without a trigger — not exact tiles. WAVE_SPAWN_RADIUS(14)+SPREAD(10)+margin = 26.
//
// The player sits FAR from the camp so the spawned skeletons (which still target the player in Step 3 —
// objective AI is Step 4) neither reach nor are reached, keeping the enemy count a clean function of
// the spawn schedule (no deaths/restarts mid-test).
const SPAWN_BAND_MAX = 26;
const CENTRE = { col: 118, row: 140 }; // near SPAWN_TILE — the lit hearth = the defended centre
const FAR_PLAYER: [number, number] = [60, 60]; // ~80 tiles away — out of aggro/reach for the step windows

test('no skeletons spawn during the day (the wave never triggers by daylight)', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: FAR_PLAYER, campfires: [[CENTRE.col, CENTRE.row]] }); // day (default)

  expect((await state(page)).enemies).toBe(0); // scenario placed none; day reconcile starts no wave
  await step(page, 5000); // driven day time
  expect((await state(page)).enemies).toBe(0); // still none — no wave by day
});

test('beginWave starts a paced wave of walkable spawns local to the camp', async ({ page }) => {
  test.setTimeout(120_000); // steps ~1320 fixed frames to cross the first (trickle) spawn interval
  await startGame(page);
  await applyScenario(page, { player: FAR_PLAYER, campfires: [[CENTRE.col, CENTRE.row]] });

  await beginWave(page);
  const first = await state(page);
  expect(first.enemies).toBe(1); // a wave begins with exactly one immediate spawn (metered, not a burst)

  // That first spawn (unmoved) is on a WALKABLE tile, LOCAL to the defended centre (within the spawn
  // band), and not on the centre itself.
  const t = first.enemyTiles[0];
  expect(await blocked(page, t.col, t.row)).toBe(false);
  const cheb = Math.max(Math.abs(t.col - CENTRE.col), Math.abs(t.row - CENTRE.row));
  expect(cheb).toBeGreaterThanOrEqual(1);
  expect(cheb).toBeLessThanOrEqual(SPAWN_BAND_MAX);

  // PACED over time: crossing the first ~20s trickle interval adds a spawn or two — a metered trickle,
  // not the whole night's worth at once.
  await step(page, 22000);
  const later = await state(page);
  expect(later.enemies).toBeGreaterThanOrEqual(2);
  expect(later.enemies).toBeLessThanOrEqual(4);
});

test('a wave auto-starts when the clock is seeded straight into night (first-tick reconcile)', async ({
  page,
}) => {
  await startGame(page);
  // Seeded directly into night → SurvivalClock emits no `time:changed`, so the WaveDirector must
  // reconcile the phase on its first tick and start the wave anyway (plan 038 critique #1) — with no
  // beginWave() call here, a spawn appearing proves the reconcile path.
  await applyScenario(page, {
    player: FAR_PLAYER,
    campfires: [[CENTRE.col, CENTRE.row]],
    startPhase: 'night',
  });

  await step(page, 1000); // first driven tick reconciles phase === 'night' → begins the wave
  expect((await state(page)).enemies).toBeGreaterThanOrEqual(1);
});
