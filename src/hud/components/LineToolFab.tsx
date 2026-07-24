import type { PointerEvent as ReactPointerEvent } from 'react';
import { Ruler } from 'lucide-react';
import { useHudStore } from '../store';
import { hudBridge } from '../hooks/useBridge';
import { Button } from '@/hud/ui/button';

/**
 * Blueprint-Mode line-tool FAB (plan 050 Step 6) — a round toggle in the build thumb zone (rendered by
 * `GameHud`'s `ActionLayer`, gated on the store's `buildMode`, so it only shows while building). When
 * armed, a build-mode drag paints an axis-locked straight RUN of blueprint ghosts instead of the
 * tool-off tap-place-on-up / drag-pans behaviour (the world reads the flag in PointerInputController).
 *
 * Fires on POINTER-DOWN, not click (mirrors the combat Attack/Bow buttons — see CommandBar.onPress): a
 * browser only synthesizes `click` for the PRIMARY pointer, so a press while the movepad holds it would
 * be dropped by `onClick`; `pointerdown` is delivered for every pointer, keeping the toggle live.
 *
 * The highlight is a pure mirror of the store's `lineTool`: the tap emits the DESIRED next state
 * (`{ on: !lineTool }`), the game flips its own flag and echoes `build:lineToolChanged` back, and the
 * bridge writes that into the store — so the FAB never tracks a local optimistic state that could drift.
 */
export function LineToolFab() {
  const lineTool = useHudStore((s) => s.lineTool);
  return (
    <div className="pointer-events-none flex justify-end">
      <Button
        data-testid="hud-line-tool"
        variant={lineTool ? 'default' : 'secondary'}
        aria-pressed={lineTool}
        aria-label="Line tool"
        title="Line tool — drag to place a straight run"
        className="pointer-events-auto size-11 rounded-full p-0"
        onPointerDown={(e: ReactPointerEvent) => {
          e.preventDefault();
          hudBridge()?.emit({ type: 'build:lineTool', payload: { on: !lineTool } });
        }}
      >
        <Ruler className="size-5" />
      </Button>
    </div>
  );
}
