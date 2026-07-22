# UI / UX Overhaul — pitch & research

Working record for the phone-UI overhaul. The current in-game HUD is hand-placed
Phaser text that grew widget-by-widget and never got a layout system: small type,
hard-coded pixels, no safe-area handling, brittle corner-stacking, and — critically —
nowhere to put depth (there are 3 buildables today and no spells, but many buildings /
spells / weapons are coming). This doc captures the research, the interaction flows, the
build-stack decision, and **three candidate design directions**.

- **Interactive pitch:** [`pitch.html`](./pitch.html) — open in a browser (works on a
  phone). Tap the chips under each phone to move through `Scavenge · Build · Fight ·
  Spells · Night`. The **hotbar** shows in play; **Build** and **Spells** open the
  populated catalogs so you can judge how each direction handles volume. Self-contained,
  no build step, no external hosting.
- **Status (v2):** Twin Grip is the current front-runner (per Matt — likes the always-open
  gamepad). Awaiting a final direction decision (see [Open questions](#open-questions)).
  Nothing built yet — next step is `plan-feature` on the chosen direction.

---

## 1. What the current UI gets wrong

Audit of `src/scenes/hud/*` and `src/ui/*`:

| Area | Problem |
| --- | --- |
| **Readability** | HP/food bars at 8px, hints 8–9px, zoom buttons 24×24 — below the ~44px hit / ~16px-on-screen a phone needs. All text, no icons. Monospace-only. |
| **Layout** | Every widget computes x/y off fixed `BASE_WIDTH/HEIGHT` (360×640). No safe-area insets, no landscape, no reflow beyond `Scale.FIT` letterboxing. |
| **Clutter** | Top-right column (BUILD→CANCEL→ITEMS→DEMOLISH) manually offset; adding a button re-tunes neighbours. A dead, dimmed SPELL slot already occupies screen space. |
| **No tokens** | `theme.ts` has colours + one font size; every gap/pad/size is a local literal. "Retune the whole look" isn't really possible. |
| **Scale** | No menu structure that holds depth. With dozens of buildings and a spell roster coming, three cost-labelled rows won't do. |
| **Interaction** | `SlotGrid` inventory is display-only (no select/drag/equip — deferred). No hotbar for quick-swapping a weapon or downing a potion mid-fight. |

Design intent already on record (`docs/GAME-DESIGN.md`): mobile-first, portrait, touch
baseline; "the day must be legible"; left-thumb movepad + right-thumb action cluster for
combat; telegraphed attacks + attention-scoped monster HP to avoid clutter.

---

## 2. What good phone survival UIs do (research)

Distilled from Don't Starve: Pocket Edition, Kingdom Two Crowns, Last Day on Earth,
The Long Dark and Whiteout Survival, plus the mobile-UX literature. Ten principles that
drove the designs:

1. **Two layouts, not one rotation.** Portrait = one thumb from a bottom corner;
   landscape = move-left / act-right like a gamepad. Offer a left/right-hand mirror.
2. **Interactive lives in the bottom 30–40%.** On a modern 6.5″ phone only the bottom
   half is comfortably one-hand reachable; passive info (time, meters) goes up top.
3. **≥44–48px hit targets, decoupled from art.** A 24px pixel icon carries an invisible
   44px hit rectangle. Biggest single lever for a pixel game.
4. **World and UI are separate layers.** World at integer nearest-neighbour zoom; UI baked
   crisp at a device scale so buttons stay tap-sized whatever the world zoom.
   (`pixelArt:true`, `antialias:false`.)
5. **Respect the notch.** Full-bleed world behind the Dynamic Island; inset controls to the
   safe rectangle via `env(safe-area-inset-*)`. Free in CSS, painful in hand-placed Phaser.
6. **Meters show state + trend, not numbers.** Circular icon-meters; persist only health,
   hunger, day/night; fade the rest in on change. Reserve red for danger only.
7. **The day/night dial is the spine.** Calm by day; surface "night is coming" at dusk;
   promote wave number + enemies-left to prominent overlay at night.
8. **Build = ghost + snap + confirm.** Never place on raw touch-up (finger hides the cell).
   Ghost snaps green/red → nudge → ✔ / ⟳ / cancel → "place again" for wall runs.
9. **Loadout on the quick surface, catalog behind it.** Assign a few favourites to a
   hotbar/wheel for one-tap use; browse the full set in a categorised grid. (See §3.)
10. **Acknowledge every tap; juice key moments.** Micro-scale/flash on press, floating
    "+5 wood", shake, particles — restrained. Haptics are Android-Chrome-only in browser
    (iOS Safari has no `navigator.vibrate`), so treat as progressive enhancement.

> Numbers (44/48px, 8px spacing, integer scaling, safe-area insets) are well corroborated.
> Game-specific claims (exact DS:PE button behaviour, K2C minimalism trade-offs) are from
> reviews/wikis — directionally reliable; validate by playtesting before locking decisions.

---

## 3. Depth without clutter — the loadout vs. catalog model

The real constraint (per Matt): **lots of buildings, and lots of spells/attacks available
at once.** A radial wheel or a single tray tops out around 6–8 items, so every design uses
**two tiers** — and this is where the **hotbar** earns its place.

- **Tier 1 — Loadout (fast, few).** Always one thumb away, one tap to fire: the **hotbar**
  and (in Twin Grip) the **action-wheel petals**. Holds a handful of assigned go-tos — the
  axe, the bow, a Firebolt, a bandage, the wall you're spamming. Mixed content: weapons,
  consumables, and spells share the slots. Long-press a slot to reassign.
- **Tier 2 — Catalog (deep, browsable).** Everything owned, in a **categorised, scrollable
  grid** — the build list (Defense / Survival / Craft), the spellbook, the full pack.
  Opened only when choosing, not while acting. Pick to place/equip now; **pin** to send it
  to the loadout for next time. The catalog scales to hundreds; the loadout never grows
  past a thumb's reach.

The mockups are populated with placeholder content — ~19 buildings across three categories,
8 spells, a 6-slot hotbar (axe / bow / Firebolt / bandage / bomb / meat) — so the volume is
judged, not just a three-button happy path. **These are placeholders**: the real rosters
(Q4 below) will set the true categories.

---

## 4. UX flows (interaction contracts)

The same flows must hold whichever visual direction wins.

- **Build from a deep catalog:** open Build → pick a category tab (Defense/Survival/Craft) →
  scroll, tap a building (cost shown) → ghost snaps green/red → ✔ → **place again** for a
  run → long-press → **pin to hotbar**.
- **Quick-swap & cast in a fight:** move (thumb) + tap a **hotbar** slot to equip/use (axe →
  bow) → fire from the wheel/button (auto-target) → tap the Firebolt slot to cast
  (mana/cooldown) → open **Spells** for the rest.
- **Assign your loadout:** open Spellbook/Pack/Build → find the item → long-press → **Pin**
  (or drag to a slot) → it's now one tap away on the hotbar.
- **Eat / NPC / inspect / command:** hunger ring pulses → tap → eat · tap NPC → Day/Night
  postures · long-press entity → inspect card · tap ground → move/order · two-finger →
  pinch zoom.

---

## 5. Build decision — author the HUD in HTML, not Phaser

**Recommendation: a DOM/React HUD overlay over the Phaser canvas.** The Map Builder
(`src/editor/`) already runs React + Tailwind v4 + shadcn/ui, kept out of the game bundle —
the pipeline is proven. This matters more now: scrollable catalog grids, drag-to-pin, tabs
and safe-area layout are all things the browser gives for free.

- **DOM / React owns:** HUD bars, meters, day/night dial, resource counts; **hotbar**,
  build catalog, spellbook, pack, inspect card, companion & pause menus; scrollable grids,
  drag-to-pin, tabs (reusing the editor's shadcn primitives + Tailwind `@theme` tokens);
  safe-area insets, responsive layout, focus/accessibility.
- **Phaser keeps:** world, camera, entities, lighting; *in-world* markers that must live in
  world space (build ghost + grid snap, target outline, floating combat/gather text,
  monster HP bars, queue markers); gesture mechanics on the canvas (tap / long-press paint /
  pan / pinch) and the twin-thumb move/aim input.
- **Costs:** a thin event bridge (`game.events` ↔ React state); coordinate mapping for the
  few DOM→world actions; Tailwind loads on the game page (scoped; editor proves it). The
  alternative — hand-rolling flexbox, safe-areas, scrollable grids and a token system in
  Phaser — is the exact debt §1 is made of.

Engine choice is **independent** of which look wins; all three directions sit on this stack.

---

## 6. Three directions

Same game, same control set, three philosophies. Live mockups + per-direction control maps
in [`pitch.html`](./pitch.html). Ordered front-runner first.

### C — Twin Grip · *"Two thumbs, always on the sticks."* (front-runner)
The gamepad never leaves: left corner = move ring, right corner = a live action wheel whose
**petals are your loadout** (equipped attacks + spells, one flick each). A slim **hotbar**
rides the bottom edge between the thumbs for weapons/items/spells. The wheel's centre (▦)
opens the deep catalog (spellbook, build list) as a grid **above the still-visible gamepad**.
Build → grid sheet, tabbed Defense/Survival/Craft, scrollable; pick to place, pin to loadout.
Lineage: console twin-stick · radial action games · Diablo Immortal loadout.
**+** gamepad always ready (fastest in a fight); loadout + catalog scales cleanly;
landscape-native, maximises world. **−** highest learning curve; wheel petals hide labels
until learned; most to build & tune (radial + catalog).

### B — Field Kit · *"One bar that becomes whatever the moment needs."* (safe / legible)
A persistent bottom command bar that **morphs by mode**, with the **hotbar** riding just
above it at all times. Scavenge: Build/Pack/Craft/Status; Build: catalog tray +
Rotate/Place/Cancel; Fight: move pad + Attack/Bow/Cast pulled from the hotbar. Deep menus
are tabbed bottom-sheet drawers.
Lineage: Don't Starve: Pocket Edition · Last Day on Earth.
**+** everything discoverable & labelled; one consistent thumb zone + hotbar; gentlest
learning curve. **−** bar + hotbar cost ~22% of screen; least "novel"-feeling; slower than
a live wheel in a fight.

### A — Emberlight · *"Trust the world. Show almost nothing."* (minimal)
Diegetic-first — nearly all game. Meters are small rings that fade when calm; the day/night
dial is the one permanent fixture. A slim **auto-hiding hotbar** sits low-centre; everything
deep (build catalog, spellbook, pack) rises as a full bottom sheet then gets out of the way.
Lineage: Kingdom Two Crowns · The Long Dark.
**+** most immersive, least clutter, best-looking on a small screen; hotbar keeps quick
actions without chrome. **−** can hide decision info (K2C's known flaw); no always-on
gamepad (slower to act); deep menus feel like a context switch.

**Suggested path:** build **C (Twin Grip)** as the base, borrow **B**'s labelled catalog
grids wholesale (same DOM component), and keep a **Field Kit fallback layout** in pocket as
the accessible / low-dexterity option (same data, calmer surface). The **hotbar** is common
to all three — build it first whichever way we lean.

---

## Open questions

1. **Confirm Twin Grip** as the base (with Field Kit catalogs + fallback), or a different
   blend?
2. **Wheel size** — how many petals before the catalog takes over? (Suggest cap at 6 +
   centre.)
3. **Hotbar length & assignment** — 5 or 6 slots? Manual pin only, or auto-populate recent?
4. **Real building/spell rosters** — mockups use placeholders; what's the actual planned
   list so catalog categories are right?
5. **Portrait-only first**, or portrait + landscape from the start (Twin Grip is built for
   both)?

Once a direction is chosen: `plan-feature` → `critique-plan` → `execute-plan`, staged as
event bridge → token system → hotbar + catalog components → the wheel/bar surface →
per-mode wiring.
