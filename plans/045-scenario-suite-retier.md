# Test Setup Overhaul — Phase 2 (scenario-suite re-tier)

> Status: planned — run /execute-plan to begin.

## Summary

Cut the CI e2e wall and its render-contention flakiness by **re-tiering the Playwright scenario
suite** (plan 044's deferred Phase 2). The e2e tier is the CI cost and it is fragile on the target
hardware: the first real `ci.yml` run on `master` was **red** — 4 render-heavy driven-frame specs
timed out on the hosted runners — and the e2e shards gate CI at **~8.5 min** wall. The root cause of
both the wall and the flakes is the same: `TestApi.step(ms)` drives *rendered* frames on headless
SwiftShader (fill-rate-bound). Phase 2 removes that cost — a render-free `stepLogic(ms)`, logic-only
specs migrated to Node, truly-pure specs deleted (only once a Node test provably covers their wiring)
— so the browser tier keeps only what genuinely needs a browser. This is a **re-tier, not a coverage
cut**: every deleted spec's wiring is Node-covered first.

## Context & decisions

### Re-measurement (the plan-044 gate — justified)

First real `ci.yml` run on `master` (run #2, sha `f71204f`, 2 shards × 2 workers):

| Job | test-exec | job wall | result |
|---|---|---|---|
| static-unit | 2s | ~53s | ✅ |
| smoke | ~9s | ~62s | ✅ |
| e2e shard 1 | 5.8m | ~6m24s | ❌ (1 fail) |
| e2e shard 2 | 7.3m | ~8m36s | ❌ (3 fail) |

- e2e gates CI at **~8.5 min** (static+smoke are ~1 min). The 4 reds are all `page.evaluate`
  timeouts on **render-heavy driven-frame** specs: `campfire.spec:206` (refuel walk, 30s),
  `death.spec:8` (die→restart, 60s), `survival-daynight.spec:10` (day→night overlay, 30s),
  `wave.spec:77` (fire-seeker drains fuel, 30s). Per-test costs on this hardware are brutal:
  `survival-hunger` ~29s each, `wave › beginWave` **1.6m**, several `companion` specs 20–38s.
- Phase 1 was validated green on the *faster* web-session box; the slower/GPU-contended GitHub
  hosted runners expose the render cost as both the wall driver and the flake driver — exactly what
  Phase 2's `stepLogic` removes.

### Owner decisions (this session)

- **Interim CI-green first (Step 1):** master CI is red now; a quick Phase-1-style stabilization
  goes green before the multi-step migration, then the migration removes the render cost and the
  inflated timeouts come back down at the end (Step 8). Keeps the tracking issue closed during the work.
- **Hard-gate the deploy at the end (Step 9):** once CI e2e is fast + green, add `needs: [ci]` to
  `deploy.yml` so a red e2e/smoke blocks the deploy (reverses plan 044's "non-blocking" note — a red
  run just slipped through to master, which is the case for gating).

### Carried-over Phase-2 scope (from plan 044, critique-corrected)

- **Hard gate:** no spec deleted unless a Node test **provably covers its wiring first**.
- **Corrections (044 Finding 4):** `zoom.spec` = pure clamp/round driven by `emit` → Tier-1
  candidate (only the camera-apply is browser); `inspect.spec` = mixed (event-payload pure,
  alpha-hitbox trunk-pick genuinely render).
- **Delete only truly-pure:** `mode`, `weapon-reach-arc`, the wave **pacing-only slice**.
- **Convert to `stepLogic`, never delete (044 Finding 1):** wiring-guards through non-Node
  managers — `survival-hunger`, `survival-daynight`, `campfire`, the mixed `wave` tests (fire-objective
  AI, fire-seeks-vs-chases-player, roadmap Step-2 acceptance clock→wave→loop-close), plus the
  scene-coupled state specs (chop, mine, block-full, build, wall, wall-deconstruct, spike-trap,
  companion, death).
- **Split the mixed specs:** boar, glow, queue, combat, monster, pathing-repro, wall-enemy-attack —
  pure state → Node, keep a trimmed browser core. **Leave `refactor-tripwire` untouched.**
- **`stepLogic` seam is DEV-gated (044 Finding 5):** keep it minimal + documented.

### Research findings (verified this session)

- **Node coverage already deep** — `src/systems/__tests__/`: `wave.test.ts` (covers pure
  `intervalForNightProgress`/`escalationForNight`/`spawnKindForIndex`), `campfire`, `daynight`,
  `needs`, `combat`, `companionCombat`, `monsterAI`, `hurtbox`, `base`, `baseSupply`, `orders`,
  `tasks`, `pathfind`, `stats`, `grid`. The e2e specs mostly guard **wiring** (manager→scene→
  registry→event) *on top of* these covered systems, not the pure logic itself.
- **Manager-tick Node template** = `src/systems/__tests__/monsterAI.test.ts` (pure `stepMonster` FSM
  with a stub inputs bag). The mirror for a scene-manager is **`WaveDirector`**: `tick(delta)` +
  `beginWave()`/`onTimeChanged()` over a `WaveDirectorDeps` **closure** (`spawnEnemy`/`dims`/
  `isBlocked`/`defendCentre`/`rng`/`dayContext`) — all injectable, so it is Node-instantiable with a
  fake deps object capturing spawns. This is the pattern every manager-tick Node test follows.
- **`stepLogic` seam:** `TestApi.step(ms)` (`src/scenes/testApi.ts:429`) stops the RAF loop and drives
  `game.step(clock, fixedDelta)` in fixed 1/60s slices. The fill-rate cost is
  `SurvivalClock.composite()` (`src/scenes/world/SurvivalClock.ts:251`) — a per-frame RT `fill` + an
  `erase` per lit fire, called every `tick`. Suppressing that (DEV-gated) around the loop is the lever.
- **Grep classification (browser-signal vs pure-state-signal counts)** confirms the browser-heavy
  set: `follow`, `gestures`, `menu-start`, `queue`, `inspect`, `campfire-feed`; everything else is
  pure-state-driven (candidates for Node/`stepLogic`).
- **Validation channel:** `ci.yml` triggers on push-to-master + `workflow_dispatch`; branch
  discipline forbids pushing to master from the feature branch, so **validate each step via a
  `workflow_dispatch` CI run on the feature branch** (dispatch runs the full e2e; the `notify` job is
  `push`-only, so no tracking-issue noise). Locally, `npm run e2e` + `npm test` still gate per step.

### Direction alignment

`docs/ROADMAP.md`'s MVP build order explicitly leans on the DEV scenario API (`applyScenario`/`step`)
to "end in something you can feel and test" — a fast, reliable scenario tier is load-bearing for that
workflow, so this infra work pulls in the project's stated way of building.

## Steps

- [ ] **Step 1: Interim CI-green stabilization (unblock master)** `[inline]`
  - Get `master` CI green **without** migration, so the tracking issue closes during the multi-step
    work. Root-cause is hosted-runner slowness on render-bound driven frames (not logic bugs) — the
    4 reds are timeouts. Interim levers (choose by a `workflow_dispatch` benchmark, prefer the
    smallest change that goes reliably green): (a) raise the affected per-spec `test.setTimeout`
    / the global `playwright.config.ts` `timeout` to give headroom on slower CI hardware; and/or
    (b) reduce GPU contention — set the CI e2e step to `--workers=1` and/or raise the shard matrix
    `2 → 3` in `.github/workflows/ci.yml` (more runners, fewer tests each). Do **not** touch spec
    logic or add retries (`retries: 0` stays). Annotate every bumped timeout with a
    `// plan 045 Step 1 interim — reduced in Step 8 once stepLogic removes the render cost` comment
    so Step 8 finds them.
  - Files: `playwright.config.ts`, `.github/workflows/ci.yml`, the 4 failing specs (timeout
    annotations only): `tests/e2e/{death,survival-daynight,campfire,wave}.spec.ts`.
  - Side effects: more Actions minutes if shards increase; artifact-upload names already keyed by
    shard. Local `npm run e2e` unaffected (it doesn't shard).
  - Docs: none yet (Step 9 rewrites docs).
  - Done when: a `workflow_dispatch` CI run on the feature branch is **green** (all shards + smoke);
    the chosen levers + interim-timeout comments are in place.

- [ ] **Step 2: Coverage-map audit (the hard gate)** `[inline]`
  - Read **all 30** `tests/e2e/*.spec.ts` and produce `plans/045-coverage-map.md`: one row per spec —
    `file | behaviour | verdict (delete / convert-stepLogic / split / leave) | manager(s) driven |
    Node-instantiable? | existing-or-needed Node twin`. Bake in the 044 corrections (zoom = Tier-1
    clamp candidate; inspect = mixed) and the carried-over verdicts above; **confirm or correct each
    by actually reading the spec**, don't copy blindly. The map is the contract for Steps 5–7.
  - **Hard rule (044 Finding 1):** a `delete` verdict is only valid if a Node test *already* covers
    that spec's wiring, or the map names the exact Node test to add first (in Step 3/5). Cross-check
    each delete candidate against `src/**/__tests__/*.test.ts` (esp. `wave`, `hurtbox`, `daynight`,
    `needs`, `combat`, `monsterAI`).
  - Side effects: none (read-only + one new plan doc).
  - Docs: the coverage map itself.
  - Done when: `plans/045-coverage-map.md` classifies all 30 specs; every `delete` row names its
    covering Node test (existing or to-be-added); `refactor-tripwire` is marked `leave`.

- [ ] **Step 3: Establish the manager-tick Node pattern (WaveDirector)** `[inline]`
  - Add `src/scenes/world/__tests__/waveDirector.test.ts`, mirroring `monsterAI.test.ts`: construct
    `WaveDirector` with a fake `WaveDirectorDeps` closure (a `spawnEnemy` that records `{id,col,row,
    opts}`, plus stub `dims`/`isBlocked`/`defendCentre`/`rng`/`dayContext`) and a minimal fake
    `scene` (only what the ctor's `events.once(SHUTDOWN,…)` needs). Drive `beginWave()`,
    `onTimeChanged({phase})`, and `tick(delta)`; assert the pacing/escalation/first-tick-reconcile/
    no-day-spawn/opening-burst/force-wave behaviour the wave **pacing-only** e2e slice asserts today.
    This is the Node twin that unlocks deleting that slice (Step 5), and the **template** every other
    manager-tick Node test copies.
  - Files: new `src/scenes/world/__tests__/waveDirector.test.ts`. If the ctor's Phaser coupling makes
    a fake scene awkward, prefer a tiny typed stub over importing Phaser; note the shape in the test
    header for reuse.
  - Side effects: none (new Node test). Runs under `npm test` (fast tier).
  - Docs: none (Step 9).
  - Done when: `waveDirector.test.ts` is green in Node and covers the wave pacing/escalation/reconcile/
    force-wave wiring; the file documents the "fake-deps manager-tick" pattern for later steps.

- [ ] **Step 4: Add a render-free `stepLogic(ms)` to `TestApi` (+ DEV-gated composite suppress)** `[inline]`
  - Add `stepLogic(ms)` beside `step(ms)` in `src/scenes/testApi.ts`: same fixed-1/60s
    `game.step(clock, fixedDelta)` loop, but **suppress the render cost** around it. Primary lever: a
    DEV-gated suppress flag read by `SurvivalClock.composite()` (`src/scenes/world/SurvivalClock.ts`)
    that makes it early-return (skip the RT `fill` + per-fire `erase`) while set; secondary:
    `scene.sys.setVisible(false)` around the loop. Set before the loop, **always restore in a
    `finally`** (a thrown step must not leave the scene hidden/suppressed). Keep the seam **minimal +
    documented** (044 Finding 5): one boolean, DEV-only, one comment at each site. Default `step(ms)`
    is unchanged (still renders — for the genuinely-render specs).
  - Expose `stepLogic` on `window.game.__test` (same DEV gate as `step`) and add a `stepLogic(page,
    ms)` helper in `tests/e2e/harness.ts` next to `step`.
  - Side effects: `SurvivalClock.composite()` is a shipping method — the flag must be DEV-gated
    (`import.meta.env.DEV`) so `vite build` strips it and prod render is byte-identical. Verify the
    prod bundle via `npm run smoke`. Confirm one converted spec is materially faster + still correct.
  - Docs: none yet (Step 9).
  - Done when: `stepLogic` exists + is exposed; a pilot conversion (e.g. `survival-daynight`) passes
    and is visibly faster; `step()` still renders; `npm run smoke` green (flag absent from prod).

- [ ] **Step 5: Migrate-down + DELETE the truly-pure specs (gated on Node coverage)** `[inline]`
  - **Only after** the covering Node test exists (Step 2 map + Step 3): delete the truly-pure specs
    and their now-redundant browser cost.
    - `mode.spec.ts` — add/confirm a Node test for the mode toggle state machine (mutually-exclusive
      command/combat/inspect + `mode:changed`); if the logic isn't Node-instantiable, **downgrade the
      verdict to convert-stepLogic** rather than delete. Then delete the spec.
    - `weapon-reach-arc.spec.ts` — confirm `hurtbox.test.ts` (or add) covers the reach/cleave hit-tile
      geometry; then delete.
    - The wave **pacing-only slice** in `wave.spec.ts` (no-day-spawn, `beginWave` pacing, first-tick
      reconcile, escalation, force-wave) — covered by Step 3's `waveDirector.test.ts` + existing
      `wave.test.ts`; **delete only those `test(...)` blocks**, keep the mixed ones for Step 6.
    - `zoom.spec.ts` — if a pure clamp/round fn isn't already unit-tested, extract/cover it in Node,
      then delete the spec (the camera-apply is a thin wiring line not worth a browser spec); if the
      audit found a genuine render assertion, downgrade to split (Step 7) instead.
  - Side effects: `wave.spec.ts` is edited here (delete slice) **and** in Step 6 (convert mixed) — do
    Step 5's wave edits first to avoid churn. Update any shared fixtures in `tests/e2e/scenarios.ts`
    left unused.
  - Docs: none yet (Step 9).
  - Done when: the named specs/blocks are gone, each replaced by a green Node test proving the same
    wiring; `npm test` + `npm run e2e` green.

- [ ] **Step 6: Convert scene-coupled wiring-guards to `stepLogic` (never delete)** `[inline]`
  - Swap `step(...)` → `stepLogic(...)` in the specs that assert only **state** (no render/pointer/
    alpha) but drive **non-Node managers** (physics/clock/task-executor/StructureManager): the mixed
    `wave` tests (fire-objective AI, fire-seeks-vs-chases-player, **roadmap Step-2 acceptance**
    clock→wave→loop-close), `survival-hunger`, `survival-daynight`, `campfire`, and the scene-coupled
    state specs `chop`, `mine`, `block-full`, `build`, `wall`, `wall-deconstruct`, `spike-trap`,
    `companion`, `death`. These are the specs that timed out on CI — `stepLogic` removes the render
    cost that made them slow/flaky. Keep every assertion; only the stepping call changes.
  - Per spec: if any single assertion genuinely needs a rendered frame (alpha/RT/PostFX), leave *that*
    one on `step()` and `stepLogic` the rest — don't blanket-convert past a real render check.
  - Side effects: reuses the Step-1 interim timeout bumps (removed in Step 8). Re-run each converted
    spec locally to confirm determinism holds under the render-free loop.
  - Docs: none yet (Step 9).
  - Done when: the listed specs run on `stepLogic`, stay green, and are materially faster; no render
    assertion was silently dropped.

- [ ] **Step 7: Split the mixed specs (pure → Node, trim the browser core)** `[inline]`
  - For `boar`, `glow`, `queue`, `combat`, `monster`, `pathing-repro`, `wall-enemy-attack`: move the
    pure-state assertions into Node unit tests (new or existing `src/**/__tests__/`), and keep a
    **trimmed** browser spec holding only the genuine render/pointer/alpha/PostFX assertions
    (converting its non-render stepping to `stepLogic`). Leave the genuinely-browser specs as-is
    except `step→stepLogic` where no render is asserted: `follow`, `gestures`, `menu-start`,
    `inspect` (mixed — split its pure event-payload part to Node, keep the alpha-hitbox trunk-pick in
    browser). **Leave `refactor-tripwire.spec.ts` completely untouched.**
  - Side effects: new Node tests must not duplicate existing coverage — check the twin first. Deleting
    a moved assertion from a browser spec is a coverage move, not a cut: the Node test must land in the
    same step.
  - Docs: none yet (Step 9).
  - Done when: each mixed spec's pure part is Node-covered and its browser remainder is minimal +
    green; `refactor-tripwire` unchanged; `npm test` + `npm run e2e` green.

- [ ] **Step 8: Re-time, reduce the now-oversized timeouts, right-size shards/workers** `[inline]`
  - With render removed from the hot specs, re-measure the e2e wall via a `workflow_dispatch` CI run
    on the branch (and `npm run e2e` locally). **Reduce** the annotated interim timeouts from Step 1
    and any other now-oversized `test.setTimeout`/global `timeout` to fit the faster reality (grep the
    `plan 045 Step 1 interim` comments). Re-tune `playwright.config.ts` `workers` and the `ci.yml`
    shard matrix / `--workers` to the new benchmark (fewer shards may now suffice).
  - Side effects: config + timeout annotations only. Do the reduction *last* — trimming before the
    render cost is gone would re-introduce flakes (plan 044's explicit warning).
  - Docs: none yet (Step 9).
  - Done when: e2e wall is materially below ~8.5 min, **green on two consecutive `workflow_dispatch`
    runs**, timeouts right-sized, before/after numbers recorded for Step 9.

- [ ] **Step 9: Hard-gate the deploy on CI + rewrite the docs** `[inline]`
  - Add `needs: [ci]` to `deploy.yml`'s build/deploy job so a red CI (e2e/smoke) blocks the deploy
    (the owner decision; reverses plan 044's non-blocking note). Confirm the two workflows still start
    in parallel and only the deploy waits. Note the change in a workflow comment.
  - Docs (token-lean): `docs/testing.md` — Phase 2 done: `step` vs `stepLogic`, the re-tiered
    tier-table, new e2e wall, CI now a hard gate. `docs/decisions/testing.md` — dated `[DECIDED]`
    Phase-2 entry (re-tier rationale, `stepLogic` seam, delete/convert/split outcome, before/after
    numbers, `needs: [ci]`) + `docs/DECISIONS.md` index line. `docs/STANDARDS.md` — tooling table:
    deploy now gated on CI. `docs/STATUS.md` — test-harness line refreshed. Root `CLAUDE.md` only if
    the "three-tier harness" line is now inaccurate (it isn't — leave it).
  - Side effects: with `needs: [ci]`, a genuinely-red CI now stops deploys — intended; call it out in
    the decision entry so it isn't a surprise.
  - Done when: deploy depends on green CI; docs accurately + tersely describe the re-tiered suite and
    the gate; a fresh session could follow the `step`/`stepLogic` split without rediscovery.

## Out of scope

- Extracting the in-`GameScene` task executor / Arcade pathfinding / structure tick into Node-pure
  modules (would let the scene-coupled specs migrate fully instead of `stepLogic`) — deferred.
- `Phaser.HEADLESS` test build (rejected in 044 — RenderTexture/glow/HitFlash PostFX assume a live GL
  context).
- Adding **new** gameplay coverage beyond re-homing what exists (this is a re-tier, not a coverage push).
- Switching test runners — Vitest + Playwright stay.
- Deleting or altering `refactor-tripwire.spec.ts`.

## Critique

<!-- filled in by /critique-plan before execution -->
