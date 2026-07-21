import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  state,
  companion,
  setNpcDayRole,
  setNpcNightPosture,
} from './harness';

// Tier-2 (plan 042 Step 2): the CompanionManager + scenario/DebugState scaffolding. Step 2 lands the
// manager + test harness ONLY — no gather/repair/guard/combat behaviour yet (Steps 4-8). So these
// specs assert lifecycle + round-trip, the thing downstream steps build their e2e on: a scenario can
// place the single companion and seed its scaffold state, `debugState().companion` reads it back, the
// `setNpc*` dev seams mutate it, and an absent companion reads back as null with a zeroed baseSupply.
// Driven with no step()/emit beyond the scenario apply, so it stays deterministic.

test('a scenario places the companion + reads its scaffold state back via debugState().companion', async ({
  page,
}) => {
  await startGame(page);

  await applyScenario(page, {
    player: [10, 10],
    companion: {
      at: [12, 10],
      dayRole: 'repair',
      nightPosture: 'guard',
      guardAt: [13, 10],
      hp: 5,
      downed: false,
    },
    baseSupply: { wood: 3, rock: 2 },
  });

  expect(await companion(page)).toEqual({
    col: 12,
    row: 10,
    dayRole: 'repair',
    nightPosture: 'guard',
    hp: 5,
    downed: false,
    carry: 0, // no gather behaviour yet — the buffer starts empty (Step 4+ fills it)
  });

  expect((await state(page)).baseSupply).toEqual({ wood: 3, rock: 2 });
});

test('a scenario with no companion reads back null + a zeroed baseSupply', async ({ page }) => {
  await startGame(page);

  await applyScenario(page, { player: [10, 10] });

  const s = await state(page);
  expect(s.companion).toBeNull();
  expect(s.baseSupply).toEqual({ wood: 0, rock: 0 });
});

test('the setNpc* dev seams mutate the placed companion (round-trips through debugState)', async ({
  page,
}) => {
  await startGame(page);

  await applyScenario(page, {
    player: [10, 10],
    companion: { at: [12, 10] }, // defaults: dayRole 'gather', nightPosture 'follow'
  });

  expect(await companion(page)).toMatchObject({ dayRole: 'gather', nightPosture: 'follow' });

  await setNpcDayRole(page, 'repair');
  await setNpcNightPosture(page, 'refuel');

  expect(await companion(page)).toMatchObject({ dayRole: 'repair', nightPosture: 'refuel' });
});
