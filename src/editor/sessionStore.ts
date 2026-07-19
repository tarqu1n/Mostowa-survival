/**
 * localStorage persistence for the editor's boot-resume session slice — Phaser-free, no `MapFile`
 * import: this is pure editor view-state, never map data. Modelled on `libraryViewStore.ts`: same
 * `storage()` guard, keys under a `mostowo-editor-session:` prefix, every read degrades to `null` on
 * a parse/availability/validation failure, every write swallows its errors (quota / disabled storage
 * is non-fatal — the session just won't persist).
 *
 * Two keys, each with exactly one writer (later steps):
 *   - **last** (`…:last`) — the whole boot-resume session (`SessionLast`), written by a store-driven
 *     autosave. Singleton, not keyed by map.
 *   - **camera** (`…:camera:<mapId>`) — per-map camera scroll/zoom (`CameraState`), written by
 *     `EditorScene` on gesture-settle.
 */

import type { EditorTool } from './store/editorStore';

/** A map's camera scroll offset and zoom — enough to restore the exact viewport on reload. */
export type CameraState = { scrollX: number; scrollY: number; zoom: number };

/** The boot-resume session: which map was open and the active tool/layer/tab within it. */
export type SessionLast = {
  mapId: string;
  activeTool?: EditorTool;
  activeLayerId?: string | null;
  activeTabId?: string;
};

const PREFIX = 'mostowo-editor-session:';
const LAST_KEY = `${PREFIX}last`;
const cameraKey = (mapId: string) => `${PREFIX}camera:${mapId}`;

/** `globalThis.localStorage`, or `null` if it's unavailable or even *accessing* it throws (some
 *  browsers throw on the property access itself when storage is disabled). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// ---- last session (singleton) ----

/** The persisted boot-resume session, or `null` if none / unreadable / malformed. A valid record
 *  must at least carry a string `mapId`; missing optional fields are tolerated. */
export function getLast(): SessionLast | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(LAST_KEY);
    if (raw === null) return null;
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    const { mapId } = obj as { mapId?: unknown };
    if (typeof mapId !== 'string') return null;
    return obj as SessionLast;
  } catch {
    return null;
  }
}

export function putLast(last: SessionLast): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(LAST_KEY, JSON.stringify(last));
  } catch {
    // Session slice is tiny; a failure here (quota/availability) is non-fatal.
  }
}

export function clearLast(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(LAST_KEY);
  } catch {
    // no-op
  }
}

// ---- camera (by mapId) ----

/** The persisted camera for `mapId`, or `null` if none / unreadable / malformed. A valid record must
 *  carry three finite numbers (`scrollX`/`scrollY`/`zoom`). */
export function getCamera(mapId: string): CameraState | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(cameraKey(mapId));
    if (raw === null) return null;
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    const { scrollX, scrollY, zoom } = obj as {
      scrollX?: unknown;
      scrollY?: unknown;
      zoom?: unknown;
    };
    if (
      typeof scrollX !== 'number' ||
      !Number.isFinite(scrollX) ||
      typeof scrollY !== 'number' ||
      !Number.isFinite(scrollY) ||
      typeof zoom !== 'number' ||
      !Number.isFinite(zoom)
    ) {
      return null;
    }
    return { scrollX, scrollY, zoom };
  } catch {
    return null;
  }
}

export function putCamera(mapId: string, cam: CameraState): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(cameraKey(mapId), JSON.stringify(cam));
  } catch {
    // Camera state is tiny; a failure here (quota/availability) is non-fatal.
  }
}

export function clearCamera(mapId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(cameraKey(mapId));
  } catch {
    // no-op
  }
}
