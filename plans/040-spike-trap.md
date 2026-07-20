# Spike Trap — Trigger-Once Damage Tile, Re-Armed Each Morning

> Status: planned — run /execute-plan to begin. Self-contained: a bespoke **`TrapManager`** mirroring
> the existing `CampfireManager` — **no dependency on plan 037** (StructureManager / destructible walls).

## Summary

Add the roadmap's **one trap** (ROADMAP Step 3): a **spike trap** buildable placed by day that sits
**armed** on a walkable tile, **triggers once** when an enemy steps onto it (deals a hit, then goes
**spent**), and is **re-armed each morning** by a queued worker order (mirroring the campfire refuel
order) plus a player tap-to-rearm. It ships on the **already-proven build/blueprint path** the roadmap
points at, via a new **bespoke `TrapManager`** that copies the `CampfireManager` shape
(materialise / tick / reset-vs-destroy). The only cross-cutting change is turning the hardcoded
`materialiseBuildable` closure into a **tiny two-way dispatch** on `def.behavior` (campfire → CampfireManager,
trap → TrapManager). Numbers ship as **flagged placeholders** (damage / cost) for a later wave-tuning
pass; the wave (plan 038) is live, so the trap is validated against real wave pathing in tests but final
numeric tuning is out of scope here.

## Context & decisions

**Direction (ROADMAP.md / GAME-DESIGN.md):** ROADMAP Step 3 is "one trap", sequenced *after* the night
wave so it tunes against real wave pathing — the wave (plan 038) landed. The roadmap frames Step 3 as
reusing an existing capability ("walls already prove the build/blueprint path"); it does **not** call for
a StructureManager generalisation. GAME-DESIGN "Traps": traps are **multipliers on walls** (funnel the
wave into a kill-channel), **trigger-once + re-armed by a queued worker order each morning** (reuse the
`refuel` pattern), placed in the day phase at scarce cost. Owner decision 2026-07-20: **no separate
arena map — `the-moon` is the MVP map, evolved in place**; the trap is placed at runtime on it, exactly
like the campfire.

**Locked decisions (this planning session, incl. the 2026-07-20 critique resolution):**

1. **Bespoke `TrapManager` now — NOT built on plan 037.** 037 (StructureManager + behavior registry +
   destructible walls/gate) is **deferred and unlanded** — no `StructureManager.ts` exists and `wall`
   has no `behavior` field. Rather than block Step 3 behind that contested refactor, the trap ships as a
   second bespoke live-buildable manager mirroring `CampfireManager`, on the existing build path (roadmap
   intent). This is a **conscious, owner-approved deviation** from the architecture decision "generalise
   on buildable #2 with a `behavior` field" (`docs/decisions/architecture.md`): we defer that
   generalisation because abstracting from a *population of one* (campfire only) is premature — campfire
   **and** trap give two concrete examples for a later `StructureManager` to fold in (which is also 037's
   own critique #4 reasoning). **Record this deviation** in the architecture decisions log (Step 5 docs).
2. **Placeholder numbers, tuning deferred.** Trap damage and build cost are flagged placeholders in
   `config.ts`; final tuning against wave DPS is a later pass (out of scope). Pick sensible starters
   (damage that meaningfully hurts a skeleton but doesn't one-shot a boar; cost in the scarce range).
3. **Trigger = same-tile, trigger-once.** An **armed** trap fires when an enemy occupies its tile
   (exact `col`/`row` match — enemies key off a single feet tile, so this is deterministic under
   `step()`). One trigger = one damage application, then `armed=false` (spent). Not AoE, not cooldown,
   not always-on. The reserved `ObjectStats.activationRange` field (`types.ts:69`) stays unused this
   slice (noted for a future AoE trap).
4. **Flat damage, trap is the aggressor.** Apply flat `SPIKE_TRAP_DAMAGE` to the enemy via its existing
   `Character.takeDamage` (routing the normal kill path) — **not** `resolveMeleeAttack` (a trap has no
   `strength`/`dex`).
5. **`blocksPath:false`, not `baseOnly`.** Mobs must be able to walk *onto* the trap (that's how it
   fires), so it never joins BuildManager's `occupied`/`walls` set. It is **not** `baseOnly` — it lines
   the funnel. (Aside: plan 039, which would make `baseOnly` = the lit radius, is **also only planned,
   not landed**; `baseOnly` today is still the fixed base rect. The trap isn't `baseOnly` either way, so
   this is non-load-bearing — just don't assume 039's behaviour.)
6. **Re-arm is a queued worker order + a dawn auto-enqueue.** Mirror `refuel` end-to-end for a new
   `rearm` action. "Each morning" = the **night→`'day'`** transition on `time:changed` (there is no
   separate `dawn` phase — `DayPhase` is only `'day'|'night'`). Re-arm **cost is a placeholder**: MVP
   re-arms for **worker-time only (no resource)**, flagged for tuning. Tapping a **spent** trap also
   queues a manual `rearm`.

**Key files & patterns to mirror (from repo sweep):**

- **Buildable data:** `src/data/buildables.ts` — `campfire` (`:22-37`) is the live-buildable template.
  `BuildableDef extends ObjectStats` (`types.ts:115-140`) — set `behavior:'trap'`, `blocksPath:false`,
  `cost`, `animKey`, placeholder `maxHp`. The `behavior` field is the live-vs-static discriminant.
- **Manager to mirror:** `src/scenes/world/CampfireManager.ts` — copy the shape wholesale for `TrapManager`:
  `materialise(site)` (`:91-140`), per-frame `tick(delta)` (`:159-170`), tap seam, and the **`reset()`
  (runtime, destroys sprites) vs `destroy()` (shutdown, drops refs only)** discipline (`:63-69`, `:337`,
  `:355`) — the "fx-teardown pattern" (`docs/CONVENTIONS.md:96-104`). Narrow deps object of closures
  (`CampfireManagerDeps` `:37-40` = just `spend`); no manager↔manager coupling (scene mediates).
  `TrapUnit` runtime record mirrors `CampfireUnit` (`src/entities/types.ts:64-80`).
- **The dispatch to generalise (minimally):** `materialiseBuildable: (site) => this.campfireManager.materialise(site)`
  (`GameScene.ts:392`) is hardcoded to campfire. Change to a **two-way dispatch on `BUILDABLES[site.buildableId].behavior`**
  (`'trap'` → `trapManager`, else `campfireManager`). This is the *only* shared-surface edit — a
  deliberate mini-step short of 037's full registry.
- **Enemy-on-tile query (trigger seam):** `EnemyManager.enemyAt(col,row)` (`:136-143`) /
  `enemiesInTiles(tiles)` (`:149-157`) exist — the trap `tick` queries these, then `enemy.takeDamage(...)`
  → normal kill path (`EnemyManager.killEnemy` `:198-212`). TrapManager gets a narrow dep closure for
  this, wired in `GameScene` (mirror campfire `spend`).
- **Refuel → rearm order:** `src/systems/tasks.ts:7-11` `Action` union (add `rearm` carrying `{trapId}`).
  Clone the six refuel touchpoints in `GameScene.ts`: `ScenePicker.actionAt`
  (`src/scenes/input/ScenePicker.ts:60-65`), `enqueue`+`isRefuelQueued`/`toggleRefuel`
  (`:888-931`), `beginCurrent` refuel branch (`:839-857`), dispatch switch (`:745-746`), `runRefuel`
  executor (`:1006-1023`, **condition-terminates** when armed — like "topped up"), `describeActionTarget`
  (`:243-248`). Structure lookup via `trapManager.trapById` (mirror `campfireById`).
- **Dawn hook:** `time:changed` `phase==='day'` transition — precedent `WaveDirector.onTimeChanged`
  (`src/scenes/world/WaveDirector.ts:95-98`), subscribed in `GameScene.wireBus` with a SHUTDOWN `off`.
  On the night→day edge, auto-enqueue a `rearm` per spent trap (new **system-initiated** worker order —
  verify it composes with player `build`/`refuel`/`rearm` queueing: append, don't clobber the active order).
- **Art (cross-pack):** the spike sheets are `craftpix-dungeon` (not the active `pixel-crawler`), loaded
  the cross-pack way the boar uses via a `pack` field (`tileset.ts:143`). Assets under
  `public/assets/tilesets/craftpix-dungeon/Traps/Spikes/` (`1..4`, ~192×32 animated extend/retract).
  `resolveTile`/`TileSource` (`tileset.ts:36`,`:574`); animated buildables use manifest `stations.*`
  StripAnims + key helpers (campfire flame `applyFlame` sheet-swap precedent).
- **Test/scenario API:** `src/scenes/testApi.ts` — place via `finishSite(createBlueprint(c,r,'spike_trap'))`
  then read back `trapManager.all()`; scenario `enemies` accept `{at,...}` to script an enemy onto the
  trap tile; the live wave is drivable via **`beginWave()`** (`:406-408`) for the roadmap acceptance test;
  `step(ms)` (`:351-360`) deterministic. Fire-seam precedents `damageFire`/`beginWave` (`:397-408`).
  **`DebugState`** (`:37-89`): append `traps: {col,row,armed}[]` **at the END** + serializer (`:434-487`);
  update `testApi.ts` + `tests/e2e/harness.ts` + the `refactor-tripwire` golden **together** (deliberate
  bump). Config consts (`config.ts`, placeholders): `SPIKE_TRAP_DAMAGE`, `SPIKE_TRAP_COST`, trigger-anim
  timing.

## Steps

- [ ] **Step 1: Curate the spike-trap art** `[inline]`
  - Visually review the CraftPix spike candidates and pin the sprite + frame slicing before any rendering
    code. Prefer the repo's sheet-preview path (check `docs/README.md` art-pipeline + `scripts/` for a
    contact-sheet/previewer; the guppi widget-shots harness is a *separate* repo — do not use it),
    otherwise `Read` the PNGs directly under `public/assets/tilesets/craftpix-dungeon/Traps/Spikes/`.
  - Decide and **record** (see Docs): (a) which spike variant (`1..4`); (b) the exact **frame slicing** —
    frame width/count and which frames are **armed-idle / trigger (extend) / spent (retracted or
    blood-stained idle)**; cross-check catalog `regions`/`frames` and pack `tileSize` 16 (sheets ~192×32).
  - Side effects: none (no code). Independent of the other steps — can be done first.
  - Docs: record the spike → file mapping + frame slicing in a small art-decisions note (under
    `docs/decisions/` or the art section from `docs/README.md`). This is the single source Steps 2–3 read
    exact paths/frames from.
  - Done when: the note names the exact spike sprite file with verified armed/trigger/spent frame
    slicing — enough that Step 2 needs no further art judgement.

- [ ] **Step 2: `spike_trap` buildable + bespoke `TrapManager`** `[inline]`
  - Add `spike_trap` to `src/data/buildables.ts`: `behavior:'trap'`, `blocksPath:false`, **not**
    `baseOnly`, `cost` = placeholder `SPIKE_TRAP_COST` (scarce range, e.g. `{wood:5}` — flag for tuning),
    placeholder `maxHp`, `animKey` + art refs for the spike sprite chosen in Step 1.
  - Register the cross-pack CraftPix spike art (boar `pack`-field precedent, `tileset.ts:143`): manifest
    StripAnim entries + key helpers mirroring the campfire flame, using the Step 1 frame slicing. Ensure
    **PreloadScene** loads the new sheet(s).
  - Add `src/scenes/world/TrapManager.ts` mirroring `CampfireManager` (owns `traps: TrapUnit[]` + `nextId`;
    `materialise(site)` builds sprites and sets `armed=true` on the armed-idle frame; `tick(delta)` stub
    for now; `trapById(id)`; `all()`; **`reset()`/`destroy()` discipline copied verbatim**; narrow deps
    closure for the enemy query Step 3 needs). `TrapUnit` = `{id,col,row,sprite,armed}` (mirror `CampfireUnit`).
  - Construct `TrapManager` in `GameScene.buildWorld()` (alongside `campfireManager`); call
    `trapManager.tick(delta)` from `GameScene.update` (above the no-action early-return, like campfire);
    wire the SHUTDOWN teardown. Change `materialiseBuildable` (`GameScene.ts:392`) to the **two-way
    dispatch on `def.behavior`** described above.
  - Add `SPIKE_TRAP_DAMAGE`, `SPIKE_TRAP_COST`, trigger-anim timing to `config.ts` under a "Trap tuning
    (placeholder — tune vs wave)" comment block.
  - Side effects: `src/data/tileset.ts` manifest; `PreloadScene` asset list; `GameScene.buildWorld`/`update`/
    SHUTDOWN wiring; `finishSite` behavior route (trap takes the live route, stays **off** `occupied`
    because `blocksPath:false`); build palette (trap appears in BUILD — confirm a non-blocking buildable
    places/affords correctly).
  - Docs: `docs/STATUS.md` (trap buildable + TrapManager landed); reference Step 1's art note.
  - Done when: selecting `spike_trap` in BUILD and placing it by day builds a spike sprite standing
    **armed** on a walkable tile (enemies/player path across it); a scenario can read the trap's `armed`
    state; campfire still builds/lights/refuels identically (dispatch regression); `npm run smoke` green.

- [ ] **Step 3: Trigger — armed trap damages an enemy on its tile, then spent** `[inline]`
  - In `TrapManager.tick(delta)`: for each **armed** trap, query the enemy-tile seam (`EnemyManager.enemyAt`,
    via the injected dep) for an enemy on the trap's tile; on a hit → play the **trigger (extend)** anim,
    apply flat `SPIKE_TRAP_DAMAGE` via `enemy.takeDamage` (normal kill path), set `armed=false`, settle on
    the **spent** frame. One trigger = one hit (no re-fire while spent). Deterministic under `step()`.
  - Side effects: `EnemyManager` — reuse `enemyAt`/`enemiesInTiles` (already exist); damage/kill path.
  - Docs: `docs/STATUS.md` (trap trigger live).
  - Done when: Tier-2 scenario — place a trap, script an enemy onto its tile, `step()` → enemy `hp` drops
    by `SPIKE_TRAP_DAMAGE` and the trap `armed` flips to `false` (assert both); a second enemy on a spent
    trap takes no damage.

- [ ] **Step 4: Re-arm — `rearm` worker order + tap-to-rearm + dawn auto-enqueue** `[inline]`
  - Extend `src/systems/tasks.ts` `Action` union with `rearm` carrying `{trapId}`. Clone the `refuel`
    touchpoints in `GameScene.ts`: `enqueue` + `isRearmQueued`/`toggleRearm` de-dupe; `beginCurrent`
    rearm branch (resolve trap via `trapManager.trapById`, condition-abort if already armed, else
    `reachableAdjacent` stand tile + `pathTo`); dispatch switch → `runRearm`; `runRearm` executor that
    **condition-terminates** when `armed=true` (like refuel "topped up"); `describeActionTarget` label.
    Re-arm consumes **no resource** for MVP (worker-time only — flagged placeholder per decision #6).
  - `ScenePicker.actionAt`: a tap on a **spent** trap resolves to `{kind:'rearm', trapId}`; an armed
    trap's tap is a no-op (guard like the campfire pick, though trap tiles are walkable).
  - **Dawn hook:** subscribe the trap system to `time:changed` (mirror `WaveDirector.onTimeChanged`, with
    a SHUTDOWN `off` in `wireBus`); on the night→`'day'` edge, auto-enqueue a `rearm` for every **spent**
    trap (system-initiated). Confirm it appends to (doesn't clobber) any pending player order.
  - Side effects: `tasks.ts` union; `GameScene` dispatch + `describeActionTarget`; `ScenePicker`;
    `wireBus` subscription + teardown; system-initiated vs player-queue interaction.
  - Docs: `docs/STATUS.md`; note the daily re-arm loop is live and that this is the first
    **system-initiated** worker order.
  - Done when: Tier-2 scenario — trigger a trap (spent), then `setDayPhase('night')`→`setDayPhase('day')`
    (or `step()` across the edge) → a `rearm` auto-enqueues → the worker walks over and re-arms it →
    `armed=true`. Separately: tapping a spent trap queues a `rearm` that re-arms it.

- [ ] **Step 5: Scenario API, `DebugState`, tests (incl. live wave), tripwire & docs** `[inline]`
  - `testApi.ts`: add a scenario spec `traps` field (place via `finishSite(createBlueprint(c,r,'spike_trap'))`,
    optional `armed` seed); append a `DebugState` `traps: {col,row,armed}[]` field **at the END** of the
    interface + serializer (`:434-487`); update `tests/e2e/harness.ts` + the `refactor-tripwire` golden
    **together** (intentional bump). Consider a `rearmTrap(index)` DEV seam mirroring `feedCampfire`/`damageFire`.
  - Tests: Tier-1 for any new pure logic (e.g. a same-tile trigger predicate if extracted); Tier-2
    scenarios from Steps 3–4 in `tests/e2e/spike-trap.spec.ts`. **Add the roadmap acceptance scenario:**
    place a trap on the wave's path, drive the **live wave** via `beginWave()`, `step()` to dawn, assert
    the trap damaged wave mobs (the roadmap's "run wave, assert trap damage" — not just a scripted single
    enemy). Confirm `npm run smoke`.
  - Docs: `docs/ROADMAP.md` — mark **Step 3 (one trap) delivered**, numeric tuning deferred;
    `docs/STATUS.md` full entry; `docs/decisions/architecture.md` — record the **conscious deferral** of
    the StructureManager generalisation (decision #1: campfire + trap are two bespoke managers on
    purpose; generalise later against both); CLAUDE.md Status line if warranted. **Do not** trim plan 037
    yet — it's still deferred/unsettled; leave a one-line note in 037 that the trap shipped separately via
    040 so a future StructureManager folds in TrapManager too.
  - Side effects: the tripwire golden is the main gotcha — bump it deliberately, not reflexively.
  - Done when: all three tiers green (Vitest units, Playwright scenarios incl. the live-wave scenario, boot
    canary) and the tripwire passes against the intentionally-updated golden.

## Out of scope

- **The StructureManager / behavior-registry generalisation, destructible walls, and the gate** — plan
  037's territory, deferred. This plan ships a bespoke `TrapManager` instead; the generalisation folds
  both it and `CampfireManager` in later (against two real examples).
- **Trimming / renumbering plan 037** — 037 is still deferred and its final shape is unsettled; only a
  one-line cross-reference note is added (Step 5). No front-loaded edits against a moving target.
- **Final numeric tuning** — trap damage, build cost, re-arm cost/economy vs wave DPS and funnel width;
  a later pass once the trap is felt against the live wave.
- **Re-arm resource cost** — MVP re-arms for worker-time only; a material cost is a tuning decision.
- **AoE / multi-tile traps** (the reserved `activationRange`), cooldown/always-on traps, and other trap
  types (snare/bear trap, bait/lure, fire trap, barrel, lightning, Archer turret) — assets exist but only
  the single-tile spike trap ships now.
- **Authored (map-file) trap placement** — traps are runtime-placed only, like the campfire; no new map
  object kind.
- **Line-paint trap placement UX** (mobile) and **crafting-station gating** of the trap buildable.

## Critique

> Independent fresh-eyes review (critique-plan), 2026-07-20. **Resolved** — the plan above was revised in
> response; recorded here for traceability.

**Verdict (of the *pre-revision* plan):** Well-researched and correctly scoped to the roadmap's "one
trap," but *blocked and built on sand* — it hard-depended on plans 037 and 039, neither of which has
landed; 037 is deferred with an unresolved critique.

| # | Finding | Lens | Severity | Resolution |
| - | ------- | ---- | -------- | ---------- |
| 1 | Core prerequisite (037 StructureManager + destructible `PlacedStructure`) doesn't exist; 037 deferred/unsettled — plan not executable as written. | Dependency risk | **High** | **Resolved** — dropped the 037 dependency; bespoke `TrapManager` instead (decision #1). |
| 2 | Roadmap Step 3 reuses the proven build path; 040 hard-coupled it to the contested 037 refactor rather than a bespoke live-buildable like `CampfireManager`. | Alternatives / roadmap fit | **High** | **Resolved** — owner chose the lighter `TrapManager` path; StructureManager generalisation consciously deferred to fold in both managers later. |
| 3 | Claimed plan 039 "has landed" — it's only planned (no STATUS entry). | Factual framing | Medium | **Resolved** — decision #5 corrected; trap isn't `baseOnly`, non-load-bearing. |
| 4 | Roadmap acceptance is "run wave, assert trap damage"; original tests only scripted a single enemy, never the live `WaveDirector`. | Test genuineness | Medium | **Resolved** — Step 5 adds a live-wave (`beginWave()`) acceptance scenario. |
| 5 | "Trim 037 Steps 7–8" assumed 037's current numbering; 037 is being split/resequenced. | Cross-plan coordination | Medium | **Resolved** — Step 5 now only adds a one-line cross-ref to 037; no front-loaded trim (Out of scope). |
| 6 | Dawn auto-enqueue is the first system-initiated worker order (new pattern). | Consistency | Low | Flagged in decision #6 / Step 4 — verify composition with the player queue at execution. |
