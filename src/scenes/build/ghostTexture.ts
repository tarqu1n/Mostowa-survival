import type Phaser from 'phaser';
import { BUILDABLES } from '../../data/buildables';
import {
  barricadeDestroyKey,
  campfireBaseKey,
  CAMPFIRE_BASE_TILES,
  spikeTrapKey,
  SPIKE_TRAP_ARMED_FRAME,
} from '../../data/tileset';
import { parseAssetId } from '../../render/assetPaths';
import { resolveDecorDraw } from '../../render/decorSprites';
import { wallOrientation } from '../../systems/wallOrientation';
import type { FacingSpec } from '../../entities/types';

/** The wall art carries no `originY`/`tilesTall` in data — WallBehavior renders it bottom-anchored
 *  ~3 tiles tall so its ~23px of visible stakes read ~1 tile on the footprint (see WallBehavior's
 *  WALL_ORIGIN_Y/WALL_TILES_TALL). The ghost mirrors those defaults so its preview stands like the
 *  placed wall. */
const WALL_GHOST_ORIGIN_Y = 0.95;
const WALL_GHOST_TILES_TALL = 3;

/** How to render a buildable's pre-placement ghost: its in-world texture key (+ optional frame), the
 *  orientation flip, and the bottom-anchor/height so the preview sits like the placed structure. */
export interface GhostTexture {
  key: string;
  frame?: string | number;
  flipX: boolean;
  originY: number;
  tilesTall: number;
}

/**
 * Resolve the pre-placement ghost's texture/frame + orient/anchor for a buildable at a placement
 * facing (plan 050 Step 2). Reuses each buildable's IN-WORLD texture so the ghost previews the real
 * structure rather than a flat rect: the orientable wall reads the barricade Destroy sheet's intact
 * frame 0 (oriented + flipped through the shared {@link wallOrientation}, so ghost + placed wall can't
 * drift); the campfire its stone-ring base, the trap its armed spike frame, the workbench its static
 * object-region crop. Non-orientable buildables never flip. `undefined` if the source texture isn't
 * resident (caller keeps a fallback) — shouldn't happen, since PreloadScene loads every structure
 * texture, but the workbench crop shares the "texture not resident → skip" path with WorkbenchBehavior.
 */
export function ghostTextureFor(
  scene: Phaser.Scene,
  buildableId: string,
  facing: FacingSpec,
): GhostTexture | undefined {
  const def = BUILDABLES[buildableId];

  // Orientable buildable (the wall): the barricade Destroy sheet's intact frame 0, oriented + flipped
  // via the shared mapping (the SAME orient/flip WallBehavior renders from — no drift).
  if (def.orientable) {
    const { orient, flipX } = wallOrientation(facing);
    return {
      key: barricadeDestroyKey(orient),
      frame: 0,
      flipX,
      originY: def.originY ?? WALL_GHOST_ORIGIN_Y,
      tilesTall: def.tilesTall ?? WALL_GHOST_TILES_TALL,
    };
  }

  const originY = def.originY ?? 1;
  const tilesTall = def.tilesTall ?? 1;

  // Static object-region crop (the workbench) — resolved through the shared decor path, exactly as
  // WorkbenchBehavior.materialise does, so the ghost shows the real bench crop.
  if (def.objectSprite) {
    let path: string;
    try {
      ({ path } = parseAssetId(def.objectSprite.asset));
    } catch {
      return undefined; // malformed asset id — validated at authoring time; skip defensively
    }
    const draw = resolveDecorDraw(
      scene,
      {
        id: buildableId,
        asset: def.objectSprite.asset,
        ...(def.objectSprite.region ? { region: def.objectSprite.region } : {}),
      },
      path,
    );
    if (!draw) return undefined;
    return draw.kind === 'region'
      ? { key: draw.key, frame: draw.frame, flipX: false, originY, tilesTall }
      : { key: draw.key, flipX: false, originY, tilesTall }; // 'whole'; 'anim' never occurs here
  }

  // Animated live buildables — preview their primary in-world frame (a static frame, not the anim):
  // the campfire's stone-ring base, the trap's armed spike frame.
  if (def.animKey === 'campfire') {
    // The base scales to CAMPFIRE_BASE_TILES, NOT the buildable's `tilesTall` (that's the taller flame
    // height) — matching CampfireBehavior.materialise so the ghost's base can't out-size the built one.
    return {
      key: campfireBaseKey(),
      frame: 0,
      flipX: false,
      originY,
      tilesTall: CAMPFIRE_BASE_TILES,
    };
  }
  if (def.animKey === 'spikeTrap') {
    return { key: spikeTrapKey(), frame: SPIKE_TRAP_ARMED_FRAME, flipX: false, originY, tilesTall };
  }

  return undefined;
}
