import { ChevronDownIcon } from 'lucide-react';

import { useEditorStore } from '../store/editorStore';
import { useIsCompact } from '../hooks/useIsCompact';
import { cn } from '../lib/utils';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './dropdown-menu';

/**
 * Compact quick layer selector (plan 033 step 5) — a small two-part control bound to
 * `activeLayerId` / `setActiveLayer`, meant for the toolbar/context-bar (Step 6 wires it in; this
 * file only defines the control).
 *
 *   - Primary affordance: a button showing the **current** layer's name (or "No layer" when
 *     `activeLayerId` is null). Tapping **cycles** to the next layer, wrapping from the last back to
 *     the first, and is disabled when there are fewer than two layers.
 *   - Secondary affordance: a chevron `DropdownMenu` to jump directly to any layer by name; the
 *     active layer is checked.
 *
 * Ordering matches `LayersPanel`: `map.layers` is stored bottom→top, but this presents **top-first**
 * (front-most layer first) in both the cycle order and the dropdown list — a display reversal only.
 *
 * Re-render note (see `LayersPanel`): `map` is mutated in place, so we subscribe to
 * `docRevision`/`mapEpoch` purely as re-render triggers and read `map` fresh via `getState()`.
 * `setActiveLayer` is a plain `set`; reconciliation of `activeLayerId` across history moves already
 * lives in the store (`reconcileActiveLayer`), so we never duplicate it here.
 */
export function QuickLayerSelect() {
  const isCompact = useIsCompact();
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  const map = useEditorStore.getState().map;
  // Present top-first (front-most layer first), matching LayersPanel; `map.layers` is bottom→top.
  const presented = map ? [...map.layers].reverse() : [];

  const activeLayer = presented.find((l) => l.id === activeLayerId) ?? null;
  const canCycle = presented.length >= 2;

  function cycle(): void {
    if (presented.length === 0) return;
    const currentIndex = presented.findIndex((l) => l.id === activeLayerId);
    // When nothing is active (or the id is stale), start at the first presented (top) layer;
    // otherwise advance one, wrapping past the end.
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % presented.length;
    useEditorStore.getState().setActiveLayer(presented[nextIndex].id);
  }

  const label = activeLayer ? activeLayer.name : 'No layer';

  return (
    <div className="inline-flex items-stretch">
      <Button
        variant="secondary"
        size="sm"
        disabled={!canCycle}
        onClick={cycle}
        className={cn(
          'max-w-[10rem] justify-start overflow-hidden rounded-r-none text-left text-ellipsis whitespace-nowrap',
          isCompact && 'h-11 min-w-11 max-w-[12rem] text-[0.95rem]',
        )}
        title={canCycle ? 'Active layer — click to cycle' : 'Active layer'}
      >
        {label}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size={isCompact ? 'icon-lg' : 'icon-sm'}
            disabled={presented.length === 0}
            className={cn('rounded-l-none border-l border-border', isCompact && 'size-11')}
            title="Choose a layer"
            aria-label="Choose a layer"
          >
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {presented.map((layer) => (
            <DropdownMenuCheckboxItem
              key={layer.id}
              checked={layer.id === activeLayerId}
              onSelect={() => useEditorStore.getState().setActiveLayer(layer.id)}
              className={cn(isCompact && 'min-h-11 text-[0.95rem]')}
            >
              {layer.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
