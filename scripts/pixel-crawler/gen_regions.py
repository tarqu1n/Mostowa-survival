#!/usr/bin/env python3
"""Generate the atlas sprite-region sidecar `regions.json` for every `object`-classified sheet in
the Pixel Crawler pack (plan 014 step 7a). Reuses `components()` from `objects.py` UNTOUCHED —
this script only drives it and shapes the output.

Classification is read straight from `pack.json`'s `rules` — the SAME source
`scripts/asset-catalog.mjs` uses to classify `tile`/`strip`/`object` — rather than re-derived here,
so the two can never silently drift apart when a rule changes (plan 014 step 7a critique #4).
Everything NOT matched by `rules.tile`/`rules.strip` (after `exclude`) is an `object` sheet and gets
a detection pass, including already-single-sprite `_derived/*.png` extracts — uniform treatment,
no special-casing; those simply end up with one region and stay a plain object downstream in
`asset-catalog.mjs` (an asset needs >=2 regions to be treated as an atlas).

Region `key = "${x}_${y}"` — the box's top-left corner, NOT its detection order/index. Detection
order can shift run-to-run (tie-breaking on ambiguous pixels), but a sprite's pixel position only
changes when someone actually edits the sheet — so coordinate-derived keys stay stable across
regens, which is what lets a map author's `DecorObject.region` reference survive a re-run.

Per-sheet escape hatches live in `pack.json` (read here, applied per-relpath):
  - `regionParams`: `{ "<relPath>": { alphaThresh, gap, minArea } }` — tunes `components()`'s
    tolerance for one sheet (e.g. a larger `gap` to bridge two sprites' anti-aliased edges that
    almost-but-don't touch, or a larger `minArea` to drop stray shadow/particle flecks).
  - `regions`: `{ "<relPath>": [ { x, y, w, h }, ... ] }` — a hand-authored region list, used
    VERBATIM instead of running detection, for sheets where no amount of gap/area tuning fixes it
    (touching sprites that merge into one box, or one sprite whose parts are disjoint and split
    into several boxes).

Contributor regen (always both, in this order): `python3 scripts/pixel-crawler/gen_regions.py &&
npm run assets:catalog`.

Deterministic: sheets and regions are both sorted (sheet paths lexically, regions by (y, x)) —
no timestamps, no RNG — so an unchanged pack dir regenerates a byte-identical `regions.json`.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from compose import PC  # noqa: E402  (path-relative import, see sys.path.insert above)
from objects import components  # noqa: E402

# Mirrors `components()`'s own defaults (scripts/pixel-crawler/objects.py) so an un-overridden sheet
# in `regions.json` records exactly the params it was actually detected with.
DEFAULT_PARAMS = {"alphaThresh": 8, "gap": 1, "minArea": 40}

OUTPUT_PATH = os.path.join(PC, "regions.json")


# ---- Glob matcher mirroring scripts/asset-catalog.mjs's globToRegExp byte-for-byte (`*` = within
# one path segment, `**` = across segments) — classification here must never drift from the
# catalog's own (critique #4). ----
def glob_to_regex(glob):
    out = []
    i = 0
    while i < len(glob):
        c = glob[i]
        if c == "*" and i + 1 < len(glob) and glob[i + 1] == "*":
            i += 1  # consume the second '*'
            if i + 1 < len(glob) and glob[i + 1] == "/":
                out.append("(?:.*/)?")
                i += 1  # consume the following '/' too — '**/' may match zero directories
            else:
                out.append(".*")
        elif c == "*":
            out.append("[^/]*")
        elif c in ".+^${}()|[]\\":
            out.append("\\" + c)
        else:
            out.append(c)
        i += 1
    return re.compile("^" + "".join(out) + "$")


def matches_any(patterns, rel):
    return any(glob_to_regex(p).match(rel) for p in patterns)


def list_pngs(root):
    out = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith(".png"):
                rel = os.path.relpath(os.path.join(dirpath, fn), root)
                out.append(rel.replace(os.sep, "/"))
    return out


def load_pack():
    with open(os.path.join(PC, "pack.json"), encoding="utf-8") as f:
        return json.load(f)


def boxes_to_regions(boxes):
    """`components()` boxes are `(x0, y0, x1, y1)` with `x1`/`y1` EXCLUSIVE — convert to the sidecar's
    `{key, x, y, w, h}` shape and sort by (y, x) so output order never depends on detection order."""
    regions = [
        {"key": f"{x0}_{y0}", "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
        for (x0, y0, x1, y1) in boxes
    ]
    regions.sort(key=lambda r: (r["y"], r["x"]))
    return regions


def main():
    pack = load_pack()
    rules = pack["rules"]
    exclude = pack.get("exclude", [])
    region_param_overrides = pack.get("regionParams", {})
    region_overrides = pack.get("regions", {})

    all_pngs = list_pngs(PC)
    kept = [rel for rel in all_pngs if not matches_any(exclude, rel)]
    object_sheets = sorted(
        rel
        for rel in kept
        if not matches_any(rules.get("tile", []), rel)
        and not matches_any(rules.get("strip", []), rel)
    )

    sheets = {}
    warnings = []
    for rel in object_sheets:
        if rel in region_overrides:
            # Hand-authored — used verbatim, no detection pass. `params` records the detection
            # params it WOULD have used, for reference only (irrelevant once hand-authored).
            params = {**DEFAULT_PARAMS, **region_param_overrides.get(rel, {})}
            regions = sorted(
                (
                    {"key": f"{r['x']}_{r['y']}", "x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"]}
                    for r in region_overrides[rel]
                ),
                key=lambda r: (r["y"], r["x"]),
            )
            sheets[rel] = {"params": params, "regions": regions}
            continue

        params = {**DEFAULT_PARAMS, **region_param_overrides.get(rel, {})}
        boxes = components(
            rel,
            alpha_thresh=params["alphaThresh"],
            gap=params["gap"],
            min_area=params["minArea"],
        )
        regions = boxes_to_regions(boxes)
        if not regions:
            warnings.append(f"{rel}: detection found 0 regions (fully transparent or below minArea)")
        sheets[rel] = {"params": params, "regions": regions}

    out = {"schemaVersion": 1, "sheets": {rel: sheets[rel] for rel in sorted(sheets)}}
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    for w in warnings:
        print(f"[gen_regions] warn: {w}")
    print(
        f"[gen_regions] wrote {os.path.relpath(OUTPUT_PATH)}: "
        f"{len(sheets)} sheets ({len(warnings)} warnings)"
    )


if __name__ == "__main__":
    main()
