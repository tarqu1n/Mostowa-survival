import Phaser from 'phaser';
import { tileToWorldCenter } from '../../systems/grid';
import { NpcCharacter } from '../../entities/NpcCharacter';
import type { GameScene } from '../GameScene';

/**
 * The AI companion — spawn, per-frame drive, and the reset/teardown half of a world reset (plan 042
 * Step 2). Mirrors {@link EnemyManager} but owns exactly ONE `NpcCharacter | null` (the game has a
 * single companion), so there's no collection and no id counter — {@link get} returns the one NPC or
 * null. It does NOT own the *decision* of when the companion gathers/guards/fights: those behaviours
 * (and the tick ENV they read) land in later steps. For now {@link update} just advances the
 * companion's path + refreshes its animation, folding the throwaway `GameScene.tickDevNpc` seam.
 *
 * Constructed fresh in `buildWorld()` each (re)start, AFTER the player exists (construction order is
 * load-bearing — see GameScene): later steps' tick env will read player state, so the manager must
 * outlive nothing the player owns. It does NOT auto-spawn — {@link spawn} is a separate call (the dev
 * seam / a scenario), so construction stays side-effect-free.
 *
 * **SHUTDOWN vs Arcade physics — the same trap {@link EnemyManager} documents.** The companion's
 * sprite carries an Arcade physics body (`scene.physics.add.existing` in NpcCharacter's constructor).
 * Phaser's scene teardown, PLUS Arcade's own SHUTDOWN-triggered World teardown, destroy every sprite/
 * body BEFORE this manager's SHUTDOWN listener runs (Arcade registers its handler when the plugin
 * boots — long before this manager's, re-added fresh every `buildWorld()`). So {@link destroy} may
 * ONLY drop the reference — it must NEVER call `dispose()`/`sprite.destroy()` (those poke an already-
 * freed sprite/body and throw). That is DIFFERENT from {@link reset}, which runs at RUNTIME (physics
 * alive) where tearing the sprite down via `NpcCharacter.dispose()` IS correct — the DEV-only scenario
 * reset, called with the scene very much alive.
 */
export class CompanionManager {
  private npc: NpcCharacter | null = null;

  constructor(private readonly scene: GameScene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Spawning ----------------------------------------------------------------

  /** Place the single companion at tile `(col,row)` (converted to the world centre like the enemy
   *  spawn) and return it. A single companion, so any prior one is torn down first (RUNTIME dispose —
   *  the scene is alive here). Callers seed scaffold state (role/posture/hp/…) on the returned NPC. */
  spawn(col: number, row: number): NpcCharacter {
    if (this.npc) this.npc.dispose(); // one companion — replace any prior at runtime
    this.npc = new NpcCharacter(this.scene, {
      x: tileToWorldCenter(col),
      y: tileToWorldCenter(row),
    });
    return this.npc;
  }

  // --- Queries -------------------------------------------------------------------

  /** The live companion, or null when none is spawned. */
  get(): NpcCharacter | null {
    return this.npc;
  }

  // --- Per-frame tick --------------------------------------------------------------

  /**
   * Per-frame drive for the companion. Step 2 is deliberately minimal — advance its path + refresh its
   * animation (folds the old `GameScene.tickDevNpc`), so a dev-spawned or scenario-placed NPC still
   * walks. The shared tick ENV (player snapshot + FX/damage effect callbacks, mirroring
   * {@link EnemyManager.update}) is built here once the gather/guard/combat behaviour lands (Steps 4-8);
   * `_delta` is threaded now so that signature is already in place.
   */
  update(_delta: number): void {
    if (!this.npc) return;
    this.npc.advancePath();
    this.npc.updateAnim();
  }

  // --- Reset / teardown --------------------------------------------------------------

  /**
   * Tear down the companion + drop it. Called at RUNTIME (the scene/physics world is alive), so
   * `dispose()` — which calls `sprite.destroy()` — is correct here (see class doc). This is the
   * DEV-only scenario reset path (`applyScenario` → `resetWorld`), NOT SHUTDOWN.
   */
  reset(): void {
    if (this.npc) {
      this.npc.dispose();
      this.npc = null;
    }
  }

  /**
   * SHUTDOWN: this run's companion is going away with the rest of this manager instance (a fresh
   * CompanionManager is constructed by the next `buildWorld()`) — Phaser's scene teardown + Arcade's
   * World teardown have already destroyed the sprite/body by the time this fires (see class doc). So
   * this just drops the stale reference; it deliberately does NOT call {@link reset}, whose
   * `dispose()`/`sprite.destroy()` is only safe while the scene is alive.
   */
  private destroy(): void {
    this.npc = null;
  }
}
