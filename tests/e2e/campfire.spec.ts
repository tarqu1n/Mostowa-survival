import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  step,
  state,
  tryPlace,
  inLight,
  feedCampfire,
  held,
} from './harness';

// Tier-2: the campfire buildable end-to-end — fixture placement, the real tilePlaceable/isInBase
// gate, the night-overlay reveal (nightAlpha/inLight — NOT enemy visibility, see plan 012 Out of
// scope), and the per-frame fuel drain + tap-to-feed relight. Player/campfire tiles below are inside
// BASE_ZONE (config.ts: minCol 12/maxCol 32/minRow 26/maxRow 52) on open, reachable ground, so
// `reachableAdjacent` (the hidden determinism trap in tilePlaceable) holds for every scenario here.

test('a campfire fixture placed inside the base zone appears in state().campfires', async ({
  page,
}) => {
  await startGame(page);
  const { campfireIds } = await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]],
  });

  expect(campfireIds.length).toBe(1);
  const s = await state(page);
  expect(s.campfires.length).toBe(1);
  expect(s.campfires[0]).toMatchObject({ col: 22, row: 38 });
});

test('tryPlace is blocked outside the base zone and allowed inside it', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [22, 40], inventory: { wood: 40, stone: 40 } });

  const before = await state(page);
  const woodBefore = await held(page, 'wood');
  const stoneBefore = await held(page, 'stone');

  // Outside BASE_ZONE (row 5 < minRow 26) — rejected by the isInBase gate.
  const placedOutside = await tryPlace(page, 'campfire', 22, 5);
  expect(placedOutside).toBe(false);

  const afterOutside = await state(page);
  expect(afterOutside.sites).toBe(before.sites);
  expect(await held(page, 'wood')).toBe(woodBefore);
  expect(await held(page, 'stone')).toBe(stoneBefore);

  // Inside BASE_ZONE, reachable from the player — accepted.
  const placedInside = await tryPlace(page, 'campfire', 22, 42);
  expect(placedInside).toBe(true);
});

test('night reveals a hole around a lit campfire (nightAlpha + inLight), no enemy-visibility check', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]],
    startPhase: 'night',
  });

  const s = await state(page);
  expect(s.nightAlpha).toBeGreaterThan(0);
  expect(s.campfires[0].lit).toBe(true);
  expect(await inLight(page, 22, 39)).toBe(true); // adjacent to the fire
  expect(await inLight(page, 22, 5)).toBe(false); // far away
});

test('fuel drains to 0 (douses) then feeding wood relights it', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]],
    campfireFuel: 1, // near-empty — a short step exhausts it rather than the full ~120s tank
    inventory: { wood: 5 },
  });

  await step(page, 1200); // 1 fuel - 1/s * 1.2s -> clamped to 0

  const drained = await state(page);
  expect(drained.campfires[0].fuel).toBe(0);
  expect(drained.campfires[0].lit).toBe(false);

  const woodBefore = await held(page, 'wood');
  const fed = await feedCampfire(page, 0);
  expect(fed).toBe(true);

  const relit = await state(page);
  expect(relit.campfires[0].fuel).toBeGreaterThan(0);
  expect(relit.campfires[0].lit).toBe(true);
  expect(await held(page, 'wood')).toBe(woodBefore - 1);
});
