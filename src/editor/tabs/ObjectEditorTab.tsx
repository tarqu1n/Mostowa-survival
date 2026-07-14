import { useEffect, useState } from 'react';
import { tilesetAssetUrl } from '../textureLoading';
import type { CatalogAsset, CatalogAssetType } from '../catalog';
import { loadCatalog } from '../catalogSource';
import { applyReclassify, reclassifyGrid, seedFrames, seedRows, suggestGrids } from '../reclassify';
import { useEditorStore } from '../store/editorStore';

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
 * Draft `type`/`frames`/`rows` are LOCAL React state (an uncommitted form) — canonical truth is
 * server-side `pack.json`, surfaced by the post-Apply catalog refetch. On Apply we PUT the override,
 * refetch the catalog into the store (which updates the Library live too), and re-seed the draft from
 * the freshly-resolved catalog entry.
 */
export function ObjectEditorTab({ assetId }: { assetId: string }) {
  const catalog = useEditorStore((s) => s.catalog);
  const asset = catalog?.assets.find((a) => a.id === assetId);
  const filename = assetId.split('/').pop() ?? assetId;

  if (!asset) {
    return (
      <div className="editor-object-tab">
        <h2 className="editor-object-tab-title">{filename}</h2>
        <p className="editor-error-text">
          This asset is no longer in the catalog — it may have been removed or renamed on disk.
        </p>
        <p className="editor-object-tab-id">{assetId}</p>
      </div>
    );
  }

  return <ObjectEditorForm asset={asset} />;
}

/** On-screen sizes for the two previews. `SHEET_MAX` fits the whole sheet into a legible box (up- or
 *  down-scaled); `FRAME_TARGET` is the size each cropped per-frame swatch is scaled towards. */
const SHEET_MAX = 280;
const FRAME_TARGET = 72;

/** The reclassify form — only rendered with a resolved `asset`, so its hooks never sit behind the
 *  missing-asset branch above. */
function ObjectEditorForm({ asset }: { asset: CatalogAsset }) {
  const [type, setType] = useState<CatalogAssetType>(asset.type);
  const [frames, setFrames] = useState(() => seedFrames(asset));
  const [rows, setRows] = useState(() => seedRows(asset));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Re-seed the draft whenever the underlying catalog entry actually changes VALUE (after our own Apply
  // regenerates it, or another surface reclassifies it). Deps are the resolved grid values, NOT `asset`
  // identity, so a same-value refetch (the Library's mount fetch) never clobbers an in-progress edit;
  // the mount double-seed (identical to the useState initialisers) is harmless. This repo's eslint
  // doesn't run react-hooks/exhaustive-deps, so there's no lint either way.
  useEffect(() => {
    setType(asset.type);
    setFrames(seedFrames(asset));
    setRows(seedRows(asset));
    setWarnings([]);
    setErr(null);
  }, [asset.type, asset.frames, asset.frameHeight]);

  const relPath = asset.id.slice(asset.pack.length + 1);
  const sheetUrl = tilesetAssetUrl(
    asset.pack,
    asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path,
  );
  const grid = reclassifyGrid(asset, type, frames, rows);
  const isStrip = type === 'strip';

  // Whole-sheet preview scale (fits SHEET_MAX; upscales tiny sheets, downscales big ones).
  const sheetScale = SHEET_MAX / Math.max(asset.w, asset.h);
  const sheetW = Math.round(asset.w * sheetScale);
  const sheetH = Math.round(asset.h * sheetScale);

  // Per-frame swatch scale — only used when the strip grid is valid.
  const frameScale =
    grid.frameWidth && grid.frameHeight
      ? FRAME_TARGET / Math.max(grid.frameWidth, grid.frameHeight)
      : 1;
  const cellW = grid.frameWidth ? Math.round(grid.frameWidth * frameScale) : 0;
  const cellH = grid.frameHeight ? Math.round(grid.frameHeight * frameScale) : 0;

  async function commit(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const result = await applyReclassify(asset, type, frames, rows);
      setWarnings(result.warnings);
      // Refetch → setCatalog: updates the store (this tab re-derives its `asset`, the re-seed effect
      // fires) and the Library panel in one shot.
      await loadCatalog();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="editor-object-tab">
      <h2 className="editor-object-tab-title">{filenameOf(asset)}</h2>
      <p className="editor-object-tab-id">
        {relPath} · {asset.w}×{asset.h}
      </p>

      <div className="editor-object-form">
        <div className="editor-object-controls">
          <label className="editor-object-field">
            <span className="editor-object-field-label">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as CatalogAssetType)}>
              <option value="tile">tile</option>
              <option value="strip">strip</option>
              <option value="object">object</option>
            </select>
          </label>

          {isStrip && (
            <>
              <label className="editor-object-field">
                <span className="editor-object-field-label">Frames</span>
                <input
                  type="number"
                  min={1}
                  value={frames}
                  onChange={(e) => setFrames(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                />
              </label>
              <label className="editor-object-field">
                <span className="editor-object-field-label">Rows</span>
                <input
                  type="number"
                  min={1}
                  value={rows}
                  onChange={(e) => setRows(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                />
              </label>
            </>
          )}
        </div>

        {isStrip && (
          <div className="editor-object-chips">
            {suggestGrids(asset.w, asset.h).map((s) => (
              <button
                key={`${s.rows}x${s.cols}`}
                type="button"
                className="editor-object-chip"
                title={`${asset.w / s.cols}×${asset.h / s.rows} per frame`}
                onClick={() => {
                  setFrames(s.frames);
                  setRows(s.rows);
                }}
              >
                {s.cols}×{s.rows}
              </button>
            ))}
          </div>
        )}

        {isStrip && !grid.valid && (
          <p className="editor-object-error">
            frames ({frames}) must divide evenly by rows ({rows}), and both frame dimensions must
            divide the sheet ({asset.w}×{asset.h}) into whole pixels.
          </p>
        )}

        <div className="editor-object-previews">
          {/* Whole-sheet preview with a live grid overlay (strip only) — recomputed every render
              straight from the current frames/rows, so it tracks keystrokes with no debounce. */}
          <figure className="editor-object-preview">
            <figcaption>Sheet</figcaption>
            <div
              className="editor-object-sheet pixelated"
              style={{
                width: sheetW,
                height: sheetH,
                backgroundImage: `url(${sheetUrl})`,
                backgroundSize: '100% 100%',
              }}
            >
              {isStrip && grid.valid && grid.cols !== undefined && (
                <div
                  className="editor-object-grid-overlay"
                  style={{
                    gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                  }}
                >
                  {Array.from({ length: grid.cols * rows }, (_, i) => (
                    <span key={i} className="editor-object-grid-cell" />
                  ))}
                </div>
              )}
            </div>
          </figure>

          {/* The fix — a CORRECTLY cropped per-frame preview. Each frame `i` is cropped at
              `col = i % cols`, `row = floor(i / cols)`; a 2×2 sheet reads as a real 2×2, not a
              squished single row. Strip-only + valid-grid-only. */}
          {isStrip && grid.valid && grid.cols !== undefined && (
            <figure className="editor-object-preview">
              <figcaption>
                Frames ({frames} · {grid.cols}×{rows})
              </figcaption>
              <div className="editor-object-frames">
                {Array.from({ length: frames }, (_, i) => {
                  const col = i % grid.cols!;
                  const row = Math.floor(i / grid.cols!);
                  return (
                    <span
                      key={i}
                      className="editor-object-frame pixelated"
                      title={`frame ${i}`}
                      style={{
                        width: cellW,
                        height: cellH,
                        backgroundImage: `url(${sheetUrl})`,
                        backgroundSize: `${grid.cols! * cellW}px ${rows * cellH}px`,
                        backgroundPosition: `-${col * cellW}px -${row * cellH}px`,
                      }}
                    />
                  );
                })}
              </div>
            </figure>
          )}
        </div>

        {err && <p className="editor-object-error">{err}</p>}
        {warnings.length > 0 && (
          <div className="editor-object-warnings">
            {warnings.slice(0, 6).map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        <div className="editor-object-actions">
          <button
            type="button"
            disabled={busy || (isStrip && !grid.valid)}
            onClick={() => void commit()}
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** An asset's display filename (last path segment of its id). */
function filenameOf(asset: CatalogAsset): string {
  return asset.id.split('/').pop() ?? asset.id;
}
