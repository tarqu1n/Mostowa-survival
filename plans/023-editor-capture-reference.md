# Editor-Driven Map-Reference Capture

> Status: in review

## Summary

Add UI to the dev-only Map Builder to **create a new named reference image from a center coordinate
- radius**, so it appears in the plan-022 reference-overlay dropdown ready to trace — **usable from a
phone** against a running dev server. Because the capture is a Playwright/headless-Chromium job
([capture.mjs](../scripts/map-reference/capture.mjs)) that can't run in the browser, the editor POSTs
to a **new `/__editor/map-references` middleware endpoint** that runs the capture server-side (on
whatever host runs the dev server), writes `out/<name>-reference.{png,json}`, and returns the result;
the panel then refreshes the dropdown and **auto-loads** the new reference as the current overlay.
Entirely inside `src/editor/**` + `scripts/**`, so structurally excluded from the prod build.

## Context & decisions

**User decisions (2026-07-15 review):**
- **Area = radius (metres, square).** One number → `gridW = gridH = ceil((2 × radiusMetres) /
  metresPerTile)`. `metresPerTile` stays **3**, `pxPerTile` stays **16** (= `TILE_SIZE`). Inputs:
  `name`, center coordinate, `radiusMetres`.
- **Name clash → confirm, then overwrite.** UI checks the already-fetched references list; if the name
  exists, confirm before POSTing with `overwrite:true`. The endpoint also enforces this (409 unless
  `overwrite`) as a belt-and-braces guard.
- **Auto-load on success.** After a successful capture, refresh the dropdown, select the new name, and
  call `setUnderlayReference(name)` so it appears on the Map tab immediately.
- **Coordinate entry = paste `"lat, lon"` string** (one field, e.g. `54.0726, 16.3603` — exactly what
  Maps apps' "copy coordinates" yields). Parse + validate `lat ∈ [-90,90]`, `lon ∈ [-180,180]`.

**Org / policy notes (must hold):** the capture hits **openstreetmap.org tiles** (external network)
from the dev server — this is a **dev-only, supervised, user-initiated** action (a Capture button
click), not an auto-pilot connection to any Third Bridge live environment. Keep the existing polite,
identifying `USER_AGENT` and the pinned `maplibreVersion` (OSM tile usage policy — faking a browser UA
gets you blocked). Never render Google imagery — coordinate-in, OSM-out only.

**Repo facts the steps rely on** (verified 2026-07-15; re-verify against code before building):

- **`capture.mjs`** (`scripts/map-reference/`, 167 lines): a CLI script with **no exports**. `CONFIG`
  (lines 20-31) is env-fed (`MAPREF_NAME/LAT/LON/GRID_W/GRID_H/M_PER_TILE/PX_PER_TILE`). Pure helpers
  `derive(cfg)` (42-67, geometry → `{imageW,imageH,metresPerPixel,zoom,bbox,extentMetres}`) and
  `buildHtml(cfg,d)` (71-107). `main()` (109-161) launches chromium, screenshots `#map` →
  `out/<name>-reference.png`, writes the `<name>-reference.json` sidecar `{name, source, center,
  grid, metresPerTile, pxPerTile, image, metresPerPixel, zoom, bbox, extentMetres}`. `outDir` is
  derived from `import.meta.url` (stays correct when imported). Entrypoint `main().catch(...)` (163-166).
  Playwright is a **devDependency** (`playwright ^1.61.1`) — import is dev-only.
- **`vite-editor-api.mjs`** (546 lines, Node builtins only): `editorApiPlugin()` (335) →
  `configureServer` computes `referencesDir = join(root, 'scripts/map-reference/out')` (344) and
  registers one middleware (346). Dispatch = manual `if (path===… && method===…)` chain under a
  `/__editor/` prefix gate; all exceptions → `sendJson(res,500,…)`. **No POST route today** — all
  mutations are `PUT`. Mirror `PUT /__editor/asset-override` (377-414) / `asset-regions` (416-476):
  `JSON.parse((await readBody(req)).toString('utf8'))` in a try/catch → `sendJson(400,{error:'invalid
  JSON body'})`; validate; do work; `sendJson(200,{ok:true,…})` or `502` on failure. `sanitiseId(id)`
  (74-76) applies `ID_RE=/^[a-z0-9-]+$/`. `existsSync` available. The `enqueueRegen`/`execFileAsync`
  serialisation pattern (245-330) is the template for a one-at-a-time long-running job. Registered in
  `vite.config.ts:37` behind `command === 'serve'` (dev-only). plan-022 endpoints: `GET
  /__editor/map-references` (478-481, → `listMapReferences(referencesDir)`) + `:name.(png|json)`
  (483-503).
- **`api.ts`** (`src/editor/`): `BASE='/__editor'`; `expectOk(res,action)` throws on `!res.ok`.
  Existing PUT wrappers `putAssetOverride`/`putAssetRegions` (140-178) are the style to mirror: `await
  expectOk(await fetch(\`${BASE}/…\`,{method,headers:{'Content-Type':'application/json'},body:
  JSON.stringify(...)}), 'label')` → `return (await res.json()) as ResultType`, with a documented
  result`interface` + JSDoc.
- **`ReferencePanel.tsx`** (`src/editor/panels/`, 258 lines): subscribes to `underlayRevision`/
  `mapEpoch` as re-render triggers, reads state via `getState()`; actions via `store().…`. **Reference
  list fetched once on mount** — `useEffect(…,[])` (87-99) `listMapReferences().then(setReferences)`;
  **no re-fetch mechanism** (extract into a `refresh` callback reused post-capture). Collapsible
  pattern (105-113): `<button>` toggling `collapsed`, `▸`/`▾`, body under `{!collapsed && (…)}`. UI
  primitives already imported: `Select*`, `Slider`, `Input`, `Label`, `Button`, private `NumberField`
  (36-73, commit on blur/Enter), local class consts `headingClass`/`fieldClass`/…. **sonner** is
  imported in store actions, not this panel — idioms available: `toast()`, `toast.success`,
  `toast.error`, `toast.warning`, optional `{duration}` (`import { toast } from 'sonner'`).
- **`config.ts:38`** `TILE_SIZE = 16`. **No metres-per-tile constant in `src/`** — it lives only in the
  capture tool (`metresPerTile` default 3). No npm script for capture (run via `node
  scripts/map-reference/capture.mjs`).
- **Newly-captured reference won't appear** until `listMapReferences()` is re-run — the fix is
  self-contained to `ReferencePanel.tsx` (refresh local `references` state after the POST resolves).

## Steps

- [x] **Step 1: Refactor `capture.mjs` to export a callable `capture(cfg)`** `[delegate sonnet]`
  - Outcome: `scripts/map-reference/capture.mjs` only. `derive`/`buildHtml` now `export function`;
    `main()` → `export async function capture(cfg)` (param'd on `cfg`, `outDir` from `import.meta.url`
    unchanged) returning `{ pngPath, jsonPath, sidecar }` before the `finally` closes the browser.
    Bare `main().catch(...)` replaced with `if (import.meta.url === \`file://${process.argv[1]}\`)
    capture(CONFIG).catch(...)` direct-run guard; `CONFIG` (env-fed), `USER_AGENT`,`maplibreVersion`,
    sidecar shape untouched. Verified: CLI reproduces the mostowo reference **byte-identical** (PNG MD5
    match, empty JSON diff);`import { capture }` resolves without launching chromium; eslint 0
    findings. Note: `scripts/map-reference/`is still fully untracked in git (`?? scripts/map-reference/`)
    — nothing committed.
  - In `scripts/map-reference/capture.mjs`: add `export` to `derive` and `buildHtml`, and refactor
    `main()` into `export async function capture(cfg)` — the same body but parameterised on the passed
    `cfg` instead of the module `CONFIG`. Return `{ pngPath, jsonPath, sidecar }` so a caller (the
    middleware) can respond with the result. Keep `outDir` derived from `import.meta.url` (unchanged).
  - Keep the CLI working: guard the auto-run so it only fires when executed directly, not when
    imported — replace `main().catch(...)` with
    `if (import.meta.url === \`file://${process.argv[1]}\`) capture(CONFIG).catch((e) => { console.error('[mapref] failed:', e.message); process.exitCode = 1; });`
    Keep the `CONFIG` object (still env-fed) as the CLI's default input.
  - Do **not** change `derive`/`buildHtml`/sidecar-shape logic, the `USER_AGENT`, or `maplibreVersion`.
  - Side effects: none at runtime for the CLI path (same output); the export is new surface only.
  - Docs: none here (Step 5 updates the README).
  - Done when: `node scripts/map-reference/capture.mjs` still writes the mostowo reference exactly as
    before; `import { capture } from './capture.mjs'` resolves and `capture(cfg)` returns the written
    paths + sidecar. `tsc`/lint unaffected (JS file).

- [x] **Step 2: `POST /__editor/map-references` endpoint + `api.ts` wrapper** `[inline]`
  - Outcome: `scripts/vite-editor-api.mjs` + `src/editor/api.ts`. Added `POST /__editor/map-references`
    branch (after the GET) mirroring the asset-override handler: parse body (400 on bad JSON),
    `sanitiseId(name)` (400), finite/in-range `lat∈[-90,90]`/`lon∈[-180,180]`/`radiusMetres∈(0,5000]`
    (400), `existsSync(<name>-reference.png) && !overwrite` → 409 `{error:'exists',name}`, module-level
    `captureInFlight` flag → 409 `{error:'busy'}` for a concurrent second call, then `grid =
    ceil(2·radius/3)` and `await capture({...gridW:grid,gridH:grid,metresPerTile:3,pxPerTile:16,
    maplibreVersion:'4.7.1'})` → 200 `{ok,name,grid,image}`, 502 on throw, `finally` clears the flag.
    New consts `MAP_REFERENCE_{M_PER_TILE,PX_PER_TILE,MAX_RADIUS_M,MAPLIBRE_VERSION}` + module-doc
    endpoint entry + paragraph. **Deviation from plan wording (justified):** `capture.mjs` is imported
    via a **dynamic `import('./map-reference/capture.mjs')` inside the handler**, NOT a top-of-file
    import — `vite.config.ts:5` statically imports this middleware at config-load for prod builds too,
    so a static import would pull `playwright` (devDep) into every build and break CI where devDeps
    aren't installed. Lazy import keeps playwright strictly on the dev-serve, user-initiated path.
    Client: `src/editor/api.ts` adds `interface CaptureResult`, `class CaptureError` (`kind:
    'exists'|'busy'|'other'`), and `captureMapReference(opts)` which branches on the 409 body's `error`
    to throw the tagged error (panel distinguishes exists vs busy vs other). Verified live on a dev
    server: 400 (bad name / out-of-range lat / bad radius / invalid JSON), 409 `exists` (mostowo,
    no-overwrite, no chromium launch), 200 happy path (radius 60 → grid 40×40, image 640×640, sidecar
    mpt 3/ppt 16, list refreshes), 409 `busy` on a concurrent second POST. tsc + eslint (0 findings)
    clean. Test artifact removed.
  - **Middleware** (`scripts/vite-editor-api.mjs`): add a `POST /__editor/map-references` branch to the
    dispatch chain, mirroring the `PUT /__editor/asset-override` handler. Parse the JSON body
    (`{ name, lat, lon, radiusMetres, overwrite? }`); on parse failure `sendJson(400,{error:'invalid
    JSON body'})`. Validate: `name` via `sanitiseId` (400 if invalid); `lat`/`lon`/`radiusMetres`
    finite numbers in range (`lat∈[-90,90]`, `lon∈[-180,180]`, `radiusMetres > 0` and a sane upper
    bound, e.g. ≤ 5000) else 400. Compute `metresPerTile=3`, `pxPerTile=16`,
    `gridW = gridH = Math.ceil((2*radiusMetres)/metresPerTile)`. If
    `existsSync(join(referencesDir,\`${name}-reference.png\`))` and `!overwrite` → **409**
    `{error:'exists', name}`. Otherwise`import { capture } from '../map-reference/capture.mjs'` (top of
    file) and `await capture({ name, centerLat:lat, centerLon:lon, gridW, gridH, metresPerTile,
    pxPerTile, maplibreVersion:'4.7.1' })`; on success`sendJson(200,{ ok:true, name, grid:{w:gridW,
    h:gridH}, image: cap.sidecar.image })`; on throw`sendJson(502,{error:String(e.message||e)})`.
  - **Serialise** captures one-at-a-time (Playwright + network is heavy): guard with a module-level
    in-flight promise/flag like `enqueueRegen` (245-330) — reject/409-style a second concurrent capture
    (`{error:'busy'}`, 409) or queue it; a simple in-flight boolean returning 409 `busy` is enough.
  - **Client wrapper** (`src/editor/api.ts`): add `captureMapReference(opts: { name: string; lat:
    number; lon: number; radiusMetres: number; overwrite?: boolean }): Promise<CaptureResult>` mirroring
    `putAssetOverride` style, with a documented `interface CaptureResult { ok: true; name: string;
    grid: { w: number; h: number }; image: { w: number; h: number } }`. It must let the caller
    distinguish the **409 name-exists** case from other errors — e.g. check `res.status === 409` and
    the body's `error` before `expectOk`, throwing a typed/tagged error (or returning a discriminated
    result) the panel can branch on for the confirm-overwrite flow. JSDoc it.
  - Side effects: adds the **first POST route** + the first third-party import (`playwright` via
    `capture.mjs`) into the middleware — both dev-serve-only (`command==='serve'` gate), never in the
    prod bundle. Confirm the `.mjs`→`.mjs` import path resolves from `vite-editor-api.mjs`.
  - Docs: none here (Step 5).
  - Done when: `curl -X POST /__editor/map-references` with a test body writes a new
    `out/<name>-reference.{png,json}`; a duplicate name without `overwrite` returns 409; bad
    input returns 400; a concurrent second call returns 409 `busy`; the wrapper typechecks and
    surfaces the 409-exists case distinctly.

- [x] **Step 3: "Capture new" section in `ReferencePanel.tsx`** `[inline]`
  - Outcome: `src/editor/panels/ReferencePanel.tsx` only. Extracted the mount fetch into a
    `useCallback` `refresh()` (mount effect + post-capture both call it). New collapsible "Capture new"
    sub-section (default collapsed, own ▸/▾ toggle, `border-t` divider) after the file-picker with:
    a **Name** `Input` (validated against `REFERENCE_NAME_RE = /^[a-z0-9-]+$/`, mirrors the endpoint's
    `sanitiseId`; inline red feedback), a **Center (lat, lon)** paste `Input` (`parseLatLon` splits/
    trims/`Number`s, rejects empty parts + out-of-range; inline feedback), a **Radius (m)** input
    (default 240, cap 5000; inline feedback), and a **Capture** `Button` (disabled while
    `capturing`/invalid, label flips to "Capturing…"). Flow: `onCapture` pre-checks the fetched list →
    `window.confirm` before overwriting; `doCapture(lat,lon,overwrite)` calls `captureMapReference`,
    on the tagged **409 exists** race re-confirms + retries with `overwrite:true`, on **busy**/other
    toasts, on success `await refresh()` → `setSelectedRef(name)` → `store().setUnderlayReference(name)`
    (auto-load) → `toast.success`; `finally` clears `capturing`. No store slice touched. **Deviation
    from plan wording (justified):** radius (and coord) are **controlled raw-string inputs with derived
    numbers**, NOT the commit-on-blur `NumberField` the plan named — clicking Capture right after typing
    a radius would otherwise read a stale value (the blur's `setState` isn't visible to the same-tick
    click handler). tsc + eslint (0 findings) clean. Interactive click-through deferred to Step 5
    (mirrors how plan 022's UI steps deferred live verify), endpoint already live-verified in Step 2.
  - Extract the mount-effect reference fetch into a reusable `refresh` callback (currently `useEffect(…
    ,[])`) so both mount and post-capture can call it. Add a collapsible **"Capture new"** sub-section
    (mirror the existing collapsible pattern) with: a **name** `Input` (validate against `ID_RE` =
    lowercase/digits/hyphens; show inline invalid feedback, disable Capture when invalid); a **`"lat,
    lon"` paste** `Input` (parse `split(',')`→trim→`Number`; validate `lat∈[-90,90]`,`lon∈[-180,180]`;
    inline feedback); a **radius (m)** `NumberField` (default e.g. `240`, min sane, step); and a
    **Capture** `Button`.
  - Capture flow: disable the button + show "Capturing…" while a local `capturing` flag is set (the
    job takes seconds). If `references` already includes the name → `window.confirm(\`Overwrite existing
    reference "${name}"?\`)`; bail if declined, else pass `overwrite:true`. Call
    `captureMapReference({name,lat,lon,radiusMetres,overwrite})`. On the tagged **409 name-exists** race
    (list was stale), prompt to confirm + retry with `overwrite:true`. On success: `await refresh()`,
    then `store().setUnderlayReference(name)` (**auto-load**), `toast.success(\`Captured "${name}".\`)`.
    On failure`toast.error(...)`. Always clear`capturing` in a `finally`.
  - Do **not** touch the store slice (no new Zustand state needed — the panel owns `references` +
    `capturing` locally). `setUnderlayReference` already exists (plan 022) and handles fetch+cache+
    align+persist.
  - Side effects: `ReferencePanel.tsx` only. Uses `captureMapReference` from Step 2. A slow/failed OSM
    fetch surfaces via `toast.error` and leaves state unchanged (non-fatal).
  - Docs: none here (Step 5).
  - Done when: from the panel, entering a name + pasted coordinate + radius and clicking Capture writes
    a new reference, it appears in the dropdown, and auto-loads onto the Map tab; a duplicate name
    prompts to confirm; invalid name/coordinate disables Capture with feedback; errors toast without
    breaking the panel.

- [x] **Step 4: Docs** `[delegate haiku]`
  - Outcome: `scripts/map-reference/README.md` (new "In-editor capture" note before the Config section:
    Reference panel → "Capture new", name + pasted `lat,lon` + radius, POSTs to dev-server middleware,
    same `<name>-reference.{png,json}` server-side, `gridW=gridH=ceil(2·radius/metresPerTile)` default
    3 m/tile, phone-usable, CLI remains for batch) + `docs/EDITOR.md` (appended one sentence to the
    "Reference overlay" section's last line: in-editor capture via Reference → "Capture new", runs on
    dev-server, cross-linked to the map-reference README). Terse pointer style matched; no new
    markdownlint findings (pre-existing MD060 table warnings unrelated). Delegated → haiku.
  - `scripts/map-reference/README.md`: add a short note that references can now **also be captured from
    the editor** (Reference panel → "Capture new": name + pasted `lat, lon` + radius), which runs this
    same capture server-side and writes `out/<name>-reference.{png,json}` — the CLI (`node
    scripts/map-reference/capture.mjs`) remains for scripted/batch use. Note radius →
    `gridW=gridH=ceil(2·radius/metresPerTile)`.
  - `docs/EDITOR.md`: in the "Reference overlay" section, add one line that new references can be
    captured in-editor from a coordinate + radius (phone-usable; runs on the dev-server host).
  - Match each doc's terse, high-signal pointer style; a few lines each.
  - Side effects: none (docs only; write-disjoint from all code steps).
  - Done when: both docs accurately describe the in-editor capture and the radius→grid mapping.

- [x] **Step 5: Verify end-to-end** `[inline]`
  - Outcome: Automated gates all green — `tsc --noEmit` clean; `npm run lint` 0 errors (90 pre-existing
    warnings); `npm test` 527/527; prod `vite build` succeeded and a grep of `dist/` found NO
    `playwright`/`__editor`/`map-references`/`vite-editor-api` references (route + playwright confirmed
    serve-only, absent from the bundle) — the lazy `import()` from Step 2 holds. Endpoint behaviours
    (400s, 409 exists, 409 busy, 200 real capture with correct grid/image dims, list refresh) were
    live-verified in Step 2; CLI byte-identical in Step 1. Interactive UI click-through verified
    on-device by Matt (`npm run editor`): capture from the "Capture new" panel auto-loads the new
    reference onto the Map tab aligned to grid; invalid name/coord disables Capture; re-capture prompts
    confirm-overwrite; `U` toggles — "looking good", no console errors. Test artifacts
    (`test-reference.{png,json}`) removed; only committed `mostowo-reference.*` remains. `dist/` build
    artifact removed.
  - `npm run editor`; open a map; in the Reference panel's "Capture new", paste a coordinate (e.g. a
    tweaked Mostowo `lat, lon`), set a radius, give it a new name, Capture. Confirm: the job runs
    server-side, the new `out/<name>-reference.{png,json}` is written with the right dimensions
    (`gridW=gridH=ceil(2·radius/3)`, image = grid·16), the dropdown refreshes, and it **auto-loads** as
    the overlay aligned 1:1. Then: re-capture the same name → confirm-overwrite prompt; invalid
    name/coordinate → Capture disabled; a second concurrent capture → `busy`. Confirm the CLI still
    works (`node scripts/map-reference/capture.mjs` reproduces mostowo). Confirm nothing leaks into a
    prod build (route + playwright import are serve-only). Run `npm test`, `tsc --noEmit`, lint.
  - Done when: all the above hold; test/typecheck/lint green.

## Out of scope

- Rectangular width/height input — **radius (square) only** (user decision). `metresPerTile`/`pxPerTile`
  stay fixed at 3 / 16.
- Non-OSM tile sources; any Google imagery (license).
- Editing/renaming/deleting existing captures from the editor (re-capture over a name is the only
  mutation).
- A capture progress bar / streaming logs — a disabled "Capturing…" button + success/error toast is
  the whole feedback surface.
- Any change to `MapFile`/`mapFormat.ts`, the runtime map loader, the capture output format, or the
  plan-022 overlay render path.
- Persisting capture inputs (name/coord/radius) across reloads.
