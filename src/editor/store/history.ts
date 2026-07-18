/**
 * Generic undo/redo command stack for the map editor (plan 014 step 5). PURE — no React, no
 * Phaser, no editor-store imports — so it runs as a Tier-1 vitest in plain Node
 * (`__tests__/history.test.ts`). The zustand store owns one instance and routes every document
 * mutation through it (`editorStore.applyCommand`); this module knows nothing about maps.
 *
 * A `Command` carries `do`/`undo` closures (typically a patch pair over the document). `apply` runs
 * `do` immediately, records the pair, and drops any redo history (the classic branch-invalidation
 * rule). `undo`/`redo` replay the recorded closures.
 *
 * Stroke coalescing: a paint drag fires one command per touched cell, but the user expects ONE undo
 * to revert the whole stroke. A command whose `strokeId` equals the current top entry's coalesces
 * INTO that entry — its `undo` then reverts every merged op in reverse order and its `redo` replays
 * them in order. Stroke ids are unique per drag (the store mints a fresh one on pointer-down), so a
 * fresh stroke — or any command issued after an undo/redo — never merges into a stale entry (the
 * top entry it would target is no longer the one it shared an id with).
 *
 * `domain` (plan 014 step 9): an opaque, generic string tag a caller can stamp on a `Command` — this
 * module never interprets it, just remembers the most recently applied/undone/redone entry's tag via
 * `getLastDomain()`. The editor store uses this to run ONE shared undo/redo stack across both the map
 * document and the world-layout placements (so Ctrl+Z works uniformly regardless of which tab is
 * active) while still knowing, after a move, which side effects to update — without this module needing
 * to know anything about maps or worlds. The store recognises exactly three tags: `undefined` (a pure
 * map edit → bump map `dirty`/`docRevision`), `'world'` (a placement edit → bump `worldDirty`/
 * `worldRevision`), and `'map+world'` (a resize that also compensates a placed map's origin, plan 024 →
 * bump BOTH sets).
 *
 * Bounded depth: every entry pins its `do`/`undo` closures — and whatever document data those closures
 * capture (sparse cell changes, or a whole layer's `cells` array for a resize) — for as long as it sits
 * on the stack, which is only ever emptied on New/Open. An uncapped stack therefore grows monotonically
 * with edit count, and a long editing session steadily inflates the heap until the tab turns sluggish
 * and eventually crashes (worst on memory-constrained mobile — the editor is authored from a phone).
 * `maxDepth` caps the retained undo entries; `apply` drops the oldest once the cap is exceeded, trading
 * unreachably-deep history for bounded memory. Redo is bounded implicitly: you can only redo what you
 * undid, so the redo stack never exceeds the undo stack's depth.
 */

/** Default cap on retained undo entries — deep enough that no one reaches the far end in practice,
 *  shallow enough to keep the retained closures (and captured map data) bounded. See module doc. */
export const DEFAULT_MAX_HISTORY_DEPTH = 200;

export interface Command {
  /** Optional label (debugging / future UI). */
  label?: string;
  /** Applies the change. Runs once on `apply`, and again on each `redo`. */
  do: () => void;
  /** Reverses the change. Runs on each `undo`. */
  undo: () => void;
  /** Consecutive commands with an equal, defined `strokeId` coalesce into one undo entry. */
  strokeId?: string;
  /** Opaque caller-defined tag — see module doc. Untagged commands are simply `undefined`. */
  domain?: string;
}

/** One undo-stack slot. A plain command is a single-op entry; a coalesced stroke holds many ops
 *  applied under one `strokeId`. `undos` run in reverse on undo; `dos` run in order on redo. */
interface Entry {
  strokeId?: string;
  label?: string;
  domain?: string;
  dos: Array<() => void>;
  undos: Array<() => void>;
}

export class HistoryStack {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private lastDomain: string | undefined;
  private readonly maxDepth: number;

  /** `maxDepth` caps retained undo entries (see module doc); defaults to `DEFAULT_MAX_HISTORY_DEPTH`.
   *  A value ≤ 0 is treated as the default (never unbounded — that's the leak this cap exists to fix). */
  constructor(maxDepth: number = DEFAULT_MAX_HISTORY_DEPTH) {
    this.maxDepth = maxDepth > 0 ? maxDepth : DEFAULT_MAX_HISTORY_DEPTH;
  }

  /** Run `cmd.do()`, record it, and clear the redo history. Coalesces into the top entry when
   *  stroke ids match (see module doc). */
  apply(cmd: Command): void {
    cmd.do();
    this.redoStack = [];
    this.lastDomain = cmd.domain;
    const top = this.undoStack[this.undoStack.length - 1];
    if (cmd.strokeId !== undefined && top && top.strokeId === cmd.strokeId) {
      top.dos.push(cmd.do);
      top.undos.push(cmd.undo);
      return;
    }
    this.undoStack.push({
      strokeId: cmd.strokeId,
      label: cmd.label,
      domain: cmd.domain,
      dos: [cmd.do],
      undos: [cmd.undo],
    });
    // Drop the oldest entries once past the cap so retained closures (and the map data they capture)
    // stay bounded across a long session. Trimming the FRONT never disturbs the top entry that stroke
    // coalescing targets. Only the fresh-entry path can grow the stack — coalescing returns above.
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.splice(0, this.undoStack.length - this.maxDepth);
    }
  }

  /** Revert the most recent entry (all coalesced ops, in reverse). Returns false if the undo stack
   *  is empty. */
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.lastDomain = entry.domain;
    for (let i = entry.undos.length - 1; i >= 0; i--) entry.undos[i]();
    this.redoStack.push(entry);
    return true;
  }

  /** Replay the most recently undone entry (all ops, in order). Returns false if the redo stack is
   *  empty. */
  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.lastDomain = entry.domain;
    for (const run of entry.dos) run();
    this.undoStack.push(entry);
    return true;
  }

  /** The `domain` tag of the entry most recently touched by `apply`/`undo`/`redo` — see module doc.
   *  `undefined` before any command has been applied, or if that command was untagged. */
  getLastDomain(): string | undefined {
    return this.lastDomain;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Drop all history — call on New/Open (the old document's closures reference a map that's gone). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Entry counts (whole strokes, not merged ops) — handy for tests/debugging. */
  get depth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}
