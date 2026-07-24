import { test, expect } from '@playwright/test';
import { startGame, applyScenario, stepLogic, state } from './harness';
import { SPAWN_TILE } from '../../src/config';

// Tier-2: player death → scene restart. An enemy stood adjacent chips the player's HP down over
// repeated contact hits (1s cooldown each); at 0 HP GameScene.scene.restart() re-runs create(),
// resetting the world to its boot fixtures (player back at spawn centre, full HP, default spawns).
test('the player dying restarts the scene and resets the world', async ({ page }) => {
  // 14000ms of driven `stepLogic()` = ~840 fixed frames — was the heaviest test in the suite under
  // the old render-every-slice `step()`. stepLogic() (plan 045) drops the draw entirely; re-timed
  // (plan 045 Step 2) at ~4.0s cold, so the timeout is right-sized with headroom, not the old
  // render-cost estimate.
  test.setTimeout(15_000);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));

  await startGame(page);
  await applyScenario(page, { player: [11, 20], enemies: [[11, 21]] }); // enemy adjacent, aggroed instantly

  // 10 HP × 1 dmg on a 1s contact cooldown → ~10s to die, then the restart. Drive well past that.
  await stepLogic(page, 14000);

  expect(logs.some((l) => l.includes('restarting'))).toBe(true); // the death→restart signal
  const s = await state(page);
  expect(s.playerHp).toBe(10); // restarted at full HP
  expect(s.pcol).toBe(SPAWN_TILE.col); // player back at the authored spawn (plan 018 runtime map)
  expect(s.prow).toBe(SPAWN_TILE.row);
});
