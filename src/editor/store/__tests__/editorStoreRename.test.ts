import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import { getSettings, putSettings, type UnderlaySettings } from '../../underlayStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom) — mirrors the fake in
 *  `editorStoreResize.test.ts` since these tests exercise `renameMapState`'s underlay-settings
 *  migration through the real `getSettings`/`putSettings`/`deleteSettings`, not a mock of them. */
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

/** The store is a module-level singleton; reset the map + world + localStorage before each test
 *  (mirrors `editorStoreResize.test.ts`'s `reset`). */
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

describe('editorStore: renameMapState (plan 025 step 3)', () => {
  beforeEach(() => reset());
  afterEach(() => vi.unstubAllGlobals());

  it('id + name change sets a NEW map reference, updates meta.id/meta.name + mapId, and clears dirty', () => {
    const before = useEditorStore.getState().map!;
    useEditorStore.setState({ dirty: true });

    const { placementMigrated } = useEditorStore.getState().renameMapState('renamed', 'Renamed');

    const after = useEditorStore.getState().map!;
    expect(after).not.toBe(before); // new reference so React chrome re-renders
    expect(after.meta.id).toBe('renamed');
    expect(after.meta.name).toBe('Renamed');
    expect(useEditorStore.getState().mapId).toBe('renamed');
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(placementMigrated).toBe(false);
  });

  it('migrates the underlay-settings key on an id change (new present, old gone) and bumps underlayRevision', () => {
    putSettings('scratch', BASE_SETTINGS);
    const revBefore = useEditorStore.getState().underlayRevision;

    useEditorStore.getState().renameMapState('renamed', 'Renamed');

    expect(getSettings('renamed')).toEqual(BASE_SETTINGS);
    expect(getSettings('scratch')).toBeNull();
    expect(useEditorStore.getState().underlayRevision).toBe(revBefore + 1);
  });

  it('does not touch underlay settings or bump underlayRevision when the old id had none', () => {
    const revBefore = useEditorStore.getState().underlayRevision;

    useEditorStore.getState().renameMapState('renamed', 'Renamed');

    expect(getSettings('renamed')).toBeNull();
    expect(useEditorStore.getState().underlayRevision).toBe(revBefore);
  });

  it('migrates a world placement mapId oldId->newId, sets worldDirty, and returns placementMigrated true', () => {
    useEditorStore.getState().addPlacement('scratch', { col: 10, row: 20 });
    useEditorStore.getState().markWorldSaved(); // isolate the rename's own dirty-marking
    const revBefore = useEditorStore.getState().worldRevision;

    const { placementMigrated } = useEditorStore.getState().renameMapState('renamed', 'Renamed');

    expect(placementMigrated).toBe(true);
    const placements = useEditorStore.getState().world.placements;
    expect(placements[0].mapId).toBe('renamed');
    expect(placements[0].origin).toEqual({ col: 10, row: 20 }); // origin untouched
    expect(useEditorStore.getState().worldDirty).toBe(true);
    expect(useEditorStore.getState().worldRevision).toBe(revBefore + 1);
  });

  it('leaves the world untouched and returns placementMigrated false when the map is not placed', () => {
    useEditorStore.getState().markWorldSaved();
    const revBefore = useEditorStore.getState().worldRevision;

    const { placementMigrated } = useEditorStore.getState().renameMapState('renamed', 'Renamed');

    expect(placementMigrated).toBe(false);
    expect(useEditorStore.getState().world.placements).toEqual([]);
    expect(useEditorStore.getState().worldDirty).toBe(false);
    expect(useEditorStore.getState().worldRevision).toBe(revBefore);
  });

  it('a name-only change (id unchanged) leaves the underlay + world keys alone but swaps the map ref + name', () => {
    putSettings('scratch', BASE_SETTINGS);
    useEditorStore.getState().addPlacement('scratch', { col: 1, row: 2 });
    useEditorStore.getState().markWorldSaved();
    const underlayRevBefore = useEditorStore.getState().underlayRevision;
    const worldRevBefore = useEditorStore.getState().worldRevision;
    const before = useEditorStore.getState().map!;

    const { placementMigrated } = useEditorStore.getState().renameMapState('scratch', 'New Name');

    const after = useEditorStore.getState().map!;
    expect(after).not.toBe(before);
    expect(after.meta.id).toBe('scratch');
    expect(after.meta.name).toBe('New Name');
    expect(useEditorStore.getState().mapId).toBe('scratch');
    // underlay/world untouched
    expect(getSettings('scratch')).toEqual(BASE_SETTINGS);
    expect(useEditorStore.getState().underlayRevision).toBe(underlayRevBefore);
    expect(useEditorStore.getState().world.placements[0].mapId).toBe('scratch');
    expect(useEditorStore.getState().worldDirty).toBe(false);
    expect(useEditorStore.getState().worldRevision).toBe(worldRevBefore);
    expect(placementMigrated).toBe(false);
  });

  it('no-op (returns placementMigrated false) when there is no open map', () => {
    useEditorStore.getState().closeMap();
    expect(useEditorStore.getState().map).toBeNull();

    const { placementMigrated } = useEditorStore.getState().renameMapState('renamed', 'Renamed');

    expect(placementMigrated).toBe(false);
    expect(useEditorStore.getState().map).toBeNull();
  });
});
