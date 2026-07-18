import { describe, it, expect } from 'vitest';
import { HistoryStack, DEFAULT_MAX_HISTORY_DEPTH, type Command } from '../history';

/** A command that adds `delta` to a shared counter — the simplest patch pair to assert do/undo on. */
function counterCmd(state: { value: number }, delta: number, strokeId?: string): Command {
  return {
    do: () => {
      state.value += delta;
    },
    undo: () => {
      state.value -= delta;
    },
    strokeId,
  };
}

describe('HistoryStack.apply', () => {
  it('runs do() immediately and records an undoable entry', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    expect(h.canUndo()).toBe(false);
    h.apply(counterCmd(state, 5));
    expect(state.value).toBe(5);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    expect(h.depth).toEqual({ undo: 1, redo: 0 });
  });
});

describe('HistoryStack.undo / redo', () => {
  it('undo reverses and redo re-applies', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    h.apply(counterCmd(state, 3));
    h.apply(counterCmd(state, 4));
    expect(state.value).toBe(7);

    expect(h.undo()).toBe(true);
    expect(state.value).toBe(3);
    expect(h.canRedo()).toBe(true);

    expect(h.undo()).toBe(true);
    expect(state.value).toBe(0);
    expect(h.canUndo()).toBe(false);

    expect(h.redo()).toBe(true);
    expect(state.value).toBe(3);
    expect(h.redo()).toBe(true);
    expect(state.value).toBe(7);
    expect(h.canRedo()).toBe(false);
  });

  it('redo runs the command do() again, not undo()', () => {
    const log: string[] = [];
    const h = new HistoryStack();
    h.apply({ do: () => log.push('do'), undo: () => log.push('undo') });
    h.undo();
    h.redo();
    expect(log).toEqual(['do', 'undo', 'do']);
  });

  it('undo on an empty stack returns false and no-ops', () => {
    const h = new HistoryStack();
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);
  });
});

describe('HistoryStack redo invalidation', () => {
  it('a new apply after an undo clears the redo branch', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    h.apply(counterCmd(state, 1)); // value 1
    h.apply(counterCmd(state, 10)); // value 11
    h.undo(); // value 1, redo has the +10
    expect(h.canRedo()).toBe(true);

    h.apply(counterCmd(state, 100)); // value 101 — should drop the +10 redo branch
    expect(state.value).toBe(101);
    expect(h.canRedo()).toBe(false);
    expect(h.redo()).toBe(false);
    expect(state.value).toBe(101);
  });
});

describe('HistoryStack stroke coalescing', () => {
  it('consecutive commands sharing a strokeId collapse into one undo entry', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    h.apply(counterCmd(state, 1, 'stroke-1'));
    h.apply(counterCmd(state, 1, 'stroke-1'));
    h.apply(counterCmd(state, 1, 'stroke-1'));
    expect(state.value).toBe(3);
    expect(h.depth).toEqual({ undo: 1, redo: 0 });

    expect(h.undo()).toBe(true);
    expect(state.value).toBe(0); // whole stroke reverted in one undo
    expect(h.depth).toEqual({ undo: 0, redo: 1 });

    expect(h.redo()).toBe(true);
    expect(state.value).toBe(3); // whole stroke re-applied in one redo
  });

  it('undoes coalesced ops in reverse application order', () => {
    const log: string[] = [];
    const mk = (tag: string): Command => ({
      do: () => log.push(`do-${tag}`),
      undo: () => log.push(`undo-${tag}`),
      strokeId: 's',
    });
    const h = new HistoryStack();
    h.apply(mk('a'));
    h.apply(mk('b'));
    h.apply(mk('c'));
    log.length = 0; // ignore the do's fired on apply
    h.undo();
    expect(log).toEqual(['undo-c', 'undo-b', 'undo-a']);
  });

  it('different strokeIds do not coalesce', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    h.apply(counterCmd(state, 1, 'stroke-1'));
    h.apply(counterCmd(state, 1, 'stroke-2'));
    expect(h.depth).toEqual({ undo: 2, redo: 0 });
    h.undo();
    expect(state.value).toBe(1); // only stroke-2 reverted
  });

  it('commands with no strokeId never coalesce, even when consecutive', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    h.apply(counterCmd(state, 1));
    h.apply(counterCmd(state, 1));
    expect(h.depth).toEqual({ undo: 2, redo: 0 });
  });

  it('a re-used strokeId after an undo starts a fresh entry (never merges into a popped one)', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    h.apply(counterCmd(state, 1, 'stroke-1'));
    h.apply(counterCmd(state, 1, 'stroke-1')); // one coalesced entry, value 2
    expect(h.depth).toEqual({ undo: 1, redo: 0 });

    h.undo(); // value 0, entry moved to redo
    expect(state.value).toBe(0);

    h.apply(counterCmd(state, 1, 'stroke-1')); // redo cleared; a brand-new entry
    expect(state.value).toBe(1);
    expect(h.depth).toEqual({ undo: 1, redo: 0 });
  });
});

describe('HistoryStack deep sequences', () => {
  it('unwinds and rewinds a long run consistently', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    for (let i = 0; i < 25; i++) h.apply(counterCmd(state, i + 1));
    const total = (25 * 26) / 2; // 1..25
    expect(state.value).toBe(total);

    for (let i = 0; i < 25; i++) expect(h.undo()).toBe(true);
    expect(state.value).toBe(0);
    expect(h.canUndo()).toBe(false);

    for (let i = 0; i < 25; i++) expect(h.redo()).toBe(true);
    expect(state.value).toBe(total);
    expect(h.canRedo()).toBe(false);
  });
});

describe('HistoryStack bounded depth', () => {
  it('caps the undo stack at maxDepth, dropping the oldest entries', () => {
    const state = { value: 0 };
    const h = new HistoryStack(3);
    for (let i = 1; i <= 6; i++) h.apply(counterCmd(state, i)); // 1+2+3+4+5+6 = 21
    expect(state.value).toBe(21);
    // Only the 3 newest entries (+4,+5,+6) are retained; the older three were dropped.
    expect(h.depth).toEqual({ undo: 3, redo: 0 });

    expect(h.undo()).toBe(true); // revert +6
    expect(h.undo()).toBe(true); // revert +5
    expect(h.undo()).toBe(true); // revert +4
    expect(state.value).toBe(6); // 21 - 6 - 5 - 4 — the dropped +1/+2/+3 are unreachable
    expect(h.canUndo()).toBe(false);
  });

  it('trimming the oldest never disturbs stroke coalescing into the top entry', () => {
    const state = { value: 0 };
    const h = new HistoryStack(2);
    h.apply(counterCmd(state, 1)); // entry A
    h.apply(counterCmd(state, 1)); // entry B
    h.apply(counterCmd(state, 1, 'live')); // entry C (drops A; stack = [B, C])
    h.apply(counterCmd(state, 1, 'live')); // coalesces INTO C, no new entry
    expect(state.value).toBe(4);
    expect(h.depth).toEqual({ undo: 2, redo: 0 });

    expect(h.undo()).toBe(true); // whole 'live' stroke (both ops) reverts together
    expect(state.value).toBe(2);
  });

  it('defaults to DEFAULT_MAX_HISTORY_DEPTH and treats a non-positive cap as the default', () => {
    const state = { value: 0 };
    const h = new HistoryStack(0); // 0 → default, not "unbounded"
    for (let i = 0; i < DEFAULT_MAX_HISTORY_DEPTH + 50; i++) h.apply(counterCmd(state, 1));
    expect(h.depth).toEqual({ undo: DEFAULT_MAX_HISTORY_DEPTH, redo: 0 });
  });
});

describe('HistoryStack.clear', () => {
  it('empties both stacks', () => {
    const state = { value: 0 };
    const h = new HistoryStack();
    h.apply(counterCmd(state, 1));
    h.undo();
    expect(h.canUndo() || h.canRedo()).toBe(true);
    h.clear();
    expect(h.depth).toEqual({ undo: 0, redo: 0 });
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
