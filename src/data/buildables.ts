/**
 * Buildable catalogue. Keyed by buildable id; add new placeable structures here.
 */

import type { BuildableDef } from './types';

export const BUILDABLES: Record<string, BuildableDef> = {
  wall: { id: 'wall', name: 'Wall', cost: { wood: 2 }, color: 0x6b6b6b },
};
