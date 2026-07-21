import { useEditorStore } from '../store/editorStore';
import { ObjectEditorForm } from './objectEditor/ObjectEditorForm';
import { objIdClass, objTabClass, objTitleClass } from './objectEditor/shared';

/**
 * Object-editor tab (plan 017 step 3) — the full-size reclassify surface opened from the Library's ⚙
 * for a single catalog asset, replacing the cramped, clip-prone `AssetReclassify` popover (plan 014
 * step 7c). It looks its asset up from the store catalog by `assetId`; if the lookup fails (the asset
 * was removed/renamed on a catalog regen) it renders a graceful "asset no longer in catalog" state
 * instead of crashing.
 *
 * The room a tab gives (vs. a corner popover) buys the actual fix: a **correctly cropped per-frame
 * preview**. The old library swatch renders a multi-row strip (e.g. a 2×2 furnace sheet, `rows > 1`)
 * wrong because it assumes a single horizontal row; here each frame `i` is cropped at
 * `col = i % cols`, `row = floor(i / cols)` (see `reclassify.ts`), so a 2×2 shows as a real 2×2.
 *
 * The tab shell is intentionally thin (plan 043 step 10): it resolves the asset and renders either the
 * missing-asset state or the `ObjectEditorForm` (which owns the draft form + swaps in the
 * `RegionsEditor` for object / mixed-tile-region editing — see `tabs/objectEditor/`).
 *
 * NOTE on tab-panel visibility (plan 020 Step 10): this component owns none — `EditorApp.tsx`'s central
 * tab strip mounts every tab's panel at once and hides inactive ones with `invisible pointer-events-none`
 * (never `hidden`/display:none, which would collapse the Scale.RESIZE Phaser canvas in the Map tab to
 * 0×0). This file only ever renders while it's some tab's content; it doesn't do any showing/hiding of
 * its own.
 */
export function ObjectEditorTab({ assetId }: { assetId: string }) {
  const catalog = useEditorStore((s) => s.catalog);
  const asset = catalog?.assets.find((a) => a.id === assetId);
  const filename = assetId.split('/').pop() ?? assetId;

  if (!asset) {
    return (
      <div className={objTabClass}>
        <h2 className={objTitleClass}>{filename}</h2>
        <p className="-mt-1 mb-2 text-[0.8rem] text-danger">
          This asset is no longer in the catalog — it may have been removed or renamed on disk.
        </p>
        <p className={objIdClass}>{assetId}</p>
      </div>
    );
  }

  return <ObjectEditorForm asset={asset} />;
}
