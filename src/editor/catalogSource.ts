/**
 * Shared loader for the generated asset catalog (`public/assets/asset-catalog.json`, plan 014 step 2;
 * extracted plan 017 step 3). Fetches it cache-busted, narrows it with `parseCatalog`, and installs it
 * into the editor store via `setCatalog` (which also reconciles any open object tabs). Used by BOTH the
 * Library panel's mount fetch AND the object-editor tab's post-Apply refetch — a
 * `PUT /__editor/asset-override` regenerates the file server-side, so any surface that reclassifies an
 * asset must re-pull it. Routing both through `setCatalog` is what keeps the Library and every open
 * object tab in sync off a single load. Cache-busted (`?t=`) because the browser would otherwise serve
 * the pre-reclassify response it already fetched once this session. Returns the parsed catalog so a
 * caller can read the fresh entry synchronously (the tab re-seeds its draft grid from it after Apply).
 */
import { parseCatalog, type AssetCatalog } from './catalog';
import { useEditorStore } from './store/editorStore';

export async function loadCatalog(): Promise<AssetCatalog> {
  const res = await fetch(`${import.meta.env.BASE_URL}assets/asset-catalog.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = (await res.json()) as unknown;
  const parsed = parseCatalog(json);
  useEditorStore.getState().setCatalog(parsed);
  return parsed;
}
