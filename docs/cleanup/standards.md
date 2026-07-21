# Competing-standards / consistency findings

Inconsistencies in `src/` vs STANDARDS.md / CONVENTIONS.md. Tags: [fix] = clear+mechanical,
[log] = contentious / needs a decision.

|Area|Inconsistency|file:line|Convention violated|Tag|Note|
|---|---|---|---|---|---|
|Cost location|`spike_trap` cost lives in config as `SPIKE_TRAP_COST`, imported into the data table; `wall`/`campfire` costs are inline|`src/config.ts:545`, `src/data/buildables.ts:5,57` (inline peers `:16,:34`)|CONVENTIONS "adding content = editing src/data/" vs STANDARDS/config "tunables live in config.ts"|[log]|Two docs genuinely conflict on whether a cost is content or a tunable. Only `spike_trap` is split; recommend inlining `{wood:5}` into buildables to match the dominant data-driven rule, leaving `SPIKE_TRAP_DAMAGE`/`_TRIGGER_MS` in config|
|Data-record readonly|Data-def interfaces have all-mutable fields (`ItemDef`, `BaseStats`, `ResourceNodeDef`, `BuildableDef`, `EnemyDef`)|`src/data/types.ts:7,20,80,115,149`|STANDARDS "Prefer readonly fields on data records (ItemDef, NodeDef, etc.)"|[log]|"Prefer" is soft; adding `readonly` is mostly mechanical + low-risk (defs are const) but is a repo-wide posture call. Includes `cost: Record<string,number>` (`types.ts:118`, `config.ts:545`) — a shared mutable map; prefer `Readonly<Record<...>>`|
|Event namespaces|Doc's namespace enumeration omits live namespaces `demolish`, `npc`, `supply`; lists `hunger` but code uses `needs:*`|`docs/STANDARDS.md:73-74` vs `src/scenes/GameScene.ts:764,767,803-806`, `:798`|STANDARDS event-namespace list (self-consistency)|[fix]|Event *names* themselves all follow `namespace:action` lowerCamelCase — only the doc's list is stale. Mechanical doc update|
|Editor UI naming|`src/editor/ui/` mixes lowercase component files (`button.tsx`, `input.tsx`, `dialog.tsx`, `tooltip.tsx`) with PascalCase peers (`RotationWheel.tsx`, `SkinThumb.tsx`, `PanelBarButton.tsx`, `QuickLayerSelect.tsx`)|`src/editor/ui/*.tsx`|STANDARDS "UI kit components PascalCase; class/component-exporting modules PascalCase"|[log]|Accepted by origin: lowercase files are copied shadcn/ui primitives ("own the code", STANDARDS:26-29); PascalCase are hand-authored. Split is intentional, record only|
|State paradigm|Game uses `game.events` + `registry`; editor uses Zustand (`create` + `subscribeWithSelector`)|`src/scenes/GameScene.ts:774-806` vs `src/editor/store/editorStore.ts:34`|CONVENTIONS scene-comms pattern (bus+registry)|[log]|ACCEPTED split — game runtime vs dev-only editor are separate apps; editorStore is the single React↔Phaser bridge. No action, documented as accepted|
|TS `any`|~23 untyped `any` hits, mostly test-harness plumbing (`no-explicit-any` set to `warn`, not `error`)|`eslint.config.js:30,38`|STANDARDS "no `any` without a why-comment"|[log]|Already tracked via `TODO(lint)`; STANDARDS:44-46 explicitly acknowledges it. No untyped `any` found in non-test game source. Leave as-is until the lint-tightening pass|

## Conventions `src/` already follows well (skip in Phase 4)

- NO default exports anywhere in `src/` — zero hits.
- Cross-scene event names all conform to `namespace:action` lowerCamelCase (only the doc list drifted, not the emitters).
- Registry keys all flat lowerCamelCase (`dayPhase`, `dayCount`, `hunger`, `inventory`, `playerStats`, `following`, `zoom`, `startMap`).
- No manager↔manager import coupling in `src/scenes/{world,fx,input,build}` — scene mediates, as specified.
- No untyped `any` in non-test game source; the known 23 are test-harness only and already lint-tracked.
