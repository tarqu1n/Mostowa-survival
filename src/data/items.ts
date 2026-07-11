/**
 * Item catalogue. Keyed by item id; add new items here, not in gameplay code.
 */

import type { ItemDef } from './types';

export const ITEMS: Record<string, ItemDef> = {
  wood: { id: 'wood', name: 'Wood', color: 0x8a5a2b },
};
