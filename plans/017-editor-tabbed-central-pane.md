# Editor: tabbed central pane + object-editor tab

## Summary

Convert the map editor's central pane from a single `view: 'map' | 'world'` toggle into a **tabbed
container**. The Map (and future World) view is a permanent, non-closable tab; the Library's ⚙
"reclassify" affordance opens a full-size **object-editor tab** on demand (one per asset), which the
user can switch between and close.

This replaces the cramped `AssetReclassify` popover (plan 014 step 7c), which keeps clipping off the
screen edges (left, and off the bottom) and has no room to render a correct preview. The full-size
object-editor tab fixes both: no clipping, and enough room for a **correctly cropped frame-grid
preview** — the current tiny library swatch renders multi-row strips (e.g. a 2×2 furnace sheet,
`rows > 1`) wrong because its animation math assumes a single horizontal row.

The full-size tab also earns its keep for `object` atlas sheets: it hosts a **manual region editor**
(step 4) so tightly-packed sprites the connected-component detector can't separate (e.g. Farm.png's
touching crop rows) can be split by hand — writing `pack.json`'s existing `regions` override and
rerunning the asset pipeline, the same server seam the reclassify uses.

> Interim stopgap already landed on `master` (not this plan): the popover was made `position:fixed`
> and viewport-clamped, the Type dropdown label reads "tileset", and `TileFrameGrid` got a ⚙ so a
> tileset can be reclassified back. **This plan removes that popover entirely** — treat those edits as
> throwaway scaffolding, not code to preserve.

## Context & decisions

Verified against the current tree (`src/editor/`):

- **`view` is read in exactly two files** — `EditorApp.tsx` (renders the central pane) and
  `Toolbar.tsx` (the Map/World toggle). `EditorScene`, `InspectorPanel`, and the rest never touch it.
  So replacing `view`/`setView`/`EditorView` is low-risk; delete the type outright rather than aliasing.
- **The Phaser game is expensive and stateful.** `PhaserViewport.tsx` creates one `Phaser.Game`
  (`Scale.RESIZE`) on mount and `destroy(true)` on unmount; `EditorScene` holds live baked
  RenderTextures and subscribes to the store directly. It must **survive** tab switches — never
  unmount when an object tab is active.
- **Hide with `visibility:hidden`, not `display:none`.** Make the central pane `position:relative`
  and render every tab panel as an absolutely-positioned child filling it (`inset:0`); inactive
  panels get `visibility:hidden; pointer-events:none`. `visibility:hidden` keeps the host's layout
  size, so the `Scale.RESIZE` canvas never collapses to 0×0 (which `display:none` would cause —
  shrinking the canvas, risking zero-size framebuffer errors, and needing a manual `scale.refresh()`
  on re-show). This makes the whole canvas-resize problem class disappear.
- **Deterministic tab ids** make dedupe free: `map` / `world` / `object:<assetId>`. `openObjectTab`
  is find-or-append-then-activate. Object tabs are cheap React and stay mounted (visibility-toggled)
  until closed, so their uncommitted draft edits survive a switch to Map and back for free.
- **Reconcile object tabs on catalog refetch.** Apply regenerates the catalog server-side; an
  object tab can dangle on a removed/renamed asset id. Mirror the store's existing
  `reconcileActiveLayer`/selection reconciliation inside `setCatalog`: auto-close object tabs whose
  `assetId` is gone (and re-activate a neighbour if the active tab was the one dropped). The tab
  component also renders a graceful "asset no longer in catalog" state as a belt-and-braces guard.
- **Global shortcuts must be gated on the map tab.** `EditorApp`'s window `keydown` (undo/redo,
  Delete = delete selected map objects, arrow-nudge) currently fires regardless of what's focused.
  With an object tab active, pressing Delete would silently mutate the *map document*. Gate the whole
  handler on `activeTab.kind === 'map'` (checked via `getState()` inside the handler). This is the
  single biggest correctness risk in the change.
- **Draft edit state stays local to the tab component**, not the store — it's an uncommitted form
  whose canonical truth is server-side `pack.json`, surfaced by the post-Apply catalog refetch.
- **Relationship to plan 014 step 9** ("World view tab + neighbour ghost strips"): that step's world
  view becomes the `world` tab kind here — this plan is the infrastructure it will ride on. World
  stays a placeholder panel until then; nothing in step 9 is pulled forward.

## Steps

> **Step boundaries revised per critique (findings #2–#4):** the `view`→tabs refactor and its
> `EditorApp` consumer land together in step 1 (so each step typechecks green); a minimal object tab
> plus the ⚙ wiring land in step 2 (so its switch/close acceptance is actually exercisable); the Toolbar
> Map/World toggle is kept as a behaviour-identical rename in step 1 and **removed** in step 2 once
> the tab strip is the single switcher (no duplicate control).

- [x] **Step 1: `view` → tabs refactor in the store + its two consumers (behaviour-identical, +tests)** `[delegate sonnet]`
  - Outcome: `editorStore.ts` — deleted `EditorView`/`view`/`setView`; added `EditorTab` union
    (`map`/`world`/`object:<assetId>`), `tabs`+`activeTabId` state, `openObjectTab`/`activateTab`/
    `closeTab`, and a module-private pure `reconcileTabs` (null-catalog-safe, drops object tabs whose
    asset vanished, re-points a dropped active tab to `map`) wired into `setCatalog`. `EditorApp.tsx`
    branches the central pane on the active tab's `kind`; `Toolbar.tsx` Map/World → `activateTab`.
    New `store/__tests__/editorTabs.test.ts` (10 tests). Verified: `tsc --noEmit` exit 0, `eslint
    src/editor` 0 errors (5 pre-existing `EditorScene` warnings), prettier clean, `vitest` 327/327.
    (Pre-existing, out of scope: `npm run check`'s `format:check` fails on `src/debug/crashReporter.ts`
    — fails on HEAD too, untouched.)
  - `src/editor/store/editorStore.ts`: delete `EditorView`, `view`, and `setView`. Add:
    - `EditorTab = { id: 'map'; kind: 'map' } | { id: 'world'; kind: 'world' } | { id: string;
      kind: 'object'; assetId: string }` (object tab id = `object:<assetId>`).
    - State `tabs: EditorTab[]` (default `[{id:'map',kind:'map'}, {id:'world',kind:'world'}]`) and
      `activeTabId: string` (default `'map'`).
    - Actions: `openObjectTab(assetId)` (find-or-append `object:<assetId>`, then activate);
      `activateTab(id)`; `closeTab(id)` (no-op for `map`/`world`; if closing the active tab, activate
      the left neighbour, falling back to `map`).
    - `setCatalog` reconciliation: drop object tabs whose `assetId` is absent from the new catalog;
      if the active tab was dropped, re-activate a neighbour (→ `map` at worst). Note: this is net-new
      defensive code (a reclassify never changes an asset id, so it only fires if a file is
      removed/renamed on disk) — NOT mirroring an existing reconcile pattern (crit #5).
  - **Update both `view` consumers in the same step so the tree stays green (crit #2):**
    - `src/editor/EditorApp.tsx`: the central `<main>` branches on the active tab's `kind` instead of
      `view` (still just map/world/placeholder — no tab strip, no object panels yet).
    - `src/editor/Toolbar.tsx`: the existing Map/World group calls `activateTab('map'|'world')` and
      lights from `activeTabId` — a pure rename, kept as the switcher until step 2 replaces it.
  - Tests: `src/editor/store/__tests__/editorTabs.test.ts` (Tier 1, plain Node) — open/dedupe,
    activate, close, close-active-activates-neighbour, map/world un-closable, setCatalog drops a
    stale object tab and re-activates a neighbour.
  - Side effects: none outside `src/editor/` (+ tests).
  - Done when: tab unit tests green; `npm run check` green; app still renders + Map/World still switch
    (behaviour identical to before).

- [x] **Step 2: Central-pane tab strip + visibility-toggled panels + minimal object tab + ⚙ wiring** `[delegate opus]`
  - Outcome: `EditorApp.tsx` — central `<main>` is now a `role=tablist` tab strip (Map/World/object
    chips; object chips have a ✕ + middle-click close) over `.editor-tab-panels`, with EVERY tab's
    panel mounted as `position:absolute; inset:0` and inactive ones hidden via `.is-hidden`
    (`visibility:hidden; pointer-events:none` — never `display:none`, so the `Scale.RESIZE` Phaser
    canvas survives switches). `<PhaserViewport/>` is always-mounted in the Map panel. Global keydown
    (undo/redo/Delete/nudge) early-returns unless `activeTabId === 'map'`. New
    `tabs/ObjectEditorTab.tsx` (minimal placeholder: id/size/type + "step 3" note + missing-asset
    state). `LibraryPanel.tsx` — `AssetReclassify` reduced to a thin ⚙ that calls `openObjectTab`
    (popover + interim positioning/label/state deleted; `onReclassified` prop dropped from all 5 call
    sites). `Toolbar.tsx` — Map/World toggle removed (tab strip is the sole switcher). `editor.css` —
    tab-strip/chip/panel styles. Verified: `tsc --noEmit` exit 0, `eslint src/editor` 0 errors,
    prettier clean, `vitest` 327/327. ⚠ VISUAL acceptance (canvas survives switch, no flicker;
    shortcut gate; open/dedupe/close tabs) NOT machine-verified — needs a human at `npm run editor`.
  - `src/editor/EditorApp.tsx`: add a tab strip (one chip per tab: label + a ✕ close on object tabs;
    click = `activateTab`, middle-click or ✕ = `closeTab`) above a `position:relative` panel area.
    Render **all** tabs' panels as absolutely positioned `inset:0` children; the active one visible,
    the rest `visibility:hidden; pointer-events:none`.
    - The **map panel is always mounted**: `<PhaserViewport/>` (untouched — its StrictMode-safe
      destroy effect stays) plus the "New or Open a map to begin" hint overlaid when `!map`.
    - The **world panel** is the existing placeholder.
    - **Object panels**: a **minimal `ObjectEditorTab` placeholder** (shows the asset id + a "reclassify
      UI lands in step 3" note) per open object tab — enough to make switch/close real now; fleshed
      out in step 3.
  - Wire the ⚙ in `LibraryPanel.tsx` to call `openObjectTab(asset.id)` (temporary: alongside the
    existing popover, or the popover ⚙ swapped to open a tab — either way the switch/close flow is
    exercisable at end of step 2; the popover is fully removed in step 3).
  - **Remove the Toolbar Map/World toggle** — the tab strip is now the single switcher (crit #4).
  - Gate the global `keydown` handler in `EditorApp` on `getState().activeTabId === 'map'` (early
    return) so undo/redo/Delete/nudge never touch the map document from another tab (top risk).
  - `src/editor/editor.css`: tab strip styling (reuse the dark palette / toolbar-button look);
    absolute-fill panel container.
  - Side effects: none outside `src/editor/`.
  - Done when (VISUAL — needs a human at `npm run editor`, justified: this is canvas-survival + focus
    behaviour that unit tests can't observe): open an object tab from a ⚙, switch Map ↔ it ↔ back with
    the map staying rendered (no canvas flicker/resize), close it and return focus sensibly; Delete
    while an object tab is active does NOT delete selected map objects; `npm run check` green.

- [x] **Step 3: Flesh out the object-editor tab (reclassify + correct preview); extract helpers; retire the popover** `[delegate sonnet]`
  - Outcome: new `src/editor/reclassify.ts` (pure `suggestGrids`/`reclassifyGrid`/`seedFrames`/
    `seedRows`/`reclassifyPatch`/`assetRelPath`/`applyReclassify` — the `putAssetOverride` plumbing) and
    `src/editor/catalogSource.ts` (`loadCatalog`: cache-busted fetch → `parseCatalog` → `setCatalog`,
    returns the parsed catalog). `LibraryPanel.tsx` now reads `catalog` straight from the store and its
    mount effect calls `loadCatalog`, so a tab's Apply refreshes the Library live off one fetch (local
    `catalog` state + `refetchCatalog`/`parseCatalog`/`useCallback` removed). `ObjectEditorTab.tsx`
    replaces the placeholder: type dropdown, frames/rows + suggested-grid chips, a live grid overlay on
    a large sheet preview, and the fix — a correctly cropped per-frame preview (`col=i%cols`,
    `row=floor(i/cols)`); Apply → `applyReclassify` → `loadCatalog`, draft re-seeded from the fresh
    entry via a value-keyed effect; missing-asset state kept. `editor.css` — object-form styles. The
    step-2 `AssetReclassify` was already the thin ⚙ (popover retired then), so nothing left to delete.
    New `src/editor/__tests__/reclassify.test.ts` (11 tests, incl. the 2×2 furnace grid). Verified:
    `tsc --noEmit` exit 0, `eslint src` 0 errors (63 pre-existing warnings), prettier clean on changed
    files, `vitest` 338/338. ⚠ VISUAL acceptance (correct 2×2 preview, Library updates live on Apply)
    NOT machine-verified — needs a human at `npm run editor`. (Pre-existing, out of scope: `npm run
    check`'s `format:check` still fails only on `src/debug/crashReporter.ts`, untouched.)
  - Extract from `src/editor/panels/LibraryPanel.tsx` into reusable units (keep behaviour identical):
    - the catalog fetch/cache-busted-refetch (currently the fetch-on-mount effect + `onReclassified`
      refetch) into a shared helper both the Library and the tab's Apply call → `setCatalog`;
    - `suggestGrids`, the frames/rows grid math, and the `putAssetOverride` plumbing out of
      `AssetReclassify` into pure helpers (e.g. `src/editor/reclassify.ts`).
  - `src/editor/tabs/ObjectEditorTab.tsx`: replace the step-2 placeholder — looks up its asset from
    `catalog` by `assetId` (renders an "asset no longer in catalog" state if the lookup fails).
    Full-size layout: `type` dropdown (tileset/strip/object), frames/rows fields + suggested-grid
    chips, a **live grid overlay on a large sheet preview**, and — the fix — a **correctly cropped
    per-frame grid preview** (`col = i % cols`, `row = floor(i / cols)`; no single-row assumption).
    Apply → `putAssetOverride` → shared refetch → `setCatalog`; draft type/frames/rows are local React
    state, re-derived from the fresh catalog entry after Apply.
  - `LibraryPanel.tsx`: every ⚙ (`AssetCard`, `TileFrameGrid`, `AtlasSheetPicker`,
    `AnimatedStripPicker`) calls `openObjectTab(asset.id)` and nothing else. **Delete `AssetReclassify`
    (the popover) and its interim `position:fixed`/clamp/label/`TileFrameGrid`-⚙ scaffolding.**
  - Side effects: none outside `src/editor/`.
  - Done when: ⚙ on any asset opens/focuses its object tab; reclassifying a 2×2 (`rows:2`) furnace
    sheet shows a correct 2×2 cropped preview (not the squished/mis-laid-out swatch); Apply updates
    the Library live; `npm run check` green.

- [ ] **Step 4: Manual region editing in the object-editor tab** `[delegate opus]`
  - Why: tightly-packed/touching sprites (e.g. `Environment/Props/Static/Farm.png`'s crop rows and
    seed-jar columns) can't be split by the connected-component detector (`scripts/pixel-crawler/objects.py`
    `components()`): where two sprites touch there's no transparent pixel to cut on, and detection can't
    tell a merged cluster from one legitimately-large sprite (the Farm sheet's wooden railings/rock cluster
    are correct single boxes — dropping `gap` to 0 or adding a projection/XY-cut split provably doesn't
    separate the touching ones). `pack.json`'s `regions: {"<relPath>": [{x,y,w,h}]}` override already
    replaces detection VERBATIM (Rocks/Resources/Esoteric/Tools use it today) — this makes that list
    editable in-app instead of hand-authored, folding into this plan's object-editor tab rather than a
    separate panel.
  - Builds on step 3's full-size sheet preview in `ObjectEditorTab`. For `type:object` assets the tab body
    is a **Regions** editor; `strip`/`tile` keep step 3's frame-grid preview (the type dropdown switches
    between them — one tab, type-conditional body).
  - **Server** (`scripts/vite-editor-api.mjs`): new `PUT /__editor/asset-regions` — body
    `{packId, relPath, regions:[{x,y,w,h}]}`. Add `sanitiseRegions` mirroring `sanitiseOverridePatch`:
    array of integer rects, each `x>=0, y>=0, w>0, h>0` AND in-bounds of the sheet (read the PNG w/h the
    way `asset-catalog.mjs`'s `readPngSize` does, or validate against the sheet size — reject out-of-bounds
    so a bad box can't reach `pack.json`). Reuse `sanitisePackId`/`sanitiseRelPath`. Write
    `pack.regions[relPath] = regions` (WHOLE-list replace, not a merge — it's the complete hand-authored
    list; an empty array DELETES the key = fall back to auto-detection), then `enqueueRegen(root)` —
    identical serialised pipeline + python3-ENOENT graceful-degrade as `/__editor/asset-override`. Extend
    the module doc's endpoint list.
  - **Client** (`src/editor/api.ts`): `putAssetRegions(packId, relPath, regions): Promise<AssetOverrideResult>`,
    mirroring `putAssetOverride` (same refetch-is-caller's-job contract).
  - **UI** (`src/editor/tabs/ObjectEditorTab.tsx`): seed editable boxes from the asset's current `regions`
    (catalog); if it has none, seed with one box covering the whole sheet (subdivide from there). Reuse
    `AtlasSheetPicker`'s zoomable-sheet + absolutely-positioned-box render (extract the shared bits if
    cheap), made editable:
    - **draw**: drag on empty sheet → new box;
    - **select + delete**: click a box to select (live x/y/w/h readout); Delete/✕ removes it;
    - **move + resize**: drag body to move, corner/edge handles to resize;
    - **grid-slice**: with a box selected, enter cols×rows → replace it with that grid of equal cells
      (one action splits a whole merged crop row — the motivating case).
    **Save regions** → `putAssetRegions` → shared step-3 catalog refetch → `setCatalog` (tab re-derives
    boxes from the fresh entry). **Reset to auto-detect** saves an empty list (clears the override).
  - **Docs**: `docs/ASSETS.md` regions section — note in-app editing writes `pack.json` `regions`; if a
    shortcut is added, update `src/editor/shortcuts.ts` AND the in-app Shortcuts panel (project rule).
  - Side effects: `scripts/vite-editor-api.mjs`, `src/editor/api.ts`, `src/editor/tabs/`, `docs/ASSETS.md`
    — no game-runtime code.
  - Done when (VISUAL — human at `npm run editor`): open Farm.png's object tab, grid-slice a merged crop
    row into individual crops + hand-fix a couple of boxes, Save, and the Library atlas picker shows the new
    individual regions (clickable to arm for placement); Reset restores auto-detection; `npm run check` green.

- [ ] **Step 5: Polish + docs** `[inline]`
  - Close affordances finalised (✕ + middle-click), missing-asset tab state confirmed. Optional:
    `game.loop.sleep()`/`wake()` on map-tab deactivate/activate to stop rendering a hidden canvas
    (skip if not worth it).
  - If any tab keyboard shortcut is added (e.g. `Ctrl+W` to close the active tab), update
    `src/editor/shortcuts.ts` **and** the in-app Shortcuts panel (project rule: they must stay in
    sync).
  - `docs/STATUS.md`: one line for the tabbed central pane + object-editor tab (incl. manual region
    editing for tightly-packed atlas sheets).
  - Done when: `npm run check` green; a human confirms the flow end-to-end at `npm run editor`.

## Out of scope

- The World view itself (still a placeholder — plan 014 step 9 turns the `world` tab into real
  content).
- Persisting open tabs across reloads (tabs reset to `[map, world]` on load).
- Drag-to-reorder tabs, tab overflow/scroll UI (only a handful open in practice).
- Any change to how assets are placed/rendered in the map (`EditorScene`, decor pipeline).

## Critique

**Verdict:** Technically sound and the code claims check out, but it commits to a heavyweight
"convert the whole central pane to a tab container" solution for what is essentially a
clipping/preview-room bug the editor's existing modal-dialog pattern already solves — and the first
three steps are carved at seams that don't each stay green independently. *(Finding #1 is answered by
an explicit product decision made after the critique: the user wants MULTIPLE concurrent
object-editors they can switch between and close — which a single modal cannot provide. Proceeding
with tabs; steps revised to fix the executability findings below.)*

|#|Finding|Lens|Severity|Suggested action|
|-|-------|----|--------|----------------|
|1|Tabbed-pane rebuild is heavier than the stated goal needs; the editor already has 4 modal dialogs that fix clipping + preview room with no state surgery. Roadmap claim ("rides on 014 step 9's world tab") is overstated — step 9 works with the existing `map`/`world` toggle.|Alternatives / right-sizing / roadmap|High|**Resolved by user intent:** multiple switchable/closable editors are explicitly wanted; a modal can't do that. Proceed with tabs.|
|2|Step 1 deletes `view`/`setView`/`EditorView` but scopes to `editorStore.ts`+`Toolbar.tsx` only — yet `EditorApp.tsx:28` still reads `s.view`, so step 1's "check green" is unachievable (typecheck breaks).|Executability / reversibility|Medium|Fold the `EditorApp` central-pane change into step 1 (done in revision).|
|3|Step 2's acceptance ("switch Map ↔ an object tab and back") can't be exercised — nothing calls `openObjectTab` until step 3 wires the ⚙.|Executability / sequencing|Medium|Merge the object-tab wiring so step 2's visual check is real (done in revision).|
|4|`map`/`world` would appear twice: as the kept Toolbar view-switch buttons AND as chips in the new tab strip — two controls for one action.|Consistency / right-sizing|Medium|Pick one surface (revision: Toolbar toggle drops out; the tab strip is the switcher).|
|5|`setCatalog` has no existing "reconcile-on-load" precedent (those fire on apply/undo/redo), and a reclassify never changes an asset `id`, so the "dangling object tab" guard is largely hypothetical.|Consistency / right-sizing|Low|Keep the guard as cheap defence (only fires if a file is removed/renamed on disk); don't describe it as mirroring an existing pattern.|
|6|Tabs cover only the centre pane; the right Inspector stays map-scoped, so a selected map object is still editable via the Inspector while an object tab is active (only the global `keydown` is gated).|Gaps|Low|Note the limitation; optionally mute the Inspector when a non-map tab is active.|

*Primary focus: #1 is resolved by explicit user intent (tabs wanted). #2 is the immediate executability
fix; #3/#4 follow. #5/#6 are noted, not blocking.*
