import { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { MAX_MAP_DIM, planResize, type ResizeEdges } from '../systems/mapFormat';
import { useEditorStore } from './store/editorStore';
import { toast } from 'sonner';

/** A labelled field row (`<Label>` + control) — mirrors `NewMapDialog`'s `fieldClass`. */
const fieldClass = 'flex flex-col gap-1.5';

/** Modal for Resize (plan 024): four per-edge tile deltas (Top/Right/Bottom/Left; negative = crop that
 *  edge). Live-previews the resulting `W×H` via `planResize`, blocks Apply if any object would fall
 *  outside the new bounds, and confirms (native `window.confirm`) a crop that discards painted cells.
 *  Rendered conditionally by the toolbar (`{showResize && <ResizeMapDialog .../>}`), so it's only ever
 *  mounted while a map is open — `open` is always `true`; `onOpenChange(false)` (Escape / overlay /
 *  close button) is wired to `onCancel`, exactly like `NewMapDialog`. */
export function ResizeMapDialog({ onCancel }: { onCancel: () => void }) {
  const map = useEditorStore((s) => s.map);
  const [top, setTop] = useState(0);
  const [right, setRight] = useState(0);
  const [bottom, setBottom] = useState(0);
  const [left, setLeft] = useState(0);

  // The toolbar only mounts this dialog when a map is open, so `map` is non-null here in practice; the
  // guard keeps TS happy and closes gracefully if the map somehow closed underneath us.
  if (!map) return null;

  const edges: ResizeEdges = { top, right, bottom, left };
  const plan = planResize(map, edges);
  const anyEdge = top !== 0 || right !== 0 || bottom !== 0 || left !== 0;
  const canApply = plan.dimsValid && plan.offendingObjectIds.length === 0 && anyEdge;

  function handleApply(): void {
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

  const field = (
    id: string,
    label: string,
    value: number,
    set: (n: number) => void,
  ): React.ReactNode => (
    <div className={fieldClass}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
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
      <DialogContent className="bg-popover text-popover-foreground sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>Resize map</DialogTitle>
        </DialogHeader>
        <p className="text-[0.8rem] text-fg-muted">
          Tiles to add (+) or crop (−) per edge.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {field('resize-top', 'Top', top, setTop)}
          {field('resize-right', 'Right', right, setRight)}
          {field('resize-bottom', 'Bottom', bottom, setBottom)}
          {field('resize-left', 'Left', left, setLeft)}
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
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!canApply} onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
