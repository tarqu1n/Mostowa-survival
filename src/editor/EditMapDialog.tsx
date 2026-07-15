import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  MAP_ID_PATTERN,
  MAX_MAP_DIM,
  parseMap,
  planResize,
  serializeMap,
  type ResizeEdges,
} from '../systems/mapFormat';
import { parseWorldLayout } from '../systems/worldLayout';
import { deleteMap, listMaps, putMap, putThumb, putWorld } from './api';
import { useEditorStore } from './store/editorStore';
import { toast } from 'sonner';

/** A labelled field row (`<Label>` + control) — mirrors `NewMapDialog`/`ResizeMapDialog`. */
const fieldClass = 'flex flex-col gap-1.5';

/**
 * Modal for **Edit map** (plan 025): one dialog grouping two map-level operations in separate
 * sections, each with its own primary button and a shared Cancel:
 *
 * - **Rename** — changes both `meta.name` (display) and `meta.id` (the on-disk file key). An
 *   **immediate, non-undoable disk migration** gated by a native `window.confirm`: writes the map
 *   under the new id, migrates the in-memory + localStorage state (`renameMapState`), re-bakes the
 *   thumbnail, saves the world layout if this map is placed, then removes the old file — write-new-
 *   before-delete-old so a failure never orphans the live map. Reverse it by renaming back.
 * - **Resize** — the plan-024 per-edge resize, moved here verbatim: an in-doc, **undoable** command
 *   that persists via Save. Behaviour unchanged.
 *
 * Rendered conditionally by the toolbar (`{showEdit && <EditMapDialog .../>}`), so it's only ever
 * mounted while a map is open — `open` is always `true`; `onOpenChange(false)` (Escape / overlay /
 * close button) is wired to `onCancel`, exactly like `NewMapDialog`/`ResizeMapDialog`.
 */
export function EditMapDialog({ onCancel }: { onCancel: () => void }) {
  const map = useEditorStore((s) => s.map);

  // ---- Rename section state ----
  const [name, setName] = useState(map?.meta.name ?? '');
  const [id, setId] = useState(map?.meta.id ?? '');
  const [existingIds, setExistingIds] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState(false);

  // ---- Resize section state (mirrors the old ResizeMapDialog verbatim) ----
  const [top, setTop] = useState(0);
  const [right, setRight] = useState(0);
  const [bottom, setBottom] = useState(0);
  const [left, setLeft] = useState(0);

  // Existing ids for the collision check — a rename must reject an id already on disk (excluding the
  // current one). Mirrors `OpenMapDialog`'s mount fetch.
  useEffect(() => {
    void listMaps()
      .then(setExistingIds)
      .catch(() => setExistingIds([])); // a fetch failure just skips the collision guard, never blocks
  }, []);

  // The toolbar only mounts this dialog when a map is open, so `map` is non-null here in practice; the
  // guard keeps TS happy and closes gracefully if the map somehow closed underneath us.
  if (!map) return null;

  const oldId = map.meta.id;
  const oldName = map.meta.name;

  // ---- Rename validation / gating ----
  const idChanged = id !== oldId;
  const nameChanged = name.trim() !== oldName;
  const idOk = MAP_ID_PATTERN.test(id);
  const collision = idChanged && (existingIds?.includes(id) ?? false);
  const canRename =
    idOk && name.trim().length > 0 && (idChanged || nameChanged) && !collision && !renaming;

  async function handleRename(): Promise<void> {
    const newId = id;
    const newName = name.trim();
    const placed = useEditorStore.getState().world.placements.some((p) => p.mapId === oldId);
    const confirmMsg =
      `Rename this map to "${newName}" (${newId})?\n\n` +
      'This writes to disk now and is NOT undoable — the map is saved under the new id and the ' +
      `old file${newId !== oldId ? ` (${oldId})` : ''} is removed.` +
      (placed
        ? '\n\nThis map is placed in the world, so the world layout will also be saved.'
        : '');
    if (!window.confirm(confirmMsg)) return;

    setRenaming(true);
    try {
      // 1–2: rebake, build the renamed doc, serialize, validate the exact bytes.
      useEditorStore.getState().rebakeTerrainsForSave();
      const current = useEditorStore.getState().map;
      if (!current) return;
      const renamed = { ...current, meta: { ...current.meta, id: newId, name: newName } };
      const json = serializeMap(renamed);
      parseMap(JSON.parse(json)); // validate before any disk write

      // 3: write the new file FIRST (so a later failure never orphans the live map).
      await putMap(newId, json);

      // 4: commit in-memory + localStorage state (map ref, mapId, underlay settings, world placement).
      const { placementMigrated } = useEditorStore.getState().renameMapState(newId, newName);

      // 5: re-bake the thumbnail under the new id (non-fatal, mirrors Save).
      try {
        const bake = useEditorStore.getState().bakeThumbnail;
        const blob = bake ? await bake() : null;
        if (blob) await putThumb(newId, blob);
      } catch (e) {
        console.warn('[editor] thumbnail export failed:', e);
      }

      // 6: renaming a *placed* map also persists the world layout (Save Map ≠ Save World normally,
      // but the placement's mapId just changed on disk-bound state, so it must be written).
      if (placementMigrated) {
        const layout = useEditorStore.getState().world;
        const worldJson = `${JSON.stringify(layout, null, 2)}\n`;
        parseWorldLayout(JSON.parse(worldJson));
        await putWorld(worldJson);
        useEditorStore.getState().markWorldSaved();
      }

      // 7: remove the old map file (+ its thumb) LAST — a failure here is a non-fatal warning
      // (orphaned old file), never a hard error, because the new map is already good.
      if (newId !== oldId) {
        try {
          await deleteMap(oldId);
        } catch (e) {
          console.warn('[editor] deleting old map failed:', e);
          toast(`Renamed, but removing the old file "${oldId}" failed: ${(e as Error).message}`, {
            duration: 4000,
          });
        }
      }

      toast.success(`Renamed to "${newName}" (${newId}).`);
      if (placementMigrated) {
        toast.info('World layout saved (this map is placed in the world).');
      }
      onCancel();
    } catch (e) {
      toast.error(`Rename failed: ${(e as Error).message}`, { duration: 5000 });
    } finally {
      setRenaming(false);
    }
  }

  // ---- Resize plan / gating (verbatim from the old ResizeMapDialog) ----
  const edges: ResizeEdges = { top, right, bottom, left };
  const plan = planResize(map, edges);
  const anyEdge = top !== 0 || right !== 0 || bottom !== 0 || left !== 0;
  const canResize = plan.dimsValid && plan.offendingObjectIds.length === 0 && anyEdge;

  function handleResize(): void {
    if (
      plan.discardsNonEmpty &&
      !window.confirm(
        'This crop discards painted tiles/zones/walkability outside the new bounds. Continue?',
      )
    ) {
      return;
    }
    const ok = useEditorStore.getState().resizeMap(edges);
    if (ok) {
      toast.success(`Resized to ${plan.newWidth}×${plan.newHeight}.`);
      onCancel();
    }
  }

  const edgeField = (
    fieldId: string,
    label: string,
    value: number,
    set: (n: number) => void,
  ): React.ReactNode => (
    <div className={fieldClass}>
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        type="number"
        value={value}
        onChange={(e) => set(Math.floor(Number(e.target.value)) || 0)}
      />
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="bg-popover text-popover-foreground sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Edit map</DialogTitle>
        </DialogHeader>

        {/* ---- Rename section ---- */}
        <section className="flex flex-col gap-3">
          <h3 className="text-[0.9rem] font-semibold text-fg-bright">Rename</h3>
          <p className="text-[0.8rem] text-fg-muted">
            Changes the display name and the id (the on-disk file key). Applied immediately — not
            undoable.
          </p>
          <div className={fieldClass}>
            <Label htmlFor="rename-name">Name</Label>
            <Input
              id="rename-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
            />
          </div>
          <div className={fieldClass}>
            <Label htmlFor="rename-id">Id</Label>
            <Input
              id="rename-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="lowercase-hyphenated-id"
            />
          </div>
          {id.length > 0 && !idOk && (
            <p className="text-[0.8rem] text-danger">
              Id must be lowercase letters, digits and hyphens only.
            </p>
          )}
          {collision && (
            <p className="text-[0.8rem] text-danger">A map with id “{id}” already exists.</p>
          )}
          <div className="flex justify-end">
            <Button disabled={!canRename} onClick={() => void handleRename()}>
              Rename
            </Button>
          </div>
        </section>

        <div className="my-1 h-px bg-surface" />

        {/* ---- Resize section (plan 024, unchanged) ---- */}
        <section className="flex flex-col gap-3">
          <h3 className="text-[0.9rem] font-semibold text-fg-bright">Resize</h3>
          <p className="text-[0.8rem] text-fg-muted">Tiles to add (+) or crop (−) per edge.</p>
          <div className="grid grid-cols-2 gap-3">
            {edgeField('resize-top', 'Top', top, setTop)}
            {edgeField('resize-right', 'Right', right, setRight)}
            {edgeField('resize-bottom', 'Bottom', bottom, setBottom)}
            {edgeField('resize-left', 'Left', left, setLeft)}
          </div>
          <div className="flex flex-col gap-1 text-[0.85rem]">
            <p>
              {map.meta.width}×{map.meta.height} →{' '}
              <span className={plan.dimsValid ? 'text-fg-bright' : 'text-danger'}>
                {plan.newWidth}×{plan.newHeight}
              </span>
            </p>
            {!plan.dimsValid && (
              <p className="text-danger">Each dimension must be between 1 and {MAX_MAP_DIM}.</p>
            )}
            {plan.offendingObjectIds.length > 0 && (
              <p className="text-danger">
                {plan.offendingObjectIds.length} object
                {plan.offendingObjectIds.length === 1 ? '' : 's'} would be cut off (
                {plan.offendingObjectIds.join(', ')}).
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button disabled={!canResize} onClick={handleResize}>
              Apply resize
            </Button>
          </div>
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
