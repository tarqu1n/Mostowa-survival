/**
 * Boot-resume orchestration for the editor session (plan 034). Mirrors `palettesSource.ts`'s posture
 * (a loader/restorer + an autosave subscriber + a flush), but persists the `mostowo-editor-session:last`
 * record only — which map is open plus the tool/layer/tab to restore *on boot resume*. The per-map
 * camera is NOT touched here: `EditorScene` owns that half end-to-end (reads in `buildScene`, writes on
 * gesture-settle), so this module never reads or writes a `camera:<mapId>` key.
 *
 * `openMapById` is the single open sequence shared by the manual Open dialog (`Toolbar`) and boot
 * restore, so both migrate + load identically; the camera restore that follows is automatic (the
 * scene's `buildScene`).
 */
import { getMap } from './api';
import { migrateMap } from '../systems/mapFormat';
import { useEditorStore } from './store/editorStore';
import { getLast, putLast, clearLast } from './sessionStore';

/** Debounce (ms) for the `last`-record autosave — coalesces a burst of tool/layer/tab switches into
 *  one write. Matches `palettesSource`'s cadence. */
const SESSION_AUTOSAVE_DEBOUNCE_MS = 400;

/** Module-scoped so `flushSession` can cancel a pending debounced write and persist immediately
 *  (critique #8). Exactly one writer path funnels through `writeNow`. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** The single open sequence for both the manual Open dialog and boot restore: fetch → migrate → load.
 *  Returns whether it succeeded; the caller decides on any user-facing message (a manual open toasts,
 *  a boot restore stays silent and self-heals a stale pointer). Camera restore is automatic — the
 *  scene's `buildScene` reads the saved camera once `loadMap` bumps the map epoch. */
export async function openMapById(id: string): Promise<boolean> {
  try {
    const raw = await getMap(id);
    const loaded = migrateMap(raw);
    useEditorStore.getState().loadMap(loaded, id);
    return true;
  } catch (e) {
    // Detail goes to the console (not lost); callers surface their own message per the boolean.
    console.warn(`[editor] open map "${id}" failed:`, (e as Error).message);
    return false;
  }
}

/** Boot resume (plan 034): if a saved session names a map, reopen it and re-apply the session-scoped
 *  tool/layer/tab. Silent — no toast. A stale pointer (the map was deleted → `getMap` 404s) clears the
 *  record and no-ops, so the next boot starts clean. */
export async function restoreSession(): Promise<void> {
  const last = getLast();
  if (!last?.mapId) return;
  const ok = await openMapById(last.mapId);
  if (!ok) {
    clearLast();
    return;
  }
  const store = useEditorStore.getState();
  if (last.activeTool) store.setActiveTool(last.activeTool);
  // `activateTab` no-ops on an unknown id, so a dangling active tab falls back to whatever loadMap set.
  if (last.activeTabId) store.activateTab(last.activeTabId);
  // Validate the saved layer against the freshly-loaded map before applying — `setActiveLayer` is a
  // bare `set` with no reconcile (critique #3); an unknown id would dangle. Else keep loadMap's default.
  if (last.activeLayerId && store.map?.layers.some((l) => l.id === last.activeLayerId)) {
    store.setActiveLayer(last.activeLayerId);
  }
}

/** Persist the `last` record now (no debounce). Writes the currently-open map's session, or clears the
 *  record when no map is open (a deliberate Close map → a clean boot next time). */
function writeNow(): void {
  const s = useEditorStore.getState();
  if (!s.mapId) {
    clearLast();
    return;
  }
  putLast({
    mapId: s.mapId,
    activeTool: s.activeTool,
    activeLayerId: s.activeLayerId,
    activeTabId: s.activeTabId,
  });
}

/** Subscribe to the session-scoped slice (map + tool + layer + tab) and debounce-persist the `last`
 *  record. Returns the unsubscribe fn. Install this AFTER `restoreSession()` resolves so the restore's
 *  own store writes don't immediately re-save. Camera is deliberately NOT in the selector — it's
 *  scene-owned and never written here. */
export function installSessionAutosave(): () => void {
  // A joined-string selector (primitive → default equality) fires the listener only when one of the
  // four fields actually changes; an array selector would need shallow equality to avoid firing on
  // every store update. NUL-separated so field-boundary shifts can't alias two distinct sessions.
  return useEditorStore.subscribe(
    (s) =>
      `${s.mapId ?? ''}\u0000${s.activeTool}\u0000${s.activeLayerId ?? ''}\u0000${s.activeTabId}`,
    () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        writeNow();
      }, SESSION_AUTOSAVE_DEBOUNCE_MS);
    },
  );
}

/** Cancel any pending debounced write and persist immediately — for the page-lifecycle listeners
 *  (`visibilitychange:hidden`/`pagehide`), so a discard/refresh mid-debounce still records the pointer. */
export function flushSession(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeNow();
}
