# Basic Combat: Combat Mode, Punch, First Zombie, Stats Inspector

> Status: planned — run /execute-plan to begin.

## Summary

First combat slice. Adds a player-toggled **Combat mode** (virtual movepad + a Punch button,
direct real-time control) that coexists with the existing tap-to-command mode; a **shared stats
model** so trees, walls, zombies, and the player all expose a common "inspectable" shape; a
**dedicated Inspect mode** (tap anything to see its stats); and the **first real enemy** — a kid
zombie wired in from the already-staged tileset, with just enough AI (idle → chase → contact
damage) to be a live target. Punch deals a flat 1 damage to start; everything else about combat
numbers is tuned by feel later, not specified here.

This is the seam GAME-DESIGN.md's "Night: a short timed wave of a couple of roaming/attacking
zombies" (MVP slice item 4) plugs into, and reuses the worker/task/pathfinding core exactly as
CLAUDE.md's Status note anticipated ("the seam the NPC companions plug into" — a zombie unit is
architecturally the same kind of thing).

## Context & decisions

**Scaffold to build on:**

- `src/scenes/GameScene.ts` — owns the player `Sprite` (Arcade body), the unified pointer gate
  (`onPointerDown`/`onPointerMove`/`onPointerUp`, `GameScene.ts:397-479`), `actionAt()`
  (`:482-485`, currently a binary tree-hit-else-move fallthrough), `advancePath()`/`physics.moveTo`
  waypoint movement, `trees: TreeNode[]` and `sites: BuildSite[]` runtime arrays.
- `src/data/types.ts` / `src/data/nodes.ts` — the established **static def + scene-local runtime
  wrapper** pattern: `ResourceNodeDef` (pure catalog data: id/name/maxHp/...) is embedded by
  reference inside a scene-local `TreeNode { sprite, def, hp, alive, col, row }`; `chop()` mutates
  `hp`/`alive` on the instance, never the def. `BuildableDef`/`BuildSite` follow the same split
  (no HP on walls yet — confirmed, see below).
- `src/scenes/UIScene.ts` — parallel HUD scene; talks to `GameScene` via `this.game.events`
  (e.g. `build:toggle`/`build:modeChanged`, `tasks:cancel`/`tasks:changed`) plus the Phaser
  `registry` for shared state (`inventory`, `zoom`). New buttons follow the existing template:
  `Rectangle` + `Text`, `setInteractive({ useHandCursor: true })`, push into `this.hudElements` so
  `hudHitTest()` excludes them from world taps, listeners torn down on `SHUTDOWN`.
- `src/systems/{tasks,pathfind,grid}.ts` — confirmed Phaser-free/pure. `grid.ts`: `TILE_SIZE=16`,
  `worldToTile`/`tileToWorldCenter`/`snapToTileCenter`/`tileKey`.
- `src/data/tileset.ts` — `TilesetManifest.actors.player: string[]` is a flat walk-frame list; no
  per-direction frames exist for the player (single reused walk anim, idle = frame 0). The staged
  zombie tileset's `kid-zombie-animation-frames/` and `damaged-kid-zombie-animation-frames/`
  (`public/assets/tilesets/zombie-apocalypse/sprites/`) each have 9 frames, same shape as the
  player's walk/damaged sets — one cycle per state, not per-direction.
- `scripts/smoke.mjs` — headless Playwright driver against `npm run preview`; taps HUD/world
  coordinates via `toClient`/`worldToClient`, asserts on `window.game` state. Extend this rather
  than inventing a second test mechanism.
- `src/config.ts` — tunables live here (`TILE_SIZE`, `INTERACT_RANGE`, `CHOP_INTERVAL_MS`, `COLORS`,
  etc.). Add new combat tunables here, not inline magic numbers.

**Direction** (CLAUDE.md / GAME-DESIGN.md / DECISIONS.md): mobile-first touch, data-driven catalogs,
systems decoupled from Phaser, UI decoupled via `UIScene`, trunk-based on `master`. GAME-DESIGN.md's
"Enemy design" section specs **roaming (won't attack unless aggro'd) vs attacking** as the long-term
target — this slice deliberately implements only a minimal slice of that (see Out of scope).

**Decisions locked with the user for this slice:**

- **Three mutually-exclusive input modes**, one HUD toggle pair: **Command** (default — today's
  tap-to-pathfind/harvest/build, unchanged), **Combat** (movepad bottom-right drives the player
  directly, bypassing the pathfinder; action buttons bottom-left, starting with one **Punch**
  button), **Inspect** (tap anything to see its stats panel instead of issuing a command). Only
  one non-Command mode is active at a time; toggling one off returns to Command, toggling the
  other switches directly without needing to pass through Command.
- **Facing direction** is a new tracked concept (the player has none today): store `lastFacing:
  {dCol, dRow}` on the player, updated from the last nonzero movepad vector in Combat mode or the
  last move direction in Command mode. Punch acts on the tile at `playerTile() + lastFacing`. No
  new directional art needed — this is gameplay-only, sprite stays the single reused frame/anim.
- **Punch**: flat **1 damage**, single facing-adjacent tile, no range/arc beyond that. Only affects
  zombies (does not double as a harvest tool — trees keep using the existing chop action).
- **Tap-on-entity semantics**: resolved via the dedicated Inspect mode above — Command-mode tap
  behaviour for trees/build-sites/empty-tiles is **unchanged**; Inspect mode is the only way to
  view a stats panel.
- **Inspectable object scope**: trees and walls (build sites), no new placeholder crate/box entity
  this slice. Walls currently have **no HP/durability field at all** (`BuildSite` only tracks
  `progress`/`done`) — this slice adds a `maxHp`/durability-style stat to `BuildableDef` purely so
  the wall has something to display in its stats panel. This is **not** the "wall HP/damage from
  combat" mechanic plan 002 deferred — walls remain indestructible in combat this slice; only the
  *display* stat is added now as forward-compatible scaffolding.
- **Shared stats model**: rather than forcing `ResourceNodeDef`/`BuildableDef`/new `EnemyDef`/player
  into one deep class hierarchy (they're structurally quite different), use a small common
  **`InspectableStats`** shape (`{ name: string; maxHp: number; currentHp?: number; extra?:
  { label: string; value: string }[] }`) plus one adapter function per entity kind
  (`treeStats(node)`, `wallStats(site)`, `zombieStats(unit)`, `playerStats()`) that normalizes each
  existing runtime shape into it. This avoids a premature abstraction across four different existing
  patterns while still giving the panel one uniform thing to render.
- **Player HP**: no player HP exists today. This slice adds a minimal `playerHp`/`playerMaxHp` on
  `GameScene` so zombie contact damage has somewhere to go and the stats panel has something to show
  for the player. **Death/respawn handling is a stub, not a design**: if `playerHp` hits 0, clamp at
  0, log it, and reset to `playerMaxHp` at the player's current position (no game-over screen, no
  penalty) — full death/respawn design is an explicit open question for a later slice, don't expand
  it here.
- **Zombie AI (minimal, not the full roaming/aggro model)**: one state machine, two states —
  `idle` (stationary, does nothing) and `chasing` (re-pathfinds toward the player's current tile
  via `systems/pathfind.ts` every ~300ms and walks it via the same `physics.moveTo` waypoint
  approach `advancePath()` uses, not a new movement system). Transitions: `idle → chasing` when the
  player comes within an `AGGRO_RADIUS` tile distance (new `config.ts` constant); no `chasing →
  idle` deaggro this slice (full roaming/aggro nuance is explicitly deferred). While `chasing` and
  adjacent to the player, deals `def.contactDamage` to `playerHp` on a cooldown (new
  `CONTACT_DAMAGE_COOLDOWN_MS` constant, e.g. 1000ms) rather than every frame.
- **First zombie**: the **kid zombie** (weakest/simplest — lowest `maxHp`, e.g. 3, matching the
  tree's `maxHp: 3` so Punch-at-1-damage takes 3 hits, mirroring the chop feel). Exactly one zombie
  instance spawns for this slice (a fixed test position on the map) — wave-spawning is out of scope.

## Steps

- [ ] **Step 1: Shared stats shape + EnemyDef catalog** `[inline]`
  - In `src/data/types.ts`, add:
    ```ts
    export interface InspectableStats {
      name: string;
      maxHp: number;
      currentHp?: number;
      extra?: { label: string; value: string }[];
    }
    export interface EnemyDef {
      id: string;
      name: string;
      maxHp: number;
      contactDamage: number;
      moveSpeed: number;      // px/s, mirrors GameScene's existing `this.speed` convention
      color: number;          // placeholder tint until the real sprite is wired (Step 2)
    }
    ```
    Add a matching `maxHp: number` (durability-for-display only, see Context) to the existing
    `BuildableDef` interface — check its current fields first and slot it in consistently with
    `cost`/`color`.
  - Create `src/data/enemies.ts` mirroring `src/data/nodes.ts`'s exact style (header comment,
    `Record<string, EnemyDef>` keyed catalog):
    ```ts
    export const ENEMIES: Record<string, EnemyDef> = {
      kidZombie: { id: 'kidZombie', name: 'Kid Zombie', maxHp: 3, contactDamage: 1, moveSpeed: 45, color: 0x6b8f3e },
    };
    ```
    (`moveSpeed: 45` ≈ half the player's `this.speed = 90` — a chaseable-but-outrunnable pace; fine
    to adjust by feel, it's a placeholder like everything else in this slice.)
  - In `src/data/buildables.ts`, add the new `maxHp` field to the existing `wall` entry with a
    reasonable placeholder value (e.g. `maxHp: 10`).
  - Side effects: `BuildableDef`'s new field is additive (existing consumers of `BUILDABLES.wall`
    that only read `.cost`/`.color` are unaffected), but grep for any exhaustive object-literal
    typing of `BuildableDef` elsewhere that might now warn/error on a missing field.
  - Docs: none (internal data model, covered by the Step 8 doc pass).
  - Done when: `npm run build` type-checks with the new fields/file in place and no other file
    needs changes yet (nothing consumes them until later steps).

- [ ] **Step 2: Wire the kid zombie tileset entry** `[delegate]`
  - In `src/data/tileset.ts`, extend `TilesetManifest`'s `actors` shape to add zombie frame lists
    alongside the existing `player: string[]`, e.g. `kidZombie: string[]` (walk cycle, the 9 files
    in `public/assets/tilesets/zombie-apocalypse/sprites/kid-zombie-animation-frames/`) and
    `kidZombieDamaged: string[]` (the 9 files in
    `.../sprites/damaged-kid-zombie-animation-frames/`). Populate `ZOMBIE_APOCALYPSE_TILESET`'s
    `actors` with both arrays, each entry a path relative to
    `public/assets/tilesets/zombie-apocalypse/sprites/`, in filename-sorted order (mirror exactly
    how `actors.player`'s 9 entries are listed — same folder-then-sequential-filename style).
  - Add zombie equivalents of the existing `playerFrameKey` helper (check its exact name/signature
    around `tileset.ts:61-64` and mirror it 1:1, e.g. `kidZombieFrameKey(i)` /
    `kidZombieDamagedFrameKey(i)`), and equivalents of however `PreloadScene`/wherever
    `ACTIVE_TILESET.actors.player` frames get `this.load.image()`'d and turned into a Phaser
    animation (`GameScene.ts:115-122` builds `'player-walk'` — find where those images are loaded,
    likely `PreloadScene.ts`, and add the same for the zombie's two frame sets, naming the anims
    `'kid-zombie-walk'` and `'kid-zombie-damaged'`).
  - Side effects: preload adds ~18 more small image loads; check `PreloadScene.ts`'s loading-bar
    logic (if any) isn't hardcoded to an expected asset count.
  - Docs: none.
  - Done when: `npm run dev`, open the browser console, confirm no 404s for the new asset paths and
    that `this.anims.get('kid-zombie-walk')` / `'kid-zombie-damaged'` exist (inspectable via
    `window.game.anims` in devtools). The zombie doesn't need to be on-screen yet — that's Step 4.

- [ ] **Step 3: Player facing + player HP** `[inline]`
  - In `GameScene.ts`, add a `lastFacing: { dCol: number; dRow: number }` field on the scene
    (defaulting to a sensible direction, e.g. `{ dCol: 0, dRow: 1 }` facing down), updated:
    - In Combat mode, from the movepad's current nonzero vector each frame it's active (this step
      just adds the field/update-hook; Step 5 wires the actual movepad input that feeds it).
    - In Command/pathfind movement, from the sign of the current waypoint delta each time
      `advancePath()` picks a new waypoint (whatever the existing per-waypoint direction already is
      — don't recompute, just capture it).
  - Add `playerHp: number` / `playerMaxHp: number` (e.g. `playerMaxHp = 10`, matching a new
    `config.ts` constant `PLAYER_MAX_HP`) to `GameScene`, plus a `damagePlayer(amount: number)`
    method: `playerHp = Math.max(0, playerHp - amount)`; if it hits 0, `console.log` a placeholder
    message (e.g. `'[stub] player down — resetting HP'`) and reset `playerHp = playerMaxHp` (no
    position/state changes beyond HP — the player stays wherever they are). Emit a
    `player:hpChanged` event (`this.game.events.emit('player:hpChanged', { hp: playerHp, maxHp:
    playerMaxHp })`) whenever `playerHp` changes, following the existing `tasks:changed`/
    `build:modeChanged` event-emit convention.
  - Add `PLAYER_MAX_HP` to `src/config.ts` next to the other tunables, with a one-line comment.
  - Side effects: none yet — nothing calls `damagePlayer` or reads `lastFacing` until Steps 4-6.
  - Docs: none.
  - Done when: `npm run build` passes; a manual `window.game.scene.getScene('Game').damagePlayer(1)`
    in devtools console logs the emitted event (check via a temporary `game.events.on('player:hpChanged', console.log)`
    in devtools) and clamps/resets correctly at 0.

- [ ] **Step 4: Zombie runtime unit + minimal chase/contact-damage AI** `[inline]`
  - In `GameScene.ts`, add a scene-local `interface ZombieUnit { id: string; sprite:
    Phaser.GameObjects.Sprite; def: EnemyDef; hp: number; alive: boolean; col: number; row: number;
    state: 'idle' | 'chasing'; lastContactAt: number; lastRepathAt: number; path: {col:number;
    row:number}[] }`, mirroring `TreeNode`'s shape/placement exactly. Add a `zombies: ZombieUnit[]`
    array (mirrors `trees`).
  - Spawn exactly one `kidZombie` instance at scene creation, at a fixed test tile a few tiles from
    the player's start position (pick any currently-walkable, unobstructed tile — check `occupied`/
    tree placement to avoid overlap), `hp: ENEMIES.kidZombie.maxHp`, `state: 'idle'`, sprite textured
    with `kidZombieFrameKey(0)` from Step 2, playing `'kid-zombie-walk'` only while actually moving
    (mirror `updatePlayerAnim`'s velocity-gated play/stop pattern) and forcing frame 0 at rest.
  - Add a per-frame (or throttled) update step for each live zombie: compute tile distance to the
    player; if `state === 'idle'` and within `AGGRO_RADIUS` (new `config.ts` constant, e.g. `5`),
    set `state = 'chasing'`. If `'chasing'`: if adjacent to the player (tile distance ≤ 1) and
    `now - lastContactAt >= CONTACT_DAMAGE_COOLDOWN_MS` (new `config.ts` constant, e.g. `1000`),
    call `damagePlayer(def.contactDamage)` and update `lastContactAt`; else, if `now -
    lastRepathAt >= 300`, recompute a path to the player's current tile via `systems/pathfind.ts`'s
    existing A* function (same one `GameScene` already calls for the worker) and advance the zombie
    toward the next waypoint using the same `physics.moveTo`-based waypoint approach `advancePath()`
    uses for the player (extract/duplicate the minimal piece needed — don't force a shared function
    if the existing code isn't already factored for reuse, but do check first whether it's easy to
    parameterize `advancePath`-style logic to take an arbitrary sprite+path instead of assuming
    `this.player`).
  - Side effects: the zombie sprite needs its own physics body separate from the player's; check
    collision/overlap setup doesn't need new Arcade colliders for this slice (contact damage this
    slice is tile-distance-based, not physics-overlap-based, to keep it simple).
  - Docs: none.
  - Done when: loading the game shows the kid zombie sprite on the map; walking the player within
    `AGGRO_RADIUS` tiles makes it start moving toward the player; standing adjacent for a few seconds
    visibly ticks `playerHp` down (checkable via the Step 3 devtools listener) at the cooldown rate,
    not every frame.

- [ ] **Step 5: Punch action** `[inline]`
  - In `GameScene.ts`, add a `punch()` method: compute the facing tile
    (`playerTile() + lastFacing`, using `systems/grid.ts` helpers), find a live zombie in
    `zombies` occupying that tile (mirror how `treeAt()` hit-tests, but by tile-equality against
    `zombie.col`/`row` rather than a world-space rect), and if found: `zombie.hp -= 1` (flat, per
    the locked decision — not `def`-driven yet, hardcode the `1` with a comment noting it's the
    intentionally-unbalanced starting value); if `zombie.hp <= 0`, set `alive = false`, destroy its
    sprite, and remove it from `zombies` (mirror however `chop()`'s felling/removal works for
    consistency, including whether felled trees leave a stump — a dead zombie can just be removed
    outright, no zombie-stump equivalent needed).
  - Wire `punch()` to fire on a `combat:punch` event (emitted by the Combat-mode Punch button —
    built in Step 6) via `this.game.events.on('combat:punch', () => this.punch())` in the scene's
    event-wiring section (mirror where `build:toggle`/`tasks:cancel` listeners are already
    registered).
  - Side effects: none beyond the `zombies` array mutation already covered.
  - Docs: none.
  - Done when: with the Step 6 Punch button in place, tapping it while facing the zombie reduces its
    HP by 1 per press, and it disappears after 3 punches (matching `maxHp: 3`). Until Step 6 exists,
    this is verifiable by manually emitting the event from devtools:
    `window.game.events.emit('combat:punch')`.

- [ ] **Step 6: Combat mode — HUD toggle, movepad, Punch button** `[inline]`
  - In `UIScene.ts`, add a small mode-toggle control (two icon-style buttons or a single
    cycle-button — match whatever's visually simplest given the existing HUD button template) that
    tracks a local `mode: 'command' | 'combat' | 'inspect'` and emits `mode:combatToggle` /
    `mode:inspectToggle` on press (toggling that mode on flips the other off if it was active —
    mutually exclusive, per the locked decision). `GameScene` listens for these, updates its own
    mode state, and emits `mode:changed` with the resulting mode back to `UIScene` so the HUD (this
    step) and the Inspect panel (Step 7) can react to the authoritative mode.
  - When `mode === 'combat'`: show a virtual movepad in the bottom-right (a fixed circular base +
    draggable knob, standard mobile-joystick pattern — `pointerdown`/`pointermove`/`pointerup`
    scoped to a HUD zone already excluded from world-tap handling via `hudHitTest`/`hudElements`)
    emitting `combat:move` with a normalized `{dx, dy}` vector on drag and `combat:moveEnd` on
    release, and a Punch button bottom-left (same Rectangle+Text template as other HUD buttons)
    emitting `combat:punch` on tap. Hide both when leaving Combat mode.
  - In `GameScene.ts`, listen for `combat:move`: while in Combat mode, directly set the player
    body's velocity from the vector (scaled by `this.speed`) instead of going through
    `advancePath()`/the task queue, and update `lastFacing` (Step 3) from the vector whenever it's
    nonzero; `combat:moveEnd` zeroes velocity. Ensure entering Combat mode doesn't fight with an
    in-flight Command-mode task (e.g. clear/pause the current `TaskQueue` action on entering Combat
    mode — simplest correct behavior: treat it like the existing Cancel action).
  - Side effects: check the existing pinch-zoom/pan gesture handling in `onPointerDown`/`Move`/`Up`
    doesn't fire while a finger is on the movepad or Punch button (should already be excluded via
    `hudHitTest`, but verify — the movepad's drag shouldn't be mistaken for the world-pan drag
    threshold logic).
  - Docs: none.
  - Done when: toggling Combat mode shows the movepad+Punch button and hides on toggle-off;
    dragging the movepad moves the player directly (visibly not path-following); tapping Punch while
    facing the zombie damages it (ties together Step 5).

- [ ] **Step 7: Inspect mode — stats panel + tap routing** `[inline]`
  - Write the four adapter functions from the locked "shared stats model" decision (probably
    colocated in `src/data/types.ts` or a new small `src/systems/stats.ts` if that reads cleaner —
    use judgement, keep them simple pure functions, no new class hierarchy):
    `treeStats(node: TreeNode): InspectableStats`, `wallStats(site: BuildSite): InspectableStats`,
    `zombieStats(unit: ZombieUnit): InspectableStats`, `playerStats(hp: number, maxHp: number):
    InspectableStats`. Each just maps existing fields into the common shape (e.g.
    `zombieStats` → `{ name: unit.def.name, maxHp: unit.def.maxHp, currentHp: unit.hp }`).
  - In `GameScene.ts`'s pointer-up handling (`actionAt()` / around `GameScene.ts:482-485`), add an
    early branch: if `mode === 'inspect'`, hit-test the tapped point against zombies (by tile),
    then trees (`treeAt`, already exists), then build sites, in that priority order (closest-thing-
    wins is fine, but pick zombie-first since they're the newest/most interesting), and if a hit is
    found, emit `inspect:show` with that entity's adapted `InspectableStats`; if the tap hits empty
    ground, do nothing (no panel, no command — Inspect mode issues no commands at all, per the
    locked decision). Skip the existing tree/move fallthrough entirely while in Inspect mode.
  - In `UIScene.ts`, listen for `inspect:show` and render a simple panel (a `Rectangle` + `Text`
    block is enough — name, HP or `currentHp/maxHp`, any `extra` rows) positioned somewhere it
    won't collide with the mode-toggle/movepad zones; add it to `hudElements` while visible so a tap
    dismissing it doesn't leak through as a world tap. Dismiss on tapping the panel itself (emit
    `inspect:hide`) or on tapping anywhere else while it's open (simplest: any subsequent tap while
    a panel is open closes it rather than opening a new one, unless that tap is itself on another
    inspectable entity — use judgement, don't over-build this).
  - Side effects: confirm Command-mode tap behavior (tree/build-site/move) is provably untouched —
    the new branch must be a strict `mode === 'inspect'` gate at the very top of the existing
    handler, not interleaved with it.
  - Docs: none.
  - Done when: toggling Inspect mode and tapping the zombie, a tree, or a wall each shows a stats
    panel with that entity's name + HP; tapping empty ground shows nothing; toggling back to
    Command mode restores today's exact tap behavior (verify chop/build/move all still work).

- [ ] **Step 8: Smoke test coverage + docs** `[delegate]`
  - Extend `scripts/smoke.mjs` (mirror its existing style — `toClient`/`worldToClient` helpers,
    `ok`/`fail` assertions, drives the real page) to add a combat pass: toggle Combat mode, tap the
    movepad to walk toward the zombie's fixed spawn tile, tap Punch three times facing it, assert
    (via `window.game` state — however `zombies`/`playerHp` end up exposed for inspection, e.g. a
    debug getter on the scene mirroring however `trees`/`inventory` are currently exposed to the
    smoke script) that the zombie is gone after 3 punches; separately assert standing adjacent long
    enough ticks `playerHp` down and it resets at 0 rather than going negative; toggle Inspect mode
    and tap the tree/wall/zombie(if still alive)/spawn a fresh one if needed, asserting a stats
    panel appears with expected fields. Keep assertions loose on exact pixel positions/timing the
    same way the existing chop/build assertions already tolerate.
  - Update docs:
    - `CLAUDE.md` Status section: note Combat mode + Punch + the first zombie + Inspect mode landed
      (plan 003), same terse style as the existing plan 001/002 summary sentence.
    - `docs/GAME-DESIGN.md`: mark MVP slice item 4 ("Night: a short timed wave...") as partially
      done — the punch/zombie/contact-damage piece exists, wave-spawning/day-night tint/traps still
      todo — and add a short note under "Enemy design" that the roaming/aggro model here is
      deliberately a minimal stub (idle/chasing only), full nuance still to design.
    - `docs/DECISIONS.md`: append dated `[DECIDED]` entries for the mode-toggle model (Command/
      Combat/Inspect, mutually exclusive), the tap-on-entity resolution (dedicated Inspect mode,
      not tap/long-press overload), the object-inspection scope (trees + walls, no new crate), and
      the shared-stats-via-adapters approach (vs. a deep class hierarchy) — mirror the existing
      terse `## YYYY-MM-DD — [DECIDED] Title` + one-paragraph-rationale format exactly.
    - `docs/ASSETS.md`: note the kid zombie is now wired in from the staged tileset (walk +
      damaged-reaction frames), still placeholder-tinted rather than fully styled.
  - Side effects: none beyond the files touched.
  - Docs: this step *is* the doc pass — see above.
  - Done when: `npm run build && npm run preview` in one terminal, `npm run smoke` in another,
    all assertions pass including the new combat ones; all four doc files updated.

## Out of scope

- Ranged weapons/ammo (pistol/shotgun), and any weapon-switching UI.
- NPC companions actually fighting, or existing at all as a second friendly unit.
- Traps, base-defense placement, and the full night-wave spawner/pacing/day-night tint.
- Full roaming-vs-attacking nuance from GAME-DESIGN.md (noise-based aggro, deaggro, pack-pulling,
  multiple enemy types beyond the one kid zombie, wandering-while-idle) — this slice's AI is
  intentionally just idle/chasing on a radius check.
- Wall HP/damage *from combat* (breaching, zombies attacking walls) — only a static display stat
  is added to `BuildableDef` this slice; walls remain indestructible in play.
- Real player death/respawn design (game-over state, penalties, position reset) — the HP-hits-0
  behavior added here is an explicit placeholder stub.
- Directional player/zombie sprites or animations — facing is gameplay-logic-only this slice.
- New placeholder crate/box entity — inspectable objects are trees + walls only.
- Damage numbers/floating combat text, sound effects, hit-flash VFX, screen shake — purely
  functional combat this slice, juice comes later.
