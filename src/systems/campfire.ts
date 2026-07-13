/**
 * Campfire fuel math — pure helpers (no Phaser), mirroring systems/needs.ts (hunger). A campfire
 * burns continuously once built: fuel drains every frame, and the fire is "lit" while any fuel
 * remains. Feeding wood tops the tank back up. The actual numbers (max / burn rate / per-wood) live
 * in config.ts (CAMPFIRE_* constants) and are passed in by the caller — these helpers only clamp.
 * See docs/GAME-MECHANICS.md.
 */

/** Fuel remaining after `deltaMs` of burn at `burnPerSec`, clamped at 0 (never negative). */
export function drainFuel(fuel: number, deltaMs: number, burnPerSec: number): number {
  return Math.max(0, fuel - (deltaMs / 1000) * burnPerSec);
}

/** Fuel after feeding one unit of wood worth `perWood`, clamped at `max`. */
export function feedFuel(fuel: number, perWood: number, max: number): number {
  return Math.min(max, fuel + perWood);
}

/** A campfire is lit while it has any fuel left. */
export function isLit(fuel: number): boolean {
  return fuel > 0;
}
