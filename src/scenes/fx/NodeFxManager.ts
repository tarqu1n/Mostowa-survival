import Phaser from 'phaser';
import {
  CHOP_RECOIL_PX,
  CHOP_RECOIL_MS,
  CHOP_RECOIL_SQUASH,
  CHOP_TREMBLE_PX,
  CHOP_TREMBLE_DEG,
  TREE_FELL_MS,
  TREE_FELL_REST_DEG,
  TREE_FELL_FADE_MS,
  ROCK_CRUMBLE_MS,
  BUSH_RUSTLE_MS,
  NODE_SHAKE_PX,
  NODE_SHAKE_DEG,
  NODE_SHAKE_HZ,
  NODE_PROGRESS_BAR_W,
  NODE_PROGRESS_BAR_H,
  NODE_PROGRESS_BAR_Y_OFFSET,
  YIELD_ICON_SIZE,
  YIELD_ICON_SPACING_PX,
  YIELD_ICON_START_OFFSET,
  YIELD_FLOAT_RISE_PX,
  YIELD_FLOAT_MS,
  YIELD_POP_MS,
  COLORS,
} from '../../config';
import type { GameScene } from '../GameScene';

/**
 * Per-hit chop feedback input. `ResourceNodeManager` owns skin resolution, so it hands
 * {@link NodeFxManager} plain data (never the node object graph): the persistent node sprite to
 * animate, its TRUE resting transform (tile-centre + fitted base scale) so a re-chop mid-jitter can
 * snap back to rest instead of accumulating drift, the `depletion` fraction driving the escalating
 * tremble, and the `facing` sign-delta pointing FROM the chopper TO the node (so away == +facing).
 */
export interface ChopFxInput {
  sprite: Phaser.GameObjects.Image;
  /** True resting X (tile-centre px) — the sprite must settle exactly here between hits. */
  restX: number;
  /** True resting Y (tile-centre px). */
  restY: number;
  /** Fitted base scale (skin/def `nodeScale`) — read live each hit, never captured. */
  baseScale: number;
  /** The node's authored placement rotation (deg) — the TRUE rest angle. Recoil/tremble layer on top
   *  and settle back to THIS, so a chop never snaps the node to 0 and drops its placement rotation. */
  baseAngle: number;
  /** (maxHp - hp) / maxHp, 0..1 — tremble amplitude scales with this. */
  depletion: number;
  /** Chopper→node sign-delta (`Character.lastFacing`); away-from-chopper == +facing. */
  facing: { dCol: number; dRow: number };
}

/**
 * Depletion (fell) input for the transient clone. Carries a resolved texture key/frame + full
 * transform (the manager can't reach into skin internals), plus `nodeSprite` ONLY so `playFell` can
 * stop that sprite's in-flight recoil tween before the stump swap settles (it never animates the
 * persistent sprite — the caller has already swapped it to the stump).
 */
export interface FellFxInput {
  /** Depletion style: 'chop'/undefined → tree topple, 'mine' → rock crumble, 'gather' → bush rustle. */
  kind: 'chop' | 'gather' | 'mine';
  texKey: string;
  texFrame?: string | number;
  x: number;
  y: number;
  scale: number;
  /** The node's authored placement rotation (deg) — the clone starts here and topples/shudders FROM it. */
  baseAngle: number;
  originX: number;
  originY: number;
  depth: number;
  /** Chopper→node sign-delta — the topple leans away from the chopper. */
  facing: { dCol: number; dRow: number };
  /** The persistent node sprite — only so `playFell` can stop its recoil tween (never animated here). */
  nodeSprite: Phaser.GameObjects.Image;
}

/**
 * Floating "resource acquired" pop input. `ResourceNodeManager` owns item→icon resolution, so it
 * hands {@link NodeFxManager} plain data: the harvested node sprite (the float anchors above its
 * visual top) and one already-resolved icon texture key per resource this hit yielded — order is the
 * left→right layout order. A single-yield chop passes one key; a tent salvage rolls its whole loot
 * table in one act and passes several, which fan out side by side so they never overlap.
 */
export interface YieldFloatInput {
  sprite: Phaser.GameObjects.Image;
  /** One icon texture key (`icon:<id>`) per resource the hit granted; laid out left→right. */
  iconKeys: string[];
}

/** A tracked transient effect sprite + the tweens poking it, so teardown can stop then drop/destroy. */
interface TransientFx {
  sprite: Phaser.GameObjects.Image;
  tweens: Phaser.Tweens.Tween[];
}

/**
 * Harvest-node FX: the per-hit directional recoil + escalating tremble on the persistent node sprite,
 * and the per-kind depletion payoff (tree topple / rock crumble / bush rustle) on a transient clone.
 * Mirrors {@link CombatFxManager}'s exact shape (plan 031): a GameScene field initializer that only
 * stashes its scene ref (Scene-plugin injections aren't installed when the class constructor runs),
 * with `armShutdown()` doing the one thing that must wait. `ResourceNodeManager` reaches this only
 * through the narrow `playChopFx`/`playFellFx` dep closures the scene supplies (no manager↔manager
 * edge) — this surface never touches skin internals, only the plain-data inputs above.
 *
 * The selection glow halo mirrors the node transform every frame via `TaskGlowRenderer.syncGlow
 * Transforms`, so animating the node transform animates its outline for free — do NOT touch
 * `TaskGlowRenderer`. The transient fell clone is unmanaged fx and is correctly NOT tracked by the
 * halo (the halo follows the stump, which stays put).
 */
export class NodeFxManager {
  // Per-hit recoil/tremble tweens, keyed by the persistent node sprite so a rapid re-chop restarts
  // cleanly (stop the old, snap to rest, start the new) and the depletion hit can stop the dying
  // recoil before the stump swap settles. The tween pokes the sprite, so it must stop before the
  // sprite is destroyed (clearAll / SHUTDOWN).
  private readonly recoilTweens = new Map<Phaser.GameObjects.Image, Phaser.Tweens.Tween>();
  // Live fell/crumble/rustle clones + their tweens. Each self-unregisters on completion (endTransient);
  // reset() stops+destroys the survivors, destroy() stops+drops them (Phaser already destroyed them).
  private readonly transient = new Set<TransientFx>();
  // Continuous salvage/clear shake (plan 047): one looping (`repeat:-1`) tween per node sprite, keyed by
  // it, plus the captured rest transform so stopShake can snap it back. Only one player action runs at a
  // time, but keying by sprite keeps the teardown symmetric with recoilTweens. The tween pokes the
  // sprite, so it MUST be stopped before the sprite is destroyed (removeNode / clearAll / SHUTDOWN).
  private readonly shakeTweens = new Map<
    Phaser.GameObjects.Image,
    {
      tween: Phaser.Tweens.Tween;
      restX: number;
      restY: number;
      restAngle: number;
      restScale: number;
    }
  >();
  // Salvage/clear progress bars (plan 047): a lazily-created {bg,fg} rectangle pair per node sprite,
  // mirroring the enemy HP-bar pool. reset() destroys the survivors; destroy() drops the refs (Phaser
  // already destroyed the rectangles on the SHUTDOWN path).
  private readonly progressBars = new Map<
    Phaser.GameObjects.Image,
    { bg: Phaser.GameObjects.Rectangle; fg: Phaser.GameObjects.Rectangle }
  >();

  // Field-initializer construction (see CombatFxManager): only stash the scene here — scene.events/
  // tweens/time aren't injected yet. armShutdown() waits for create().
  constructor(private readonly scene: GameScene) {}

  /**
   * Arm the SHUTDOWN-triggered flush. Call once per `create()` (every (re)start re-registers, mirroring
   * CombatFxManager.armShutdown) — `.once` fires exactly once per run, flushing this run's tweens before
   * the next create() reuses this same manager instance.
   */
  armShutdown(): void {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /**
   * Per-hit chop feedback on the persistent node sprite: a directional recoil that jolts the node
   * AWAY from the chopper and snaps back, with an escalating positional+angular tremble layered on top
   * whose amplitude grows as HP drops toward 0. Both beats share ONE tween driving a 0→1 progress `p`
   * with an out-and-back envelope — the sprite always settles back to the true resting transform
   * (tile-centre, upright, base scale) at the end of the hit, leaving no residual offset/rotation for
   * the next hit or the fell to fight. The glow halo mirrors this motion each frame for free.
   */
  playChop(input: ChopFxInput): void {
    const { sprite, restX, restY, baseAngle, depletion, facing } = input;
    const baseScale = input.baseScale; // read live per hit — never a value captured across hits
    // Snap to the true resting transform + stop any in-flight tween FIRST, so a re-chop landing mid-
    // jitter (hits can arrive every CHOP_INTERVAL_MS) can't accumulate drift off tile-centre. Rest
    // angle is the node's authored rotation (baseAngle), NOT 0 — snapping to 0 dropped the placement
    // rotation permanently (it's never re-applied on regrow).
    this.recoilTweens.get(sprite)?.stop();
    sprite.setPosition(restX, restY).setAngle(baseAngle).setScale(baseScale);

    // Unit vector along +facing (chopper→node), so the recoil pushes the node away from the chopper.
    // Normalised so a diagonal approach recoils the same distance as an orthogonal one.
    const len = Math.hypot(facing.dCol, facing.dRow) || 1;
    const ux = facing.dCol / len;
    const uy = facing.dRow / len;
    // Tremble amplitude scales with how depleted the node is (barely visible on the first hit, wild on
    // the killing blow). A 0-facing (defensive: runHarvest always yields one) still trembles fine.
    const ampPx = depletion * CHOP_TREMBLE_PX;
    const ampDeg = depletion * CHOP_TREMBLE_DEG;

    const state = { p: 0 };
    const tween = this.scene.tweens.add({
      targets: state,
      p: 1,
      duration: CHOP_RECOIL_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        if (!sprite.active) return;
        const p = state.p;
        const recoilEnv = Math.sin(p * Math.PI); // 0→1→0: out on the impact, back by the end
        const decay = 1 - p; // tremble rings down to 0 so the hit always settles upright at rest
        // Recoil offset (away from chopper) + a decaying multi-frequency shake (different freq/phase
        // per axis so it reads as a jitter, not a slide). All terms hit 0 at p=1 → exact rest.
        const dx = ux * CHOP_RECOIL_PX * recoilEnv + Math.sin(p * Math.PI * 7) * ampPx * decay;
        const dy = uy * CHOP_RECOIL_PX * recoilEnv + Math.cos(p * Math.PI * 6) * ampPx * decay;
        sprite.setPosition(restX + dx, restY + dy);
        sprite.setAngle(baseAngle + Math.sin(p * Math.PI * 5) * ampDeg * decay);
        // Squash pop at the impact (widest+shortest at the peak), easing back to base scale.
        sprite.setScale(
          baseScale * (1 + CHOP_RECOIL_SQUASH * recoilEnv),
          baseScale * (1 - CHOP_RECOIL_SQUASH * recoilEnv),
        );
      },
      onComplete: () => {
        this.recoilTweens.delete(sprite);
        // Land exactly on rest (kill float error): tile-centre, base scale, and the node's OWN rest
        // angle (baseAngle) — never a hard 0, which would erase the placement rotation.
        if (sprite.active) sprite.setPosition(restX, restY).setAngle(baseAngle).setScale(baseScale);
      },
    });
    this.recoilTweens.set(sprite, tween);
  }

  /**
   * Per-kind depletion payoff on a transient clone (tree topple / rock crumble / bush rustle). First
   * stops+clears the node sprite's in-flight recoil tween so the dying recoil can't fight the caller's
   * stump swap (Finding 4) — the persistent stump is already visible underneath. Then spawns a clone of
   * the LIVE visual at the node's transform and animates its death by kind, destroying it on complete.
   * The clone is unmanaged fx: the glow halo tracks the (stationary) stump, so the toppling clone is
   * correctly NOT mirrored by the outline. All motion terms decay to nothing before the clone is freed,
   * and every callback is `.active`-guarded so a DEV world reset mid-fell (which stops these tweens then
   * destroys the clone) can never poke a freed sprite.
   */
  playFell(input: FellFxInput): void {
    this.recoilTweens.get(input.nodeSprite)?.stop();
    this.recoilTweens.delete(input.nodeSprite);

    const { kind, texKey, texFrame, x, y, scale, baseAngle, originX, originY, depth, facing } =
      input;
    const sprite = this.scene.add
      .image(x, y, texKey, texFrame)
      .setScale(scale)
      .setOrigin(originX, originY)
      .setAngle(baseAngle) // start at the node's authored rotation; topple/shudder is relative to it
      .setDepth(depth); // match the node depth so the clone never renders over actors
    const entry = this.track(sprite);
    const end = () => this.endTransient(entry);

    if (kind === 'mine') {
      // Rock crumble: a brief decaying shudder (position + a whisper of angle) collapsing into a
      // shrink-and-fade. Minimal rotation — a rock doesn't topple, it disintegrates in place.
      const state = { p: 0 };
      entry.tweens.push(
        this.scene.tweens.add({
          targets: state,
          p: 1,
          duration: ROCK_CRUMBLE_MS,
          ease: 'Quad.easeIn',
          onUpdate: () => {
            if (!sprite.active) return;
            const p = state.p;
            const decay = 1 - p; // shudder rings down as the crumble takes over
            sprite.setPosition(x + Math.sin(p * Math.PI * 8) * 2 * decay, y);
            sprite.setAngle(baseAngle + Math.sin(p * Math.PI * 6) * 1.5 * decay);
            sprite.setScale(scale * (1 - 0.3 * p)); // → 0.7*scale
            sprite.setAlpha(1 - p);
          },
          onComplete: end,
        }),
      );
    } else if (kind === 'gather') {
      // Bush rustle: a quick squash (pop wide, compress down) fading out fast. No rotation.
      const state = { p: 0 };
      entry.tweens.push(
        this.scene.tweens.add({
          targets: state,
          p: 1,
          duration: BUSH_RUSTLE_MS,
          ease: 'Quad.easeOut',
          onUpdate: () => {
            if (!sprite.active) return;
            const p = state.p;
            sprite.setScale(scale * (1 + 0.2 * Math.sin(p * Math.PI)), scale * (1 - 0.35 * p));
            sprite.setAlpha(1 - p);
          },
          onComplete: end,
        }),
      );
    } else {
      // Tree topple ('chop'/undefined): rotate about the base-anchored origin (the trunk hinges at its
      // foot) FROM its placement rotation down to the horizontal rest angle (±TREE_FELL_REST_DEG),
      // taking the SHORTEST path — a tree already leaning +30° falls the short way to +90-ish, it does
      // not add a fixed arc on top of the lean and overshoot past horizontal. The fell direction is set
      // by the existing lean (sign of baseAngle); an upright tree has no lean, so the chopper's side
      // decides (never 0 — a worker directly above/below still gets a real topple, not a rotation-less
      // fade, Finding 2). Strong ease-in so it tips slowly then whips down like a pendulum falling from
      // balance (Quart, not Quad — the old mild ease read as near-linear).
      const chopperSign = Math.sign(facing.dCol) || Math.sign(facing.dRow) || 1;
      // Normalise to (-180, 180] first — the clone's start angle is setAngle-normalised, and the raw
      // placement rotation can be e.g. 350° (a slight left lean); its sign then picks the fell side.
      const lean = Phaser.Math.Angle.WrapDegrees(baseAngle);
      const fellSign = Math.sign(lean) || chopperSign;
      entry.tweens.push(
        this.scene.tweens.add({
          targets: sprite,
          angle: fellSign * TREE_FELL_REST_DEG,
          duration: TREE_FELL_MS,
          ease: 'Quart.easeIn',
        }),
      );
      entry.tweens.push(
        this.scene.tweens.add({
          targets: sprite,
          alpha: 0,
          delay: Math.max(0, TREE_FELL_MS - TREE_FELL_FADE_MS),
          duration: TREE_FELL_FADE_MS,
          onComplete: end,
        }),
      );
    }
  }

  /**
   * Floating "resource acquired" pop: for each resource this harvest hit credited, spawn a small item
   * icon just above the node that pops in, rises, and fades out — quick, unmissable feedback that the
   * swing paid off. When one hit grants several resources at once (a tent salvage rolls its whole loot
   * table in a single act), the icons are laid out side by side, centred over the node, so they float
   * up together without ever overlapping. Each icon is an unmanaged transient clone like the fell
   * clone: `.active`-guarded, tracked so a DEV world reset / SHUTDOWN stops+frees any still in flight,
   * and self-destroying via {@link endTransient} once its rise completes.
   */
  playYieldFloat(input: YieldFloatInput): void {
    const { sprite, iconKeys } = input;
    if (!sprite.active || iconKeys.length === 0) return;
    // Anchor above the node art's visual top (nodes are tall + base-anchored, so `sprite.y` sits near
    // the foot — `getBounds().top` is the canopy/roof), then lift a touch more so the pop clears it.
    const topY = sprite.getBounds().top - YIELD_ICON_START_OFFSET;
    // Centre the row on the node: N icons span (N-1)·spacing, so the first starts half a span left.
    const startX = sprite.x - ((iconKeys.length - 1) * YIELD_ICON_SPACING_PX) / 2;
    iconKeys.forEach((key, i) => {
      // Defensive: PreloadScene bakes a colour-rect fallback into every `icon:<id>` key, so a missing
      // texture never happens in practice — but skip rather than spawn a broken green `__WHITE` box.
      if (!this.scene.textures.exists(key)) return;
      const icon = this.scene.add
        .image(startX + i * YIELD_ICON_SPACING_PX, topY, key)
        .setDisplaySize(YIELD_ICON_SIZE, YIELD_ICON_SIZE)
        .setDepth(15); // above world/actors (≤9) + node bands + the salvage progress bar (12): a transient celebration
      const restScale = icon.scale; // setDisplaySize fixed scaleX===scaleY; the pop eases up to this
      const entry = this.track(icon);
      // Rise-and-fade: drift straight up while fading to nothing, then free the clone.
      entry.tweens.push(
        this.scene.tweens.add({
          targets: icon,
          y: topY - YIELD_FLOAT_RISE_PX,
          alpha: { from: 1, to: 0 },
          duration: YIELD_FLOAT_MS,
          ease: 'Quad.easeOut',
          onComplete: () => this.endTransient(entry),
        }),
      );
      // Brief scale-pop as it appears, so the icon reads as popping OFF the node before it rises.
      entry.tweens.push(
        this.scene.tweens.add({
          targets: icon,
          scale: { from: restScale * 0.6, to: restScale },
          duration: YIELD_POP_MS,
          ease: 'Back.easeOut',
        }),
      );
    });
  }

  /** Register a transient clone so teardown can find it; its tweens are pushed by the caller and it
   *  self-unregisters via {@link endTransient} on natural completion. */
  private track(sprite: Phaser.GameObjects.Image): TransientFx {
    const entry: TransientFx = { sprite, tweens: [] };
    this.transient.add(entry);
    return entry;
  }

  /** Natural end of a transient effect: stop its tweens, destroy the clone, drop it from the set.
   *  Idempotent + safe if `reset()`/`destroy()` already flushed it (the `has` guard short-circuits, so
   *  a stopped tween's late onComplete can't double-free). */
  private endTransient(entry: TransientFx): void {
    if (!this.transient.has(entry)) return;
    this.transient.delete(entry);
    for (const t of entry.tweens) t.stop();
    if (entry.sprite.active) entry.sprite.destroy();
  }

  // --- Timed-action feedback: continuous shake + progress bar (plan 047) ----------

  /**
   * Start (or keep) a continuous shake on a node sprite for a long timed action (salvage/clear). Unlike
   * {@link playChop}'s per-hit tremble, this is a constant-amplitude looping jitter that runs until
   * {@link stopShake}. IDEMPOTENT: a runner calls this every frame it's working, but only the FIRST call
   * captures the rest transform (from the sprite, which is sitting at rest — the beginCurrent blanket
   * teardown guarantees no prior shake) and starts the `repeat:-1` tween; later calls are a no-op so the
   * capture never re-reads a mid-jitter transform. The onUpdate writes only position+angle (no scale),
   * using integer-multiple frequencies of a 0→1 loop `p` so every term returns to its start value at the
   * seam (no snap). `.active`-guarded like every other node tween.
   */
  startShake(sprite: Phaser.GameObjects.Image): void {
    if (this.shakeTweens.has(sprite)) return; // already shaking — keep the tween + captured rest
    const restX = sprite.x;
    const restY = sprite.y;
    const restAngle = sprite.angle;
    const restScale = sprite.scaleX;
    const state = { p: 0 };
    const tween = this.scene.tweens.add({
      targets: state,
      p: 1,
      duration: 1000 / NODE_SHAKE_HZ,
      ease: 'Linear',
      repeat: -1,
      onUpdate: () => {
        if (!sprite.active) return;
        const a = state.p * Math.PI * 2; // one full loop per cycle
        // Integer-multiple frequencies (2, 3, 2) with per-axis phase offsets read as a jitter, not a
        // slide, and are loop-continuous (sin(k·2π + φ) === sin(φ) at the seam → no snap).
        sprite.setPosition(
          restX + Math.sin(a * 2) * NODE_SHAKE_PX,
          restY + Math.sin(a * 3 + 1.7) * NODE_SHAKE_PX,
        );
        sprite.setAngle(restAngle + Math.sin(a * 2 + 0.5) * NODE_SHAKE_DEG);
      },
    });
    this.shakeTweens.set(sprite, { tween, restX, restY, restAngle, restScale });
  }

  /** Stop a node's shake and snap it back to the captured rest transform. Safe if it isn't shaking. */
  stopShake(sprite: Phaser.GameObjects.Image): void {
    const s = this.shakeTweens.get(sprite);
    if (!s) return;
    s.tween.stop();
    this.shakeTweens.delete(sprite);
    if (sprite.active)
      sprite.setPosition(s.restX, s.restY).setAngle(s.restAngle).setScale(s.restScale);
  }

  /** Stop every in-flight node shake (the beginCurrent blanket cancel-teardown — critique #1). Snaps
   *  each sprite back to rest. Safe to call with none running. */
  stopAllShakes(): void {
    for (const sprite of [...this.shakeTweens.keys()]) this.stopShake(sprite);
  }

  /**
   * Show/update a world-space progress bar above a node for a timed action, `frac` (0..1) filling it
   * left→right. Mirrors the enemy HP-bar renderer: a lazily-created {bg,fg} rectangle pair pooled per
   * node sprite, repositioned each frame just above the sprite's display top (the node art is tall, so
   * anchor off `getBounds().top`, not a fixed offset). {@link hideActionProgress} destroys the pair.
   */
  showActionProgress(sprite: Phaser.GameObjects.Image, frac: number): void {
    if (!sprite.active) return;
    const x = sprite.x;
    const y = sprite.getBounds().top - NODE_PROGRESS_BAR_Y_OFFSET;
    let bar = this.progressBars.get(sprite);
    if (!bar) {
      const bg = this.scene.add
        .rectangle(x, y, NODE_PROGRESS_BAR_W, NODE_PROGRESS_BAR_H, COLORS.nodeProgressBg, 0.85)
        .setDepth(12); // above world/actors (≤9) + node bands; below the enemy HP bars (13/14)
      // fg is left-anchored so scaleX GROWS it from the left as the action progresses (a filling bar).
      const fg = this.scene.add
        .rectangle(
          x - NODE_PROGRESS_BAR_W / 2,
          y,
          NODE_PROGRESS_BAR_W,
          NODE_PROGRESS_BAR_H,
          COLORS.nodeProgressFg,
          1,
        )
        .setOrigin(0, 0.5)
        .setDepth(12);
      bar = { bg, fg };
      this.progressBars.set(sprite, bar);
    }
    bar.bg.setPosition(x, y);
    bar.fg.setPosition(x - NODE_PROGRESS_BAR_W / 2, y);
    bar.fg.scaleX = Phaser.Math.Clamp(frac, 0, 1);
  }

  /** Destroy a node's progress bar. Safe if it has none. */
  hideActionProgress(sprite: Phaser.GameObjects.Image): void {
    const bar = this.progressBars.get(sprite);
    if (!bar) return;
    bar.bg.destroy();
    bar.fg.destroy();
    this.progressBars.delete(sprite);
  }

  /** Destroy every in-flight progress bar (the beginCurrent blanket cancel-teardown — critique #1). */
  hideAllActionProgress(): void {
    for (const sprite of [...this.progressBars.keys()]) this.hideActionProgress(sprite);
  }

  /**
   * Scene-alive teardown (DEV scenario reset / dev-menu world randomiser, called before node sprites
   * are destroyed): stop every recoil tween then clear the map, and stop every transient's tweens +
   * `sprite.destroy()` then clear the set. Stop-before-clear: a cleared map still leaves the tween
   * running in Phaser's TweenManager, poking a sprite the reset is about to destroy. The salvage/clear
   * shake tweens get the same stop-then-clear; the progress bars are OWNED rectangles → destroy them.
   */
  reset(): void {
    for (const t of this.recoilTweens.values()) t.stop();
    this.recoilTweens.clear();
    for (const e of this.transient) {
      for (const t of e.tweens) t.stop();
      if (e.sprite.active) e.sprite.destroy();
    }
    this.transient.clear();
    for (const s of this.shakeTweens.values()) s.tween.stop();
    this.shakeTweens.clear();
    for (const bar of this.progressBars.values()) {
      if (bar.bg.active) bar.bg.destroy();
      if (bar.fg.active) bar.fg.destroy();
    }
    this.progressBars.clear();
  }

  /**
   * SHUTDOWN teardown (armShutdown): Phaser's own scene teardown has already destroyed every
   * GameObject by now, so stop the tweens + drop refs only — NEVER `.destroy()` (double-free).
   */
  destroy(): void {
    for (const t of this.recoilTweens.values()) t.stop();
    this.recoilTweens.clear();
    for (const e of this.transient) for (const t of e.tweens) t.stop();
    this.transient.clear();
    for (const s of this.shakeTweens.values()) s.tween.stop();
    this.shakeTweens.clear();
    this.progressBars.clear(); // rectangles already destroyed by Phaser's scene teardown — drop refs only
  }
}
