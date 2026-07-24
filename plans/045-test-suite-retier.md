# Test Suite Re-tier (Phase 2)

> Status: planned — run /execute-plan to begin.

## Summary

Cut the Playwright e2e wall (currently ~9.3 min, 124 tests / 36 specs) without losing coverage, by
attacking the two costs that dominate it: **render frames** (every `step(ms)` drives real WebGL draws
on headless SwiftShader) and **per-test boot** (all 124 tests boot the game independently). This is the
deferred **Phase 2** of plan 044, now planned per that plan's re-measure discipline. Three levers:
(B) a **render-free `stepLogic(ms)`** on the test API, (C) **boot-once-per-file** for pure world-logic
specs, and (D) **migrate pure logic to Node**, deleting only specs a Node test provably covers first.
Lever **A** (verify a step with the one guarding spec, not the full suite — the felt friction) already
shipped; this plan is the speed work behind it.

## Context & decisions

### Why now / gating

Lever A (docs + `execute-plan` guidance so sessions stop running the whole suite between plan steps)
landed first and targets the *felt* friction directly. This plan is the coverage-preserving speed work
plan 044 scoped but deferred "until the CI-delegated e2e is re-measured as a bottleneck." **Execution
is still gated on that re-measure:** if, after lever A has settled, the ~9-min CI e2e is not actually
blocking work, prefer to stop after Step 1 (stepLogic) + Step 8 (re-time) rather than run the full
migration. The risky, coverage-touching steps (5, 7) are justified only by measured need.

### Measured baseline (this session, 4-vCPU box, 2 Playwright workers — matches plan 044's box)

- **~9.3 min, 124 test blocks across 36 spec files**, green (`retries: 0`).
- **Render cost is concentrated:** ~256 s of *driven game-time* is rendered across the suite; the top 8
  specs are ~76% of it — `companion` (~52 s driven), `wave` (~46 s), `survival-hunger` (~21 s),
  `combat` (~19 s), `campfire` (~16 s), `death` (~14 s), `monster` (~13 s), `workbench` (~13 s).
- **8 specs drive zero frames** (pure interaction/state): `glow`, `inspect`, `mode`, `zoom`,
  `hud-cluster`, `hud-drawers`, `hud-fight-controls`, `hud-overlays`.
- **Per-test boot ×124** — no `beforeAll`/`describe.serial` anywhere; every `test()` calls
  `startGame(page)` (`goto` → `bootIntoGame` → installs `__captured`). This fixed cost is co-equal with
  the render cost and is **not** removed by `stepLogic` alone — hence lever C. (This finding is new;
  plan 044's Phase-2 scope did not include shared-boot.)

### Key technical facts (from research this session — mirror these exactly)

- **`step(ms)` — `src/scenes/testApi.ts:461-470`.** Stops the RAF loop once (`game.loop.stop()`), then
  loops `round(ms/16.67)` slices calling `game.step(testClock, fixed)`. `Phaser.Game.step` runs the
  **full frame — update pass AND a real WebGL render**. Render-coupled work also runs in the *update*
  path above GameScene's no-action early-return (`GameScene.ts:1044-1077`), so it fires every slice
  regardless of drawing: `SurvivalClock.tick → composite()` (RenderTexture `clear`/`fill`/`erase`),
  `fx.syncEnemyHealthBars`, HitFlash PostFX (`hitFlashPipeline.ts`, WebGL-guarded). **Therefore a
  render-free `stepLogic` must both skip the draw AND suppress `composite()`'s RT ops** — skipping the
  render pass alone is not enough. Hit-count *counters* (`playerHitFlashes`/`enemyHitFlashes`,
  `CombatFxManager.ts:96-97`) increment in update, so they survive render-free.
- **`SurvivalClock.composite()` — `src/scenes/world/SurvivalClock.ts:270-286`**, called from
  `tick(delta)` (`:174`), `applyClock()` (`:243`), ctor seed (`:150`). Already early-returns at full
  daylight (`alpha <= 0`, `:279`). A `suppressRender` boolean short-circuiting at the top is the
  minimal DEV-gated seam (plan 044 Finding 5). `tick()`'s clock/phase/hunger/starve logic is
  RT-independent and keeps running.
- **`applyScenario` / `resetWorld` (`testApi.ts:247-290`)** resets world/domain state thoroughly
  (trees, enemies, build, structures, companion, `WaveDirector.reset()`, task queue, player state,
  survival block: `clockMs`/`dayPhase`/`dayCount`/`hunger`/`baseSupply`/inventory/HP). It does **NOT**
  reset: `game.__captured` (installed per-boot in `harness.ts:103-118`), the capture event listeners
  (`g.events.on` with no `off`), the **stopped RAF loop**, `eatReadyAt` cooldown (`SurvivalClock.ts:106`),
  camera zoom/scroll/follow, or any **DOM/HUD/Zustand** state (page-level, persists across restart).
  → Shared-boot (lever C) is safe for **pure world-logic** specs; capture/camera/HUD specs need an
  explicit per-test reset shim or stay per-test boot.
- **Node manager-tick template.** Mirror `src/systems/__tests__/monsterAI.test.ts` — every dep is a
  plain value/closure via a `baseInputs()`-style struct (`isBlocked: () => false`, `dims`, `rng =
  mulberry32(seed)`). **`WaveDirector`** (`world/WaveDirector.ts`) is the best manager template: `tick`,
  `beginWave`, `spawnOne`, `pickSpawnTile` use only `WaveDirectorDeps` closures (`:28-44`); the ctor
  needs `scene.events.once(SHUTDOWN,…)` so pass a `{ events: new EventEmitter() }` stub. Pure/Node-ready
  already: `systems/wave.ts` (`wave.test.ts`), `systems/pathfind.ts`, `monsterAI.ts`, `systems/tasks.ts`.
  Scene-coupled (keep in browser or `stepLogic`): `EnemyManager`, `CompanionManager`, `CampfireBehavior`,
  the GameScene-embedded task executor (`orderRunners`/`orderBeginners`, `GameScene.ts:1196-1232`).

### Decisions

- **Coverage appetite:** full re-tier, **deletion strictly gated on proven Node coverage first**
  (default from the planning conversation; matches plan 044's critique-corrected stance). No spec is
  deleted until Step 3's map names the Node test covering its wiring and that test is green.
- **Shared-boot (lever C) is IN**, but scoped: pure world-logic specs only, with a per-test reset shim;
  capture/camera/HUD specs stay per-test boot. (New vs plan 044.)
- **`retries: 0` stays** throughout — a flake is a determinism bug to fix, never hidden.
- **Correct plan 044's soft classifications (Finding 4):** `zoom.spec.ts` is pure clamp/round via
  `emit` → Tier-1 candidate; `inspect.spec.ts` is mixed (event-payload pure, alpha-hitbox trunk pick
  genuinely render).
- **Plan number:** `045` fills the slot plan 044 + `docs/testing.md` reserved (sequence jumps 044→046);
  not the next free integer.

### Patterns to mirror

- Node manager tick: `monsterAI.test.ts` (deps struct) + `WaveDirector` (`WaveDirectorDeps`).
- Existing unit deltas: `src/systems/__tests__/{wave,needs,campfire,combat,daynight}.test.ts`.
- Scenario helpers/seams: `tests/e2e/harness.ts`, `src/scenes/testApi.ts`, `tests/e2e/scenarios.ts`.
- Docs are LLM context — terse, high-signal edits (STANDARDS.md "markdown-is-model-context").

## Steps

- [ ] **Step 1: Render-free `stepLogic(ms)` on the test API + `SurvivalClock` suppress flag** `[inline]`
  - Add `stepLogic(ms)` to `TestApi` (`src/scenes/testApi.ts`) beside `step(ms)`: drive the same fixed
    1/60 s update loop but **without a WebGL draw** — skip the render pass (e.g. `scene.sys.setVisible(false)`
    around the loop, or advance only the scene update + `physics.world.update`, whichever the codebase
    supports cleanly) AND set a new `suppressRender` flag on `SurvivalClock` for the duration so
    `composite()`'s RenderTexture ops are short-circuited. Restore visibility/flag + leave the RAF loop
    in the same state `step()` does afterward. Keep default `step()` fully rendering (unchanged).
  - Add `SurvivalClock.suppressRender` (default `false`) with an early `return` at the top of
    `composite()` (`SurvivalClock.ts:270-286`); expose set/clear only via the DEV `__test`/`stepLogic`
    path. Verify `applyClock()` + ctor-seed composite calls are either covered by the flag or never
    reached under logic-only stepping.
  - Add a `stepLogic(page, ms)` wrapper in `tests/e2e/harness.ts` mirroring `step`.
  - Side effects: anything reading a rendered frame after stepping (screenshots, `isWebGL`, glow/outline
    PostFX assertions) must keep using `step()`, not `stepLogic` — Step 3's audit tags which. The DEV
    gate (`import.meta.env.DEV`) must still strip the whole seam from `vite build` (smoke unaffected).
  - Docs: none yet (Step 8).
  - Done when: one render-heavy spec (e.g. `survival-hunger`) converted to `stepLogic` is green with
    identical non-render assertions and visibly faster; `npm run build` + `npm run smoke` still pass
    (seam stripped from prod); `step()` behaviour unchanged for a render-dependent spec (e.g. `glow`).

- [ ] **Step 2: Establish the Node manager-tick pattern with `WaveDirector`** `[delegate]`
  - Add `src/scenes/world/__tests__/waveDirector.test.ts` mirroring `monsterAI.test.ts`: construct
    `WaveDirector` with a `{ events: new EventEmitter() }` scene stub and a `WaveDirectorDeps` of fakes
    (`spawnEnemy` pushes to a captured array, `dims`, `isBlocked: () => false`, `defendCentre`,
    `rng: mulberry32(seed)`, `dayContext`). Cover the wave **pacing** slice currently in `wave.spec.ts`:
    no day spawns, paced interval, first-tick reconcile, per-night escalation, force-wave. Do NOT delete
    the browser `wave` tests yet — this step only *proves the Node twin exists* (the Step 5 gate).
  - Side effects: none in `src/` runtime (test-only). Confirms `WaveDirectorDeps` needs no widening.
  - Docs: none.
  - Done when: `npx vitest run waveDirector` is green in plain Node; the pacing behaviours it covers are
    explicitly listed (they become deletable from `wave.spec.ts` in Step 5).

- [ ] **Step 3: Audit & coverage-map all 36 specs — the hard gate** `[inline]`
  - Produce a classification table (append to this plan under a `## Coverage map` heading, or a terse
    `docs/` note) tagging every spec file as: **delete** (truly pure — needs a named green Node test
    first), **convert-to-`stepLogic`** (wiring guard through a scene-coupled manager), **split** (pure
    state → Node + trimmed browser core), or **keep as-is** (`refactor-tripwire`, genuine render/pointer).
    Correct the soft cases: `zoom` → Tier-1 candidate; `inspect` → mixed/split.
  - Encode the **gate rule** explicitly: no spec moves to "delete" until the table names the Node test
    covering its wiring and that test is green. Seed dispositions from plan 044 Phase 2:
    delete-candidates `mode`, `weapon-reach-arc`, `wave` pacing-slice; convert `survival-hunger`,
    `survival-daynight`, `campfire`, `wave` (AI/loop-close), plus scene-coupled state specs (`chop`,
    `mine`, `block-full`, `build`, `wall`, `wall-deconstruct`, `spike-trap`, `companion`, `death`);
    split `boar`, `glow`, `queue`, `combat`, `monster`, `pathing-repro`, `wall-enemy-attack`.
    For each convert/split, note whether it can also share-boot (Step 6 input): pure world-logic = yes,
    capture/camera/HUD = no.
  - Side effects: none (analysis). This table drives Steps 4–7 and is the safety spine.
  - Docs: the map itself.
  - Done when: every one of the 36 specs has a disposition + (for deletes) the exact Node test that must
    pre-exist; the map distinguishes share-boot-safe from per-test-boot specs.

- [ ] **Step 4: Convert the render-heavy wiring-guard specs to `stepLogic`** `[inline]`
  - For each spec Step 3 tagged **convert** whose assertions don't read a rendered frame, swap `step` →
    `stepLogic`. Prioritise the top render-cost specs (`companion`, `wave` AI tests, `survival-hunger`,
    `survival-daynight`, `campfire`, `combat`, `death`, `monster`, `workbench`) — that's ~76% of driven
    frames. Where a spec mixes render-dependent and logic-only assertions, split the assertion (keep the
    render one on `step`).
  - Side effects: re-time after each; some now-oversized `test.setTimeout(...)` become removable (do that
    in Step 8, not here, to avoid re-introducing flakes mid-conversion). `retries: 0` — fix any flake at
    the source.
  - Docs: none yet.
  - Done when: the converted specs are green on two consecutive cold runs and the e2e wall has dropped
    measurably; no render-dependent assertion was moved to `stepLogic`.

- [ ] **Step 5: Migrate pure logic to Node + delete ONLY the Node-proven-pure specs** `[inline]`
  - For each **delete**-tagged spec, first confirm (or add) the Node test named in Step 3's map, green;
    then delete the browser spec (or the pure slice of it). Targets: `mode`, `weapon-reach-arc`, the
    `wave` pacing-slice (covered by Step 2's `waveDirector.test.ts`), and `zoom` (→ a Tier-1 clamp/round
    unit test). Do not delete any spec whose only coverage is the browser wiring path.
  - Side effects: fewer browser specs → shorter CI shards; ensure deleted behaviours are searchable in
    the Node suite (grep the assertion intent). Update `tests/e2e/scenarios.ts` if a fixture is now unused.
  - Docs: none yet.
  - Done when: each deletion is backed by a green Node test named in the map; unit suite still fast
    (`npm test`), e2e still green.

- [ ] **Step 6: Boot-once-per-file for share-boot-safe specs + a per-test reset shim** `[inline]`
  - For specs Step 3 marked share-boot-safe (pure world-logic, driven by `applyScenario`), introduce a
    `test.describe.serial` + `beforeAll(startGame)` model, resetting per test via `applyScenario`. Add a
    **reset shim** to `harness.ts` (and/or a `__test.resetForNextTest()` seam) that clears the gaps
    `resetWorld` misses: `game.__captured` (re-zero, don't re-register listeners), camera zoom/scroll/
    follow, `eatReadyAt`, and restart/normalise the RAF-loop state left by `stepLogic`/`step`. Leave
    capture/camera/HUD-dependent specs on per-test boot (do not force-share them).
  - Side effects: this is the highest-risk step for cross-test bleed — validate by running each shared
    spec in isolation AND in-file order and diffing results. If a spec flakes only when shared, it is not
    share-boot-safe: revert it to per-test boot and note why in the map.
  - Docs: none yet.
  - Done when: the converted files boot once, pass on two cold runs identically to per-test boot, and the
    boot-count drop is reflected in a lower wall time; no shared spec bleeds state.

- [ ] **Step 7: Split the mixed specs** `[delegate]` (parallel: A)
  - For each **split**-tagged spec (`boar`, `glow`, `queue`, `combat`, `monster`, `pathing-repro`,
    `wall-enemy-attack`), move the pure state/decision assertions to a Node unit test and keep a trimmed
    browser core for the genuine render/physics/pointer path. Leave `refactor-tripwire` untouched. Each
    spec is a separate file (write-disjoint) → these run as one parallel batch of delegated sub-agents;
    each sub-agent gets its spec's row from Step 3's map + the Node twin location.
  - Side effects: none cross-file (disjoint); each must keep its browser core green with `retries: 0`.
  - Docs: none yet.
  - Done when: each split spec's pure assertions live in Node (green) and its browser core is minimal and
    green; total browser test count is down per the map.

- [ ] **Step 8: Re-time, trim oversized timeouts, update docs** `[inline]`
  - Run `npm test`, `npm run e2e` twice cold (record wall + fail/flake=0), `npm run smoke`. Now that
    `stepLogic` removed the render cost the annotated long `test.setTimeout(...)` are safe to right-size —
    trim them and re-run to confirm still green. Re-benchmark `workers` if the new profile shifted the
    fill-rate/boot balance.
  - Docs: `docs/testing.md` — replace the "Phase 2 (planned, plan 045)" note with the shipped outcome +
    new numbers; document `stepLogic` vs `step` (when each applies) and the share-boot reset shim in the
    scenario-API + "adding a test" sections. `docs/WORKFLOW.md` + `CLAUDE.md` — refresh test wall
    numbers. `docs/STATUS.md` + `docs/DECISIONS.md` — note the re-tier. Mark this plan
    `> Status: in review` at final review (execute-plan step 3).
  - Side effects: CI (`ci.yml`) shards inherit the faster/fewer specs — confirm shard balance still even.
  - Done when: e2e wall recorded before/after (target: a large cut, most logic now render-free/Node),
    green on two cold runs, all docs reflect reality, timeouts right-sized.

## Out of scope

- Extracting the GameScene task executor / Arcade pathfinding / structure tick into Node-pure modules
  (would let scene-coupled specs migrate fully instead of `stepLogic`) — deferred, as in plan 044.
- `Phaser.HEADLESS` build (rejected in plan 044 — RenderTexture/glow/HitFlash PostFX assume a live GL
  context).
- Making deploy hard-depend on CI (`needs: [ci]`) — stays non-blocking + notify.
- New gameplay coverage beyond what exists — this is a re-tier, not a coverage push.
- Switching test runners — Vitest + Playwright stay.
- Lever A (already shipped): verify-with-one-spec guidance in the docs + `execute-plan` skill.
