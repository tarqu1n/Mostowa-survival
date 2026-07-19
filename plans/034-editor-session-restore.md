# Editor Session Restore

> Status: planned — run /execute-plan to begin.

## Summary

Make a mobile browser reload of the Map Builder lossless. When the phone discards the
backgrounded editor tab (or the user manually refreshes — now the norm since HMR is off on guppi),
the editor currently reboots to the empty "New or Open a map" state: you lose which map was open,
the camera pan/zoom, and the active tool/layer/tab. The map *data* is already safe (autocommit to
disk) and per-map library/underlay view-state already persists; this feature adds a small
`localStorage` session slice + a boot-time restore so a reload drops you back where you were.

The browser reload itself cannot be prevented (no web API opts a page out of tab eviction) — the
goal is to make it a non-event.

## Context & decisions

**User decisions (from planning):**
- **Restore trigger: on ANY reload.** Whenever a saved session exists, boot reopens the last map.
  A deliberate "Close map" clears the pointer, so it still gives a clean start. `document.wasDiscarded`
  is NOT used to gate restore (it would skip manual refreshes, which we specifically want to survive).
- **Camera memory: per-map.** Each map remembers its own camera view, keyed by map id — consistent
  with how underlay + library view-state already persist per-map. Restored on every open of that map.
- **Tabs scope: active-tab-only.** Restore which *permanent* tab (map/world/nodeTypes) was active.
  Do NOT persist/reopen on-demand `object:<assetId>` tabs. A dangling active tab falls back to `map`.

**What splits per-map vs session-scoped:**
- **Per-map (restored on every `loadMap`, any open path):** camera. Also the existing behaviour —
  `loadMap` already rehydrates library recents/browse per map id.
- **Session-scoped (restored only on boot resume):** activeTool, activeLayerId, activeTabId. A
  deliberate mid-session open of a *different* map should not yank your tool/tab — only resuming the
  session restores those. (activeLayerId keeps its normal `layers[0]` default on a manual open.)

**Architecture (mirrors existing seams — do not invent new patterns):**

- **Storage module** `src/editor/sessionStore.ts` (NEW) — Phaser-free, `MapFile`-free, exactly like
  `src/editor/libraryViewStore.ts`. Same `storage()` try/catch guard (`libraryViewStore.ts:51-57`),
  same `PREFIX` + per-id key builders, same read=degrade-to-default / write=swallow-errors pattern
  (`libraryViewStore.ts:93-157`).
  - `PREFIX = 'mostowo-editor-session:'`
  - Global pointer `${PREFIX}last` → `{ mapId: string }` — which map to reopen on boot.
  - Per-map record `${PREFIX}view:<mapId>` → `SessionView = { camera?: CameraState; activeTool?: EditorTool;
    activeLayerId?: string | null; activeTabId?: string }` (all optional, tolerant on read).
  - `CameraState = { scrollX: number; scrollY: number; zoom: number }` (zoom is the integer 1..4 step).
  - Define `CameraState` + `SessionView` HERE and import into `editorStore.ts` — same dependency
    direction as `libraryViewStore` types (`RecentEntry`/`LibraryBrowseState`) imported by the store.

- **Orchestration module** `src/editor/sessionSource.ts` (NEW) — mirrors `src/editor/palettesSource.ts`
  (which pairs `loadPalettes` + `installPaletteAutosave` + `putPalettes`). Holds `openMapById`,
  `restoreSession`, `installSessionAutosave`, `flushSession`.

- **Phaser↔store bridge** — add a camera get bridge + a one-shot restore-camera signal + a settle
  nonce to `editorStore.ts`, mirroring `zoomViewport`/`bakeThumbnail` (`editorStore.ts:432-446,
  566-570, 1762-1763`; installed `EditorScene.ts:391,394`; nulled `EditorScene.ts:404-405`) and
  `pendingDirty` (the one-shot consumed signal, `editorStore.ts:415-417`).

**Key file:line references (from research):**
- Boot mount effect (restore hook point): `EditorApp.tsx:294-320` (loads catalog/terrain/nodeDefs/
  palettes; `loadPalettes().finally(() => installPaletteAutosave())` is the load-then-subscribe shape).
- Manual open path: `OpenMapDialog.tsx:58` → `Toolbar.tsx:324-334` (`handleOpen`) → `getMap` (`api.ts:25`)
  → `migrateMap` → `store.loadMap(loaded, id)` (`editorStore.ts:1428-1460`).
- `loadMap` (`editorStore.ts:1428-1460`) already rehydrates per-map view-state (`getRecents(id)`/
  `getBrowse(id)`) and bumps `mapEpoch`; sets `activeLayerId = map.layers[0]?.id ?? null`.
- Epoch→fit chain: `EditorScene.ts:305-308` (mapEpoch sub) → `syncDocument()` `:413-421` →
  `loadTexturesThenBuild` → `buildScene` `:536-547` → `fitCamera(map)` `:541`/`:1553-1562`.
- `fitCamera` sets `cam.setBounds(...)` then `setZoom`/`centerOn`. **Keep `setBounds` on the restore
  path** (it makes scroll clamping correct); only override the zoom/scroll.
- Zoom clamp: `MIN_ZOOM = 1`, `MAX_ZOOM = 4` (`EditorScene.ts:56-57`); camera = `this.cameras.main`,
  props `scrollX`/`scrollY`/`zoom`; zoom stepping integer-only (`zoomByStep` `:1583-1586`).
- Bridge template: store `editorStore.ts:432-446, 566-570, 1762-1763`; scene install `:391,394`;
  teardown `:404-405`.
- Reconcilers that make restored dangling values safe: `reconcileActiveLayer` (`editorStore.ts:917-924`),
  `reconcileTabs` (`:1178-1196`, early-returns while `catalog` is null so restoring before catalog
  load is safe), `activeTabId` "never dangles" (`:258-260`).
- Persistence templates: `libraryViewStore.ts` (full), `palettesSource.ts:50-67` (debounced subscriber).
- Rename id-migration (must migrate the new key too): `renameMapState` (`editorStore.ts:678-689`),
  documented `docs/EDITOR.md:214-219`.
- Page Lifecycle usage is **greenfield** — no existing `visibilitychange`/`pagehide`/`freeze`/
  `wasDiscarded` usage anywhere in the repo.
- Tests to mirror: `src/editor/__tests__/libraryViewStore.test.ts` (pure module: `FakeStorage`,
  `vi.stubGlobal('localStorage', …)`, malformed→default, storage-unavailable→no-throw) and
  `src/editor/store/__tests__/editorStoreLibraryView.test.ts` (store write-through/reset).
- Docs: `docs/EDITOR.md:200-224` "Persistence contract" (add a sibling paragraph + the rename list).

**Direction check (`CLAUDE.md`):** the game is worked on "from whatever device is to hand (often on
a phone, mid-journey, across many short sessions)"; the editor is "hosted always-on on guppi for phone
authoring." A lossless phone reload is squarely on that stated direction — short mobile sessions that
survive tab eviction. No conflict with the MVP roadmap (this is editor tooling, not game content).

## Steps

- [ ] **Step 1: `sessionStore.ts` pure storage module + unit test** `[delegate]` (parallel: A)
  - Create `src/editor/sessionStore.ts`, a direct structural copy of `src/editor/libraryViewStore.ts`'s
    posture (Phaser-free, `MapFile`-free): the `storage()` guard, a `PREFIX = 'mostowo-editor-session:'`,
    key builders `lastKey = () => \`${PREFIX}last\``, `viewKey = (mapId) => \`${PREFIX}view:${mapId}\``.
  - Export types `CameraState = { scrollX: number; scrollY: number; zoom: number }` and
    `SessionView = { camera?: CameraState; activeTool?: EditorTool; activeLayerId?: string | null;
    activeTabId?: string }`. Import `EditorTool` as a `type` from `./store/editorStore` (type-only import,
    no runtime cycle). If a type-only import risks a cycle, instead define `SessionView.activeTool` as
    `string` and let callers narrow — but prefer the typed import.
  - Functions (all with the read=degrade-to-default, write=swallow-errors pattern from
    `libraryViewStore.ts:93-157`): `getLastMapId(): string | null`, `putLastMapId(mapId: string): void`,
    `clearLastMapId(): void`, `getSessionView(mapId: string): SessionView` (default `{}`),
    `putSessionView(mapId: string, view: SessionView): void`, `clearSessionView(mapId: string): void`.
    `putSessionView` should read-modify-write is NOT needed — callers pass the full record; but tolerate
    partial records on read (missing fields = undefined).
  - Create `src/editor/__tests__/sessionStore.test.ts` mirroring `libraryViewStore.test.ts`:
    `FakeStorage` + `vi.stubGlobal`; round-trip `putLastMapId`/`getLastMapId` and
    `putSessionView`/`getSessionView`; a malformed raw value → default; storage-unavailable
    (`vi.stubGlobal('localStorage', undefined)`) → getters return default and setters don't throw;
    `clear*` removes the key.
  - Side effects: none — new files only, nothing imports them yet.
  - Docs: none (covered in Step 8).
  - Done when: `sessionStore.ts` exports the six functions + two types; `npm test` passes the new
    `sessionStore.test.ts`; `npm run lint`/typecheck clean.

- [ ] **Step 2: store fields — restore-camera signal, camera bridge, settle nonce, camera restore in `loadMap`** `[inline]`
  - In `src/editor/store/editorStore.ts`:
    - Import `type CameraState`, `getSessionView` from `../sessionStore`.
    - Add state fields (near `pendingDirty`/`zoomViewport`): `pendingRestoreCamera: CameraState | null`
      (one-shot, consumed by `EditorScene.buildScene`, mirrors `pendingDirty`), `readCamera:
      (() => CameraState) | null` (Phaser bridge, mirrors `zoomViewport`), `cameraSettleNonce: number`.
    - Add actions: `setPendingRestoreCamera(cam: CameraState | null): void`,
      `setReadCamera(fn: (() => CameraState) | null): void` (mirrors `setZoomViewport` `:1763`),
      `notifyCameraSettled(): void` (`set((s) => ({ cameraSettleNonce: s.cameraSettleNonce + 1 }))`).
    - Initial values: `pendingRestoreCamera: null`, `readCamera: null`, `cameraSettleNonce: 0` (add
      beside the other initial-state values around `:1391-1392`).
    - In `loadMap` (`:1428-1460`), after `mapId` is known, set `pendingRestoreCamera` from the saved
      per-map record: `pendingRestoreCamera: getSessionView(id).camera ?? null` (inside the same `set`).
      This restores the per-map camera on EVERY open path (manual dialog + boot). Do NOT restore
      tool/layer/tab here — those are session-scoped (Step 4/5). Leave the existing `activeLayerId =
      map.layers[0]?.id` default untouched.
  - Side effects: `newMap` (`:1394-1426`) must set `pendingRestoreCamera: null` in its `set` (a brand-new
    map has no saved camera → normal `fitCamera`). Verify no other `set` needs the field defaulted.
    `EditorScene` will read the new fields in Step 3 — until then they're inert.
  - Docs: none (Step 8).
  - Done when: fields + actions compile and are covered by the store's existing typecheck; a manual
    `getState().setPendingRestoreCamera({scrollX:1,scrollY:2,zoom:3})` round-trips; `loadMap` with a
    seeded `getSessionView(id).camera` leaves `getState().pendingRestoreCamera` equal to it.

- [ ] **Step 3: EditorScene camera bridge + restore-on-build + settle notifications** `[inline]`
  - In `src/editor/EditorScene.ts`:
    - `create()` (near `:391,394`): install the read bridge —
      `useEditorStore.getState().setReadCamera(() => { const c = this.cameras.main; return { scrollX:
      c.scrollX, scrollY: c.scrollY, zoom: Math.round(c.zoom) }; })`.
    - `teardown()` (near `:404-405`): `if (useEditorStore.getState().readCamera)
      useEditorStore.getState().setReadCamera(null);`.
    - `buildScene(map)` (`:536-547`): replace the unconditional `fitCamera(map)` (`:541`) with a
      pending-camera check — read + clear `pendingRestoreCamera` (one-shot, like `consumePendingDirty`):
      if present, run the same `cam.setBounds(...)` from `fitCamera` (keep bounds!) then set
      `cam.setZoom(Phaser.Math.Clamp(pending.zoom, MIN_ZOOM, MAX_ZOOM))` and `cam.setScroll(pending.scrollX,
      pending.scrollY)`; else `fitCamera(map)`. Add a small private helper `applyRestoreCamera(map, cam)`
      or inline. Because it's consumed one-shot, the resize-driven re-`buildScene`/`fitCamera` path
      (`onDocEdited`, `:559-571`) is unaffected.
    - Camera settle notification: call `useEditorStore.getState().notifyCameraSettled()` when a camera
      gesture SETTLES (not per frame) — at the end of a pan drag (the pan pointer-up handler) and after a
      zoom step (`zoomByStep` `:1583-1586` and `handleWheel` `:1570-1575`). Find the pan pointer-up /
      drag-end site (the code that updates `cam.scrollX/scrollY` on drag — around `:1988-1990`) and fire
      the notify on release, not on every move.
  - Side effects: StrictMode double-mount (`main.tsx:12-19`) re-runs create/teardown — the null-guarded
    setter tolerates it (same as `zoomViewport`). Confirm `Math.round(c.zoom)` matches the integer-zoom
    invariant. Confirm `setScroll` respects the bounds set just above (Phaser clamps to bounds).
  - Docs: none (Step 8).
  - Done when: opening a map with no saved camera still fits as before; seeding `pendingRestoreCamera`
    before a `mapEpoch` bump lands the camera at that scroll/zoom instead of the fit; panning/zooming
    bumps `cameraSettleNonce` exactly once per gesture (not per frame).

- [ ] **Step 4: `sessionSource.ts` — shared open, restore, autosave, flush** `[inline]`
  - Create `src/editor/sessionSource.ts` (mirror `palettesSource.ts`'s structure). Imports: `useEditorStore`,
    `getMap` (`./api`), `migrateMap` (wherever `Toolbar` imports it from), the six `sessionStore`
    functions, `toast` only if needed.
  - `export async function openMapById(id: string): Promise<boolean>` — the single open sequence used by
    both the manual dialog and boot restore: `getMap(id)` → `migrateMap(raw)` →
    `useEditorStore.getState().loadMap(loaded, id)` → return `true`. On a fetch/parse failure return
    `false` (caller decides whether to toast). (`loadMap` sets `pendingRestoreCamera` from Step 2, so the
    per-map camera restore is automatic here.)
  - `export async function restoreSession(): Promise<void>` — boot resume: `const id = getLastMapId();
    if (!id) return;` then `const ok = await openMapById(id);` if `!ok` → `clearLastMapId()` (stale/deleted
    map — self-heal) and return. On success, apply the SESSION-SCOPED fields from `getSessionView(id)`:
    `activeTool` via `setActiveTool` (if set), `activeLayerId` via `setActiveLayer` (reconcile guards a
    dangling id), `activeTabId` via `activateTab` (no-op if the id isn't a live tab; active-tab-only, so
    only `map`/`world`/`nodeTypes` are ever persisted). Do NOT toast on restore (silent resume).
  - `export function installSessionAutosave(): () => void` — mirror `installPaletteAutosave`
    (`palettesSource.ts:50-67`): `useEditorStore.subscribe` with a tuple selector `(s) => [s.mapId,
    s.activeTool, s.activeLayerId, s.activeTabId, s.cameraSettleNonce]` (use `subscribeWithSelector`'s
    array-selector with an equality fn, or subscribe to a derived string). On change, debounce (~400 ms,
    reuse a `SESSION_AUTOSAVE_DEBOUNCE_MS` const) then write: read `const st = useEditorStore.getState()`;
    if `st.mapId` is null → `clearLastMapId()` (deliberate close = fresh start next boot) and return; else
    `putLastMapId(st.mapId)` and `putSessionView(st.mapId, { camera: st.readCamera?.(), activeTool:
    st.activeTool, activeLayerId: st.activeLayerId, activeTabId: st.activeTabId })`. Returns the unsubscribe.
  - `export function flushSession(): void` — immediate (no-debounce) synchronous version of the write
    above, for the lifecycle listeners; clears any pending debounce timer first so it can't double-fire.
    (Share the write body between `installSessionAutosave` and `flushSession` via a private `writeNow()`.)
  - Refactor `Toolbar.tsx` `handleOpen` (`:324-334`) to call `openMapById(id)` then keep its
    `toast.success`/`setShowOpen(false)` (and a failure toast when `openMapById` returns false), so the
    open sequence is single-sourced and camera-restore-on-manual-open comes for free.
  - Side effects: `Toolbar.tsx` now imports from `sessionSource`; confirm no import cycle
    (`sessionSource` → `editorStore`/`api`; `Toolbar` → `sessionSource` — acyclic). The autosave's
    tuple must include `cameraSettleNonce` so a pan/zoom (no other field change) still triggers a save.
  - Docs: none (Step 8).
  - Done when: `openMapById` opens a map identically to the old `handleOpen`; `restoreSession()` with a
    seeded pointer+record opens the map and applies tool/layer/tab; with a stale pointer (getMap 404) it
    clears the pointer and no-ops; `installSessionAutosave` writes pointer+record on a tool change and on
    a `notifyCameraSettled()`; closing the map clears the pointer.

- [ ] **Step 5: EditorApp boot wiring + Page Lifecycle flush** `[inline]`
  - In `src/editor/EditorApp.tsx` boot effect (`:294-320`), alongside the existing loaders:
    - Kick off restore and install autosave load-then-subscribe style (mirror the palettes line):
      `let unsubSession: (() => void) | undefined; void restoreSession().finally(() => { unsubSession =
      installSessionAutosave(); });`
    - Add lifecycle flush listeners that call `flushSession()` so a discard/refresh mid-debounce still
      persists: `const onHide = () => { if (document.visibilityState === 'hidden') flushSession(); };`
      `window.addEventListener('visibilitychange', onHide);` and
      `window.addEventListener('pagehide', flushSession);` (`pagehide` is the most reliable pre-unload
      signal; `visibilitychange:hidden` is the most reliable on iOS — register both).
    - Cleanup (effect return): `unsubSession?.(); window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushSession);` alongside the existing `unsubPalettes` cleanup.
  - Side effects: StrictMode double-mount runs the effect twice; restore is idempotent (re-opening the
    same map is harmless) and cleanup unsubs/removes between mounts. `document.wasDiscarded` is
    intentionally NOT used (decision: restore on any reload). Ensure `restoreSession` runs even though
    catalog/nodeDefs may still be loading — active-tab-only means no object-tab reconcile depends on the
    catalog, so ordering is safe (`reconcileTabs` early-returns while `catalog` is null).
  - Docs: none (Step 8).
  - Done when: a full reload with a saved session reopens the map at the saved camera with the saved
    tool/layer/active-tab; backgrounding then killing the tab (simulate via `visibilitychange`→hidden)
    flushes the latest state; a deliberate Close map → reload lands on the empty state.

- [ ] **Step 6: rename + delete key migration** `[inline]`
  - `renameMapState` (`editorStore.ts:678-689`) already migrates the underlay + library keys on an id
    change; add the session view key to that migration: `getSessionView(oldId)` → `putSessionView(newId,
    …)` → `clearSessionView(oldId)`, and if `getLastMapId() === oldId` then `putLastMapId(newId)`. Guard
    to the id-changed branch (a name-only rename skips it, like the existing underlay/world migration).
  - Delete path: find the caller of `deleteMap` (`api.ts`) — the map-delete affordance (likely in
    `Toolbar.tsx`/a dialog) — and after a successful delete, `clearSessionView(id)` and, if
    `getLastMapId() === id`, `clearLastMapId()`. (Boot restore already self-heals a dangling pointer via
    the getMap-404 path, so this is tidiness/consistency, not correctness-critical — still do it.)
  - Side effects: keep this step's edits to CODE only — the EDITOR.md rename-migration list entry is in
    Step 8 (avoids two steps editing EDITOR.md).
  - Docs: none here (Step 8).
  - Done when: renaming an open map moves its `mostowo-editor-session:view:<id>` record and repoints the
    pointer; deleting a map clears its session record and the pointer if it named that map.

- [ ] **Step 7: store-level + source tests** `[delegate]`
  - Add `src/editor/store/__tests__/editorStoreSession.test.ts` (mirror `editorStoreLibraryView.test.ts`:
    `FakeStorage`, `vi.stubGlobal('localStorage', …)`, `reset()` opening a scratch map): (a) `loadMap`
    with a seeded `putSessionView(id, { camera })` sets `getState().pendingRestoreCamera` to that camera;
    without a record it's `null`; (b) `newMap` leaves `pendingRestoreCamera` null; (c) `renameMapState`
    id-change migrates the session view key + pointer.
  - Add `src/editor/__tests__/sessionSource.test.ts`: with `getMap` mocked (`vi.mock('../api', …)`) and a
    fake `readCamera` installed via `setReadCamera`, assert `restoreSession()` opens the seeded pointer's
    map and applies tool/layer/activeTab; a stale pointer (getMap rejects/404) clears the pointer;
    `installSessionAutosave()` writes pointer+record after a `notifyCameraSettled()` (advance fake timers
    past the debounce) and clears the pointer when the map is closed (`closeMap`); `flushSession()` writes
    immediately without waiting for the debounce.
  - Side effects: use `vi.useFakeTimers()` for the debounce assertions (see how other debounced code is
    tested, if any; otherwise standard vitest fake timers).
  - Docs: none.
  - Done when: `npm test` passes the new suites; no flake under the existing test runner.

- [ ] **Step 8: docs** `[delegate haiku]`
  - `docs/EDITOR.md` "Persistence contract" (`:200-224`): add a sibling paragraph "Session restore
    (plan 034)" — keys `mostowo-editor-session:last` (last open map id) and `…:view:<mapId>` (per-map
    camera + session-scoped activeTool/activeLayerId/activeTabId); restore-on-boot for ANY reload
    (reopens the last map, applies camera+tool+layer+active-tab), per-map camera also restored on every
    manual open; a deliberate Close map clears the pointer; a Page Lifecycle `visibilitychange:hidden`/
    `pagehide` flush guarantees the latest state persists before a discard. Add the session view key to
    the rename id-migration list (`:218-219`) and note delete clears it. Keep it terse/high-signal.
  - `docs/MOBILE-EDITOR-ACCESS.md`: one line under the guppi/HMR context tying session-restore to the
    phone workflow — a discarded/refreshed tab now resumes where you left off (pairs with the `EDITOR_NO_HMR`
    manual-refresh workflow).
  - Side effects: none (docs only; write-disjoint from all code steps).
  - Done when: both docs describe the slice; `markdownlint` (if wired) passes.

## Out of scope

- Reopening on-demand `object:<assetId>` tabs (active-tab-only decision) — only the permanent
  map/world/nodeTypes selection is restored.
- Restoring undo/redo history (not persisted; a reload starts a fresh history — unchanged).
- `document.wasDiscarded`-gated restore (decision: restore on any reload, so it's unused).
- Restoring session-scoped tool/layer/tab on a *manual* mid-session open of a different map (only the
  boot resume restores those; manual open restores per-map camera only).
- Preventing the browser reload itself (no web API allows it) — this feature makes the reload lossless,
  not avoidable.
- Any change to map data persistence / autocommit (already handled) or to the game runtime.
