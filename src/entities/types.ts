/**
 * World entity shapes shared across the scene, systems, and the DEV-only test API. Moved verbatim
 * out of `scenes/GameScene.ts` (plan 013 Step 2) — names/shapes unchanged, this is an import-path
 * move only, so it kills the one systems→scene back-edge (`systems/stats.ts` used to import these
 * from the scene). `EnemyUnit` graduated to the `MonsterCharacter` class in Step 4; trees and build
 * sites deliberately stay plain interfaces (behaviour classes yes, data hierarchy no).
 */

import type Phaser from 'phaser';
import type { ResourceNodeDef } from '../data/types';
import type { MonsterCharacter } from './MonsterCharacter';

/** A live/stump resource node instance in the world (tree sprite + its data + state). */
export interface TreeNode {
  id: string;
  sprite: Phaser.GameObjects.Image;
  def: ResourceNodeDef;
  hp: number;
  alive: boolean;
  col: number;
  row: number;
}

/**
 * A placed-but-not-yet-built wall: a passable blueprint the worker builds on site over time.
 * `rect` stays the physics/collision + blueprint-progress visual throughout; once built it's
 * hidden and `visual` (the wall sprite) is shown on top instead.
 */
export interface BuildSite {
  id: string;
  col: number;
  row: number;
  rect: Phaser.GameObjects.Rectangle;
  visual: Phaser.GameObjects.Image | null;
  progress: number;
  done: boolean;
}

/**
 * What a pointer "raycast" landed on: the specific world entity whose *rendered sprite* is drawn
 * under the point (see {@link GameScene.pickSpriteAt}). `null` (the absence of a pick) means empty
 * ground — no interactive sprite there — and the caller falls back to a plain move-to-tile.
 */
export type PointerPick =
  | { kind: 'tree'; tree: TreeNode }
  | { kind: 'enemy'; enemy: MonsterCharacter }
  | { kind: 'site'; site: BuildSite };

/** Cardinal facing shorthand for {@link ScenarioSpec}, mapped to `lastFacing` deltas below. */
export type FacingSpec = 'up' | 'down' | 'left' | 'right';

export const FACING_DELTAS: Record<FacingSpec, { dCol: number; dRow: number }> = {
  up: { dCol: 0, dRow: -1 },
  down: { dCol: 0, dRow: 1 },
  left: { dCol: -1, dRow: 0 },
  right: { dCol: 1, dRow: 0 },
};
