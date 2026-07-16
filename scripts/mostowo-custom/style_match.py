#!/usr/bin/env python3
"""Snap a generated (AI / off-palette) sprite onto a stock pack's look.

Retro-Diffusion / PixelLab output is the right *shape* but the wrong *palette*: richer,
brighter, more painterly tones than Anokolisa's tight, muted, flat-banded wood art, with a
heavy near-black outline. This runs a small fixed pipeline over an image so it reads as part
of the pack:

    1. flatten   - median-cut the source to `--bands` colours (kills painterly ramps → flat bands)
    2. snap      - remap every band to the nearest colour in a palette auto-extracted from the
                   pack's own wood/foliage sprites (perceptual "redmean" distance), so the output
                   uses ONLY colours that already exist in-game
    3. outline   - recolour the dark silhouette edge from black → the pack's darkest wood tone
                   (the pack outlines in dark brown, not black); skip with --no-outline
    4. grimy     - OPTIONAL global desaturate + darken toward the "dark & grotty" art direction
                   (off by default; enable with --grimy)

The palette is extracted, not hand-authored, so it tracks the pack. Warm browns + natural
foliage greens are kept (so moss on a log survives, snapped to a pack green); grey coal and
teal gems in the same source sheets are filtered out.

Usage:
    # in place (overwrites the inputs)
    python3 scripts/mostowo-custom/style_match.py <img> [<img> ...]
    # to a directory (leaves inputs untouched)
    python3 scripts/mostowo-custom/style_match.py <img> ... --out-dir /tmp/preview
    python3 scripts/mostowo-custom/style_match.py <img> --bands 8 --grimy --no-outline

See docs/ASSETS.md ("Style-matching generated art") for when to reach for this.
"""
from __future__ import annotations

import argparse
import os
from collections import Counter

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Pack sprites the wood/foliage palette is read from. Wood-bearing sheets only — enough hue
# range (golden planks → red logs → dark trunk) plus canopy/moss green.
DEFAULT_SOURCES = [
    "public/assets/tilesets/pixel-crawler/Environment/Props/Static/Resources.png",
    "public/assets/tilesets/pixel-crawler/_derived/tree_pine.png",
    "public/assets/tilesets/pixel-crawler/Weapons/Wood/Wood.png",
]


def _luma(c) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def _is_wood_or_foliage(r: int, g: int, b: int) -> bool:
    """Keep warm browns and natural (warm) greens; drop greys (coal) and teals (gems)."""
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn < 12:  # near-grey: coal, shadow noise
        return False
    warm = r >= b and g <= r  # reddish-brown wood
    foliage = g >= r and g > b and b < g * 0.85  # leafy green (teal has b≈g → excluded)
    return warm or foliage


def extract_palette(sources, bins: int = 12, keep: int = 32):
    """Build a tight pack palette: collect qualifying colours, quantise to `bins` steps to merge
    near-identical tones, keep the `keep` most common."""
    cnt: Counter = Counter()
    for rel in sources:
        path = rel if os.path.isabs(rel) else os.path.join(REPO, rel)
        try:
            im = Image.open(path).convert("RGBA")
        except FileNotFoundError:
            print(f"  ! palette source missing, skipped: {rel}")
            continue
        for r, g, b, a in im.getdata():
            if a >= 128 and _is_wood_or_foliage(r, g, b):
                q = (round(r / bins) * bins, round(g / bins) * bins, round(b / bins) * bins)
                cnt[q] += 1
    palette = [c for c, _ in cnt.most_common(keep)]
    if not palette:
        raise SystemExit("no palette colours extracted — check --sources")
    return palette


def _redmean(a, b) -> float:
    """Perceptual-ish RGB distance (fast, no colour-space deps)."""
    rb = (a[0] + b[0]) / 2
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return (2 + rb / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rb) / 256) * db * db


def _nearest(c, palette):
    return min(palette, key=lambda p: _redmean(c, p))


def flatten(im: Image.Image, bands: int) -> Image.Image:
    """Median-cut the RGB to `bands` colours → flat shading regions. Alpha is preserved
    separately (transparent pixels claim one extra palette slot we ignore)."""
    q = im.convert("RGB").quantize(colors=bands + 1, method=Image.MEDIANCUT)
    return q.convert("RGB")


def style_match(im: Image.Image, palette, bands: int, outline: bool, grimy: bool) -> Image.Image:
    src = im.convert("RGBA")
    flat = flatten(src, bands)
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    sp, fp, op = src.load(), flat.load(), out.load()
    cache: dict = {}
    for y in range(src.height):
        for x in range(src.width):
            if sp[x, y][3] < 128:
                continue
            band = fp[x, y]
            if band not in cache:
                cache[band] = _nearest(band, palette)
            op[x, y] = (*cache[band], 255)

    if outline:
        dark = min(palette, key=_luma)  # pack's darkest wood tone = outline colour
        edges = []
        for y in range(out.height):
            for x in range(out.width):
                if op[x, y][3] < 128:
                    continue
                touches_void = any(
                    not (0 <= x + dx < out.width and 0 <= y + dy < out.height)
                    or op[x + dx, y + dy][3] < 128
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                )
                # Only recolour edges that are ALREADY dark (an outline) — never darken a lit rim.
                if touches_void and _luma(op[x, y]) < 90:
                    edges.append((x, y))
        for x, y in edges:
            op[x, y] = (*dark, 255)

    if grimy:
        for y in range(out.height):
            for x in range(out.width):
                r, g, b, a = op[x, y]
                if a < 128:
                    continue
                grey = _luma((r, g, b))
                r = int((r * 0.82 + grey * 0.18) * 0.9)  # desaturate 18%, darken 10%
                g = int((g * 0.82 + grey * 0.18) * 0.9)
                b = int((b * 0.82 + grey * 0.18) * 0.9)
                op[x, y] = (r, g, b, 255)

    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", nargs="+", help="image file(s) to style-match")
    ap.add_argument("--out-dir", help="write here instead of overwriting inputs")
    ap.add_argument("--bands", type=int, default=10, help="flatten to N shading bands (default 10)")
    ap.add_argument("--no-outline", action="store_true", help="skip the black→pack-brown outline pass")
    ap.add_argument("--grimy", action="store_true", help="extra global desaturate+darken pass")
    ap.add_argument("--sources", nargs="*", default=DEFAULT_SOURCES, help="pack sprites to read the palette from")
    args = ap.parse_args()

    palette = extract_palette(args.sources)
    print(f"palette: {len(palette)} pack tones | bands={args.bands} outline={not args.no_outline} grimy={args.grimy}")
    if args.out_dir:
        os.makedirs(args.out_dir, exist_ok=True)
    for path in args.images:
        im = Image.open(path).convert("RGBA")
        res = style_match(im, palette, args.bands, not args.no_outline, args.grimy)
        dst = os.path.join(args.out_dir, os.path.basename(path)) if args.out_dir else path
        res.save(dst)
        print(f"  {os.path.basename(path)} -> {dst}")


if __name__ == "__main__":
    main()
