/**
 * Editor texture-loading helpers (plan 014 step 5). Mirrors PreloadScene's pack-relative,
 * `encodeURI`'d URL scheme (asset paths under a pack root contain spaces) so the editor viewport
 * loads the exact same files the game does. Kept out of `EditorScene` so the URL/id string handling
 * stays pure and reviewable; the actual Phaser `load.*` calls live in `EditorScene` (Phaser-coupled).
 */

/** Pack-relative asset URL, `encodeURI`'d like PreloadScene — some pack paths contain spaces, which
 *  would 404 unescaped. `import.meta.env.BASE_URL` is `/` in dev; the editor is dev-only. */
export function tilesetAssetUrl(pack: string, relPath: string): string {
  const base = `${import.meta.env.BASE_URL}assets/tilesets/${pack}`;
  return encodeURI(`${base}/${relPath}`);
}

/**
 * A decor object's `asset` is a catalog id shaped `<pack>/<relative path>[#frame]` (see the asset
 * catalog, step 2). Split it back into its parts; `frame` is present only for sheet-frame assets.
 * Throws on a malformed id so `EditorScene` can log-and-skip a bad decor reference rather than crash.
 */
export function parseAssetId(assetId: string): { pack: string; path: string; frame?: number } {
  const slash = assetId.indexOf('/');
  if (slash <= 0) throw new Error(`asset id "${assetId}" is missing a "<pack>/…" prefix`);
  const pack = assetId.slice(0, slash);
  let path = assetId.slice(slash + 1);
  let frame: number | undefined;
  const hash = path.lastIndexOf('#');
  if (hash >= 0) {
    const n = Number(path.slice(hash + 1));
    if (Number.isInteger(n) && n >= 0) frame = n;
    path = path.slice(0, hash);
  }
  if (path.length === 0) throw new Error(`asset id "${assetId}" has an empty path`);
  return { pack, path, frame };
}
