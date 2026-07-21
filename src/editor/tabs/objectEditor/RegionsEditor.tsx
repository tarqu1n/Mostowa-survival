import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CatalogAsset } from '../../catalog';
import { loadCatalog } from '../../catalogSource';
import { putAssetOverride, putAssetRegions } from '../../api';
import { assetRelPath } from '../../reclassify';
import {
  detectRegionAt,
  sanitiseClientRegions,
  seedRegions,
  sliceBox,
  type Box,
} from '../../regions';
import { useIsCompact } from '../../hooks/useIsCompact';
import { usePanZoom } from '../../hooks/usePanZoom';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom } from '../../zoom';
import { clampN, normRect, resizeBox, type Handle } from '../../regionGeometry';
import { extractAlphaChannel, type AlphaChannel } from '../../pixelAlpha';
import { Button } from '../../ui/button';
import { NumberInput } from '../../ui/numberInput';
import { Slider } from '../../ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { cn } from '../../lib/utils';
import { FormError, FormWarnings, ObjField, objInputClass } from './shared';

/* ---- Regions editor (plan 017 step 4) ---- */

/** Fallback fit target for the editable sheet (before the 1–8× zoom multiplier), used only until the
 *  viewport's real size is measured (see `viewBox` below). Bigger than the Library's atlas picker
 *  (240) — the tab has the room, and region editing wants pixels to grab. */
const REGION_SHEET_FALLBACK = 480;

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Static per-handle position + resize-cursor classes for `.editor-region-handle.h-*` — none of this is
 *  data-dependent, so it's a lookup of utility strings rather than inline style. */
const HANDLE_POS: Record<Handle, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  n: 'left-1/2 top-0 cursor-ns-resize',
  ne: 'left-full top-0 cursor-nesw-resize',
  e: 'left-full top-1/2 cursor-ew-resize',
  se: 'left-full top-full cursor-nwse-resize',
  s: 'left-1/2 top-full cursor-ns-resize',
  sw: 'left-0 top-full cursor-nesw-resize',
  w: 'left-0 top-1/2 cursor-ew-resize',
};

/** A live pointer-drag on the canvas: drawing a new box from an anchor, moving an existing one, or
 *  resizing one from a specific handle. `index` is the box being manipulated. Pan is no longer a
 *  member here — it's owned by `usePanZoom` (plan 043), driven through `beginPan`/`movePan`/`endPan`. */
type Drag =
  | { mode: 'draw'; index: number; ax: number; ay: number }
  | { mode: 'move'; index: number; px: number; py: number; orig: Box }
  | { mode: 'resize'; index: number; handle: Handle; orig: Box };

/**
 * The `type:object` tab body — an editable overlay of `pack.json` `regions` boxes on a zoomable full
 * sheet, folded into the object-editor tab (plan 017 step 4). Boxes seed from the asset's current
 * catalog regions (or one whole-sheet box if it has none). Interactions: DOUBLE-CLICK a sprite to
 * auto-detect a tight box around it (client-side flood-fill, see `detectRegionAt`), DRAW (drag empty
 * sheet), SELECT+DELETE (click a box → live x/y/w/h + ✕/Delete), MOVE (drag body) + RESIZE (8 handles),
 * and GRID-SLICE (cols×rows → replace one box with an even grid — one action splits a merged crop row).
 * Save writes the whole list through `putAssetRegions` (+ a `type:object` override first if the sheet
 * isn't already an object) then the shared `loadCatalog` refetch, so the Library and this tab re-derive
 * from one fresh fetch. Reset writes an empty list = clears the override = auto-detection. The
 * scale/positioning math mirrors the Library's `AtlasSheetPicker` (deliberately not shared — the
 * pointer editing diverges enough that a focused copy is cleaner than a forced abstraction).
 *
 * Pan + zoom (state, wheel-zoom, hold-Space, middle-drag) come from the shared `usePanZoom` hook
 * (plan 043). The hook's ready-made `onCanvasPointer*` are NOT used wholesale — this canvas folds pan
 * into a larger draw/move/resize drag union with a sticky `panMode` toggle — so `panMode` is ORed into
 * the hook's `isPanTrigger`, and `beginPan`/`movePan`/`endPan` are called from the pointer handlers
 * below while pointer capture + focus stay this component's job.
 */
export function RegionsEditor({
  asset,
  sheetUrl,
  objectRoleRegions = false,
}: {
  asset: CatalogAsset;
  sheetUrl: string;
  /** plan 028: these regions are `object`-role decor on a sheet that KEEPS its `type` (a mixed
   *  `tile` sheet declaring placeable props). When set, Save tags each region `role:'object'` and
   *  does NOT demote the sheet to `type:'object'`. Default false = the classic reclassify path
   *  (regions ARE the object atlas; Save forces `type:'object'`). */
  objectRoleRegions?: boolean;
}) {
  const [boxes, setBoxes] = useState<Box[]>(() => seedRegions(asset));
  const [selected, setSelected] = useState<number | null>(null);
  const [viewBox, setViewBox] = useState({ w: REGION_SHEET_FALLBACK, h: REGION_SHEET_FALLBACK });
  const [sliceCols, setSliceCols] = useState(2);
  const [sliceRows, setSliceRows] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const isCompact = useIsCompact();
  // plan 031: a sticky pan toggle. Middle-mouse / hold-Space pan needs a mouse + keyboard, so on touch
  // there was no way to pan at all — a drag just drew or moved a box. With this on, ANY left/touch drag
  // pans the viewport instead (see `panTrigger`). Defaults off so drawing is still the primary drag.
  const [panMode, setPanMode] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const boxesRef = useRef(boxes);
  // Decoded alpha channel of the sheet (row-major, one byte/pixel) for double-click auto-detect —
  // populated async once the PNG loads; null until then (a double-click before it's ready no-ops).
  const alphaRef = useRef<AlphaChannel | null>(null);

  useEffect(() => {
    boxesRef.current = boxes;
  }, [boxes]);

  // Decode the sheet to an offscreen canvas and cache its alpha channel so double-click detection reads
  // pixels without a server round-trip. Same-origin (Vite serves `/assets/…`), so the canvas isn't
  // tainted and `getImageData` is allowed. Re-runs only when the sheet URL changes. The RGBA→alpha
  // packing itself is the shared `extractAlphaChannel` (plan 043); only the DOM/canvas decode is here.
  useEffect(() => {
    let cancelled = false;
    alphaRef.current = null;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      alphaRef.current = extractAlphaChannel(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.src = sheetUrl;
    return () => {
      cancelled = true;
    };
  }, [sheetUrl]);

  // Re-seed boxes whenever the catalog's regions for this asset change VALUE (after our own Save's
  // refetch, or another surface's edit). Keyed on a stable signature, NOT `asset` identity, so a
  // same-value refetch (the Library's mount fetch) never clobbers an in-progress edit — same guard as
  // the outer form's re-seed effect.
  const regionsSig = JSON.stringify(asset.regions ?? null);
  useEffect(() => {
    setBoxes(seedRegions(asset));
    setSelected(null);
    setErr(null);
    setWarnings([]);
  }, [regionsSig]);

  // Fit the sheet to however much room the viewport actually has (the tab can be resized, and this
  // pane no longer lives in a small fixed-size popover) rather than a hardcoded pixel target. This is
  // the base fit-scale `usePanZoom` is given (its 1–8× zoom multiplies on top for the render below).
  const {
    zoom,
    setZoom,
    spaceHeld,
    isPanning,
    viewportRef,
    hoveringRef,
    isPanTrigger,
    beginPan,
    movePan,
    endPan,
  } = usePanZoom(Math.min(1, viewBox.w / asset.w, viewBox.h / asset.h));

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportRef]);

  const fitScale = Math.min(1, viewBox.w / asset.w, viewBox.h / asset.h);
  const scale = fitScale * zoom;
  const dispW = Math.round(asset.w * scale);
  const dispH = Math.round(asset.h * scale);

  function toSheet(e: React.PointerEvent): { sx: number; sy: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      sx: Math.round(clampN((e.clientX - rect.left) / scale, 0, asset.w)),
      sy: Math.round(clampN((e.clientY - rect.top) / scale, 0, asset.h)),
    };
  }

  function capture(e: React.PointerEvent): void {
    canvasRef.current?.setPointerCapture(e.pointerId);
    // `preventScroll` so focusing the (tall) canvas doesn't scroll it into view inside the tab's
    // overflow-auto container — that jump pushed the toolbar (zoom + Pan toggle) up off-screen the
    // moment you started drawing or selecting a box. Focus itself is still needed for Space-pan/Delete.
    canvasRef.current?.focus({ preventScroll: true });
  }

  /** Middle mouse (any target), left+Space, or the sticky Pan toggle (`panMode`, the touch path) starts
   *  a pan instead of the usual draw/move/resize — checked ahead of those so it works whether the drag
   *  starts on empty sheet, a box, or a handle. The hook's `isPanTrigger` already covers middle-mouse +
   *  left+Space; `panMode` (this canvas's touch toggle) is ORed on top. `e.button === 0` covers a touch
   *  pointerdown too. */
  function panTrigger(e: React.PointerEvent): boolean {
    return isPanTrigger(e) || (e.button === 0 && panMode);
  }

  function onCanvasPointerDown(e: React.PointerEvent): void {
    if (panTrigger(e)) {
      beginPan(e);
      capture(e);
      return;
    }
    if (e.button !== 0) return;
    const { sx, sy } = toSheet(e);
    const index = boxes.length;
    setBoxes((bs) => [...bs, { x: sx, y: sy, w: 0, h: 0 }]);
    setSelected(index);
    dragRef.current = { mode: 'draw', index, ax: sx, ay: sy };
    capture(e);
  }

  function onBoxPointerDown(e: React.PointerEvent, i: number): void {
    if (panTrigger(e)) return; // let it bubble to onCanvasPointerDown to start the pan
    if (e.button !== 0) return;
    e.stopPropagation();
    const { sx, sy } = toSheet(e);
    setSelected(i);
    dragRef.current = { mode: 'move', index: i, px: sx, py: sy, orig: boxes[i] };
    capture(e);
  }

  function onHandlePointerDown(e: React.PointerEvent, i: number, handle: Handle): void {
    if (panTrigger(e)) return; // let it bubble to onCanvasPointerDown to start the pan
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(i);
    dragRef.current = { mode: 'resize', index: i, handle, orig: boxes[i] };
    capture(e);
  }

  function onCanvasPointerMove(e: React.PointerEvent): void {
    // Pan (if one's in flight) is driven off the hook's own scroll-offset ref; `movePan` no-ops when
    // no pan is active, so it's safe to call unconditionally ahead of the box-drag branch below.
    movePan(e);
    const d = dragRef.current;
    if (!d) return;
    const { sx, sy } = toSheet(e);
    setBoxes((bs) =>
      bs.map((b, i) => {
        if (i !== d.index) return b;
        if (d.mode === 'draw') return normRect(d.ax, d.ay, sx, sy);
        if (d.mode === 'move') {
          return {
            x: clampN(d.orig.x + (sx - d.px), 0, asset.w - d.orig.w),
            y: clampN(d.orig.y + (sy - d.py), 0, asset.h - d.orig.h),
            w: d.orig.w,
            h: d.orig.h,
          };
        }
        return resizeBox(d.orig, d.handle, sx, sy, asset.w, asset.h);
      }),
    );
  }

  function onCanvasPointerUp(e: React.PointerEvent): void {
    // End any in-flight pan first (hook self-clears when none is active — idempotent), then release the
    // canvas pointer capture used by both pan and the box drags.
    endPan();
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    // A draw that never grew (a bare click on empty sheet) leaves a degenerate box — drop it, which
    // makes an empty click read as "deselect".
    if (d.mode === 'draw') {
      const b = boxesRef.current[d.index];
      if (b && (b.w < 1 || b.h < 1)) {
        setBoxes((bs) => bs.filter((_, i) => i !== d.index));
        setSelected((sel) => (sel === d.index ? null : sel));
      }
    }
  }

  // Double-click a sprite → flood-fill its opaque blob (tight: gap:0, no bridging into touching
  // neighbours — see `detectRegionAt`) and add the box as a new selected region. Catches sprites the
  // batch pass drops or over-merges: it only cares what's under the click. No-op on a miss (empty space
  // beyond the seed radius) or before the alpha channel has decoded. The two stray degenerate boxes the
  // underlying click/click cycle draws are already dropped by `onCanvasPointerUp`, so this only ever
  // appends the detected box.
  function onCanvasDoubleClick(e: React.MouseEvent): void {
    const a = alphaRef.current;
    if (!a) return;
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = Math.floor(clampN((e.clientX - rect.left) / scale, 0, a.w - 1));
    const py = Math.floor(clampN((e.clientY - rect.top) / scale, 0, a.h - 1));
    const box = detectRegionAt(a.data, a.w, a.h, px, py);
    if (!box) return;
    let idx = 0;
    setBoxes((bs) => {
      idx = bs.length;
      return [...bs, box];
    });
    setSelected(idx);
  }

  function onCanvasKeyDown(e: React.KeyboardEvent): void {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
      e.preventDefault();
      deleteSelected();
    }
  }

  function deleteSelected(): void {
    if (selected === null) return;
    setBoxes((bs) => bs.filter((_, i) => i !== selected));
    setSelected(null);
  }

  function gridSlice(): void {
    if (selected === null) return;
    const target = boxes[selected];
    if (!target) return;
    const cells = sliceBox(target, sliceCols, sliceRows);
    setBoxes((bs) => [...bs.filter((_, i) => i !== selected), ...cells]);
    setSelected(null);
  }

  function updateSelected(field: keyof Box, raw: number): void {
    if (selected === null) return;
    const v = Math.max(0, Math.round(raw));
    setBoxes((bs) =>
      bs.map((b, i) => {
        if (i !== selected) return b;
        const next = { ...b, [field]: v };
        next.x = clampN(next.x, 0, asset.w - 1);
        next.y = clampN(next.y, 0, asset.h - 1);
        next.w = clampN(next.w, 1, asset.w - next.x);
        next.h = clampN(next.h, 1, asset.h - next.y);
        return next;
      }),
    );
  }

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const cleaned = sanitiseClientRegions(boxes, asset.w, asset.h);
      const relPath = assetRelPath(asset);
      // plan 028: object-role regions on a mixed `tile` sheet keep the sheet tiling — tag every
      // region `role:'object'` and do NOT demote the type. The classic path (regions ARE the object
      // atlas) forces `type:'object'` first when the sheet isn't already one (separate serialised
      // regen) and writes bare rects (implicit object role).
      const clean = objectRoleRegions
        ? cleaned.map((b) => ({ ...b, role: 'object' as const }))
        : cleaned;
      if (!objectRoleRegions && asset.type !== 'object') {
        await putAssetOverride(asset.pack, relPath, { type: 'object' });
      }
      const result = await putAssetRegions(asset.pack, relPath, clean);
      setWarnings(result.warnings);
      await loadCatalog();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // "Auto-detect objects" — hand the segmentation back to the SERVER rather than reimplementing it
  // client-side. `gen_regions.py` only runs a detection pass on `object`-classified sheets, so first
  // force `type:object` if the sheet isn't one yet (e.g. the user just picked "object" in the dropdown
  // but hasn't Saved), THEN PUT an empty regions list — which deletes the regions override so
  // `objects.py` `components()` (the connected-component detector) repopulates it. The `loadCatalog`
  // refetch re-seeds the boxes to the freshly detected set. In object-ROLE mode (a mixed `tile` sheet)
  // the server never auto-detects, so there this same button just clears the hand-authored regions.
  async function autoDetect(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const relPath = assetRelPath(asset);
      if (!objectRoleRegions && asset.type !== 'object') {
        await putAssetOverride(asset.pack, relPath, { type: 'object' });
      }
      const result = await putAssetRegions(asset.pack, relPath, []);
      setWarnings(result.warnings);
      await loadCatalog();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedBox = selected !== null ? boxes[selected] : null;

  return (
    <div className="flex flex-col gap-2">
      {/* One compact toolbar carries everything — count · zoom · pan on the left, the primary actions
          (Save / Clear) pinned right. No helper text, no separate bottom button row: the canvas is the
          primary function, so it gets the vertical budget. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[0.78rem] text-fg-dim">
          {boxes.length} region{boxes.length === 1 ? '' : 's'}
        </span>
        <div className="flex max-w-[220px] flex-none items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className="size-[22px] shrink-0"
                disabled={zoom <= ZOOM_MIN}
                onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
              >
                −
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <Slider
            className="w-[78px] shrink-0"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={[zoom]}
            aria-label="Region editor zoom"
            onValueChange={([v]) => setZoom(clampZoom(v))}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className="size-[22px] shrink-0"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
              >
                +
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>
          <span className="min-w-6 flex-none text-right text-[0.7rem] text-fg-dim">{zoom}×</span>
        </div>
        {/* Pan toggle (plan 031) — the touch-friendly equivalent of middle-mouse / hold-Space. While
            on, a drag anywhere pans instead of drawing/moving a box. A real tap target on compact. */}
        <Button
          type="button"
          variant={panMode ? 'default' : 'outline'}
          size="sm"
          aria-pressed={panMode}
          className="shrink-0"
          onClick={() => setPanMode((v) => !v)}
        >
          {panMode ? '✋ Panning' : '✋ Pan'}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save regions'}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void autoDetect()}
              >
                {objectRoleRegions ? 'Clear all' : 'Auto-detect'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Double-click a sprite to auto-box it · drag to draw · click a box to select (move,
              resize, slice, Delete) · ✋ Pan / middle-drag / Space to pan
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div
          className={cn(
            'min-w-[280px] grow shrink basis-[420px] overflow-auto rounded-[3px] bg-inset',
            // The canvas is the primary function, so it takes the tab's vertical budget. On desktop the
            // box fields sit in a side column, so the canvas can stay tall unconditionally. On compact
            // they wrap BELOW the canvas, so shrink it only WHEN a box is selected — keeps x/y/w/h +
            // Delete + slice reachable with a short scroll — and keep it near-full-height otherwise.
            isCompact
              ? selectedBox
                ? 'h-[48vh] max-h-[48vh]'
                : 'h-[68vh] max-h-[68vh]'
              : 'h-[80vh] max-h-[80vh]',
          )}
          ref={viewportRef}
          onPointerEnter={() => {
            hoveringRef.current = true;
          }}
          onPointerLeave={() => {
            hoveringRef.current = false;
          }}
        >
          <div
            ref={canvasRef}
            className={cn(
              'pixelated relative cursor-crosshair overflow-hidden rounded-[3px] bg-inset bg-no-repeat outline-none touch-none',
              (spaceHeld || panMode) && 'cursor-grab',
              isPanning && 'cursor-grabbing',
            )}
            tabIndex={0}
            // Sheet image + its scaled render size are computed — stay inline.
            style={{
              width: dispW,
              height: dispH,
              backgroundImage: `url(${sheetUrl})`,
              backgroundSize: `${dispW}px ${dispH}px`,
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onDoubleClick={onCanvasDoubleClick}
            onKeyDown={onCanvasKeyDown}
          >
            {boxes.map((b, i) => (
              <div
                key={i}
                className={cn(
                  'absolute cursor-move border border-gold-light/55 bg-gold-light/6 hover:border-gold-light/90',
                  i === selected && 'border-selection bg-selection/16',
                )}
                // Box rect is computed from stored sheet-space coords × scale — stays inline.
                style={{
                  left: b.x * scale,
                  top: b.y * scale,
                  width: Math.max(2, b.w * scale),
                  height: Math.max(2, b.h * scale),
                }}
                onPointerDown={(e) => onBoxPointerDown(e, i)}
              >
                {i === selected &&
                  HANDLES.map((hd) => (
                    <span
                      key={hd}
                      className={cn(
                        'absolute -mt-[5px] -ml-[5px] size-[9px] rounded-[2px] border border-inset bg-selection',
                        HANDLE_POS[hd],
                      )}
                      onPointerDown={(e) => onHandlePointerDown(e, i, hd)}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>

        {selectedBox && (
          <div
            className={cn(
              'flex min-w-[180px] grow shrink basis-[200px] flex-col gap-3',
              // Desktop: a slim side column beside the canvas. Compact: full-width under it (the canvas
              // takes the whole row first), so the box fields aren't squeezed into a narrow gutter.
              isCompact ? 'basis-full' : 'max-w-[260px]',
            )}
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y', 'w', 'h'] as const).map((f) => (
                  <ObjField key={f} label={f}>
                    <NumberInput
                      min={f === 'w' || f === 'h' ? 1 : 0}
                      value={selectedBox[f]}
                      className={cn(objInputClass, 'w-full')}
                      onValue={(n) => updateSelected(f, n)}
                    />
                  </ObjField>
                ))}
              </div>
              {/* plan 028: per-region role. One role in this MVP (`object`), so a read-only badge —
                  the field exists + persists (Save tags every region `object`), extensible to a
                  Select when `tile`-role regions land. */}
              {objectRoleRegions && (
                <ObjField label="Role">
                  <span className="inline-flex w-fit items-center rounded-[3px] border border-border bg-panel-2 px-1.5 py-0.5 text-[0.72rem] text-fg-dim">
                    object
                  </span>
                </ObjField>
              )}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="self-start"
                onClick={deleteSelected}
              >
                ✕ Delete box
              </Button>
              <div className="flex flex-col gap-1">
                <span className="text-[0.72rem] text-muted-2">Grid-slice into</span>
                <div className="flex items-center gap-1.5">
                  <NumberInput
                    min={1}
                    aria-label="Columns"
                    value={sliceCols}
                    className={cn(objInputClass, 'w-[52px] px-1.5')}
                    onValue={(n) => setSliceCols(Math.max(1, Math.round(n)))}
                  />
                  <span>×</span>
                  <NumberInput
                    min={1}
                    aria-label="Rows"
                    value={sliceRows}
                    className={cn(objInputClass, 'w-[52px] px-1.5')}
                    onValue={(n) => setSliceRows(Math.max(1, Math.round(n)))}
                  />
                  <Button type="button" size="sm" onClick={gridSlice}>
                    Slice
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {err && <FormError message={err} />}
      <FormWarnings warnings={warnings} />
    </div>
  );
}
