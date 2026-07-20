import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state, setPlayerMelee } from './harness';
import { ATTACK_COOLDOWN_MS } from '../../src/config';

// Tier-2 (plan 036): the reach/arc melee footprint through the real scene. The tile geometry is
// Tier-1 (systems/hurtbox.attackTiles); these prove GameScene.attack reads the equipped weapon's
// shape and hits exactly the tiles it covers. Determinism: player + kidZombie both dodge 0, so every
// resolveMeleeAttack lands (hitChance 100); the demo weapons deal 1 dmg and kidZombie has maxHp 3, so
// a single swing never kills — we assert hits via `enemyHitFlashes` (a survived hit flashes) and the
// live `enemies` count (a miss leaves it unchanged). Enemies are spawned `idle` so they stay put
// across the driven steps and the geometry under test doesn't drift.

test('reach: a spear hits an enemy two tiles ahead that unarmed cannot reach (plan 036)', async ({
  page,
}) => {
  await startGame(page);
  // Player faces right at [10,10]; enemy two tiles ahead at [12,10]. Unarmed = single front tile
  // ([11,10]) → out of reach. Spear = line reach 2 ([11,10],[12,10]) → reaches it.
  await applyScenario(page, {
    player: [10, 10],
    facing: 'right',
    mode: 'combat',
    enemies: [{ at: [12, 10], mode: 'idle' }],
  });
  expect((await state(page)).enemies).toBe(1);

  // Unarmed swing: the front tile is [11,10], the enemy is at [12,10] → no hit.
  await emit(page, 'combat:attack');
  await step(page, 50);
  let s = await state(page);
  expect(s.enemies).toBe(1); // still alive
  expect(s.enemyHitFlashes).toBe(0); // nothing was struck

  // Clear the melee cooldown, equip the spear, swing again: reach 2 now covers [12,10].
  await step(page, ATTACK_COOLDOWN_MS + 20);
  await setPlayerMelee(page, 'spear');
  await emit(page, 'combat:attack');
  await step(page, 50);
  s = await state(page);
  expect(s.enemies).toBe(1); // spear deals 1, kidZombie hp 3 → survives the single hit
  expect(s.enemyHitFlashes).toBe(1); // …but it WAS struck — the spear reached two tiles out
});

test('cleave: a cleaver strikes both flank tiles in one swing (plan 036)', async ({ page }) => {
  await startGame(page);
  // Player faces right at [10,10]; cleaver = wide reach 1 → covers [11,10] + the two flanks
  // [11,9] and [11,11]. Enemies sit on the two flank tiles, so one swing must hit BOTH.
  await applyScenario(page, {
    player: [10, 10],
    facing: 'right',
    mode: 'combat',
    melee: 'cleaver', // spawn already holding it (exercises the ScenarioSpec.melee seam)
    enemies: [
      { at: [11, 9], mode: 'idle' },
      { at: [11, 11], mode: 'idle' },
    ],
  });
  expect((await state(page)).enemies).toBe(2);

  await emit(page, 'combat:attack');
  await step(page, 50);
  const s = await state(page);
  expect(s.enemies).toBe(2); // 1 dmg each, kidZombie hp 3 → both survive
  expect(s.enemyHitFlashes).toBe(2); // …but BOTH were struck in the single swing — the cleave landed
});

test('unarmed stays narrow: a flank enemy is not hit bare-handed (plan 036)', async ({ page }) => {
  await startGame(page);
  // Guards the default. Player faces right; unarmed = single front tile ([11,10]). The lone enemy sits
  // on the upper flank tile ([11,9]) a cleaver WOULD catch — unarmed must miss it. (Chosen above the
  // front line, not below: hurtboxes rise upward, so a [11,11] enemy's head would reach into [11,10].)
  await applyScenario(page, {
    player: [10, 10],
    facing: 'right',
    mode: 'combat',
    enemies: [{ at: [11, 9], mode: 'idle' }],
  });

  await emit(page, 'combat:attack');
  await step(page, 50);
  const s = await state(page);
  expect(s.enemies).toBe(1); // untouched
  expect(s.enemyHitFlashes).toBe(0); // the flank tile is outside the single-tile unarmed footprint
});
