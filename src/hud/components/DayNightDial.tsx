import { Sun, Moon } from 'lucide-react';
import { useHudStore } from '@/hud/store';

/**
 * Top-centre day/night dial (plan 046, Field Kit) — the DOM/React replacement for the passive
 * day/night readout + night-wave banner in the legacy Phaser `TopCenterControls`. A sun/moon sweeps a
 * ring driven by `time` (0..1 through the full day→night cycle), coloured amber by day and cold-blue
 * by night; a "Day N" label sits under it, and a NIGHT WAVE banner drops in while a wave is on (the
 * whole night phase — `waveInfo.active`, which the store derives from the phase). Passive readout, so
 * it stays click-through (`pointer-events:none`). Authored in 360×640 design px.
 */

const SIZE = 44;
const R = 18;
const W = 3;
const C = 2 * Math.PI * R;

export function DayNightDial() {
  const time = useHudStore((s) => s.time);
  const dayCount = useHudStore((s) => s.dayCount);
  const dayPhase = useHudStore((s) => s.dayPhase);
  const waveActive = useHudStore((s) => s.waveInfo.active);

  const t = Math.max(0, Math.min(1, time));
  const c = SIZE / 2;
  const tone = dayPhase === 'night' ? 'var(--color-selection)' : 'var(--color-gold)';
  // Marker angle: start at 12 o'clock and sweep clockwise with cycle progress.
  const angle = t * 2 * Math.PI - Math.PI / 2;
  const mx = c + R * Math.cos(angle);
  const my = c + R * Math.sin(angle);
  const Icon = dayPhase === 'night' ? Moon : Sun;

  return (
    <div
      className="absolute top-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5"
      style={{ pointerEvents: 'none' }}
      data-testid="hud-daynight"
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            cx={c}
            cy={c}
            r={R}
            fill="none"
            strokeWidth={W}
            style={{ stroke: 'var(--color-surface-3)' }}
          />
          <circle
            cx={c}
            cy={c}
            r={R}
            fill="none"
            strokeWidth={W}
            strokeLinecap="round"
            strokeDasharray={`${t * C} ${C}`}
            transform={`rotate(-90 ${c} ${c})`}
            style={{ stroke: tone }}
          />
          <circle cx={mx} cy={my} r={3.2} style={{ fill: tone }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: tone }}>
          <Icon size={13} strokeWidth={2.5} aria-hidden />
        </div>
      </div>
      <span
        className="font-mono uppercase leading-none tracking-wide"
        style={{ fontSize: 9, color: tone }}
      >
        Day {dayCount}
      </span>
      {waveActive && (
        <span
          className="rounded px-1.5 py-0.5 font-mono uppercase leading-none tracking-widest text-danger-fg"
          style={{
            fontSize: 8,
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-strong)',
          }}
        >
          Night Wave
        </span>
      )}
    </div>
  );
}
