import { useEffect } from 'react';
import { SHORTCUT_GROUPS } from './shortcuts';

/**
 * Keyboard + mouse shortcuts reference (opened from the toolbar's "⌨ Keys" button). Pure lookup — it
 * renders `SHORTCUT_GROUPS` (the single source of truth in `shortcuts.ts`) and holds no shortcut logic
 * of its own; to change what's listed here, edit that file. Closes on backdrop click, the Close button,
 * or Escape. Mirrors `PortalDialog`'s modal structure.
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="editor-modal-backdrop" onClick={onClose}>
      <div className="editor-modal editor-modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3>Shortcuts</h3>
        <div className="shortcuts-body">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="shortcuts-group">
              <h4>{group.title}</h4>
              <dl className="shortcuts-list">
                {group.shortcuts.map((sc) => (
                  <div key={sc.action} className="shortcuts-row">
                    <dt>
                      {sc.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="shortcuts-or"> or </span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{sc.action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="editor-modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
