/**
 * Pure geometry for the reference-underlay auto-align (plan 022 step 2) — no Phaser, no
 * localStorage, no editor deps (kept free of `config.ts`'s `TILE_SIZE` so it stays trivially
 * unit-testable; the caller passes `tileSize` in). Two halves: `parseSidecar` defensively narrows
 * the raw `unknown` JSON `getMapReferenceSidecar` (`api.ts`) returns down to the small subset this
 * module needs, then `computeAutoAlign` turns that (plus the actual loaded image size) into a
 * scale/offset the editor can apply to the underlay sprite.
 */

/** The subset of the capture tool's sidecar (`scripts/map-reference/capture.mjs`,
 *  `<name>-reference.json`) this module reads — the real file also carries `name`/`source`/
 *  `center`/`metresPerTile`/`bbox`/etc, all ignored here. */
export interface Sidecar {
  pxPerTile: number;
  image: { w: number; h: number };
  grid: { w: number; h: number };
}

/** Narrow untrusted JSON to a `Sidecar`, or `null` if any required field is missing/wrong-typed —
 *  never throws. `Number.isFinite` rejects `NaN`/`Infinity`; `pxPerTile` is additionally required to
 *  be `> 0` (a zero/negative value would make `computeAutoAlign`'s division nonsensical, so treat it
 *  as an invalid sidecar rather than propagate an `Infinity` scale). */
export function parseSidecar(json: unknown): Sidecar | null {
  if (typeof json !== 'object' || json === null) return null;
  const obj = json as Record<string, unknown>;

  const pxPerTile = obj.pxPerTile;
  if (typeof pxPerTile !== 'number' || !Number.isFinite(pxPerTile) || pxPerTile <= 0) return null;

  const image = obj.image;
  if (typeof image !== 'object' || image === null) return null;
  const imageW = (image as Record<string, unknown>).w;
  const imageH = (image as Record<string, unknown>).h;
  if (typeof imageW !== 'number' || !Number.isFinite(imageW)) return null;
  if (typeof imageH !== 'number' || !Number.isFinite(imageH)) return null;

  const grid = obj.grid;
  if (typeof grid !== 'object' || grid === null) return null;
  const gridW = (grid as Record<string, unknown>).w;
  const gridH = (grid as Record<string, unknown>).h;
  if (typeof gridW !== 'number' || !Number.isFinite(gridW)) return null;
  if (typeof gridH !== 'number' || !Number.isFinite(gridH)) return null;

  return { pxPerTile, image: { w: imageW, h: imageH }, grid: { w: gridW, h: gridH } };
}

export interface AutoAlign {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Set only when the loaded image's actual pixel size doesn't match the sidecar's recorded
   *  `image.{w,h}` — a stale/wrong-sized reference image (the sidecar's real value here; the
   *  capture tool authors `pxPerTile === TILE_SIZE`, so scale is usually just `1`). */
  warning?: string;
}

/** Auto-align an underlay image against the tile grid. With a sidecar: `scale = tileSize /
 *  sidecar.pxPerTile` (typically `1`, since the capture tool authors `pxPerTile === TILE_SIZE`) and
 *  a zero offset — the image is assumed captured flush with the grid origin — plus a `warning` if
 *  the actually-loaded `imageW`/`imageH` disagree with what the sidecar recorded. Without a sidecar,
 *  fall back to an identity `{ scale: 1, offsetX: 0, offsetY: 0 }` (no warning — there's nothing to
 *  compare against). */
export function computeAutoAlign(opts: {
  sidecar?: Sidecar | null;
  imageW: number;
  imageH: number;
  tileSize: number;
}): AutoAlign {
  const { sidecar, imageW, imageH, tileSize } = opts;
  if (!sidecar) return { scale: 1, offsetX: 0, offsetY: 0 };

  const result: AutoAlign = { scale: tileSize / sidecar.pxPerTile, offsetX: 0, offsetY: 0 };
  if (imageW !== sidecar.image.w || imageH !== sidecar.image.h) {
    result.warning =
      `Reference image is ${imageW}×${imageH}px but the sidecar expects ` +
      `${sidecar.image.w}×${sidecar.image.h}px — it may be stale or the wrong file.`;
  }
  return result;
}
