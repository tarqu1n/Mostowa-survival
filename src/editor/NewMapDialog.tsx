import { useState } from 'react';

export interface NewMapFields {
  id: string;
  name: string;
  width: number;
  height: number;
}

// Matches the middleware's `:id` sanitiser (`[a-z0-9-]+`) so a New map can always be saved later.
const ID_PATTERN = /^[a-z0-9-]+$/;
const MAX_DIM = 512; // a sane bake ceiling — the biggest planned map (45×80) is well under this

/** Modal for New: collects id/name/width/height → `createEmptyMap` (via the store) in the toolbar. */
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

  const idOk = ID_PATTERN.test(id);
  const dimsOk = width >= 1 && width <= MAX_DIM && height >= 1 && height <= MAX_DIM;
  const valid = idOk && name.trim().length > 0 && dimsOk;

  return (
    <div className="editor-modal-backdrop" onClick={onCancel}>
      <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
        <h3>New map</h3>
        <label>
          Id
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="test-camp" />
        </label>
        {id.length > 0 && !idOk && (
          <p className="editor-error-text">Id must be lower-case letters, digits and hyphens.</p>
        )}
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Test Camp" />
        </label>
        <label>
          Width (tiles)
          <input
            type="number"
            min={1}
            max={MAX_DIM}
            value={width}
            onChange={(e) => setWidth(Math.floor(Number(e.target.value)))}
          />
        </label>
        <label>
          Height (tiles)
          <input
            type="number"
            min={1}
            max={MAX_DIM}
            value={height}
            onChange={(e) => setHeight(Math.floor(Number(e.target.value)))}
          />
        </label>
        <div className="editor-modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            disabled={!valid}
            onClick={() => onCreate({ id, name: name.trim(), width, height })}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
