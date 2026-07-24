import type { Facing } from '../data/tileset';
import type { FacingSpec } from '../entities/types';

/**
 * Map a placement facing to how the barricade wall art renders it (plan 050 Step 2): the sheet
 * ORIENTATION (`down`/`side`/`up`) plus whether to flip horizontally. Left & right both use the
 * `side` sheet — `left` is that sheet mirrored (`flipX`). Pure + shared so the pre-placement ghost
 * ({@link BuildManager}) and the placed wall ({@link WallBehavior}) resolve the SAME orient/flip and
 * cannot drift; extracted verbatim from WallBehavior's `orientOf` + its `setFlipX(facing === 'left')`.
 */
export function wallOrientation(facing: FacingSpec): { orient: Facing; flipX: boolean } {
  const orient: Facing = facing === 'up' ? 'up' : facing === 'down' ? 'down' : 'side';
  return { orient, flipX: facing === 'left' };
}
