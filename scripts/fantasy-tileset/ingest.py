#!/usr/bin/env python3
"""Ingest 'The Fan-tasy Tileset (Free Trial)' by Valerio Colonna into its own pack.

A different creator from the CraftPix packs, so it gets its own top-level pack
`fantasy-tileset` (16px medieval-village tileset: ground/road/water/rock-slope
terrain, buildings, props, rocks, trees/bushes, a directional main character).

Conventions match the rest of the repo:
- No-shadow: the pack ships a separate `Shadows/` folder of shadow decals, so the
  sprites themselves are shadowless — we skip `Shadows/` entirely.
- Prefer the individually-named PNGs over the packed `Atlas/` copies (skip the
  atlas where individuals exist; Trees/Bushes ships only an atlas, so use it).
- The directional main-character sheets are SLICED into per-direction strips
  (reusing scripts/craftpix/slice.py), same as the CraftPix actors.
- Tiled project files, whole-set `Tileset_Layout*` previews, and the atlas dupes
  are left out. The two PDFs travel with the pack as the licence/provenance record.

LICENCE: free trial; exact redistribution/commercial terms are NOT stated in the
included docs — confirm on the source page before any public release.
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "craftpix"))
from slice import slice_directional  # noqa: E402

STAGE = ("/private/tmp/claude-502/-Users-matthew-langley-Work-mostowo-survival/"
         "5a901376-08be-4a80-a4a8-acbfad5056af/scratchpad/craftpix-stage")
SRC = os.path.join(STAGE, "fantasy-tileset", "The Fan-tasy Tileset (Free)")
ART = os.path.join(SRC, "Art")
REPO = "/Users/matthew.langley/Work/mostowo-survival"
DEST = os.path.join(REPO, "public/assets/tilesets/fantasy-tileset")

# Row-index -> facing for the main character (4x4 @ 40x48). Provisional — verify
# L/R when the character is actually wired.
FAN_DIRS = ["down", "left", "right", "up"]


def copy_glob(src_dir, dest_rel):
    """Copy top-level *.png from src_dir (non-recursive: skips Atlas/, Animation/)."""
    dest = os.path.join(DEST, dest_rel)
    os.makedirs(dest, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(src_dir)):
        if f.lower().endswith(".png"):
            shutil.copy2(os.path.join(src_dir, f), os.path.join(dest, f))
            n += 1
    return n


if os.path.isdir(DEST):
    shutil.rmtree(DEST)

counts = {}
# --- terrain (tile) ---
counts["Ground"] = copy_glob(os.path.join(ART, "Ground Tileset"), "Tiles")
counts["Water"] = copy_glob(os.path.join(ART, "Water and Sand"), "Tiles")
counts["RockSlopes"] = copy_glob(os.path.join(ART, "Rock Slopes"), "Tiles")
# --- objects (individual PNGs; atlases skipped) ---
counts["Buildings"] = copy_glob(os.path.join(ART, "Buildings"), "Buildings")
counts["BuildingFx"] = copy_glob(os.path.join(ART, "Buildings/Animations"), "Buildings/Fx")
counts["Props"] = copy_glob(os.path.join(ART, "Props"), "Props")
counts["PropFx"] = copy_glob(os.path.join(ART, "Props/Animation"), "Props/Fx")
counts["Rocks"] = copy_glob(os.path.join(ART, "Rocks"), "Rocks")
# Trees/Bushes ship only as a packed atlas -> region-detected object.
os.makedirs(os.path.join(DEST, "TreesBushes"), exist_ok=True)
shutil.copy2(os.path.join(ART, "Trees and Bushes/Atlas/Trees_Bushes.png"),
             os.path.join(DEST, "TreesBushes/Trees_Bushes.png"))
counts["TreesBushes"] = 1

# --- main character: slice each directional sheet (40x48 cells, non-square) ---
overrides = {}
char_src = os.path.join(ART, "Characters/Main Character")
src_keep = os.path.join(DEST, "Characters/_src")
os.makedirs(src_keep, exist_ok=True)
n_char = 0
for f in sorted(os.listdir(char_src)):
    if not f.lower().endswith(".png"):
        continue
    shutil.copy2(os.path.join(char_src, f), os.path.join(src_keep, f))
    base = os.path.splitext(f)[0]
    out_dir = os.path.join(DEST, "Characters")
    for name, cols, non_square in slice_directional(
            os.path.join(char_src, f), out_dir, base, 40, 48, FAN_DIRS):
        if non_square:  # 40x48 cells: catalog can't infer frames from height
            overrides[os.path.join("Characters", name)] = {"frames": cols}
    n_char += 1
counts["CharacterSheets"] = n_char

# --- pack.json + licence docs ---
pack = {
    "id": "fantasy-tileset",
    "name": "The Fan-tasy Tileset (Free Trial)",
    "author": "Valerio Colonna",
    "sourceUrl": "",
    "licence": ("Free trial of 'The Fan-tasy Tileset' by Valerio Colonna "
                "(valeriocolona_art). Free-trial usage terms — see included PDFs; "
                "CONFIRM exact redistribution/commercial terms on the source page "
                "before any public release."),
    "tileSize": 16,
    "rules": {
        "tile": ["Tiles/**"],
        "strip": ["**/Fx/**", "**/Characters/**", "**/*-Sheet.png"],
    },
    "overrides": overrides,
    "exclude": ["**/_src/**"],
}
with open(os.path.join(DEST, "pack.json"), "w") as fh:
    json.dump(pack, fh, indent=2)
    fh.write("\n")
for pdf in ["The Fan-tasy Tileset Documentation.pdf", "Free Trial Guide.pdf"]:
    p = os.path.join(SRC, pdf)
    if os.path.exists(p):
        shutil.copy2(p, os.path.join(DEST, pdf))

print("fantasy-tileset:", counts, "overrides:", len(overrides))
print("DONE")
