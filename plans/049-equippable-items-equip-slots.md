# Equippable Items + Equip Slots (Brand · Bow · Sword)

> Status: planned — run /execute-plan to begin. **Gate 1 open**: plan-only deliverable; stop for
> Matt's review. **Depends on plan 048** (the workbench + `craft` order + `brand`/`bow`/`sword`/`rope`
> items ship there). Split out of the original combined plan after the Gate-2 critique (see
> `## Critique resolution`).

## Summary

The game's first **equippable items** and the **equip-slot** system the HUD has stubbed out since
plan 046 ("no equipment system yet"). Three equip slots — **main hand**, **ranged**, **off hand** —
are surfaced on the toolbar and pack. Tapping an equippable item **toggles equip**; the equipped slot
gets a **yellow outline**. Equip is wired into combat: the **main-hand** item is the active melee
weapon, and the **ranged** slot gates the bow (no bow equipped ⇒ no ranged attack).

The first equippable is the **brand** (a hand-held torch, crafted at the workbench in 048): equipped
in the off hand it **casts light around the player** at night, **drains durability in real time**
while equipped, shows a **durability bar** in the toolbar and pack, and is **destroyed at zero**. The
**bow** and **sword** (also crafted in 048) are the first permanent equippables — no durability,
equip/unequip freely.

Verified by `npm run build`, `npm test` (`Equipment` unit + combat), `npm run e2e` (equip a brand →
light + drain → destroy; craft+equip a bow → ranged fire works), and `npm run smoke`.

## Critique resolution (Gate-2, plan-048-combined)

- **#1 (High) — split.** This is the equip half; crafting is **048** (prerequisite).
- **#3 (Medium) — false "preserves today's combat".** Corrected: today melee is **unarmed**
  (`meleeWeapon` undefined → `UNARMED_MELEE_SHAPE`/`UNARMED_BASE_DAMAGE`) and no `sword` item/stats
  exist. So the **default loadout is EMPTY** (unarmed main hand = today exactly); the **sword is a
  craftable upgrade** with its own `MELEE_WEAPONS.sword` stats (added here).
- **#5 (Medium) — redundant bow.** The **bow is not default-equipped**; crafting it (048) and
  equipping it in the **ranged** slot becomes the first-ranged gate — matching GAME-DESIGN's "first
  ranged weapon is the first real relief." Removing the default bow means ranged fire is disabled
  until a bow is equipped (a deliberate, roadmap-aligned change from today's always-on bow).
- **#4 (Medium) — torch light path.** Implemented by having **`playerLight()` read equipment and
  raise its radius** when a lit brand is equipped — the path `config.ts:163-172` already prescribes
  ("A future off-hand torch just raises this radius"). `playerLight()` (`GameScene.ts:1548`) is
  already in SurvivalClock's night-overlay light union (`GameScene.ts:767`), so no parallel disc.
- **#6 (Low) — don't touch pure `Inventory.Slot`.** Durability lives **only on `Equipment`**; the
  brand is **equip-to-consume** (no partial charge stashed back in the bag), so `Inventory`/`Slot`
  are untouched.
- **#7 (Low) — name clash.** The equippable hand-torch is the **`brand`** item (minted in 048);
  `torch` stays reserved for the future buildable perimeter light.

## Context & decisions

**Locked decisions — do NOT re-litigate:**

- **Three equip slots**: `mainHand` · `ranged` · `offHand`. **Default loadout is empty** (see #3/#5):
  unarmed melee (= today), no ranged until a bow is equipped, empty off hand.
- **Main hand → melee**: the equipped main-hand item maps to a `MELEE_WEAPONS` entry feeding
  `attackShape`/`damage`; empty = unarmed fallback (today's behaviour). **Ranged → bow**: `combat:bow`
  is a no-op unless a bow is in the ranged slot (the `CommandBar` Bow button reflects it).
- **Durability model (#6)**: `ItemDef.durability?` present ⇒ a consumable equippable that depletes in
  real time **while equipped**. Durability lives on the `Equipment` slot only. The brand is
  **equip-to-consume**: equipping removes it from the bag and lights it; **unequipping a lit brand
  extinguishes and discards it** (no partial restash in v1); at **0 durability it is destroyed**
  (slot → null). Permanent equippables (bow/sword, no `durability`) move bag↔slot freely.
- **Brand light (#4)**: a **fixed** raised player-light radius while a lit brand is equipped (smaller
  than the campfire), reverting to `PLAYER_LIGHT_RADIUS` when unequipped/spent. Real-time drain only
  while equipped.

**Key patterns/files to mirror (verified against the current tree):**

- **Item model** (`src/data/types.ts`): add `export type EquipSlot = 'mainHand'|'ranged'|'offHand'`
  and optional `equip?: EquipSlot` + `durability?: number` on `ItemDef`. Set `equip` on the 048 items
  (`sword`→mainHand, `bow`→ranged, `brand`→offHand + `durability`).
- **Weapon stats** (`src/data/weapons.ts`): `MELEE_WEAPONS` (`damage`+`attackShape`) is the melee
  source of truth; `PlayerCharacter` holds one equipped `MeleeWeapon` (undefined = unarmed via
  `UNARMED_*` in `config.ts`). **Add a `sword` entry** here. Equip drives *which* id is active.
- **`Inventory`** (`src/systems/Inventory.ts`): pure, `eventemitter3`, plain-Node testable, **no
  Phaser import**. **Do NOT change `Slot`** (#6). The new **`Equipment`** system mirrors this style
  exactly.
- **Light** (`src/config.ts:163-172` `PLAYER_LIGHT_RADIUS`; `GameScene.ts:1548` `playerLight()`; its
  use in SurvivalClock's union at `GameScene.ts:767`; `SurvivalClock.ts:282-285` erase loop): make
  `playerLight()` return a larger radius when a lit brand is equipped. Fog (`VisionController`,
  `GameScene.ts:750`, fires-only) stays unchanged — the brand reveals the night overlay, not extra
  fog sight (state this as the decision).
- **HUD** (`src/hud/`): `bridge.ts` (sole seam) → `store.ts` (mirror) → components. `Hotbar.tsx`
  already has the equip stub (`slotHasAction`/`activate` — "no equipment system yet") and a slot
  count/cooldown render to mirror for the durability bar + yellow outline. `PackDrawer.tsx` is the
  pack. Combat actions: `combat:attack`/`combat:bow` from `CommandBar.tsx`; `CombatController` owns
  the bow path (`pickBowTarget`, cooldown gate).
- **Config**: `BRAND_DURABILITY` (~100), `BRAND_DRAIN_PER_SEC` (sized so a brand lasts ~90s equipped),
  `BRAND_LIGHT_RADIUS` (~TILE_SIZE × 3.5). Tunable starting points.

**Direction fit**: equip is the spine future gear (armour, tools) reuses; it's kept minimal per the
critique — no paper-doll rendering (that's the deferred plan 010), no bag-durability, no stat trees.

## Steps

- [ ] **Step 1: Item equip model + sword stats + config** `[inline]`
  - `src/data/types.ts`: `EquipSlot` + `equip?`/`durability?` on `ItemDef`.
  - `src/data/items.ts`: set `equip:'mainHand'` on `sword`, `equip:'ranged'` on `bow`,
    `equip:'offHand'` + `durability: BRAND_DURABILITY` on `brand` (all defined in 048).
  - `src/data/weapons.ts`: add a `sword` `MELEE_WEAPONS` entry (`damage`+`attackShape`, e.g.
    `{ reach:1, arc:'wide' }`). Add a mapping item-id→melee-weapon-id (sword→sword).
  - `src/config.ts`: `BRAND_*` tunables.
  - Side effects: `data.test.ts` field validation.
  - Done when: build + `npm test` green; equip fields resolve.

- [ ] **Step 2: `Equipment` pure system** `[inline]`
  - New `src/systems/Equipment.ts` mirroring `Inventory` (extends `eventemitter3`, no Phaser, injected
    lookups). State `Record<EquipSlot, { id: string; durability: number|null }|null>`. API:
    `get(slot)`, `equip(slot,id,durability?)`, `unequip(slot)`, `drain(slot,amount)` →
    `'ok'|'destroyed'`, `slotOf(id)`, `snapshot()`, emits `'change'`. Default loadout = **all empty**.
  - Side effects: new `Equipment.test.ts` (equip/unequip/swap/drain-to-destroy/empty default).
  - Done when: unit tests green.

- [ ] **Step 3: Wire `Equipment` into GameScene + bridge/store** `[inline]`
  - Construct `Equipment` in the scene. Add the **equip toggle** as a scene method: permanent items
    move bag↔slot (spend/add, no durability); the **brand is equip-to-consume** (equip removes 1 from
    the bag + seeds slot durability; unequip discards; drain-to-0 destroys). `bridge.ts`: inbound
    `equip:toggle` (`{ itemId }`), outbound `equipment:changed` (the snapshot incl. per-slot
    durability). Mirror into `store.ts` (`equipment`).
  - Side effects: `bridge.test.ts`; registry/`game.events` only via `bridge.ts`.
  - Done when: emitting `equip:toggle` equips/unequips and the store mirrors it; build green.

- [ ] **Step 4: Toolbar + Pack equip UX (yellow outline + durability bar)** `[inline]`
  - `Hotbar.tsx`: `slotHasAction` true for an equippable; `activate` emits `equip:toggle`; draw a
    **yellow outline** when the item is equipped (read `equipment`); draw a **durability bar** for an
    equipped item with `durability`. `PackDrawer.tsx`: same toggle + outline + bar.
  - Side effects: presentational + the one emit.
  - Done when: tapping brand/bow/sword toggles the outline; the brand's durability renders; smoke green.

- [ ] **Step 5: Equip → combat** `[inline]`
  - Main-hand item → the active `MeleeWeapon` on `PlayerCharacter` (via the Step-1 mapping; empty →
    unarmed = today). Ranged slot gates `combat:bow` in `CombatController` (no bow ⇒ no-op; the
    `CommandBar` Bow button hidden/disabled). Re-sync on `Equipment` `'change'`.
  - Side effects: `CombatController`/`PlayerCharacter`/`CommandBar`; combat unit tests. Empty default
    keeps today's unarmed melee; ranged now gated (update any test asserting always-on bow).
  - Done when: equipping a sword changes melee shape/damage; equipping a bow enables ranged; both
    empty = today's unarmed + no-bow; `npm test` + build green.

- [ ] **Step 6: Brand light + real-time durability drain** `[inline]`
  - Per-frame (GameScene or a tiny `world/` controller): while a lit brand is in the off hand,
    `Equipment.drain(offHand, BRAND_DRAIN_PER_SEC × dt)`; on `'destroyed'` clear the slot + emit
    `equipment:changed`. Make `playerLight()` (`GameScene.ts:1548`) return `BRAND_LIGHT_RADIUS` while
    a lit brand is equipped, else `PLAYER_LIGHT_RADIUS` — the SurvivalClock night-overlay union
    (`:767`) already consumes it, so the disc grows around the player for free. Fog unchanged.
  - Side effects: HUD durability bar (Step 4) animates down; on destroy the slot clears.
  - Done when: equipping a brand enlarges the player's night light, drains visibly, and the brand
    vanishes at 0; e2e asserts drain→destroy.

- [ ] **Step 7: Tests + docs** `[delegate sonnet]`
  - e2e: craft (048) + equip a brand → light + drain → destroy; craft + equip a bow → ranged fire;
    unarmed default = no bow. Docs (terse): `docs/STATUS.md` (equip subsystem), `docs/DECISIONS.md`
    (3 slots, empty default loadout, equip-to-consume durability on Equipment only, brand-via-
    PLAYER_LIGHT_RADIUS, bow-not-default gate), `docs/GAME-MECHANICS.md` (equip + brand), `CLAUDE.md`
    Status one-liner, flip this plan's Status.
  - Done when: `npm run check:all` green; docs match shipped behaviour.

## Out of scope

- **Equipment *rendering*** (paper-doll layers on the player) — deferred plan 010; a held brand/bow/
  sword is not drawn on the body (HUD-slot + light only).
- **Bag-slot durability / stashing a partial brand** — equip-to-consume only (#6). A relightable/
  stashable torch is future work.
- **Armour / tool / stat-effect equippables, off-hand shields** — the `EquipSlot`/`Equipment` model is
  built to grow into these; none are built here.
- **NPC equipment**, **arrows/ammo**, **real item art** — all out of scope (as in 048).
