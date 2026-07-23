import { useEffect, useState } from 'react';
import Phaser from 'phaser';
import { BASE_WIDTH } from '@/config';

/**
 * Live geometry of the Phaser canvas as it sits on screen, in viewport CSS pixels. The DOM HUD
 * floats over a `Scale.FIT` canvas that is letterboxed + centered in `#game`, so its on-screen
 * position and size shift with the window. This lets the overlay position a design-space layer
 * exactly over the canvas and map the fixed 360×640 authoring units → CSS px.
 */
export interface CanvasRect {
  /** Canvas top-left, viewport CSS px (from getBoundingClientRect). */
  readonly left: number;
  readonly top: number;
  /** Canvas rendered size, CSS px. */
  readonly width: number;
  readonly height: number;
  /**
   * CSS px per design px. Uniform: FIT preserves the BASE_WIDTH:BASE_HEIGHT aspect, so the x and y
   * scale are equal — one factor maps a 360×640 layer onto the canvas.
   */
  readonly scale: number;
}

interface WindowWithGame {
  game?: Phaser.Game;
}

/** Measure the canvas rect, or null while the game/canvas isn't ready or has zero size. */
function measure(): CanvasRect | null {
  if (typeof window === 'undefined') return null;
  const canvas = (window as unknown as WindowWithGame).game?.scale?.canvas;
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    scale: r.width / BASE_WIDTH,
  };
}

/**
 * Track the canvas rect, resubscribing on Phaser's RESIZE (fires on every FIT recompute) plus the
 * DOM signals that move the canvas without a RESIZE (window resize, orientation change, mobile
 * URL-bar show/hide via visualViewport). Guards the boot window when `window.game` is absent: polls
 * on rAF until the first successful measure, then leans on events.
 */
export function useCanvasRect(): CanvasRect | null {
  const [rect, setRect] = useState<CanvasRect | null>(() => measure());

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const next = measure();
      if (next) setRect(next);
      return next;
    };

    // Boot poll: keep measuring on rAF until the canvas exists, then stop (events take over).
    const poll = () => {
      if (!update()) raf = requestAnimationFrame(poll);
    };
    poll();

    const game = (window as unknown as WindowWithGame).game;
    game?.scale.on(Phaser.Scale.Events.RESIZE, update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);

    return () => {
      cancelAnimationFrame(raf);
      game?.scale.off(Phaser.Scale.Events.RESIZE, update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return rect;
}
