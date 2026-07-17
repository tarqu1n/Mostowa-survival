# Editor asset caching via a service worker

> Status: planned — CRITIQUE RAISED 3 HIGH BLOCKERS; do not execute as written. See Critique (esp. #1 root-scope safety, #2 simpler max-age alternative) and settle the approach first.

## Summary

The Map Builder is served by `vite dev` (on the guppi home server and via `npm run editor`) — **not**
a production build; `editor.html` is deliberately excluded from `vite build`. Assets come from
`public/assets/` at stable, unhashed URLs. Measured behaviour of the running dev server: assets
return `Cache-Control: no-cache` + a **weak, mtime-based ETag**, so the browser must revalidate
**every** load (one conditional request per asset; unchanged → `304`, no byte re-download) and is
**dead offline**; and `asset-catalog.json` is fetched cache-busted (`?t=${Date.now()}` in
`src/editor/catalogSource.ts`), so it's a **full ~1.13 MB re-download on every load**. Because the
ETag is mtime-based, a guppi re-clone / container rebuild changes every mtime and forces the whole
~23 MB to re-download once.

This feature adds an **editor-only service worker** that caches `/assets/tilesets/**` cache-first for
true offline use and zero per-asset round-trips, using a **deterministic per-asset content-hash
`rev`** added to `asset-catalog.json` as a precise cache-invalidation oracle: an asset is re-fetched
only when its `rev` changes.

## Context & decisions

**Measured / verified facts:**

- Probed the running `vite dev`: a tileset PNG returns `Cache-Control: no-cache` and
  `ETag: W/"<size>-<mtime>"`; a conditional re-request returns `304`. `asset-catalog.json` is
  1,188,811 bytes and is fetched with a `?t=` cache-buster (never even 304s).
- `public/assets` ≈ 24 MB / ~2226 images (~23 MB tilesets). No existing service worker, PWA config,
  `vite-plugin-pwa`, or manifest anywhere.
- Entry structure: `editor.html` → `<script type="module" src="/src/editor/main.tsx">` (React shell
  → Phaser `EditorScene`), a **separate entry** from the game's `index.html`. `editor.html` is
  excluded from `vite build` (`vite.config.ts` `rollupOptions.input: 'index.html'`).
- Runtime asset URLs to cache: `/assets/tilesets/<pack>/...` (built by `tilesetAssetUrl` in
  `src/editor/textureLoading.ts`, used both by Phaser `load.image` and as CSS `background-image` in
  `LibraryPanel.tsx`) and `/assets/asset-catalog.json`.
- On guppi, **only the editor** is ever served (the game ships separately to GitHub Pages). Local
  `npm run editor` and `npm run dev` share an origin, so a root-scoped SW could see both pages there.

**Decisions (my recommendations — Matt to confirm/adjust; safe defaults chosen):**

1. **Strategy: download-once + versioned catalog.** Add a deterministic per-asset content-hash `rev`
   to `asset-catalog.json`; the SW treats `/assets/tilesets/**` as immutable *per `rev`* and
   re-fetches an asset only when its `rev` changes. (Rejected alternative: stale-while-revalidate on
   the existing ETags — simpler but still one request per asset and shows one-load-stale; keep as a
   fallback if `rev` proves troublesome.)
2. **Cache key carries the `rev`.** The SW resolves each `/assets/tilesets/**` request to a cache key
   of `<url>?rev=<rev>` (looked up from the catalog it holds). A changed `rev` is therefore a natural
   cache miss → re-fetch; stale entries for that URL are pruned. No separate metadata store.
3. **Catalog stays fresh (it's the oracle).** `/assets/asset-catalog.json` is served **network-first
   with cache fallback** — fresh online, still available offline.
4. **Lazy / on-demand caching**, not eager. Each tileset asset is cached the first time it's fetched.
   No 23 MB precache on first mobile load. (An opt-in "make available offline" bulk-precache is
   **out of scope** for v1 — noted as a future add.)
5. **Editor-only registration.** Register the SW **only** from the editor entry (`src/editor/main.tsx`),
   never from the game entry. Additionally, the SW's `fetch` handler only ever calls `respondWith`
   for **GET** requests under `/assets/tilesets/**` (plus the catalog) — every other request
   (Vite internals, the game page, the editor save API) passes straight through untouched. So even
   though the SW registers at root scope, it is inert for everything but editor tileset assets.
6. **Hand-rolled minimal SW**, no `vite-plugin-pwa` — avoids adding build tooling to a page that has
   no build step, and keeps the logic auditable. Provide a `?nosw` kill switch (unregister + skip) for
   debugging.

**Must-bypass prefixes** (the SW must NOT intercept — it simply doesn't match them, since it only
matches `/assets/tilesets/**` + the catalog): `/@vite/`, `/@react-refresh`, `/@fs/`, `/@id/`, `/src/`,
`/node_modules/`, `/.vite/`, the HMR WebSocket, and the editor save API `/__editor/*`
(`scripts/vite-editor-api.mjs`). Non-GET requests are never intercepted.

**Shared-generator note:** plan 032 (library role filtering) also edits `scripts/asset-catalog.mjs`
and `src/editor/catalog.ts` and regenerates `public/assets/asset-catalog.json`. Whichever plan runs
second rebases its generator edits on the first and re-runs `npm run assets:catalog`.

## Steps

- [ ] **Step 1: Add a deterministic per-asset `rev` to the catalog generator** `[delegate sonnet]`
  - `scripts/asset-catalog.mjs`: at the point each asset file is read (the loop that reads PNG IHDR
    dimensions), compute a content hash of the file bytes with Node's built-in `crypto`
    (`createHash('sha1').update(bytes).digest('hex').slice(0, 16)`) and add `rev: <hash>` to the
    emitted asset. No new deps. The hash is content-derived — preserve the existing deterministic,
    no-timestamp, byte-identical-regen guarantee (do **not** use mtime).
  - `src/editor/catalog.ts`: add `rev: string` to `CatalogAsset`. Extend the validation block to
    require a non-empty `rev`.
  - Side effects: regenerates all of `public/assets/asset-catalog.json` (every entry gains `rev`) —
    commit it. If plan 032 already landed, rebase on its generator changes.
  - Docs: `docs/assets-catalog.md` — document `rev` (content hash; drives SW cache invalidation).
  - Done when: `npm run assets:catalog` twice = byte-identical; every asset has a stable 16-char
    `rev`; editing one PNG's bytes changes only that asset's `rev`; `npm run typecheck` passes.

- [ ] **Step 2: Write the service worker (`public/sw.js`)** `[inline]`
  - Plain JS SW served at `/sw.js` (root scope). Responsibilities:
    - On `install`: `skipWaiting()`. On `activate`: `clients.claim()`.
    - Load the catalog (network-first) and build an in-memory `Map<assetUrl, rev>` for
      `/assets/tilesets/**` entries (derive each URL via the same shape as `tilesetAssetUrl`:
      `/assets/tilesets/<pack>/<source.path>`, `encodeURI`d). Refresh this map whenever the catalog is
      re-fetched.
    - `fetch` handler: **only** `respondWith` when `request.method === 'GET'` AND the path is under
      `/assets/tilesets/`, OR is `/assets/asset-catalog.json`. All else: return (no interception).
      - Tileset asset: look up `rev` for the URL; cache key = `${url}?rev=${rev}` (or the bare URL if
        the map has no entry yet — fall back to network-then-cache). Cache-first on that key; on miss,
        fetch the real URL, cache the response under the key, and delete any other cache entries whose
        key starts with `${url}?rev=` (prune stale revs). If offline and uncached, fail as normal.
      - Catalog: network-first; on network failure, serve the cached copy; cache the fresh copy on
        success (so offline has a catalog to reason from).
    - A named cache (e.g. `editor-assets-v1`); clean up other cache names on `activate`.
  - Kill switch: if the controlled page requests with `?nosw` present (or a `postMessage('unregister')`),
    the SW unregisters/bypasses — document it.
  - `[inline]` because the cache-invalidation + scoping logic needs judgement and careful testing.
  - Side effects: none until registered (Step 3). `public/sw.js` ships as a static file under
    `public/` — confirm it isn't caught by `vite.config.ts` `server.watch.ignored` concerns (it's a
    normal public asset; editing it triggers a dev reload, which is fine).
  - Done when: SW file exists and lints; manual reasoning trace confirms only `/assets/tilesets/**`
    - catalog are intercepted and a changed `rev` is a cache miss.

- [ ] **Step 3: Register the SW from the editor entry only** `[delegate sonnet]`
  - `src/editor/main.tsx`: after mount, if `'serviceWorker' in navigator` and `?nosw` is absent,
    `navigator.serviceWorker.register('/sw.js')`. Put this **only** in the editor bootstrap — never in
    the game's `index.html`/game entry. If `?nosw` is present, unregister any existing registration
    instead.
  - Side effects: the SW registers at root scope, so on a shared-origin local dev server it also
    "controls" the game page — but its fetch handler ignores everything except editor tileset assets,
    so the game is functionally unaffected. On guppi only the editor is served, so this is moot there.
    Document the `?nosw` escape hatch for debugging a stuck SW.
  - Docs: `docs/MOBILE-EDITOR-ACCESS.md` — note the editor now caches assets via a service worker
    (offline-capable, `?nosw` to bypass).
  - Done when: loading the editor registers the SW; a second load serves tiles from the SW (DevTools →
    Network shows "(ServiceWorker)"); the game page's local dev load is unaffected.

- [ ] **Step 4: Verify offline + precise invalidation** `[inline]`
  - Drive `npm run editor`. In DevTools (Application → Service Workers, Network): confirm (a) tiles
    served from SW on reload, (b) editor still renders tiles with the network offline, (c) the ~1.13 MB
    catalog no longer blocks each load once cached (network-first but instant offline fallback), and
    (d) changing one PNG's bytes + regenerating the catalog re-fetches **only** that asset (its `rev`
    changed) while everything else stays cached.
  - `npm run build` + `npm run lint` green (the SW is a `public/` file, not in the build graph — confirm
    the prod game build is unaffected).
  - Docs: finalise the `docs/MOBILE-EDITOR-ACCESS.md` note; `docs/STATUS.md` one-liner under the editor
    subsystem.
  - Done when: all four offline/invalidation behaviours confirmed, build+lint green, docs updated.

## Out of scope

- Any service worker / caching for the **game** page (separate origin, hashed prod build, different
  problem) — this is editor-only.
- Eager bulk "make available offline" precaching of the whole ~23 MB tree (possible future add-on).
- Hashing asset **filenames** or introducing an editor build step — the SW + `rev` deliberately avoid
  needing a build.
- Switching guppi off the live `vite dev` model — the SW is designed to coexist with the dev server.

## Critique

> Fresh-eyes review (independent sub-agent, uncontaminated by the planning conversation).

**Verdict:** Careful, well-researched plan — but it rests on a factually wrong "game is unaffected"
safety claim, and a far simpler `rev`-query + `Cache-Control: max-age` approach delivers most of the
value with none of the service-worker risk. **Do not start as written.**

|#|Finding|Lens|Severity|Suggested action|
|---|---------|------|----------|------------------|
|1|Core safety claim is FALSE: the game loads its art from the same `/assets/tilesets/**` prefix the SW intercepts (`PreloadScene.ts` L66), so a root-scoped SW does NOT leave the game "functionally unaffected" — on shared-origin local dev it serves the game's tiles cache-first from the editor cache|Cross-cutting|High|Re-examine root-scope safety; scope the SW or match an editor-only marker, not a prefix both pages use|
|2|Simpler alternative never weighed: append `rev` as a query param in `tilesetAssetUrl` + have the existing `/__editor` dev middleware send `Cache-Control: immutable, max-age=1y` for `/assets/tilesets/**`. Browser HTTP cache then does download-once-per-`rev` with no SW, no brick risk, no root-scope|Alternatives|High|Prototype the middleware+query approach first; only build a SW if true offline is a firm requirement|
|3|Payoff vs forever-maintenance is thin: single-user, Tailnet-only (already-online) dev tool; measured pain is mild (assets already 304 with no byte re-download; 23 MB re-download only on rare rebuild). Roadmap is game features|Roadmap / Right-sizing|High|Decide whether to build at all before executing; likely defer or down-scope to finding 2|
|4|Catalog cache-buster defeats offline fallback: `catalogSource.ts` fetches `asset-catalog.json?t=${Date.now()}` (unique URL/load), so the SW's cached copy never matches offline unless it normalizes the key|Gaps|Medium|Strip/ignore the query in the SW cache key; add an acceptance check|
|5|Benefit inflation: network-first catalog means the ~1.13 MB download still happens every online load (normal guppi case); Step 4 acceptance (c) is false online|Right-sizing|Medium|Correct Summary/acceptance — the catalog win is offline-only, not a per-load saving|
|6|URL-derivation bug (Step 2): `/assets/tilesets/<pack>/<source.path>` only holds for `object` assets — `tile` assets carry `source.sheet`, so the rev-map omits every tile sheet (largest class)|Executability|Medium|Iterate assets reading `source.sheet ?? source.path`|
|7|"True offline" oversold: lazy caching + precache out of scope means a fresh browser going offline has an essentially empty editor — only already-viewed tiles survive|Gaps|Medium|Reframe as "offline for already-loaded tiles"; note precache is required for real offline|
|8|A throwing fetch handler could still fail asset loads even though `?nosw` recovery is otherwise adequate (SW caches no HTML/modules)|Gaps|Low|Wrap `respondWith` in try/catch → fall through to network; document `?nosw` prominently|

**Detail (High findings):**

1. `src/scenes/PreloadScene.ts` L66 builds game asset URLs as `${BASE_URL}assets/tilesets/${manifest.id}/…`
   — identical in dev to the SW intercept prefix. Decision #5 and the Step 3 side-effects both assert
   the game is "functionally unaffected"; that is wrong and load-bearing. Resolve before registering any SW.
2. The editor already runs a dev middleware (`scripts/vite-editor-api.mjs`, `/__editor/*`). A tiny
   `configureServer` handler setting `Cache-Control: public, max-age=31536000, immutable` on
   `/assets/tilesets/**`, plus threading `rev` into the URL (`?rev=<hash>`) in `tilesetAssetUrl`, gives
   the browser HTTP cache the exact "download once, re-fetch only on `rev` change" semantics — no SW
   lifecycle, no root-scope, no brick risk, no permanent maintenance. Forgoes only true offline (which
   finding 7 shows the plan barely delivers on a cold cache). Prototype + measure this first.
3. README "Next" is game content (night-waves, equipment); the editor is dev-only, single-user,
   Tailnet-only (online by definition). Measured pain is small. A SW is a permanent artifact maintained
   forever — decide "defer" or "do the finding-2 lightweight version" before execution.

**Primary focus:** resolve findings 1 and 2 first — the root-scope safety claim is factually wrong,
and the `rev`-query + `max-age` middleware likely obviates the whole service worker. **Settle the
approach before writing any `sw.js`.**
