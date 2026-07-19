/**
 * Camera-framing helpers (pure — no Phaser). Extracted so the "open a map → frame its authored
 * content, not the empty canvas" logic in `EditorScene.restoreOrFitCamera`/`fitCamera` is unit-testable.
 *
 * Why this exists: a map's tile grid (`meta.width × meta.height`) can be far larger than the region
 * actually painted — the moon map is 245×280 tiles with all content in one ~78×67 blob in the
 * upper-middle. Centring the camera on the *geometric* map centre (or restoring a stale saved camera)
 * can strand the view over blank canvas, so the map "appears empty" on load. These helpers compute the
 * bounding box of real content and test whether a viewport actually shows any of it.
 */

import { type MapFile } from '../systems/mapFormat';

/** A pixel-space axis-aligned box. `min` inclusive, `max` exclusive (max = one past the far edge). */
export interface PxBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Pixel-space bounding box of everything authored on `map` — any non-empty tile on any layer, plus
 * every object (decor/node/portal). Returns `null` when the map has no content at all (a brand-new or
 * fully-erased map), so callers can fall back to framing the whole canvas.
 *
 * Tiles contribute the full cell span `[col·ts, (col+1)·ts)`. Objects: portals use their tile `rect`;
 * decor is placed at its `x,y` *centre* and nodes at their `col,row` tile centre — both are widened to
 * a one-tile box so a lone object still yields a sensibly framable extent (exact sprite size isn't
 * known here and isn't needed for framing).
 */
export function mapContentBoundsPx(map: MapFile, tileSize: number): PxBounds | null {
  const width = map.meta.width;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const addBox = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  };

  for (const layer of map.layers) {
    const cells = layer.cells;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 0) continue; // empty cell
      const col = i % width;
      const row = (i / width) | 0;
      addBox(col * tileSize, row * tileSize, (col + 1) * tileSize, (row + 1) * tileSize);
    }
  }

  for (const obj of map.objects) {
    if (obj.kind === 'portal') {
      const { col, row, w, h } = obj.rect;
      addBox(col * tileSize, row * tileSize, (col + w) * tileSize, (row + h) * tileSize);
    } else if (obj.kind === 'node') {
      const cx = obj.col * tileSize + tileSize / 2;
      const cy = obj.row * tileSize + tileSize / 2;
      addBox(cx - tileSize / 2, cy - tileSize / 2, cx + tileSize / 2, cy + tileSize / 2);
    } else {
      // decor: x,y is the sprite centre (origin 0.5 — see EditorScene.placeDecor)
      addBox(
        obj.x - tileSize / 2,
        obj.y - tileSize / 2,
        obj.x + tileSize / 2,
        obj.y + tileSize / 2,
      );
    }
  }

  if (maxX === -Infinity) return null; // nothing added — empty map
  return { minX, minY, maxX, maxY };
}

/** True when the two boxes overlap on both axes (touching edges alone do NOT count as overlap). */
export function boundsOverlap(a: PxBounds, b: PxBounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** The world-space box a camera at `scrollX/scrollY`, `zoom` sees given the viewport's px size. Matches
 *  Phaser's `camera.worldView` (top-left = scroll, extent = size / zoom) without needing a live camera. */
export function cameraViewportPx(
  scrollX: number,
  scrollY: number,
  zoom: number,
  viewportW: number,
  viewportH: number,
): PxBounds {
  return {
    minX: scrollX,
    minY: scrollY,
    maxX: scrollX + viewportW / zoom,
    maxY: scrollY + viewportH / zoom,
  };
}
