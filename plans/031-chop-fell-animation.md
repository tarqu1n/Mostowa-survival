# Chop & Fell Animation (resource nodes)

> Status: in review

## Summary
Give harvest nodes a felling sequence with three beats: (1) a **directional per-hit recoil**
replacing today's symmetric scale-bounce — the node jolts away from the chopper and snaps back on
each landed swing; (2) an **escalating tremble** layered onto the per-hit motion whose amplitude
grows as HP drops toward zero; (3) a **per-kind depletion visual** — a tree topples (a transient
"falling trunk" clone rotates about its base and fades out while the persistent sprite becomes the
stump underneath), a rock crumbles (shrink+fade), a bush rustles (squash+fade). The animation code
lives in a **new `NodeFxManager` under `src/scenes/fx/`** (mirroring `CombatFxManager`);
`ResourceNodeManager` stays a state manager and drives fx only through narrow dep closures
(`playChopFx` / `playFellFx`). The persistent node sprite is never destroyed on harvest (it swaps to
the stump then regrows). The selection glow halo mirrors the node transform every frame, so
transform-based motion animates the outline for free — no shader.

## Context & decisions

**Grounded seams (verified twice against source):**
- Per-hit tick: worker lands a swing every `CHOP_INTERVAL_MS` (400ms) → `GameScene.runHarvest`
  (`src/scenes/GameScene.ts:839`) calls `this.resourceNodeManager.chop(tree)` at **GameScene.ts:857**.
  `faceTile(tree.col, tree.row)` at **:851** sets `playerChar.lastFacing = {dCol,dRow}` pointing FROM
  the chopper TO the tree. **Away-from-chopper == `+lastFacing`.**
- `ResourceNodeManager` (`src/scenes/world/ResourceNodeManager.ts`) holds a full `scene: GameScene`
  ref and a `deps` of `repath()` + `addYield()`. `chop(tree)` is at **line 237**; the symmetric bounce
  tween is **lines 244-246**; the `hp <= 0` depletion branch is **lines 247-270** (swaps the SAME
  sprite to the `depleted` stump via `applySkinAppearance(...,'depleted')` at :252, or tints to
  `stumpColor` if the skin has none, then `delayedCall(regrowMs)` restores the live sprite).
- **Nodes are reused, never destroyed on harvest.** The fell leaves `tree.sprite` in place (it becomes
  the stump) and animates a SEPARATE transient clone.
- **Facing** is the `{dCol,dRow}` sign-delta on `Character.lastFacing` (`src/entities/Character.ts:25`).
  Reuse `FACING_DELTAS` (`src/entities/types.ts:85-93`); no new Direction enum. `faceTile` is
  `Character.ts:55-60`.
- **Origin is base-anchored** (tree `0.5/0.92`, rock `0.5/0.8`, bush `0.5/0.72`) — ideal topple pivot;
  rotation about the sprite origin hinges at the trunk base, no offset math.
- **Cloning the live visual** needs skin resolution that lives (private) in `ResourceNodeManager`:
  `resolveSkin(def, skin)` → `resolveSkinTexture(asset, region)` → `{ key, frame? }`, plus `nodeScale`
  and origin. Region sub-frames are lazily registered by `resolveDecorDraw` (`src/render/decorSprites.ts`),
  so cloning by `(key, frame)` reuses the same crop. **Because this resolution is `ResourceNodeManager`'s
  job, the manager computes a plain-data clone descriptor and passes it to `NodeFxManager`** (see the
  placement decision) — the fx surface never reaches into skin internals.
- **Glow halo tracks the node automatically** via `syncGlowTransforms()` (`src/scenes/fx/TaskGlowRenderer.ts:184`)
  — mirrors pos/scale/rotation each frame. Animate the node transform and the outline follows; a
  shader would desync it. Do NOT touch `TaskGlowRenderer`. The transient fell clone is unmanaged fx and
  is correctly NOT tracked by the halo (the halo follows the stump, which stays put).

**Placement decision (settled with the user; resolves critique Finding 1):**
- The fx code lives in a **new `src/scenes/fx/NodeFxManager.ts`**, mirroring `CombatFxManager`'s exact
  shape. `ResourceNodeManager` reaches it only through narrow dep closures — honouring the project's
  fx-lives-in-`scenes/fx` convention and the plan-013/015 rule ("managers get narrow interfaces, the
  scene mediates, no manager↔manager edge"). This is the low-regret structural move: cheaper than it
  looks (two copy-templates already exist), keeps `chop()` about state, and becomes the natural first
  home for the anticipated spell/weapon/on-trigger animations.
- **We are NOT building a generic effect-DSL / data-driven effect descriptor now** — both the advisor
  and the critique judged that premature at one concrete client. Revisit real generalisation (promote
  `NodeFxManager`'s transient-sprite machinery + a named-effect registry keyed from `src/data/`) when
  the FIRST spell/weapon-fx feature is planned, deciding against two real clients, not one. The
  extraction trigger is documented in Step 5.

**Other settled decisions:**
- Beats to build now: **1, 2, 3.** Beat 4 (camera shake on fell) is OUT — fast-follow.
- **Per-kind depletion visual:** tree topples; rock crumbles (shudder → shrink+fade, minimal/no
  rotation); bush squash + fades (no rotation). Branch on `def.harvestAnim` (`'chop'`/undefined →
  tree, `'mine'` → rock, `'gather'` → bush) — only `tree` carries a real `depleted` stump; rock & bush
  use the `stumpColor` tint fallback.
- **Recoil + tremble apply to all kinds.** Bush is `maxHp 1` (single hit) so tremble barely shows there.
- **No chopper direction → skip the fell animation, instant swap** (defensive guard; `chop` is only
  called from the player-driven `runHarvest`, which always yields a non-zero facing when adjacent —
  see Finding 6, keep the guard but don't gate acceptance on a contrived test).

**Constants live in `src/config.ts`** — flat `SCREAMING_SNAKE` exports grouped by a doc-comment block,
units in the suffix. `CHOP_INTERVAL_MS` is at :64; the combat FX group is at :135-165. The new
constants are imported by **`NodeFxManager`** (not `ResourceNodeManager`).

**Teardown discipline (copy `CombatFxManager` exactly):** Map-of-tweens keyed per sprite; `.stop()`
(not `.remove()`) before restart; `.active` guard inside every `onUpdate`/`onComplete`; on teardown,
stop every tween BEFORE clearing the collection. `NodeFxManager` arms its own
`scene.events.once(SHUTDOWN, …)` (like `CombatFxManager.armShutdown`), exposes a scene-alive
`reset()`/`clearAll()` that stops tweens AND destroys transient sprites, and a SHUTDOWN `destroy()`
that stops tweens and drops refs only (never `.destroy()` — Phaser already tore them down).
`ResourceNodeManager.clearAll()`/`destroy()` call the corresponding `NodeFxManager` method so a
world reset or scene shutdown mid-animation can't orphan a tween on a freed sprite.

## Steps

- [x] **Step 1: Add fell/recoil/tremble tunables to `src/config.ts`** `[delegate sonnet]`
  - Outcome: added a doc-commented block at `src/config.ts:73-99` (after the chop/swing timing consts, before `LONGPRESS_MS`) with all 10 constants at the exact names/values. Additive only, no consumers. `npm run typecheck` + `npm run build` clean.
  - New doc-commented block of flat `export const` values (starting points; tune for feel):
    - `CHOP_RECOIL_PX = 3`, `CHOP_RECOIL_MS = 120`, `CHOP_RECOIL_SQUASH = 0.06`
    - `CHOP_TREMBLE_PX = 1.5`, `CHOP_TREMBLE_DEG = 2` (max amplitudes at ~0 HP)
    - `TREE_FELL_MS = 600`, `TREE_FELL_ARC_DEG = 82`, `TREE_FELL_FADE_MS = 200`
    - `ROCK_CRUMBLE_MS = 320`, `BUSH_RUSTLE_MS = 220`
  - Keep every per-hit duration `< CHOP_INTERVAL_MS` (400ms) so consecutive hits don't overlap.
  - Side effects: additive named exports only; no consumers until Step 2/3.
  - Done when: typecheck/build passes; constants exported and greppable.

- [x] **Step 2: Create `NodeFxManager` + wire it in via dep closures; widen `chop(tree, facing?)`** `[inline]`
  - Outcome: new `src/scenes/fx/NodeFxManager.ts` (mirrors `CombatFxManager`: field-init ctor, `armShutdown`, `recoilTweens` Map + `transient` Set, `reset()`/`destroy()`; exports `ChopFxInput`/`FellFxInput`). Stub `playChop` = old scale-bounce (with snap-to-rest); stub `playFell` = stops the node's recoil tween only. Wired in `GameScene`: `nodeFx` field-init, `armShutdown+reset` in `resetState`, `playChopFx`/`playFellFx` deps on `ResourceNodeManager`, callsite passes `playerChar.lastFacing`, `nodeFx.reset()` before both `clearAll` paths (`resetTreesAndEnemies`, `randomiseWorld`). `chop(tree, facing?)` widened; builds `ChopFxInput` + (hp≤0, facing present) `FellFxInput`. `track`/`endTransient` deferred to Step 4 (their callsites land there). typecheck+build clean; 702/703 tests pass. **Pre-existing unrelated failure:** `mapRuntime.test.ts` `originOf('the-moon')` — stale vs a committed `the-moon.map.json`; not plan-31.
  - **New file `src/scenes/fx/NodeFxManager.ts`**, structured as a near-copy of `CombatFxManager`
    (`src/scenes/fx/CombatFxManager.ts`): constructor takes `(scene: GameScene, deps?)`; `armShutdown()`
    via `scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())`. Own two collections:
    - `recoilTweens: Map<Phaser.GameObjects.Image, Phaser.Tweens.Tween>` (per-hit recoil/tremble on the
      persistent node sprite), and
    - `transient: Set<{ sprite: Phaser.GameObjects.Image; tweens: Phaser.Tweens.Tween[] }>` (fell/crumble/
      rustle clones), with a private `track(sprite, tweens)` that self-unregisters on completion.
  - Public API (bodies are stubs in this step; motion lands in Steps 3-4):
    - `playChop(input): void` — recoil + tremble on an existing node sprite.
    - `playFell(input): void` — per-kind depletion visual on a transient clone; also **stops+clears this
      node sprite's `recoilTweens` entry** before returning (resolves Finding 4).
    - `reset(): void` — scene-alive teardown: stop all recoil tweens (then clear the map), stop all
      transient tweens + `sprite.destroy()` (then clear the set).
    - `destroy(): void` — SHUTDOWN teardown: stop all tweens, drop refs, NO `.destroy()`.
  - **Input contract** — `ResourceNodeManager` owns skin resolution, so it passes plain data, not the
    node object graph. Representative shapes (finalise names in code):
    - `ChopFxInput = { sprite; restX; restY; baseScale; depletion /* (maxHp-hp)/maxHp, 0..1 */; facing }`
    - `FellFxInput = { kind: 'chop'|'mine'|'gather'; texKey; texFrame?; x; y; scale; originX; originY; depth; facing; nodeSprite }`
      (`nodeSprite` only so `playFell` can stop that sprite's recoil tween).
  - **Wire through the scene (scene mediates):** add `playChopFx`/`playFellFx` to `ResourceNodeManagerDeps`
    (`ResourceNodeManager.ts:20-28`). In `GameScene`, instantiate `NodeFxManager` alongside the other fx
    managers and pass `(input) => this.nodeFxManager.playChop(input)` / `playFell(input)` as those deps.
    Follow how `CombatFxManager` is constructed/owned in `GameScene` (grep its instantiation + the
    `CombatFxDeps` closures around GameScene:100-174).
  - **Widen `chop`**: `chop(tree: TreeNode, facing?: { dCol: number; dRow: number })`
    (`ResourceNodeManager.ts:237`). Update the callsite **GameScene.ts:857** to pass
    `this.playerChar.lastFacing`. Replace the inline bounce tween (**:244-246**) with a call that builds
    a `ChopFxInput` (compute `restX/restY` via the manager's own `tileToWorldCenter(col,row)`, `baseScale`
    via `nodeScale`, `depletion` from hp/maxHp) and invokes `this.deps.playChopFx(...)`. In the `hp<=0`
    branch, after keeping the existing persistent stump swap, build a `FellFxInput` (resolve clone
    `texKey/texFrame` via `resolveSkin`+`resolveSkinTexture`, scale/origin/depth from the live sprite)
    and call `this.deps.playFellFx(...)` — **only if `facing` is present and non-zero**, else skip.
  - **Teardown wiring:** `ResourceNodeManager.clearAll()` (**:283**) calls `deps`-reachable
    `nodeFxManager.reset()` (or the scene calls it) BEFORE destroying node sprites; `ResourceNodeManager`
    need not itself hold the fx ref if the scene owns lifecycle — prefer the scene owning `NodeFxManager`
    and calling `reset()` from the same place it triggers node `clearAll()` (DEV reset / world randomiser).
    Confirm `NodeFxManager.destroy()` is armed on SHUTDOWN independently.
  - Side effects: `chop` signature change — grep all `.chop(` callers (only `runHarvest`). Regrow
    `delayedCall` (**:258-269**) unaffected (touches only the persistent sprite, `.active`-guarded).
  - Done when: build/typecheck passes; `NodeFxManager` instantiated and torn down with the scene;
    chopping still behaves (stub `playChop` can do the old bounce so nothing regresses); no functional
    fell yet.

- [x] **Step 3: Beats 1+2 — directional recoil + escalating tremble in `NodeFxManager.playChop`** `[inline]`
  - Outcome: `playChop` now drives ONE tween over a 0→1 progress `p` (dur `CHOP_RECOIL_MS`): snaps to true rest first (stop prior tween, set pos/angle/scale), then recoil offset along the normalised +facing unit vector via a `sin(pπ)` out-and-back envelope + `CHOP_RECOIL_SQUASH` squash pop, plus a decaying (`1-p`) multi-frequency pos+angle tremble scaled by `depletion * CHOP_TREMBLE_PX`/`_DEG`. All terms →0 at `p=1`; onComplete lands exactly on rest (pos/angle0/baseScale), `.active`-guarded. Typechecks clean (editor-excluded config, EXIT=0; whole-project tsc errors are all plan-30's in-flight `LibraryPanel.tsx`), lints clean. Visual check deferred to Step 5 (combined live run with the fell).
  - Implement `playChop(input)`. Both beats share one tween/`onUpdate` since they animate the same
    per-hit motion (keeping them together avoids Step-4-style rework).
  - **Snap to rest first (resolves Finding 3):** at the START of each `playChop`, `.stop()` any existing
    `recoilTweens` entry for this sprite and set the sprite to the TRUE resting transform — `x=restX`,
    `y=restY`, `angle=0`, `scale=baseScale` — so a re-chop mid-jitter can't accumulate drift off
    tile-centre. Then build the new tween and `.set()` it in the map.
  - **Recoil (beat 1):** offset the sprite by `CHOP_RECOIL_PX` along **`+facing`** (away from the
    chopper — `faceTile` points player→tree, so away == `+lastFacing`; resolves Finding 7) with a slight
    squash (`CHOP_RECOIL_SQUASH`), out-and-back over `CHOP_RECOIL_MS`, easing back to `restX/restY` and
    `baseScale`.
  - **Tremble (beat 2):** layer positional + angular jitter with amplitude `depletion * CHOP_TREMBLE_PX`
    and `depletion * CHOP_TREMBLE_DEG`. Sprite MUST return to `angle 0` and rest position at the end of
    the hit (leave no residual rotation — the fell owns the final angle). Use `baseScale` read from the
    input each call, never a captured value.
  - `.active`-guard the `onUpdate`/`onComplete`; clear the map entry on complete.
  - Applies to all kinds (pre-depletion, kind-agnostic).
  - Side effects: glow halo mirrors the motion automatically — verify a queued (glowing) node trembles
    in lockstep; do NOT touch `TaskGlowRenderer`.
  - Done when: chopping visibly jolts the node away from the worker and snaps back each hit; jitter
    grows over successive hits on the 4-HP rock; node always settles exactly on tile-centre, upright,
    between hits, even when re-chopped rapidly; glow follows.

- [x] **Step 4: Beat 3 — per-kind depletion visual in `NodeFxManager.playFell`** `[inline]`
  - Outcome: `NodeFxManager.playFell` now stops+clears the node's recoil tween (Finding 4) then spawns a transient clone via new `track(sprite)` (returns a `{sprite,tweens:[]}` entry added to the `transient` set) and animates by kind: **tree** (`'chop'`/undefined) topples — one sprite `angle` tween 0→`sign*TREE_FELL_ARC_DEG` (`Quad.easeIn`, `TREE_FELL_MS`) + a delayed `alpha`→0 tween over the last `TREE_FELL_FADE_MS` whose `onComplete` ends the transient; `sign = Math.sign(dCol)||Math.sign(dRow)||1` (Finding 2); **rock** (`'mine'`) — single `{p}` tween over `ROCK_CRUMBLE_MS`: decaying pos+angle shudder → scale to 0.7× + alpha→0; **bush** (`'gather'`) — single `{p}` tween over `BUSH_RUSTLE_MS`: squash (pop wide / compress down) + alpha→0, no rotation. New `endTransient(entry)` is `has()`-guarded (idempotent vs reset/destroy), stops tweens, destroys the clone. Every `onUpdate`/`onComplete` `.active`-guarded; clone depth = node depth. Touched only `src/scenes/fx/NodeFxManager.ts` (imports + `playFell` body + `track`/`endTransient`); the `ResourceNodeManager` callsite was already fully wired in Step 2. `npx tsc --noEmit` EXIT 0 (whole project — plan-30's earlier tsc noise has since cleared), eslint + prettier clean, 702/703 tests pass (**sole failure `mapRuntime.test.ts` `originOf('the-moon')` is pre-existing + unrelated**, as in Steps 2/3). Visual verification bundled into Step 5's combined live run.
  - Implement `playFell(input)`. First `.stop()`+clear the node sprite's `recoilTweens` entry (Finding 4)
    so the dying recoil can't fight the stump swap. Then spawn a transient clone:
    `scene.add.image(x, y, texKey, texFrame).setScale(scale).setOrigin(originX, originY).setDepth(depth)`,
    register it via `track(...)`, and animate per `kind`:
    - **`'chop'` (tree) — topple:** tween `angle` 0 → `sign * TREE_FELL_ARC_DEG` over `TREE_FELL_MS`,
      ease-in (accelerating fall), then alpha 1 → 0 over the last `TREE_FELL_FADE_MS`; destroy on
      complete. **Lean sign (resolves Finding 2):** `sign = Math.sign(facing.dCol) || Math.sign(facing.dRow) || 1`
      — never 0, so a worker standing directly above/below the tree still gets a real topple, not a
      rotation-less fade.
    - **`'mine'` (rock) — crumble:** 2-3 small position/angle shudder oscillations, then `scale → ~0.7*scale`
      - alpha → 0 over `ROCK_CRUMBLE_MS`; minimal/no rotation.
    - **`'gather'` (bush) — rustle:** fast squash (X up / Y down) + alpha → 0 over `BUSH_RUSTLE_MS`; no
      rotation.
  - `.active`-guard every callback; keep all durations well under `regrowMs` (tree 15000ms) so fell and
    regrow never overlap. The persistent stump is already visible underneath (set by `ResourceNodeManager`
    before the `playFellFx` call).
  - Side effects: none to the regrow path. Confirm the clone's depth matches the node so it never renders
    over actors. A DEV world reset mid-fell must hit `NodeFxManager.reset()` and destroy the clone with
    no console error.
  - Done when: felling a tree drops a toppling trunk that fades to the stump; a rock crumbles; a bush
    rustles away; toppling still works when the worker is directly above/below the tree; DEV world reset
    mid-fell throws no errors.

- [x] **Step 5: Docs + manual verification** `[delegate sonnet]`
  - Outcome: **Docs** (delegated sonnet) — `docs/STATUS.md` gained an additive "Node harvest feel (plan 031)" section (recoil + escalating tremble + per-kind fell via `NodeFxManager`; glow-halo-tracks-motion; camera-shake deferred; names all 10 `config.ts` tunables); `docs/CONVENTIONS.md` gained a "Fx-teardown pattern" bullet (Map-of-tweens per sprite, `.stop()`-before-restart, `.active` guards, `reset()`-destroys vs SHUTDOWN-`destroy()`-drops-refs) citing `CombatFxManager`+`NodeFxManager` as exemplars plus the 3rd-client extraction trigger. **Build/tests** — whole-project `npm run build` (tsc+vite) clean; `npx eslint`/`prettier` clean on touched files; **702/703** unit tests pass (sole failure the pre-existing unrelated `mapRuntime.test.ts` `originOf('the-moon')`). **Visual verification** — the scenario chop-driver is **pre-existing-broken** (see caveats), so drove the REAL `NodeFxManager.playChop`/`playFell` in the live Game scene under real RAF and screenshotted: tree topple (rotates about base away from chopper, then fades), rock crumble (shrink+fade, no rotation), bush rustle (squash+fade, no rotation), per-hit recoil away from the chopper, escalating tremble (subtle by design at ≤1.5px/2°), **settles exactly to rest** (x/y/angle → rest, tween cleared), **reset-mid-fell** throws nothing + `__test` stays responsive, **0 console/page errors** throughout. Production preview build boots to Game+UI with 0 errors (with a boot-tap retry). Touched only `docs/STATUS.md` + `docs/CONVENTIONS.md`.
  - **Pre-existing breakages found (NOT plan 031 — all in the map/scenario/boot harness, none in files plan 031 touched; flagged to Matt):** (1) `mapRuntime.test.ts` `originOf('the-moon')` returns `{78,230}` not `{0,0}` (documented since Step 2). (2) `applyScenario` player-placement no longer lands (physics body moves but logical tile stays stale) → the repo's own `chop.spec.ts`/scenario harvest specs fail with `wood=0`; tied to the committed `the-moon` map-origin change. (3) `scripts/smoke.mjs` boot canary fires a single canvas tap with no retry (unlike `tests/e2e/harness.ts`), so it fails "Game scene never became active" — a preview boot WITH the retry loop reaches Game+UI cleanly (0 errors), so the bundle is healthy; it's a smoke-script robustness gap. (4) Side note: the deterministic `__test.step()` seam doesn't flush tween completion the way RAF does — fine for logic specs, but tween-settle assertions must use real time.
  - `docs/STATUS.md`: terse line — node harvest now has directional per-hit recoil + escalating tremble
    and a per-kind fell (tree topple / rock crumble / bush rustle) via a new `src/scenes/fx/NodeFxManager.ts`;
    glow halo tracks node motion; camera-shake-on-fell (beat 4) deferred. Name the new `src/config.ts`
    tunables.
  - `docs/CONVENTIONS.md`: **name the fx-teardown pattern** (Map-of-tweens keyed per sprite,
    stop-before-restart with `.stop()`, `.active` guards, `reset()`-destroys vs SHUTDOWN-`destroy()`-drops-refs)
    and cite `CombatFxManager` + `NodeFxManager` as the two exemplars; state the **extraction trigger**:
    "when a spell/weapon/on-trigger fx feature arrives (the 3rd client), promote `NodeFxManager`'s
    transient-sprite machinery to a shared surface and consider a named-effect registry keyed from
    `src/data/` — decide against two real clients, not speculatively." (Satisfies "every reusable decision
    goes in the repo" without building the machinery now.)
  - Keep edits terse/high-signal, matching existing doc voice.
  - Side effects: docs only.
  - Done when: STATUS + CONVENTIONS updated; `npm run build` clean; run the game (`/run` or the verify
    skill), chop tree/rock/bush to depletion, confirm all three beats read correctly; boot canary +
    existing tests pass.

## Out of scope
- **Beat 4 — camera shake on fell** (needs a camera/shake dep; fast-follow).
- **A generic effect-DSL / data-driven effect descriptor / named-effect registry** — deferred until the
  first spell/weapon-fx client; `NodeFxManager` is a concrete fx surface, not a framework.
- Particle chips / leaves / dust (no particle system exists yet).
- Any dissolve/wobble **shader** (`hitFlashPipeline` stays the sole shader exception; a shader would
  desync the baked glow halo).
- Regrow grow-in animation (stays today's instant swap).
- New stump art for rock/bush (keep the `stumpColor` tint fallback).
- Changing `chop` for non-player callers / AI harvesters (none exist).

## Critique
Independent fresh-eyes review + advisor consult (2026-07-17). Verdict: mechanically sound and
well-grounded; the one High finding (fx code placed inside a state manager) is resolved by this
revision. All findings folded in:

|#|Finding|Severity|Resolution in this plan|
|-|-------|--------|-----------------------|
|1|Fx tween/clone lifecycle placed inside `ResourceNodeManager`, against the fx-in-`scenes/fx` convention|High|**Resolved** — new `NodeFxManager` in `src/scenes/fx/`, reached via narrow `playChopFx`/`playFellFx` dep closures (Step 2). No generic DSL (both reviews judged premature).|
|2|Topple sign from `dCol` collapses to 0 when worker is directly above/below the tree|Medium|Folded — `sign = sign(dCol) \|\| sign(dRow) \|\| 1` (Step 4).|
|3|Re-chop within 400ms drifts the node off tile-centre|Medium|Folded — snap to true resting transform at each `playChop` start (Step 3).|
|4|Per-hit recoil keeps running on the depletion hit and fights the stump swap|Medium|Folded — `playFell` stops+clears the node's recoil tween first (Steps 2 & 4).|
|5|Not on the stated "Next" roadmap (night-waves/equipment)|Low|Owner's call — accepted; Finding 1's fx surface makes it pay toward the anticipated animation work.|
|6|Zero-facing "instant swap" path unreachable in normal play|Low|Guard kept as defensive; acceptance not gated on a contrived zero-delta test.|
|7|Recoil-sign prose self-contradictory|Low|Fixed — away-from-chopper == `+lastFacing` stated once, in Context and Step 3.|
