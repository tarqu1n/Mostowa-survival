import { Minus, Plus, TreePine, Mountain, Crosshair, type LucideIcon } from 'lucide-react';
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '@/config';
import { useHudStore } from '@/hud/store';
import { hudBridge } from '@/hud/hooks/useBridge';
import { Button } from '@/hud/ui/button';

/**
 * Top-right resource + camera cluster (plan 046, Field Kit): wood/rock chips over the zoom control
 * (`[−] {pct}% [+]`) and a follow toggle — the DOM/React replacement for the legacy Phaser
 * `TopCenterControls` zoom/follow stack. The chips are passive; the zoom + follow buttons emit
 * inbound events back onto the bus for GameScene (which owns the camera) to act on:
 *   - zoom `[−]`/`[+]` → `{ type: 'zoom:delta', payload: ∓ZOOM_STEP }` (mirrors `TopCenterControls`,
 *     which emits `±ZOOM_STEP`; the game clamps + rounds), dimmed at the `MIN_ZOOM`/`MAX_ZOOM` bounds;
 *   - follow → `{ type: 'camera:center' }` (re-centres + re-locks follow), lit while `following`.
 *
 * The root stays click-through (`pointer-events:none`); the two interactive rows opt back in with
 * `pointer-events:auto` so taps register through the otherwise pass-through overlay. Authored in
 * 360×640 design px.
 */

/** A passive resource count chip (wood / rock). */
function Chip({ icon: Icon, value }: { icon: LucideIcon; value: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface/90 px-1.5 py-0.5 text-fg"
      style={{ pointerEvents: 'none' }}
    >
      <Icon size={10} aria-hidden />
      {value}
    </span>
  );
}

export function ResourceChips() {
  const supply = useHudStore((s) => s.supply);
  const zoom = useHudStore((s) => s.zoom);
  const following = useHudStore((s) => s.following);

  const canZoomOut = zoom > MIN_ZOOM;
  const canZoomIn = zoom < MAX_ZOOM;

  const emitZoom = (delta: number): void =>
    void hudBridge()?.emit({ type: 'zoom:delta', payload: delta });
  const toggleFollow = (): void => void hudBridge()?.emit({ type: 'camera:center' });

  return (
    <div
      className="absolute right-3 top-6 flex flex-col items-end gap-1.5"
      style={{ pointerEvents: 'none' }}
      data-testid="hud-resourcechips"
    >
      <div className="flex gap-1.5 font-mono" style={{ fontSize: 9 }}>
        <Chip icon={TreePine} value={supply.wood} />
        <Chip icon={Mountain} value={supply.rock} />
      </div>

      {/* Zoom control — interactive, so opt back into pointer events. Buttons dim (disabled) at the
          zoom bounds, mirroring TopCenterControls.updateZoomButtons. */}
      <div className="flex items-center gap-1" style={{ pointerEvents: 'auto' }}>
        <Button
          variant="secondary"
          size="icon-xs"
          aria-label="Zoom out"
          disabled={!canZoomOut}
          onClick={() => emitZoom(-ZOOM_STEP)}
        >
          <Minus />
        </Button>
        <span className="text-center font-mono text-fg" style={{ fontSize: 9, width: 30 }}>
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="secondary"
          size="icon-xs"
          aria-label="Zoom in"
          disabled={!canZoomIn}
          onClick={() => emitZoom(ZOOM_STEP)}
        >
          <Plus />
        </Button>
      </div>

      {/* Follow toggle — lit (primary) while the camera is locked to the player. */}
      <div style={{ pointerEvents: 'auto' }}>
        <Button
          size="xs"
          variant={following ? 'default' : 'secondary'}
          aria-pressed={following}
          onClick={toggleFollow}
        >
          <Crosshair />
          Follow
        </Button>
      </div>
    </div>
  );
}
