import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import { getTilingBarCollapsed } from '../../uiPrefsStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom) — mirrors the fake used across the
 *  other editor-store specs. Exercises the store's write-through to the real `uiPrefsStore`, not a
 *  mock of it. */
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const store = () => useEditorStore.getState();

describe('editorStore: tiling-bar collapse (setTilingBarCollapsed)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new FakeStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('toggles the in-memory flag and writes through to uiPrefsStore', () => {
    store().setTilingBarCollapsed(true);
    expect(store().tilingBarCollapsed).toBe(true);
    expect(getTilingBarCollapsed()).toBe(true);

    store().setTilingBarCollapsed(false);
    expect(store().tilingBarCollapsed).toBe(false);
    expect(getTilingBarCollapsed()).toBe(false);
  });
});
