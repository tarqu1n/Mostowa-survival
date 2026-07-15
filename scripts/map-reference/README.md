# Map-reference capture

Dev-only tracing aid: renders a top-down **OpenStreetMap** slice of a real location at an **exact
metres-per-pixel**, so the PNG drops onto the Map Builder grid 1:1 for hand-tracing the shape mask /
terrain (see [../../docs/EDITOR.md](../../docs/EDITOR.md)).

**License note:** this uses OSM raster tiles (ODbL) via MapLibre GL and only reads a *coordinate*
from you — never Google Maps imagery (their ToS forbids automated access / derivation). Keep it that
way.

## Run

```sh
node scripts/map-reference/capture.mjs
```

Outputs to `out/` — **committed** to the repo (so a reference travels to whatever device authors a
map, incl. a phone while camping) and served to the editor by the dev-only `/__editor` middleware.
Still **never in the prod bundle**: the editor + `/__editor` are serve-only (see
[../../docs/EDITOR.md](../../docs/EDITOR.md)).

- `<name>-reference.png` — the tracing image (`gridW*pxPerTile` × `gridH*pxPerTile`).
- `<name>-reference.json` — sidecar (center, zoom, m/tile, px/tile, bbox) the editor underlay reads
  to auto-align.

**In-editor capture** — Alternatively, the **Reference panel** (Reference → **"Capture new"**) captures in-editor: enter name, paste `lat,lon`, set radius (m), click **Capture**. POSTs to dev-server middleware; generates same `<name>-reference.{png,json}` files server-side. Grid size: `gridW=gridH=ceil(2·radius/metresPerTile)` (default 3 m/tile). Phone-usable. The CLI remains for scripted/batch use.

## Config

Edit the `CONFIG` block in [capture.mjs](capture.mjs), or override per-run via env:

|env|meaning|default|
|---|---|---|
|`MAPREF_NAME`|output basename|`mostowo`|
|`MAPREF_LAT` / `MAPREF_LON`|slice center (= spawn/base)|Mostowo camp|
|`MAPREF_GRID_W` / `MAPREF_GRID_H`|grid size in tiles|128 × 160|
|`MAPREF_M_PER_TILE`|real metres per tile|3|
|`MAPREF_PX_PER_TILE`|reference px per tile|16|

The zoom is derived so `1 screenshot px == metresPerTile / pxPerTile` metres. OSM raster tops out at
z19; above that MapLibre overzooms.
