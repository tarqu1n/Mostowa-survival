import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import type { CombatantStats } from '../data/types';
import type { ActorRender, Facing } from '../data/tileset';
import { worldToTile, tileToWorldCenter } from '../systems/grid';
import type { Cell } from '../systems/pathfind';

/** A world actor's display object: a Phaser sprite with an Arcade body attached. */
export type CharacterSprite = Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body };

/**
 * Base class for the actors that genuinely share state + behaviour (plan 013 Step 4): a plain class
 * that OWNS its sprite — deliberately NOT a `Phaser.GameObjects.Sprite` subclass, so entity lifetime
 * never entangles with the display list and logical position stays tile-based (footprint ≠ hurtbox ≠
 * sprite transform). Domain state (hp, stats, facing, path) lives here; the sprite renders it. The
 * hierarchy stops at `Character` → `PlayerCharacter` / `MonsterCharacter`; trees and build sites stay
 * plain interfaces with stat adapters (see docs/DECISIONS.md — behaviour classes yes, data hierarchy
 * no). Combat FX stay in `CombatFxManager`: characters expose semantic hooks (`takeDamage`/`die`) and
 * the scene pairs them with FX calls, so no character carries tween refs or duplicated FX cleanup.
 */
export abstract class Character {
  /** Runtime HP, separate from the immutable stat bag (mirrors the def/runtime-hp split for trees). */
  hp: number;
  /** Last movement direction (sign col/row deltas) — drives the facing strip + attack targeting. */
  lastFacing = { dCol: 0, dRow: 1 };
  /** Current A* path + progress index. Re-pathing stays with the owner of the *decision* — the
   *  scene's task loop for the player, the monster's own FSM execution for monsters. */
  path: Cell[] = [];
  pathIndex = 0;

  protected constructor(
    protected readonly scene: Phaser.Scene,
    readonly sprite: CharacterSprite,
    readonly stats: CombatantStats,
  ) {
    this.hp = stats.maxHp;
  }

  /** The actor's current logical tile (from its sprite's world position). */
  tile(): Cell {
    return { col: worldToTile(this.sprite.x), row: worldToTile(this.sprite.y) };
  }

  /** Map `lastFacing` (dCol/dRow) to a directional strip: side when horizontal dominates, else up/down. */
  facingDir(): Facing {
    const { dCol, dRow } = this.lastFacing;
    if (dCol !== 0 && Math.abs(dCol) >= Math.abs(dRow)) return 'side';
    return dRow < 0 ? 'up' : 'down';
  }

  /**
   * Turn to face a target tile. Called while working in place (chop/build) so the swing points at
   * the thing being worked — independent of the approach direction or a stale `lastFacing`.
   */
  faceTile(col: number, row: number): void {
    const t = this.tile();
    const dCol = Math.sign(col - t.col);
    const dRow = Math.sign(row - t.row);
    if (dCol !== 0 || dRow !== 0) this.lastFacing = { dCol, dRow };
  }

  /**
   * Give the scaled sprite a roughly tile-sized physics body at its feet. Size/offset are in source-
   * frame px (Arcade scales the body by the sprite's scale), so a padded 64px canvas gets a ~1-tile
   * world body centred on the character's feet. Low-stakes: player↔wall collision is a pathfinding
   * backstop and enemy contact damage is tile-based (col/row), not physics.
   */
  protected fitBody(render: ActorRender): void {
    const frame = this.sprite.frame.width; // square source canvas (px)
    const bodyPx = Math.min(frame, Math.round(TILE_SIZE / render.scale)); // → ≈ one tile in world
    this.sprite.body.setSize(bodyPx, bodyPx);
    this.sprite.body.setOffset((frame - bodyPx) / 2, frame - bodyPx); // centred horizontally, at the canvas bottom
  }

  /** Speed (px/s) to walk the current path at — the player factors in the attack-slow, a monster
   *  reads its def. */
  protected abstract moveSpeed(): number;

  /** Hook run each step before the waypoint-arrival check (the player updates `lastFacing` here). */
  protected onBeforeStep(_wp: Cell): void {}

  /** Hook run as a waypoint is reached (a monster syncs its logical `col`/`row` here). */
  protected onWaypointReached(_wp: Cell): void {}

  /** Step along the current path; returns true once the final waypoint has been reached. */
  advancePath(): boolean {
    if (this.pathIndex >= this.path.length) {
      this.sprite.body.setVelocity(0, 0);
      return true;
    }
    const wp = this.path[this.pathIndex];
    const wx = tileToWorldCenter(wp.col);
    const wy = tileToWorldCenter(wp.row);
    this.onBeforeStep(wp);
    if (Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, wx, wy) <= 2) {
      this.sprite.body.reset(wx, wy);
      this.onWaypointReached(wp);
      this.pathIndex += 1;
      return this.pathIndex >= this.path.length;
    }
    this.scene.physics.moveTo(this.sprite, wx, wy, this.moveSpeed());
    return false;
  }

  /** Semantic damage hook — callers pair it with the FX manager (flash/shake) and any bus emissions.
   *  Base form is the raw enemy behaviour (no clamp); `PlayerCharacter` overrides to clamp + guard. */
  takeDamage(amount: number): void {
    this.hp -= amount;
  }

  /** Semantic death hook — the character-side collapse (state + sprite). The scene owns what
   *  surrounds it: FX cleanup/corpse bookkeeping and any restart/removal scheduling. */
  abstract die(): void;
}
