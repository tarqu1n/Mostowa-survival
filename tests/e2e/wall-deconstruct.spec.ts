import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  step,
  blocked,
  walls,
  wood,
  tryPlace,
  deconstructWall,
} from './harness';

// Tier-2 (plan 037 chunk 2b): players remove a wall by a worker DECONSTRUCT order, never by combat
// (decision #6). Build a wall the real way (spends its {wood:2} cost), then enqueue a deconstruct: the
// worker walks adjacent, removes the wall, frees its tile, and a PARTIAL refund is credited back
// (floor(cost.wood 2 × 0.5) = 1 wood). Driven only by step(), so it's deterministic. Uses the same
// small open-ground tiles the build/chop specs place on (player [3,3], wall [4,3] — proven walkable).

test('a worker deconstruct order removes a wall, frees its tile, and refunds part of its cost', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [3, 3], wood: 5 });

  // Build the wall the real way — tryPlace spends {wood:2}, blueprints it, and enqueues the build.
  expect(await tryPlace(page, 'wall', 4, 3)).toBe(true);
  await step(page, 4000); // BUILD_MS 2500 + approach → the wall materialises + blocks its tile
  let w = await walls(page);
  expect(w.length).toBe(1);
  expect(await blocked(page, 4, 3)).toBe(true);

  // Deconstruct: a worker order (walk adjacent → remove + refund), driven under step().
  const woodBefore = await wood(page);
  expect(await deconstructWall(page, 0)).toBe(true);
  await step(page, 1500); // worker reaches the wall + removes it

  // Wall gone from the collection, its tile passable again, and the partial refund credited.
  w = await walls(page);
  expect(w.length).toBe(0);
  expect(await blocked(page, 4, 3)).toBe(false); // tile freed for pathing/occupancy
  expect(await wood(page)).toBe(woodBefore + 1); // floor(cost.wood 2 × DECONSTRUCT_REFUND_FRACTION 0.5)
});
