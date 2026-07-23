import { Heart, Beef, Flame, TreePine, Mountain, type LucideIcon } from 'lucide-react';
import { HUNGER_LOW_FRACTION } from '@/config';
import { useHudStore } from '@/hud/store';

/**
 * Top-left survival meters (plan 046, Field Kit) — the DOM/React replacement for the legacy Phaser
 * `HudBars`. HP / food / fire render as circular rings; the shared base-supply pool shows as
 * wood/rock counts below them. Passive readout (no interactive controls), so it stays click-through
 * (`pointer-events:none`) — the root overlay is already, but the cluster is positioned absolutely so
 * it also reads correctly when mounted on its own for review. Authored in 360×640 design px.
 *
 * "Red only at threshold" mirrors the legacy danger tints (`UIScene.updateHealthBar` /
 * `updateHungerBar`): HP/food ring turns to the danger colour ONLY below its low cutoff. The fire
 * ring is HIDDEN entirely when there is no hearth (`fire === null`), warm while lit, danger when out
 * (fuel knocked to 0 — dark, not a loss). TREND (rising/falling tick) is deliberately OMITTED: the
 * store carries no value history and adding one is out of scope for this step.
 */

/** HP danger cutoff — the legacy `UIScene.updateHealthBar` uses an inline `ratio <= 0.3`. */
const HP_LOW_FRACTION = 0.3;

const RING_SIZE = 36;
const RING_R = 14;
const RING_W = 3.5;
const RING_C = 2 * Math.PI * RING_R;

/** A single circular meter: a dim track plus a value-proportional arc (starting at 12 o'clock), with
 *  the icon + rounded value centred inside. `tone` is a CSS colour (a palette `var(--color-*)`). */
function Ring({
  icon: Icon,
  value,
  ratio,
  tone,
}: {
  icon: LucideIcon;
  value: string;
  ratio: number;
  tone: string;
}) {
  const filled = Math.max(0, Math.min(1, ratio)) * RING_C;
  const c = RING_SIZE / 2;
  return (
    <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        <circle
          cx={c}
          cy={c}
          r={RING_R}
          fill="none"
          strokeWidth={RING_W}
          style={{ stroke: 'var(--color-surface-3)' }}
        />
        <circle
          cx={c}
          cy={c}
          r={RING_R}
          fill="none"
          strokeWidth={RING_W}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${RING_C}`}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ stroke: tone }}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-px"
        style={{ color: tone }}
      >
        <Icon size={11} strokeWidth={2.5} aria-hidden />
        <span className="font-mono leading-none" style={{ fontSize: 8 }}>
          {value}
        </span>
      </div>
    </div>
  );
}

export function MeterBars() {
  const hp = useHudStore((s) => s.hp);
  const maxHp = useHudStore((s) => s.maxHp);
  const hunger = useHudStore((s) => s.hunger);
  const maxHunger = useHudStore((s) => s.maxHunger);
  const fire = useHudStore((s) => s.fire);
  const supply = useHudStore((s) => s.supply);
  // Eat feedback (`needs:fed`): a monotonic nonce + the hunger gained. `key`ing the pop wrapper and the
  // "+N" float on the nonce remounts them each eat, replaying their CSS animations (hud.css).
  const fedNonce = useHudStore((s) => s.fedNonce);
  const fedAmount = useHudStore((s) => s.fedAmount);

  const hpRatio = maxHp > 0 ? hp / maxHp : 0;
  const foodRatio = maxHunger > 0 ? hunger / maxHunger : 0;
  const hpTone = hpRatio <= HP_LOW_FRACTION ? 'var(--color-danger)' : 'var(--color-ok-border)';
  const foodTone = foodRatio <= HUNGER_LOW_FRACTION ? 'var(--color-danger)' : 'var(--color-gold)';

  return (
    <div
      className="absolute left-3 top-6 flex flex-col gap-1.5"
      style={{ pointerEvents: 'none' }}
      data-testid="hud-meterbars"
    >
      <div className="flex gap-1.5">
        <Ring icon={Heart} value={`${Math.round(hp)}`} ratio={hpRatio} tone={hpTone} />
        {/* Hunger ring with the eat feedback overlay: a quick scale "pop" of the ring and a green "+N"
            floating up, both replayed on each eat by keying on fedNonce (see hud.css keyframes). */}
        <div className="relative">
          <div key={`fed-pop-${fedNonce}`} className={fedNonce > 0 ? 'hud-fed-pop' : undefined}>
            <Ring icon={Beef} value={`${Math.round(hunger)}`} ratio={foodRatio} tone={foodTone} />
          </div>
          {fedNonce > 0 && (
            <span
              key={`fed-float-${fedNonce}`}
              data-testid="hud-fed-float"
              className="hud-fed-float absolute font-mono font-bold"
              style={{ left: '50%', top: -2, fontSize: 9, color: 'var(--color-ok-border)' }}
            >
              +{fedAmount}
            </span>
          )}
        </div>
        {/* Fire ring hidden entirely when no hearth exists (mirrors HudBars.onFireChanged(null)). */}
        {fire && (
          <Ring
            icon={Flame}
            value={`${Math.round(fire.fuel)}`}
            ratio={fire.maxFuel > 0 ? fire.fuel / fire.maxFuel : 0}
            tone={fire.lit ? 'var(--color-warm)' : 'var(--color-danger)'}
          />
        )}
      </div>
      {/* Base-supply pool counts (plan 042) — mirrors the legacy HudBars WOOD/ROCK readout. The
          ResourceChips cluster also surfaces wood/rock top-right; that intentional overlap is
          reconciled at integration (Step 9), not here. */}
      <div className="flex gap-2 font-mono text-fg-dim" style={{ fontSize: 8 }}>
        <span className="inline-flex items-center gap-0.5">
          <TreePine size={9} aria-hidden />
          {supply.wood}
        </span>
        <span className="inline-flex items-center gap-0.5">
          <Mountain size={9} aria-hidden />
          {supply.rock}
        </span>
      </div>
    </div>
  );
}
