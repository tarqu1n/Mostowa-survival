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

  /** Total world-px shaved off the ~1-tile collision body (split both sides) so it slides past a flush
   *  wall / through a 1-tile gap instead of catching on it. See {@link fitBody}. */
  private static readonly BODY_TILE_INSET = 2;
  /** Frames of no measurable progress toward the current waypoint before {@link isStuck} trips
   *  (≈0.5s at 60fps) — long enough to ignore normal deceleration, short enough to feel responsive. */
  private static readonly STUCK_FRAMES = 30;
  /** Stuck-detection state: the waypoint we're metering, the closest we've come to it, and how many
   *  consecutive frames we've failed to improve on that. The center-to-center mover can be deflected
   *  off its line by the wall collider backstop; if it stops closing on the waypoint, the path owner
   *  should repath (see {@link isStuck}). `NaN` target = meter idle, restarts on the next step. */
  private stuckTargetX = NaN;
  private stuckTargetY = NaN;
  private stuckBestDist = Infinity;
  private stuckFrames = 0;

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
   * Give the scaled sprite a physics body a hair under one tile, CENTRED on the sprite's logical
   * point (`render.originX/Y`) — the SAME point {@link tile} reads via `worldToTile(sprite.x/y)` and
   * that pathing snaps to tile centres (`body.reset` in {@link advancePath}). Size/offset are in
   * source-frame px (Arcade scales the body by the sprite's scale).
   *
   * Why centred, not at the feet: the body used to be anchored at the canvas bottom (`frame - bodyPx`),
   * which sat its centre ~6px BELOW the sprite's logical point — so a body standing logically in row R
   * actually straddled down into row R+1 and collided with walls the pathfinder had legally routed
   * around (the "hugs the tile edge / stuck walking into walls" bug: a path clear at the tile level,
   * a body clipping the neighbouring row's wall). Centring on the pathing reference keeps collision and
   * pathfinding in one coordinate frame. The {@link BODY_TILE_INSET}px of clearance per side lets the
   * body slide past a flush wall / through a 1-tile gap instead of catching on it. Low-stakes either
   * way: player↔wall collision is only a pathfinding backstop and enemy contact damage is tile-based.
   */
  protected fitBody(render: ActorRender): void {
    const frame = this.sprite.frame.width; // square source canvas (px)
    const bodyPx = Math.min(
      frame,
      Math.round((TILE_SIZE - Character.BODY_TILE_INSET) / render.scale),
    );
    this.sprite.body.setSize(bodyPx, bodyPx);
    this.sprite.body.setOffset(
      render.originX * frame - bodyPx / 2,
      render.originY * frame - bodyPx / 2,
    );
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
    const dist = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, wx, wy);
    if (dist <= 2) {
      this.sprite.body.reset(wx, wy);
      this.onWaypointReached(wp);
      this.pathIndex += 1;
      this.resetStuck(); // fresh waypoint next frame — clear the progress meter
      return this.pathIndex >= this.path.length;
    }
    this.trackProgress(wx, wy, dist);
    this.scene.physics.moveTo(this.sprite, wx, wy, this.moveSpeed());
    return false;
  }

  /** Feed the stuck meter: restart it whenever the target waypoint changes (advanced or repathed),
   *  otherwise count a frame that failed to get meaningfully closer as no-progress. */
  private trackProgress(wx: number, wy: number, dist: number): void {
    if (wx !== this.stuckTargetX || wy !== this.stuckTargetY) {
      this.stuckTargetX = wx;
      this.stuckTargetY = wy;
      this.stuckBestDist = dist;
      this.stuckFrames = 0;
      return;
    }
    if (dist < this.stuckBestDist - 0.5) {
      this.stuckBestDist = dist;
      this.stuckFrames = 0;
    } else {
      this.stuckFrames += 1;
    }
  }

  private resetStuck(): void {
    this.stuckTargetX = NaN;
    this.stuckTargetY = NaN;
    this.stuckBestDist = Infinity;
    this.stuckFrames = 0;
  }

  /**
   * True once the actor has failed to close on its current waypoint for {@link STUCK_FRAMES}
   * consecutive frames — the owner of the path decision (the scene's task loop for the player)
   * should repath. Reading it consumes the signal (resets the meter) so one stall fires one
   * repath, not one per frame. Returns false while idle or working in place (no active waypoint).
   */
  isStuck(): boolean {
    if (this.stuckFrames < Character.STUCK_FRAMES) return false;
    this.resetStuck();
    return true;
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
