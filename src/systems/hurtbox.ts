/**
 * Pure tile-space hurtbox helpers. A hurtbox is a creature's body extent in tiles for combat
 * *targeting* — distinct from its footprint (movement/occupancy), which is always the single feet
 * tile. Anchored at the feet tile, centred horizontally on the feet column and rising upward (lower
 * rows) to match how actors are drawn (feet at the bottom, body above). See `Hurtbox` in
 * `src/data/types.ts` for the size semantics; consumed by GameScene's Attack/Inspect/contact paths.
 */

import type { AttackShape, Hurtbox } from '../data/types';
import type { Cell } from './pathfind';

/** A single feet tile — the fallback when a combatant declares no hurtbox. */
export const DEFAULT_HURTBOX: Hurtbox = { width: 1, height: 1 };

/** Left/right column spread from the feet column (even widths extend one further right). */
function spread(width: number): { left: number; right: number } {
  return { left: Math.floor((width - 1) / 2), right: Math.ceil((width - 1) / 2) };
}

/** True if `target` lies within `box` anchored at `feet` (centred horizontally, rising upward). */
export function hurtboxContains(feet: Cell, box: Hurtbox, target: Cell): boolean {
  const { left, right } = spread(box.width);
  const dCol = target.col - feet.col;
  const dUp = feet.row - target.row; // north/up is positive
  return dCol >= -left && dCol <= right && dUp >= 0 && dUp <= box.height - 1;
}

/** Every tile `box` covers, anchored at `feet` (feet row down to `height-1` rows above). */
export function hurtboxTiles(feet: Cell, box: Hurtbox): Cell[] {
  const { left, right } = spread(box.width);
  const tiles: Cell[] = [];
  for (let dUp = 0; dUp < box.height; dUp++) {
    for (let dCol = -left; dCol <= right; dCol++) {
      tiles.push({ col: feet.col + dCol, row: feet.row - dUp });
    }
  }
  return tiles;
}

/**
 * The tiles a melee swing covers, given the attacker's `feet`, a `facing` direction, and an
 * `AttackShape`. Pure geometry (no Phaser, no world state): `facing` is snapped to a cardinal unit
 * (dominant axis wins; a `(0,0)` facing defaults to down), the arc profile is projected forward, and
 * the resulting cells are deduped. The feet tile itself is never included. See `AttackShape` in
 * `src/data/types.ts` for the `reach`/`arc` semantics.
 */
export function attackTiles(
  feet: Cell,
  facing: { dCol: number; dRow: number },
  shape: AttackShape,
): Cell[] {
  // Snap facing to a cardinal unit — the dominant axis wins, diagonals collapse onto it.
  const f =
    Math.abs(facing.dCol) >= Math.abs(facing.dRow)
      ? { dCol: Math.sign(facing.dCol) || 0, dRow: 0 }
      : { dCol: 0, dRow: Math.sign(facing.dRow) };
  if (f.dCol === 0 && f.dRow === 0) {
    f.dRow = 1; // never expected; default to down
  }
  // Perpendicular unit, for the lateral spread of 'wide'.
  const p = { dCol: -f.dRow, dRow: f.dCol };
  const reach = Math.max(1, shape.reach);

  const tiles: Cell[] = [];
  const push = (col: number, row: number): void => {
    if (!tiles.some((t) => t.col === col && t.row === row)) tiles.push({ col, row });
  };

  if (shape.arc === 'single') {
    push(feet.col + reach * f.dCol, feet.row + reach * f.dRow); // just the tip
  } else {
    for (let d = 1; d <= reach; d++) {
      const cx = feet.col + d * f.dCol;
      const cy = feet.row + d * f.dRow;
      push(cx, cy); // straight column, shared by 'line' and 'wide'
      if (shape.arc === 'wide') {
        push(cx + p.dCol, cy + p.dRow);
        push(cx - p.dCol, cy - p.dRow);
      }
    }
  }
  return tiles;
}
