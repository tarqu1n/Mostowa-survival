# Test Setup Review & Overhaul

> Status: planned — run /execute-plan to begin.

## Summary

End the friction with the test suite: it is run constantly and is slow. Re-tier the three-tier
harness (plan 007) so that fast pure logic lives in Tier 1, only genuinely browser-dependent behaviour
stays in Tier 2, and both the inner loop and CI are fast, well-defined, and green. Cut Vitest
per-run overhead, add a render-free scenario step, migrate logic-only browser specs down to Node,
fix the live flakes, and wire the heavy tiers into CI so `master` is protected without slowing deploy.
Also produce a written **when-to-run-what** policy (the cross-device rule: it must be in the repo).

## Context & decisions

### Measured baseline (this session, 4-CPU box, 2 Playwright workers)

- **Tier 1 (unit, `npm test`):** 925 tests / 66 files. Tests execute in **910ms** but the suite takes
  **8.8s** wall — the rest is Vitest overhead (collect 5.6s + transform 2.1s + prepare 5.1s across
  workers). `vitest.config.ts` sets no `pool`/`isolate`, so it defaults to `forks` + `isolate:true`
  = one child process per file re-transforming the graph.
- **Tier 2 (scenario, `npm run e2e`):** 106 tests, **10.5 minutes**, and **5 failed on a plain run**
  (campfire-feed, follow, menu-start, monster-patrol, survival-forage — pointer/timing-sensitive).
  One test, `wave.spec.ts › beginWave starts a paced wave`, takes **1.1 minutes alone** and only
  asserts spawn *counts*. Root cause: `TestApi.step(ms)` (testApi.ts:429) drives real rendered frames
  via `Phaser.Game.step()` — `step(22000)` = 1320 rendered frames on headless SwiftShader
  (fill-rate-bound under parallel load). A slow suite that is also intermittently red = the friction.
- **Tier 3 (smoke, boot canary):** fine as-is. No gameplay/timing.
- **CI (`.github/workflows/deploy.yml`):** runs **only** `npm test` (unit) on push to master; NO e2e,
  smoke, typecheck, lint, or format gate; no separate CI workflow. The slow valuable tier is a
  hand-run local tax that does not protect master.
- **Hooks:** `.husky/pre-commit` = `npx lint-staged` (staged files only). No `pre-push` hook.
- Discipline is good: `retries:0` by policy, zero `.skip`/`.only`/`.todo`, no lint-disables, systems
  100% unit-covered, long timeouts annotated. This is a structural mismatch, not rot.

### Feasibility findings (drive the steps)

- **The pure timing math is ALREADY extracted and Tier-1 tested** — `needs.drainHunger`,
  `campfire.drainFuel`, `wave.intervalForNightProgress`/`escalationForNight`, `combat.resolveMeleeAttack`
  (rng-injectable), `daynight.*` are pure delta-taking functions with existing `*.test.ts`. So the raw
  curves need no migration; the **e2e specs asserting those numbers are largely redundant wiring**.
- **Manager ticks are delta-driven and injectable but scene-constructed.** `WaveDirector.tick(delta)`
  (WaveDirector.ts:135) uses closure deps (`WaveDirectorDeps`, :28) → the **ready-made template** for a
  new "manager-tick with fake deps" Node pattern. `SurvivalClock`/`CampfireBehavior` build
  RenderTextures/sprites in their ctor → not Node-instantiable without extraction (out of scope here;
  those specs get render-free step instead of migration). Precedent for scene-logic-without-browser:
  `monsterAI.test.ts` (FSM core), `src/systems/__tests__/*` delta tests.
- **Render-free step is a real (modest) refactor, not a config flip.** `Phaser.Game.step()` always
  renders. Chosen approach: an opt-in `TestApi.stepLogic(ms)` that hides the scene
  (`scene.sys.setVisible(false)`) around the fixed-step loop AND guards `SurvivalClock.composite()`
  (SurvivalClock.ts:251, GL work in the *update* phase) behind a suppress flag, then restores. Default
  `step()` keeps rendering — render/WebGL/PostFX specs must keep using it. `Phaser.HEADLESS` rejected:
  the night `RenderTexture`, baked glow texture, and `HitFlash` PostFX pipeline assume a live GL context.
- **Per-spec classification (30 specs):** 6 must-stay-browser (a), 8 mixed (c), 16 pure-state (b).
  Of the 16: ~6–8 are low-effort migrations (math already Tier-1; e2e is thin wiring), ~8 assert pure
  state but are welded to the in-`GameScene` task executor / Arcade pathfinding / structure tick
  (migration needs executor extraction — out of scope; these get `stepLogic` instead).
  - **(a) keep browser:** campfire-feed, follow, gestures, inspect, menu-start, zoom.
  - **(c) mixed (split):** boar, glow, queue, combat, monster, pathing-repro, wall-enemy-attack,
    refactor-tripwire.
  - **(b) pure-state:** block-full, chop, mine, build, mode, survival-daynight, survival-forage,
    survival-hunger, wall, wall-deconstruct, campfire, death, spike-trap, companion, wave,
    weapon-reach-arc.

### Decisions (from the user, this session)

- **Scope:** full overhaul including CI.
- **Migration:** aggressive — move logic-only assertions to fast Node unit tests; **delete** the browser
  spec once its logic is fully covered. Trade some end-to-end coverage for speed.
- **CI shape:** a **separate, non-deploy `ci.yml`** on push to master (+ `workflow_dispatch`), running
  the full gate (typecheck + lint + lint:md + format:check + unit + e2e sharded + smoke), in parallel
  with the deploy workflow. It protects master as a signal without blocking/slowing deploy. (Trade-off:
  a red CI does not itself stop a deploy — accepted.)
- **Pre-push:** **fast only** — `typecheck + unit`; e2e/smoke live in CI. Skippable with `--no-verify`
  for phone/WIP (cross-device rule).

### Target "when to run what" (the policy this plan encodes)

|Moment|Runs|Speed target|
|---|---|---|
|On save (inner loop)|`vitest` watch — only affected unit tests|<1s|
|Pre-commit hook|`lint-staged` (staged files)|sub-second|
|Pre-push hook (skippable)|`npm run typecheck && npm test`|a few s|
|CI on push (`ci.yml`, parallel to deploy)|typecheck + lint + lint:md + format:check + unit + e2e (sharded) + smoke|CI-time|
|Manual full local gate|`npm run check` (unit) / `npm run check:all` (+ e2e + smoke)|on demand|
|Deploy (`deploy.yml`)|unchanged: `npm ci` + `npm test` + `npm run build`|fast|

### Patterns to mirror

- Unit delta tests: `src/systems/__tests__/{wave,needs,campfire,combat,daynight}.test.ts`.
- Scene-logic-without-browser: `src/systems/__tests__/monsterAI.test.ts`.
- Scenario helpers/seams: `tests/e2e/harness.ts`, `src/scenes/testApi.ts`, `tests/e2e/scenarios.ts`.
- Docs are LLM context — token-lean edits (STANDARDS.md "markdown-is-model-context" rule).

## Steps

- [ ] **Step 1: Cut Vitest per-run overhead** `[inline]`
  - Edit `vitest.config.ts`: switch to `pool: 'threads'` and set `isolate: false` (all unit tests are
    pure Node with no cross-file side effects — verify). Consider `poolOptions.threads.singleThread`
    off (keep parallel). Re-run `npm test` and record the new wall time in the plan/commit.
  - **Risk to check:** module-singleton bleed with `isolate:false` — the editor Zustand store tests
    (`src/editor/store/__tests__/*`) share module state. If any test goes red, scope isolation: keep
    `isolate:false` globally but add a `test.projects` (or `poolOptions`) entry re-enabling isolation
    for `src/editor/store/**`, OR add `beforeEach` store resets. Do NOT ship a red suite.
  - Side effects: `npm run check` and CI both call `npm test` — they inherit the speedup.
  - Docs: none yet (Step 12 rewrites testing.md with final numbers).
  - Done when: `npm test` is green and materially faster (target: overhead roughly halved); the config
    comment explains the pool/isolate choice and any editor-store carve-out.

- [ ] **Step 2: Add a fast pre-push hook + `check:all` script** `[delegate]` (parallel: A)
  - Create `.husky/pre-push` running `npm run typecheck && npm test` (mirror `.husky/pre-commit` style;
    husky v9 — a plain script, no `husky.sh` sourcing needed). Make it skippable (it is, via
    `--no-verify`); add a one-line comment saying so and why (cross-device: phone/WIP pushes).
    Ensure it is executable.
  - Add `package.json` scripts: `"check:all": "npm run check && npm run e2e && npm run smoke"` (full
    local gate incl. browser tiers), and keep `check` as the fast unit-only gate. Optionally add
    `"test:related": "vitest related --run"` for the documented targeted form.
  - Side effects: `prepare`/husky already installs hooks on `npm install`; the new hook auto-installs.
  - Docs: none yet (Step 12).
  - Done when: `git push` triggers typecheck+unit locally; `--no-verify` skips it; `npm run check:all`
    exists and runs the full gate.

- [ ] **Step 3: Add a separate CI workflow (unit + e2e sharded + smoke + static gates)** `[inline]`
  - Create `.github/workflows/ci.yml`, triggered on `push` to `master` and `workflow_dispatch`,
    independent of and parallel to `deploy.yml` (do NOT make deploy depend on it).
  - Jobs: (1) **static+unit** — `npm ci` → `typecheck` → `lint` → `lint:md` → `format:check` →
    `test`. (2) **e2e** — matrix-**sharded** across 2–4 shards (`playwright test --shard=${{matrix.shard}}/N`),
    each: `npm ci` → `npx playwright install --with-deps chromium` → run its shard; upload the HTML
    report / traces on failure. Set `workers` sensibly for CI runners (start `workers: 2`, benchmark).
    Keep `retries: 0` (policy) — but see Step 11: flakes must be fixed, not retried. (3) **smoke** —
    `npm ci` → `npm run build` → `npm run preview &` → `npm run smoke` (honour the Chromium path env
    the smoke script already reads).
  - Note the trade-off in a comment: CI is a signal, not a deploy gate (deploy.yml still ships on green
    unit test). If the user later wants hard gating, add `needs: [ci]` to the deploy job.
  - Side effects: none to app code; new Actions minutes. `E2E_PORT`/`SMOKE_URL`/`SMOKE_CHROMIUM_PATH`
    envs already exist — reuse them.
  - Docs: STANDARDS.md tooling table + testing.md (Step 12).
  - Done when: pushing to master runs `ci.yml` green (unit + all shards + smoke) alongside deploy;
    e2e is sharded and reports artifacts on failure.

- [ ] **Step 4: Audit & coverage-map all 30 scenario specs** `[inline]`
  - Produce a short migration backlog (a section in this plan or `plans/044-audit.md`): for each spec,
    list its concrete assertions, its class (a/b/c from Context), and for every logic/state assertion
    whether an equivalent Tier-1 test **already exists** or **must be added** (name the system + test
    file). Decide per spec: **delete** (fully covered by existing/added unit tests), **convert to
    `stepLogic`** (scene-coupled, keep in Tier 2 render-free), or **split** (mixed — move state parts
    to unit, keep a trimmed browser spec for the render/input part).
  - This gates Steps 6–9; no code changes here.
  - Docs: the backlog itself.
  - Done when: every one of the 30 specs has a decision + a named target unit test (existing or to-add),
    with no "figure it out later" gaps.

- [ ] **Step 5: Establish the manager-tick Node pattern via `WaveDirector`** `[inline]`
  - Add `src/scenes/world/__tests__/WaveDirector.test.ts` that instantiates `WaveDirector` with **fake
    `WaveDirectorDeps`** (stub `spawnEnemy`/`dims`/`isBlocked`/`defendCentre`/`rng`/`dayContext`; pass a
    minimal fake `scene` sufficient for the SHUTDOWN listener) and drives `tick(delta)` to assert
    pacing, first-tick reconcile, per-night escalation, and spawn-kind sequencing — the assertions
    currently in `wave.spec.ts`. Mirror `monsterAI.test.ts` for the "scene-logic in Node" shape.
  - If the ctor's `scene` coupling blocks Node use, extract the minimal seam (e.g. accept an optional
    lifecycle hook instead of reaching into `scene.events`) — keep the change surgical and note it.
  - Side effects: `WaveDirector.ts` may gain a tiny injectable seam; run the existing `wave.spec.ts`
    to confirm no behaviour change before Step 6 deletes/trims it.
  - Docs: none (pattern documented in Step 12).
  - Done when: `WaveDirector` pacing/reconcile/escalation is proven in plain Node, green, fast; this is
    the reusable template referenced by the migration steps.

- [ ] **Step 6: Migrate low-effort pure-state specs to Tier 1 and delete the redundant e2e** `[inline]`
  - For the low-effort (b) set whose logic is already/newly Tier-1-covered — **wave** (now covered by
    Step 5), **survival-hunger**, **survival-daynight**, **campfire** (fuel/claim math), **mode**,
    **weapon-reach-arc** — ensure the unit coverage fully matches each spec's state assertions (add
    unit tests where the audit flagged a gap), then **delete** the corresponding `tests/e2e/*.spec.ts`.
    Keep any assertion that is genuinely render/input (move to a trimmed spec per Step 8 if so).
  - Work spec-by-spec: delete only after its unit twin is green. Each spec is a write-disjoint unit
    (its own e2e file + its own/target unit file) — execute-plan may fan these out per spec.
  - Side effects: `tests/e2e/scenarios.ts` fixtures may become unused — remove dead fixtures. Update any
    `tests/e2e/harness.ts` helper that only these specs used (delete if now unreferenced).
  - Docs: none (Step 12 records the new spec count).
  - Done when: the named e2e specs are gone, their behaviour is covered by fast Node tests, and
    `npm test` + remaining `npm run e2e` are green.

- [ ] **Step 7: Add render-free `stepLogic(ms)` and convert scene-coupled state specs to it** `[inline]`
  - In `src/scenes/testApi.ts`, add `stepLogic(ms)` alongside `step(ms)`: same fixed 1/60s loop, but
    wrap it in `scene.sys.setVisible(false)` (restored after) and set a suppress flag that
    `SurvivalClock.composite()` (SurvivalClock.ts:251) checks to skip its per-tick GL work. Verify
    physics/timers/clock still advance (that is why `step` uses `game.step`, not `scene.update`). Add a
    `stepLogic(page, ms)` helper to `tests/e2e/harness.ts`.
  - Convert the scene-coupled (b) specs that must stay in Tier 2 (executor/pathfinding/structure/restart
    bound — **chop, mine, block-full, build, wall, wall-deconstruct, spike-trap, companion, death**)
    from `step` → `stepLogic`. Do NOT convert any render/WebGL/pointer spec.
  - **Guard rails:** confirm each converted spec still asserts the same state and passes; confirm no
    assertion secretly depends on a rendered frame (e.g. anything read back from the RenderTexture). If
    one does, leave that spec on `step`.
  - Side effects: `SurvivalClock` gains a suppress flag (default off — production unaffected, DEV-gated
    path only). Re-run the boot canary (`npm run smoke`) — the RenderTexture path must be untouched in
    normal play.
  - Docs: testing.md documents `stepLogic` vs `step` (Step 12).
  - Done when: converted specs pass and are markedly faster; default `step` still renders; smoke green.

- [ ] **Step 8: Split the mixed specs — state → unit, keep trimmed browser spec** `[inline]`
  - For the (c) set (**boar, glow, queue, combat, monster, pathing-repro, wall-enemy-attack**): move the
    pure state/logic assertions to unit tests (using the Step 5 pattern or existing system tests), and
    keep only the genuinely browser-dependent assertion (texture/anim load, WebGL PostFX outline,
    real-pointer routing, Arcade-physics collision/movement) in a **trimmed** spec — on `stepLogic`
    where it only needs update-phase progress, on `step` where it needs a rendered frame.
  - Leave **refactor-tripwire** untouched — it is an intentional whole-scene golden snapshot.
  - Side effects: monster cadence/damage assertions may move to `combat`/`monsterAI` unit tests;
    keep monster patrol/give-up (physics-movement) in a trimmed browser spec (also a Step 11 flake).
  - Docs: none (Step 12).
  - Done when: each mixed spec is trimmed to its browser-only core, its logic is in Node tests, all green.

- [ ] **Step 9: Fix the live flakes surfaced this session** `[inline]`
  - Root-cause and fix determinism (retries stay 0):
    - **survival-forage** — (b) pure-state; folds into Step 6 migration (drive `needs:eat` + forage in
      Node), then delete the spec. Confirm the flake is gone by removal.
    - **monster-patrol** — physics movement over time; keep in Tier 2 but stabilise (deterministic
      waypoints, `stepLogic` if render not needed) or move the waypoint-cycling logic into `monsterAI`
      unit coverage and trim the spec.
    - **campfire-feed, follow, menu-start** — real-pointer specs (class a). These are the documented
      "pointer→sprite tap flaky under parallel Playwright load" cases. Stabilise the pointer mapping
      (await scene-ready + retry the tap the way `harness.bootIntoGame` self-heals the menu tap), or if
      a spec's pure intent is already covered, reduce it to the minimal reliable pointer assertion.
      Do not paper over with `retries` or `waitForTimeout`.
  - Remove the last `waitForTimeout`-driven gameplay (`campfire-feed.spec.ts`) — replace real-time
    walking with `applyScenario` adjacency + `step`/`stepLogic`.
  - Side effects: touches harness pointer helpers; re-run the full `e2e` twice cold to confirm 0 flakes.
  - Done when: `npm run e2e` is green on two consecutive cold runs; no `waitForTimeout` gameplay remains.

- [ ] **Step 10: Re-measure and right-size Playwright workers/timeouts** `[delegate]`
  - After Steps 6–9 shrink the suite, re-time `npm run e2e`; reduce the now-oversized per-test timeouts
    (`test.setTimeout(120_000)` etc.) that were headroom for render-heavy driven frames — they should no
    longer be needed once specs are on `stepLogic` or deleted. Set `workers` in `playwright.config.ts`
    to a benchmarked value (half vCPU as a start) and confirm `fullyParallel` still holds.
  - Side effects: none beyond config; re-run to confirm green.
  - Done when: the annotated long timeouts are gone/reduced with the render cost, and the suite time is
    recorded.

- [ ] **Step 11: Verify end-to-end and capture final numbers** `[inline]`
  - Run the full local gate: `npm run typecheck`, `npm run lint`, `npm test` (record wall time),
    `npm run e2e` twice cold (record wall time + spec count, expect 0 fail/flake), `npm run smoke`.
    Confirm `ci.yml` is green on a real push.
  - Done when: all tiers green; before/after numbers (Tier-1 wall, Tier-2 wall, spec count, flake count)
    are captured for the docs and the decision entry.

- [ ] **Step 12: Rewrite the testing docs + decision log** `[inline]`
  - `docs/testing.md`: rewrite the tier table + two-speed loop to match the new reality — the
    when-to-run-what matrix (Context above), `step` vs `stepLogic`, the manager-tick Node pattern, the
    slimmed Tier-2 scope (only browser-genuine specs), and the new CI. Token-lean.
  - `docs/STANDARDS.md`: update the "Tooling — what runs where" table (add pre-push hook row + the new
    `ci.yml` row; correct the CI scope).
  - `docs/decisions/testing.md`: add a dated `[DECIDED]` entry summarising the overhaul (why, the
    migrate-down decision, render-free step, separate CI, before/after numbers) + an index line in
    `docs/DECISIONS.md`.
  - `docs/WORKFLOW.md` + root `CLAUDE.md`: fix any test commands/claims that changed (e.g. `check:all`).
    Update `docs/STATUS.md` test-harness line.
  - Done when: docs describe the new setup accurately and tersely; a fresh session could follow the
    when-to-run-what policy without rediscovery (cross-device rule satisfied).

## Out of scope

- Extracting the in-`GameScene` task executor / Arcade pathfinding / structure tick into Node-pure
  modules (would let the ~8 scene-coupled specs migrate fully instead of using `stepLogic`) — deferred;
  `stepLogic` is the pragmatic lever here.
- `Phaser.HEADLESS` test build (rejected — RenderTexture/glow/HitFlash PostFX assume a live GL context).
- Making deploy hard-depend on CI (`needs: [ci]`) — user chose a non-blocking signal; revisit later.
- Adding new gameplay test coverage beyond what already exists (this is a re-tier, not a coverage push).
- Visual-regression/screenshot-diffing the boot canary beyond its current zero-console-error check.
- Switching test runners or adopting a new framework — Vitest + Playwright stay.
