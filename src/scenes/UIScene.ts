import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS } from '../config';
import { ITEMS } from '../data/items';
import { BUILDABLES } from '../data/buildables';
import type { Inventory } from '../systems/Inventory';

/**
 * HUD overlay, run in parallel over GameScene (never replaces it). Renders the wood counter, a
 * Build toggle, a build-mode indicator, a Cancel button, and a live task-queue indicator. UI is
 * decoupled from world logic: it reads the shared Inventory (via the registry) and talks to GameScene
 * only over `this.game.events` (`build:*`, `tasks:*`).
 *
 * Cross-scene input arbitration: GameScene's world tap handler ignores pointers inside the HUD
 * hit-region ({@link hudHitTest}) so tapping a button never also moves/chops/places underneath.
 */
export class UIScene extends Phaser.Scene {
  private inv?: Inventory;
  private woodText!: Phaser.GameObjects.Text;
  private buildButton!: Phaser.GameObjects.Rectangle;
  private buildLabel!: Phaser.GameObjects.Text;
  private modeIndicator!: Phaser.GameObjects.Text;
  private cancelButton!: Phaser.GameObjects.Rectangle;
  private cancelLabel!: Phaser.GameObjects.Text;
  private queueText!: Phaser.GameObjects.Text;
  /** Interactive HUD elements GameScene must treat as UI, not world — tested live so a hidden
   * button (Cancel when idle, the indicator outside build mode) never swallows a world tap. */
  private hudElements: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text> = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.inv = this.registry.get('inventory') as Inventory | undefined;

    // Wood counter: a colour swatch in the item's placeholder colour + a live count.
    this.add.rectangle(10, 12, 10, 10, ITEMS.wood.color).setOrigin(0, 0.5);
    this.woodText = this.add.text(24, 6, '0', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#e8dcc0',
    });

    // Build toggle — a touch-sized button, top-right.
    const bw = 76;
    const bh = 26;
    const bx = BASE_WIDTH - bw / 2 - 8;
    const by = 8 + bh / 2;
    this.buildButton = this.add
      .rectangle(bx, by, bw, bh, 0x3a3730)
      .setStrokeStyle(1, COLORS.ui, 0.6)
      .setInteractive({ useHandCursor: true });
    this.buildLabel = this.add
      .text(bx, by, 'BUILD', { fontFamily: 'monospace', fontSize: '12px', color: '#e8dcc0' })
      .setOrigin(0.5);
    this.buildButton.on('pointerdown', () => this.game.events.emit('build:toggle'));
    this.hudElements.push(this.buildButton);

    // Build-mode indicator — only visible while building.
    this.modeIndicator = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 14, 'BUILD MODE — tap a tile · tap Build to cancel', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.hudElements.push(this.modeIndicator);

    // Cancel button — clears the worker's task queue. Sits under the Build button, top-right.
    const cbw = 60;
    const cbh = 22;
    const cbx = BASE_WIDTH - cbw / 2 - 8;
    const cby = by + bh / 2 + cbh / 2 + 6;
    this.cancelButton = this.add
      .rectangle(cbx, cby, cbw, cbh, 0x3a2a2a)
      .setStrokeStyle(1, 0xb23b3b, 0.6)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.cancelLabel = this.add
      .text(cbx, cby, 'CANCEL', { fontFamily: 'monospace', fontSize: '10px', color: '#e8c0c0' })
      .setOrigin(0.5)
      .setVisible(false);
    this.cancelButton.on('pointerdown', () => this.game.events.emit('tasks:cancel'));
    this.hudElements.push(this.cancelButton);

    // Queue indicator — current action + queued count, top-left under the wood counter.
    this.queueText = this.add.text(10, 26, '', { fontFamily: 'monospace', fontSize: '9px', color: '#9a8f74' });

    // Seed + subscribe: read the shared Inventory's own 'change' directly (no event-bus hop).
    this.refreshWood(this.inv?.snapshot() ?? {});
    this.inv?.on('change', this.refreshWood, this);
    this.game.events.on('build:modeChanged', this.onBuildMode, this);
    this.game.events.on('tasks:changed', this.onTasks, this);

    // Teardown so a future scene restart doesn't double-register on stale listeners.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inv?.off('change', this.refreshWood, this);
      this.game.events.off('build:modeChanged', this.onBuildMode, this);
      this.game.events.off('tasks:changed', this.onTasks, this);
    });
  }

  /** True if (x, y) in game coords lands on a *visible* interactive HUD element. */
  hudHitTest(x: number, y: number): boolean {
    return this.hudElements.some((el) => el.visible && el.getBounds().contains(x, y));
  }

  private refreshWood(snapshot: Record<string, number>): void {
    this.woodText.setText(String(snapshot[ITEMS.wood.id] ?? 0));
    // Reflect affordability of a wall on the button (dim when you can't afford it).
    const affordable = (snapshot[ITEMS.wood.id] ?? 0) >= (BUILDABLES.wall.cost.wood ?? 0);
    this.buildLabel.setAlpha(affordable ? 1 : 0.4);
  }

  private onBuildMode(active: boolean): void {
    this.modeIndicator.setVisible(active);
    this.buildButton.setFillStyle(active ? 0x5a5140 : 0x3a3730);
  }

  /** Reflect the worker's live task state: current action label + queued count, and Cancel visibility. */
  private onTasks(state: { current: string | null; pending: number }): void {
    const busy = state.current !== null || state.pending > 0;
    this.queueText.setText(busy ? `▶ ${state.current ?? 'idle'}${state.pending ? ` · +${state.pending} queued` : ''}` : '');
    this.cancelButton.setVisible(busy);
    this.cancelLabel.setVisible(busy);
  }
}
