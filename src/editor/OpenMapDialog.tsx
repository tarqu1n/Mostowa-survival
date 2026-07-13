import { useEffect, useState } from 'react';
import { listMaps } from './api';

/** Modal for Open: lists map ids from `GET /__editor/maps`; picking one loads it (in the toolbar). */
export function OpenMapDialog({
  onOpen,
  onCancel,
}: {
  onOpen: (id: string) => void;
  onCancel: () => void;
}) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listMaps()
      .then(setIds)
      .catch((e: unknown) => setError((e as Error).message));
  }, []);

  return (
    <div className="editor-modal-backdrop" onClick={onCancel}>
      <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Open map</h3>
        {error && <p className="editor-error-text">{error}</p>}
        {!ids && !error && <p className="editor-placeholder">Loading…</p>}
        {ids && ids.length === 0 && (
          <p className="editor-placeholder">No maps yet — create one with New.</p>
        )}
        {ids && ids.length > 0 && (
          <ul className="editor-map-list">
            {ids.map((id) => (
              <li key={id}>
                <button onClick={() => onOpen(id)}>{id}</button>
              </li>
            ))}
          </ul>
        )}
        <div className="editor-modal-actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
