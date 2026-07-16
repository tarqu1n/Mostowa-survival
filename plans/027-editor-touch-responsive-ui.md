# Editor Touch & Responsive UI

> Status: in review

## Summary
Make the dev-only Map Builder usable on a touch phone (primary target: **phone portrait**) with
**full editing parity** — every tool reachable and operable by touch, no keyboard/mouse required —
while also decluttering the desktop UI. The editor today is a fixed three-column desktop shell
(`Toolbar` + resizable Library / Phaser viewport / fixed-width Inspector column) whose input layer
(`EditorScene.ts`) is mouse/keyboard-only: wheel-zoom, middle-button/Space pan, `MouseEvent`
`altKey`/`shiftKey` modifiers, and hover-driven ghosts, with ~25 keyboard shortcuts and no
breakpoints. The work adds a responsive shell (side panels collapse to slide-in **drawers** below a
breakpoint), a per-tool **context bar** that surfaces every keyboard-only action as an on-screen
control, and a Phaser touch-input path (pinch-zoom, two-finger pan, single-finger paint). Desktop
may change where it improves both experiences (user approved), but must stay at least as good.

## Context & decisions

Answers from interrogation:
- **Mobile scope:** full editing parity (every tool usable by touch). **Explicit, revisitable
  decision** (critique #3): full parity for a dev-only tool is the expensive path — free-pixel /
  multi-select on a phone are marginal. Kept because the user chose it; if execution reveals a tool
  that's disproportionately costly to make touch-usable, flag it and confirm rather than grinding.
- **Primary target:** phone **portrait** (changed from landscape at user's request). The game
  renders in a portrait frame, so a portrait editor previews the in-game framing of the map
  directly — better for judging how a map will actually look in play. Portrait is the narrowest
  target, so the toolbar reflow (Step 6) and full-bleed-viewport drawers (Step 8) matter even more,
  and the context bar sits along the **bottom edge** for thumb reach.
- **Tidy-up:** desktop is cluttered too — concrete targets identified in research: the single
  non-wrapping toolbar row (~24 controls) and the four stacked right-column panels
  (Inspector/Layers/Zones/Reference). (User was invited to add specific gripes; fold any in.)
- **Desktop impact:** free to restructure as long as desktop stays at least as good.
- **Touch controls:** a **context bar per tool** (compact action bar that changes with the active
  tool) + persistent undo/redo — NOT one giant always-visible button wall.
- **Pane layout on mobile:** side panels become **collapsible slide-in drawers** over a full-bleed
  viewport.

There are **12 tools** (not 13 — critique #10): pan, brush, eraser, fill, rect, select, place,
portal, collision, zone, shape, terrain (verified in `Toolbar.tsx` TOOLS + `docs/EDITOR.md`).

Key architecture (from research — mirror these patterns):
- **Shell:** `src/editor/EditorApp.tsx` — `flex h-screen flex-col`; `Toolbar` header + body with a
  `ResizablePanelGroup` (Library + Center) and a fixed `<aside className="w-[280px] shrink-0">`
  Inspector column (outside the resizable group). Split persists via
  `useDefaultLayout({ id: 'mostowo-editor-layout' })`.
- **Tabs:** Center `<main>` is a flex column — an `overflow-x-auto` tablist over a `relative flex-1`
  area; every tab panel is mounted at once, `absolute inset-0`, hidden with
  `invisible pointer-events-none` (NEVER `display:none`) so the single `Phaser.Game` is never torn
  down. Tabs: Map (permanent) + World + on-demand Node Types / Object Editor.
- **State:** single Zustand store `src/editor/store/editorStore.ts`
  (`create()(subscribeWithSelector(...))`) is the **sole React↔Phaser bridge** — React uses the
  hook; `EditorScene` reads via `getState()` and `subscribe(selector, listener)`; neither imports
  the other. Mutations route through `HistoryStack` (`store/history.ts`). Scene reacts to
  `mapEpoch` (full reload) / `docRevision` (rebake) counters.
- **Phaser input:** `src/editor/EditorScene.ts` `create()` (~line 227) — `POINTER_WHEEL` zoom (int
  1–4, cursor-anchored `handleWheel`), `POINTER_DOWN/MOVE/UP/UP_OUTSIDE` tool interactions,
  `window` keydown/keyup for Space-pan. `this.input.mouse?.disableContextMenu()`. Modifiers read as
  `pointer.event instanceof MouseEvent && pointer.event.altKey/.shiftKey` (critique verified at
  ~lines 1472/1495/1502/1510/1530/1614/1805, in `handlePointerDown`, `handleShapePointerDown`,
  `commitObjectDrag` and neighbours; Alt=erase/free-pixel, Shift=multi-select). `middleButtonDown()`
  pan. Hover: `updateHover` / `refreshBrushGhost`. Phaser default single pointer — multi-touch NOT
  enabled (no `addPointer`).
- **Keyboard:** `EditorApp.tsx` `window` keydown (Ctrl/Cmd+Z, Delete/Backspace, arrow-nudge, `U`
  underlay, `S` skin-cycle, `R`/Shift+R rotate), guarded against INPUT/TEXTAREA/SELECT focus.
  `src/editor/shortcuts.ts` is **documentation only** (renders the Shortcuts panel; wires nothing) —
  keep it in sync (memory: editor-shortcuts-panel-sync).
- **World tab** (`tabs/WorldViewTab.tsx`) is the exception: already React Pointer Events
  (`onPointerDown/Move/Up`, `setPointerCapture`) + `touch-none`; only its `wheel` zoom
  (`useEffect` ~line 295, non-passive) needs touch attention.
- **Styling:** Tailwind v4 via `@tailwindcss/vite`; single entry `src/editor/editor.css` (imported
  only by `main.tsx` → `editor.html`; the game page never loads it). Palette as `@theme` tokens;
  shadcn semantic vars wired under `:root`; `--radius: 4px`. shadcn primitives in `src/editor/ui/`
  (button, dialog, input, resizable, select, slider, separator, sonner, tooltip) — **no**
  sheet/drawer, popover, dropdown-menu, or tabs primitive yet (this plan adds some).
  `editor.html` has `<meta name="viewport" width=device-width>` but **not** `viewport-fit=cover`.
- Fixed-size overflow offenders: Inspector `w-[280px]` (EditorApp.tsx:291), World tray `w-[180px]`
  (WorldViewTab.tsx:345), toolbar row (Toolbar.tsx:184), Library frame-grid inline
  `gridTemplateColumns: repeat(cols, PREVIEW_PXpx)` (LibraryPanel.tsx:535).

**Direction check (CLAUDE.md):** the project is explicitly "worked on from whatever device is to
hand (often on a phone, mid-journey)" and "Phone-usable" is already a stated goal for the reference
overlay — so a touch-capable editor pulls directly in the project's direction, not against it.

### Modifier-flag semantics (critique #1 — the linchpin resolution)

The store flags are the **sticky source of truth**; a physical Alt/Shift key is a **separate
momentary override OR'd in at read time** — the two never share one boolean. Concretely:

- Store holds sticky toggles: `eraseActive`, `freePixelActive`, `multiSelectActive` (set only by the
  context-bar toggles and their existing meaning).
- Store holds separate momentary fields: `altHeld`, `shiftHeld` (set on keydown, cleared on keyup
  and on `window` blur — the blur-clear applies to these ONLY, never to the sticky toggles).
- `EditorScene` reads *effective* intent as the OR: `erase = eraseActive || altHeld`,
  `multiSelect = multiSelectActive || shiftHeld`, etc. So a keyup/blur can never wipe a toggle the
  bar set, and desktop keyboard feel is byte-identical (hold Alt → erase while held).

This is the design every later step depends on; it replaces the earlier (incorrect) "one shared flag
stays in sync automatically" model.

### Touch verification story (critique #2)

DevTools device emulation does **not** faithfully emulate two independent pointers / pinch. So:
gesture/pinch/two-finger acceptance checks (Steps 3, 5) require **real-device** verification (a phone
on the LAN dev server, or a genuine multi-pointer harness); DevTools emulation is a smoke check only.
Single-pointer paint checks (Step 4) are fine in DevTools.

## Steps

- [x] **Step 1: Responsive foundation (breakpoint hook + CSS)** `[inline]`
  - Outcome: Added `src/editor/hooks/useIsCompact.ts` (matchMedia hook + exported `COMPACT_QUERY`
    = `(max-width: 960px), (pointer: coarse) and (max-width: 1200px)`, SSR-safe `false`). In
    `editor.css`: `#editor-root` 100vh→100dvh + `overscroll-behavior: none`. In `EditorApp.tsx`:
    root `h-screen`→`h-dvh` (comment explains the inner-100vh clip). In `editor.html`: added
    `viewport-fit=cover` to the viewport meta. `touch-action: none` deliberately NOT added (deferred
    to Step 3). Hook not yet consumed anywhere. Verified: tsc + eslint clean; editor dev server boots
    (HTTP 200, no errors), served HTML carries `viewport-fit=cover`. Desktop unchanged (100dvh==100vh).
  - Add a single breakpoint hook `src/editor/hooks/useIsCompact.ts` (create `hooks/` if absent):
    `matchMedia` wrapper returning `true` below a compact threshold (portrait phone through small
    tablet). Match by width AND treat coarse pointers as compact — suggest `(max-width: 960px),
    (pointer: coarse) and (max-width: 1200px)` (a portrait phone's ~390–430px width is well under the
    first clause); subscribe to `change`, SSR-safe default `false`. Export the raw query string too.
  - In `src/editor/editor.css`: `overscroll-behavior: none` on `#editor-root`; switch `#editor-root`
    height from `100vh` to `100dvh`. **Also switch the `EditorApp.tsx` root** off `h-screen` to
    `h-dvh` (or drive height purely from `#editor-root`) — otherwise the inner `100vh` child
    re-introduces the mobile browser-chrome clip (critique #6). Keep palette/token blocks untouched.
    NOTE: `touch-action: none` on the canvas host is deliberately deferred to Step 3 (it lands with
    the JS gesture handlers so there's no dead window where touch is disabled — critique #7).
  - **Edit `editor.html`** viewport meta to add `viewport-fit=cover` (explicit edit, not "confirm" —
    critique #9). Do NOT add `maximum-scale`; unwanted browser zoom is handled by `touch-action` in
    Step 3.
  - Side effects: verify desktop still boots and paints, and the `h-dvh` swap doesn't change desktop
    height (100dvh == 100vh on desktop).
  - Docs: none yet (Step 11).
  - Done when: `useIsCompact()` flips reliably on resize / device-toolbar toggle in DevTools; editor
    boots and paints on desktop unchanged; no inner-100vh clip remains.

- [x] **Step 2: Decouple input modifiers into the store (sticky flag + momentary override)** `[inline]`
  - Outcome: `editorStore.ts` gained sticky toggles `eraseActive`/`freePixelActive`/`multiSelectActive`
    - momentary `altHeld`/`shiftHeld` (all default `false`), with setters
    `setEraseActive`/`setFreePixelActive`/`setMultiSelectActive`/`setAltHeld`/`setShiftHeld`.
    `EditorScene.ts`: all 7 `pointer.event instanceof MouseEvent && .altKey/.shiftKey` reads replaced
    with the OR'd effective read via `getState()` — free-pixel (`freePixelActive || altHeld`) in
    place-decor + `commitObjectDrag`; erase (`eraseActive || altHeld`) in collision/zone/terrain +
    shape restore; multi-select (`multiSelectActive || shiftHeld`) in select. `shape` and `select`
    now fetch the store before the read (reordered). `EditorApp.tsx`: a new `useEffect` installs
    `window` keydown/keyup → set `altHeld`/`shiftHeld` from `e.altKey`/`e.shiftKey` (read fresh each
    event), + `blur` → clear ONLY those two momentary fields (never the sticky toggles); not gated by
    the INPUT-focus guard (modifier intent tracks globally). `middleButtonDown()` pan left untouched
    (desktop). Verified: `grep` finds no `instanceof MouseEvent`/`.altKey`/`.shiftKey` reads left in
    `EditorScene.ts`; tsc clean (0 errors); eslint clean on the 3 files (only pre-existing
    unbound-method warnings at scene lines 230–234); editor dev server boots HTTP 200, no errors. No
    context bar/touch consumer yet — sticky toggles are wired but only set by future Step 9.
  - The linchpin. Implement the **Modifier-flag semantics** from Context & decisions exactly:
    - Add sticky toggles `eraseActive`/`freePixelActive`/`multiSelectActive` (+ setters) and separate
      momentary `altHeld`/`shiftHeld` (+ setters) to `editorStore.ts` (names to match store
      conventions).
    - `EditorScene.ts`: replace EVERY `pointer.event instanceof MouseEvent && .altKey/.shiftKey` read
      (verified ~lines 1472/1495/1502/1510/1530/1614/1805, and any others grep surfaces) with the
      OR'd effective read (`eraseActive || altHeld`, `multiSelectActive || shiftHeld`, …) via
      `getState()`.
    - `EditorApp.tsx` keyboard handler: Alt/Shift keydown → set `altHeld`/`shiftHeld`; keyup → clear
      them; `window` blur → clear `altHeld`/`shiftHeld` ONLY (never the sticky toggles).
  - Side effects: grep ALL `altKey`/`shiftKey`/`middleButtonDown`/`event instanceof MouseEvent` in
    `src/editor/` so none are missed. Confirm no sticky toggle is cleared by blur/keyup.
  - Docs: none yet.
  - Done when: on desktop, Alt-drag still erases / free-pixels and Shift still multi-selects (momentary,
    identical feel); no `MouseEvent`-modifier reads remain in `EditorScene.ts`; the sticky toggles
    exist and are independent of the momentary fields (a blur does not clear them).

- [x] **Step 3: Phaser camera gestures — multi-touch, pinch-zoom, two-finger pan** `[inline]`
  - Outcome: `EditorScene.ts` — added `this.input.addPointer(2)` in `create()`; new fields
    `touchIdsDown` (Set of down touch-pointer ids) + `gesture` ({startDist, startZoom, lastMid} | null).
    Refactored `handleWheel`'s cursor-anchor math into a shared `zoomAnchored(next, screenX, screenY)`
    (wheel now calls it; identical desktop behaviour). New gesture helpers: `twoPointerSpread()`
    (dist+midpoint of the two down touch pointers, ÷0-guarded), `beginGesture()` (cancels in-progress
    tool via `cancelActiveInteraction()`, snapshots pinch baseline), `updateGesture()` (two-finger pan
    by midpoint delta + pinch-zoom snapped to the int MIN..MAX clamp, midpoint-anchored),
    `cancelActiveInteraction()` (aborts stroke/rect/target/portal/object drags + clears previews;
    object drag snaps back via `placeObjects`). Arbitration: `handlePointerDown` tracks touch pointers
    (`pointer.wasTouch` — `pointerType` isn't in Phaser's TS types), and once `touchIdsDown.size >= 2`
    routes to `beginGesture()` and returns (no tool fires); `handlePointerMove` runs `updateGesture()`
    when a gesture is live; `handlePointerUp` untracks the pointer, re-seats (≥2 left) or ends (<2) the
    gesture — the still-down finger fires no new down, so no accidental paint on release. A mouse is
    `wasTouch === false`, never tracked, so desktop can never reach 2. `PhaserViewport.tsx` — host div
    gained `touch-none [&_canvas]:touch-none` (touch-action: none on host + the injected canvas), the
    deferred-from-Step-1 piece. Verified: tsc clean; eslint clean (only the 5 pre-existing
    unbound-method warnings); editor boots HTTP 200; both changed modules transform (200). NOTE: real
    pinch/two-finger acceptance is pending real-device check (critique #2 — DevTools can't emulate two
    pointers); headless checks are a smoke test only. `shortcuts.ts`/docs deferred to Step 11 per plan.
  - Enable multi-touch: `this.input.addPointer(2)` (need ≥2 active pointers).
  - Apply `touch-action: none` to the Phaser host div/class NOW (deferred from Step 1 — lands with
    its handlers, critique #7) so the browser stops hijacking pan/pinch/double-tap-zoom.
  - **Gesture arbitration:** track live pointer count; a two-pointer gesture is camera (pinch+pan), a
    single pointer is a tool interaction (Step 4). Guard so a paint stroke never turns into a zoom
    mid-stroke and vice-versa.
  - **Pinch-zoom:** zoom on the two-pointer midpoint by pinch-distance ratio; reuse the existing
    integer clamp (MIN_ZOOM=1..MAX_ZOOM=4) and cursor-anchor math from `handleWheel` (keep
    `handleWheel` for desktop). Accumulate fractional pinch, snap to int steps.
  - **Two-finger pan:** pan the camera by the midpoint delta — replaces middle-button/Space (both
    kept for desktop). When the active tool is `pan`, single-finger drag also pans.
  - Side effects: don't regress desktop wheel/middle/Space. Watch for Phaser swallowing the second
    pointer. `disableContextMenu` untouched.
  - Docs: none yet.
  - Done when (**real device / multi-pointer harness — not DevTools**, critique #2): two-finger pan
    and pinch-zoom work on the Map viewport; desktop mouse/wheel unchanged.

- [x] **Step 4: Phaser single-finger tool paint + touch ghost** `[inline]`
  - Outcome: `EditorScene.ts` only. Single-finger paint needed **no new dispatch code** — a lone touch
    pointer keeps `touchIdsDown.size == 1`, falls straight through the Step 3 two-finger gesture guard
    into the existing tool dispatch, and Phaser reports `leftButtonDown()` true for a primary touch, so
    every tool's down/move/up (and the Step 2 OR'd erase/free-pixel/multi-select reads) already fire
    identically to a left-click drag. The real work was the **touch-ghost lifecycle** (touch has no
    hover-move): (1) `handlePointerDown` now calls `updateHover(pointer)` when `pointer.wasTouch`, right
    after the pan/leftButton/map guards — a stationary tap gets the same outline+ghost feedback a
    desktop hover gives, and a drag shows the ghost from the first cell not the second; (2) split the
    tool-release body of `handlePointerUp` into a new `dispatchToolPointerUp(pointer)` so the wrapper can
    run a **touch-only** clear (`hoverTile = null`, `hoverGfx.clear()`, `refreshBrushGhost()`) after any
    release branch — otherwise the outline/ghost lingered under an absent finger; the clear also runs
    when a two-finger gesture fully ends (last finger up), and is skipped on gesture re-seat. Both
    additions are gated on `pointer.wasTouch`, so desktop mouse hover/paint is byte-identical. Verified:
    tsc clean (0 errors); eslint clean on the file (only the 5 pre-existing unbound-method warnings at
    lines 244–248); editor dev server boots HTTP 200, EditorScene transforms (200), no errors. NOTE:
    live single-finger paint acceptance across all 12 tools is a DevTools/real-device check (critique
    #2 says DevTools single-pointer is OK here) — pending Matt's device pass; headless is a smoke test.
    shortcuts.ts/docs deferred to Step 11 per plan.
  - Single pointer drives the current tool's down/move/up exactly as a left-click does today (reads
    the effective modifier intent from Step 2's store flags, so erase/free-pixel/multi-select work
    via the context-bar toggles without a keyboard).
  - **Touch ghost:** hover-driven `updateHover`/`refreshBrushGhost` have no touch analogue — show the
    brush ghost at the pointer during a touch drag, and leave/hide the last cell's ghost on touch-up
    (pick least-surprising; goal: user can see what a tap will paint). Don't regress desktop hover.
  - Side effects: exercise every tool by touch (pan/brush/eraser/fill/rect/select/place/portal/
    collision/zone/shape/terrain). Depends on Step 3 (arbitration) + Step 2 (flags).
  - Docs: none yet.
  - Done when: with each tool, single-finger tap/drag paints/places correctly (DevTools single-pointer
    is acceptable here); erase/multi-select honour the store toggles; desktop unchanged.

- [x] **Step 5: World tab pinch-zoom** `[delegate sonnet]`
  - Outcome: `tabs/WorldViewTab.tsx` only. Added capture-phase pointer handlers
    (`onPointerDownCapture/MoveCapture/UpCapture/CancelCapture`) on the canvas div tracking only
    `pointerType === 'touch'` pointers in a `touchPointersRef` Map — capture phase fires before
    `onMapPointerDown`'s `stopPropagation()`, so a 2nd finger on a placed map is still seen. On the 2nd
    touch pointer: cancel any in-progress place/move/pan (`dragRef=null; setPreview(null)`) + snapshot
    pinch baseline (`startDist`, `startZoom`) — mirrors Step 3's `beginGesture`/`cancelActiveInteraction`.
    On move: ratio = `dist/startDist` → clamped/rounded via existing `MIN_ZOOM`/`MAX_ZOOM` + the tab's own
    `setZoom`, **anchored on the two-finger midpoint** reusing the exact wheel-handler scroll-adjust math
    (midpoint substituted for cursor). No two-finger pan (pinch-only scope). Drag guard: `onTrayPointerDown`
    /`onMapPointerDown`/`onCanvasPointerDown`/`onCanvasPointerMove` early-return when
    `touchPointersRef.size >= 2`; drags only start on pointerdown + ref cleared when 2nd finger lands, so
    no accidental place on finger-lift. Desktop byte-identical (mouse is never `touch`, never reaches 2).
    `w-[180px]` tray untouched (Step 8). Verified: tsc clean; eslint clean on the file; editor dev server
    boots HTTP 200, module transforms (200). NOTE: real two-finger pinch acceptance is a real-device check
    (critique #2 — DevTools can't emulate two pointers), pending Matt's device pass; headless = smoke test.
  - In `tabs/WorldViewTab.tsx`, add pinch-zoom alongside the existing `wheel` handler
    (`useEffect` ~line 295) and +/- buttons: track two active pointers via the existing
    `onPointerDown/Move/Up` flow, zoom by pinch-distance ratio about the midpoint, reuse the current
    zoom clamp. The grid/tray already have `touch-none` and `setPointerCapture`.
  - **Pinch-zoom ONLY** — do NOT touch the `w-[180px]` tray here; its compact-collapse is Step 8's
    job (critique #8), so this step has no dependency on the drawer work.
  - Side effects: don't break desktop mouse-drag-to-place / wheel-zoom. Distinguish a two-finger pinch
    from a drag-to-place (pointer count).
  - Docs: none yet.
  - Done when (**real device**, critique #2): World maps place/move and the canvas pinch-zooms by
    touch; desktop unchanged.

- [x] **Step 6: Toolbar declutter + responsive reflow** `[inline]`
  - Outcome: New shadcn primitive `src/editor/ui/dropdown-menu.tsx` (unified `radix-ui` import style
    like `select.tsx`; full set incl. `DropdownMenuCheckboxItem`). `Toolbar.tsx` reworked into reusable
    clusters (`toolStrip`, `paintModeGroup`, `rotateGroup`, `undoRedoGroup`, `overflowMenu(includeKeys)`,
    `dialogs`) arranged per breakpoint via `useIsCompact()`. **Overflow "⋯" menu** (SlidersHorizontal
    trigger, tooltip'd): holds the least-used View controls — the 3 overlay checkboxes + Snap — as
    `DropdownMenuCheckboxItem`s that `preventDefault` on select so the menu stays open while toggling
    several; on compact it also absorbs the Keys action. **Desktop:** grouped one-row layout, gap
    tightened 4→3, overlay/snap checkboxes moved off the row into the overflow menu, Keys stays a discrete
    button, map-name stays flex-1 centred. **Compact:** File collapses to a dropdown (New/Open/Save/Edit),
    undo/redo kept, an always-visible active-tool label, the 12-tool strip + contextual paint-mode/rotate
    in a horizontally-scrollable `flex-1 overflow-x-auto` rail, truncated map-name + dirty dot, overflow
    menu (incl. Keys). **Deviation (plan-permitted):** kept paint-mode/rotate INLINE on desktop rather than
    burying them in the overflow — they're contextual/auto-hiding and are the active tool's primary control;
    Step 9 relocates them to the context bar. Verified: tsc clean, eslint clean (both files), editor dev
    server boots HTTP 200 and both modules transform (200). NOTE: the visual "desktop uncrowded / compact
    no horizontal overflow" acceptance is best eyeballed in-browser by Matt; headless confirms build/serve.
  - `src/editor/Toolbar.tsx`: the primary declutter target. Group the ~24 controls into logical
    clusters (File: New/Open/Save/Edit · History: undo/redo · Tools: the 12-tool strip · Paint
    options: mode/rotate/snap · Overlays: the 3 checkboxes · map-name · Keys). On desktop, tighten
    spacing and move the least-used clusters (overlays, snap, paint-mode) behind a single "⋯"
    popover/menu (add a shadcn `dropdown-menu`/`popover` primitive to `src/editor/ui/` — none exists
    yet) to kill the crowded single row.
  - On compact (`useIsCompact`): collapse to essentials — File (as a menu), undo/redo, the
    active-tool indicator, the tool strip as a horizontally-scrollable rail, and the "⋯" overflow.
    Tool-specific *actions* move to the Step 9 context bar.
  - Side effects: every control stays reachable (relocated, never dropped); tool hotkeys still work;
    dirty-dot / map-name stays visible.
  - Docs: none yet.
  - Done when: desktop toolbar fits without crowding and reads as grouped; at phone-portrait width it
    no longer overflows horizontally and every former control is reachable via menu/drawer/context bar.

- [x] **Step 7: Right-column consolidation into tabs/accordion (desktop declutter)** `[inline]`
  - Outcome: chose **tabs** (user pick). New shadcn primitive `src/editor/ui/tabs.tsx` (unified
    `radix-ui` import style). `EditorApp.tsx`: the right `<aside>` (still `w-[280px] shrink-0`, now a
    `flex flex-col`) swapped its four stacked panels + `Separator`s for a `<Tabs defaultValue="inspector">`
    with a `grid grid-cols-4` `TabsList` (Inspector/Layers/Zones/Reference, `text-xs`) and four
    `TabsContent` panes (`min-h-0 overflow-auto p-3`). All four use **`forceMount` + `data-[state=inactive]:hidden`**
    so every panel stays mounted (only hidden via display:none) — preserves ReferencePanel's fetched
    list + capture-form state and Layers/Zones in-progress renames across tab switches; the change is
    purely presentational. `Separator` import removed (no longer used). Panel internals untouched. The
    `ResizablePanelGroup` + Library split and the single `Phaser.Game`/Center are untouched (only the
    aside changed) so nothing unmounts. Verified: tsc clean, eslint clean (both files), editor boots
    HTTP 200 and both modules transform (200). NOTE: the "tidy one-at-a-time / split still works" visual
    acceptance is best eyeballed in-browser by Matt; headless confirms build/serve.
  - Consolidate the four stacked right-column panels (Inspector/Layers/Zones/Reference) in
    `EditorApp.tsx` into a **tabbed or accordion** container so only one is expanded at a time
    instead of a long scroll. Add a shadcn `tabs`/`accordion` primitive to `src/editor/ui/` if the
    chosen pattern needs one. This is a **desktop-affecting** declutter, kept separate from the
    compact-drawer restructure (critique #5) — it must improve desktop on its own.
  - Keep the panels' existing internals (`panels/InspectorPanel` etc.) intact; only the container
    changes.
  - Side effects: the single `Phaser.Game`/Center must NOT unmount. Desktop split (`ResizablePanelGroup`
    - `w-[280px]` aside) still works; the consolidated container lives inside the same aside for now.
  - Docs: none yet.
  - Done when: on desktop the right column is a tidy tabbed/accordion panel (one section at a time),
    the resizable split still works, and nothing regresses.

- [x] **Step 8: Responsive shell — compact drawers** `[inline]`
  - Outcome: Consulted the **advisor** on keeping the single Phaser Center mounted across the responsive
    branch → chose **Option 1** (branch the body subtree on `isCompact`; the Center remounts ONLY on the
    rare breakpoint flip, which is lossless — map/camera live in the store, scene reloads on create;
    within a mode, tab switch + drawer open/close never remount it). Rejected the "collapsed size-0
    ResizablePanel" option (would corrupt the persisted `mostowo-editor-layout` split from a compact
    session). New shadcn primitive `src/editor/ui/sheet.tsx` (Radix `Dialog`, unified `radix-ui` import
    style, side left/right/top/bottom). `EditorApp.tsx`: extracted the central tabbed pane into a
    module-scope **`CenterPane`** and the Step-7 right column into **`InspectorTabs`** (both rendered by
    each branch). **Desktop branch** = today's exact tree (ResizablePanelGroup Library↔centre + `w-[280px]`
    Inspector aside). **Compact branch** = full-bleed `<CenterPane/>` in a `relative` wrapper with two
    persistent edge-handle buttons (PanelLeftOpen/PanelRightOpen) opening left **Library** / right
    **Inspector** `Sheet`s (`w-[min(85vw,320px)]`, modal so a scrim tap closes without painting through to
    the canvas); drawer open state is local `useState` (auto-closes when the branch unmounts on flip).
    `WorldViewTab.tsx`: `w-[180px]` tray extracted to shared `trayContent`, docked on desktop, a left
    `Sheet` (opened by a "Maps" button in the controls row) on compact. **Flagged (critique #3):**
    drag-to-place from the compact modal tray drawer isn't available (scrim intercepts) — placing world
    maps stays a desktop action, the drawer is view-only on touch; not worth grinding. Verified: tsc clean,
    eslint clean (all files), editor boots HTTP 200 with no errors, all four changed/new modules transform
    (200). NOTE: real drawer/gesture UX + the edge-handle placement near the canvas edge are a real-device
    check (critique #2) pending Matt's pass; headless = build/serve smoke test.
  - `src/editor/EditorApp.tsx`: below the breakpoint (`useIsCompact`), Library and the (now
    consolidated, Step 7) Inspector column become **slide-in overlay drawers** over a full-bleed
    viewport, each opened by a persistent edge toggle/handle (left = Library, right = Inspector);
    tapping the scrim or handle closes. Above the breakpoint, keep the existing `ResizablePanelGroup`
    - fixed Inspector aside (desktop preserved). Add a shadcn `sheet`/drawer primitive to
    `src/editor/ui/` (none exists yet); prefer it over a hand-rolled overlay.
  - Replace the fixed `w-[280px]` with a responsive drawer width (`min(85vw, 320px)` as a drawer;
    keep ~280px docked on desktop). Ensure closed drawers don't steal Phaser pointer events
    (`pointer-events-none` + off-screen).
  - **Also** make the World tab `w-[180px]` tray collapsible on compact (deferred here from Step 5),
    reusing this drawer pattern.
  - Side effects: single `Phaser.Game`/Center stays mounted (`invisible pointer-events-none` pattern)
    — only side panels relocate. Persisted `mostowo-editor-layout` split still applies on desktop.
  - Docs: none yet.
  - Done when: desktop layout unchanged; on phone-portrait the viewport is full-bleed and
    Library/Inspector (and the World tray) open as drawers without tearing down the canvas.

- [x] **Step 9: Per-tool context bar** `[inline]`
  - Outcome: New `src/editor/ContextBar.tsx` — a compact bottom bar (thumb reach, `pb-[max(...,env(safe-area-inset-bottom))]`)
    rendered ONLY in EditorApp's `isCompact` branch (added as a flex-column sibling below the full-bleed
    `CenterPane`, so the viewport stays full-bleed and nothing is obscured). It shows: persistent undo/redo
    (icon buttons, always) at the left; a horizontally-scrollable tool-contextual middle; and underlay-visibility
    - single-node skin-cycle at the right when relevant. Tool-contextual controls: **brush** → rotate ∓90°
    (`rotateBrush`, disabled w/o `brushAsset`) + rotation readout; **collision/zone/shape/terrain** → paint-mode
    gesture (Brush/Rect/Fill, `setPaintMode`) + an erase/invert toggle (`setEraseActive`, per-tool label
    Walkable/Clear/Restore/Erase); **place/select** → free-pixel toggle (`setFreePixelActive`); **select** →
    multi-select toggle (`setMultiSelectActive`) + Delete (`deleteObjects`) + 4-way tile-step nudge
    (`translateObjects`). All toggles are `aria-pressed` + active-bg styled and write the Step-2 STICKY flags,
    so a later Alt/Shift keyup can't wipe them. Gated to `activeTabId==='map'` & a map being open. Buttons are
    h-10/size-10 (`lg`/`icon-lg`) for touch. `EditorApp.tsx`: imports+renders `<ContextBar/>` in the restructured
    compact branch. `Toolbar.tsx`: the compact header no longer renders paint-mode/rotate (relocated here — the
    Step 6 deferral); desktop toolbar keeps them inline (unchanged). **Deviations (behaviour-faithful):** (1) the
    modifier toggles map to the tools where the store flags actually take effect (erase→collision/zone/shape/terrain,
    free-pixel→place/select), not to every tile-paint tool as the plan bullet loosely listed — `eraseActive`/
    `freePixelActive` are no-ops for brush/eraser/fill/rect in `EditorScene`, so surfacing them there would mislead;
    (2) nudge is tile-step (all object kinds), sub-tile 1px nudge stays a keyboard refinement. Verified: tsc clean
    (0 errors), eslint clean (ContextBar/EditorApp/Toolbar), editor dev server boots HTTP 200, all three modules
    transform (200), no transform errors. NOTE: live touch-only acceptance across every tool is Matt's real-device
    pass (critique #2); headless = build/serve smoke test. shortcuts.ts/docs deferred to Step 11 per plan.
  - New component `src/editor/ContextBar.tsx` (mirror Toolbar's shadcn/Tailwind style): a compact
    action bar anchored to the **bottom edge** for thumb reach in portrait, rendering
    **tool-specific** actions from the active tool in the store:
    - brush armed → Rotate (±90°, reuse `R`/Shift+R), erase toggle;
    - any paint tool → erase toggle + free-pixel toggle (write the Step 2 **sticky** flags
      `eraseActive`/`freePixelActive`);
    - select → multi-select toggle (`multiSelectActive`) + Delete + arrow-nudge;
    - underlay → the `U` toggle; node selected → skin-cycle (`S`).
    Plus **persistent** undo/redo (always shown) — so the whole keyboard vocabulary has an on-screen
    equivalent (full touch parity).
  - Toggles are visibly stateful (pressed = active) and write the sticky store flags; because the
    keyboard is a *separate* momentary override (Step 2), tapping a toggle and later pressing/releasing
    Alt/Shift never wipes it (resolves the original critique #1 collision).
  - **Desktop:** show the context bar only when compact. Do NOT render the erase/free-pixel/multi-select
    toggles on desktop (they'd be redundant with the keyboard and keep desktop uncluttered); a slim
    desktop variant, if any, exposes only non-modifier actions (e.g. rotate). This keeps the sticky
    flags touch-only on desktop, so desktop behaviour is exactly today's.
  - Side effects: depends on Step 2 (flags) + Steps 6/7/8 (where actions/layout moved). Keyboard and
    bar both route through the store; no double-handling.
  - Docs: none yet.
  - Done when: touch-only (keyboard/mouse disabled), every keyboard-only action (rotate, erase,
    free-pixel, multi-select, delete, nudge, underlay toggle, skin-cycle, undo/redo) is performable
    from the context bar, and the active tool determines what it shows; desktop stays uncluttered.

- [x] **Step 10: Touch hit-target & spacing polish pass** `[delegate sonnet]` (parallel: A)
  - Outcome: (delegated, sonnet) all 6 dialogs + 5 panels swept, compact-gated via `useIsCompact()`+`cn()`
    (desktop unchanged; the only ungated adds are neutral `max-h-[90dvh] overflow-y-auto` caps on DialogContent).
    Dialogs (`NewMapDialog`/`OpenMapDialog`/`EditMapDialog`/`PortalDialog`/`ShortcutsDialog`/`NodeSpritePickerDialog`):
    `max-h-[90dvh]` scroll caps, `h-11` inputs/selects/buttons on compact, list/thumbnail-grid reflows
    (OpenMap list `max-h-[45vh]`; ShortcutsDialog key column 190→128px; NodeSpritePicker grid 4→3 cols + larger
    swatches + 1.6× region render). Panels: `LibraryPanel` frame-grid offender fixed — new `COMPACT_PREVIEW_PX`
    (22 vs 32px) shrinks grid width without reflowing columns (preserves 1:1 sheet match), applied to
    FavouriteItem/AnimatedStripPicker too; AtlasSheetPicker fit budget 1.4× + real tap-size zoom controls;
    TreeItem/cards/search bumped. `InspectorPanel` fields/selects/batch-action row → `h-11`. `LayersPanel`/`ZonesPanel`
    rows reflow (flex-wrap + CSS order) so name gets its own line and icons flow to a 2nd line at `size-10` (4-5
    icons don't fit at 44px in a ~320px drawer); add-buttons full-width `h-11`. `ReferencePanel` all controls
    compact-sized + bigger slider drag zone. **Noted trade-offs (plan's "note, don't grind"):** favourite-heart
    micro-toggle stays small at 22px swatch; atlas/region hotspots are exact sprite crops (padding would misregister
    the pick) so they got bigger base render + zoom instead of 44px padding; Layers/Zones icons reach 40px not 44px.
    Verified: tsc 0 errors; eslint 0 errors/0 warnings on all 11 changed files; editor boots HTTP 200, all changed
    modules transform (200), clean vite startup. Write-disjoint honoured (no docs/shortcuts.ts/ContextBar/EditorApp/
    Toolbar touched). NOTE: real phone-portrait visual QA is the human's real-device pass; headless = build/serve smoke test.
  - Sweep dialogs + panels for touch-sized targets: `NewMapDialog`, `OpenMapDialog`, `EditMapDialog`,
    `PortalDialog`, `ShortcutsDialog`, `NodeSpritePickerDialog`, and panels `LibraryPanel`,
    `InspectorPanel`, `LayersPanel`, `ZonesPanel`, `ReferencePanel`. On compact: ~44px min touch
    target (bump button/input sizes via `useIsCompact`-gated classes or a shared `size` prop), spacing
    so adjacent controls aren't mis-tapped, and each dialog scrollable within `max-h-[90dvh]`. Make
    the `LibraryPanel` frame-grid (`gridTemplateColumns: repeat(cols, PREVIEW_PXpx)`, LibraryPanel.tsx:535)
    usable on narrow widths (smaller preview / responsive column count) — this matters most in
    portrait, the narrowest target.
  - Purely additive styling — no behaviour changes; compact-gated or neutral so desktop isn't worse.
  - Side effects: WRITE-DISJOINT from Step 11 (TSX panels/dialogs only — never docs/`shortcuts.ts`).
  - Docs: none.
  - Done when: every dialog fits and scrolls within a phone-portrait viewport, controls are
    comfortably tappable, desktop appearance unchanged or tighter.

- [x] **Step 11: Docs + shortcuts sync** `[delegate sonnet]` (parallel: A)
  - Outcome: (delegated, sonnet) `docs/EDITOR.md` — new `## Touch / mobile (plan 027)` subsection (after the
    Brush-tool paragraph) covering the compact breakpoint→drawers, Map-viewport gestures (1-finger paint,
    2-finger pan+pinch-zoom), World-tab pinch-only zoom, the tray-drag-is-desktop-only limitation, and the
    per-tool ContextBar + its sticky-vs-momentary toggle design; states desktop is unchanged. `src/editor/shortcuts.ts`
    — new `Touch / compact shell` `ShortcutGroup` (pure addition, reusing the existing `Shortcut {keys, action}`
    shape so `ShortcutsDialog.tsx` renders it generically — NO `.tsx` touched), cross-referencing which keyboard
    binding each on-screen control mirrors; no keyboard binding removed (verified by additive-only `git diff`).
    `CLAUDE.md` — one clause added to the `src/editor/` architecture-map bullet noting the compact/touch shell,
    `hooks/useIsCompact.ts`, and `ContextBar.tsx` (kept lean, no new bullet). Verified: tsc clean (0 errors),
    eslint clean on shortcuts.ts, diff confirmed additive/write-disjoint from Step 10.
  - `docs/EDITOR.md`: add a concise **Touch / mobile** subsection — breakpoint behaviour (drawers
    below threshold), gestures (single-finger paint, two-finger pan, pinch-zoom, World-tab pinch), the
    per-tool context bar and that it mirrors the keyboard actions, and that desktop is unchanged.
    Terse, high-signal (token-budget rule).
  - `src/editor/shortcuts.ts` + the Shortcuts panel: reflect that keyboard actions now have on-screen
    context-bar equivalents (memory: editor-shortcuts-panel-sync). Don't remove keyboard bindings;
    annotate touch equivalents if the panel format allows.
  - Side effects: WRITE-DISJOINT from Step 10 (only `docs/EDITOR.md` + `shortcuts.ts`). Update the
    CLAUDE.md architecture map only if the shell gained a genuinely notable new top-level piece
    (e.g. `hooks/`, `ContextBar.tsx`) worth indexing — otherwise leave it lean.
  - Docs: this step IS the docs.
  - Done when: EDITOR.md describes the touch model accurately and the Shortcuts panel is in sync.

## Out of scope
- Landscape-phone layout is not the design target (primary target is portrait; landscape may still
  work but isn't designed/tested for).
- A hosted/production editor or shipping the editor in the prod build — it stays dev-server-only.
- Rewriting the Map viewport away from Phaser, or the World tab into Phaser.
- New editor *features* or tools — this is UI/UX + input plumbing only, no new authoring capability.
- Offline/PWA, gamepad, or stylus-pressure support.
- Changing map/world/node file formats or the persistence contract.

## Critique

**Verdict:** Sound approach, accurate code reconnaissance, and genuine roadmap fit — but the "linchpin"
flag model had an unresolved momentary-vs-toggle collision (now fixed via sticky-flag + momentary
keyboard override), and touch acceptance gates weren't verifiable in the stated environment (now
require real-device verification). All findings below have been folded into the steps above.

|#|Finding|Lens|Severity|Resolution|
|-|-------|----|--------|----------|
|1|Momentary keyboard modifiers + sticky context-bar toggles shared one store flag — keyup/blur would silently wipe a toggle; "stay in sync automatically" was false.|Gaps/risks|High|Sticky store flags are truth; Alt/Shift are a separate momentary override OR'd in at read time; blur clears only the momentary fields. Desktop hides the modifier toggles. (Steps 2, 9)|
|2|Touch "Done when" gates relied on DevTools emulation, which can't emulate two independent pointers/pinch.|Executability|Medium|Pinch/two-finger steps require real-device verification; DevTools = smoke check. Single-pointer paint OK in DevTools. (Steps 3, 5)|
|3|"Full parity for all 12 tools on touch" is expensive for a dev-only tool.|Right-sizing|Medium|Kept (user chose it) but recorded as an explicit, revisitable decision; flag disproportionately costly tools during execution.|
|4|Step 3 bundled multi-touch + pinch + two-finger pan + single-finger paint + ghost into one unit.|Scope discipline|Medium|Split into Step 3 (camera gestures) + Step 4 (single-finger paint + ghost).|
|5|Old Step 6 bundled the compact-drawer mechanism with the desktop right-column consolidation.|Scope discipline|Medium|Split into Step 7 (desktop consolidation) + Step 8 (compact drawers).|
|6|`#editor-root: 100dvh` alone left an inner `h-screen` (100vh) child re-introducing the clip.|Consistency|Medium|Also switch the EditorApp root to `h-dvh`. (Step 1)|
|7|`touch-action: none` in Step 1 landed before the JS handlers → dead touch window.|Sequencing|Low|Deferred `touch-action` to Step 3 so it lands with its handlers.|
|8|Old Step 4 tray-collapse depended on the later drawer work.|Sequencing|Low|Step 5 is pinch-zoom only; tray-collapse moved to Step 8.|
|9|Step 1 said "confirm" the viewport meta rather than editing it.|Executability|Low|Stated as an explicit edit adding `viewport-fit=cover`. (Step 1)|
|10|Plan said "13 tools"; code/docs have 12.|Consistency|Low|Corrected to 12 throughout.|
