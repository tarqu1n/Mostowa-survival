import { test, expect } from '@playwright/test';
import { step, state, blocked, tileToClient } from './harness';

// Tier-2 regression: starting the game from the title screen must NOT leak its click onto the map.
//
// MainMenu calls scene.start('Game') on pointerdown; GameScene resolves move/harvest orders on
// pointerup. So a single title-screen tap splits across the scene boundary — the down starts the
// world, the paired release lands on the freshly-created GameScene and used to resolve as a stray
// move order. GameScene now ignores any pointerup whose matching pointerdown it never saw.
//
// The leak only reproduces when GameScene.create() (which registers the pointer handlers) runs
// BETWEEN the down and the up — so we hold the press, wait for the world to boot, THEN release.
// The harness's startGame() clicks dead-centre, which maps to the player's own tile (a no-op move),
// which is exactly why this hid in every other spec; here we press off-centre so a leak would move.
test('tapping the title screen to start does not issue a move order on the map', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });
  // Wait for MainMenu to be ACTIVE, not merely isBooted: isBooted flips long before MainMenu.create()
  // registers its "tap to start" pointerdown listener, so pressing straight after isBooted races that
  // gap and the boundary-press below gets dropped (game never starts → __test times out). Gating on the
  // active scene mirrors harness.bootIntoGame's await-ready and removes that flake under parallel load.
  await page.waitForFunction(() => (window as any).game?.scene?.isActive('MainMenu'), null, {
    timeout: 15_000,
  });

  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('game canvas not found');
  // Off-centre, below the player: far enough that a leaked release would path somewhere off the
  // player's own tile (the camera centres on spawn, so this maps to open ground below the player).
  const p = { x: box.x + box.width / 2, y: box.y + box.height * 0.72 };

  await page.mouse.move(p.x, p.y);
  await page.mouse.down(); // MainMenu → scene.start('Game') fires here
  // Let the real rAF loop boot GameScene: create() installs __test and registers the pointer gate.
  await page.waitForFunction(() => (window as any).game?.__test != null, null, { timeout: 15_000 });
  // Capture the actual spawn from the live world (the authored map owns it — don't hardcode a tile
  // that a map edit can silently move); no order has been issued yet, so this is the resting spawn.
  const spawn = await state(page);
  await page.mouse.up(); // the paired release now lands on the live world — the exact bug condition
  await step(page, 32); // switch to manual stepping and process the release

  const afterStart = await state(page);
  expect(afterStart.currentKind).toBeNull(); // no order was issued
  expect(afterStart.pending).toBe(0);
  expect(afterStart.pathLen).toBe(0);
  expect({ col: afterStart.pcol, row: afterStart.prow }).toEqual({
    col: spawn.pcol,
    row: spawn.prow,
  }); // unmoved

  // Self-validation: a deliberate tap on an open tile near spawn, once the world is running, DOES issue
  // a move — proving the silence above was the guard dropping the leaked release, not a dead click onto
  // the player's own/unwalkable tile. Pick the first walkable candidate near spawn (map-agnostic).
  let tcol = spawn.pcol;
  let trow = spawn.prow;
  for (const [dc, dr] of [
    [0, 3],
    [0, -3],
    [3, 0],
    [-3, 0],
  ] as const) {
    if (!(await blocked(page, spawn.pcol + dc, spawn.prow + dr))) {
      tcol = spawn.pcol + dc;
      trow = spawn.prow + dr;
      break;
    }
  }
  const target = await tileToClient(page, tcol, trow);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await step(page, 16);
  await page.mouse.up();
  await step(page, 16);

  expect((await state(page)).currentKind).toBe('move');
});
