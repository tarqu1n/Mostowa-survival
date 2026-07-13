import { useEffect } from 'react';
import { useEditorStore } from './store/editorStore';
import { Toolbar } from './Toolbar';
import { PhaserViewport } from './PhaserViewport';
import { useToast, ToastHost } from './Toast';

/**
 * Map Builder shell (plan 014 step 5): toolbar on top, then a three-pane body — Library (left,
 * placeholder until step 6), the Phaser viewport (centre), Inspector/Layers (right, placeholder
 * until steps 6-8). The World view is a placeholder until step 9. Everything shares state through
 * `useEditorStore`; this component only wires the panes and the global undo/redo shortcuts.
 */
export function EditorApp() {
  const view = useEditorStore((s) => s.view);
  const map = useEditorStore((s) => s.map);
  const { toast, showToast } = useToast();

  // Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z = redo. Ignored while typing in a dialog field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="editor-shell">
      <Toolbar showToast={showToast} />
      <div className="editor-body">
        <aside className="editor-pane editor-pane--library">
          <h2>Library</h2>
          <p className="editor-placeholder">Asset library — coming in step 6.</p>
        </aside>
        <main className="editor-pane editor-pane--viewport">
          {view === 'map' ? (
            <>
              <PhaserViewport />
              {!map && <div className="editor-empty-hint">New or Open a map to begin.</div>}
            </>
          ) : (
            <div className="editor-empty-hint">World view — coming in step 9.</div>
          )}
        </main>
        <aside className="editor-pane editor-pane--inspector">
          <h2>Inspector / Layers</h2>
          <p className="editor-placeholder">Inspector + layers — coming in steps 6-8.</p>
        </aside>
      </div>
      <ToastHost toast={toast} />
    </div>
  );
}
