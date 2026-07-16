import { useEffect, useRef, useState } from 'react';
import { cn } from '@/editor/lib/utils';

/**
 * A circular rotation dial with an editable degree readout in the middle. Drag anywhere on the wheel
 * to set the angle; type a number into the centre input to set it precisely (the wheel follows). Hold
 * Shift while dragging to snap to 15° steps.
 *
 * The angle convention matches Phaser's `setAngle` — 0° points up and increases CLOCKWISE — so the
 * indicator is WYSIWYG against the rotated sprite it drives. Values are normalised to `[0,360)`.
 *
 * Two callbacks split "live" from "committed" so the same widget serves both consumers:
 *  - `onChange` fires CONTINUOUSLY during a drag — use it for cheap, historyless view-state (the
 *    place-tool's `placeRotation`), where live tracking is free.
 *  - `onCommit` fires once at the END of a gesture (drag release / input blur / Enter) — use it for
 *    edits that push an undo entry (the Inspector's `updateDecor`/`updateNode`), so a whole drag is a
 *    single undoable command, mirroring how `NumberField` commits on blur rather than per keystroke.
 * `onCommit` falls back to `onChange` when omitted. The wheel renders from its own in-progress angle
 * while interacting, so the indicator tracks the pointer even when the parent doesn't write `value`
 * back live (the `onCommit`-only case).
 */

/** Clockwise-from-top angle (deg) of a point relative to a centre — matches the indicator geometry and
 *  Phaser's rotation direction. */
function angleFromPoint(cx: number, cy: number, px: number, py: number): number {
  const deg = (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function norm(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function RotationWheel({
  value,
  onChange,
  onCommit,
  size = 56,
  disabled = false,
  ariaLabel = 'Rotation',
  className,
}: {
  value: number;
  onChange?: (deg: number) => void;
  onCommit?: (deg: number) => void;
  size?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // In-progress drag angle — drives the render so the indicator tracks the pointer even when the
  // parent commits only on release. `null` when idle (render straight from `value`).
  const [dragAngle, setDragAngle] = useState<number | null>(null);
  // Local text draft so mid-typing (e.g. "-" or "12") isn't clobbered by the rounded prop; resynced
  // from `value` whenever the input isn't focused (drag, undo, external edit).
  const [draft, setDraft] = useState(String(Math.round(norm(value))));
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(Math.round(norm(value))));
  }, [value]);

  const commit = onCommit ?? onChange;

  const angleAt = (e: React.PointerEvent, snap: boolean): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const a = angleFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      e.clientX,
      e.clientY,
    );
    return snap ? norm(Math.round(a / 15) * 15) : a;
  };

  const commitInput = (): void => {
    const n = Number(draft);
    if (Number.isFinite(n)) commit?.(norm(n));
    setDraft(String(Math.round(norm(Number.isFinite(n) ? n : value))));
  };

  // Displayed angle: the live drag angle while dragging, else the controlled `value`.
  const a = dragAngle ?? norm(value);
  const rad = (a * Math.PI) / 180;
  const R = 40;
  const knobX = 50 + R * Math.sin(rad);
  const knobY = 50 - R * Math.cos(rad);

  return (
    <div
      className={cn('relative inline-flex shrink-0', disabled && 'opacity-40', className)}
      style={{ width: size, height: size }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        width={size}
        height={size}
        role="slider"
        aria-label={ariaLabel}
        aria-valuenow={Math.round(a)}
        aria-valuemin={0}
        aria-valuemax={360}
        className={cn(
          'touch-none select-none text-border-muted',
          disabled ? 'cursor-not-allowed' : dragAngle !== null ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const next = angleAt(e, e.shiftKey);
          if (next === null) return;
          setDragAngle(next);
          onChange?.(next);
        }}
        onPointerMove={(e) => {
          if (disabled || dragAngle === null) return;
          const next = angleAt(e, e.shiftKey);
          if (next === null) return;
          setDragAngle(next);
          onChange?.(next);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          if (dragAngle !== null) commit?.(dragAngle);
          setDragAngle(null);
        }}
        onPointerCancel={() => setDragAngle(null)}
      >
        {/* Track + cardinal ticks. */}
        <circle cx="50" cy="50" r="44" className="fill-inset stroke-current" strokeWidth="3" />
        {[0, 90, 180, 270].map((t) => {
          const tr = (t * Math.PI) / 180;
          return (
            <line
              key={t}
              x1={50 + 40 * Math.sin(tr)}
              y1={50 - 40 * Math.cos(tr)}
              x2={50 + 46 * Math.sin(tr)}
              y2={50 - 46 * Math.cos(tr)}
              className="stroke-current"
              strokeWidth="2"
              opacity={0.6}
            />
          );
        })}
        {/* Indicator: centre → knob, plus the knob dot, in gold. */}
        <line
          x1="50"
          y1="50"
          x2={knobX}
          y2={knobY}
          className="stroke-gold"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx={knobX} cy={knobY} r="7" className="fill-gold" />
        <circle cx="50" cy="50" r="3" className="fill-current" />
      </svg>
      {/* Editable degree readout, centred over the wheel. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={draft}
          aria-label={`${ariaLabel} degrees`}
          className={cn(
            'pointer-events-auto w-8 rounded-sm border-none bg-transparent text-center text-[0.75rem]',
            'font-medium tabular-nums text-fg-bright outline-none focus:bg-inset/80',
          )}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.-]/g, ''))}
          onFocus={(e) => e.target.select()}
          onBlur={commitInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'Escape') {
              setDraft(String(Math.round(norm(value))));
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
    </div>
  );
}
