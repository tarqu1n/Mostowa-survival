import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state } from './harness';
import { oneZombie } from './scenarios';

// Tier-2: the monster AI FSM (systems/monsterAI) wired through the real GameScene — the Phase-A
// review gate. The FSM's decision logic is unit-tested in isolation (systems/__tests__/monsterAI);
// these prove the scene drives it end-to-end: radius acquire → chase, distance-only give-up past the
// drop radius, and a patrol route cycling its waypoints. Mode + tiles are read from debugState.

test('a monster within vision acquires and enters chase', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, oneZombie()); // player [10,10], zombie two tiles east (32px ≤ 80px vision)

  await step(page, 500); // one AI tick is enough — acquire is immediate within radius
  const s = await state(page);
  expect(s.zombies).toBe(1);
  expect(s.zombieModes).toContain('chase');
});

test('a chasing monster gives up when the player escapes past the drop radius', async ({ page }) => {
  await startGame(page);
  // Zombie spawned already chasing, 8 tiles (128px) south of the player — INSIDE the drop radius
  // (MONSTER_CHASE_DROP_RADIUS_PX 200px) but OUTSIDE vision (80px). So it's a genuine in-band chase
  // that an idle monster would NOT have acquired at this range — asserting 'chase' below distinguishes
  // the two. Combat mode so we can drive the (2× faster) player away on the movepad.
  await applyScenario(page, { player: [10, 40], mode: 'combat', zombies: [{ at: [10, 48], mode: 'chase' }] });

  await step(page, 100); // stops the live RAF loop + settles one deterministic tick
  expect((await state(page)).zombieModes).toEqual(['chase']); // still chasing at 128px (an idle monster wouldn't be)

  // Sprint north, away from the pursuer. Player 90px/s vs zombie 45px/s → the gap opens ~45px/s and
  // soon exceeds the 200px drop radius, so distance-only de-aggro fires.
  await emit(page, 'combat:move', { dx: 0, dy: -1 });
  await step(page, 4000);

  expect((await state(page)).zombieModes).not.toContain('chase'); // lost the scent → gave up
});

test('a patrol-route monster cycles its waypoints', async ({ page }) => {
  await startGame(page);
  // Player far away (never within the 80px vision), so the monster stays calm and patrols. Route is a
  // 2-tile horizontal hop on the known-clear row-10 band; it spawns ON waypoint 0 (the natural authoring
  // pattern) to also exercise the same-tile-first-waypoint path.
  await applyScenario(page, {
    player: [40, 40],
    zombies: [{ at: [10, 10], patrolRoute: [[10, 10], [12, 10]] }],
  });

  const cols: number[] = [];
  const modes: string[] = [];
  for (let i = 0; i < 24; i++) {
    await step(page, 400); // ~9.6s total — several out-and-back cycles (pause 1s + ~0.7s travel each leg)
    const s = await state(page);
    cols.push(s.zombieTiles[0].col);
    modes.push(s.zombieModes[0]);
  }

  expect(modes).toContain('patrol'); // it actually entered patrol
  expect(modes).not.toContain('chase'); // never spotted the far player
  // Reached the far waypoint (col 12) and later returned toward the near one (col 10) → a full cycle,
  // proving it advances waypoints rather than stalling on its start tile.
  const firstAt12 = cols.indexOf(12);
  expect(firstAt12).toBeGreaterThanOrEqual(0);
  expect(cols.slice(firstAt12).some((c) => c <= 10)).toBe(true);
});
