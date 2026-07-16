import type { AuthoredNodeDef } from '../../../../systems/nodeDefs';

/**
 * Frozen single-skin seed registry (`tree`/`rock`/`berryBush`) used by the editor-store tests.
 *
 * These tests assert on skin counts, auto-generated skin ids (`addSkin` → `skin`), roll/cycle
 * behaviour, and `duplicateNodeDef` output — all of which depend on the defs being single-skin.
 * The tests once read the live `src/data/maps/nodes.json`, but that file carries real authored
 * content: the moment a def there gains a second skin (as `tree` since has), every skin-count
 * assumption breaks. This fixture is the committed shape frozen in place, so content edits to the
 * shipped defs can never break the unit tests again.
 */
export const NODE_DEFS_SEED: AuthoredNodeDef[] = [
  {
    id: 'tree',
    name: 'Tree',
    maxHp: 3,
    yieldItemId: 'wood',
    yieldPerHit: 1,
    regrowMs: 15000,
    blocksPath: true,
    color: 3104052,
    stumpColor: 5914408,
    originX: 0.5,
    originY: 0.92,
    standOffsets: [
      [1, 0],
      [-1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ],
    skins: [{ id: 'default', asset: 'pixel-crawler/_derived/tree_pine.png' }],
  },
  {
    id: 'rock',
    name: 'Rock',
    maxHp: 4,
    yieldItemId: 'stone',
    yieldPerHit: 1,
    regrowMs: 30000,
    blocksPath: true,
    harvestAnim: 'mine',
    color: 9079434,
    stumpColor: 5921370,
    originX: 0.5,
    originY: 0.8,
    skins: [{ id: 'default', asset: 'pixel-crawler/_derived/rock.png' }],
  },
  {
    id: 'berryBush',
    name: 'Berry Bush',
    maxHp: 1,
    yieldItemId: 'berries',
    yieldPerHit: 2,
    regrowMs: 20000,
    blocksPath: false,
    harvestAnim: 'gather',
    color: 4156724,
    stumpColor: 4872762,
    originX: 0.5,
    originY: 0.72,
    skins: [{ id: 'default', asset: 'pixel-crawler/_derived/bush.png' }],
  },
];
