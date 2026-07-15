# Editor Reference Underlay (trace-over image)

> Status: planned — run /execute-plan to begin.

## Summary

Add a **reference overlay** to the dev-only Map Builder: a semi-transparent image that renders
**over the tile layers** (below the grid + editor guide overlays) in the Map tab so the author can
trace the shape mask / terrain and check coverage through its alpha without deleting painted tiles.
(Revised 2026-07-15 after review: originally an *underlay* rendered beneath the tiles — flipped to an
overlay so opaque painted tiles never hide the reference. Code identifiers keep the `underlay*` names;
only the render depth + user-facing wording changed.)
Reference images are **committed to the repo** and served by the existing `/__editor` dev middleware;
the editor lists them and the author picks one from a **dropdown** (phone-friendly — no OS file
dialog), with file-picker + drag-drop kept as a desktop convenience for ad-hoc images. The picked
image is cached to **localStorage as a base64 data URL** (survives a spotty connection while camping)
and transform settings (opacity, X/Y offset, scale, show/hide, lock) persist **per-map in
localStorage** — never written into `.map.json` (it's a tracing aid, not map data). When a capture
sidecar JSON is present it auto-aligns to the grid. Entirely inside `src/editor/**` +
`scripts/vite-editor-api.mjs`, so it's structurally excluded from the prod build.

## Context & decisions

Decisions taken during planning (user-confirmed; revised after the fresh-eyes critique — see
`## Critique`):

- **References live in the repo, served over `/__editor`.** The editor already *requires* the dev
  server to save maps, and the user authors from **whatever device is to hand, including a phone
  while camping** (`CLAUDE.md` cross-device rule). A device-local file a picker reads doesn't travel;
  a committed reference is available wherever the builder runs. So the primary load path is: list
  committed references via a middleware endpoint → pick from a dropdown → fetch the PNG.
- **Persistence: localStorage, not IndexedDB.** The actual capture PNG is **659 KB** (~880 KB
  base64) — comfortably inside localStorage's ~5 MB (an earlier "2–3 MB → needs IndexedDB" rationale
  was wrong; critique finding #2). Store the image **data URL keyed by reference name** (deduped, so
  N maps sharing one reference cache one copy) and **transform settings keyed by `mapId`**. Phaser's
  `load.image` accepts data URIs directly, so there are **no object URLs and no revoke lifecycle**
  (dissolves critique #6). On `QuotaExceededError`, evict the oldest cached image and retry, else
  warn via sonner. Never touches `MapFile`.
- **File-picker + drag-drop stay as a desktop-only secondary path** for ad-hoc images not committed
  to the repo; they feed the identical cache-as-data-URL path.
- **Auto-align: use the sidecar fetched alongside a repo reference — no separate sidecar picker UI**
  (critique #3). With the capture tool `pxPerTile == TILE_SIZE == 16`, the default is `scale 1 /
  offset 0`; the sidecar's live value is the size-mismatch warning. Keep the pure, tested align
  helper regardless.
- **One visibility surface + keyboard, not three** (critique #5): the show/hide toggle lives in the
  Reference panel plus a `U` shortcut. **No toolbar checkbox.**
- **Controls: a new collapsible "Reference" panel** in the right-hand `<aside>` stack.

Repo facts the steps rely on (from the architecture sweep — **re-verify against code before
building**; the critique confirmed these hold, with ≤1-line number drift in places):

- **Render order / depth**: there is **no grid backdrop behind the tiles**. Tile layers are the
  lowest objects (`setDepth(layerIndex)`, `0..layers.length-1`) over a **transparent camera**.
  Overlays sit *above* (`DEPTH_GHOST=250` … `DEPTH_GRID=9000`). **Revised:** the reference is an
  **overlay**, so `DEPTH_UNDERLAY = 200` — above the tile layers (`0..N-1`), below the ghost strips
  and every editor guide overlay (void/objects/walkability/zones/grid) so those stay legible on top.
- **Closest precedent to mirror = ghost strips**: `refreshGhosts`/`bakeGhostStrip`
  (`EditorScene.ts` ~900-1017) — flag-gated, queue `load.image` → `load.once(COMPLETE)` →
  `load.start()`, create object at a depth with `.setAlpha()`, **epoch-guard** against stale async,
  teardown. `GHOST_ALPHA=0.4` is the semi-transparent precedent.
- **Store**: Zustand + `subscribeWithSelector`. One open doc at a time: `map`/`mapId`, set by
  `newMap`/`loadMap`/`closeMap`. Editor-only view-state precedent = `overlays`/`hiddenLayerIds`
  (in-memory). Phaser redraws driven by counter signals (`mapEpoch`/`docRevision`) +
  `subscribeWithSelector` subscriptions registered in `EditorScene.create()`.
- **Panels**: right column is a fixed 280px `<aside>` (`EditorApp.tsx` ~226-232) stacking
  `InspectorPanel`/`LayersPanel`/`ZonesPanel` split by `<Separator>`. Mirror `InspectorPanel.tsx`
  (subscribe to counters, read `map` via `getState()`; shared `headingClass`/`fieldClass`;
  `NumberField` commit-on-blur/Enter). Primitives in `src/editor/ui/`: `slider.tsx` (Radix `Slider`,
  currently unused — opacity/scale), `select.tsx` (the references dropdown), `label`/`input`/`button`/
  `separator`/`tooltip`. **No** shadcn `Switch`/`Checkbox` — toggles use plain `<input type="checkbox">`.
- **Middleware**: `scripts/vite-editor-api.mjs` already reads/writes on-disk files under `/__editor/*`
  (maps, thumbs), sanitising ids with `ID_RE = /^[a-z0-9-]+$/`. Adding list + serve endpoints for the
  references dir fits this exactly. Typed client wrappers live in `src/editor/api.ts` (`const BASE =
  '/__editor'`). It's `command === 'serve'`-gated, so inert in prod.
- **Texture loading**: `queueTextures`/`loadTexturesThenBuild` — `this.load.image(key, url)` (a data
  URL is a valid `url`), guarded by `this.textures.exists(key)` + a `FILE_LOAD_ERROR` handler.
- **Coordinates**: `TILE_SIZE=16` (`config.ts:38`). Tile `(col,row)` → px `(col*16, row*16)`. Capture
  PNG authored at `pxPerTile:16 == TILE_SIZE` → 1:1 at origin, no scaling.
- **Shortcuts**: `shortcuts.ts` is **documentation only**; real handlers live in `EditorApp.tsx`
  window `keydown` (guards typing + gates `activeTabId==='map'`). Add handler **and** a `{keys,action}`
  entry (project rule: keep the in-app Shortcuts panel in sync). `U` is currently free.
- **Prod exclusion**: `vite.config.ts` pins `rollupOptions.input:'index.html'`; editor + `/__editor`
  are serve-only. Everything stays in `src/editor/**` + `scripts/vite-editor-api.mjs`.
- **`MapFile` untouched**: no change to `src/systems/mapFormat.ts`; underlay is pure editor view-state.

## Steps

- [x] **Step 1: Commit references + dev-serve endpoint** `[inline]`
  - Outcome: Deleted `scripts/map-reference/.gitignore` (was untracked, so no `git rm`). Updated
    `README.md` + `capture.mjs` header — `out/` is now "committed, dev-served via `/__editor`, never
    in prod bundle" instead of "gitignored". Added to `scripts/vite-editor-api.mjs`: `sendRawFile`
    helper, `listMapReferences()` (scans `scripts/map-reference/out/` for `*-reference.png`, missing
    dir ⇒ `[]`), and routes `GET /__editor/map-references` + `GET /__editor/map-references/:name.{png,json}`
    (sanitised via existing `ID_RE`; `.json` 404 = optional-sidecar signal). Added `api.ts` wrappers
    `listMapReferences()`, `mapReferenceImageUrl(name)`, `getMapReferenceSidecar(name)` (returns
    `null` on 404). Verified live on the running dev server: list → `["mostowo"]`, PNG → 200
    image/png 659215 B, JSON → sidecar, missing → 404, bad name → 400. tsc + lint (0 errors) green.
    **`out/mostowo-reference.{png,json}` staged but NOT yet committed** — deferred to check-in per
    commit hygiene.
  - Make reference images repo-committed & servable: **delete `scripts/map-reference/.gitignore`**
    (currently ignores `out/`) and update `scripts/map-reference/README.md` + `capture.mjs`'s header
    comment — they say `out/` is "gitignored / never shipped"; the truth is now **committed, dev-only,
    served via `/__editor`, still never in the prod bundle** (editor is serve-only). Commit the
    existing `out/mostowo-reference.{png,json}`.
  - Add middleware endpoints to `scripts/vite-editor-api.mjs`, mirroring the existing file handlers:
    `GET /__editor/map-references` → JSON list of available reference names (scan the `out/` dir for
    `*-reference.png`, strip suffix); `GET /__editor/map-references/:name.png` and `:name.json` →
    serve the raw file (sanitise `:name` with `ID_RE`; 404 if absent — the `.json` is optional).
  - Add typed client wrappers in `src/editor/api.ts`: `listMapReferences(): Promise<string[]>`,
    `mapReferenceImageUrl(name): string` (the `/__editor/...png` URL for `load.image`/`fetch`),
    `getMapReferenceSidecar(name): Promise<unknown | null>` (null on 404).
  - Side effects: the capture tool's docs/comments must stop claiming the dir is gitignored. No prod
    impact (serve-only middleware).
  - Docs: covered terse in Step 8; fix the capture README here as part of the change.
  - Done when: `GET /__editor/map-references` lists `mostowo`; the `.png`/`.json` endpoints return the
    files; wrappers typecheck.

- [x] **Step 2: Auto-align helper (pure)** `[delegate sonnet]`
  - Outcome: New `src/editor/underlayAlign.ts` (pure, no Phaser/editor deps) exporting `Sidecar`
    (`{pxPerTile, image:{w,h}, grid:{w,h}}`), `parseSidecar(json): Sidecar|null` (defensive narrow via
    `typeof`/`Number.isFinite`, rejects `pxPerTile<=0`, never throws), and `computeAutoAlign({sidecar,
    imageW, imageH, tileSize}): {scale, offsetX, offsetY, warning?}` (no sidecar → identity; sidecar →
    `scale=tileSize/pxPerTile`, offset 0, `warning` only on image-size mismatch). Tests in
    `src/editor/__tests__/underlayAlign.test.ts` (9 cases: parseSidecar valid/garbage/missing-field/
    non-positive-px/extra-fields; computeAutoAlign match/mismatch-warning/no-sidecar/non-16-px).
    tsc clean; full suite 518/518 green; lint 0 errors (90 pre-existing warnings, no new).
  - New `src/editor/underlayAlign.ts` — pure geometry, unit-tested (mirror `regions.ts`/`reclassify.ts`
    posture). Export a `Sidecar` type (subset: `pxPerTile:number; image:{w:number;h:number};
    grid:{w:number;h:number}`), `parseSidecar(json: unknown): Sidecar | null` (defensively narrows;
    never throws), and `computeAutoAlign(opts: { sidecar?: Sidecar | null; imageW: number; imageH:
    number; tileSize: number }): { scale: number; offsetX: number; offsetY: number; warning?: string }`.
    Rules: with a sidecar, `scale = tileSize / sidecar.pxPerTile`, `offsetX=offsetY=0`, and set a
    `warning` if `imageW/imageH` mismatch `sidecar.image.{w,h}`. Without, `{ scale: 1, offsetX: 0,
    offsetY: 0 }`.
  - Side effects: none (pure).
  - Docs: none.
  - Done when: `src/editor/__tests__/underlayAlign.test.ts` covers sidecar match, sidecar size-mismatch
    (→ warning), and no-sidecar; `npm test` green.

- [x] **Step 3: localStorage persistence module** `[inline]`
  - Outcome: New `src/editor/underlayStore.ts` (Phaser-free, no MapFile). Prefix
    `mostowo-editor-underlay:` (distinct from `mostowo-editor-layout`); settings keyed
    `…:settings:<mapId>`, image data-URLs keyed `…:img:<name>`, plus an `…:img-index` array tracking
    use-order (LRU front, MRU end). Exports `UnderlaySettings` + `getSettings`/`putSettings`/
    `deleteSettings`/`getCachedImage`/`putCachedImage`. `putCachedImage` evicts LRU + retries once on
    `QuotaExceededError` then warns; all reads degrade to null via a guarded `storage()` accessor
    (handles the throw-on-access case). Storage accessed via `globalThis.localStorage` so tests stub
    it. Test `src/editor/__tests__/underlayStore.test.ts` (9 cases: settings round-trip/per-map/
    delete/malformed-JSON/no-storage; image round-trip/LRU-evict-and-retry/give-up/no-storage) uses an
    in-memory `FakeStorage` with a `quotaAfter` throw — no jsdom dep. tsc + lint (0 err) green.
  - New `src/editor/underlayStore.ts`, Phaser-free, no `MapFile` import. Two namespaces in
    `localStorage`: **settings by `mapId`** and **cached image data URLs by reference name** (so N
    maps sharing a reference store one image copy). Export `UnderlaySettings`
    `{ referenceName: string | null; visible: boolean; locked: boolean; opacity: number; offsetX:
    number; offsetY: number; scale: number }` (offsets in **tiles**, `scale` a multiplier over the
    1:1 baseline, `opacity` 0..1) and fns: `getSettings(mapId)`, `putSettings(mapId, settings)`,
    `getCachedImage(name): string | null`, `putCachedImage(name, dataUrl)`, `deleteSettings(mapId)`.
    `putCachedImage` handles `QuotaExceededError` by evicting the least-recently-used cached image and
    retrying once, then giving up gracefully (return a boolean / `console.warn`). All reads degrade to
    `null` on parse/availability failure so the editor never hard-fails.
  - Side effects: browser localStorage only; coexists with the existing `mostowo-editor-layout` key —
    use a distinct key prefix (e.g. `mostowo-editor-underlay:`).
  - Docs: none (Step 8).
  - Done when: `tsc`/lint clean; round-trips settings + a data URL; quota path doesn't throw. (Add a
    small unit test if trivial with jsdom's localStorage; otherwise rely on Step 9 manual verify.)

- [x] **Step 4: Store slice + wiring** `[inline]`
  - Outcome: All in `src/editor/store/editorStore.ts` (no other file touched). Added state `underlay:
    (UnderlaySettings & { dataUrl: string }) | null` (exported type `UnderlayState`) + counter
    `underlayRevision` (mirrors `docRevision`/`worldRevision`), both reset+bumped in `newMap`/`loadMap`/
    `closeMap`. Actions: `setUnderlayReference` (cache→else fetch+cache the committed PNG, sidecar
    `computeAutoAlign` for initial scale/offset, toast on fetch-fail / align-warning), `setUnderlayImage
    FromFile` (FileReader→data URL, `referenceName=null`, identity align, in-memory only), `clearUnderlay`
    (also `deleteSettings`), setters `setUnderlayOpacity`/`setUnderlayOffset`/`setUnderlayScale`/
    `toggleUnderlayVisible`/`toggleUnderlayLock`, and lifecycle helper `hydrateUnderlay(mapId)` called
    fire-and-forget from `loadMap`/`newMap`. Every async path epoch-guards via `get().mapId !== mapId`
    after each await; all no-op when `mapId` null; every settings write goes through `putSettings`
    (`settingsOf` strips the `dataUrl`). Module helpers `blobToDataUrl`/`fetchAsDataUrl`/
    `imageSizeFromDataUrl`. `DEFAULT_UNDERLAY_OPACITY = 0.5`. **No object URLs → no revoke** (data-URL
    choice, critique #6). Ad-hoc file images don't survive reload (no cache key — documented). tsc +
    lint (0 errors) clean; full suite 527/527 green. Live persist/swap behaviour deferred to Step 9
    (needs the Step 5 render + Step 6 panel to exercise).
  - In `editorStore.ts`, add editor-only state next to `overlays`/`hiddenLayerIds`:
    `underlay: (UnderlaySettings & { dataUrl: string }) | null` and an `underlayRevision: number`
    counter (mirror `docRevision`) bumped on every underlay change.
  - Actions: `setUnderlayReference(name)` (fetch `mapReferenceImageUrl(name)` → base64 data URL [or
    read `getCachedImage(name)` first], `putCachedImage`, fetch+`parseSidecar`+`computeAutoAlign` for
    initial scale/offset, set state, `putSettings`, bump revision); `setUnderlayImageFromFile(file)`
    (FileReader → data URL; `referenceName=null`; auto-align with no sidecar; same persist path);
    `clearUnderlay()`; and setters `setUnderlayOpacity`/`setUnderlayOffset(x,y)`/`setUnderlayScale`/
    `toggleUnderlayVisible`/`toggleUnderlayLock`, each persisting via `putSettings` and bumping the
    revision. No-ops when `mapId` is null.
  - Lifecycle: in `loadMap`/`newMap`, after `mapId` is set, `getSettings(mapId)`; if it names a
    `referenceName`, resolve its data URL (cache → else fetch) and set `underlay`, bump revision. In
    `closeMap` (and when switching maps), null `underlay` and bump revision. **No object URLs**, so no
    revoke step (this is the simplification the data-URL choice buys — critique #6).
  - Side effects: guard the async resolve against a map swap mid-flight (compare `mapId` after await,
    same epoch-guard spirit as the scene). Keep the fetch failure non-fatal (leave `underlay` null +
    toast).
  - Docs: none (Step 8).
  - Done when: `tsc`/lint clean; selecting/adjusting persists across reload; switching maps swaps the
    underlay with no stale image.

- [x] **Step 5: EditorScene rendering** `[inline]`
  - Outcome: All in `src/editor/EditorScene.ts`. Added `DEPTH_UNDERLAY = -100` (below tile layer 0 over
    the transparent camera) + `UNDERLAY_TEXTURE_KEY = '__underlay'` consts; fields `underlayImage?`,
    `underlayEpoch`, `underlayTextureDataUrl?`. New `refreshUnderlay()` (modelled on `refreshGhosts`):
    absent/hidden → `destroyUnderlay()`; **same dataUrl already resident → transform-only re-apply
    (position/scale/alpha), NO texture reload** (deviation from the literal "always destroy/remove
    first" — avoids re-decoding the 659 KB base64 on every opacity/offset/scale slider tick; still
    removes+reloads when the image itself changes, honouring the dup-key guard); new/changed image →
    `destroyUnderlay()` then `load.image(KEY,dataUrl)` → `load.once(COMPLETE)` → create Image at
    `setOrigin(0,0)`/`setDepth(DEPTH_UNDERLAY)` + transform; epoch-guarded, re-reads latest `underlay`
    in the COMPLETE callback, decode-failure non-fatal via existing FILE_LOAD_ERROR + `textures.exists`
    check. `destroyUnderlay()`/`applyUnderlayTransform()` helpers. Subscribed to `underlayRevision` in
    `create()`; initial `this.refreshUnderlay()` in `buildScene()`; torn down in both `clearRender()`
    and `teardown()`. Imported `type UnderlayState`. tsc + lint 0 errors (5 pre-existing unbound-method
    warns, none mine); suite 527/527 green. Live beneath-layers render deferred to Step 9 (needs the
    Step 6 panel to pick an underlay).
  - **Revised (2026-07-15):** flipped from underlay to **overlay** — `DEPTH_UNDERLAY = 200` (above the
    tile layers, below ghosts/grid/guide overlays), so opaque painted tiles never hide the reference.
    Code identifiers keep the `underlay*` names; only the depth constant + doc wording changed. Done in
    `EditorScene.ts` (const + the 3 "beneath tile layer 0" comments) and `docs/EDITOR.md`.
  - ~~In `EditorScene.ts`: add `const DEPTH_UNDERLAY = -100;` (comment: sits below tile layers over the
    transparent camera).~~ Add an `underlayImage?: Phaser.GameObjects.Image` field + an `underlayEpoch`
    counter. Add `refreshUnderlay()` modelled on `refreshGhosts`: if `store.underlay` present **and**
    `visible`, load its `dataUrl` as a texture (unique key `__underlay`; if the key exists,
    destroy/remove first — the data URL can change), on `COMPLETE` create/replace the Image at
    `setOrigin(0,0)`, `x = offsetX*TILE_SIZE`, `y = offsetY*TILE_SIZE`, `setScale(scale)`,
    `setDepth(DEPTH_UNDERLAY)`, `setAlpha(opacity)`; epoch-guard the async against a stale refresh.
    When absent/hidden, destroy the image + remove the texture.
  - Subscribe to `underlayRevision` in `create()` → `refreshUnderlay()`. Call it once during initial
    `buildScene`/`syncDocument`. Tear down (destroy image, remove `__underlay` texture) in the scene
    teardown/`clearRender` path so re-opening a map doesn't leak textures.
  - Side effects: texture-manager hygiene (always remove `__underlay` before re-creating / on
    teardown, or Phaser errors on a duplicate key); confirm the negative depth renders beneath layer 0.
  - Docs: none (Step 8).
  - Done when: a selected underlay renders beneath all tile layers at the set opacity; opacity/offset/
    scale/visibility changes reflect live; opening a map with a persisted reference shows it.

- [x] **Step 6: Reference control panel** `[inline]`
  - Outcome: New `src/editor/panels/ReferencePanel.tsx` (mirrors `InspectorPanel`: subscribes to
    `underlayRevision`/`mapEpoch` as re-render triggers, reads `underlay`/`mapId` via `getState()`;
    re-declares the `headingClass`/`fieldClass`/… utility strings + a local `NumberField` since those
    were never exported). Collapsible "Reference" heading (local `collapsed` state, ▾/▸). Controls:
    `ui/select` dropdown of `listMapReferences()` (fetched on mount, empty-on-failure) + **Load** button
    → `setUnderlayReference`; `<input type="file" accept="image/png,image/jpeg">` → `setUnderlayImage
    FromFile` (resets `value` after pick); `ui/slider` opacity 0..1 (with % label); offset X/Y + scale
    `NumberField`s (disabled when `locked`); Visible + Lock plain `<input type=checkbox>`; Clear button.
    Transform controls only render when `underlay` is set; "No map open." when `mapId` null. Mounted in
    the right `<aside>` (`EditorApp.tsx`) under a `<Separator className="my-3.5" />` after `ZonesPanel`.
    Added **drag-drop** on the Map-tab panel div in `EditorApp.tsx` (`onDragOver` preventDefault +
    `dropEffect='copy'` gated on `types` including 'Files'; `onDrop` routes the first `image/*` file
    through `setUnderlayImageFromFile`). No sidecar picker UI (auto-align comes from the fetched
    sidecar). tsc + lint 0 errors; suite 527/527 green. Live UI round-trip deferred to Step 9.
  - New `src/editor/panels/ReferencePanel.tsx`, mirroring `InspectorPanel.tsx` conventions (subscribe
    to `underlayRevision`, read via `getState()`; `headingClass`/`fieldClass`; `NumberField`).
    A collapsible "Reference" section with: **a `ui/select` dropdown** populated from
    `listMapReferences()` (primary path) + a **Load** action calling `setUnderlayReference`; a small
    **"…or load a file"** `<input type="file" accept="image/png,image/jpeg">` (secondary, desktop) →
    `setUnderlayImageFromFile`; **opacity** slider (`ui/slider`, 0..1); **offset X/Y** `NumberField`s
    (tiles); **scale** `NumberField`/slider; **visible** + **lock** checkboxes (plain
    `<input type="checkbox">`); a **Clear** button. Disable offset/scale when `locked`. Surface any
    align `warning` via sonner. Mount in the right `<aside>` (`EditorApp.tsx`) with a `<Separator
    className="my-3.5" />` above it.
  - Add **drag-drop** on the Map tab viewport container in `EditorApp.tsx` (desktop convenience): on
    `drop` of an image file, route through `setUnderlayImageFromFile`; gate to the Map tab; reset the
    file input so re-picking the same file re-fires `change`. Do **not** add the sidecar picker UI
    (auto-align comes from the fetched sidecar).
  - Side effects: touches `EditorApp.tsx` (panel mount + drop handler) — Step 7 also edits
    `EditorApp.tsx` (keydown); do Step 6 first, Step 7 sequential.
  - Docs: none (Step 8).
  - Done when: full UI round-trip — pick a repo reference → underlay appears aligned; file-picker +
    drag-drop load ad-hoc images; sliders/offsets/lock/hide/clear all work.

- [x] **Step 7: Panel visibility toggle + `U` shortcut** `[delegate sonnet]` (parallel: A)
  - Outcome: `U` was confirmed free (grepped `EditorApp.tsx`/`EditorScene.ts` keydown + `shortcuts.ts`).
    `EditorApp.tsx`: added a handler in `onKey` right after the `activeTabId !== 'map'` gate —
    `if (e.key.toLowerCase() === 'u' && !e.metaKey && !e.ctrlKey && !e.altKey) { preventDefault();
    getState().toggleUnderlayVisible(); return; }` (typing-guard already above it; store action no-ops
    when underlay null). `shortcuts.ts`: new group `{ title: 'Reference underlay', shortcuts: [{ keys:
    ['U'], action: 'Toggle the reference underlay's visibility (Map tab only)' }] }` before "World
    view". No toolbar checkbox (critique #5). tsc + lint clean. (Delegated → sonnet.)
  - Add a `U` keyboard shortcut in `EditorApp.tsx`'s `onKey` handler (guard typing in inputs; gate
    `activeTabId==='map'`; no-op when `underlay` is null) calling `toggleUnderlayVisible`. Add a
    matching `{keys:'U', action}` entry to the appropriate group in `shortcuts.ts` (**project rule:
    keep the in-app Shortcuts panel in sync**). Confirm `U` doesn't collide; if it does, pick a free
    key and use it consistently. **No toolbar checkbox** (critique #5) — the panel's visible checkbox
    is the on-screen control.
  - Side effects: edits `EditorApp.tsx` (after Step 6) + `shortcuts.ts` only — write-disjoint from
    Step 8's docs.
  - Docs: the `shortcuts.ts` entry is the in-app doc; prose is Step 8.
  - Done when: `U` toggles the underlay on the Map tab and the entry shows in the Shortcuts panel.

- [x] **Step 8: Docs** `[delegate haiku]` (parallel: A)
  - Outcome: `docs/EDITOR.md` only — added a terse "Reference underlay" `##` subsection between "Map vs
    World view" and "File formats": what it is (Map-tab trace-over image beneath tile layers),
    committed references via dropdown + file-picker/drag-drop for ad-hoc, per-map localStorage under
    `mostowo-editor-underlay:` (never in `.map.json`/prod), sidecar grid auto-align, `U`/panel-checkbox
    toggle, phone-usable, cross-linked to [map-reference/](../scripts/map-reference/README.md). Matches
    the doc's terse pointer style. (Delegated → haiku.)
  - `docs/EDITOR.md`: add a terse "Reference underlay" subsection: dev tracing aid; references are
    **committed** and picked from a dropdown (served via `/__editor`), file-picker/drag-drop for
    ad-hoc; per-map **localStorage**, **never** in `.map.json` or prod; optional sidecar auto-align;
    `U` toggles; usable from a phone against a running dev server. Cross-link
    `scripts/map-reference/README.md`. High-signal, few lines — match the doc's terse pointer style.
  - Side effects: none (docs only; write-disjoint from all code steps).
  - Done when: `docs/EDITOR.md` describes the feature accurately and links the capture tool.

- [ ] **Step 9: Verify end-to-end** `[inline]`
  - `npm run editor`, open a map, pick the `mostowo` reference from the dropdown, confirm: aligns to
    grid 1:1; opacity/offset/scale/lock/hide work; `U` toggles; survives a page reload (localStorage);
    file-picker + drag-drop load an ad-hoc image; does **not** appear in a saved `.map.json` (diff the
    file); switching maps swaps/clears the underlay with no console errors or leaked textures. Run
    `npm test`, `tsc --noEmit`, lint.
  - Done when: all the above hold; test/typecheck/lint green.

## Out of scope

- IndexedDB / any storage beyond localStorage (revisit only if the ~5 MB ceiling across many
  persisted references actually bites — deduping by reference name pushes that out).
- Rotation, non-uniform scale, or per-corner warp (uniform scale + offset only).
- Multiple simultaneous underlays or an underlay in the **World** tab (Map tab only).
- Any change to `MapFile`/`mapFormat.ts`, the runtime game loader, or the capture tool's output format.
- A standalone/static (no-dev-server) build of the editor for fully-offline phone use — the editor
  still needs the `/__editor` dev server running somewhere to save maps at all.

## Critique

**Verdict (pre-revision):** Sound, well-grounded plan with accurate architecture claims and no
one-way doors — but reconsider the IndexedDB-blob persistence choice (its justification rested on an
inflated file-size estimate and ignored the existing dev-middleware seam) before starting; everything
else proceed-and-fix. **All findings below are addressed in the revision above.**

|#|Finding|Severity|Resolution in this plan|
|-|-------|--------|-----------------------|
|1|IndexedDB blob + object-URL heavier than fetching from a known dev path + small-JSON persistence.|Medium|**Resolved** — references committed + served via `/__editor`, picked from a dropdown; localStorage (not IndexedDB).|
|2|Size rationale wrong: PNG is 659 KB (~880 KB base64), well inside localStorage.|Medium|**Resolved** — corrected; localStorage data-URL cache, deduped by reference name.|
|3|Sidecar auto-align near-redundant for v1 (both paths → scale 1/offset 0); its live value is the size-mismatch warning.|Low|**Resolved** — no sidecar picker UI; auto-align uses the sidecar fetched alongside a repo reference; pure helper kept + tested.|
|4|New persistence layer ships with no automated test.|Low|**Mitigated** — localStorage is testable under jsdom (Step 3 adds a test if trivial); risk lower than IndexedDB, no new dep.|
|5|Triple visibility control over-builds; `visible` can't join the typed `OVERLAYS` array.|Low|**Resolved** — panel checkbox + `U` only; no toolbar checkbox.|
|6|Object-URL revoke on the `loadMap` switch path is the likeliest bug.|Low|**Resolved** — data URLs replace object URLs entirely; no revoke lifecycle.|
