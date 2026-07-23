import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { hudBridge } from '../hooks/useBridge';
import { cn } from '@/hud/lib/utils';

/**
 * Field Kit movepad (plan 046 Step 6) — the left-thumb virtual joystick that drives the player in
 * combat. Mirrors the legacy Phaser `CombatControls` movepad (scenes/hud/CombatControls.ts): a thumb
 * knob draggable within a ring, emitting a NORMALIZED move vector on drag and a moveEnd on release.
 *
 * Presentational + self-contained: it emits inbound events on the bridge and reports its held-state
 * up via {@link MovepadProps.onHeldChange}; the held → GameScene authority wiring is Step 10. The math
 * is scale-independent — both the pointer coords and the ring rect are read in screen px, so the
 * normalized vector is unaffected by the design-layer CSS scale (see GameHud `.hud-design`).
 */
interface MovepadProps {
  /** Reports whether a finger is held on the pad: `true` on drag start, `false` on release. */
  onHeldChange?: (held: boolean) => void;
  /** Ring diameter in design px (the mockup's fight bar uses ~60; the default matches the 74px pad). */
  size?: number;
  className?: string;
}

/** Knob diameter as a fraction of the ring (30/74 ≈ the mockup's `.joystick`/`.knob` ratio). */
const KNOB_FRAC = 0.4;

/**
 * Clamp a raw offset (screen px) to a unit vector: `offset / radius`, magnitude clamped to ≤ 1. Pure —
 * so the vector reads the same whatever the ring's on-screen size, and never exceeds full-tilt.
 */
function normalize(dx: number, dy: number, radius: number): { dx: number; dy: number } {
  if (radius <= 0) return { dx: 0, dy: 0 };
  let nx = dx / radius;
  let ny = dy / radius;
  const mag = Math.hypot(nx, ny);
  if (mag > 1) {
    nx /= mag;
    ny /= mag;
  }
  return { dx: nx, dy: ny };
}

export function Movepad({ onHeldChange, size = 74, className }: MovepadProps) {
  // Ring centre + radius in SCREEN px, captured on pointerdown (the ring doesn't move mid-drag).
  const center = useRef<{ x: number; y: number; radius: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const knobSize = Math.round(size * KNOB_FRAC);
  const travel = size / 2 - knobSize / 2; // max knob offset (design px) so it stays inside the ring

  const emitMove = useCallback(
    (clientX: number, clientY: number) => {
      const c = center.current;
      if (!c) return;
      const v = normalize(clientX - c.x, clientY - c.y, c.radius);
      setKnob({ x: v.dx * travel, y: v.dy * travel });
      hudBridge()?.emit({ type: 'combat:move', payload: { dx: v.dx, dy: v.dy } });
    },
    [travel],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    center.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      radius: rect.width / 2,
    };
    // Capture so a drag that leaves the ring keeps tracking (and a second finger can't hijack it).
    e.currentTarget.setPointerCapture(e.pointerId);
    onHeldChange?.(true);
    emitMove(e.clientX, e.clientY);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!center.current) return;
    emitMove(e.clientX, e.clientY);
  };

  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!center.current) return;
    center.current = null;
    setKnob({ x: 0, y: 0 });
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    hudBridge()?.emit({ type: 'combat:moveEnd' });
    onHeldChange?.(false);
  };

  return (
    <div
      data-testid="hud-movepad"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      className={cn(
        'pointer-events-auto relative touch-none rounded-full border border-border-muted/60 bg-inset/40 select-none',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <div
        className="absolute rounded-full bg-fg/50"
        style={{
          width: knobSize,
          height: knobSize,
          left: '50%',
          top: '50%',
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
        }}
      />
    </div>
  );
}
