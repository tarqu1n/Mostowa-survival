import { BUILD_MS } from '../config';
import type { BuildableDef } from '../data/types';

/**
 * On-site worker build time (ms) for a buildable: its per-def `buildTimeMs`, else the global
 * `BUILD_MS` fallback. Pure (no Phaser) so the build accumulator can be tuned per-buildable while
 * timing stays centralised — see `GameScene.runBuild` (plan 050 Step 1).
 */
export function buildTimeFor(def: Pick<BuildableDef, 'buildTimeMs'>): number {
  return def.buildTimeMs ?? BUILD_MS;
}
