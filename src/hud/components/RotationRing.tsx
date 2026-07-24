import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useHudStore } from '../store';
import { hudBridge } from '../hooks/useBridge';
import type { FacingSpec } from '@/entities/types';
import { cn } from '@/hud/lib/utils';

/**
 * Blueprint-Mode rotation ring (plan 050 Step 8) — a fixed, thumb-reachable compass of four quadrants
 * (up/down/left/right) rendered in `GameHud`'s `ActionLayer`, gated on `buildMode && orientable` so it
 * shows only while placing a rotatable buildable (the wall). It is FIXED in the thumb zone, deliberately
 * NOT tracking the moving world ghost (avoids per-frame world→screen mapping — critique #7).
 *
 * Each quadrant emits the existing `build:rotate` on POINTER-DOWN carrying `{ to }` — jumping the ghost
 * straight to that facing (mirrors the combat Attack/Bow buttons + the line-tool FAB: a browser only
 * synthesizes `click` for the PRIMARY pointer, so a press while the movepad holds it would be dropped by
 * `onClick`; `pointerdown` is delivered for every pointer, keeping the ring live during a movepad hold).
 *
 * The lit quadrant is a pure mirror of the store's `facing` (fed by the game's `build:facingChanged`) —
 * the ring never tracks a local optimistic facing that could drift; the R/Shift+R keys and the legacy
 * Rotate button drive the same store field, so all three surfaces stay in agreement.
 *
 * Drags never reach the world: the outer wrapper is `pointer-events-none` and only the four buttons opt
 * back in, so a swipe that starts off a quadrant falls straight through to the paint/pan gesture.
 */
const QUADRANTS: ReadonlyArray<{ facing: FacingSpec; Icon: LucideIcon; cell: string }> = [
  { facing: 'up', Icon: ChevronUp, cell: 'col-start-2 row-start-1' },
  { facing: 'left', Icon: ChevronLeft, cell: 'col-start-1 row-start-2' },
  { facing: 'right', Icon: ChevronRight, cell: 'col-start-3 row-start-2' },
  { facing: 'down', Icon: ChevronDown, cell: 'col-start-2 row-start-3' },
];

export function RotationRing() {
  const facing = useHudStore((s) => s.facing);
  return (
    <div className="pointer-events-none flex justify-end">
      <div
        data-testid="hud-rotation-ring"
        className="grid grid-cols-3 grid-rows-3 gap-0.5 rounded-full border border-border bg-inset/85 p-1"
      >
        {QUADRANTS.map(({ facing: f, Icon, cell }) => {
          const active = facing === f;
          return (
            <button
              key={f}
              type="button"
              aria-label={`Face ${f}`}
              aria-pressed={active}
              className={cn(
                'pointer-events-auto flex size-8 items-center justify-center rounded-md border',
                cell,
                active
                  ? 'border-accent-border bg-surface text-fg-bright'
                  : 'border-border bg-surface-subtle text-fg-muted',
              )}
              onPointerDown={(e: ReactPointerEvent) => {
                e.preventDefault();
                hudBridge()?.emit({ type: 'build:rotate', payload: { to: f } });
              }}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
