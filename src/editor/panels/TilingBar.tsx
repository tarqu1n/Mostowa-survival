import { ChevronDown, ChevronUp } from 'lucide-react';
import type { NodeObject } from '../../systems/mapFormat';
import { useEditorStore } from '../store/editorStore';
import { Button } from '../ui/button';
import { QuickLayerSelect } from '../ui/QuickLayerSelect';
import { SkinThumb } from '../ui/SkinThumb';
import { cn } from '../lib/utils';
import { useIsCompact } from '../hooks/useIsCompact';
import { PaletteStrip } from './PaletteStrip';

/**
 * The Map-tab tiling bar — the thin strip beneath the viewport (above SelectionBar/ContextBar). It owns
 * two behaviours layered over the palette:
 *
 *  1. **Collapse** (phone feedback: the strip "gets in the way when you don't need it"). A chevron folds
 *     the whole row down to a one-line re-open handle, reclaiming that vertical band for the map. The
 *     flag is GLOBAL editor chrome persisted in `uiPrefsStore` (`tilingBarCollapsed`), so it survives a
 *     reload and switching maps — not per-map view-state.
 *  2. **Context-swap to skin selection**: while exactly one NODE is selected the bar stops being a tile
 *     palette and becomes a skin picker for that node (the same swatch grid the Inspector shows, tuned
 *     into a single scrolling row), so you can reskin a placed tree/rock without opening the Inspector
 *     drawer. Selecting anything else (or nothing) restores the tile palette.
 *
 * Rendered by `EditorApp` in BOTH shells; `withLayerSelect` adds the desktop's `QuickLayerSelect`
 * (compact hosts that control in the ContextBar's brush group instead). Map-tab gated by the caller.
 */
export function TilingBar({ withLayerSelect = false }: { withLayerSelect?: boolean }) {
  const collapsed = useEditorStore((s) => s.tilingBarCollapsed);
  const setCollapsed = (v: boolean): void => useEditorStore.getState().setTilingBarCollapsed(v);

  // Decide palette-vs-skin mode from the selection. `map` is mutated in place by store commands (see
  // InspectorPanel's re-render note), so subscribe to the revision counters + selection as re-render
  // triggers and read the live `map` via `getState()`.
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);
  const map = useEditorStore.getState().map;
  const sole =
    map && selectedObjectIds.length === 1
      ? map.objects.find((o) => o.id === selectedObjectIds[0])
      : undefined;
  const skinNode = sole?.kind === 'node' ? sole : undefined;

  const rowClass = 'flex flex-none items-center gap-2 border-t border-surface bg-raised px-2';

  if (collapsed) {
    // A single-line handle: chevron + a label naming what re-opening will show (Skin while a node is
    // selected, Palette otherwise) so the fold is self-describing.
    return (
      <div className={cn(rowClass, 'py-1')}>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-fg-dim"
          title="Show the tile palette"
          aria-expanded={false}
          aria-label="Show the tile palette"
          onClick={() => setCollapsed(false)}
        >
          <ChevronUp className="size-4" />
          {skinNode ? 'Skin' : 'Palette'}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn(rowClass, 'py-1.5')}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="flex-none self-start text-fg-dim"
        title="Collapse the tile palette"
        aria-expanded={true}
        aria-label="Collapse the tile palette"
        onClick={() => setCollapsed(true)}
      >
        <ChevronDown />
      </Button>
      {/* The layer selector only makes sense for the tile palette (it targets the brush's tile layer),
          so it's dropped in skin mode. */}
      {withLayerSelect && !skinNode && <QuickLayerSelect />}
      <div className="min-w-0 flex-1 overflow-x-auto">
        {skinNode ? <NodeSkinStrip node={skinNode} /> : <PaletteStrip />}
      </div>
    </div>
  );
}

/**
 * The skin picker the tiling bar shows while a single node is selected — a horizontal, scrolling row of
 * the node def's skins (pixel-crisp `SkinThumb`s, the same renderer the Inspector uses), the active one
 * ringed in gold; a tap sets that skin via `updateNode` (one undoable command, exactly like the
 * Inspector picker + the `S` cycle shortcut). Falls back to a short note for a single-skin def, which
 * has nothing to choose.
 */
function NodeSkinStrip({ node }: { node: NodeObject }) {
  const isCompact = useIsCompact();
  // Subscribe so the row refreshes if the def's skins change while the node stays selected.
  const def = useEditorStore((s) => s.nodeDefsParsed[node.ref]);
  const catalog = useEditorStore((s) => s.catalog);
  const skins = def?.skins ?? [];
  // The skin this instance renders: its explicit override, else the def's default (first skin) — the
  // same fallback the Inspector + `ResourceNodeManager.resolveSkin` use.
  const currentId = node.skin ?? skins[0]?.id;
  const size = isCompact ? 44 : 40;
  const update = (skin: string): void => {
    useEditorStore.getState().updateNode(node.id, { skin });
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className="max-w-[30%] flex-none truncate text-[0.8rem] text-fg-dim"
        title={def?.name || node.ref}
      >
        {def?.name || node.ref}
      </span>
      {skins.length < 2 ? (
        <span className="text-[0.8rem] text-muted-2">This node has a single skin.</span>
      ) : (
        <div role="radiogroup" aria-label="Node skin" className="flex items-center gap-1.5">
          {skins.map((s, i) => {
            const isSelected = s.id === currentId;
            const label = `${s.name || s.id}${i === 0 ? ' (default)' : ''}`;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={label}
                title={label}
                onClick={() => update(s.id)}
                className={cn(
                  'flex-none rounded-[3px] border-2 p-0.5 transition-colors',
                  isSelected
                    ? 'border-gold-light bg-surface'
                    : 'border-transparent hover:border-border',
                )}
              >
                <SkinThumb assetId={s.asset} region={s.region} catalog={catalog} size={size} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
