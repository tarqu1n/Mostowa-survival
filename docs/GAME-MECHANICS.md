# Game Mechanics — tuned numbers & flows

The gameplay-mechanics reference: what the systems *do* and the numbers they run on. History lives in
[STATUS.md](STATUS.md), rationale in [DECISIONS.md](DECISIONS.md) — this doc is the terse "how it
actually works" index, updated as mechanics land or their tuning changes.

## Buildables & build flow

Palette (BUILD button) → `buildManager.select(id)` enters build mode for that buildable → place a
ghost (gated by `tilePlaceable`: bounds/occupancy/reachability, plus the base-zone check for
`baseOnly` buildables) → cost is spent from the inventory **at placement**, not completion → a worker
`build` task runs over `BUILD_MS` → `finishSite` materialises the result, branching on
`def.behavior`: a *static* buildable (no `behavior` — the wall) becomes a static tile; a *live*
buildable (`behavior` set — the campfire) hands off to its runtime manager (`CampfireManager`) to
create the simulated sprite. (`behavior` is the live-vs-static discriminant; `animKey` is purely
visual — see [DECISIONS.md](DECISIONS.md) "generalise buildable runtime on buildable #2".) Buildables
are defined in [src/data/buildables.ts](../src/data/buildables.ts) (`BuildableDef`,
[src/data/types.ts](../src/data/types.ts)).

## Campfire

Cost **10 stone + 10 wood**; placeable **base-zone only**; **always burning once built** — drains fuel
continuously, day and night. Fuel max **120**, burns **1/s** (⇒ a full tank lasts ~120s, short of a
full day/night cycle — deliberate upkeep pressure), **+30 fuel per wood** fed (⇒ 4 wood refuels an
empty fire), starts full. Light + vision radius **8 tiles**. Blocks its tile like a wall. **Tap the
fire to feed 1 wood** (command mode only) — relights/refuels; goes dark at 0 fuel. All numbers are
`CAMPFIRE_FUEL_MAX`/`CAMPFIRE_FUEL_BURN_PER_SEC`/`CAMPFIRE_FUEL_PER_WOOD` in
[src/config.ts](../src/config.ts). Owned at runtime by
[src/scenes/world/CampfireManager.ts](../src/scenes/world/CampfireManager.ts) (sprite, fuel tick,
tap-to-feed); pure fuel math (`drainFuel`/`feedFuel`/`isLit`) in
[src/systems/campfire.ts](../src/systems/campfire.ts).

## Base zone

A fixed rectangle, `BASE_ZONE` (tile bounds) in [src/config.ts](../src/config.ts) — **placeholder**,
expected to be replaced by a dynamic/claimed base later. Checked via `isInBase(col, row)` in
[src/systems/base.ts](../src/systems/base.ts); gates any `baseOnly` buildable's placement.

## Light/night interaction

Lit campfires cut inverted-mask holes in the night overlay
([src/scenes/world/SurvivalClock.ts](../src/scenes/world/SurvivalClock.ts)) and extend the vision
reveal ([src/scenes/fx/VisionController.ts](../src/scenes/fx/VisionController.ts)) — both fed by one
scene-mediated `lightSources()` closure over `CampfireManager` (behavior-neutral seam, so future light
emitters aggregate in without either consumer changing; no manager↔manager edge). Enemies are
**not** fog-gated yet (deferred to the night-waves plan) — the reveal is purely the night-overlay hole
making near-fire content readable, not a stealth mechanic. Mask technique (inverted geometry mask +
baked textures, no shader): [RENDERING.md](RENDERING.md).
