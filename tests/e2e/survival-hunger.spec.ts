import { test, expect } from '@playwright/test';
import { startGame, applyScenario, step, state } from './harness';
import { STARVE_DAMAGE_INTERVAL_MS } from '../../src/config';

// Tier-2: hunger drains through the REAL scene's per-frame tick and, at zero, routes STARVE_DAMAGE
// through combat's damagePlayer (plan 003) — proving the starvation→health cascade is wired. The
// clamp/feed/isStarving math is Tier-1 (needs.test.ts); here we drive the integrated loop via step().

test('hunger drains over time', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { hunger: 40 });

  const before = await state(page);
  expect(before.hunger).toBeCloseTo(40, 0); // seeded ~40 (a couple real-time frames may nudge it)

  await step(page, 3000); // 0.4/s × 3s ≈ 1.2 drained

  const after = await state(page);
  expect(after.hunger).toBeLessThan(before.hunger);
});

test('a starving player loses HP', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { hunger: 0 }); // already starving

  const before = await state(page);
  const startHp = before.playerHp;
  expect(startHp).toBeGreaterThan(0);

  await step(page, STARVE_DAMAGE_INTERVAL_MS + 500); // past one starve-damage interval

  const after = await state(page);
  expect(after.playerHp).toBeLessThan(startHp);
});
