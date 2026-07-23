/**
 * localStorage persistence for GLOBAL editor UI preferences — Phaser-free, no `MapFile` import, and
 * (unlike `libraryViewStore`/`sessionStore`) NOT keyed by map: these are workspace-wide chrome
 * toggles that should survive across maps and reloads. Same `storage()` guard and error-swallowing
 * conventions as its sibling stores — a read degrades to its default, a write is best-effort (quota /
 * disabled storage is non-fatal, the pref just won't persist).
 *
 * One key so far:
 *   - **tilingBarCollapsed** (`…:tilingBarCollapsed`) — whether the Map-tab palette/skin strip is
 *     collapsed to a thin handle (phone feedback: the strip gets in the way when you're not tiling).
 */

const PREFIX = 'mostowo-editor-ui:';
const TILING_BAR_COLLAPSED_KEY = `${PREFIX}tilingBarCollapsed`;

/** `globalThis.localStorage`, or `null` if it's unavailable or even *accessing* it throws (some
 *  browsers throw on the property access itself when storage is disabled). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The persisted tiling-bar collapsed flag, defaulting to `false` (expanded) when unset / unreadable. */
export function getTilingBarCollapsed(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    return s.getItem(TILING_BAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function putTilingBarCollapsed(collapsed: boolean): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(TILING_BAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Tiny pref; a failure here (quota/availability) is non-fatal.
  }
}
