import { useEffect, useState } from 'react';
import { tilesetAssetUrl } from '../../textureLoading';
import type { CatalogAsset, CatalogAssetType } from '../../catalog';
import { loadCatalog } from '../../catalogSource';
import {
  applyReclassify,
  reclassifyGrid,
  seedCols,
  seedOmit,
  seedRows,
  suggestGrids,
} from '../../reclassify';
import { Button } from '../../ui/button';
import { NumberInput } from '../../ui/numberInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { cn } from '../../lib/utils';
import { RegionsEditor } from './RegionsEditor';
import {
  FormError,
  FormWarnings,
  ObjField,
  objIdClass,
  objInputClass,
  objTabClass,
} from './shared';

/** On-screen sizes for the two previews. `SHEET_MAX` fits the whole sheet into a legible box (up- or
 *  down-scaled); `FRAME_TARGET` is the size each cropped per-frame swatch is scaled towards. */
const SHEET_MAX = 280;
const FRAME_TARGET = 72;

// The primary-action bar (Apply / Save regions / Reset). Stuck to the bottom of the tab's scroll
// container (`objTabClass`, the nearest `overflow-auto` ancestor) so the buttons are ALWAYS reachable —
// they used to scroll off the bottom on short viewports and on mobile. Negative margins bleed it to the
// full tab width and cancel the container's `p-4` bottom padding so it sits flush at the very bottom;
// `bg-background` (the tab's own colour) lets content scroll cleanly underneath.
const objActionsClass =
  'sticky bottom-0 z-10 -mx-[18px] -mb-4 flex gap-2 border-t border-surface bg-background px-[18px] pt-2.5 pb-3';

/** `.editor-object-frame`: a per-frame click-to-omit swatch button reset to a bare pixel crop, with an
 *  omitted cell dimmed + desaturated + crossed out with a diagonal double-gradient (`after:`), matching
 *  the old `.is-omitted::after`. */
const objFrameClass = (omitted: boolean): string =>
  cn(
    'relative block cursor-pointer border border-border bg-inset-2 bg-no-repeat p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold',
    omitted &&
      "border-danger opacity-40 grayscale-[80%] after:absolute after:inset-0 after:content-[''] after:bg-[linear-gradient(to_top_right,transparent_46%,var(--color-danger)_46%,var(--color-danger)_54%,transparent_54%),linear-gradient(to_bottom_right,transparent_46%,var(--color-danger)_46%,var(--color-danger)_54%,transparent_54%)]",
  );

/** The reclassify form — only rendered with a resolved `asset`, so its hooks never sit behind the
 *  missing-asset branch above. */
export function ObjectEditorForm({ asset }: { asset: CatalogAsset }) {
  const [type, setType] = useState<CatalogAssetType>(asset.type);
  const [cols, setCols] = useState(() => seedCols(asset));
  const [rows, setRows] = useState(() => seedRows(asset));
  const [omit, setOmit] = useState<number[]>(() => seedOmit(asset));
  // plan 028: on a `tile` sheet, open the Regions editor to author `object`-role prop regions
  // WITHOUT demoting the sheet to `type:'object'`. Only meaningful while the draft type is `tile`.
  const [regionMode, setRegionMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Re-seed the draft whenever the underlying catalog entry actually changes VALUE (after our own Apply
  // regenerates it, or another surface reclassifies it). Deps are the resolved grid values (cols now
  // recovered from `frameWidth`, plus an `omit` signature), NOT `asset` identity, so a same-value
  // refetch (the Library's mount fetch) never clobbers an in-progress edit; the mount double-seed
  // (identical to the useState initialisers) is harmless. This repo's eslint doesn't run
  // react-hooks/exhaustive-deps, so there's no lint either way.
  useEffect(() => {
    setType(asset.type);
    setCols(seedCols(asset));
    setRows(seedRows(asset));
    setOmit(seedOmit(asset));
    setRegionMode(false);
    setWarnings([]);
    setErr(null);
  }, [asset.type, asset.frames, asset.frameWidth, asset.frameHeight, (asset.omit ?? []).join(',')]);

  const relPath = asset.id.slice(asset.pack.length + 1);
  const sheetUrl = tilesetAssetUrl(
    asset.pack,
    asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path,
  );
  // `cells` = total grid cells (`cols*rows` = the geometry-mode `frames`). `omitInRange` drops any
  // stale omit index that a later cols/rows shrink pushed out of bounds, so a shrunk-then-Applied grid
  // can never PUT an out-of-range omit; it's the omit we thread everywhere (grid, preview, Apply).
  const cells = cols * rows;
  const omitInRange = omit.filter((i) => Number.isInteger(cells) && i >= 0 && i < cells);
  const grid = reclassifyGrid(asset, type, cols, rows, omitInRange);
  const isStrip = type === 'strip';
  const isObject = type === 'object';
  const isTile = type === 'tile';

  // Set a grid dimension and prune any omit index the new geometry no longer contains, so a later grow
  // can't resurrect a stale omission at a cell the user never intended.
  const changeCols = (v: number): void => {
    const next = Math.max(1, Math.round(Number(v) || 1));
    setCols(next);
    setOmit((o) => o.filter((i) => i < next * rows));
  };
  const changeRows = (v: number): void => {
    const next = Math.max(1, Math.round(Number(v) || 1));
    setRows(next);
    setOmit((o) => o.filter((i) => i < cols * next));
  };
  const toggleOmit = (i: number): void => {
    setOmit((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i].sort((a, b) => a - b)));
  };

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
      const result = await applyReclassify(asset, type, cols, rows, omitInRange);
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

  // A control row is only needed for the strip grid (cols/rows) or a tile's object-region toggle —
  // for a plain `object`/`tile` sheet everything lives in the header row, so the row is suppressed
  // entirely rather than left as an empty gap.
  const hasControlsRow = isStrip || isTile;

  return (
    <div className={objTabClass}>
      {/* Single header row (plan 031): filename + path/dims + the Type select all on one line, so the
          mobile viewport isn't eaten by three stacked rows. Wraps gracefully on very narrow widths;
          the Type control pushes to the right on roomy ones (`ml-auto`). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-base text-fg-bright">{filenameOf(asset)}</h2>
        <span className={objIdClass}>
          {relPath} · {asset.w}×{asset.h}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[0.72rem] text-muted-2">Type</span>
          <Select value={type} onValueChange={(v) => setType(v as CatalogAssetType)}>
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tile">tile</SelectItem>
              <SelectItem value="strip">Animated strip</SelectItem>
              <SelectItem value="object">object</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {hasControlsRow && (
          <div className="flex flex-wrap items-end gap-3">
            {/* plan 028: a mixed `tile` sheet can author `object`-role prop regions without becoming an
                object. Toggling this swaps the frame-grid preview for the Regions editor while the type
                stays `tile` (Save writes object-role regions, no demotion). Inline button (no caption
                row) so region editing keeps as much vertical budget as possible for the canvas. */}
            {isTile && (
              <Button
                type="button"
                variant={regionMode ? 'default' : 'outline'}
                size="sm"
                aria-pressed={regionMode}
                onClick={() => setRegionMode((v) => !v)}
              >
                {regionMode ? '✏ Editing regions' : 'Edit regions'}
              </Button>
            )}

            {isStrip && (
              <>
                <ObjField label="Columns">
                  <NumberInput
                    min={1}
                    value={cols}
                    className={cn(objInputClass, 'w-20')}
                    onValue={changeCols}
                  />
                </ObjField>
                <ObjField label="Rows">
                  <NumberInput
                    min={1}
                    value={rows}
                    className={cn(objInputClass, 'w-20')}
                    onValue={changeRows}
                  />
                </ObjField>
              </>
            )}
          </div>
        )}

        {/* type:object → the Regions editor (plan 017 step 4); strip/tile keep the step-3 frame-grid
            preview. Branches on the DRAFT type, so picking `object` in the dropdown makes the sheet's
            regions editable even for an asset currently classified strip/tile (Save also forces the
            `object` type override in that case). plan 028: a `tile` sheet in `regionMode` also opens
            the Regions editor, but in object-ROLE mode — Save keeps the sheet `tile`. */}
        {isObject ? (
          <RegionsEditor asset={asset} sheetUrl={sheetUrl} />
        ) : isTile && regionMode ? (
          <RegionsEditor asset={asset} sheetUrl={sheetUrl} objectRoleRegions />
        ) : (
          <>
            {isStrip && (
              <div className="flex flex-wrap gap-1.5">
                {suggestGrids(asset.w, asset.h).map((s) => (
                  <Button
                    key={`${s.rows}x${s.cols}`}
                    type="button"
                    variant="outline"
                    size="xs"
                    title={`${asset.w / s.cols}×${asset.h / s.rows} per frame`}
                    onClick={() => {
                      setCols(s.cols);
                      setRows(s.rows);
                      setOmit([]);
                    }}
                  >
                    {s.cols}×{s.rows}
                  </Button>
                ))}
              </div>
            )}

            {isStrip && !grid.valid && (
              <FormError
                message={`columns (${cols}) and rows (${rows}) must divide the sheet (${asset.w}×${asset.h}) into whole pixels, and at least one cell must play.`}
              />
            )}

            <div className="flex flex-wrap items-start gap-7">
              {/* Whole-sheet preview with a live grid overlay (strip only) — recomputed every render
                  straight from the current cols/rows, so it tracks keystrokes with no debounce. */}
              <figure className="flex flex-col gap-1.5">
                <figcaption className="text-[0.72rem] text-muted-2">Sheet</figcaption>
                <div
                  className="pixelated relative border border-border bg-no-repeat"
                  // Sheet render size + image are computed from the asset's own dims — stays inline.
                  style={{
                    width: sheetW,
                    height: sheetH,
                    backgroundImage: `url(${sheetUrl})`,
                    backgroundSize: '100% 100%',
                  }}
                >
                  {isStrip && grid.valid && grid.cols !== undefined && (
                    <div
                      className="absolute inset-0 grid"
                      // Grid overlay tracks the live cols/rows draft — computed, stays inline.
                      style={{
                        gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
                        gridTemplateRows: `repeat(${rows}, 1fr)`,
                      }}
                    >
                      {Array.from({ length: grid.cols * rows }, (_, i) => (
                        <span key={i} className="border border-gold opacity-85" />
                      ))}
                    </div>
                  )}
                </div>
              </figure>

              {/* The fix — a CORRECTLY cropped per-frame preview, now doubling as the click-to-omit
                  grid (plan 017 step 6.5). Every one of the `cells` grid cells is rendered (not just
                  the played ones), each cropped at `col = i % cols`, `row = floor(i / cols)`; a 2×2
                  sheet reads as a real 2×2, not a squished single row. Clicking a cell toggles its
                  membership of `omit` — an omitted cell dims + crosses out and drops from the played
                  set. Strip-only + valid-grid-only (a non-integer grid or an all-omitted grid shows
                  the error instead, since `grid.valid` now also requires ≥1 played frame). */}
              {isStrip && grid.valid && grid.cols !== undefined && (
                <figure className="flex flex-col gap-1.5">
                  <figcaption className="text-[0.72rem] text-muted-2">
                    Frames ({grid.played.length} played / {cells} cells · {grid.cols}×{rows})
                  </figcaption>
                  <div className="flex max-w-[340px] flex-wrap gap-1.5">
                    {Array.from({ length: grid.frames ?? cells }, (_, i) => {
                      const col = i % grid.cols!;
                      const row = Math.floor(i / grid.cols!);
                      const omitted = omitInRange.includes(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          className={objFrameClass(omitted)}
                          title={
                            omitted
                              ? `frame ${i} (omitted — click to include)`
                              : `frame ${i} (click to omit)`
                          }
                          aria-label={
                            omitted
                              ? `frame ${i} (omitted — click to include)`
                              : `frame ${i} (click to omit)`
                          }
                          aria-pressed={omitted}
                          onClick={() => toggleOmit(i)}
                          style={{
                            // Per-frame crop rect is computed from grid geometry × frame scale — inline.
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

            {err && <FormError message={err} />}
            <FormWarnings warnings={warnings} />

            <div className={objActionsClass}>
              <Button
                type="button"
                disabled={busy || (isStrip && !grid.valid)}
                onClick={() => void commit()}
              >
                {busy ? 'Applying…' : 'Apply'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** An asset's display filename (last path segment of its id). */
function filenameOf(asset: CatalogAsset): string {
  return asset.id.split('/').pop() ?? asset.id;
}
