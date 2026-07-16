import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { useEditorStore } from '../store/editorStore';
import {
  captureMapReference,
  CaptureError,
  deleteMapReference,
  getMapReferenceSidecar,
  listMapReferences,
} from '../api';
import { deleteCachedImage } from '../underlayStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Slider } from '../ui/slider';
import { cn } from '../lib/utils';
import { useIsCompact } from '../hooks/useIsCompact';

// Reference name shape — mirrors the middleware's `sanitiseId` (`ID_RE` in vite-editor-api.mjs), so a
// name the panel accepts is one the `POST /__editor/map-references` endpoint will accept too.
const REFERENCE_NAME_RE = /^[a-z0-9-]+$/;
const DEFAULT_CAPTURE_RADIUS_M = 240;
const MAX_CAPTURE_RADIUS_M = 5000; // matches the endpoint's cap

/** Parse a pasted `"lat, lon"` string (what a maps app's "copy coordinates" yields) into a validated
 *  coordinate, or `null` if it isn't exactly two in-range numbers. */
function parseLatLon(raw: string): { lat: number; lon: number } | null {
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const latStr = parts[0].trim();
  const lonStr = parts[1].trim();
  if (latStr === '' || lonStr === '') return null;
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Pull the capture parameters (center + square half-extent) back out of a reference's sidecar JSON
 *  so it can be re-captured in place. `radiusMetres` is half the recorded `extentMetres.w` (the
 *  capture endpoint derives grid = ceil(2·radius / metresPerTile)); falls back to grid·metresPerTile/2
 *  for an older sidecar without `extentMetres`. `null` if the sidecar lacks usable geometry (e.g. it
 *  was hand-placed) — the caller then tells the user to use "Capture new" instead. */
function recaptureParams(json: unknown): { lat: number; lon: number; radiusMetres: number } | null {
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  const center = o.center as Record<string, unknown> | undefined;
  const lat = Number(center?.lat);
  const lon = Number(center?.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;

  const extent = o.extentMetres as Record<string, unknown> | undefined;
  let radiusMetres = Number(extent?.w) / 2;
  if (!Number.isFinite(radiusMetres) || radiusMetres <= 0) {
    const grid = o.grid as Record<string, unknown> | undefined;
    radiusMetres = (Number(grid?.w) * Number(o.metresPerTile)) / 2;
  }
  if (!Number.isFinite(radiusMetres) || radiusMetres <= 0 || radiusMetres > MAX_CAPTURE_RADIUS_M) {
    return null;
  }
  return { lat, lon, radiusMetres };
}

/**
 * Reference-underlay control panel (plan 022 step 6) — a collapsible section in the right `<aside>`
 * that drives the store's underlay actions. Primary load path is a dropdown of committed repo
 * references (served via `/__editor/map-references`, listed on mount) + a Load button; a file-picker
 * (and the Map-viewport drag-drop wired in `EditorApp`) is the desktop secondary path for ad-hoc
 * images. When an underlay is present it exposes opacity/offset/scale/visible/lock/clear. All the
 * heavy lifting (fetch, cache, sidecar auto-align, persistence) lives in the store — this is a thin
 * control surface.
 *
 * A collapsible "Capture new" sub-section (plan 023) creates a brand-new committed reference from a
 * pasted `lat, lon` + a square radius (m) via `captureMapReference` (the dev middleware runs the
 * headless-Chromium OSM capture server-side, phone-usable). On success it refreshes the dropdown and
 * auto-loads the new reference as the current overlay. A name clash prompts to confirm an overwrite
 * (both a pre-check against the fetched list and, for a stale-list race, the endpoint's 409).
 *
 * Re-render note: mirrors `InspectorPanel` — the underlay is swapped/edited in place by store actions,
 * so this subscribes to `underlayRevision`/`mapEpoch` purely as re-render triggers and reads the
 * current `underlay`/`mapId` via `getState()` in the render body.
 */

// Restated utility strings (same treatment `InspectorPanel` re-declares from the retired `.editor-*`
// CSS — those helpers were never exported).
const headingClass = 'text-[0.85rem] uppercase tracking-[0.04em] text-fg-dim';
const placeholderClass = 'text-[0.9rem] text-muted-2';
const fieldClass = 'flex flex-col gap-[3px]';
const fieldLabelClass = 'text-[0.8rem] font-normal text-fg-dim';
const fieldInputClass =
  'h-auto border-border bg-inset px-1.5 py-1 text-[0.8rem] text-fg shadow-none md:text-[0.8rem]';

/** Numeric field committing on blur/Enter (one store call per commit), keyed by `value` so an
 *  external change resyncs the uncontrolled input — mirrors `InspectorPanel`'s private `NumberField`. */
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const isCompact = useIsCompact();
  return (
    <div className={cn(fieldClass, 'min-w-0 flex-1')}>
      <Label htmlFor={id} className={fieldLabelClass}>
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step={step}
        defaultValue={value}
        key={value}
        disabled={disabled}
        className={cn(fieldInputClass, isCompact && 'h-11 px-2 text-[0.95rem]')}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export function ReferencePanel() {
  const isCompact = useIsCompact();
  useEditorStore((s) => s.underlayRevision);
  useEditorStore((s) => s.mapEpoch);
  const { underlay, mapId } = useEditorStore.getState();

  const [collapsed, setCollapsed] = useState(false);
  const [references, setReferences] = useState<string[]>([]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const fileId = useId();

  // "Capture new" sub-section state (plan 023). Coordinate + radius are kept as raw strings and the
  // numbers derived, so the Capture handler always reads the latest value (a commit-on-blur field
  // would leave a just-typed value stale on the click that blurs it).
  const [captureCollapsed, setCaptureCollapsed] = useState(true);
  const [newName, setNewName] = useState('');
  const [coord, setCoord] = useState('');
  const [radiusStr, setRadiusStr] = useState(String(DEFAULT_CAPTURE_RADIUS_M));
  const [capturing, setCapturing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const newNameId = useId();
  const coordId = useId();
  const radiusId = useId();

  const nameValid = REFERENCE_NAME_RE.test(newName);
  const parsedCoord = parseLatLon(coord);
  const radius = Number(radiusStr);
  const radiusValid = Number.isFinite(radius) && radius > 0 && radius <= MAX_CAPTURE_RADIUS_M;
  const captureDisabled = capturing || !nameValid || !parsedCoord || !radiusValid;

  // List the committed references (dev-only middleware). A failure just leaves the dropdown empty —
  // the file-picker/drag-drop paths still work. Extracted so a successful capture can re-run it.
  const refresh = useCallback(async () => {
    try {
      setReferences(await listMapReferences());
    } catch (e: unknown) {
      console.warn('[editor] failed to list map references:', (e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const store = useEditorStore.getState;

  // Run the server-side capture. Returns after a success (refresh + auto-load) or a handled failure;
  // on the 409 name-exists race (the fetched list was stale) it confirms + retries with overwrite.
  // Shared by "Capture new" (form values) and "Recapture" (a committed reference's own sidecar).
  const runCapture = async (opts: {
    name: string;
    lat: number;
    lon: number;
    radiusMetres: number;
    overwrite: boolean;
  }): Promise<void> => {
    setCapturing(true);
    try {
      await captureMapReference(opts);
      // An overwrite replaces the bytes on disk; drop the stale cached data-URL so the reload below
      // (and any other map) re-fetches the fresh image instead of the old one.
      deleteCachedImage(opts.name);
      await refresh();
      setSelectedRef(opts.name);
      await store().setUnderlayReference(opts.name); // (re)load onto the Map tab
      toast.success(`Captured "${opts.name}".`);
    } catch (e: unknown) {
      if (e instanceof CaptureError && e.kind === 'exists') {
        if (window.confirm(`A reference named "${opts.name}" already exists. Overwrite it?`)) {
          await runCapture({ ...opts, overwrite: true });
        }
        return;
      }
      const msg =
        e instanceof CaptureError && e.kind === 'busy'
          ? 'A capture is already running — try again in a moment.'
          : `Capture failed: ${(e as Error).message}`;
      toast.error(msg);
    } finally {
      setCapturing(false);
    }
  };

  const onCapture = () => {
    if (captureDisabled || !parsedCoord) return;
    // Pre-check the already-fetched list to confirm before the (slow) round-trip in the common case.
    const already = references.includes(newName);
    if (
      already &&
      !window.confirm(`A reference named "${newName}" already exists. Overwrite it?`)
    ) {
      return;
    }
    void runCapture({
      name: newName,
      lat: parsedCoord.lat,
      lon: parsedCoord.lon,
      radiusMetres: radius,
      overwrite: already,
    });
  };

  // Recapture the selected reference in place: re-run the OSM capture from its own sidecar (same
  // centre + extent), overwriting the committed image. The explicit "refresh in place" surface over
  // the endpoint's overwrite path — no need to re-type the coordinate.
  const onRecapture = async () => {
    if (!selectedRef || capturing || deleting) return;
    const name = selectedRef;
    let sidecar: unknown;
    try {
      sidecar = await getMapReferenceSidecar(name);
    } catch (e: unknown) {
      toast.error(`Couldn't read "${name}" sidecar: ${(e as Error).message}`);
      return;
    }
    const params = recaptureParams(sidecar);
    if (!params) {
      toast.error(
        `"${name}" has no capture metadata to recapture from — use "Capture new" instead.`,
      );
      return;
    }
    if (
      !window.confirm(`Recapture "${name}" from OpenStreetMap? This overwrites the current image.`)
    ) {
      return;
    }
    void runCapture({ name, ...params, overwrite: true });
  };

  // Delete the selected committed reference (PNG + sidecar on disk). Also evicts its cached bytes and,
  // if it's the underlay currently shown on this map, clears that now-dangling overlay.
  const onDelete = async () => {
    if (!selectedRef || capturing || deleting) return;
    const name = selectedRef;
    if (
      !window.confirm(`Delete reference "${name}"? This removes the committed image from the repo.`)
    ) {
      return;
    }
    setDeleting(true);
    try {
      await deleteMapReference(name);
      deleteCachedImage(name);
      if (store().underlay?.referenceName === name) store().clearUnderlay();
      setSelectedRef(null);
      await refresh();
      toast.success(`Deleted "${name}".`);
    } catch (e: unknown) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={cn(
          headingClass,
          'mb-2 flex w-full items-center gap-1.5 hover:text-fg-muted',
          isCompact && 'py-2 text-[0.9rem]',
        )}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className="text-[0.7rem]">{collapsed ? '▸' : '▾'}</span>
        Reference
      </button>

      {!collapsed && (
        <div className={cn('flex flex-col gap-2.5', isCompact && 'gap-3')}>
          {!mapId && <p className={placeholderClass}>No map open.</p>}

          {mapId && (
            <>
              {/* Primary path: pick a committed reference and Load it. */}
              <div className={fieldClass}>
                <Label className={fieldLabelClass}>Committed reference</Label>
                <div className={cn('flex gap-1.5', isCompact && 'flex-wrap gap-2')}>
                  <Select
                    value={selectedRef ?? undefined}
                    onValueChange={(v) => setSelectedRef(v)}
                    disabled={references.length === 0}
                  >
                    <SelectTrigger
                      size="sm"
                      className={cn(
                        fieldInputClass,
                        'min-w-0 flex-1 justify-between font-normal',
                        isCompact && 'h-11 basis-full px-2 text-[0.95rem]',
                      )}
                    >
                      <SelectValue
                        placeholder={
                          references.length === 0 ? 'None available' : 'Pick a reference…'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {references.map((name) => (
                        <SelectItem
                          key={name}
                          value={name}
                          className={cn(isCompact && 'py-2.5 text-base')}
                        >
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(isCompact && 'h-11 flex-1')}
                    disabled={!selectedRef}
                    onClick={() => {
                      if (selectedRef) void store().setUnderlayReference(selectedRef);
                    }}
                  >
                    Load
                  </Button>
                </div>
                {/* Manage the selected committed reference (plan 022): re-capture it in place from
                    its own sidecar, or delete it from the repo. */}
                <div className={cn('flex gap-1.5', isCompact && 'gap-2')}>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn('flex-1', isCompact && 'h-11')}
                    disabled={!selectedRef || capturing || deleting}
                    onClick={() => void onRecapture()}
                    title="Re-run the OSM capture from this reference's saved location, overwriting its image"
                  >
                    {capturing ? 'Recapturing…' : 'Recapture'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn('flex-1 text-red-400 hover:text-red-300', isCompact && 'h-11')}
                    disabled={!selectedRef || capturing || deleting}
                    onClick={() => void onDelete()}
                    title="Delete this committed reference (image + sidecar) from the repo"
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>

              {/* Secondary path (desktop): pick or drag-drop an ad-hoc image (doesn't survive reload). */}
              <div className={fieldClass}>
                <Label htmlFor={fileId} className={fieldLabelClass}>
                  …or load a file
                </Label>
                <input
                  id={fileId}
                  type="file"
                  accept="image/png,image/jpeg"
                  className={cn(
                    'text-[0.75rem] text-fg-dim file:mr-2 file:rounded file:border file:border-border file:bg-inset file:px-1.5 file:py-0.5 file:text-fg',
                    isCompact && 'text-[0.85rem] file:px-3 file:py-2',
                  )}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void store().setUnderlayImageFromFile(file);
                    e.target.value = ''; // reset so re-picking the same file re-fires change
                  }}
                />
              </div>

              {/* Capture new (plan 023): create a committed reference from a coordinate + radius,
                  captured server-side (headless Chromium → OSM slice) — phone-usable. */}
              <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                <button
                  type="button"
                  className={cn(
                    fieldLabelClass,
                    'flex w-full items-center gap-1.5 hover:text-fg',
                    isCompact && 'py-1.5 text-[0.85rem]',
                  )}
                  onClick={() => setCaptureCollapsed((c) => !c)}
                  aria-expanded={!captureCollapsed}
                >
                  <span className="text-[0.7rem]">{captureCollapsed ? '▸' : '▾'}</span>
                  Capture new
                </button>

                {!captureCollapsed && (
                  <div className={cn('flex flex-col gap-2', isCompact && 'gap-3')}>
                    <div className={fieldClass}>
                      <Label htmlFor={newNameId} className={fieldLabelClass}>
                        Name
                      </Label>
                      <Input
                        id={newNameId}
                        value={newName}
                        placeholder="e.g. mostowo-north"
                        className={cn(fieldInputClass, isCompact && 'h-11 px-2 text-[0.95rem]')}
                        onChange={(e) => setNewName(e.target.value)}
                      />
                      {newName && !nameValid && (
                        <span className="text-[0.7rem] text-red-400">
                          lowercase letters, digits, hyphens only
                        </span>
                      )}
                    </div>

                    <div className={fieldClass}>
                      <Label htmlFor={coordId} className={fieldLabelClass}>
                        Center (lat, lon)
                      </Label>
                      <Input
                        id={coordId}
                        value={coord}
                        placeholder="54.0726, 16.3603"
                        className={cn(fieldInputClass, isCompact && 'h-11 px-2 text-[0.95rem]')}
                        onChange={(e) => setCoord(e.target.value)}
                      />
                      {coord && !parsedCoord && (
                        <span className="text-[0.7rem] text-red-400">
                          paste “lat, lon” (lat ±90, lon ±180)
                        </span>
                      )}
                    </div>

                    <div className={cn(fieldClass, 'min-w-0 flex-1')}>
                      <Label htmlFor={radiusId} className={fieldLabelClass}>
                        Radius (m)
                      </Label>
                      <Input
                        id={radiusId}
                        type="number"
                        step={10}
                        min={1}
                        value={radiusStr}
                        className={cn(fieldInputClass, isCompact && 'h-11 px-2 text-[0.95rem]')}
                        onChange={(e) => setRadiusStr(e.target.value)}
                      />
                      {radiusStr && !radiusValid && (
                        <span className="text-[0.7rem] text-red-400">
                          1–{MAX_CAPTURE_RADIUS_M} m
                        </span>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className={cn('self-start', isCompact && 'h-11 w-full')}
                      disabled={captureDisabled}
                      onClick={onCapture}
                    >
                      {capturing ? 'Capturing…' : 'Capture'}
                    </Button>
                  </div>
                )}
              </div>

              {underlay ? (
                <>
                  <p className={placeholderClass} title={underlay.referenceName ?? 'ad-hoc file'}>
                    Showing: {underlay.referenceName ?? 'ad-hoc image'}
                  </p>

                  <div className={cn(fieldClass, isCompact && 'py-1')}>
                    <Label className={fieldLabelClass}>
                      Opacity: {Math.round(underlay.opacity * 100)}%
                    </Label>
                    <Slider
                      min={0}
                      max={1}
                      step={0.05}
                      value={[underlay.opacity]}
                      className={cn(isCompact && 'py-2 [&_[data-slot=slider-thumb]]:size-5')}
                      onValueChange={([v]) => store().setUnderlayOpacity(v)}
                    />
                  </div>

                  <div className={cn('flex gap-2', isCompact && 'gap-3')}>
                    <NumberField
                      label="Offset X (tiles)"
                      value={underlay.offsetX}
                      disabled={underlay.locked}
                      onCommit={(x) => store().setUnderlayOffset(x, underlay.offsetY)}
                    />
                    <NumberField
                      label="Offset Y (tiles)"
                      value={underlay.offsetY}
                      disabled={underlay.locked}
                      onCommit={(y) => store().setUnderlayOffset(underlay.offsetX, y)}
                    />
                  </div>

                  <NumberField
                    label="Scale"
                    value={underlay.scale}
                    step={0.05}
                    disabled={underlay.locked}
                    onCommit={(s) => store().setUnderlayScale(s)}
                  />

                  <div
                    className={cn(
                      'flex items-center gap-3 text-[0.8rem] text-fg-muted',
                      isCompact && 'gap-4 text-[0.9rem]',
                    )}
                  >
                    <label className={cn('flex items-center gap-1', isCompact && 'gap-2 py-1.5')}>
                      <input
                        type="checkbox"
                        className={cn(isCompact && 'size-4')}
                        checked={underlay.visible}
                        onChange={() => store().toggleUnderlayVisible()}
                      />
                      Visible
                    </label>
                    <label className={cn('flex items-center gap-1', isCompact && 'gap-2 py-1.5')}>
                      <input
                        type="checkbox"
                        className={cn(isCompact && 'size-4')}
                        checked={underlay.locked}
                        onChange={() => store().toggleUnderlayLock()}
                      />
                      Lock
                    </label>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className={cn('self-start', isCompact && 'h-11 w-full')}
                    onClick={() => store().clearUnderlay()}
                  >
                    Clear
                  </Button>
                </>
              ) : (
                <p className={cn(placeholderClass, 'text-[0.8rem]')}>
                  No underlay — pick a reference or load a file to trace over.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
