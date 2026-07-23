import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTilingBarCollapsed, putTilingBarCollapsed } from '../uiPrefsStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom) — mirrors `sessionStore.test.ts`. */
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

function useStorage(s: Storage | undefined) {
  vi.stubGlobal('localStorage', s);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uiPrefsStore: tilingBarCollapsed', () => {
  it('defaults to false (expanded) when unset', () => {
    useStorage(new FakeStorage());
    expect(getTilingBarCollapsed()).toBe(false);
  });

  it('round-trips true and false through storage', () => {
    useStorage(new FakeStorage());
    putTilingBarCollapsed(true);
    expect(getTilingBarCollapsed()).toBe(true);
    putTilingBarCollapsed(false);
    expect(getTilingBarCollapsed()).toBe(false);
  });

  it('degrades to false and never throws when storage is unavailable', () => {
    useStorage(undefined);
    expect(getTilingBarCollapsed()).toBe(false);
    expect(() => putTilingBarCollapsed(true)).not.toThrow();
  });

  it('treats any non-"1" stored value as false', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-ui:tilingBarCollapsed', 'garbage');
    useStorage(s);
    expect(getTilingBarCollapsed()).toBe(false);
  });
});
