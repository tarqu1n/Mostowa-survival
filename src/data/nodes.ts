/**
 * Resource node catalogue. Keyed by node id; add new harvestable nodes here.
 */

import type { ResourceNodeDef } from './types';

export const NODES: Record<string, ResourceNodeDef> = {
  tree: {
    id: 'tree',
    name: 'Tree',
    maxHp: 3,
    woodItemId: 'wood',
    woodPerHit: 1,
    regrowMs: 15000,
    color: 0x2f5d34,
    stumpColor: 0x5a3f28,
  },
};
