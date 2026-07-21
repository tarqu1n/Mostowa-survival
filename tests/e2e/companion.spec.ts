import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  state,
  companion,
  setNpcDayRole,
  setNpcNightPosture,
  step,
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

// Tier-2 (plan 042 Step 4): the companion's OWN gather loop through the REAL scene — its slimmed
// executor (own TaskQueue, never GameScene.queue) walks to the nearest wood/rock node, fells it via the
// shared ResourceNodeManager.chop path (yield redirected into its carry buffer, NOT the player's bag),
// then deposits the buffer into the shared base-supply pool. Driven deterministically with step().
test('a gather-role companion chops a tree by day and deposits wood into base supply', async ({
  page,
}) => {
  await startGame(page);

  // Player at [3,3]; companion two tiles east of a lone tree, in gather role, by day; empty stockpile.
  // No campfire in this scenario, so the deposit exercises the documented no-lit-hearth fallback
  // (the base-supply store is global — deposit in place). Coords sit in the proven-walkable row-3 band
  // the chop/queue specs use.
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], dayRole: 'gather' },
    trees: [[6, 3]],
    startPhase: 'day',
    baseSupply: { wood: 0 },
  });

  // Baseline: nothing banked, nothing carried yet.
  expect((await state(page)).baseSupply).toEqual({ wood: 0, rock: 0 });

  // Short walk to the tree + 3 chop intervals (maxHp 3) + a deposit — well inside this budget.
  await step(page, 6000);

  const s = await state(page);
  expect(s.baseSupply.wood).toBeGreaterThan(0); // it chopped and banked wood
  expect(s.baseSupply.wood).toBe(3); // whole tree (maxHp 3 × 1 wood/hit) deposited
  expect(s.companion?.carry).toBe(0); // carry buffer emptied by the deposit (accrued, then reset)
  expect(s.baseSupply.rock).toBe(0); // gather only touched the wood node
});
