import { useEffect } from 'react';
import { TILE_SIZE } from '../config';
import { useEditorStore } from './store/editorStore';
import { Toolbar } from './Toolbar';
import { PhaserViewport } from './PhaserViewport';
import { LibraryPanel } from './panels/LibraryPanel';
import { LayersPanel } from './panels/LayersPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { PortalDialog } from './PortalDialog';
import { useToast, ToastHost } from './Toast';

/**
 * Map Builder shell (plan 014 step 5, extended steps 6-7): toolbar on top, then a three-pane body —
 * Library (left), the Phaser viewport (centre), Inspector + Layers (right). The World view is a
 * placeholder until step 9. Everything shares state through `useEditorStore`; this component only
 * wires the panes, the global undo/redo + delete shortcuts, and the Portal-tool's name/facing dialog.
 */

/** Arrow key → unit direction (screen space: up = -y). Drives the selected-object nudge below. */
const NUDGE_DIRS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function EditorApp() {
  const view = useEditorStore((s) => s.view);
  const map = useEditorStore((s) => s.map);
  const pendingPortalRect = useEditorStore((s) => s.pendingPortalRect);
  const { toast, showToast } = useToast();

  // Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z = redo, Delete/Backspace = remove the selected object(s),
  // arrow keys = nudge the selection. Ignored while typing in a dialog/Inspector field (the SAME
  // input-guard for all, so these never fire while editing a numeric field).
  // NOTE: any shortcut added/changed here must be reflected in `shortcuts.ts` (the Shortcuts panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = useEditorStore.getState().selectedObjectIds;
        if (ids.length > 0) {
          e.preventDefault();
          useEditorStore.getState().deleteObjects(ids);
        }
        return;
      }
      // Arrow keys nudge the selection for fine positioning: plain = 1px (decor only — nodes/portals
      // are tile-addressed and don't sub-tile), Shift = one whole tile (everything). Routes through the
      // same void-validated, undoable `translateObjects` a drag uses — one undo entry per press.
      const dir = NUDGE_DIRS[e.key];
      if (dir) {
        const ids = useEditorStore.getState().selectedObjectIds;
        if (ids.length > 0) {
          e.preventDefault();
          const coarse = e.shiftKey;
          const step = coarse ? TILE_SIZE : 1;
          useEditorStore.getState().translateObjects(ids, {
            dxPx: dir.x * step,
            dyPx: dir.y * step,
            dCol: coarse ? dir.x : 0,
            dRow: coarse ? dir.y : 0,
          });
        }
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
          <LibraryPanel />
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
          <InspectorPanel />
          <hr className="editor-pane-divider" />
          <LayersPanel />
        </aside>
      </div>
      <ToastHost toast={toast} />
      {pendingPortalRect && (
        <PortalDialog
          rect={pendingPortalRect}
          onConfirm={(name, facing) => {
            useEditorStore.getState().createPortal(pendingPortalRect, name, facing);
            useEditorStore.getState().setPendingPortalRect(null);
          }}
          onCancel={() => useEditorStore.getState().setPendingPortalRect(null)}
        />
      )}
    </div>
  );
}
