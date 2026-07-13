# GameScene Decomposition Part 2 (state-owning subsystems)

> Status: deployed

## Summary

Behaviour-preserving continuation of plan 013. GameScene is still **1,385 lines** — plan 013 pulled
out the self-contained concerns (build placement, combat FX, pointer/camera, queue glow, test API)
but deliberately left the **state-owning world subsystems** inline (advisor decision #5: the task
loop stays as the coordination spine). This plan extracts those into **5 more managers** following
the exact plan-013 seam — a class constructed `(scene, deps)` with a narrow closure interface over
scene privates, each wiring its own `once(SHUTDOWN, …)` teardown — plus two one-shot `buildWorld`
setup helpers as free functions. Goal: pull **every state-owning subsystem** out of the god-file.
GameScene lands around **~750–800 lines** — the composition root plus the ~260-line task-loop/combat
spine that decision #5 keeps — down from 1,385 (a ~600-line cut). **The line count is an outcome, not
the acceptance gate:** the gate is "all five state-owners extracted, task-loop/combat glue untouched,
tests green" (see Step 6). **No gameplay changes.** The Tier-2 Playwright suite + the `__test` API /
`debugState()` deep-equal shape are the behavioural contract and must stay green throughout.

New files (naming = plan-013 suffixes; layout = new `world/` + reuse `fx`/`input`, per user decision):

- `src/scenes/world/ResourceNodeManager.ts` — resource-node lifecycle, owns `trees` + `nextTreeId`
- `src/scenes/world/EnemyManager.ts` — enemy lifecycle + AI tick, owns `enemies` + `nextEnemyId`
- `src/scenes/world/SurvivalClock.ts` — day/night + hunger, owns `nightOverlay` + clock/hunger state
- `src/scenes/fx/VisionController.ts` — fog mask + actor culling, owns `fogShape`
- `src/scenes/input/ScenePicker.ts` — stateless sprite raycast (pick/alphaHit/actionAt/inspectAt)
- `src/scenes/world/actorAnims.ts` + `src/scenes/world/groundRenderer.ts` — free setup functions

## Context & decisions

**Reference seam** (mirror exactly): `src/scenes/build/BuildManager.ts`. Constructed fresh in
`buildWorld()`/`create()` each (re)start; constructor builds its GameObjects + wires
`once(SHUTDOWN, () => this.destroy())`; `deps` is a narrow interface of closures over scene privates
(no raw field access, no manager↔manager events — the scene mediates every cross-manager edge).

**Advisor rulings (consulted 2026-07-13, adopted):**

1. **`nightOverlay` → SurvivalClock**, not VisionController. Ownership follows the writer: the clock
   is the *sole* alpha-writer (update tick, `applyClock()`, testApi poke). The fog dim (depth 5,
   masked) and night tint (depth 15, global) are unrelated mechanisms that merely sit adjacent in
   `buildWorld()`. SurvivalClock's constructor takes the whole night-overlay block **including the
   `registry.set('dayPhase'/'dayCount')` seeds**. **It also owns the hunger/starve tick** (same
   shape: plain-data per-frame state + registry + bus), via a `damagePlayer` dep.
2. **`isBlocked` stays a scene method** — a composite over two owners
   (`buildManager.isOccupied() || resourceNodeManager.hasBlockingNode()`); pushing it into a manager
   would create the manager↔manager edge plan 013 avoided, and it feeds pathfinding (the spine).
   **Keep it a `private readonly` arrow field** — it's passed *by reference* into `MonsterTickEnv`
   and testApi, so the binding must survive. Preserve the short-circuit order (occupancy first).
3. **ScenePicker = stateless class-with-deps**, consistent with the seam (better than a free-function
   bag that re-threads accessors at every call site). It wires **no** `once(SHUTDOWN)` — nothing to
   tear down — and its class doc must say so, so the next extraction doesn't cargo-cult a teardown.
   `order`/`enqueue` stay in the scene (the `onTap`/`onPaint` wiring already respects this).
4. **`resetTreesAndEnemies()` + `randomiseWorld()` stay thin scene orchestrators** (cross-manager
   transactions: nodes + enemies + fx cleanup + buildManager reads + `cancelAll`). Each manager gets
   `clearAll({ resetIds })` (or `clearAll()` + `resetIds()`): **`resetTreesAndEnemies` zeroes the id
   counters, `randomiseWorld` does NOT** (documented pre-existing behaviour; ids like `enemy-N` are
   visible in the `debugState` deep-equal — do not unify them). Preserve enemy-destroy order:
   `fx.cleanupActorFx(z.sprite)` **before** `sprite.destroy()`, and the `weapon`/`hands` sprite destroys.
5. **Step order: ResourceNodeManager → EnemyManager → SurvivalClock → VisionController → ScenePicker
   → free-fns + docs.** ScenePicker last so its deps are real manager method refs on day one.
   SurvivalClock↔VisionController have zero coupling (order free); SurvivalClock first shrinks
   `update()`'s top block early. All sequential (every step edits `GameScene.ts` — write-overlapping,
   **no parallelism**).

**Traps to honour in every step:**

- **SHUTDOWN vs Arcade physics** (BuildManager gotcha, its `destroy()` doc): Arcade's World tears
  down *first*, so a manager's `destroy()` may only **drop references / reset plain data** — never
  `group.clear()` or `sprite.destroy()` on scene teardown. **EnemyManager is the at-risk one**
  (physics-bodied monster sprites). Write this rule into each new class doc.
- **`resetState()` shrinkage is the correctness check.** `trees`/`enemies`/id counters/`clockMs`/
  `dayPhase`/`dayCount`/`hunger`/`starveElapsed` are explicitly zeroed there today (L192–220).
  Constructing each state-owner fresh in `buildWorld()` reproduces those resets via field
  initializers — so **delete the corresponding `resetState()` lines in the same step**. Leaving both
  double-resets harmlessly now but rots; leaving neither breaks death-restart.
- **`buildWorld()` construction order is load-bearing.** `spawnTrees()`/`spawnEnemies()` run *before*
  the player exists (L240–241); initial `updateVision()` runs *after* the player (L389). So
  ResourceNodeManager/EnemyManager constructors must **not touch player closures at construction
  time** (call-time resolution is fine — the `hudHitTest`/`this.ui` precedent). VisionController is
  constructed at the current fog-block position, not earlier. Preserve line order block-for-block.
- **Keep `TestApiDeps` stable — do NOT edit `testApi.ts`.** It's already a closure facade; each step
  only re-points the closure *bodies* in `installTestApi()` to delegate to the new managers
  (e.g. `trees: () => this.resourceNodeManager.all()`, `getHunger: () => this.survivalClock.hunger`,
  `updateVision: () => this.visionController.update()`). For `nightOverlay` (a raw-object dep), expose
  it as a `public readonly nightOverlay` field on SurvivalClock and wire
  `nightOverlay: this.survivalClock.nightOverlay` — keeps the `TestApiDeps` shape and `testApi.ts`
  byte-identical. The `DebugState` shape (testApi.ts:34–65) is deep-equal'd by a tripwire spec —
  `enemies`/`enemyModes`/`enemyTiles`/`enemyWeapons` + `hunger`/`dayPhase`/`dayCount`/`clockMs`/
  `nightAlpha` must stay reachable.
- **`wireBus()` context-pairs.** Handlers whose context moves to a manager (`debug:toggleTime` →
  SurvivalClock; `needs:eat` → SurvivalClock; `debug:randomise` stays scene) must mirror the exact
  `on(evt, fn, ctx)` / `off(evt, fn, ctx)` context-pair pattern (see `buildManager.toggleBuild` at
  L418/L432) — or the SHUTDOWN `off()` won't match and listeners leak across restarts.

**Cross-manager edges the scene must wire** (from research): ResourceNodeManager.chop needs a
`repath` dep (regrow re-path) + `tweens`/`time`; EnemyManager needs
`fx.{lungeAt,cleanupActorFx,addCorpse,removeCorpse}` + `onPlayerHurt` + `damagePlayer` + `rng` +
player accessors + `isBlocked`; SurvivalClock needs `damagePlayer` + `inv` (`canAfford`/`spend`);
ScenePicker needs `enemies()`/`trees()`/`allSites()` + `children.getIndex` + `textures`. `isBlocked`,
`repath`, `damagePlayer`, `onPlayerHurt`, `cancelAll`, `attack`, `rng`, the `player` getter and
`playerChar` all **stay** in the scene.

**Direction (CLAUDE.md cross-device rule):** every settled decision goes in the repo — this plan +
the DECISIONS/STATUS updates in the final step are that record. Commands: `npm run check`
(typecheck + lint + unit), `npm run e2e` (Tier-2, the contract), `npm run smoke` (Tier-3).

## Steps

- [x] **Step 1: Extract `ResourceNodeManager` (`src/scenes/world/`)** `[delegate sonnet]`
  - Outcome: Created `src/scenes/world/ResourceNodeManager.ts` (owns `trees`+`nextTreeId`; `deps` =
    `repath()` + `addYield(itemId,n)`; scene plugins via `this.scene`). Re-pointed all consumers in
    `GameScene.ts` (isBlocked composite with occupancy-first short-circuit, BuildManager `hasBlockingTree`,
    TaskGlowRenderer `treeById`/`nodeScale`, `beginCurrent`/`runHarvest`, `pickSpriteAt` → `all()`,
    testApi closure bodies, both `clearAll({resetIds})` sites). Deleted `trees`/`nextTreeId` fields +
    their `resetState()` lines; trimmed unused imports (`ResourceNodeDef`/`TreeNode`/`tileToWorldCenter`).
    `destroy()` drops refs only (Arcade-SHUTDOWN rule in class doc). GameScene **1385→1306** (−79; the
    plan's ~150 was an over-estimate — moved code was compact, gate is structural not line-count).
    `testApi.ts` untouched. Pre-existing `randomiseWorld` id-counter growth preserved (noted, not fixed).
    `npm run check` green (129/129 unit, 0 new lint); `npm run e2e` 38/38 (one unrelated pre-existing
    combat-timing flake in refactor-tripwire, confirmed on baseline + green on isolated reruns).
  - Create `world/ResourceNodeManager.ts` owning `trees: TreeNode[]` + `nextTreeId`. Move
    `spawnTrees` (L1071–1099), `addNode` (L1102–1120), `nodeScale` (L1123–1125), `treeById`
    (L1237–1239), `flashBagFull` (L1242–1248), `chop` (L1250–1270). Expose queries/commands:
    `hasBlockingNode(col,row)` (the `trees.some(t.alive && t.def.blocksPath && …)` predicate),
    `all()`, `treeById`, `nodeScale`, `addNode`, `spawnTrees`, `clearAll({ resetIds })`. **`all()`
    returns the raw array (alive AND dead nodes)** — `pickSpriteAt`/`isBlocked`/glow all do their own
    `if (!t.alive) …` filtering, so filtering inside `all()` would change behaviour.
  - `deps`: `repath()` (chop regrow) + **`addYield(itemId, n)`** — `chop()` calls `this.inv.add(...)`
    (GameScene.ts:1252), so ResourceNodeManager needs a narrow inventory-add closure (mirror
    SurvivalClock's `inv` dep). Scene `tweens`/`time`/`add` are reached via the `scene` ref
    (mirror BuildManager using `this.scene.add`). Import moves: `TILE_SIZE`, `COLORS`, `NODES`,
    `ResourceNodeDef`, `tileToWorldCenter`, `ACTIVE_TILESET`/`resolveTile`. (`CHOP_INTERVAL_MS` stays
    — it's used by `runHarvest`, which stays.)
  - Construct in `buildWorld()` at the current `spawnTrees()` position (L240) — before the player;
    constructor must not touch player. Wire `once(SHUTDOWN)` to drop refs only (no `sprite.destroy`).
  - Re-point consumers: scene `isBlocked` (L627–629) → `resourceNodeManager.hasBlockingNode()`;
    BuildManager `hasBlockingTree` dep (L317) → same; TaskGlowRenderer `treeById`+`nodeScale` deps
    (L330/L333) → manager; `beginCurrent`/`runHarvest` (`treeById`/`flashBagFull`/`chop`) → manager;
    **`pickSpriteAt` (L1023, still scene-resident until Step 5): `this.trees` → `resourceNodeManager.all()`**
    — mandatory, or typecheck goes red the moment the `trees` field moves;
    `installTestApi` `trees()`/`treeById`/`addNode` closures → manager; node-half of
    `resetTreesAndEnemies` (L1132,1140–1141) → `clearAll({ resetIds: true })`; node-half of
    `randomiseWorld` (L1155,1163,1188–1194) → `clearAll({ resetIds: false })` + `addNode` scatter.
  - Delete the `trees`/`nextTreeId` reset lines in `resetState()` (L194–195).
  - Side effects: `isBlocked` is a hot pathfinding predicate — verify pathing/harvest unaffected.
    `chop`'s regrow `repath()` must still fire.
  - Docs: none this step (rolled into Step 6).
  - Done when: `npm run check` + `npm run e2e` green; game runs; GameScene shrinks ~150 lines.

- [x] **Step 2: Extract `EnemyManager` (`src/scenes/world/`)** `[delegate sonnet]`
  - Outcome: Created `src/scenes/world/EnemyManager.ts` (owns `enemies`+`nextEnemyId`; builds
    `MonsterTickEnv` internally so the scene calls a bare `enemyManager.update()`). `deps` = narrow trio
    `playerTile`/`playerPos`/`playerStats` + `dims`/`isBlocked`/`rng`/`onPlayerHurt`/`damagePlayer` + fx
    closures `lungeAt`/`cleanupActorFx`/`addCorpse`/`removeCorpse`. Re-pointed `update()` (both branches),
    `attack()` (`enemyAt`/`killEnemy`), `pickSpriteAt` → `all()`, testApi `enemies()`/`addEnemy` bodies,
    both `clearAll({resetIds})` sites (enemy-destroy order `cleanupActorFx`→weapon→hands→`sprite.destroy`
    preserved). Deleted `enemies`/`nextEnemyId` fields + resetState lines. **SHUTDOWN `destroy()` drops
    refs only** (`this.enemies = []`) — the at-risk Arcade case; class doc spells out why. `rng` wired as
    `() => this.rng()` so DEV `setRng` stays live. GameScene **1306→1230** (−76). `testApi.ts` untouched.
    Pre-existing `randomiseWorld` enemy id-counter growth preserved. `npm run check` green (129/129 unit);
    `npm run e2e` **38/38** including the golden `debugState` tripwire. Post-agent tidy: wrapped the
    env's `isBlocked`/`rng` + the `MonsterCharacter` `rng` arg in arrow closures to clear 3
    `unbound-method` warnings the deps-indirection introduced (behaviour-identical; re-ran e2e 38/38).
  - Create `world/EnemyManager.ts` owning `enemies: MonsterCharacter[]` + `nextEnemyId`. Move
    `enemyAt` (L859–866), `killEnemy` (L904–918), `spawnEnemies` (L1274–1276), `addEnemy`
    (L1278–1290), `updateEnemies` (L1295–1314, builds the `MonsterTickEnv`). Expose: `all()`,
    `enemyAt`, `addEnemy`, `spawnEnemies`, `update(env-less — see below)`, `killEnemy`,
    `clearAll({ resetIds })`. **`all()` returns the raw array (alive AND dead)** — `pickSpriteAt` and
    `updateEnemies` do their own `if (!z.alive) continue`, so filtering in `all()` would change behaviour.
  - `deps`: `playerTile()`, `playerPos()`, `playerStats()` (or a single `player()` accessor),
    `dims()`, `isBlocked`, `rng()`, `onPlayerHurt()`, `damagePlayer(n)`, and the FX closures
    `fx.lungeAt`/`fx.cleanupActorFx`/`fx.addCorpse`/`fx.removeCorpse`; `anims`/`time` via `scene`.
    The manager builds the `MonsterTickEnv` internally from these deps so the scene calls a bare
    `enemyManager.update()`. Import moves: `ENEMIES`, `MonsterCharacter`/`MonsterSpawnOpts`/
    `MonsterTickEnv`, `hurtboxContains`/`hurtboxTiles`/`DEFAULT_HURTBOX`, `enemyDeathKey`.
  - Construct in `buildWorld()` at the `spawnEnemies()` position (L241) — before the player;
    deps resolve player at call time. **SHUTDOWN `destroy()` drops refs / resets plain data ONLY** —
    NO `sprite.destroy()`/body teardown (Arcade already tore down — BuildManager gotcha applies here).
  - Re-point consumers: `update()` L602 + L618 → `enemyManager.update()` (both branches); `attack()`
    (L876,881) → `enemyManager.enemyAt`/`killEnemy`; **`pickSpriteAt` (L1013, still scene-resident
    until Step 5): `this.enemies` → `enemyManager.all()`** — mandatory, same red-typecheck reason as
    Step 1; `installTestApi` `enemies()`/`addEnemy` → manager;
    enemy-half of `resetTreesAndEnemies` (L1133–1139,1142–1143) → `clearAll({ resetIds: true })`
    **preserving `cleanupActorFx`→`sprite.destroy` order**; enemy-half of `randomiseWorld`
    (L1156–1162,1164,1196–1201) → `clearAll({ resetIds: false })` + `addEnemy` scatter.
  - Delete the `enemies`/`nextEnemyId` reset lines in `resetState()` (L196–197).
  - Side effects: `debugState` reads `enemies`/`enemyModes`/`enemyTiles`/`enemyWeapons` via the
    testApi `enemies()` closure — verify the deep-equal tripwire spec still passes.
  - Docs: none this step.
  - Done when: `npm run check` + `npm run e2e` green; enemy AI/lunge/bite/death + randomise work.

- [x] **Step 3: Extract `SurvivalClock` (`src/scenes/world/`)** `[delegate sonnet]`
  - Outcome: Created `src/scenes/world/SurvivalClock.ts` (owns `clockMs`/`dayPhase`/`dayCount`/`hunger`/
    `starveElapsed` + `public readonly nightOverlay`). Constructor builds the night-overlay block +
    seeds `registry.set('dayPhase'/'dayCount'/'hunger')` (the hunger seed moved out of `resetState`).
    Moved `eat`/`onNeedsEat`/`toggleDayNight`/`applyClock` + a `tick(delta)` = the update() day/night +
    hunger + starve block (starve calls `deps.damagePlayer`). `deps` = `damagePlayer`/`canAfford`/`spend`
    (narrow inv closures, not the raw instance). `wireBus` `debug:toggleTime`/`needs:eat` re-pointed to
    `this.survivalClock.<method>, this.survivalClock` on BOTH on+off (methods kept non-arrow so ctx
    binds). testApi getters/setters re-pointed to public mutable fields (plan's documented fallback);
    `nightOverlay: this.survivalClock.nightOverlay`. Deleted the resetState survival block + 6 fields.
    `destroy()` is a documented no-op (nightOverlay is readonly → can't null; Phaser destroys the rect on
    SHUTDOWN, fresh clock rebuilds it — no leak). Imports moved out: `COLORS`/`DAY_MS`/`TWILIGHT_MS`/
    `HUNGER_*`/`STARVE_*`/daynight fns/needs fns; `ITEMS`+`MAP_WIDTH/HEIGHT` stay (other uses) + imported
    in the manager. GameScene **1230→~1107** (−~123). `testApi.ts` untouched. `npx eslint` new file 0
    warnings; `npm run check` green (129/129 unit, **78-warning baseline unchanged**); `npm run e2e`
    **38/38** first run (no flake), incl. survival-daynight/hunger/forage + golden `debugState` tripwire.
  - Create `world/SurvivalClock.ts` owning `clockMs`/`dayPhase`/`dayCount`/`hunger`/`starveElapsed`
    **and `public readonly nightOverlay`**. Constructor builds the night-overlay block (L399–404)
    **including `registry.set('dayPhase','day')`/`('dayCount',1)`**. Move `eat` (L842–850),
    `onNeedsEat` (L853–855), `toggleDayNight` (L1209–1215), `applyClock` (L1222–1235), and expose a
    `tick(delta)` that runs the day/night + hunger block from `update()` (L550–587) — including the
    starve loop calling the `damagePlayer` dep. Expose getters/setters the testApi needs
    (`clockMs`/`dayPhase`/`dayCount`/`hunger` get+set, `starveElapsed` set).
  - `deps`: `damagePlayer(n)`, `inv` (`canAfford`/`spend`) — reach `registry`/`game.events`/`add` via
    `scene`. Import moves: `DAY_MS`, `TWILIGHT_MS`, `HUNGER_MAX`, `HUNGER_DRAIN_PER_SEC`,
    `STARVE_DAMAGE`, `STARVE_DAMAGE_INTERVAL_MS`, `COLORS`, `MAP_WIDTH`/`MAP_HEIGHT`;
    `cycleLengthMs`/`phaseAt`/`tintAlphaAt`/`dayCountForTotal`/`DayPhase`; `drainHunger`/`feed`/
    `isStarving`; `ITEMS`.
  - Construct in `buildWorld()` at the current night-overlay position (L399). Wire `once(SHUTDOWN)`
    to drop the overlay ref only.
  - Re-point consumers: `update()` top block (L550–587) → `survivalClock.tick(delta)`; `wireBus`
    `debug:toggleTime`→`survivalClock.toggleDayNight` and `needs:eat`→`survivalClock.onNeedsEat`
    **with matching on/off context-pairs**; `installTestApi` — `nightOverlay` →
    `this.survivalClock.nightOverlay`, survival getters/setters → manager, and the
    `registry.set('hunger')` seed at `resetState` L219 moves into the manager (constructor seeds it).
  - Delete the survival reset block in `resetState()` (L209–219).
  - Side effects: `debugState` reads `hunger`/`dayPhase`/`dayCount`/`clockMs`/`nightAlpha`; UIScene
    Wellbeing screen reads the `hunger`/`dayPhase`/`dayCount` registry keys + `time:changed`/
    `hunger:changed` events — verify day/night tint, hunger drain, eat, starve-death, and the dev
    "toggle time" button all behave identically.
  - Docs: none this step.
  - Done when: `npm run check` + `npm run e2e` green; day/night + hunger + eat + starve unchanged.

- [x] **Step 4: Extract `VisionController` (`src/scenes/fx/`)** `[delegate sonnet]`
  - Outcome: Created `src/scenes/fx/VisionController.ts` (owns `private readonly fogShape`; builds the
    fog block — hidden Graphics + inverted geometry mask + depth-5 masked dim rect + initial `update()`
    — in the constructor). `deps` = `getPlayerSprite()` + `getVision(): number | undefined` (manager
    applies the `PLAYER_START_VISION` fallback itself, so that import moved fully out of GameScene).
    `updateVision`→`update()`, `inVisionRange` kept private. Re-pointed both `update()` call sites +
    the testApi `updateVision` closure; deleted the `fogShape` field + both methods; dropped the now-
    unused `PLAYER_START_VISION` import (`MAP_WIDTH/HEIGHT` kept — used elsewhere). Constructed in
    `buildWorld()` at the old fog-block position (after player, immediately before SurvivalClock).
    `destroy()` is a documented no-op (`fogShape` is `readonly`, mirroring SurvivalClock). `nightOverlay`
    untouched (verified by grep); no `resetState()` lines to delete (vision has no reset state). `scene`
    kept as a plain (non-stored) constructor param — nothing needs it past construction. `testApi.ts`
    untouched. `npm run check` green (129/129 unit, **78-warning lint baseline unchanged, 0 new**);
    `npm run e2e` **38/38** first run (no flake), incl. golden `debugState` tripwire. GameScene
    **1107→1081** (−26).
  - Create `fx/VisionController.ts` owning `fogShape`. Constructor builds the **fog block only**
    (L382–389: graphics + inverted geometry mask + the depth-5 masked dim rect + initial
    `updateVision()`). Move `updateVision` (L1367–1376) as `update()` and `inVisionRange` (L1379–1384).
    **Do NOT take `nightOverlay`** (SurvivalClock owns it — Step 3).
  - `deps`: `getPlayerSprite()`, `getVision()` (`playerChar.stats.vision ?? PLAYER_START_VISION`).
    Import moves: `PLAYER_START_VISION` (+ `MAP_WIDTH`/`MAP_HEIGHT` for the fog rect — note these are
    also needed by SurvivalClock/groundRenderer; just import in each).
  - Construct in `buildWorld()` at the current fog-block position (L382) — after the player exists.
    Wire `once(SHUTDOWN)` to drop the `fogShape` ref only.
  - Re-point consumers: `update()` L601 + L617 → `visionController.update()`; `installTestApi`
    `updateVision` → manager.
  - Side effects: fog masks static content (ground/trees/walls) + hides the player outside vision —
    verify the vision hole tracks the player and actors cull correctly.
  - Docs: none this step.
  - Done when: `npm run check` + `npm run e2e` green; fog-of-war behaves identically.

- [x] **Step 5: Extract `ScenePicker` (`src/scenes/input/`)** `[delegate sonnet]`
  - Outcome: Created `src/scenes/input/ScenePicker.ts` — **stateless** (holds only injected `scene`+`deps`,
    **no `once(SHUTDOWN)`**; class doc spells out the no-teardown rationale so future extractions don't
    cargo-cult one). Moved `actionAt`/`inspectAt` (public) + `pickSpriteAt`/`alphaHit` (private) verbatim;
    swapped `this.enemyManager.all()`/`this.resourceNodeManager.all()`/`this.buildManager.allSites()` for
    `deps.enemies()`/`trees()`/`allSites()`, and `this.children`/`this.textures`/`this.game.events` for
    `this.scene.*`. `deps` = `enemies(): MonsterCharacter[]` + `trees(): TreeNode[]` +
    `allSites(): readonly BuildSite[]`. Constructed in `buildWorld()` right after BuildManager, before
    PointerInputController (deps are real manager refs). Re-pointed onTap/onPaint→`scenePicker.actionAt`,
    onInspect→`scenePicker.inspectAt`, testApi `inspectAt`→picker; `order`/`enqueue` stay scene-owned.
    Removed now-unused GameScene imports (`worldToTile` [kept `tileKey`], `hurtboxContains`/`DEFAULT_HURTBOX`,
    `treeStats`/`wallStats`/`enemyStats`, `PointerPick`); `Action` kept (used by order/enqueue/runHarvest/
    runBuild), imported in both. `testApi.ts` untouched. `npm run check` green (129/129 unit, **78-warning
    lint baseline unchanged, 0 new**); `npm run e2e` **38/38** (first run 37/38 hit the documented
    pre-existing combat-timing flake in `refactor-tripwire`; confirmed via `--repeat-each=3` isolated 3/3 +
    a clean full re-run 38/38, incl. golden `debugState` tripwire). GameScene **1081→995** (−86).
  - Create `input/ScenePicker.ts` — a **stateless** class (no fields, **no `once(SHUTDOWN)`**; class
    doc must state this explicitly). Move `actionAt` (L816–820), `inspectAt` (L977–986), `pickSpriteAt`
    (L1000–1036), `alphaHit` (L1046–1067).
  - `deps`: `enemies()` (→ EnemyManager), `trees()` (→ ResourceNodeManager), `allSites()`
    (→ BuildManager); `children.getIndex`/`textures` via `scene`; `game.events` for the
    `inspect:show`/`inspect:hide` emits. Import moves: `worldToTile`, `hurtboxContains`/
    `DEFAULT_HURTBOX`, `treeStats`/`wallStats`/`enemyStats`, `Action`, `PointerPick`.
  - Construct in `buildWorld()` **after ResourceNodeManager + EnemyManager + BuildManager exist** so
    the deps are real manager method refs.
  - Re-point consumers: PointerInputController deps `onTap`/`onPaint`→`scenePicker.actionAt`,
    `onInspect`→`scenePicker.inspectAt` (L352,362,363); `installTestApi` `inspectAt` → picker.
    `order`/`enqueue` stay scene-owned (the onTap closure keeps calling `this.order`/`this.enqueue`).
  - Side effects: raycast resolves enemy-over-tree-over-site by draw order — verify tap-to-harvest,
    long-press-paint, and inspect-mode taps all still hit the right entity.
  - Docs: none this step.
  - Done when: `npm run check` + `npm run e2e` green; picking/inspection unchanged.

- [x] **Step 6: Free-function setup helpers + docs** `[delegate sonnet]`
  - Outcome: Created `src/scenes/world/actorAnims.ts` (`registerActorAnims(scene: Phaser.Scene)`) +
    `src/scenes/world/groundRenderer.ts` (`drawGround(scene: Phaser.Scene)`) — both plain free functions
    (typed `Phaser.Scene`, not `GameScene`: they only touch base Scene API, no scene privates), moved
    verbatim (`this.anims`→`scene.anims`, `this.add`→`scene.add`; comments/JSDoc preserved). Call sites in
    `buildWorld()`: `drawGround(this)` (L195), `registerActorAnims(this)` (L235, just before the player
    is created). Removed now-unused GameScene imports: `GROUND_CHUNK_ROWS`/`ACTION_ANIM_FRAMERATE`/
    `DEATH_ANIM_FRAMERATE` (config) + the entire `from '../data/tileset'` block (`ACTIVE_TILESET`/
    `resolveTile`/`playerAnimKey`/`enemyWalkKey`/`enemyIdleKey`/`enemyDeathKey`/`pickWeighted`/`Facing`/
    `PlayerState`) — went fully empty, deleted; `MAP_WIDTH`/`MAP_HEIGHT`/`TILE_SIZE` kept (used elsewhere).
    Docs: STATUS.md (plan 015 entry, honest **1385→877**), DECISIONS.md (2026-07-13 entry, all 5 boundary
    rulings), CLAUDE.md scenes bullet (notes `world/`), CONVENTIONS.md manager-pattern bullet (enumerates
    all 5 new managers + the ScenePicker no-teardown exception + free-fn distinction). **Acceptance is
    structural, met:** all 5 state-owners extracted, task-loop/combat spine untouched. Final GameScene
    **995→877** (−118); plan total **1385→877** (−508). The 877 lands above the plan's ~750–800 *estimate*
    — expected (every step under-cut its line estimate; the spine + composition-root + heavy doc comments
    are substantial), and the plan's own critique #1 reframed the figure as an outcome, not a gate.
    `testApi.ts`/`UIScene.ts` untouched. `npm run check` green (129/129 unit, **78-warning lint baseline
    unchanged**, md+prettier clean); `npm run e2e` **38/38** (one appearance of the documented
    combat-timing flake, confirmed via isolated `--repeat-each=3` 3/3 + clean full re-run, incl. golden
    `debugState` tripwire); `npm run smoke` **pass** (agent caught a stale `dist/` from a pre-session
    `vite preview`, rebuilt, re-ran clean).
  - Extract the one-shot `buildWorld` setup blocks to free functions in `world/`:
    `world/actorAnims.ts` → `registerActorAnims(scene)` (the player+enemy anim-registration block
    L245–303; imports `DEATH_ANIM_FRAMERATE`/`ACTION_ANIM_FRAMERATE`, `playerAnimKey`/`enemyWalkKey`/
    `enemyIdleKey`/`enemyDeathKey`/`Facing`/`PlayerState`/`ACTIVE_TILESET`); `world/groundRenderer.ts`
    → `drawGround(scene)` (L1335–1361; imports `MAP_WIDTH`/`MAP_HEIGHT`/`TILE_SIZE`/`GROUND_CHUNK_ROWS`,
    `ACTIVE_TILESET`/`resolveTile`/`pickWeighted`, `Phaser.Textures.FilterMode`). Call them from
    `buildWorld()` at the same positions (`drawGround(this)` at L231; `registerActorAnims(this)` where
    the anim block was).
  - Trim any now-unused imports from `GameScene.ts`; verify the class doc + field comments still read
    true (drop stale references to moved state).
  - **Acceptance is structural, not a line count.** Confirm all five state-owners are extracted and
    the task-loop/combat spine (see Out of scope) is untouched — the resulting ~750–800 lines is the
    *outcome*, not a target to chase. If the file is materially above ~800, look for a missed
    extraction; **do not** cut into the spine to hit a number.
  - Docs (terse, token-optimised): **`docs/STATUS.md`** — add plan 015 to the feature history
    (GameScene decomposition part 2, 1385→~750–800). **`docs/DECISIONS.md`** — record the 5 boundary
    rulings (nightOverlay→SurvivalClock; isBlocked stays scene arrow-field; ScenePicker
    stateless/no-teardown; dual-cluster methods stay scene orchestrators; manager order). **`CLAUDE.md`**
    architecture map — note `src/scenes/world/` in the scenes bullet. **`docs/CONVENTIONS.md`** — if it
    enumerates the scene managers, add the 5 new ones. Mark this plan `> Status: deployed` at the end.
  - Side effects: none functional (pure moves) — the anim/ground output must be pixel-identical.
  - Done when: `npm run check` + `npm run e2e` + `npm run smoke` green; all 5 state-owners extracted,
    spine untouched (GameScene ~750–800 lines as an outcome); docs updated.

## Out of scope

- **Moving the task loop / combat glue** out of GameScene (`beginCurrent`/`completeCurrent`/`order`/
  `enqueue`/`runHarvest`/`runBuild`/`repath`/`attack`/`damagePlayer`/`killPlayer`/`setMode`/mode
  toggles/`isBlocked`) — plan 013 advisor decision #5 (kept, re-affirmed) says the spine stays.
- **Any gameplay/behaviour change.** Bugs found (e.g. the id-counter growth in `randomiseWorld`) are
  **preserved and noted in the step report, not fixed** — behaviour-preserving only.
- Editing `testApi.ts`, `UIScene.ts`, `systems/`, `data/`, `ui/`, or the `DebugState` shape — this
  plan only re-points closures inside `GameScene.installTestApi()`/`wireBus()`.
- `UIScene.ts` (886 lines) decomposition — a separate future plan if wanted.

## Critique

Fresh-eyes review (2026-07-13). Load-bearing claims verified TRUE: `testApi.ts` needs no edit
(`TestApiDeps.nightOverlay` stays typed `Phaser.GameObjects.Rectangle`, only closure bodies
re-point); `nightOverlay` alpha is written only by the clock; `buildWorld()` construction order is
real; decision #5 is genuinely from plan 013 + DECISIONS.md; the per-step `check`+`e2e`+tripwire
gates are real and behaviour-preserving. Findings #1–#3 folded into the plan above; #4–#5 accepted
as-is.

**Verdict:** Faithful, well-sequenced continuation of the plan-013 seam with real green-test gates
and no one-way doors — the original ~550-line target was unachievable given the spine it keeps
(~750–800 is honest) and two re-point lists had omissions; all three are now fixed in-plan.

|#|Finding|Lens|Severity|Resolution|
|-|-------|----|--------|----------|
|1|~550-line target unreachable given the ~260-line task-loop/combat spine kept (≈750–800 real); numeric done-gate pressured over-extraction into the protected spine|Right-sizing|High|Fixed — target reframed to ~750–800 as an *outcome*; Step 6 gate is now structural ("all 5 extracted, spine untouched")|
|2|`chop()` calls `this.inv.add` (GameScene.ts:1252) but Step 1 dep list omitted inventory|Executability|Medium|Fixed — Step 1 deps now include an `addYield(itemId,n)` closure|
|3|`pickSpriteAt` reads `this.enemies`/`this.trees` but stays scene-resident until Step 5 — absent from Steps 1/2 re-point lists → red typecheck|Executability|Medium|Fixed — Steps 1/2 now re-point `pickSpriteAt` to `resourceNodeManager.all()`/`enemyManager.all()`; `all()` documented to return alive+dead|
|4|"SurvivalClock" owning the hunger tick is a mild misnomer|Naming|Low|Accepted — splitting hunger out would over-decompose|
|5|ScenePicker is a stateless class while actorAnims/groundRenderer are free functions|Alternatives|Low|Accepted — repeated calls + shared deps → class; one-shot → free fn|
