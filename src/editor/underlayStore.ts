/**
 * localStorage persistence for the reference-underlay (plan 022 step 3) — Phaser-free, no `MapFile`
 * import: the underlay is pure editor view-state, never map data, so this deliberately can't touch
 * the map format. Two namespaces under the `mostowo-editor-underlay:` prefix (distinct from the
 * `mostowo-editor-layout` dockview key):
 *   - **settings by mapId** (`…:settings:<mapId>`) — tiny JSON, one per open map.
 *   - **cached image data-URLs by reference name** (`…:img:<name>`) — the base64 PNG, so N maps
 *     sharing one reference cache a single copy. An `…:img-index` array tracks use-order (LRU at
 *     front, MRU at end) so a `QuotaExceededError` can evict the least-recently-used image.
 *
 * Every read degrades to `null`/`[]` on a parse or availability failure (private-mode / disabled
 * storage / corrupt value) so the editor never hard-fails on it. Writes swallow their errors:
 * `putCachedImage` handles quota by evicting the LRU image and retrying once (then giving up with a
 * `console.warn`); `putSettings` (tiny payloads) just no-ops on failure.
 */

/** Underlay view-state persisted per map. `offsetX`/`offsetY` are in TILES (multiplied by
 *  `TILE_SIZE` when placing the sprite); `scale` is a multiplier over the 1:1 baseline; `opacity`
 *  is `0..1`. `referenceName` is a committed repo reference's name, or `null` for an ad-hoc
 *  file-picker/drag-drop image (whose data URL is not re-fetchable, only cached). */
export interface UnderlaySettings {
  referenceName: string | null;
  visible: boolean;
  locked: boolean;
  opacity: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

const PREFIX = 'mostowo-editor-underlay:';
const settingsKey = (mapId: string) => `${PREFIX}settings:${mapId}`;
const imageKey = (name: string) => `${PREFIX}img:${name}`;
const IMG_INDEX_KEY = `${PREFIX}img-index`;

/** `globalThis.localStorage`, or `null` if it's unavailable or even *accessing* it throws (some
 *  browsers throw on the property access itself when storage is disabled). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    // name is the modern signal; code 22 / the Firefox name are legacy fallbacks.
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)
  );
}

// ---- settings (by mapId) ----

/** Persisted underlay settings for `mapId`, or `null` if none / unreadable / malformed. */
export function getSettings(mapId: string): UnderlaySettings | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(settingsKey(mapId));
    if (raw === null) return null;
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    return obj as UnderlaySettings;
  } catch {
    return null;
  }
}

export function putSettings(mapId: string, settings: UnderlaySettings): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(settingsKey(mapId), JSON.stringify(settings));
  } catch {
    // Settings are tiny; a failure here (quota/availability) is non-fatal — the underlay just
    // won't persist for this map. Don't evict image cache for it.
  }
}

export function deleteSettings(mapId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(settingsKey(mapId));
  } catch {
    // no-op
  }
}

// ---- cached image data-URLs (by reference name), with LRU eviction ----

function readIndex(s: Storage): string[] {
  try {
    const raw = s.getItem(IMG_INDEX_KEY);
    if (raw === null) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(s: Storage, names: string[]): void {
  try {
    s.setItem(IMG_INDEX_KEY, JSON.stringify(names));
  } catch {
    // Index write failing is tolerable — worst case eviction order is imperfect next time.
  }
}

/** Move `name` to the most-recently-used end of the index (adding it if absent). */
function touchIndex(s: Storage, name: string): void {
  const names = readIndex(s).filter((n) => n !== name);
  names.push(name);
  writeIndex(s, names);
}

/** Evict the least-recently-used cached image whose name isn't `exclude`. Returns `true` if one was
 *  removed, `false` if there was nothing eligible to evict. */
function evictLru(s: Storage, exclude: string): boolean {
  const names = readIndex(s);
  const victim = names.find((n) => n !== exclude);
  if (victim === undefined) return false;
  try {
    s.removeItem(imageKey(victim));
  } catch {
    // ignore — still drop it from the index below
  }
  writeIndex(
    s,
    names.filter((n) => n !== victim),
  );
  return true;
}

/** Cached base64 data-URL for `name`, or `null`. A hit bumps the image to most-recently-used. */
export function getCachedImage(name: string): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const dataUrl = s.getItem(imageKey(name));
    if (dataUrl === null) return null;
    touchIndex(s, name);
    return dataUrl;
  } catch {
    return null;
  }
}

/** Drop the cached image for `name` (and its index entry), if any. Called when a committed reference
 *  is deleted so its stale bytes don't linger in localStorage. No-op if uncached / storage disabled. */
export function deleteCachedImage(name: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(imageKey(name));
  } catch {
    // ignore — still drop it from the index below
  }
  writeIndex(
    s,
    readIndex(s).filter((n) => n !== name),
  );
}

/** Cache `dataUrl` under `name`. On `QuotaExceededError`, evict the least-recently-used *other*
 *  cached image and retry ONCE, then give up gracefully. Returns whether the image is now cached. */
export function putCachedImage(name: string, dataUrl: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(imageKey(name), dataUrl);
    touchIndex(s, name);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) {
      console.warn('[underlayStore] failed to cache reference image', e);
      return false;
    }
  }
  // Quota hit: free the LRU image and retry once.
  if (evictLru(s, name)) {
    try {
      s.setItem(imageKey(name), dataUrl);
      touchIndex(s, name);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) console.warn('[underlayStore] failed to cache reference image', e);
    }
  }
  console.warn('[underlayStore] localStorage quota exceeded; reference image not cached');
  return false;
}
