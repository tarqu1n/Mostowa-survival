# The Night Wave + Loop-Close

> Status: planned — run /execute-plan to begin.

## Summary

Build the MVP's **first playable loop** (roadmap Step 2): night falls → a paced wave of skeletons
comes from the map edge → they path to and **attack the campfire (the fire-heart) and the player** →
you defend to dawn → **day N+1** arrives a little harder. **Lose** = the fire is knocked out **or** the
player dies. This is the riskiest unbuilt piece and the earliest "feel the loop" milestone. It reuses
the existing seams almost entirely — the day/night clock + `time:changed` event, `CampfireManager` +
`lightSources()`, the `MonsterCharacter`/`EnemyManager` FSM + `addEnemy`, and the existing
death→`scene.restart()` path — and adds a **`WaveDirector`** scheduler over them plus two genuinely new
pieces: **fire integrity** (attackable fire + loss) and **objective-target enemy AI** (path to the fire,
not just the player).

**Milestones** (natural stopping points / split candidates): **A — Fire-heart** (Steps 1–3): the fire
becomes an attackable, losable target with retuned fuel and a light-radius claim — testable with a
scripted enemy, no wave needed. **B — The wave loop** (Steps 4–6): night-triggered paced spawns +
objective AI + loop-close/escalation — the playable loop. **C — Surface & harness** (Steps 7–8): dev
force-wave hook, HUD, scenario API + tests. Milestone A is a clean point to peel into its own plan if
preferred.

## Context & decisions

**Direction:** `docs/ROADMAP.md` Step 2 (operational spec) + `docs/GAME-DESIGN.md` "The night wave —
shape" (`:220-250`) and "Base claim — the campfire heart" (`:344-372`, settled `docs/decisions/gameplay.md:175-190`,
[DECIDED] 2026-07-19). GAME-DESIGN closing line (`:249-250`): *"the same FSM + spawn system, spawning
attackers-from-treeline on a paced schedule tied to the night phase, with the existing radius aggro
doing the roaming-pull for free."* — i.e. the wave is **a paced scheduler over existing spawn/AI**, not
new combat.

**Locked decisions (planning defaults — recorded for execution):**

1. **Fire loss = instant.** Fire knocked out → immediate loss (roadmap's lean for MVP clarity). No
   claw-back/relight-to-recover this slice.
2. **Fire integrity = a separate meter** on the campfire, distinct from fuel. Mob attacks drain
   integrity; **fuel** still drives light radius / claim (existing). Two failure routes into one loss:
   **integrity ≤ 0** (attacked out) **or** the fire fully unlit via fuel starvation. Integrity is *not*
   the inert `maxHp:20` (that stays Inspect-only) — add a real `integrity` field.
3. **Spawn source = code-side edge rule** (spawn along the map perimeter, biased to a direction — the
   "wood-facing" edge), no map authoring. Authored treeline markers are post-MVP (no marker/point entity
   exists today — `MapObject` is only node/decor/portal; zones are unused and the-moon has none).
4. **Pacing = data-driven trickle→push→lull** over normalized night progress (`tNorm` from
   `time:changed`), numbers placeholder/tunable. Escalation = a small **per-night** bump (count +
   composition), data-driven, progress-keyed (`gameplay.md:192`).
5. **Objective-target AI is built modestly generic** (fire-as-objective is its first consumer) so the
   deferred plan 037 (enemy-attacks-wall) reuses the same target seam. Budgeted as a **new FSM state**,
   not a target swap (per 037-critique lesson).
6. **Fuel retune, not cycle retune.** The cycle is already 15 min (`DAY_MS 660_000` + `NIGHT_MS 240_000`,
   `config.ts:336-338`); only the **campfire fuel** constants are stale (`config.ts:386-405`). Retune
   those.
7. **Scope = one plan, milestone A peelable.** Written as one night-wave plan with fire-heart as an
   independently-testable first milestone.

**Key files & patterns to mirror (from repo sweep):**

- **Clock + night hook:** `src/systems/daynight.ts` — `type DayPhase = 'day'|'night'` (`:14`, no
  dawn/dusk enum), `phaseAt` (`:22`), `cycleLengthMs` (`:17`), `dayCountForTotal` (`:52`).
  `src/scenes/world/SurvivalClock.ts` `tick` (`:139-157`) emits **`game.events.emit('time:changed',
  { phase, dayCount, cycleMs, tNorm })`** on phase/day change (`:151-156`) + sets `registry` `dayPhase`/
  `dayCount`. **Hook the wave on `time:changed`**: `phase==='night'` = wave starts; `phase==='day'` with
  incremented `dayCount` = night survived. `tNorm` gives night-progress for the pacing beats. (UIScene is
  the only current consumer, `:557`,`:975`; `GameScene.updateCombatActive` polls `registry` `dayPhase`
  at `:1182`.)
- **Campfire:** `src/scenes/world/CampfireManager.ts` — `materialise`/`tick(delta)` (`:144`),
  `lightSources()` (`:233`), `inLight(x,y)` (`:248`), `feedOne`/`feedAt`, `campfireById` (`:267`,
  "tolerates a fire destroyed mid-order — future destructible fires"). `CampfireUnit` tracks
  `fuel`/`lit`, not hp. Fuel consts + the stale-tuning comment: `config.ts:386-405`
  (`CAMPFIRE_FUEL_MAX=120`, `_BURN_PER_SEC=1`, `_PER_WOOD=30`, `_FEED_INTERVAL_MS=1000`,
  `_LIGHT_MIN_FRAC=0.4`). Fire `maxHp:20` inert (`buildables.ts:27`, comment `:8-9`).
- **Loss/restart (exists — reuse):** `GameScene.damagePlayer` (`:1003-1011`) → `killPlayer()`
  (`:1124-1131`) logs `"player down — restarting"` then `scene.restart()` after a death hold; `update()`
  freezes on `playerChar.dying` (`:648-651`). **New:** a `loseGame(reason)` both `killPlayer` and a
  fire-out check funnel into. No game-over screen — `scene.restart()` rebuilds via `create()`→`buildWorld()`.
- **Base claim:** `BASE_ZONE_SIZE={w:21,h:27}` (`config.ts:382`) around `SPAWN_TILE` (`:376`); pure math
  `systems/base.ts` (`isInBase`, `baseZoneFromSpawn`); **only consumer** = `BuildManager` — `baseZoneRect`
  (`BuildManager.ts:79`) gating `baseOnly` in `tilePlaceable` (`:143-144`). **No base-rect rendering.**
  Claim swap = replace `isInBase(baseZoneRect,…)` with a `CampfireManager.inLight`-style disc test.
  **Chicken-and-egg:** the first campfire is itself `baseOnly` — keep `BASE_ZONE` as the bootstrap claim
  until a hearth exists (GAME-DESIGN staging `:371-372`).
- **Vision (mostly free):** night = `SurvivalClock.nightOverlay` (`:93-118`) with an inverted mask
  punched per lit fire (redrawn each tick, `:220-224`); fog = `fx/VisionController.ts`. Both read
  `lightSources()` per-frame, so **a knocked-out fire → its disc vanishes → darkness re-floods that frame**
  (night mask re-closes; fog reveal is one-way). Enemy hide-in-dark gating is NOT built (deferred) — out
  of scope here.
- **Enemy spawn + AI:** `EnemyManager.spawnEnemies()` (`:102`, hard-codes one `kidZombie` — the
  skeleton-art enemy) called at `GameScene.ts:357`; the spawn primitive is `addEnemy(id,col,row,opts)`
  (`:106`). AI = pure FSM `stepMonster` (`src/systems/monsterAI.ts`), chase targets **player only**;
  `MonsterTickEnv` (`EnemyManager.ts:147`) carries only player targets + `damagePlayer`. Telegraphed
  wind-up/strike block (`MonsterCharacter.update:235,249-265`) reusable. Radius aggro pulls mobs to the
  player "for free" when near. Enemy ids in `src/data/enemies.ts`; monster weapons `src/data/weapons.ts`.
- **World-manager convention (for `WaveDirector`):** `src/scenes/world/*` — `constructor(scene, deps)`
  with `deps` a narrow closure interface (never manager↔manager direct; scene mediates — see
  `EnemyManagerDeps`/`CampfireManagerDeps`/`SurvivalClockDeps`); construct **side-effect-free** then a
  separate begin/hook; per-frame `tick(delta)` called from `GameScene.update` **above** the no-action
  early-return (`:655,:659`); `reset()` (runtime, may destroy sprites) vs `destroy()` (SHUTDOWN, drops
  refs only, clears `time` events — never pokes sprites), wired via `scene.events.once(SHUTDOWN,…)`.
  Construct the `WaveDirector` in `buildWorld()` **after** SurvivalClock (`:479`) since it closes over
  enemy+campfire+clock. Dev hooks in `wireBus()` (`:502-542`, mirror `debug:toggleTime` at `:508`).
- **HUD:** `UIScene.ts` — passive top-centre `timeText` `Day N [phase]` (`:313`, synced on `time:changed`
  `:975`); dev `GO NIGHT/GO DAY` button emits `debug:toggleTime` → `SurvivalClock.toggleDayNight` (**the
  existing "skip to night" hook** — extend to also force a wave). Fire-integrity bar mirrors the HP/hunger
  bar pattern; a night/wave indicator slots beside `timeText`.
- **Scenario/test API:** `testApi.ts` + `GameScene` `TestApi` (`:552-638`) — `setClockMs`/`setDayPhase`/
  `setDayCount` (`:308-318` region), `addEnemy`, `step(ms)` (deterministic 1/60s slices). **`DebugState`
  tripwire** (`testApi.ts:35-81`, serializer `:394`, `refactor-tripwire.spec.ts` golden): new fields
  **appended at END**, edited across `testApi.ts` + `tests/e2e/harness.ts` + the golden together. Three
  tiers: unit / scenario / boot canary (`docs/testing.md`).

## Steps

- [ ] **Step 1: Fire integrity + the loss funnel (fire-out OR player-dead)** `[inline]`
  - Add a real `integrity` (+`maxIntegrity`) field to the campfire runtime record (`CampfireUnit`) and a
    `CampfireManager.damageFire(id, amount)` seam that drains it (clamped ≥0), leaving `maxHp:20` untouched
    (still Inspect-only). Expose `isKnockedOut(unit)` = `integrity<=0 || (fully unlit via fuel starvation)`.
  - Add `GameScene.loseGame(reason: 'player'|'fire')` that runs the existing death→restart mechanism
    (`cancelAll()`, freeze, log a test-assertable signal e.g. `"game over (fire) — restarting"`, then
    `scene.restart()` after a hold). Refactor `killPlayer()` to funnel through `loseGame('player')`
    (preserve its existing `"player down — restarting"` log or route both signals). Add a per-tick check
    (CampfireManager or a small scene hook) — **all hearths knocked out → `loseGame('fire')`**.
  - Numbers are placeholder (e.g. integrity 100, tuned in Step 6/Milestone B once a wave hits it).
  - Side effects: `entities/types.ts` (`CampfireUnit`); `CampfireManager` (tick + new seam + reset paths);
    `GameScene.killPlayer`/`damagePlayer`; scenario reset must re-init integrity.
  - Docs: `docs/STATUS.md` (fire integrity + fire-out loss landed); note in `docs/decisions/gameplay.md`
    that integrity is a separate meter (decision #2).
  - Done when: Tier-2 scenario — script an enemy (or call `damageFire`) to drain integrity to 0 → the
    game-over/restart signal fires; and player death still restarts. Fuel-starvation-to-unlit also triggers
    the loss.

- [ ] **Step 2: Retune campfire fuel for the 15-min cycle** `[delegate]`
  - Data-only: retune `CAMPFIRE_FUEL_MAX` / `CAMPFIRE_FUEL_BURN_PER_SEC` / `CAMPFIRE_FUEL_PER_WOOD` in
    `config.ts:386-405` so a full tank lasts a meaningful fraction of a night (not ~13% of a cycle / ~7
    refuels), per the stale-tuning comment there. Aim: a fed fire comfortably survives a night with a
    couple of refuels; leave the exact feel-tuning flagged for Milestone B. Update the stale comment to
    reflect the 15-min cycle and the new intent.
  - Side effects: hunger drain carries the same stale comment (`config.ts:344-347`) but **`HUNGER_LETHAL`
    stays false** (roadmap Step 4) — do NOT flip hunger here; only note it.
  - Docs: the config comment itself; `docs/STATUS.md` line.
  - Done when: `npm run build`/tests green; a fire with a normal fuel load stays lit across a night in a
    scenario (assert `lit` at representative `cycleMs` points).

- [ ] **Step 3: Fire-heart placement claim (lit radius replaces the base rect)** `[inline]`
  - In `BuildManager.tilePlaceable` (`:143-144`), replace the `baseOnly` `isInBase(baseZoneRect,…)` gate
    with an "inside any lit hearth's radius" test (reuse the `CampfireManager.inLight`/`lightSources()`
    disc math via a threaded dep — do not create a manager↔manager edge). **Bootstrap:** keep
    `BASE_ZONE_SIZE` as the fallback claim while **no** lit hearth exists, so the first (baseOnly) campfire
    can still be placed; once a hearth is lit, the light-radius claim governs. Document the staging.
  - This is the peelable step — if descoped, `baseOnly` keeps using the rect and the wave loop still works.
  - Side effects: `BuildManager` (new dep for light-test + the bootstrap branch); confirm nothing else
    reads `baseZoneRect` for gameplay (sweep: only BuildManager does; `baseZoneTileRect` renderer never
    built).
  - Docs: `docs/decisions/gameplay.md` (mark staging (1) done); `docs/STATUS.md`.
  - Done when: Tier-2 scenario — with a lit hearth, a `baseOnly` buildable places only within the lit
    radius and is rejected outside it; with no hearth, the bootstrap rect still allows the first campfire.

- [ ] **Step 4: WaveDirector — night-triggered paced spawns from the edge** `[inline]`
  - New `src/scenes/world/WaveDirector.ts` following the world-manager convention (narrow `deps` closures:
    `spawnEnemy(id,col,row,opts)`→`enemyManager.addEnemy`, `dims()`, `enemies()`, `campfires()`/`lightSources()`,
    `dayContext()`; constructed after SurvivalClock in `buildWorld()`; `tick(delta)` above the no-action
    early-return; `reset()`/`destroy()` split; SHUTDOWN wiring). Subscribe to `time:changed`:
    `phase==='night'` → begin a wave; `phase==='day'` → end it (stop spawning; leftover mobs remain — the
    "lull is a trap").
  - **Spawn source:** a code-side **edge rule** — pick perimeter tiles of the loaded grid (`dims()`),
    biased to one direction (the "wood-facing" edge; pick a sensible default, e.g. the top/treeline side,
    constant + comment). Spawn `kidZombie` (skeleton) via `addEnemy`.
  - **Pacing:** a **data-driven schedule** expressing trickle→push→lull over night `tNorm` (from
    `time:changed`/clock). Encode as a small tunable table/curve (placeholder numbers). Use a tick
    accumulator (the `chopElapsed` idiom, `GameScene.ts:932-938`) or `scene.time` events cleared in
    `destroy()`.
  - Side effects: `GameScene.buildWorld` construct + `update` tick + `wireBus` (subscribe/off);
    `EnemyManager` (ensure `addEnemy` + `all()` suffice); guard against spawning during the death freeze.
  - Docs: `docs/STATUS.md` (WaveDirector); brief architecture note in `docs/CONVENTIONS.md` if the manager
    adds a new pattern (else skip).
  - Done when: Tier-2 scenario — `setDayPhase('night')`/`step` → skeletons appear from the biased edge on a
    paced cadence (assert spawn tiles on the perimeter + arrival spread over time), and no spawns during day.

- [ ] **Step 5: Objective-target enemy AI (path to & attack the fire)** `[inline]`
  - Extend `MonsterTickEnv` (`EnemyManager.ts:147`) with a generic **objective target** channel (nearest
    lit hearth position/id) + an `attackFire(id, dmg)` callback mirroring `damagePlayer`. Written generic
    (objective vs player) so plan 037 reuses the seam.
  - Add a new FSM behaviour in `monsterAI.stepMonster` / `MonsterCharacter.update`: a wave mob's default
    objective is the **fire** — path toward the nearest lit hearth and, on contact, **reuse the existing
    telegraphed wind-up/strike block** to call `attackFire` (→ `damageFire`, Step 1). Existing **radius
    aggro to the player** still preempts (a mob near the player fights the player — GAME-DESIGN's
    roaming-pull), then returns to the fire objective. Budget this as a real new state, not a swap.
  - Keep non-wave enemies (dev-spawned/scenario) behaving as today (player-targeting) — the objective is a
    per-enemy/opt-in property set by the WaveDirector spawn, not a global mode.
  - Side effects: `EnemyManager.update` env construction; `monsterAI` FSM + tests
    (`src/systems/__tests__/monsterAI*`); `MonsterCharacter`; the fire-out loss (Step 1) is now reachable
    by mobs.
  - Docs: `docs/STATUS.md`; note the objective-target seam is shared with plan 037.
  - Done when: Tier-2 scenario — a wave skeleton with no player nearby paths to the fire and attacks it
    (fire integrity drops); a skeleton near the player instead engages the player; both assertable via `step`.

- [ ] **Step 6: Loop-close + per-night escalation + tuning pass** `[inline]`
  - On `phase==='day'` with an incremented `dayCount` (night survived), the WaveDirector records the
    survived night and **escalates the next wave** via a data-driven curve (count + composition bump —
    e.g. more skeletons, later nights add a boar). `dayCount` already increments in the clock; the director
    keys difficulty off it.
  - Tuning pass now that the loop runs: set fire integrity vs wave DPS, fuel (Step 2) vs night length, and
    pacing numbers so a night is *winnable but tense*. Keep everything in data/config with comments; final
    numbers are explicitly allowed to be "by feel."
  - Side effects: WaveDirector state (survived-night counter, per-night config); ensure `reset()` restores
    day 1 baseline for scenarios.
  - Docs: `docs/STATUS.md`; `docs/ROADMAP.md` — mark Step 2 delivered (loop closes).
  - Done when: Tier-2 scenario — run a full night→dawn: player+fire survive → `dayCount` increments → the
    next night spawns more/tougher than the first (assert spawn count/composition delta across two nights).

- [ ] **Step 7: Dev force-wave hook + HUD (night/wave indicator + fire-integrity bar)** `[inline]`
  - Dev hook: add `debug:forceWave` (wired in `wireBus`, mirror `debug:toggleTime` at `:508`) that jumps
    the clock to night AND kicks off a wave immediately for manual playtesting; surface it on the existing
    dev button area (extend/adjacent to `GO NIGHT`).
  - HUD (`UIScene.ts`): a **fire-integrity bar** (mirror the HP/hunger bar pattern, synced on a new
    `fire:changed` event from CampfireManager) and a small **night/wave indicator** beside `timeText`
    (reuse the `time:changed` payload). Passive, additive.
  - Side effects: `GameScene.wireBus` + SHUTDOWN off; `CampfireManager` emits `fire:changed` on integrity
    change; `UIScene` new passive elements (not in `hudElements` unless interactive).
  - Docs: `docs/STATUS.md`; `docs/WORKFLOW.md` dev-hooks note if one exists (else skip).
  - Done when: pressing the dev force-wave control starts a wave on demand in-game; the fire-integrity bar
    tracks `damageFire`; the night indicator shows during night.

- [ ] **Step 8: Scenario API surface, tests, tripwire & docs** `[inline]`
  - `testApi.ts`: add a `forceWave`/`beginWave` test seam and expose new `DebugState` fields (e.g. fire
    `integrity`, active-wave state, spawn count this night) **appended at END** of the interface +
    serializer (`:394`); update `tests/e2e/harness.ts` + the `refactor-tripwire` golden together
    (intentional golden bump). Ensure `applyScenario` can seed a hearth + start a night deterministically.
  - Tests: Tier-1 pure tests for new pure logic (pacing-curve sampling, edge-tile selection, escalation
    curve, `isKnockedOut`); consolidate the Tier-2 scenario specs from Steps 1/3/4/5/6 into the
    roadmap's acceptance test ("clock to night → assert edge spawns → step to dawn → assert survival + day
    increment"). Confirm `npm run smoke`.
  - Docs: `docs/ROADMAP.md` (Step 2 done, note the loop is live); `docs/STATUS.md`; `docs/GAME-DESIGN.md`/
    `docs/DECISIONS.md` touch-ups if built behaviour refines the design; CLAUDE.md Status line.
  - Side effects: the tripwire golden is the main gotcha — bump it deliberately.
  - Done when: all three tiers green (unit + scenario + boot canary) and the tripwire passes against the
    intentionally-updated golden; the roadmap Step 2 acceptance scenario passes end-to-end.

## Out of scope

- **Defence structures** (plan 037 — destructible walls, gate, spike trap): deferred; they reuse Step 5's
  objective-target seam and are tuned against this live wave.
- **Multiple hearths / unioned claims, walls extending the claim, torches** (GAME-DESIGN staging (2)/(3)) —
  MVP has the single central hearth; the claim swap (Step 3) does staging (1) only.
- **Claw-back / relight-to-recover** after the fire is out — instant-loss for MVP (decision #1).
- **Enemy hide-in-dark / fog aggro gating** (deferred from plan 012) — the wave doesn't need it.
- **Authored treeline / spawn-marker map entities** — code-side edge rule for MVP (decision #3); no
  marker entity exists to author against.
- **Hunger going lethal** (roadmap Step 4) — `HUNGER_LETHAL` stays false; only the fuel comment is touched.
- **Game-over screen / run summary / MainMenu return** — reuse the existing `scene.restart()` death path;
  a proper end screen is post-MVP.
- **New enemy types for the wave beyond skeleton (+ optional boar in later nights)** — richer roster is
  post-MVP.
