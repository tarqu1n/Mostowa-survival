import { test, expect } from '@playwright/test';
import { startGame, applyScenario, order, step, state } from './harness';
import type { ScenarioSpec } from '../../src/entities/testTypes';

/**
 * Tier-2 regression guard for the "player hugs the tile edge and gets stuck walking into walls" bug.
 * Root cause was the collision body being anchored at the sprite's feet — ~6px below the logical point
 * `tile()`/pathing use — so it straddled into the tile ROW BELOW and clipped walls the pathfinder had
 * legally routed around (Character.fitBody now centres the body on that point). Each layout orders a
 * move to a tile on the FAR side of a wall obstacle and asserts the worker actually gets there rather
 * than jamming against a wall mid-path.
 */

interface Layout {
  name: string;
  spec: ScenarioSpec;
  target: [number, number];
}

const LAYOUTS: Layout[] = [
  // Wall column with an opening below: the path must round the bottom corner and run wall-adjacent.
  {
    name: 'route around a wall',
    spec: {
      player: [10, 12],
      walls: [
        [12, 10],
        [12, 11],
        [12, 12],
        [12, 13],
      ],
    },
    target: [14, 12],
  },
  // Single wall diagonally between start and goal — exercises the diagonal corner rule.
  {
    name: 'detour past a diagonal corner',
    spec: { player: [10, 10], walls: [[11, 11]] },
    target: [12, 12],
  },
  // A 1-tile gap flanked by walls above and below: the classic squeeze-through the body used to clip.
  {
    name: 'through a one-tile doorway',
    spec: {
      player: [10, 12],
      walls: [
        [12, 10],
        [12, 11],
        [12, 13],
        [12, 14],
      ],
    },
    target: [14, 12],
  },
];

for (const layout of LAYOUTS) {
  test(`worker reaches a far-side target: ${layout.name}`, async ({ page }) => {
    await startGame(page);
    await applyScenario(page, layout.spec);

    await order(page, { kind: 'move', col: layout.target[0], row: layout.target[1] });

    // Step until the move order finishes, or bail after a generous budget so a jam surfaces as a
    // failed reach rather than a hang.
    for (let t = 0; t < 8000 && (await state(page)).currentKind === 'move'; t += 200) {
      await step(page, 200);
    }

    const s = await state(page);
    expect(s.currentKind).toBeNull(); // order completed, not still grinding
    expect({ col: s.pcol, row: s.prow }).toEqual({ col: layout.target[0], row: layout.target[1] });
  });
}
