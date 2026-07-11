# Day/Night Cycle + Hunger (Survival Slice)

> Status: planned — run /execute-plan to begin.

## Summary

The survival slice from GAME-DESIGN.md's MVP item 4 and the day/night pillar. Adds a **real-time
day/night clock** that auto-advances every frame, drives a full-screen **darkening tint** that
smoothly transitions across dawn/dusk, and exposes a readable **phase state** (`day`/`night`) +
**day count** other systems can query. Adds the **hunger** core need: a meter that ticks down with
time, and — when it hits zero — **starves the player**, draining the health introduced by the combat
slice (plan 003). Food enters the world two ways: a new **edible item** and a **forageable berry-bush
node** (a walkable resource node mirroring the tree/chop machinery). Eating happens through a new
**Health & Wellbeing screen** — an in-HUD overlay showing the hunger + health meters, the player's
**stats** (from combat's stats bag), and a "what's available to eat" list you tap to consume. A
**second, separate overlay** holds the **inventory** (full item list) and an **equipped-items**
section (a display shell — there's no equipment model yet, so equipped slots render empty, ready for
a future equip system). Night is **tint + phase only this slice** — no enemy spawning (that layers on
after combat). Nothing is persisted; all survival state resets on reload (consistent with the
un-saved world today).

## Context & decisions

**Locked with the user:**
- **Time model:** fixed real-time loop (continuous auto-advancing cycle, smooth tint). Because a
  production-speed cycle is untestable via `waitForTimeout`, add debug fast-forward hooks (Step 8)
  mirroring the existing `debug:regenTrees` event so the smoke test can drive the clock/hunger.
- **Night scope:** darkening tint + queryable phase state only. **No enemy waves this slice.**
- **Health:** builds on **plan 003 (combat), assumed executed first.** Plan 003 introduces on
  `GameScene`: a mutable `playerHp` (starts at `playerStats.maxHp`), `damagePlayer(amount: number)`
  (`playerHp = Math.max(0, playerHp - amount)`, emits `player:hpChanged { hp, maxHp }`), and
  **death = `this.scene.restart()`** when `playerHp` hits 0 (no game-over screen, no save). Starvation
  routes damage through `damagePlayer(...)` so it reuses that exact death path. If 003's final field
  names differ at execution time, adapt the references — the contract used here is
  `damagePlayer(n)` + `player:hpChanged` + death-on-zero.
- **Food source:** both — a new edible item **and** a forageable berry-bush node.
- **Persistence:** **runtime-only, none this slice.** Saving only the clock/hunger while the world,
  inventory, walls and position all reset on reload would be incoherent; real persistence lands with a
  full save system later. Do **not** add a `localStorage` survival save.
- **Eat UX:** a **Health & Wellbeing screen** (not a bare eat button): meters for hunger + health,
  the player's **stats** (plan 003's `playerStats: CombatantStats` — maxHp/armour/speed/strength/
  dex/dodge/vision), and an edible-items list; tap an item to eat one unit.
- **Two separate overlays** (user call): overlay A = Health & Wellbeing (needs meters + stats +
  eat); overlay B = **Inventory + Equipped**, a distinct panel opened by its own button, listing the
  full inventory and an **equipped-items display shell**. There is **no equipment model** in the game
  (no equippable items, no slots — plan 003's attack is unarmed Punch), so equipped renders as empty
  placeholder slots wired to display whatever a future equipment model provides; **no equip/unequip
  action this slice.** Both overlays share one reusable in-`UIScene` panel helper (built in Step 6,
  reused in Step 7).

**Codebase seams (file:line anchors current at planning time — reconfirm before editing):**
- **Tick seam:** `src/scenes/GameScene.ts` `override update(_time, delta)` (`:185-206`). Both the idle
  branch (`if (!this.queue.current)` early-return, `:187`) and the busy `switch` return without a
  shared tail, so **anything that must run every frame regardless of worker state (clock advance,
  hunger drain) goes at the TOP of `update()`, above the `:187` early-return.** `delta` (ms) is the
  per-frame unit; the **accumulator pattern** to mirror is `runHarvest`/`runBuild` (`chopElapsed +=
  delta` / `site.progress += delta`, fire on crossing an interval — `:368-393`).
- **Full-screen overlay precedent (the tint):** `GameScene.ts:149` —
  `this.add.rectangle(BASE_WIDTH/2, BASE_HEIGHT/2, BASE_WIDTH, BASE_HEIGHT, 0x000000, 0.2).setDepth(5)`
  (the fog dim). A night overlay is exactly this: a full-screen coloured rect whose alpha you animate.
  Depth map: world content 0–4, fog overlay 5, ghost 6, player 10. A **global** darken must sit
  **above the player** (e.g. `setDepth(15)`) so everything dims uniformly; it is still under the HUD
  because `UIScene` is a separate scene rendered on top. Alpha-ramp model:
  `site.rect.setAlpha(0.35 + 0.55 * progress/BUILD_MS)` (`:387`).
- **Cross-scene comms:** two channels. `this.registry` for initial-state reads (`inventory` `:110`,
  `zoom` `:706`, `following` `:137,726`); `this.game.events` for live updates. GameScene setters write
  **both** (`registry.set` + `emit('*:changed', …)`) so a scene restart re-seeds correctly — mirror
  this for new state. Events emitted: `tasks:changed` (`:333`), `build:modeChanged` (`:572`),
  `zoom:changed` (`:712`), `camera:followChanged` (`:733`). **Teardown:** every `.on` needs a matching
  `.off` in the `SHUTDOWN` block (GameScene `:174-180`, UIScene `:166-172`) or restart double-registers.
- **HUD template:** `UIScene.ts` `BASE_WIDTH=360 × BASE_HEIGHT=640` portrait. Interactive button =
  `Rectangle(...).setStrokeStyle(1, COLORS.ui, 0.6).setInteractive({ useHandCursor: true })` + centred
  `Text` (`fontFamily:'monospace', fontSize:'12px', color:'#e8dcc0'`), **pushed to `this.hudElements`**
  so `hudHitTest` excludes it from world taps (`:53-61`). A **passive readout/meter** (wood counter
  `:41-46`) is a plain rect+text and is **not** pushed to `hudElements`. Live-update pattern:
  seed from `registry` in `create()`, then subscribe to the `*:changed` event. Free HUD space: left
  edge below the queue text (y≳40) and the bottom band between the two bottom corners.
- **Inventory** (`src/systems/Inventory.ts`, extends `Phaser.Events.EventEmitter`, emits `'change'`
  after every mutation; UIScene subscribes to the instance directly, `UIScene.ts:159`): has
  `get/add/has/canAfford/spend/snapshot` but **no `remove`** — eating needs a new
  `remove(id, n=1): boolean` (returns false if `< n` present, else decrement + emit `'change'`).
- **Data pattern** (static def + scene-local runtime wrapper): `src/data/types.ts` —
  `ItemDef {id,name,color}`, `ResourceNodeDef {id,name,maxHp,woodItemId,woodPerHit,regrowMs,color,
  stumpColor}`, `BuildableDef`. `src/data/items.ts` has only `wood`; `src/data/nodes.ts` only `tree`.
  Runtime `TreeNode {id,sprite,def,hp,alive,col,row}` (`GameScene.ts:28-36`) embeds the def by
  reference; `chop()` mutates the instance, never the def; `maxHp` is catalog-only, current `hp` is
  per-instance.
- **Harvest lifecycle (the forage template):** `spawnTrees→addTree` (`:497-511`), `treeAt` hit-test
  (`:542-547`), `actionAt` returns `{kind:'harvest'}` (`:482-485`), live trees block pathing via
  `isBlocked` (`:211-212`), `runHarvest` accumulates `chopElapsed` then `chop()` (`:368-379`); `chop()`
  (`:549-565`) does `hp-=1`, **`this.inv.add(tree.def.woodItemId, tree.def.woodPerHit)`** (the
  item-into-inventory line to mirror), stump tint on depletion, `this.time.delayedCall(regrowMs, …)` to
  regrow.
- **Config** (`src/config.ts`): all tunables live here; `COLORS` `as const` (`:43-51`, comment invites
  expansion). `TILE_SIZE=16`, `BASE_WIDTH/HEIGHT` `:9-10`.
- **Smoke** (`scripts/smoke.mjs`): Playwright vs `npm run preview`; reads
  `window.game.registry.get('inventory')`, `GameScene.debugState()` (`GameScene.ts:643-665`, the
  primary state seam — **add fields here for assertions**), `GameScene.isTileBlocked(col,row)`.
  Taps via `tapBase`/`tapWorld`/`longPressWorld`; assertions are manual `ok()`/`fail()`; page errors
  collected and asserted empty. **Only zoom persists** (`localStorage`, key `mostowa:zoom`) — confirm
  no game-state save exists.

**Direction (README / GAME-DESIGN / DECISIONS):** mobile-first portrait touch, data-driven catalogs,
**systems decoupled from Phaser** (pure modules in `src/systems/`), UI decoupled via `UIScene`,
trunk-based on `master`, programmatic placeholder art first. Hunger is called out as a **core**
Don't-Starve-style pressure (constant, punishes hoarding), and the Health & Wellbeing screen +
"what's available to eat" section are described design intent — this slice builds the first cut of both.

## Steps

- [ ] **Step 1: Day/night clock — pure system, tick, and darkening tint overlay** `[inline]`
  - New pure module `src/systems/daynight.ts` (Phaser-free, alongside `tasks`/`pathfind`/`grid`):
    `export type DayPhase = 'day' | 'night'`; `cycleLengthMs()` = `DAY_MS + NIGHT_MS`; `phaseAt(cycleMs:
    number): DayPhase` (day while `cycleMs < DAY_MS`, else night); `tintAlphaAt(cycleMs: number):
    number` — 0 through the day, ramping up to `NIGHT_MAX_ALPHA` at night, cross-fading over
    `TWILIGHT_MS` at each day↔night boundary (dusk ramp up over the last `TWILIGHT_MS` of day, dawn
    ramp down over the first `TWILIGHT_MS` of day); `dayCountForTotal(totalMs: number): number` =
    `Math.floor(totalMs / cycleLengthMs()) + 1` (day 1 at t=0). Keep every function pure of Phaser and
    of module-level mutable state — pass values in.
  - `src/config.ts`: add `DAY_MS = 120_000`, `NIGHT_MS = 90_000`, `TWILIGHT_MS = 8_000`, and to
    `COLORS` add `night: 0x0a1020` (deep blue-black). Add `NIGHT_MAX_ALPHA = 0.55`. Values are
    tune-by-feel like the combat numbers — pick these as defaults.
  - `GameScene.ts`:
    - Fields: `private clockMs = 0` (total elapsed), `private dayPhase: DayPhase = 'day'`,
      `private dayCount = 1`, `private nightOverlay!: Phaser.GameObjects.Rectangle`.
    - In `create()`, build the overlay right after the fog overlay (`:149`):
      `this.nightOverlay = this.add.rectangle(BASE_WIDTH/2, BASE_HEIGHT/2, BASE_WIDTH, BASE_HEIGHT,
      COLORS.night, 0).setDepth(15).setScrollFactor(0)` (screen-fixed, above the player so the dim is
      global; `setScrollFactor(0)` keeps it pinned as the camera scrolls — verify against how the fog
      rect handles camera scroll and match that approach).
    - At the **TOP of `update(_time, delta)`, above the `:187` early-return**: `this.clockMs += delta`;
      `const cycleMs = this.clockMs % cycleLengthMs()`; set `this.nightOverlay.setAlpha(tintAlphaAt(
      cycleMs))`; compute `phaseAt`/`dayCountForTotal`; when either changes from the stored value,
      update the field, `this.registry.set('dayPhase'/'dayCount', …)` and emit
      `time:changed { phase, dayCount, cycleMs, tNorm: cycleMs / cycleLengthMs() }`. Emit `time:changed`
      on the frame the phase or day flips (the HUD readout in Step 2 also reads `registry` for its
      initial value). Seed `registry.set('dayPhase','day')`/`set('dayCount',1)` in `create()`.
  - Side effects: adds one always-per-frame `setAlpha` — negligible. The overlay must not intercept
    pointers (rectangles aren't interactive unless `setInteractive` is called — confirm it isn't).
    Ensure it sits below `UIScene` (it does — separate scene). Check depth 15 doesn't hide the build
    ghost (depth 6) in a way that matters at night — a dimmed ghost is acceptable.
  - Docs: none yet (batched into Step 8).
  - Done when: `npm run build` is green; running the game visibly darkens toward night and lightens
    toward day on a loop; `debugState()` (extended in Step 8) will expose `clockMs`/`dayPhase`/`dayCount`.

- [ ] **Step 2: Day/night HUD readout** `[delegate]`
  - `UIScene.ts`: add a **passive** readout (plain rect+text, **not** pushed to `hudElements`) showing
    the current phase + day, e.g. `Day 1 ☀` / `Day 1 ☾` (ASCII fallback `Day 1 [day]`/`[night]` if the
    glyph renders poorly at 12px). Place it top-center-ish in free space (below the zoom row / above
    the build indicator — pick a slot that doesn't overlap existing elements; the bottom-center build
    indicator is hidden unless building, top band is partly free). Follow the wood-counter template
    (`:41-46`).
    - Seed initial text from `this.registry.get('dayPhase') ?? 'day'` and `get('dayCount') ?? 1` in
      `create()`.
    - Subscribe to `time:changed` in the listener-registration block (`:160-163`); update the text in
      the handler; **add the matching `.off` in the SHUTDOWN block** (`:166-172`).
  - Side effects: none beyond one more HUD element; verify it doesn't overlap the zoom/follow/build
    widgets at 360px wide.
  - Docs: none (Step 8).
  - Done when: build green; the readout updates from day→night→day and increments the day number each
    full cycle.

- [ ] **Step 3: Edible item + Inventory.remove (food plumbing)** `[delegate]`
  - `src/data/types.ts`: extend `ItemDef` with `nutrition?: number` (present ⇒ edible; the hunger
    restored per unit).
  - `src/data/items.ts`: add `berries: { id: 'berries', name: 'Berries', color: 0x7a2f4a, nutrition:
    25 }`.
  - `src/systems/Inventory.ts`: add `remove(id: string, n = 1): boolean` — if `this.get(id) < n` return
    `false`; else decrement (delete the key if it reaches 0, matching how `spend` leaves the map),
    `this.emit('change')`, return `true`. Mirror `spend`'s structure.
  - Side effects: `ItemDef.nutrition` is optional so `wood` and all existing usage stay valid. No
    caller uses `remove` yet (wired in Steps 5/6). Smoke reads `inventory.get('wood')` — unaffected.
  - Docs: none (Step 8).
  - Done when: build green; `remove` returns false when short and decrements + emits otherwise
    (exercise via a throwaway check or the Step 8 smoke).

- [ ] **Step 4: Forageable berry-bush node (generalise the resource-node system)** `[inline]`
  - Goal: trees and berry bushes are both `ResourceNodeDef` entries differing only in **data**, per the
    data-driven convention.
  - `src/data/types.ts`: rename `ResourceNodeDef.woodItemId → yieldItemId` and `woodPerHit →
    yieldPerHit` (generic yield), and add `blocksPath: boolean` (trees block pathing, bushes don't).
    Keep `stumpColor` (bushes can reuse it as a picked/depleted tint).
  - `src/data/nodes.ts`: update `tree` to the new field names + `blocksPath: true`; add
    `berryBush: { id:'berryBush', name:'Berry Bush', maxHp: 1, yieldItemId:'berries', yieldPerHit: 2,
    regrowMs: 20_000, blocksPath: false, color: <berry-green>, stumpColor: <depleted> }` (single-pick:
    `maxHp:1`).
  - `GameScene.ts`: propagate the rename (`tree.def.woodItemId → yieldItemId`, `woodPerHit →
    yieldPerHit` in `chop()` `:549-565`). Make pathing honour `def.blocksPath`: in `isBlocked`
    (`:211-212`) only count a live node as an obstacle when `node.def.blocksPath` (trees yes, bushes
    no — a bush is walkable). Spawn a few berry bushes: either extend the existing `trees`/`addTree`
    machinery to a shared node list or add a parallel `bushes` spawn that reuses the same
    `TreeNode`-shaped runtime wrapper + the same `treeAt`/`runHarvest`/`chop` path. **Prefer
    generalising to one runtime array** (`nodes: ResourceNode[]`) if the churn is contained; if it
    balloons, add bushes as a second array reusing the identical harvest functions and note the
    duplication for a later cleanup. `actionAt`/`treeAt` must hit-test bushes too so tapping a bush
    yields a `harvest` order.
  - Provide a placeholder bush sprite the same way trees get theirs (a coloured `add.image`/rect at the
    node's tile — check how `addTree` obtains the `'tree'` texture and mirror it, e.g. a generated
    placeholder or a solid-colour rectangle if no bush art is staged; do **not** block on real art).
  - Side effects: pathfinding change means bushes no longer route-block — verify the worker walks
    onto/over a bush tile and still harvests it (it stands adjacent or on it; reuse `reachableAdjacent`
    which already handles reachable stand-tiles). Regrow uses the same `delayedCall(regrowMs)` path.
    The build system's placeability check (can't build on a blocked tile) should still forbid building
    on a bush only if that matches intent — a bush is walkable, so building over it is acceptable;
    confirm the buildable-placement occupancy test doesn't crash on a non-blocking node.
  - Docs: none (Step 8).
  - Done when: build green; tapping a berry bush walks the worker over and harvests `berries` into the
    inventory (visible via inventory), the bush depletes then regrows, and the worker paths **through**
    bush tiles (unlike trees).

- [ ] **Step 5: Hunger need — model, per-frame drain, and starvation → health cascade** `[inline]`
  - New pure module `src/systems/needs.ts` (Phaser-free): `drainHunger(current, deltaMs, drainPerSec,
    max)` → `clamp(current - drainPerSec*deltaMs/1000, 0, max)`; `feed(current, nutrition, max)` →
    `Math.min(max, current + nutrition)`; `isStarving(hunger)` → `hunger <= 0`.
  - `src/config.ts`: add `HUNGER_MAX = 100`, `HUNGER_DRAIN_PER_SEC = 0.4` (≈250 s from full to empty —
    ~1.5 cycles; tune by feel), `STARVE_DAMAGE = 1`, `STARVE_DAMAGE_INTERVAL_MS = 2_000` (1 HP per 2 s
    while starving).
  - `GameScene.ts`:
    - Fields: `private hunger = HUNGER_MAX`, `private starveElapsed = 0`.
    - At the **top of `update()`** (next to the Step 1 clock advance, above the early-return): drain
      `this.hunger = drainHunger(this.hunger, delta, HUNGER_DRAIN_PER_SEC, HUNGER_MAX)`; when the
      integer/rounded displayed value changes, emit `hunger:changed { hunger: this.hunger, max:
      HUNGER_MAX }` and `registry.set('hunger', this.hunger)` (seed both in `create()`). Starvation
      accumulator mirroring the chop-interval pattern: `if (isStarving(this.hunger)) { this.starveElapsed
      += delta; while (this.starveElapsed >= STARVE_DAMAGE_INTERVAL_MS) { this.starveElapsed -=
      STARVE_DAMAGE_INTERVAL_MS; this.damagePlayer(STARVE_DAMAGE); } } else { this.starveElapsed = 0; }`
      — **`damagePlayer` is plan 003's method**; integer damage keeps HP whole and reuses 003's
      death=`scene.restart()` path (a fully-starved player who takes no other damage still dies over
      time, then the scene restarts — hunger resets to `HUNGER_MAX` on restart since it's a field
      re-initialised in `create()`).
    - Add an `eat(itemId: string): boolean` method (used by Step 6): if the item isn't edible
      (`ITEMS[itemId]?.nutrition == null`) or `!this.inv.remove(itemId, 1)`, return false; else
      `this.hunger = feed(this.hunger, ITEMS[itemId].nutrition!, HUNGER_MAX)`, emit
      `hunger:changed`/`registry.set`, return true. Expose it for the Step 6 UI to call (via a
      `game.events` listener, e.g. `needs:eat { itemId }`, registered/torn-down in the
      `:168-180` block — matching the existing event-in pattern like `build:toggle`).
  - Side effects: depends on plan 003 (`damagePlayer`, `playerHp`, death path) being executed. If run
    before 003, `damagePlayer` won't exist — the executor must land 003 first (user's stated
    assumption). The hunger tick runs every frame regardless of worker state (it's above the
    early-return). Confirm no divide-by-zero / NaN when `delta` is large (tab refocus) — `drainHunger`
    clamps, and the `while` starvation loop is bounded because it decrements each iteration.
  - Docs: none (Step 8).
  - Done when: build green; hunger visibly falls over time (via the Step 6 meter or `debugState`);
    forcing hunger to 0 (Step 8 debug hook) starts ticking `playerHp` down every 2 s and eventually
    triggers 003's restart; eating raises hunger.

- [ ] **Step 6: Reusable overlay panel + Health & Wellbeing screen (meters + stats + "what's available to eat")** `[inline]`
  - **Reusable panel helper (built here, reused by Step 7):** factor a small in-`UIScene` overlay
    primitive so both overlays share one implementation — a dimmed full-screen backdrop rect + a
    centred panel rect (both high depth so they sit above other HUD elements) + a close affordance (an
    ✕ button and/or tapping the backdrop) + open/close that manages `hudElements` membership (add the
    backdrop + interactive rows on open so world taps don't leak through; remove/hide on close —
    `hudHitTest` is visibility-aware so hidden elements already don't swallow taps). Only one overlay
    open at a time (opening one closes the other). Keep it a plain object/method group within
    `UIScene`, not a new Phaser scene (simpler; the world keeps running underneath — real-time
    survival). Panels populate their body via a per-overlay render callback.
  - `UIScene.ts`: add a **STATUS** button (interactive, pushed to `hudElements`, button template
    `:53-61`) in a free HUD slot (e.g. top-left under the wood counter, or bottom-left) that toggles
    the Health & Wellbeing overlay via the helper. Panel contents:
    - **Hunger meter:** label + a bar = background rect + foreground rect whose width =
      `barWidth * hunger / HUNGER_MAX` (there's no existing bar widget — the closest analog is
      `site.rect` width/alpha feedback; build a simple two-rect bar). Colour it (e.g. amber), turn it
      red when `isStarving`/near-zero. Seed from `registry.get('hunger') ?? HUNGER_MAX`; live-update on
      `hunger:changed`.
    - **Health meter:** same two-rect bar, seeded from `registry.get('playerHp')`/plan 003's
      `player:hpChanged { hp, maxHp }` event (subscribe to it; if 003 stores HP only via the event and
      not the registry, seed lazily to `maxHp` and fill in on the first event). If plan 003's exact
      HP surface differs, adapt to whatever it emits.
    - **Player stats:** a read-only list of plan 003's `playerStats: CombatantStats`
      (maxHp, armour, speed, strength, dex, dodge, and `vision` if present) rendered as
      `label: value` rows (mirror 003's Inspect-mode stats-panel display style if that's landed).
      These are static this slice (nothing changes them) — read once from `registry.get('playerStats')`.
      **Dependency:** requires GameScene to expose `playerStats` on the registry; if plan 003 doesn't
      already `registry.set('playerStats', this.playerStats)` in `create()`, add that one line as part
      of this step (it's 003's data, surfaced for the HUD).
    - **"What's available to eat" list:** iterate `ITEMS` for entries with `nutrition != null`, show
      each with its live count from `this.inv.get(id)` and its nutrition; make each row interactive
      (button template) — tapping it emits `needs:eat { itemId: id }` (Step 5 handles it) **only when
      count > 0**; rows with 0 render disabled/greyed. Refresh the list counts on the Inventory
      `'change'` event (subscribe to the instance like `refreshWood` does, `:159`) and on
      `hunger:changed`.
    - While the panel is open, its interactive rows/close/backdrop must be in `hudElements` so world
      taps don't leak through; when closed, remove/hide them (respect `hudHitTest`'s visibility-aware
      check — hidden elements already don't swallow taps).
  - **Teardown:** every new `.on` (`hunger:changed`, `player:hpChanged`, Inventory `'change'`) gets a
    matching `.off` in the UIScene SHUTDOWN block (`:166-172`).
  - Side effects: this is the first modal overlay in the HUD (via the reusable helper) — make sure
    opening it doesn't break the existing `hudHitTest` world-tap gating for the buttons underneath
    (they're covered by the backdrop which should itself be in `hudElements`). Verify the panel lays
    out within 360×640 and is thumb-reachable.
  - Docs: none (Step 8).
  - Done when: build green; STATUS opens the screen showing live hunger + health bars, the player
    stat rows, and an edible list; tapping Berries (count>0) decrements the count, raises the hunger
    bar, and closes/stays-open consistently; the bars track live as hunger drains and HP changes.

- [ ] **Step 7: Inventory + Equipped overlay (display shell)** `[inline]`
  - `UIScene.ts`: add a second HUD button (e.g. **BAG** / **INV**, interactive, pushed to
    `hudElements`, button template `:53-61`) in a free slot distinct from STATUS, that opens a second
    overlay **reusing the Step 6 panel helper** (opening it closes the Wellbeing overlay — one at a
    time). Panel contents:
    - **Inventory section:** iterate `this.inv.snapshot()` and render one row per present item —
      item name (from `ITEMS[id].name`), a colour swatch (from `ITEMS[id].color`, like the wood
      counter), and the count. Read-only (no drop/use here; eating stays on the Wellbeing screen).
      Refresh the rows on the Inventory `'change'` event (subscribe to the instance like `refreshWood`,
      `:159`), so foraging/eating updates the list live while it's open. Handle the empty case (no
      items) with a subtle "Empty" line.
    - **Equipped section:** a **display shell only** — render a small fixed set of empty slot boxes
      (e.g. 2–3 rects with a `—`/"empty" label) under an "Equipped" heading, plus a caption like
      "Nothing equipped". Drive it from `registry.get('equipped') ?? {}` (slot→itemId map) so that when
      a future equipment model populates that registry key the same render fills the slots — but this
      slice sets nothing there, so every slot renders empty. **No equip/unequip interaction.**
  - **Teardown:** the Inventory `'change'` subscription (and any panel-specific listeners) get matching
    `.off` in the UIScene SHUTDOWN block (`:166-172`).
  - Side effects: second overlay through the shared helper — verify the "only one open at a time"
    logic and `hudElements` add/remove works when toggling between STATUS and BAG. No new game-state or
    events; purely a read view over `Inventory` + a placeholder. Confirm layout within 360×640.
  - Docs: none (Step 8).
  - Done when: build green; BAG opens a distinct overlay listing all held items with live counts
    (forage a berry → its row/count appears/updates) and an "Equipped" section of empty slots;
    opening BAG closes the Wellbeing overlay and vice-versa.

- [ ] **Step 8: Debug hooks, smoke coverage, and docs** `[inline]`
  - **Debug hooks (so the smoke test can drive a real-time system):** in `GameScene.ts`, add
    `game.events` handlers mirroring `debug:regenTrees` (registered/torn-down `:168-180`):
    `debug:setHunger { value }` (set `this.hunger`, emit `hunger:changed`) and `debug:advanceTime
    { ms }` (add to `this.clockMs`, recompute phase/overlay/day and emit `time:changed`). These are
    dev-only, matching the existing TEMP `⟳ TREES` convention — no HUD button required; the smoke
    driver emits them via `window.game.scene.getScene('Game').game.events.emit(...)` or a small exposed
    helper. Prefer exposing thin methods (`debugSetHunger`, `debugAdvanceTime`) on GameScene for the
    driver to call, consistent with `debugState()`.
  - **`debugState()`** (`GameScene.ts:643-665`): add `hunger`, `dayPhase`, `dayCount`, `clockMs` to the
    returned snapshot so the smoke can assert on them.
  - **`scripts/smoke.mjs`:** extend the existing run (don't add a second harness). Add assertions:
    (a) advance time into night via `debugAdvanceTime`, assert `debugState().dayPhase === 'night'` and
    that the night overlay alpha rose (assert via `debugState()`/a queried alpha, or that a later
    `advanceTime` rolls `dayCount` up); (b) forage a berry bush (tap it via `tapWorld` at a known bush
    tile, `waitForTimeout` for the walk+pick) and assert `inventory.get('berries')` rose; (c) set
    hunger to 0 via `debugSetHunger`, wait > `STARVE_DAMAGE_INTERVAL_MS`, assert `playerHp` (however
    003 exposes it) fell; (d) open STATUS, eat a berry, assert `hunger` rose and `berries` count fell;
    (e) open BAG and assert the inventory overlay is present / shows the held items (a light check —
    e.g. the overlay's item rows reflect `inventory.snapshot()`). Keep the manual `ok()`/`fail()` style
    and the final page-errors-empty assertion.
  - **Docs:**
    - `CLAUDE.md` Status line: append that the survival slice (day/night tint + phase, hunger core +
      starvation→health cascade, forageable food, Health & Wellbeing screen with stats, and a separate
      Inventory + Equipped overlay — equipped a display shell) landed as plan 004; note night is
      tint+phase only (enemies later).
    - `docs/GAME-DESIGN.md`: tick MVP slice item 4's "day/night tint + a survival meter ticking through
      it" as ✅ (day/night + hunger), leaving "short timed wave" as the remaining todo; add a terse note
      under Hunger / Survival systems that the first cut is built (real-time cycle, hunger→health
      cascade via combat's `playerHp`, Health & Wellbeing screen shipped as the eat surface).
    - `docs/DECISIONS.md`: add a dated `[DECIDED]` entry — real-time day/night loop; night = tint+phase
      only this slice; hunger drains combat-owned `playerHp` on starvation; survival state **not**
      persisted (runtime-only) pending a full save system; eat via the Health & Wellbeing screen
      (which also shows player stats); inventory + equipped live in a separate overlay, with equipped a
      **display shell** (no equipment model yet — deferred to a future plan).
    - `docs/WORKFLOW.md` "Smoke-testing the core loop": one line that the smoke now also drives
      day/night + hunger via the `debugAdvanceTime`/`debugSetHunger` hooks.
  - Side effects: debug hooks ship in the build — acceptable (so does `debug:regenTrees`); keep them
    clearly labelled dev-only. Confirm `npm run build` **and** `npm run smoke` (needs `npm run preview`
    running) are both green.
  - Done when: `npm run build` + `npm run smoke` green with the new assertions passing; all four docs
    updated.

## Out of scope

- **Enemy night waves / combat spawning** — night is tint + phase only; waves layer on after combat
  (plan 003) via the phase state this slice exposes.
- **Persistence / save-load** of survival (or any) game state — runtime-only this slice; a full save
  system is a separate later plan.
- **Equipment system** — no equippable items, equip slots, or equip/unequip action this slice. The
  "Equipped" section is a **display shell** driven by a `registry.get('equipped')` map that stays empty;
  a real equipment model (equippable item data, slots, equip flow, combat effect) is a future plan.
- **Additional needs** beyond hunger (warmth, energy, thirst) and the hunger→spoilage/cooking economy —
  hunger + the health cascade only; the Wellbeing screen is built to accommodate more needs later.
- **Cooking / food crafting / spoilage**, multiple food types beyond the one berry item, and food from
  sources other than the berry bush.
- **Real day/night or bush/food pixel art** — placeholder art only (per the art-pipeline decision).
- **NPC companion feeding** (companions consuming food) — depends on the companion system, not built.
- **Daily narrative events** (the day-opens-with-a-choice feature) — separate design, not this slice.
