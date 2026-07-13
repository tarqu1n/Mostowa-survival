/**
 * Editor document store (plan 014 step 5) — the SINGLE React↔Phaser bridge. React components
 * subscribe via the `useEditorStore` hook; the Phaser `EditorScene` reads via
 * `useEditorStore.getState()` and `useEditorStore.subscribe(selector, listener)`. Neither side
 * imports the other; both talk only to this store.
 *
 * Every document mutation routes through the encapsulated `HistoryStack` (`applyCommand`/`undo`/
 * `redo`), so undo/redo is uniform. Two counters signal the Phaser scene what to do without it
 * re-diffing the whole `MapFile`:
 *  - `mapEpoch` bumps when the WHOLE document is replaced (New/Open/Close) → full texture (re)load,
 *    bake and camera fit.
 *  - `docRevision` bumps on every in-place edit (applyCommand/undo/redo) → rebake (step 6 narrows
 *    this to the dirty chunks the paint commands report; step 5 has no in-map edits yet).
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { createEmptyMap, type MapFile } from '../../systems/mapFormat';
import type { WorldLayout } from '../../systems/worldLayout';
import { HistoryStack, type Command } from './history';

export type EditorView = 'map' | 'world';

export type EditorTool =
  'pan' | 'brush' | 'eraser' | 'fill' | 'rect' | 'select' | 'collision' | 'zone' | 'shape';

export interface EditorOverlays {
  grid: boolean;
  walkability: boolean;
  zones: boolean;
  ghosts: boolean;
}

/** Loaded asset catalog. The Library panel populates this in step 6; `null` until then. */
export type EditorCatalog = unknown;

const EMPTY_WORLD: WorldLayout = { schemaVersion: 1, placements: [] };

export interface EditorState {
  view: EditorView;
  map: MapFile | null;
  mapId: string | null;
  dirty: boolean;
  world: WorldLayout;
  catalog: EditorCatalog;
  activeLayerId: string | null;
  activeTool: EditorTool;
  brushAsset: string | null;
  selectedObjectIds: string[];
  activeZoneId: number | null;
  overlays: EditorOverlays;

  /** Full-reload signal (see module doc). */
  mapEpoch: number;
  /** In-place-edit signal (see module doc). */
  docRevision: number;
  canUndo: boolean;
  canRedo: boolean;

  // ---- actions (all document mutations route through the history stack) ----
  newMap(id: string, name: string, width: number, height: number): void;
  loadMap(map: MapFile, id: string): void;
  closeMap(): void;
  setView(view: EditorView): void;
  setActiveLayer(layerId: string): void;
  setActiveTool(tool: EditorTool): void;
  setBrushAsset(asset: string | null): void;
  setSelectedObjectIds(ids: string[]): void;
  setActiveZoneId(id: number | null): void;
  toggleOverlay(key: keyof EditorOverlays): void;
  setWorld(world: WorldLayout): void;
  markSaved(): void;
  applyCommand(cmd: Command): void;
  undo(): void;
  redo(): void;
}

// One history stack for the single editor document. Encapsulated here (not exported): the store is
// the only thing that mutates it; React/Phaser observe via `docRevision`/`canUndo`/`canRedo`.
const history = new HistoryStack();

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set) => ({
    view: 'map',
    map: null,
    mapId: null,
    dirty: false,
    world: EMPTY_WORLD,
    catalog: null,
    activeLayerId: null,
    activeTool: 'pan',
    brushAsset: null,
    selectedObjectIds: [],
    activeZoneId: null,
    overlays: { grid: true, walkability: false, zones: false, ghosts: false },
    mapEpoch: 0,
    docRevision: 0,
    canUndo: false,
    canRedo: false,

    newMap: (id, name, width, height) => {
      const map = createEmptyMap(id, name, width, height);
      history.clear();
      set((s) => ({
        map,
        mapId: id,
        activeLayerId: map.layers[0]?.id ?? null,
        selectedObjectIds: [],
        dirty: true, // freshly created — not yet on disk
        mapEpoch: s.mapEpoch + 1,
        docRevision: 0,
        canUndo: false,
        canRedo: false,
      }));
    },

    loadMap: (map, id) => {
      history.clear();
      set((s) => ({
        map,
        mapId: id,
        activeLayerId: map.layers[0]?.id ?? null,
        selectedObjectIds: [],
        dirty: false, // just read from disk
        mapEpoch: s.mapEpoch + 1,
        docRevision: 0,
        canUndo: false,
        canRedo: false,
      }));
    },

    closeMap: () => {
      history.clear();
      set((s) => ({
        map: null,
        mapId: null,
        activeLayerId: null,
        selectedObjectIds: [],
        dirty: false,
        mapEpoch: s.mapEpoch + 1,
        docRevision: 0,
        canUndo: false,
        canRedo: false,
      }));
    },

    setView: (view) => set({ view }),
    setActiveLayer: (layerId) => set({ activeLayerId: layerId }),
    setActiveTool: (activeTool) => set({ activeTool }),
    setBrushAsset: (brushAsset) => set({ brushAsset }),
    setSelectedObjectIds: (selectedObjectIds) => set({ selectedObjectIds }),
    setActiveZoneId: (activeZoneId) => set({ activeZoneId }),
    toggleOverlay: (key) =>
      set((s): Partial<EditorState> => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } })),
    setWorld: (world) => set({ world }),
    markSaved: () => set({ dirty: false }),

    applyCommand: (cmd) => {
      history.apply(cmd);
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },

    undo: () => {
      if (!history.undo()) return;
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },

    redo: () => {
      if (!history.redo()) return;
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },
  })),
);
