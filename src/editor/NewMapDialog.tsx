import { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { MAX_MAP_DIM, MAP_ID_PATTERN } from '../systems/mapFormat';

export interface NewMapFields {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** A labelled field row (`<Label>` + control), shared by every field below. */
const fieldClass = 'flex flex-col gap-1.5';

/** Modal for New: collects id/name/width/height → `createEmptyMap` (via the store) in the toolbar.
 *  Rendered conditionally by the toolbar (`{showNew && <NewMapDialog .../>}`), so it's only ever
 *  mounted while open — `open` is therefore always `true`; `onOpenChange(false)` (Escape, overlay
 *  click, or the Dialog's own close button) is wired straight to the existing `onCancel` prop so the
 *  toolbar's contract is unchanged. */
export function NewMapDialog({
  onCreate,
  onCancel,
}: {
  onCreate: (fields: NewMapFields) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [width, setWidth] = useState(45);
  const [height, setHeight] = useState(80);

  const idOk = MAP_ID_PATTERN.test(id);
  const dimsOk = width >= 1 && width <= MAX_MAP_DIM && height >= 1 && height <= MAX_MAP_DIM;
  const valid = idOk && name.trim().length > 0 && dimsOk;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="bg-popover text-popover-foreground sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>New map</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className={fieldClass}>
            <Label htmlFor="new-map-id">Id</Label>
            <Input
              id="new-map-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="test-camp"
            />
            {id.length > 0 && !idOk && (
              <p className="text-[0.8rem] text-danger">
                Id must be lower-case letters, digits and hyphens.
              </p>
            )}
          </div>
          <div className={fieldClass}>
            <Label htmlFor="new-map-name">Name</Label>
            <Input
              id="new-map-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Test Camp"
            />
          </div>
          <div className={fieldClass}>
            <Label htmlFor="new-map-width">Width (tiles)</Label>
            <Input
              id="new-map-width"
              type="number"
              min={1}
              max={MAX_MAP_DIM}
              value={width}
              onChange={(e) => setWidth(Math.floor(Number(e.target.value)))}
            />
          </div>
          <div className={fieldClass}>
            <Label htmlFor="new-map-height">Height (tiles)</Label>
            <Input
              id="new-map-height"
              type="number"
              min={1}
              max={MAX_MAP_DIM}
              value={height}
              onChange={(e) => setHeight(Math.floor(Number(e.target.value)))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => onCreate({ id, name: name.trim(), width, height })}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
