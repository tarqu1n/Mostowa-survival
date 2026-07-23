import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, RENDER_SCALE, HUNGER_MAX, HUNGER_LOW_FRACTION } from '../config';
import type { Inventory } from '../systems/Inventory';
import { WellbeingPanel } from './hud/WellbeingPanel';
import { InventoryWidget } from './hud/InventoryWidget';
import { BuildControls } from './hud/BuildControls';
import { CombatControls } from './hud/CombatControls';
import { InspectPanel } from './hud/InspectPanel';
import { ModeControls } from './hud/ModeControls';
import { DevMenu } from './hud/DevMenu';
import { NpcAssignMenu } from './hud/NpcAssignMenu';
import type { HudElement } from './hud/types';

/**
 * HUD overlay, run in parallel over GameScene (never replaces it). UI is decoupled from world logic:
 * it reads the shared Inventory (via the registry) and talks to GameScene only over
 * `this.game.events` (`build:*`, `tasks:*`, `mode:*`, `needs:*`, …).
 *
 * This scene is the **composition root** for the REMAINING Phaser HUD widgets: each self-contained
 * group lives in a `scenes/hud/` module (build controls, wellbeing panel, combat controls, inspect
 * panel, mode toggles, dev menu, inventory, NPC assign menu). `create()` constructs them, keeps their
 * `game.events` + registry-inventory bus wiring here, and dispatches each event to the owning widget's
 * handler. Cross-widget state (the HUD hit-region list, the shared Inventory, the input mode, the
 * player HP/hunger that feed the Wellbeing panel) stays on the scene.
 *
 * Migration (plan 046): the always-on HP/food/fire/supply bars, the top-centre day-night/zoom/follow
 * stack, and the damage/hunger vignettes were retired here at Step 9 — they now live in the DOM HUD
 * (`src/hud/`). The rest migrate at Steps 10–12; this scene is deleted wholesale at Step 13.
 *
 * Cross-scene input arbitration: GameScene's world tap handler ignores pointers inside the HUD
 * hit-region ({@link hudHitTest}) so tapping a button never also moves/chops/places underneath.
 */
export class UIScene extends Phaser.Scene {
  private inv?: Inventory;

  // Latest input mode + auto-surface state from GameScene (plan 035a Step 3). The fighting controls
  // (movepad + action cluster) reveal when EITHER is combat-ish — see combatControlsShown /
  // refreshCombatControls, driven by both `mode:changed` and `combat:activeChanged`.
  private mode: 'command' | 'combat' | 'inspect' = 'command';
  private combatActive = false;

  // Player HP — seeded lazily from the first player:hpChanged (HP isn't on the registry); maxHp seeds
  // from playerStats. Owned here because it feeds the Wellbeing panel bars (updateHealthBar). The
  // always-on HUD bars + damage/hunger vignettes moved to the DOM HUD at plan 046 Step 9.
  private playerMaxHp = 0;
  private playerHp = 0;

  /** Interactive HUD elements GameScene must treat as UI, not world — tested live so a hidden
   * button (Cancel when idle, the panel when closed) never swallows a world tap. Kit widgets are
   * Containers; a Container's getBounds() is the union of its children's bounds. Widget modules push
   * their own interactive elements here through the `addHudElement` closure passed at construction. */
  private hudElements: HudElement[] = [];

  // Per-widget groups (each owns its own builder + update handlers — see scenes/hud/).
  private wellbeing!: WellbeingPanel;
  private inventory!: InventoryWidget;
  private buildControls!: BuildControls;
  private combatControls!: CombatControls;
  private inspectPanel!: InspectPanel;
  private modeControls!: ModeControls;
  private devMenu!: DevMenu;
  private npcAssignMenu!: NpcAssignMenu;

  constructor() {
    super('UI');
  }

  create(): void {
    this.inv = this.registry.get('inventory') as Inventory | undefined;

    // The backing store is BASE×RENDER_SCALE (rendered at device density to kill tile-edge seams —
    // see config RENDER_SCALE). Zoom the HUD camera by that factor and recentre it on the design-space
    // midpoint, so every widget below stays authored in plain BASE_WIDTH×BASE_HEIGHT units yet renders
    // crisply at device resolution. (No-op at RENDER_SCALE 1.)
    if (RENDER_SCALE !== 1) {
      this.cameras.main.setZoom(RENDER_SCALE);
      this.cameras.main.centerOn(BASE_WIDTH / 2, BASE_HEIGHT / 2);
    }

    // The damage + starving vignettes moved to the DOM HUD at plan 046 Step 9 (GameHud `Vignettes`).

    const addHudElement = (...els: HudElement[]): void => {
      this.hudElements.push(...els);
    };
    const inv = (): Inventory | undefined => this.inv;
    const initialPhase = (this.registry.get('dayPhase') as 'day' | 'night' | undefined) ?? 'day';

    // Health & Wellbeing screen (plan 004) — meters + stat rows + edible list, plus the STATUS toggle.
    this.wellbeing = new WellbeingPanel(this, { inv, addHudElement });

    // Seed the health + hunger bars: max from playerStats (HP itself isn't on the registry — fill from
    // the first player:hpChanged), so it starts full until combat reports the live value. Feeds the
    // Wellbeing panel bars (the always-on HUD bars now live in the DOM HUD — plan 046 Step 9).
    this.playerMaxHp = this.wellbeing.seedMaxHp();
    this.playerHp = this.playerMaxHp;
    this.updateHealthBar();
    this.updateHungerBar((this.registry.get('hunger') as number | undefined) ?? HUNGER_MAX);

    // Build column + palette (plan 012) — built before refreshInventory so its rows exist for the
    // first affordability pass.
    this.buildControls = new BuildControls(this, { inv, addHudElement });
    this.inventory = new InventoryWidget(this, { addHudElement });
    this.combatControls = new CombatControls(this, { addHudElement });
    this.inspectPanel = new InspectPanel(this, { addHudElement });
    this.modeControls = new ModeControls(this, { addHudElement });
    this.devMenu = new DevMenu(this, { addHudElement, initialPhase });
    // Companion assignment menu (plan 042 Step 9) — hidden until GameScene emits `npc:menuOpen`.
    this.npcAssignMenu = new NpcAssignMenu(this, { addHudElement });

    // Control hint — a genuinely fixed HUD label belongs on the never-zoomed UI camera, not on the
    // world camera (which now pans/zooms with the player).
    this.add.text(6, BASE_HEIGHT - 30, 'tap: order · hold: queue · Build: menu', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#6f6552',
    });

    // ESC closes the palette if open, else exits build mode (mirrors tapping BUILD again). Keyboard
    // is scene-scoped input, torn down with the scene — no manual off needed.
    this.input.keyboard?.on('keydown-ESC', this.onEscape, this);
    // R rotates the placement facing while in build mode — the keyboard mirror of the ROTATE button.
    this.input.keyboard?.on('keydown-R', this.buildControls.onRotateKey, this.buildControls);

    // Seed + subscribe: read the shared Inventory's own 'change' directly (no event-bus hop).
    this.refreshInventory();
    this.inv?.on('change', this.refreshInventory, this);
    this.game.events.on('build:modeChanged', this.buildControls.onBuildMode, this.buildControls);
    this.game.events.on(
      'demolish:modeChanged',
      this.buildControls.onDemolishMode,
      this.buildControls,
    );
    this.game.events.on('build:select', this.buildControls.onBuildSelected, this.buildControls);
    this.game.events.on('tasks:changed', this.buildControls.onTasks, this.buildControls);
    this.game.events.on('mode:changed', this.onModeChanged, this);
    this.game.events.on('combat:activeChanged', this.onCombatActiveChanged, this);
    this.game.events.on('inspect:show', this.inspectPanel.show, this.inspectPanel);
    this.game.events.on('inspect:hide', this.inspectPanel.hide, this.inspectPanel);
    this.game.events.on('time:changed', this.onTimeChanged, this);
    this.game.events.on('hunger:changed', this.onHungerChanged, this);
    this.game.events.on('player:hpChanged', this.onPlayerHp, this);
    this.game.events.on('npc:menuOpen', this.npcAssignMenu.onMenuOpen, this.npcAssignMenu);

    // Teardown so a future scene restart doesn't double-register on stale listeners.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inv?.off('change', this.refreshInventory, this);
      this.game.events.off('build:modeChanged', this.buildControls.onBuildMode, this.buildControls);
      this.game.events.off(
        'demolish:modeChanged',
        this.buildControls.onDemolishMode,
        this.buildControls,
      );
      this.game.events.off('build:select', this.buildControls.onBuildSelected, this.buildControls);
      this.game.events.off('tasks:changed', this.buildControls.onTasks, this.buildControls);
      this.game.events.off('mode:changed', this.onModeChanged, this);
      this.game.events.off('combat:activeChanged', this.onCombatActiveChanged, this);
      this.game.events.off('inspect:show', this.inspectPanel.show, this.inspectPanel);
      this.game.events.off('inspect:hide', this.inspectPanel.hide, this.inspectPanel);
      this.game.events.off('time:changed', this.onTimeChanged, this);
      this.game.events.off('hunger:changed', this.onHungerChanged, this);
      this.game.events.off('player:hpChanged', this.onPlayerHp, this);
      this.game.events.off('npc:menuOpen', this.npcAssignMenu.onMenuOpen, this.npcAssignMenu);
    });
  }

  /** True if (x, y) in game coords lands on a *visible* interactive HUD element. */
  hudHitTest(x: number, y: number): boolean {
    return this.hudElements.some((el) => el.visible && el.getBounds().contains(x, y));
  }

  /** True while a finger is held on the movepad (see {@link CombatControls.isHeld}). Gates map order
   *  dispatch in PointerInputController: while you're driving, map taps/queue-paint stay inert. */
  isMovepadHeld(): boolean {
    return this.combatControls.isHeld();
  }

  /** Repaint the hotbar + full grid from the shared Inventory's slots, and re-dim the build-palette
   * rows by affordability + the Wellbeing edible counts. */
  private refreshInventory(): void {
    const slots = this.inv?.slots() ?? [];
    this.inventory.refresh(slots);
    this.buildControls.refreshBuildPalette(); // per-row buildable affordability
    this.wellbeing.refreshEatRows(); // keep the Wellbeing edible counts live with the bag
  }

  /** Scale + tint the Wellbeing-panel hunger bar + label. Amber normally, red when near-empty. The
   * always-on HUD hunger ring + starving vignette now live in the DOM HUD (plan 046 Step 9). */
  private updateHungerBar(hunger: number): void {
    const ratio = Math.max(0, Math.min(1, hunger / HUNGER_MAX));
    const colour = ratio <= HUNGER_LOW_FRACTION ? 0xc0392b : 0xd8a24a;
    const rounded = Math.round(hunger);
    this.wellbeing.setHunger(ratio, colour, `Hunger  ${rounded}/${HUNGER_MAX}`);
  }

  /** Scale + tint the Wellbeing-panel health bar + label. Green normally, red when low. The always-on
   * HUD health ring now lives in the DOM HUD (plan 046 Step 9). */
  private updateHealthBar(): void {
    const ratio =
      this.playerMaxHp > 0 ? Math.max(0, Math.min(1, this.playerHp / this.playerMaxHp)) : 1;
    const colour = ratio <= 0.3 ? 0xc0392b : 0x4caf50;
    this.wellbeing.setHealth(ratio, colour, `Health  ${this.playerHp}/${this.playerMaxHp}`);
  }

  private onHungerChanged({ hunger }: { hunger: number; max: number }): void {
    this.updateHungerBar(hunger);
  }

  private onPlayerHp({ hp, maxHp }: { hp: number; maxHp: number }): void {
    this.playerHp = hp;
    this.playerMaxHp = maxHp;
    this.updateHealthBar();
  }

  /** Mirror the day/night phase onto the DEV day/night button's action label. The passive day/night
   *  readout + wave banner now live in the DOM HUD (DayNightDial — plan 046 Step 9). */
  private onTimeChanged({ phase }: { phase: 'day' | 'night'; dayCount: number }): void {
    this.devMenu.setPhaseLabel(phase);
  }

  /** Reflects the authoritative mode from GameScene: button highlight + combat-controls visibility. */
  private onModeChanged(mode: 'command' | 'combat' | 'inspect'): void {
    this.mode = mode;
    this.modeControls.reflect(mode);
    this.refreshCombatControls();
    if (mode !== 'inspect') this.inspectPanel.hide();
  }

  /** GameScene's auto-surface predicate flipped (plan 035a Step 3) — re-evaluate whether the fighting
   *  controls should show. Independent of `mode`, so an enemy wandering near (or dusk) reveals the
   *  movepad + cluster while the player stays in command mode. */
  private onCombatActiveChanged(active: boolean): void {
    this.combatActive = active;
    this.refreshCombatControls();
  }

  /** The fighting controls show when the movepad is authoritative — manual Combat mode OR the
   *  combatActive auto-surface (mirrors GameScene.movepadDrives). */
  private combatControlsShown(): boolean {
    return this.mode === 'combat' || this.combatActive;
  }

  /** Show/hide the left-thumb movepad + right-thumb action cluster (and hide the clashing hotbar)
   *  from the current mode + auto-surface state. Called by both `mode:changed` and
   *  `combat:activeChanged`, so either trigger reveals or retracts the same control set. */
  private refreshCombatControls(): void {
    const show = this.combatControlsShown();
    this.combatControls.setControlsVisible(show);
    // Hide the hotbar while the fighting controls are up so it doesn't clash with the movepad/cluster;
    // and drop any open full-inventory panel as they surface.
    this.inventory.setHotbarVisible(!show);
    if (show) this.inventory.setOpen(false);
  }

  /** ESC: close the companion menu if open, else the build palette, else exit build mode, else exit
   *  demolish mode (each mirrors tapping its own toggle again — plan 037 2b adds the demolish rung).
   *  With none of those open it bails out of any armed guard-point placement in GameScene (a harmless
   *  no-op when nothing is armed) — the assignment menu's documented Escape cancel (plan 042 Step 9). */
  private onEscape(): void {
    if (this.npcAssignMenu.isOpen()) this.npcAssignMenu.close();
    else if (this.buildControls.isPaletteOpen()) this.buildControls.closePalette();
    else if (this.buildControls.isBuildToggled()) this.game.events.emit('build:toggle');
    else if (this.buildControls.isDemolishToggled()) this.game.events.emit('demolish:toggle');
    else this.game.events.emit('npc:cancelPlaceGuard');
  }
}
