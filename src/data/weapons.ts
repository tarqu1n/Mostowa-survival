/**
 * Monster weapon catalogue — the SINGLE source of truth for weapon GAMEPLAY stats (damage + attack
 * cadence). A monster rolls one of its `EnemyDef.weaponPool` ids per spawn; the equipped weapon's
 * `damage` feeds `resolveMeleeAttack` and its `attackMs` gates the bite, so a knife bites ~2× as
 * often as a club. Unarmed monsters fall back to `UNARMED_BASE_DAMAGE` + `CONTACT_DAMAGE_COOLDOWN_MS`.
 *
 * Weapon ART (source image, grip pivot, draw z, integer scale) lives in the manifest
 * (tileset.ts `actors.enemy.weapons`), keyed by the SAME id — the art-vs-gameplay split the codebase
 * uses everywhere. No stat is duplicated there.
 */

import type { AttackShape } from './types';

export interface MonsterWeapon {
  id: string;
  name: string;
  /** Base damage fed into resolveMeleeAttack (before the target's armour/dodge). */
  damage: number;
  /** Minimum ms between this weapon's bites — the per-weapon contact cooldown (slow club vs fast knife). */
  attackMs: number;
  /**
   * Expressibility seam (plan 036, decision 2): the melee footprint this weapon *would* swing if
   * monsters ever got a directed attack. Type-only for now — the skeleton/boar contact-bite path is
   * a Chebyshev ≤1 proximity check against the player's body tiles, NOT a directed swing, so nothing
   * reads this field yet and no existing entry sets it. Future work wires it into a monster swing.
   */
  attackShape?: AttackShape;
}

export const MONSTER_WEAPONS: Record<string, MonsterWeapon> = {
  club: { id: 'club', name: 'Club', damage: 2, attackMs: 1500 }, // slow + heavy
  knife: { id: 'knife', name: 'Knife', damage: 1, attackMs: 750 }, // fast + light
};

/**
 * Player melee weapon catalogue — mirrors {@link MONSTER_WEAPONS}: the source of truth for a melee
 * weapon's GAMEPLAY stats (base `damage` + the `attackShape` its swing covers). `PlayerCharacter`
 * holds one equipped `MeleeWeapon` (undefined = unarmed) and resolves its shape/damage for the
 * attack (plan 036 Step 3 wires the consumer). Dev/test-only demo entries — NOT inventory or an
 * economy item; there's no equipment slot yet. Unarmed falls back to `UNARMED_MELEE_SHAPE` +
 * `UNARMED_BASE_DAMAGE` (config.ts).
 */
export interface MeleeWeapon {
  id: string;
  name: string;
  /** Base damage fed into resolveMeleeAttack (before the target's armour/dodge). */
  damage: number;
  /** The set of tiles this weapon's swing covers — see `AttackShape` / `attackTiles`. */
  attackShape: AttackShape;
}

export const MELEE_WEAPONS: Record<string, MeleeWeapon> = {
  spear: { id: 'spear', name: 'Spear', damage: 1, attackShape: { reach: 2, arc: 'line' } }, // long thrust
  cleaver: { id: 'cleaver', name: 'Cleaver', damage: 1, attackShape: { reach: 1, arc: 'wide' } }, // short swing
};
