import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import { getSettings, putSettings, type UnderlaySettings } from '../../underlayStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom) — mirrors the fake in
 *  `underlayStore.test.ts` since these tests exercise `resizeMap`'s underlay-offset shift through
 *  the real `getSettings`/`putSettings`, not a mock of them. */
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

/** The store is a module-level singleton; reset the map + world + history + localStorage before
 *  each test (mirrors `editorStoreWorld.test.ts`'s `reset`, plus a fresh fake `localStorage` since
 *  underlay persistence round-trips through the real `underlayStore`). */
function reset(): void {
  vi.stubGlobal('localStorage', new FakeStorage());
  useEditorStore.getState().newMap('scratch', 'Scratch', 4, 4);
  useEditorStore.getState().setWorld({ schemaVersion: 1, placements: [] });
}

const BASE_SETTINGS: UnderlaySettings = {
  referenceName: 'mostowo',
  visible: true,
  locked: false,
  opacity: 0.5,
  offsetX: 5,
  offsetY: -3,
  scale: 1,
};

describe('editorStore: resizeMap (plan 024 step 2)', () => {
  beforeEach(() => reset());
  afterEach(() => vi.unstubAllGlobals());

  it('map-only resize (right/bottom expand) updates dims + grid lengths, is undoable in one step, and leaves world untouched', () => {
    const ok = useEditorStore.getState().resizeMap({ top: 0, right: 2, bottom: 3, left: 0 });
    expect(ok).toBe(true);

    const map = useEditorStore.getState().map!;
    expect(map.meta.width).toBe(6);
    expect(map.meta.height).toBe(7);
    expect(map.layers[0].cells.length).toBe(42);
    expect(map.walkability.cells.length).toBe(42);
    expect(map.zones.cells.length).toBe(42);
    expect(useEditorStore.getState().canUndo).toBe(true);
    expect(useEditorStore.getState().worldDirty).toBe(false);

    useEditorStore.getState().undo();
    const restored = useEditorStore.getState().map!;
    expect(restored.meta.width).toBe(4);
    expect(restored.meta.height).toBe(4);
    expect(restored.layers[0].cells.length).toBe(16);
    expect(useEditorStore.getState().worldDirty).toBe(false);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().map!.meta.width).toBe(6);
    expect(useEditorStore.getState().map!.meta.height).toBe(7);
  });

  it('blocks (returns false, no mutation) when an object would leave the new bounds', () => {
    useEditorStore.getState().placeNode('tree', 3, 3); // corner of the 4x4 map
    const beforeMap = useEditorStore.getState().map!;
    const beforeWidth = beforeMap.meta.width;
    const beforeObjectCount = beforeMap.objects.length;

    // Cropping 2 off the right edge shrinks width to 2 — the node at col 3 would leave bounds.
    const ok = useEditorStore.getState().resizeMap({ top: 0, right: -2, bottom: 0, left: 0 });
    expect(ok).toBe(false);

    const afterMap = useEditorStore.getState().map!;
    expect(afterMap.meta.width).toBe(beforeWidth);
    expect(afterMap.objects.length).toBe(beforeObjectCount);
    expect(useEditorStore.getState().worldDirty).toBe(false);
  });

  it('a placed map top/left resize shifts the placement origin, sets worldDirty, and undo/redo round-trip both', () => {
    useEditorStore.getState().addPlacement('scratch', { col: 10, row: 20 });
    useEditorStore.getState().markWorldSaved(); // isolate the resize's own dirty-marking

    const ok = useEditorStore.getState().resizeMap({ top: 1, right: 0, bottom: 0, left: 2 });
    expect(ok).toBe(true);
    expect(useEditorStore.getState().world.placements[0].origin).toEqual({ col: 8, row: 19 });
    expect(useEditorStore.getState().worldDirty).toBe(true);
    expect(useEditorStore.getState().map!.meta.width).toBe(6);
    expect(useEditorStore.getState().map!.meta.height).toBe(5);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().world.placements[0].origin).toEqual({ col: 10, row: 20 });
    expect(useEditorStore.getState().map!.meta.width).toBe(4);
    expect(useEditorStore.getState().map!.meta.height).toBe(4);
    expect(useEditorStore.getState().worldDirty).toBe(true); // undoing a coupled command still touches world

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().world.placements[0].origin).toEqual({ col: 8, row: 19 });
    expect(useEditorStore.getState().map!.meta.width).toBe(6);
    expect(useEditorStore.getState().map!.meta.height).toBe(5);
  });

  it('a placed map right/bottom-only resize does NOT touch the placement or dirty the world', () => {
    useEditorStore.getState().addPlacement('scratch', { col: 5, row: 5 });
    useEditorStore.getState().markWorldSaved();

    const ok = useEditorStore.getState().resizeMap({ top: 0, right: 2, bottom: 2, left: 0 });
    expect(ok).toBe(true);
    expect(useEditorStore.getState().world.placements[0].origin).toEqual({ col: 5, row: 5 });
    expect(useEditorStore.getState().worldDirty).toBe(false);
  });

  it('shifts the persisted underlay offset on a top/left resize even when not hydrated; undo restores it', () => {
    putSettings('scratch', BASE_SETTINGS);
    const revBefore = useEditorStore.getState().underlayRevision;

    const ok = useEditorStore.getState().resizeMap({ top: 3, right: 0, bottom: 0, left: 2 });
    expect(ok).toBe(true);
    expect(getSettings('scratch')).toEqual({ ...BASE_SETTINGS, offsetX: 7, offsetY: 0 });
    // No live underlay hydrated — syncUnderlayFromSettings has nothing to reconcile, so no bump.
    expect(useEditorStore.getState().underlay).toBeNull();
    expect(useEditorStore.getState().underlayRevision).toBe(revBefore);

    useEditorStore.getState().undo();
    expect(getSettings('scratch')).toEqual(BASE_SETTINGS);
  });

  it('resize -> undo -> redo round-trips a LIVE underlay offset via syncUnderlayFromSettings, bumping underlayRevision on each divergence', () => {
    putSettings('scratch', BASE_SETTINGS);
    useEditorStore.setState({
      underlay: { ...BASE_SETTINGS, dataUrl: 'data:image/png;base64,x' },
    });
    const revBefore = useEditorStore.getState().underlayRevision;

    useEditorStore.getState().resizeMap({ top: 1, right: 0, bottom: 0, left: 4 });
    let live = useEditorStore.getState().underlay!;
    expect(live.offsetX).toBe(9);
    expect(live.offsetY).toBe(-2);
    expect(useEditorStore.getState().underlayRevision).toBeGreaterThan(revBefore);
    const revAfterDo = useEditorStore.getState().underlayRevision;

    useEditorStore.getState().undo();
    live = useEditorStore.getState().underlay!;
    expect(live.offsetX).toBe(5);
    expect(live.offsetY).toBe(-3);
    expect(useEditorStore.getState().underlayRevision).toBeGreaterThan(revAfterDo);
    const revAfterUndo = useEditorStore.getState().underlayRevision;

    useEditorStore.getState().redo();
    live = useEditorStore.getState().underlay!;
    expect(live.offsetX).toBe(9);
    expect(live.offsetY).toBe(-2);
    expect(useEditorStore.getState().underlayRevision).toBeGreaterThan(revAfterUndo);
  });
});
