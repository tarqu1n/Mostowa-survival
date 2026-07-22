# UI / UX Overhaul — pitch & research

Working record for the phone-UI overhaul. The current in-game HUD is hand-placed
Phaser text that grew widget-by-widget and never got a layout system: small type,
hard-coded pixels, no safe-area handling, brittle corner-stacking. This doc captures
the research, the interaction flows, the build-stack decision, and **three candidate
design directions**.

- **Interactive pitch:** [`pitch.html`](./pitch.html) — open in a browser (works on a
  phone). Tap the chips under each phone to move through `Scavenge · Build · Fight ·
  Night · Pack` and see every control in situ. Self-contained, no build step, no external
  hosting.
- **Status:** awaiting a direction decision (see [Open questions](#open-questions)).
  Nothing built yet — next step is a `plan-feature` pass on the chosen direction.

---

## 1. What the current UI gets wrong

Audit of `src/scenes/hud/*` and `src/ui/*`:

| Area | Problem |
| --- | --- |
| **Readability** | HP/food bars at 8px, hints 8–9px, zoom buttons 24×24 — below the ~44px hit / ~16px-on-screen a phone needs. All text, no icons. Monospace-only. |
| **Layout** | Every widget computes x/y off fixed `BASE_WIDTH/HEIGHT` (360×640). No safe-area insets, no landscape, no reflow beyond `Scale.FIT` letterboxing. |
| **Clutter** | Top-right column (BUILD→CANCEL→ITEMS→DEMOLISH) manually offset; adding a button re-tunes neighbours. A dead, dimmed SPELL slot already occupies screen space. |
| **No tokens** | `theme.ts` has colours + one font size; every gap/pad/size is a local literal. "Retune the whole look" isn't really possible. |
| **Reach** | Primary actions live in the top-right red zone; the thumb-friendly bottom band is unused outside combat. Modal panels open dead-centre over the action, no consistent close affordance. |
| **Interaction** | `SlotGrid` inventory is display-only (no select/drag/equip — deferred). Each panel reinvents open/close. |

Design intent already on record (`docs/GAME-DESIGN.md`): mobile-first, portrait, touch
baseline; "the day must be legible"; left-thumb movepad + right-thumb action cluster for
combat; telegraphed attacks + attention-scoped monster HP to avoid clutter.

---

## 2. What good phone survival UIs do (research)

Distilled from Don't Starve: Pocket Edition, Kingdom Two Crowns, Last Day on Earth,
The Long Dark, Whiteout Survival, plus the mobile-UX literature. Ten principles that
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
   Deconstruct is its own confirmed mode.
9. **Combat = auto-target + context action.** An "attack nearest" button with the target
   outlined beats tap-the-enemy; surface weapon-swap only when >1 carried; optional
   move-anywhere joystick.
10. **Acknowledge every tap; juice key moments.** Micro-scale/flash on press, floating
    "+5 wood", shake, particles — restrained. Haptics are Android-Chrome-only in browser
    (iOS Safari has no `navigator.vibrate`), so treat as progressive enhancement.

> Numbers (44/48px, 8px spacing, integer scaling, safe-area insets) are well corroborated.
> Game-specific claims (exact DS:PE button behaviour, K2C minimalism trade-offs) are from
> reviews/wikis — directionally reliable; validate by playtesting before locking decisions.

Key source threads: mobile touch-target guidance (Apple HIG 44pt / Material 48dp / WCAG
44px); The Long Dark HUD design (state+trend meters); Don't Starve Pocket touch combat
(contextual action buttons, auto-target, later-added optional joystick); Kingdom Two Crowns
(diegetic UI and its information-hiding cost); a Phaser-3 iPhone-PWA guide (safe areas,
`viewport-fit=cover`, `100vh`, cap render scale at 2×, probe insets in JS).

---

## 3. UX flows (the interaction contracts)

The same flows must hold whichever visual direction wins.

- **Build a wall run:** tap Build → pick Wall (cost shown) → ghost snaps to grid
  (green/red) → drag to nudge → ✔ Confirm → ⟳ Rotate / **Place again** → worker queues.
- **Hold the line at night:** enemy enters radius / night falls → combat cluster fades in →
  move (thumb) + Attack (auto-target nearest, outlined) → weapon-swap appears only if >1 →
  companion downed → auto-revives at dawn.
- **Eat before you starve:** hunger ring dips to amber, pulses → tap ring (or open Pack) →
  eat list (dimmed if empty) → tap food → ring refills, "+n" floats.
- **Assign the companion:** tap NPC → sheet + dim scrim → Day (Gather/Repair) /
  Night (Guard-here/Follow/Refuel) → Guard-here arms one-tap point placement.
- **Inspect & command:** tap ground = move/order · long-press+drag = paint a queue ·
  long-press entity = inspect card · two-finger = pinch zoom · drag = pan (breaks follow).

---

## 4. Build decision — author the HUD in HTML, not Phaser

**Recommendation: a DOM/React HUD overlay over the Phaser canvas.** The Map Builder
(`src/editor/`) already runs React + Tailwind v4 + shadcn/ui, deliberately kept out of the
game bundle — the pipeline is proven; a DOM-overlay HUD is precedented in-repo.

**DOM / React owns:** HUD bars, meters, day/night dial, resource counts; build tray,
Pack/Craft sheets, inspect card, companion menu, main/pause menus; all buttons, drawers,
modals (reusing the editor's shadcn primitives + Tailwind `@theme` tokens); safe-area
insets, responsive layout, focus/accessibility.

**Phaser keeps:** the world, camera, entities, lighting; *in-world* markers that must live
in world space — build ghost + grid snap, target outline, floating combat/gather text,
monster HP bars, queue markers; gesture mechanics on the canvas (tap / long-press paint /
pan / pinch).

**Why:** nearly every §1 pain point is something the browser gives for free and Phaser
makes you hand-roll (insets, reflow, tokens, crisp accessible text, portrait/landscape).
The `hudHitTest` hack that gates world taps largely disappears — DOM elements capture their
own events; the canvas only sees what falls through.

**Costs to plan for:** a thin event bridge (today's `game.events` bus ↔ React state);
coordinate mapping for the few DOM→world actions (place point, tap-to-eat targeting a world
entity); Tailwind now loads on the game page (scoped; editor proves it). The alternative —
staying in Phaser — means re-implementing flexbox/safe-areas/tokens by hand and maintaining
two UI idioms forever.

The engine decision is **independent** of which look wins; all three directions sit on this
same stack.

---

## 5. Three directions

Same game, same control set, three philosophies (most minimal → most gestural). Full
per-direction control maps and live mockups are in [`pitch.html`](./pitch.html).

### A — Emberlight · *"Trust the world. Show almost nothing."*
Diegetic-first. Screen is nearly all game. Small glanceable meter rings that fade when calm;
day/night dial is the one permanent fixture; build & menus rise as bottom sheets then get
out of the way; firelight brightness *is* the fuel meter.
Lineage: Kingdom Two Crowns · The Long Dark.
**+** most immersive, least clutter, fewest tap targets. **−** can hide decision info
(K2C's known flaw), leans on player discoverability, needs strong diegetic feedback.

### B — Field Kit · *"One bar that becomes whatever the moment needs."* (recommended start)
A persistent bottom command bar that **morphs by mode** — Scavenge shows build/pack/craft/
status; Build swaps to buildable tray + Rotate/Confirm/Cancel; Fight swaps to move joystick
+ Attack/Bow. Meters top-left, dial top-centre, resource chips top-right. Pack/Craft/Status
are tabbed bottom-sheet drawers with real (selectable) slots.
Lineage: Don't Starve: Pocket Edition · Last Day on Earth.
**+** everything discoverable & labelled, one consistent thumb zone, scales to new verbs.
**−** bottom bar costs ~15% of screen, least "novel"-feeling, mode morph needs clear
transitions.

### C — Twin Grip · *"Two thumbs, two wheels, whole screen."*
Console-style, anchored to both bottom corners, portrait **and** landscape from day one.
Left corner = movement ring (appears where the thumb lands); right corner = a radial action
wheel that blooms on hold, petals change by context (gather/build/attack). Build uses a
radial category wheel. Top strip is the only always-on overlay.
Lineage: console twin-stick · radial-menu action games.
**+** maximises world visibility, landscape-native, feels premium. **−** highest learning
curve, radials hide labels until opened, hardest to build & tune.

**Suggested path:** build **B (Field Kit)** as the base (most legible/discoverable, safest
first overhaul), steal **A**'s contextual fade + diegetic fire-meter, and keep **C**'s
corner anchoring in mind so a landscape mode is a later layout swap, not a rewrite.

---

## Open questions

1. **Direction** — A, B, C, or a specific blend?
2. **Portrait-only** for the first pass, or portrait + landscape from the start?
3. **DOM overlay confirmed?** It's the recommendation but a real architectural commitment.
4. **Pixel font or clean font** for HUD text — full pixel identity, or pixel headers +
   clean readable body/numbers?

Once a direction is chosen: `plan-feature` → `critique-plan` → `execute-plan`, staged as
event bridge → token system → HUD layer → per-mode surfaces.
