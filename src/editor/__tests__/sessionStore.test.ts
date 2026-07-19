import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearCamera,
  clearLast,
  getCamera,
  getLast,
  putCamera,
  putLast,
  type CameraState,
  type SessionLast,
} from '../sessionStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom). */
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

const LAST: SessionLast = {
  mapId: 'camp',
  activeTool: 'brush',
  activeLayerId: 'ground',
  activeTabId: 'library',
};

const CAMERA: CameraState = { scrollX: 128, scrollY: -64, zoom: 2 };

describe('sessionStore last', () => {
  it('returns null when storage is unavailable', () => {
    useStorage(undefined);
    expect(getLast()).toBeNull();
    expect(() => putLast(LAST)).not.toThrow();
    expect(() => clearLast()).not.toThrow();
  });

  it('returns null when nothing is stored', () => {
    useStorage(new FakeStorage());
    expect(getLast()).toBeNull();
  });

  it('round-trips the session record', () => {
    useStorage(new FakeStorage());
    putLast(LAST);
    expect(getLast()).toEqual(LAST);
  });

  it('tolerates missing optional fields (only mapId required)', () => {
    useStorage(new FakeStorage());
    putLast({ mapId: 'forest' });
    expect(getLast()).toEqual({ mapId: 'forest' });
  });

  it('degrades to null on malformed JSON', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-session:last', '{not json');
    useStorage(s);
    expect(getLast()).toBeNull();
  });

  it('degrades to null when the stored value is not an object', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-session:last', JSON.stringify('nope'));
    useStorage(s);
    expect(getLast()).toBeNull();
  });

  it('degrades to null when mapId is missing or not a string', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-session:last', JSON.stringify({ activeTool: 'brush' }));
    useStorage(s);
    expect(getLast()).toBeNull();
    s.setItem('mostowo-editor-session:last', JSON.stringify({ mapId: 42 }));
    expect(getLast()).toBeNull();
  });

  it('clears the session record', () => {
    useStorage(new FakeStorage());
    putLast(LAST);
    clearLast();
    expect(getLast()).toBeNull();
  });
});

describe('sessionStore camera', () => {
  it('returns null when storage is unavailable', () => {
    useStorage(undefined);
    expect(getCamera('camp')).toBeNull();
    expect(() => putCamera('camp', CAMERA)).not.toThrow();
    expect(() => clearCamera('camp')).not.toThrow();
  });

  it('returns null when nothing is stored', () => {
    useStorage(new FakeStorage());
    expect(getCamera('camp')).toBeNull();
  });

  it('round-trips a camera state', () => {
    useStorage(new FakeStorage());
    putCamera('camp', CAMERA);
    expect(getCamera('camp')).toEqual(CAMERA);
  });

  it('keys camera per map', () => {
    useStorage(new FakeStorage());
    putCamera('camp', CAMERA);
    putCamera('forest', { ...CAMERA, zoom: 4 });
    expect(getCamera('camp')?.zoom).toBe(2);
    expect(getCamera('forest')?.zoom).toBe(4);
  });

  it('degrades to null on malformed JSON', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-session:camera:camp', '{not json');
    useStorage(s);
    expect(getCamera('camp')).toBeNull();
  });

  it('degrades to null when the stored value is not an object', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-session:camera:camp', JSON.stringify('nope'));
    useStorage(s);
    expect(getCamera('camp')).toBeNull();
  });

  it('degrades to null when a coordinate is missing or non-finite', () => {
    const s = new FakeStorage();
    useStorage(s);
    s.setItem('mostowo-editor-session:camera:camp', JSON.stringify({ scrollX: 1, scrollY: 2 }));
    expect(getCamera('camp')).toBeNull();
    s.setItem(
      'mostowo-editor-session:camera:camp',
      JSON.stringify({ scrollX: 1, scrollY: 2, zoom: null }),
    );
    expect(getCamera('camp')).toBeNull();
    // Infinity serializes to `null` via JSON.stringify, so a non-finite coordinate never survives a
    // round-trip; the explicit Number.isFinite guard also rejects it if it somehow did.
    s.setItem(
      'mostowo-editor-session:camera:camp',
      JSON.stringify({ scrollX: 1, scrollY: 2, zoom: 'big' }),
    );
    expect(getCamera('camp')).toBeNull();
  });

  it('clears the camera state', () => {
    useStorage(new FakeStorage());
    putCamera('camp', CAMERA);
    clearCamera('camp');
    expect(getCamera('camp')).toBeNull();
  });
});
