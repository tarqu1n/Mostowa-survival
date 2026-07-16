# Node Depth Y-Sorting

> Status: planned — run /execute-plan to begin.

## Summary
Resource-node objects (trees/rocks/bushes) currently render at a single flat depth in
both the Map Builder editor and the game runtime, so Phaser breaks ties by display-list
insertion order — the **last-placed** node draws on top regardless of where its base sits
on the map. This feature makes a node's draw order a function of its **base row** (lower on
the map ⇒ drawn in front) as the default, with an optional per-node `depthBias` for manual
override of same-row overlaps. A single shared sort-law function keeps the editor and game
in agreement. Scope is **nodes only** — decor keeps its own depth band; player/monster
y-sorting stays a separate open item.

## Context & decisions

**Root cause (verified):**
- Editor: every node → `img.setDepth(DEPTH_OBJECTS)` (constant 1000) — [EditorScene.ts:749](src/editor/EditorScene.ts#L749). Decor → `DEPTH_OBJECTS + obj.depth` ([EditorScene.ts:704](src/editor/EditorScene.ts#L704)).
- Game: every node → `.setDepth(1)` (constant) — [ResourceNodeManager.ts:110](src/scenes/world/ResourceNodeManager.ts#L110). Game decor → `DEPTH_OBJECTS(=1) + obj.depth` ([DecorManager.ts:101](src/scenes/world/DecorManager.ts#L101)). Monsters=9, player=10, all flat.
- `pickObjectAt` reads the **live sprite depth** and tie-breaks "higher depth, then later array index" ([EditorScene.ts:787-788](src/editor/EditorScene.ts#L787-L788)) — so once nodes carry distinct fractional depths, click-picking selects the visually front-most node for free.

**Design (advisor-vetted, agreed with user):**
- **Default law:** node depth = band base + `nodeDepthOffset(row, bias)`, a **fraction in `[0, 1)`** so nodes stay strictly inside their existing depth band and never disturb decor/monster/player layering.
- **Encoding:** `nodeDepthOffset(row, bias = 0) = clamp(row + bias, 0, DIVISOR - 1) / DIVISOR`. `MAX_MAP_DIM = 512` ([mapFormat.ts:781](src/systems/mapFormat.ts#L781)) is the row ceiling, so `DIVISOR = 4096` leaves huge headroom for bias while keeping the offset < 1; the clamp is a defensive guarantee.
- **Manual override:** new optional `depthBias?: number` (integer, "virtual rows") on `NodeObject`. A bias *relative to* the y-sort survives node moves better than an absolute depth. Omitted-when-zero → legacy maps round-trip byte-identical (mirrors how `skin`/`rotation` are handled).
- **UI (user's choice):** enable the existing Bring forward / Send back buttons for node selections (nudge `depthBias ±1`) **and** add a numeric "Depth bias" field to the node Inspector — mirroring decor's controls.
- **Bands stay separate:** decor and nodes are NOT interleaved by y-sort. One behaviour change to eyeball: decor authored at `depth: 0` previously tied with nodes; nodes now draw fractionally above it. Spot-check dense maps, don't engineer around it.

**Single source of truth:** `nodeDepthOffset` + `DIVISOR` live in [src/systems/mapFormat.ts](src/systems/mapFormat.ts) (colocated with `NodeObject`, already imported by both editor and game). Each renderer supplies its own band base (`DEPTH_OBJECTS` in editor, `1` in game).

**Patterns to mirror:**
- Optional node field parse/serialize: existing `skin`/`rotation` handling in the node branch of `parseMap` ([mapFormat.ts:542-561](src/systems/mapFormat.ts#L542-L561)) and its serializer.
- Round-trip / optional-field tests: [mapFormat.test.ts](src/systems/__tests__/mapFormat.test.ts) (round-trip at L156, node fixture at L105).
- Runtime depth test: [DecorManager.test.ts](src/scenes/world/__tests__/DecorManager.test.ts) (no `ResourceNodeManager.test.ts` exists yet).
- Inspector numeric field: decor's `Depth` NumberField ([InspectorPanel.tsx:272](src/editor/panels/InspectorPanel.tsx#L272)); node fields in `NodeFields` ([InspectorPanel.tsx:298](src/editor/panels/InspectorPanel.tsx#L298)).
- Store batch depth action: `bumpDepth` ([editorStore.ts:706-708](src/editor/store/editorStore.ts#L706)) — currently skips node/portal ids.
- Node move re-render: `translateObjects`/`updateNode` → `applyCommand` → `docRevision` → `onDocEdited` → **full** `placeObjects` rebuild ([EditorScene.ts:652](src/editor/EditorScene.ts#L652)), so depth recomputes on every move with no incremental wiring needed.

**Project direction (from CLAUDE.md):** data-driven content, pure/testable systems, editor stays WYSIWYG for the game. The shared sort law + optional data field fit the "content as data + pure systems" grain; the editor must match the runtime, which is why the game change is mandatory, not optional.

## Steps

- [ ] **Step 1: Schema field + shared sort law + tests** `[inline]`
  - In [src/systems/mapFormat.ts](src/systems/mapFormat.ts):
    - Add `depthBias?: number` to the `NodeObject` interface (~L102) as the **last** field, with a comment: integer "virtual rows" nudge layered on the base-row y-sort; omitted ⇒ 0.
    - In the node branch of `parseMap` ([L542-561](src/systems/mapFormat.ts#L542)): parse `depthBias` as an optional integer, mirroring how `skin`/`rotation` are read (present-and-valid ⇒ include; absent ⇒ omit the key entirely). Reject non-integer / non-finite with the same error style used nearby.
    - In the node serializer: emit `depthBias` **only when defined** (byte-identical round-trip for legacy maps), matching the `skin`/`rotation` omit-when-absent pattern.
    - Export `const NODE_DEPTH_DIVISOR = 4096` and `export function nodeDepthOffset(row: number, bias = 0): number` returning `Math.min(Math.max(row + bias, 0), NODE_DEPTH_DIVISOR - 1) / NODE_DEPTH_DIVISOR`. Document that the result is always in `[0, 1)` so callers can add it to any integer band base.
  - Tests in [src/systems/**tests**/mapFormat.test.ts](src/systems/__tests__/mapFormat.test.ts): (a) `nodeDepthOffset` is strictly monotonic in `row`; (b) a positive `bias` breaks a same-row tie (higher bias ⇒ larger offset); (c) offset `< 1` at `row = MAX_MAP_DIM - 1` with a large bias; (d) offset clamped to `≥ 0` for negative `row+bias`; (e) a node **without** `depthBias` round-trips byte-identical; (f) a node **with** `depthBias` round-trips preserving the value.
  - Side effects: `NodeObject` is imported widely (GameScene, ResourceNodeManager, editor). Adding an *optional* field is non-breaking; run `npx tsc --noEmit` to confirm no consumer breaks. Do NOT touch decor's `depth`.
  - Docs: none in this step (Step 6 covers docs).
  - Done when: type-checks, all mapFormat tests pass, `depthBias` round-trips both present and absent.

- [ ] **Step 2: Game runtime node y-sort** `[delegate sonnet]` (parallel: A)
  - In [src/scenes/world/ResourceNodeManager.ts](src/scenes/world/ResourceNodeManager.ts):
    - Import `nodeDepthOffset` from `../../systems/mapFormat` (match existing import path/style).
    - Extend `addNode` signature (L101) with a trailing `depthBias = 0` param.
    - In `loadNodes` (L80-92) read `obj.depthBias` and pass it to `addNode`.
    - Change `.setDepth(1)` (L110) to `.setDepth(1 + nodeDepthOffset(row, depthBias))`.
  - Side effects: depleted/regrow re-texture and the chop scale-tween do NOT touch depth (verified), so persistence is automatic. Confirm nothing else in GameScene occupies the `(1, 2)` depth range besides decor (decor sits at `1 + depth`; node offsets stay `< 1` so nodes never reach decor's `depth: 1`). No change to `sprite.x/y` (stays tile centre) so `treeAt`/pathfinding are unaffected.
  - Docs: none (Step 6).
  - Done when: type-checks; add a focused test mirroring [DecorManager.test.ts](src/scenes/world/__tests__/DecorManager.test.ts) asserting two nodes on different rows get row-ordered depths and a `depthBias` shifts one — create `src/scenes/world/__tests__/ResourceNodeManager.test.ts` if a lightweight scene stub is feasible; if the manager can't be unit-tested without heavy Phaser scaffolding, note that and rely on the Step 1 `nodeDepthOffset` tests instead.

- [ ] **Step 3: Editor render node y-sort** `[delegate sonnet]` (parallel: A)
  - In [src/editor/EditorScene.ts](src/editor/EditorScene.ts) `placeNodeSprite` (L715-752): import `nodeDepthOffset` from the systems module (match existing imports) and change L749 `img.setDepth(DEPTH_OBJECTS)` to `img.setDepth(DEPTH_OBJECTS + nodeDepthOffset(obj.row, obj.depthBias ?? 0))`.
  - Verify (read-only, no code change expected): moving a node triggers the full `placeObjects` rebuild so depth recomputes automatically; `pickObjectAt` (L778-788) reads live depth and will now select the front-most overlapping node with no change. If either assumption is wrong, note it — do not silently work around.
  - The armed-placement preview / marker fallbacks (L722, L731, L740, addMarker L749-770) can stay on the flat `DEPTH_OBJECTS` band — only the resolved node image needs the offset. Leave marker depth as-is.
  - Side effects: none beyond node draw order. Do not alter decor's depth line (L704).
  - Docs: none (Step 6).
  - Done when: type-checks; in a manual editor run, two overlapping trees draw with the lower-row one in front, independent of placement order.

- [ ] **Step 4: Store — extend depth adjust to nodes** `[delegate sonnet]` (parallel: A)
  - In [src/editor/store/editorStore.ts](src/editor/store/editorStore.ts) `bumpDepth` (L706-708 declaration + its implementation): currently it adjusts `depth` on decor ids and skips node/portal ids. Change so **node** ids get `depthBias` adjusted by `delta` (treat absent `depthBias` as 0, write back the integer result); decor behaviour unchanged; **portal** ids still skipped. Keep it a single undoable command covering the mixed selection.
  - Update the JSDoc on `bumpDepth` (and any interface comment) to state it now adjusts decor `depth` and node `depthBias`; portals skipped.
  - Side effects: `updateNode` already exists and accepts partial node fields, so the Inspector numeric field (Step 5) needs no new store action — confirm `updateNode`'s typing accepts `depthBias`.
  - Docs: none (Step 6).
  - Done when: type-checks; add/extend a test in [editorStoreObjects.test.ts](src/editor/store/__tests__/editorStoreObjects.test.ts) asserting `bumpDepth([nodeId], 1)` increments the node's `depthBias`, a mixed decor+node selection adjusts both, portals are untouched, and the change is undoable.

- [ ] **Step 5: Inspector — enable buttons for nodes + Depth-bias field** `[delegate sonnet]`
  - In [src/editor/panels/InspectorPanel.tsx](src/editor/panels/InspectorPanel.tsx):
    - Add `const hasNode = selected.some((o) => o.kind === 'node');` alongside `hasDecor` (~L79).
    - Change ONLY the **Bring forward** and **Send back** buttons' `disabled` from `!hasDecor` to `!(hasDecor || hasNode)` ([L132-144](src/editor/panels/InspectorPanel.tsx#L132)). Leave Rotate/Flip gated on `!hasDecor` (nodes have no flip; free rotation stays a decor batch op — nodes keep their single-node Rotation field). Update the batch-panel doc comment (L20-23) to note depth now applies to nodes too.
    - In `NodeFields` ([L298](src/editor/panels/InspectorPanel.tsx#L298)): add a `Depth bias` NumberField after Rotation, mirroring decor's `Depth` field (L272), wired via the existing `update({ depthBias })`. Show the current value (default 0 when absent).
  - Side effects: the buttons call `bumpDepth` which after Step 4 handles nodes — depends on Step 4 landing first. No new store wiring.
  - Docs: none (Step 6).
  - Done when: type-checks; with a node selected the depth buttons are enabled and the Inspector shows an editable Depth bias; editing it or clicking the buttons re-orders the node live.

- [ ] **Step 6: Docs + shortcuts panel** `[delegate haiku]`
  - [docs/DECISIONS.md](docs/DECISIONS.md): add a terse entry — nodes now y-sort by base row via a shared `nodeDepthOffset` (fractional, in-band); optional `depthBias` for manual same-row ordering; decor keeps its own band (not interleaved); **open item:** player/monster y-sort still flat (player always over trees).
  - [src/editor/shortcuts.ts](src/editor/shortcuts.ts) + [src/editor/ShortcutsDialog.tsx](src/editor/ShortcutsDialog.tsx): the depth/bring-forward affordance was decor-only (see the depth batch entry ~L144); update its wording to note it now applies to nodes too. Keep the in-app Shortcuts panel in sync (per the shortcuts-sync convention). No new keybinding unless one is added in Step 5 (none planned).
  - [docs/EDITOR.md](docs/EDITOR.md): one line in the map/object format section noting the optional `depthBias` node field and that node draw order defaults to base-row y-sort.
  - Side effects: none (docs only).
  - Done when: docs reflect the new behaviour; Shortcuts panel wording matches actual button gating.

## Out of scope
- **Player/monster/decor y-sorting.** Only resource nodes are y-sorted; entities and decor keep their current flat/banded depths. Logged as an open item in DECISIONS.md.
- **Interleaving nodes and decor** into one y-sorted band (would re-shuffle authored maps; separate opt-in decision).
- **Multi-tile node footprints** — nodes remain single-tile `(col,row)`; "base row" is that tile's row.
- **Absolute per-node depth override** — manual control is a relative `depthBias` only, deliberately (survives moves).
- **Migrating existing map files** — none needed; `depthBias` is optional and absent-means-zero.
