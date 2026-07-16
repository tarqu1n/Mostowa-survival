# Per-region roles on mixed tile/object sheets

> Status: in review

## Summary
Some stock Anokolisa sheets are **mixed**: a single PNG classed `tile` holds both true 16px terrain
(grass, cobble, magic floors) *and* large multi-cell props (fountains, statues, trees, planters, a
wooden bench) — e.g. `garden-environment/Assets/Tiles.png` (512×480). Whole-sheet classification
can't express "this rect is terrain-grid, that one is a placeable object", so today the props are
chopped into unusable 16px fragments and clutter the tile picker.

This feature lets a sheet **stay classed `tile`** while also declaring `object`-role **regions**, so
those props become placeable decor. The tile picker **hides** any 16px cell an object region
overlaps, decluttering it. MVP is **object-role regions only** — no `tile`-role regions, no
map-format change. Deliverable includes authoring the regions on the garden sheet as the first proof
(the bench et al. become placeable).

## Context & decisions

**Chosen approach (option B, advised).** Per-region roles on the one sheet, *not* physically
splitting the PNG. Splitting fights the repo's **load-in-place rule** (a re-downloaded pack won't
reproduce split files; they'd have to live under `_derived/`, duplicating pixels + a second texture
load, with no generator to catch drift). Region-roles reuse the existing plan-014/017 region
machinery and change no map format.

**The invariant that collapses the complexity:** a `tile` sheet is already 16px grid-sliced, so a
tile frame index is *always* a whole-sheet index — object regions never re-index the tile grid. So
"regions on a tile sheet" is purely a **catalog + editor UI** concern. Record this invariant in
DECISIONS.md so a future session doesn't re-litigate it.

**The render path already works (verified).** A decor region loads its PNG as a *whole image* under
`tileImageKey(path)` (`img-…`) and `texture.add(frameName,0,x,y,w,h)` crops it there
(`src/render/decorSprites.ts` `resolveDecorDraw`), entirely independent of the `sheetKey(path)`
(`sheet-…`) spritesheet a tile sheet loads under. The same PNG simply coexists under both keys. So
**PreloadScene / EditorScene / map format need no change** — a decor placed off a tile-classed
sheet's region serialises identically (`asset` = bare `<pack>/<path>` id + `{x,y,w,h}` region rect).

**User decisions:** (1) deliver capability **and** author the garden proof; (2) picker **hides**
occluded cells (no dim/badge); (3) the Regions editor must be **reachable on a tile asset without
demoting its type to `object`**.

**Key files & line anchors** (from research — fact-check against live code before editing):
- `src/editor/catalog.ts` — `CatalogRegion` (L28) `{key,x,y,w,h}`; `CatalogAsset.regions?` (L76);
  `CatalogAssetType` (L21).
- `scripts/pixel-crawler/gen_regions.py` — `is_object_sheet` (L103); hand-authored `regions[relPath]`
  copy loop (L169-181); sidecar shape `{schemaVersion:1, sheets:{relPath:{params,regions:[…]}}}`.
- `scripts/asset-catalog.mjs` — `buildAsset`/`type` (L233/248); tile `frames` (L264-272);
  `mergeRegions` `objectAssets` filter (L345) + `>=2` attach (L373-377); `assertValidCatalog`
  non-`object` regions gate (L450-452).
- `scripts/vite-editor-api.mjs` — `PUT /__editor/asset-regions` (L472-522); `sanitiseRegions`
  strips non-`x/y/w/h` keys (L186-204); `runAssetGenerators` reruns both generators (L298).
- `src/editor/api.ts` — `RegionRect` (L225); `putAssetRegions` (L264).
- `src/editor/tabs/ObjectEditorTab.tsx` — `ObjectEditorForm` type-conditional body (L120);
  `RegionsEditor` (L463); per-selected-box control panel (L937-993); `save()` forces `type:'object'`
  (L786-788) then `putAssetRegions` (L789). `seedRegions` in `regions.ts` (L52); `Box` (L17).
- `src/editor/panels/LibraryPanel.tsx` — render switch (L466-509); `TileFrameGrid` (L524, frame loop
  L567, early-return tile branch L467); `AtlasSheetPicker` (L868) + `onArmRegion`/`armRegion` (L283).
- `src/systems/mapFormat.ts` — `DecorObject`/`DecorRegion` (L152/L122): **no change** (verified);
  `placeDecor` (`editorStore.ts` L2616) is type-agnostic.

**Regen contract (unchanged):** any region/pack.json change reruns `gen_regions.py` then
`npm run assets:catalog`, in that order. Catalog is deterministic/committed — never hand-edit.

**Project direction:** the Map Builder is the authoring path that lets stock packs be used in-game
without code changes (CLAUDE.md architecture map; ASSETS.md "usable in-game now, via map
authoring"). This feature widens that path to mixed sheets, which the paid Anokolisa packs commonly
are — so it directly serves the "buy more packs in the same style" strategy already committed to.

## Steps

- [x] **Step 1: Thread `role` through the build pipeline (schema + both generators)** `[inline]`
  - Outcome: `src/editor/catalog.ts` — added `role?: 'object'` to `CatalogRegion` + doc, updated
    `CatalogAsset.regions` doc (tile sheets may carry object-role regions; `>=2`/default-role rules
    don't apply on tile). `scripts/pixel-crawler/gen_regions.py` — process set is now `object_sheets
    ∪ authored_non_object` (tile sheets with hand-authored regions get a verbatim sidecar entry, no
    detection). `scripts/asset-catalog.mjs` — `mergeRegions` map widened to object+tile, `role`
    spread added to projection, tile keeps a single region (`>=1`), object still `>=2`; validator
    permits `regions` on tile (rejects strip), keeps `>=2` for object, rejects unsupported roles.
    **Deviation from plan text:** gen_regions passes `role` through ONLY when authored (NOT defaulted
    to `'object'`) — defaulting would rewrite `role` into every existing object sidecar (12 packs
    carry hand-authored regions) and break byte-stability; absent-⇒-object now lives in the consumers.
    Verified byte-neutral (old-vs-new-generator regen output `diff -rq` IDENTICAL); done-check passed
    (injected garden `Tiles.png` region → `type:tile`+`frames:900`+`regions:[{…,role:object}]`;
    reverted → byte-identical); `tsc --noEmit` clean.
    **⚠ Pre-existing drift flagged:** committed `regions.json` (all packs) + `asset-catalog.json` use
    the OLD top-left-only region `key` format; the current generators emit full-rect keys. Any full
    regen (e.g. Step 5) rewrites ALL sidecars — Step 5's commit will need care not to sweep the
    unrelated key-format churn in. `asset-catalog.json` was already `M` at session start (Matt's
    deterministic regen); left as-is.
  - `src/editor/catalog.ts`: add optional `role?: 'object'` to `CatalogRegion` (L28) — a union of one
    member now, deliberately extensible to `'tile'` later. Update the `regions?` doc comment (L72-76)
    to note tile assets may now carry regions (all `role:'object'` in this MVP).
  - `scripts/pixel-crawler/gen_regions.py`: in the hand-authored `regions[relPath]` copy loop
    (L169-181) copy a `role` field through into each sidecar region dict alongside `x/y/w/h` (default
    it to `'object'` when absent). Ensure a sheet that resolves to `type: tile` but carries an
    authored `regions[relPath]` entry **still gets a sidecar entry emitted** — today only
    `is_object_sheet` sheets do; add the authored-tile case (do **not** run detection on tile sheets,
    only pass authored regions through).
  - `scripts/asset-catalog.mjs`: (a) `mergeRegions` — widen the `objectAssets` filter (L345) so a
    `tile` asset that has a sidecar entry also receives its regions; (b) **add `role` to the
    `mergeRegions` region projection** (L373-377) — it currently `.map(r => ({key,x,y,w,h}))`, a
    field whitelist that silently drops `role`, so include `...(r.role ? {role:r.role} : {})`;
    (c) attach object-role regions on a **tile** asset regardless of count (the `>=2` rule exists so a
    lone object sheet stays a plain single object — that rationale doesn't apply when the sheet's
    primary content is tiles, so a tile sheet keeps even a single object region); (d) relax **both**
    `assertValidCatalog` gates: the type gate (`regions` on a non-`object` asset, ~L450) *and* the
    length gate (`a.regions.length < 2` throw, ~L452-454) — permit `regions` on a `tile` asset and
    allow a `tile` asset to carry fewer than 2 (still reject on `strip`, still reject `<2` on a pure
    `object` asset). A tile asset then carries **both** `frames:N` and `regions:[{…,role:'object'}]`.
    (Fact-check the exact line numbers — the `<2` throw and the projection whitelist are the two spots
    most likely to silently drop the feature if missed.)
  - Side effects: the catalog is committed and consumed by both editor and game; a mistake here
    silently drops the dual-classification. Confirm byte-stability: with no pack.json change, both
    generators must reproduce the existing catalog exactly (`git diff` empty).
  - Docs: none in this step (all docs in Step 6).
  - Done when: hand-adding a `regions["Assets/Tiles.png"]` entry with a `role:'object'` box to
    `garden-environment/pack.json`, then running `python3 scripts/pixel-crawler/gen_regions.py &&
    npm run assets:catalog`, produces a garden `Tiles.png` catalog asset that keeps `type:'tile'` +
    `frames:N` **and** gains `regions:[{…,role:'object'}]`; catalog is byte-identical when the entry
    is removed again.

- [x] **Step 2: Persist `role` through the editor save endpoint + client type** `[delegate sonnet]`
  - Outcome: `src/editor/api.ts` — `RegionRect` gains `role?: 'object'` (+ doc). `scripts/vite-editor-api.mjs`
    — `sanitiseRegions` destructures `role`, rejects the whole body if `role` is any value other than
    `undefined`/`'object'`, and spreads `role` into the output rect ONLY when truthy (missing role ⇒ no
    key, byte-identical to today). Handler unchanged (sanitised rect flows straight into
    `pack.regions[relPath]`). Verified: 5 unit assertions pass (role passes through; absent ⇒ key
    literally absent; `'tile'`/`'bogus'`/out-of-bounds/non-integer all → `null`); `tsc --noEmit` clean.
    Only the two files touched; no data files or dev server.
  - `src/editor/api.ts`: add optional `role?: 'object'` to `RegionRect` (L225).
  - `scripts/vite-editor-api.mjs`: `sanitiseRegions` (L186-204) currently reads only `x/y/w/h` and
    drops stray keys — pass a validated `role` through (accept only `'object'` for now; omit the field
    when absent rather than writing a default, so pure-object sheets' `pack.json` stays unchanged).
    The handler then writes it into `pack.regions[relPath]` (L518) and reruns both generators as today.
  - Side effects: `/__editor/asset-regions` is dev-only middleware; whole-list-replaces
    `pack.json`'s `regions[relPath]`. Verify an existing object sheet's regions round-trip unchanged
    (no spurious `role` written).
  - Docs: none (Step 6).
  - Done when: a `PUT /__editor/asset-regions` body whose regions carry `role:'object'` writes that
    `role` into `pack.json` `regions[relPath]`, and the follow-on regen lands it in the catalog
    (Step 1 path); a body with no `role` writes exactly what it does today.

- [x] **Step 3: Region-editor UI — role toggle + reachable on a `tile` asset without demoting type** `[inline]`
  - Outcome: `src/editor/regions.ts` — `seedRegions`, `sliceBox`, `sanitiseClientRegions` now preserve
    a region's `role` (only `'object'` accepted; propagated to sliced cells; round-trips on reopen).
    `src/editor/tabs/ObjectEditorTab.tsx` — `RegionsEditor` gains an `objectRoleRegions` prop; its
    `save()` is now conditional: when set, it tags every region `role:'object'` and SKIPS the
    `type:'object'` demotion; default (unset) keeps the classic reclassify (force `type:'object'`,
    bare rects). `ObjectEditorForm` gains `regionMode` state + an "Edit regions" toggle shown only for
    `tile` drafts; a tile asset in `regionMode` renders `<RegionsEditor … objectRoleRegions>` (stays
    tile). Per-selected-box panel shows a read-only "Role: object" badge in object-role mode (field
    exists + persists; extensible to a Select for `tile`-role later). Entry affordance chosen: a
    per-tile toggle beside the Type dropdown (not a dropdown option — keeps type unchanged).
    Verified: `tsc --noEmit` clean, `regions.test.ts` 17/17 pass, eslint clean on both files. The
    conditional preserves the reclassify path (strip/tile→object via dropdown still forces the type).
    Interactive done-check (draw box → Save → pack.json stays `tile` + gains `role:'object'` region)
    deferred to Step 5's live authoring/browser verification.
  - `src/editor/tabs/ObjectEditorTab.tsx` + `src/editor/tabs/regions.ts`: add optional `role` to `Box`
    (`regions.ts` L17) and thread it through `seedRegions` (L52) so existing regions load their role
    (default `'object'`). Add a **role control** to the per-selected-box panel (L937-993, beside the
    x/y/w/h + Slice controls) — MVP has one role (`object`), so a read-only badge or a
    single-option/disabled control is acceptable; the point is the field exists and persists (keep it
    trivially extensible to `tile`).
  - Make the **Regions editor reachable on a tile asset**: today `ObjectEditorForm` only shows
    `<RegionsEditor>` when the draft type is `object` (L120/L253), and `save()` force-writes
    `type:'object'` (L786-788). Change so a `tile` asset can open the Regions editor and **save while
    staying `tile`** — i.e. the forced `type:'object'` override becomes conditional: keep it for a
    genuine object reclassify, but when the asset is `tile` and the user is only adding object-role
    regions, do **not** demote it (write regions with roles, leave `type` as `tile`). Decide the
    cleanest entry affordance during implementation (e.g. a "Regions" mode/toggle available on a tile
    asset's ⚙ tab); document whatever you choose in Step 6.
  - Side effects: `save()` currently couples "has regions" with "is object" — decoupling it is the
    crux. Make sure a real object-sheet reclassify (tile/strip → object) still forces the type as
    before; only the tile-keeps-tiling path skips the demotion. `putAssetRegions` (L789) is the same
    call for both.
  - Docs: none (Step 6).
  - Done when: opening `garden-environment/Assets/Tiles.png`'s ⚙ tab, drawing a box, marking it
    object-role, and saving leaves the asset `type:'tile'` in `pack.json` while adding a
    `regions["Assets/Tiles.png"]` entry carrying `role:'object'`; a normal object reclassify is
    unaffected.

- [x] **Step 4: Library panel — surface object-role regions as placeables + hide occluded tile frames** `[inline]`
  - Outcome: `src/editor/panels/LibraryPanel.tsx` — added `isObjectRegion(r)` helper (role `'object'` or
    absent ⇒ object; forward-safe against a future `'tile'` role). The tile branch now filters the
    asset's object-role regions: **no regions** → returns `TileFrameGrid` verbatim (plain tile sheets
    unchanged); **has regions** → renders `TileFrameGrid` (occlusion-filtered) stacked above a reused
    `AtlasSheetPicker` for the props, in a `flex-col gap-2` wrapper keyed on `asset.id`. `AtlasSheetPicker`
    gained an optional `heading` prop (mixed tile sheet passes `Objects on <file>` so the hotspot view
    reads apart from the grid's filename label) and now filters its hotspots through `isObjectRegion`
    (no-op for existing object atlases whose regions lack `role`). Occlusion lives in `TileFrameGrid`
    via `isOccluded(col,row)` — **cell-centre-inside-region** test (`col*TILE_SIZE+TILE_SIZE/2`,
    `row*…`) so a region bleeding 1px into a neighbour can't delete a legitimate terrain cell; the
    frame loop `return null`s occluded cells (grid reflows to declutter). No new fractional-grid guard:
    `cols` is already floored by `catalogTileCols`, so col/row stay integer for a non-16-multiple sheet.
    The filter is a no-op when `regions` is empty/absent (early-out in `isOccluded`), so a plain tile
    sheet renders exactly as before. Verified: `tsc --noEmit` clean, `eslint` clean on the file. The
    interactive done-check (garden props placeable + picker decluttered) needs the regions authored, so
    it runs in Step 5's live browser pass — same deferral as Step 3.
  - `src/editor/panels/LibraryPanel.tsx`: the tile branch (L467) currently returns `TileFrameGrid`
    exclusively. For a tile asset that also has `role:'object'` regions, **both** must render: the
    tile frame grid (occlusion-filtered) **and** the object regions as armable placeables (reuse
    `AtlasSheetPicker`'s hotspot + `onArmRegion`/`armRegion` path (L283/L1112), or overlay region
    hotspots on the grid — pick the lower-friction option).
  - **Occlusion filter:** in the `TileFrameGrid` frame loop (L567), drop a frame only when its 16px
    cell is **substantially covered** by a `role:'object'` region — **not** any-pixel overlap. A
    box drawn 1px into an adjacent terrain cell must not silently delete that legitimate tile from the
    picker. Use the **cell-centre-inside-region** test: hide the cell iff its centre
    (`col*TILE_SIZE + TILE_SIZE/2, row*TILE_SIZE + TILE_SIZE/2`) falls within some object region's
    rect. (Equivalently, snap each region to the 16px grid before intersecting — pick whichever is
    cleaner in the component; centre-inside is the simpler one-liner.) Only object-role regions
    occlude; ignore regions without that role.
  - Edge case (advisor caution): guard the `col`/`row` math for a sheet whose width isn't a multiple
    of 16 — reuse the generator's existing non-dividing-grid warning path rather than adding a second
    check; don't crash the picker on a fractional grid.
  - Side effects: `TileFrameGrid` is shared by all tile assets — a tile asset with **no** object
    regions must render exactly as today (filter is a no-op when `regions` is empty/absent). The
    armed-region placement flow already exists and is type-agnostic (Step research confirmed).
  - Docs: none (Step 6).
  - Done when: with the garden regions authored, `garden-environment/Assets/Tiles.png` in the Library
    shows the fountains/statues/trees/bench as armable placeables **and** the tile picker no longer
    lists the cells beneath them; a plain tile sheet (e.g. `castle-environment/Assets/Tiles.png`)
    looks unchanged.

- [~] **Step 5: Author the garden proof + verify end-to-end** `[inline]` — authoring + verify DONE; commit deferred (entanglement, see Outcome).
  - Outcome: Authored **13 object-role regions** on `garden-environment/Assets/Tiles.png` by measuring
    props off the 480×480 PNG (sheet is 480×480, NOT 512×480 as the summary said) rather than
    browser-drawing — user opted for coord authoring. Regions: tiered fountain, round basin, octagon
    pond, hexagon pool, rect pool, 4 statues, 2 trees, wooden bench, vases/urns. (Dropped an initial
    14th "stone-rim pond" — it was a water-ring-with-hole that overlapped lily pads + rocks and didn't
    isolate cleanly; the 5 other water features cover "fountains/ponds".) `pack.json`
    `overrides:{}` (sheet stays `tile` by rule — no override), `regions["Assets/Tiles.png"]` = 13 bare
    `{x,y,w,h,role:'object'}` rects (byte-shape identical to an editor Save). Ran `gen_regions.py` +
    `assets:catalog`; **all three in sync**: pack (13) · regions.json (13, all `role:object`) ·
    catalog (`type:tile` + `frames:900` + 13 regions). **Regen churn handled per Step 1's warning** —
    `gen_regions.py` rewrites ALL packs' `regions.json` with the new full-rect `key` format (unrelated
    pre-existing drift); reverted every non-garden `regions.json` via `git checkout` so only garden's
    changed.
  - **Verified end-to-end (screenshots):** built the prod bundle (`npm run build` clean, tsc clean),
    temporarily injected 5 garden props (bench/tree/statue/pond/vases) near `SPAWN_TILE` into
    `test.map.json`, booted the preview headless via Playwright, clicked into the Game scene → **all
    props render at correct crop/scale, ZERO console/page errors** (bench under the player, tree,
    octagon pond, statue w/ spout, urns). Confirms decor off a `tile`-classed sheet's region renders
    identically to an object sheet's — `decorSprites.resolveDecorDraw` has no catalog/type coupling
    (module doc + code re-verified). Restored `test.map.json` to the user's version afterward (the
    injection was verification-only, not committed). Plan-28 region tests pass (`regions.test.ts`
    17/17); 6 unrelated failures pre-exist in the user's concurrent node-sprite work
    (editorStoreNodeDefs / editorStoreObjects / mapRuntime) — not touched by this feature.
  - **Concurrency note:** mid-session the user opened the editor and wrote a competing `pack.json`
    (`type:object` override + 3 experimental rects via the CLASSIC demote path, not the new "Edit
    regions" toggle). User chose to **restore the 13-region tile-classed authoring**; done. The editor
    is NOT buggy — the classic Type-dropdown/reclassify path correctly demotes; the tile-preserving
    path is the "Edit regions" toggle (`objectRoleRegions`).
  - **Commit — partially staged (surgical), 2 files handed to user.** User chose "stage plan-28
    surgically." STAGED the cleanly-separable set: 7 pure plan-28 code files (catalog.ts, api.ts,
    gen_regions.py, asset-catalog.mjs, vite-editor-api.mjs, regions.ts, ObjectEditorTab.tsx), 3 docs,
    garden pack.json + regions.json, and this plan file. NOT staged (need the user's interactive git —
    `git add -p` isn't available in this env): **`LibraryPanel.tsx`** (file-level entangled: 44
    plan-027 compact-swatch markers + 22 plan-028 occlusion/placeable markers) and
    **`asset-catalog.json`** (garden regions + the user's uncommitted `log_pile` props + pre-existing
    all-pack region-`key`-format regen churn). Note: the regen contract wants pack/regions/catalog
    committed together, so the user must `git add -p` the garden hunk of asset-catalog.json (and
    LibraryPanel's plan-28 hunks) to complete the commit. Steps 1–4 code was ALSO uncommitted at start
    — it's the same working-tree body; those 7 files are now staged.
  - In the Map Builder (`npm run editor`), open `garden-environment/Assets/Tiles.png` and draw
    object-role regions around each baked prop: the fountains/ponds, the statues (right column), the
    trees, the planters/pots, and the **wooden bench** (bottom-left). Save (writes `pack.json` +
    reruns both generators server-side).
  - Commit the resulting `garden-environment/pack.json`, `regions.json`, and
    `public/assets/asset-catalog.json` changes together (they must stay in sync).
  - Verify: (a) each prop is placeable from the Library and the tile picker is decluttered (Step 4
    done-check); (b) place the bench into `test.map.json`, boot the game, and confirm it renders at
    the right crop/scale (use the `verify` skill / `npm run smoke`). Follow the repo's surgical-commit
    hygiene — don't sweep unrelated working-tree changes into the commit.
  - Side effects: regions are pixel-authored against the *current* sheet; note the content-drift
    caveat (re-run `gen_regions.py` if the PNG ever changes). Placed decor is a catalog snapshot.
  - Docs: none (Step 6).
  - Done when: the garden bench + props are placeable, the catalog is committed and in sync, the
    picker is decluttered, and a placed bench renders correctly in-game.

- [x] **Step 6: Docs** `[delegate sonnet]`
  - Outcome: Delegated to a sonnet subagent. `docs/DECISIONS.md` — new `2026-07-16 [DECIDED]` entry:
    option B (per-region roles) over physically splitting the sheet, with load-in-place /
    reproducibility / mobile-single-texture reasoning + the invariant (tile frame index is always
    whole-sheet; a `tile` sheet may carry object-role regions, MVP object-only). `docs/ASSETS.md` —
    extended "Atlas sprite regions" (optional `role`, no detection on tile sheets, cell-centre
    occlusion, MVP scope) + "In-editor region editing" (two reachability paths: classic Type-dropdown
    reclassify vs the new tile "Edit regions" toggle, no demotion, read-only role badge).
    `docs/EDITOR.md` — new "Regions on tile assets (plan 028)" section (reachable on tile, no demotion,
    role control, pointer to ASSETS.md). Grep-checked all three: no stale "regions are object-only"
    claim remains. No code/data/catalog touched.
  - `docs/DECISIONS.md`: log the decision — **option B (per-region roles) over physically splitting a
    mixed sheet**, with the load-in-place / reproducibility / mobile single-texture reasoning; and
    record the **invariant**: a tile frame index is always a whole-sheet index, and a `tile` sheet may
    carry `object`-role regions (MVP: object-role only; `tile`-role deferred).
  - `docs/ASSETS.md`: extend the "Atlas sprite regions" / "In-editor region editing" sections — a
    region now carries an optional `role` (`object`), a `tile`-classed sheet may declare object-role
    regions so baked props are placeable while terrain keeps tiling, and object regions hide the tile
    cells they cover in the picker. Note it's authored via the ⚙ Regions editor now reachable on tile
    assets.
  - `docs/EDITOR.md`: note the Regions editor is reachable on a tile asset (no type demotion) and the
    per-region role control.
  - Keep edits terse/high-signal (token-optimised), matching each doc's existing style.
  - Done when: DECISIONS/ASSETS/EDITOR reflect the feature and the invariant; no stale claim that
    regions are object-only.

## Out of scope
- **`tile`-role regions** (carving a sub-grid of terrain out of a mixed sheet as its own tile set) —
  the schema is left extensible (`role` union) but only `object` is implemented now.
- **Any map-format change** — verified unnecessary; placed decor already references `<pack>/<path>` +
  `{x,y,w,h}` verbatim, classification-agnostic.
- **Preload / EditorScene texture-loading changes** — the `img-…` whole-image region-crop path
  already handles regions off a tile sheet.
- **Pixel-based auto-detection of object regions on a tile sheet** — authoring is manual in the
  editor (detection isn't run on tile sheets); same posture as existing hand-authored region
  overrides.
- **Dim/badge for occluded cells** — user chose hard hide.
- Re-authoring regions on the other paid packs' mixed sheets — garden is the proof; the rest are a
  later per-sheet authoring pass using the same capability.

## Critique

**Verdict:** Sound, well-grounded plan that fits the roadmap and correctly verifies its load-bearing
claims (decorSprites region-crop and no map-format change both hold) — proceed. Findings #1 and #2
folded into Steps 1 and 4 (2026-07-16); #3 to resolve live during Step 3.

|#|Finding|Lens|Severity|Suggested action|
|-|-------|----|--------|----------------|
|1|Step 1 missed two catalog-side edits: `assertValidCatalog`'s `a.regions.length < 2` throw, and `mergeRegions`' `.map(r => ({key,x,y,w,h}))` projection which whitelists fields and drops `role`. As written the single-box done-check fails the `<2` assertion and `role` never reaches the catalog.|Executability|Medium|**Folded into Step 1(b)/(d):** add `role` to the projection; relax the `<2` gate for `tile` assets.|
|2|Occlusion used "any bbox overlap hides the cell" — a region drawn 1px into an adjacent 16px cell silently deletes a legitimate terrain tile from the picker.|Alternative / risk|Medium|**Folded into Step 4:** hide a cell only when substantially covered (cell-centre-inside-region test), not any-overlap.|
|3|Step 3's tile-asset entry affordance + the conditional `type:'object'`-force branch (skip demotion only on the tile-keeps-tiling path) left "decide during implementation".|Scope|Low|Nail the entry point + conditional-force branch early in Step 3; keep the reclassify regression check explicit.|

Verified holding (no action): `resolveDecorDraw` crops regions via `tileImageKey`/`texture.add`
independent of the tile `sheet-` key, and `DecorObject.region` is a bare `{x,y,w,h}` with no
classification coupling — so no preload / EditorScene / map-format change is needed. `role`
union-of-one + additive optional schema are minimal and reversible. Dev-only middleware — no
security/PII surface.
