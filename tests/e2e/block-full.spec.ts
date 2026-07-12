import { test, expect } from '@playwright/test';
import { startGame, applyScenario, order, step, state, held } from './harness';
import { INVENTORY_SLOTS } from '../../src/config';
import { ITEMS } from '../../src/data/items';

// Tier-2: block-harvest when the bag is full must ABORT the order, not merely skip the per-hit yield.
// The harvest task only completes at the node's hp<=0, so a no-op hit would leave the worker swinging
// forever on a node it can never fell, jamming the queue head (plan 008 critique #1). This asserts
// BOTH halves: (a) the item count is unchanged, and (b) the task queue goes idle.
test('a full bag blocks the harvest and idles the worker (no jammed queue)', async ({ page }) => {
  await startGame(page);
  const full = INVENTORY_SLOTS * ITEMS.wood.maxStack; // every slot maxed out with wood
  const { treeIds } = await applyScenario(page, {
    player: [3, 3],
    trees: [[5, 3]],
    inventory: { wood: full },
  });

  await order(page, { kind: 'harvest', treeId: treeIds[0] });
  await step(page, 6000); // long enough for a full walk + several chop intervals, had it started

  expect(await held(page, 'wood')).toBe(full); // (a) yield blocked — count unchanged
  const s = await state(page);
  expect(s.currentKind).toBeNull(); // (b) order aborted — worker idle, not stuck swinging
  expect(s.pending).toBe(0);
});
