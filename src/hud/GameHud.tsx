import { useEffect, useRef } from 'react';
import {
  BASE_WIDTH,
  BASE_HEIGHT,
  DAMAGE_VIGNETTE_ALPHA,
  DAMAGE_VIGNETTE_MS,
  DAMAGE_VIGNETTE_COLOR,
  HUNGER_VIGNETTE_COLOR,
  HUNGER_VIGNETTE_MAX_ALPHA,
  HUNGER_LOW_FRACTION,
} from '@/config';
import { useCanvasRect } from './hooks/useCanvasRect';
import type { CanvasRect } from './hooks/useCanvasRect';
import { useBridge } from './hooks/useBridge';
import { useHudStore } from './store';
import { MeterBars } from './components/MeterBars';
import { DayNightDial } from './components/DayNightDial';
import { ResourceChips } from './components/ResourceChips';

/** `0xRRGGBB` (config colour) → a CSS hex string. The vignette configs are shared with the (now
 *  retired) Phaser bake, which stored them as numbers. */
const cssHex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Root of the DOM/React HUD overlay (plan 046, Field Kit). Lives at the page level over the Phaser
 * canvas (mounted into #hud-root by main.tsx), NOT inside any Phaser scene — it persists across
 * GameScene death→restart. The root itself is click-through (pointer-events:none, set on #hud-root
 * in index.html); interactive controls opt back in as they are added.
 *
 * Layering:
 *  - `Vignettes` — full-canvas-rect screen effect (damage flash + starving tint), NOT design-scaled.
 *  - `.hud-design` — positioned over the live canvas rect and CSS-scaled so children author in fixed
 *    360×640 design units (same space Phaser draws in).
 *  - `.hud-safe` — an inset sublayer carrying `env(safe-area-inset-*)` for interactive clusters.
 *    Holds the top cluster (Step 9): MeterBars (top-left), DayNightDial (top-centre), ResourceChips
 *    (top-right). Each self-positions absolutely, so they only need a positioned ancestor.
 */
export function GameHud() {
  useBridge();
  const rect = useCanvasRect();

  // Until the canvas is measured, render nothing positioned — avoids a flash at the wrong place.
  if (!rect) return null;

  return (
    <div className="hud-root" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <Vignettes rect={rect} />

      <div
        className="hud-design"
        style={{
          position: 'absolute',
          left: rect.left,
          top: rect.top,
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
          transform: `scale(${rect.scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        {/* Interactive-safe sublayer: everything tappable lives inside these safe-area insets. */}
        <div
          className="hud-safe"
          style={{
            position: 'absolute',
            inset: 0,
            paddingTop: 'env(safe-area-inset-top)',
            paddingRight: 'env(safe-area-inset-right)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
          }}
        >
          <MeterBars />
          <DayNightDial />
          <ResourceChips />
        </div>
      </div>
    </div>
  );
}

/**
 * Screen-edge vignettes (plan 046 Step 9) — the DOM replacement for the two Phaser vignette images.
 * A red DAMAGE flash pulsed on each `player:hit` (the store's monotonic `hitNonce`) and a steady
 * yellow STARVING tint ramping in as hunger drops below `HUNGER_LOW_FRACTION`. Covers the live canvas
 * rect (a screen effect, so NOT inside the design-scaled layer); always click-through.
 */
function Vignettes({ rect }: { rect: CanvasRect }) {
  const hitNonce = useHudStore((s) => s.hitNonce);
  const hunger = useHudStore((s) => s.hunger);
  const maxHunger = useHudStore((s) => s.maxHunger);
  const damageRef = useRef<HTMLDivElement>(null);

  // Pulse the damage flash on each hit: snap to peak then fade to 0. The Web Animations API gives the
  // instant-rise-then-ease-out the old Cubic.easeIn tween did, and a fresh call restarts it cleanly on
  // back-to-back hits (fill:none → opacity returns to the element's base 0 when it ends). Skip nonce 0
  // (initial mount) so the HUD doesn't flash on load.
  useEffect(() => {
    if (hitNonce === 0 || !damageRef.current) return;
    const anim = damageRef.current.animate([{ opacity: DAMAGE_VIGNETTE_ALPHA }, { opacity: 0 }], {
      duration: DAMAGE_VIGNETTE_MS,
      easing: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
    });
    return () => anim.cancel();
  }, [hitNonce]);

  const ratio = maxHunger > 0 ? hunger / maxHunger : 1;
  const hungerAlpha =
    ratio < HUNGER_LOW_FRACTION ? HUNGER_VIGNETTE_MAX_ALPHA * (1 - ratio / HUNGER_LOW_FRACTION) : 0;

  const layer: React.CSSProperties = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    pointerEvents: 'none',
  };

  return (
    <>
      <div
        data-testid="hud-vignette-hunger"
        style={{
          ...layer,
          opacity: hungerAlpha,
          transition: 'opacity 300ms linear',
          background: `radial-gradient(ellipse at center, transparent 55%, ${cssHex(HUNGER_VIGNETTE_COLOR)} 115%)`,
        }}
      />
      <div
        ref={damageRef}
        data-testid="hud-vignette-damage"
        style={{
          ...layer,
          opacity: 0,
          background: `radial-gradient(ellipse at center, transparent 50%, ${cssHex(DAMAGE_VIGNETTE_COLOR)} 115%)`,
        }}
      />
    </>
  );
}
