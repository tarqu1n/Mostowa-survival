#!/usr/bin/env python3
"""Generate the game's item icons with Gemini ("Nano Banana", gemini-2.5-flash-image)
and post-process each to a committed 32x32 transparent PNG.

Pipeline per item:  compose prompt (prompts.py)  ->  POST to the Gemini image endpoint
->  save raw ~1024px PNG to scripts/.gen-icons/raw/<id>.png (gitignored scratch)
->  key out the flat background to alpha  ->  square-crop to content  ->  downscale to
32x32  ->  optional palette quantise  ->  write public/assets/icons/<id>.png.

The game already ships green on plan 008's placeholder icons, so this is decoupled from
gameplay — run it whenever GEMINI_API_KEY is reachable (see README.md for the LAN/
Tailscale route). --dry-run needs no key and spends nothing.

Model / endpoint / auth are locked (docs/ASSET-EXPERIMENTS.md "Gemini asset generation"):
  gemini-2.5-flash-image, POST .../v1beta/models/gemini-2.5-flash-image:generateContent,
  header x-goog-api-key: $GEMINI_API_KEY.
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import prompts  # noqa: E402  (local sibling module)

ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash-image:generateContent"
)

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "scripts" / ".gen-icons" / "raw"   # gitignored scratch
ICON_DIR = REPO_ROOT / "public" / "assets" / "icons"     # committed output

ICON_SIZE = 32
# Resampling filter for the (large -> 32px) downscale. lanczos/box area-average the
# source so the icon reads cleanly; nearest is a hard subsample (jagged, drops most
# pixels) — kept as an option but rarely what you want going 1024 -> 32.
RESAMPLE = {
    "lanczos": Image.LANCZOS,
    "box": Image.BOX,
    "nearest": Image.NEAREST,
}


def require_key() -> str:
    """Read GEMINI_API_KEY from env, or exit with a clear, actionable message."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit(
            "Missing GEMINI_API_KEY. It lives in guppi/house-helper/.env on the LAN "
            "(reachable via Tailscale) — export it for this shell "
            "(`export GEMINI_API_KEY=...`) and never commit it. See "
            "scripts/gen-icons/README.md. (Use --dry-run to compose prompts without a key.)"
        )
    return key


def gemini_image(prompt: str, api_key: str) -> bytes:
    """POST one prompt, return the raw PNG bytes of the first inline image in the reply."""
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:1000]
        sys.exit(f"Gemini API HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        sys.exit(
            f"Could not reach the Gemini endpoint ({e.reason}). Check network / that "
            "the agent proxy allows generativelanguage.googleapis.com."
        )
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    sys.exit(f"No image found in Gemini response: {json.dumps(payload)[:800]}")


def key_out_background(img: Image.Image, tolerance: int) -> Image.Image:
    """Make the flat background transparent by sampling the corners for the bg colour
    and keying out every pixel within `tolerance` (Euclidean RGB distance) of it."""
    img = img.convert("RGBA")
    arr = np.asarray(img).astype(np.int16)
    h, w = arr.shape[:2]
    corners = np.array(
        [arr[0, 0, :3], arr[0, w - 1, :3], arr[h - 1, 0, :3], arr[h - 1, w - 1, :3]]
    )
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((arr[:, :, :3] - bg) ** 2).sum(axis=2))
    out = arr.copy()
    out[dist < tolerance, 3] = 0
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def square_crop(img: Image.Image, margin: float = 0.08) -> Image.Image:
    """Crop to the opaque content's bounding box, then centre it on a transparent
    square canvas with a small margin so the icon breathes at the frame edges."""
    arr = np.asarray(img)
    ys, xs = np.where(arr[:, :, 3] > 8)
    if len(xs) == 0:  # nothing survived the key-out — return as-is for eyeballing
        return img
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    content = img.crop(box)
    side = int(max(content.width, content.height) * (1 + 2 * margin))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(
        content, ((side - content.width) // 2, (side - content.height) // 2)
    )
    return canvas


def quantise(img: Image.Image, colours: int) -> Image.Image:
    """Reduce the RGB palette to `colours` while preserving the original alpha."""
    rgb = img.convert("RGB").quantize(colors=colours, method=Image.MEDIANCUT).convert("RGB")
    r, g, b = rgb.split()
    return Image.merge("RGBA", (r, g, b, img.split()[3]))


def post_process(raw_png: Path, out_png: Path, *, tolerance: int, resample: str,
                 colours: int | None) -> None:
    img = Image.open(raw_png)
    img = key_out_background(img, tolerance)
    img = square_crop(img)
    img = img.resize((ICON_SIZE, ICON_SIZE), RESAMPLE[resample])
    if colours:
        img = quantise(img, colours)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_png)
    print(f"  processed -> {out_png.relative_to(REPO_ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", metavar="ID", help="generate just this one item id")
    ap.add_argument("--dry-run", action="store_true",
                    help="compose + print prompts only; no API call, no spend, no key needed")
    ap.add_argument("--raw-only", action="store_true",
                    help="generate raw PNGs but skip post-processing (for eyeballing)")
    ap.add_argument("--tolerance", type=int, default=45,
                    help="background key-out colour distance (default 45)")
    ap.add_argument("--resample", choices=RESAMPLE, default="lanczos",
                    help="downscale filter (default lanczos; nearest = hard subsample)")
    ap.add_argument("--quantise", type=int, metavar="N", default=None,
                    help="optional: quantise the palette to N colours")
    args = ap.parse_args()

    ids = [args.only] if args.only else list(prompts.SUBJECTS)
    unknown = [i for i in ids if i not in prompts.SUBJECTS]
    if unknown:
        sys.exit(f"unknown item id(s): {', '.join(unknown)}; "
                 f"known: {', '.join(sorted(prompts.SUBJECTS))}")

    if args.dry_run:
        for item_id in ids:
            print(f"\n=== {item_id} ===\n{prompts.compose(item_id)}")
        print(f"\n[dry-run] {len(ids)} prompt(s) composed; no API call made.")
        return

    api_key = require_key()
    for item_id in ids:
        print(f"\n=== {item_id} ===")
        raw_bytes = gemini_image(prompts.compose(item_id), api_key)
        raw_png = RAW_DIR / f"{item_id}.png"
        raw_png.parent.mkdir(parents=True, exist_ok=True)
        raw_png.write_bytes(raw_bytes)
        print(f"  raw -> {raw_png.relative_to(REPO_ROOT)}")
        if args.raw_only:
            continue
        post_process(
            raw_png, ICON_DIR / f"{item_id}.png",
            tolerance=args.tolerance, resample=args.resample, colours=args.quantise,
        )


if __name__ == "__main__":
    main()
