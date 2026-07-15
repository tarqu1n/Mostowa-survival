import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteCachedImage,
  deleteSettings,
  getCachedImage,
  getSettings,
  putCachedImage,
  putSettings,
  type UnderlaySettings,
} from '../underlayStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom). `quotaAfter` makes `setItem`
 *  throw a `QuotaExceededError` once the store already holds that many keys, to drive the
 *  LRU-evict-and-retry path deterministically. */
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  constructor(private quotaAfter = Infinity) {}
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
    if (!this.map.has(key) && this.map.size >= this.quotaAfter) {
      throw new DOMException('quota', 'QuotaExceededError');
    }
    this.map.set(key, value);
  }
}

function useStorage(s: Storage | undefined) {
  vi.stubGlobal('localStorage', s);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SETTINGS: UnderlaySettings = {
  referenceName: 'mostowo',
  visible: true,
  locked: false,
  opacity: 0.4,
  offsetX: 2,
  offsetY: -3,
  scale: 1,
};

describe('underlayStore settings', () => {
  it('round-trips settings by mapId', () => {
    useStorage(new FakeStorage());
    expect(getSettings('camp')).toBeNull();
    putSettings('camp', SETTINGS);
    expect(getSettings('camp')).toEqual(SETTINGS);
  });

  it('keys settings per map', () => {
    useStorage(new FakeStorage());
    putSettings('camp', SETTINGS);
    putSettings('forest', { ...SETTINGS, referenceName: null, opacity: 0.8 });
    expect(getSettings('camp')?.referenceName).toBe('mostowo');
    expect(getSettings('forest')?.referenceName).toBeNull();
  });

  it('deletes settings', () => {
    useStorage(new FakeStorage());
    putSettings('camp', SETTINGS);
    deleteSettings('camp');
    expect(getSettings('camp')).toBeNull();
  });

  it('degrades to null on malformed JSON', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-underlay:settings:camp', '{not json');
    useStorage(s);
    expect(getSettings('camp')).toBeNull();
  });

  it('degrades to null when storage is unavailable', () => {
    useStorage(undefined);
    expect(getSettings('camp')).toBeNull();
    expect(() => putSettings('camp', SETTINGS)).not.toThrow();
    expect(() => deleteSettings('camp')).not.toThrow();
  });
});

describe('underlayStore image cache', () => {
  it('round-trips a cached image by name', () => {
    useStorage(new FakeStorage());
    expect(getCachedImage('mostowo')).toBeNull();
    expect(putCachedImage('mostowo', 'data:image/png;base64,AAAA')).toBe(true);
    expect(getCachedImage('mostowo')).toBe('data:image/png;base64,AAAA');
  });

  it('evicts the least-recently-used image on quota and retries once', () => {
    // Room for the img-index key + exactly 2 image keys.
    useStorage(new FakeStorage(3));
    expect(putCachedImage('a', 'AAAA')).toBe(true);
    expect(putCachedImage('b', 'BBBB')).toBe(true);
    // Touch 'a' so 'b' becomes the LRU victim.
    expect(getCachedImage('a')).toBe('AAAA');
    // 'c' won't fit → evict LRU ('b') and retry.
    expect(putCachedImage('c', 'CCCC')).toBe(true);
    expect(getCachedImage('b')).toBeNull();
    expect(getCachedImage('a')).toBe('AAAA');
    expect(getCachedImage('c')).toBe('CCCC');
  });

  it('gives up gracefully when nothing can be evicted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Zero room — every setItem throws, and there's nothing to evict.
    useStorage(new FakeStorage(0));
    expect(putCachedImage('a', 'AAAA')).toBe(false);
    expect(getCachedImage('a')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('degrades to false/null when storage is unavailable', () => {
    useStorage(undefined);
    expect(putCachedImage('a', 'AAAA')).toBe(false);
    expect(getCachedImage('a')).toBeNull();
  });

  it('deletes a cached image and drops it from the LRU index', () => {
    useStorage(new FakeStorage());
    putCachedImage('a', 'AAAA');
    putCachedImage('b', 'BBBB');
    deleteCachedImage('a');
    expect(getCachedImage('a')).toBeNull();
    expect(getCachedImage('b')).toBe('BBBB');
    // 'a' is gone from the index, so the next quota eviction picks 'b', not the already-deleted 'a'.
    expect(localStorage.getItem('mostowo-editor-underlay:img-index')).toBe('["b"]');
  });

  it('deleteCachedImage is a no-op for an unknown name / unavailable storage', () => {
    useStorage(new FakeStorage());
    expect(() => deleteCachedImage('nope')).not.toThrow();
    useStorage(undefined);
    expect(() => deleteCachedImage('a')).not.toThrow();
  });
});
