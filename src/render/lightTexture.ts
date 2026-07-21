import Phaser from 'phaser';

/**
 * Bakes a soft radial-gradient **light brush** into a cached canvas texture **once** — the erase
 * stamp {@link SurvivalClock} punches into its screen-covering night light-layer RenderTexture (plan
 * 039 Step 2). White centre (alpha 1) fading to fully transparent at the rim: erased into the dark
 * overlay with a `destination-out` blend, it clears the night fully at the core and not at all at the
 * rim, so a lit fire reveals a SOFT disc that "dims to black" — no hard ring, unlike the old inverted
 * geometry mask (binary in/out, a gradient was impossible).
 *
 * Mirrors {@link bakeGlowTexture} exactly: a 2D-canvas bake behind a module cache Map (so every
 * consumer shares one texture, and it survives `GameScene` death-restarts — the global TextureManager
 * outlives the scene), added via `scene.textures.addCanvas`. Works identically on WebGL and Canvas —
 * no feature-detect fork. See docs/RENDERING.md ("light layer").
 */
export interface LightBrush {
  /** Phaser texture key of the baked brush canvas. */
  key: string;
  /** Brush canvas edge length (px). The stamp is a `size×size` square; the gradient reaches `size/2`
   *  from the centre, so a light of world-radius `r` scales the stamp by `2·r / size`. */
  size: number;
}

// Cached per brush size so the bake runs once and survives GameScene death-restarts (the global
// TextureManager outlives the scene, as does this map). Mirrors glowTexture.ts's cache.
const cache = new Map<string, LightBrush>();

/** Default brush resolution — high enough that scaling down to a fire's on-screen radius stays smooth,
 *  small enough to bake instantly. */
const DEFAULT_BRUSH_SIZE = 256;

/**
 * Bake (or return the cached) light brush. The falloff is tuned for a pleasing "bright core → dim to
 * black": the core holds near-full out to ~half the radius (so the clearly-lit ground reads as lit —
 * this is also where the base-claim `CLAIM_LIGHT_FRAC` core sits), then a smooth shoulder fades to
 * fully transparent at the rim so the reveal has no hard edge. Requires a 2D canvas (holds under Vite
 * dev, the Pages build, and the headless smoke's real browser).
 */
export function bakeLightBrush(scene: Phaser.Scene, size: number = DEFAULT_BRUSH_SIZE): LightBrush {
  const key = `light-brush:${size}`;
  const cached = cache.get(key);
  if (cached && scene.textures.exists(cached.key)) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); // core: fully clears the night
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)'); // hold a bright-ish core out to half-radius
  grad.addColorStop(0.8, 'rgba(255,255,255,0.33)'); // shoulder — the "dim" band
  grad.addColorStop(1, 'rgba(255,255,255,0)'); // rim: no erase → stays black (soft, no ring)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);

  const result: LightBrush = { key, size };
  cache.set(key, result);
  return result;
}
