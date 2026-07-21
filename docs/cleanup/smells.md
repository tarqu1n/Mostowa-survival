# Code Smells — Cleanup Lens

Severity-ranked concrete smells found in `src/`. Tag `[fix]` = clear/mechanical;
`[log]` = contentious, needs a decision before touching.

## High

|Severity|Smell|file:line|Tag|Note|
|---|---|---|---|---|
|High|`wireBus` twin on/off mirror: every subscription hand-repeated in an `off` block|`src/scenes/GameScene.ts:773-843`|[fix]|~26 pairs; drift risk. Table-drive one list, wire+SHUTDOWN-off from it.|
|High|Toggle/queue quartet: `isXQueued`/`toggleX` for harvest/refuel/deconstruct/rearm are near-identical, keyed only by kind+id field|`src/scenes/GameScene.ts:1244-1326`|[fix]|8 methods collapse to one predicate-driven pair.|
|High|Duplicated pan/zoom viewport: wheel-anchor + `pendingAnchor` re-anchor + pointer-pan logic copied between two components|`src/editor/panels/LibraryPanel.tsx:1367-1643` vs `src/editor/tabs/ObjectEditorTab.tsx:505-864`|[log]|Cross-file extraction into a shared `useZoomPanViewport` hook; refactor scope is a judgment call.|
|High|`editorStore.ts` god object (3662 lines): state + all actions + pure key helpers all in one module|`src/editor/store/editorStore.ts:1-3662`|[log]|Split by domain slice; large, contentious restructure.|

## Medium

|Severity|Smell|file:line|Tag|Note|
|---|---|---|---|---|
|Medium|Twinned zoom consts + clamp: identical `1/8/0.5` + round-clamp under two names|`src/editor/panels/LibraryPanel.tsx:1358-1364` and `src/editor/tabs/ObjectEditorTab.tsx:438-444`|[fix]|Hoist to one shared const set + `clampZoom`.|
|Medium|Stray NUL byte (`\x00`) used as composite-key separator|`src/editor/store/editorStore.ts:971` (byte 61841)|[fix]|Invisible char; replace with a visible delimiter (e.g. `\|`).|
|Medium|`EditorScene.ts` god object (2367 lines)|`src/editor/EditorScene.ts:1-2367`|[log]|Manager-extract further; large refactor.|
|Medium|`GameScene.ts` god object (1965 lines) despite manager extraction|`src/scenes/GameScene.ts:1-1965`|[log]|Task-queue + input-dispatch could move out.|
|Medium|`LibraryPanel.tsx` god component (1766 lines, multiple sub-pickers)|`src/editor/panels/LibraryPanel.tsx:1-1766`|[log]|Split `AtlasSheetPicker`/`AnimatedStripPicker`/`AssetReclassify` out.|
|Medium|`ObjectEditorTab.tsx` god component (1129 lines)|`src/editor/tabs/ObjectEditorTab.tsx:1-1129`|[log]|`RegionsEditor` is a file's worth on its own.|

## Low

|Severity|Smell|file:line|Tag|Note|
|---|---|---|---|---|
|Low|Parked two-finger gesture behind `TWO_FINGER_GESTURE_ENABLED=false`; stranded gesture branch stays compiled|`src/editor/EditorScene.ts:72` (guard), `1766-1772` (dead branch)|[log]|Known parked item — do not remove.|
|Low|Parked portals: `PortalObject`s parsed-and-held, no transition consumer|`src/scenes/GameScene.ts:264-266`, `416-418`, `300`|[log]|Known parked item (plan 019).|
|Low|`assetSwatch.tsx` mixes module consts + pure helpers + leaf component|`src/editor/panels/assetSwatch.tsx:1-213`|[log]|Cohesive today; splitting consts/helpers/component is a style call.|
|Low|Alpha-decode effect is an inline image-processing concern in a giant component|`src/editor/tabs/ObjectEditorTab.tsx:553-568`|[log]|NOT duplicated (single occurrence in editor) — seed's "duplicated" framing was wrong. Extraction candidate only.|
