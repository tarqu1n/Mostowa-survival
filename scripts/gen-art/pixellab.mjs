// Generate a test pixel-art image via the PixelLab API (pixellab.ai) — the other of the two free
// AI pixel-art services we're trialling alongside CC0 tilesets (see docs/ASSETS.md).
//
// Schema verified against https://api.pixellab.ai/v1/openapi.json on 2026-07-11. PixelLab's docs
// UI (https://api.pixellab.ai/v1/docs) is the source of truth if this drifts — the API is young
// and the free tier's exact limits (200x200 max canvas on free, per pixellab.ai/docs pricing notes)
// aren't guaranteed stable; re-check there if this script starts erroring.
//
// Usage:
//   PIXELLAB_API_KEY=... node scripts/gen-art/pixellab.mjs \
//     --description "mossy stone brick wall, top down" --width 16 --height 16 \
//     --out docs/assets/ai-tests/pixellab/wall.png
//
// Useful flags:
//   --description         required. What to generate.
//   --negative             optional negative_description.
//   --model                pixflux (default, general-purpose text-to-pixel-art) or bitforge
//                          (supports a --style-image reference for matching an existing pack's look —
//                          useful for keeping AI-generated pieces visually consistent with the
//                          Zombie Apocalypse base tileset once we've picked one).
//   --width/--height       default 16x16 (this repo's TILE_SIZE). Free tier caps at 200x200 total.
//   --view                 e.g. "top-down", "side", "low top-down" (enum — see PixelLab docs for
//                          the exact accepted values, unverified here).
//   --no-background        transparent background.
//   --seed                 optional int, for reproducible re-runs.
//   --out                  output PNG path (default: scripts/.gen-art/pixellab-<timestamp>.png)
import { parseArgs, requireEnv, writeBase64Png } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.description) {
  console.error('Usage: node scripts/gen-art/pixellab.mjs --description "..." [--width 16] [--height 16] [--model pixflux|bitforge] [--out path.png]');
  process.exit(1);
}

const apiKey = requireEnv('PIXELLAB_API_KEY');

const model = args.model === 'bitforge' ? 'bitforge' : 'pixflux';
const endpoint = `https://api.pixellab.ai/v1/generate-image-${model}`;

const payload = {
  description: args.description,
  image_size: { width: Number(args.width ?? 16), height: Number(args.height ?? 16) },
  ...(args.negative ? { negative_description: args.negative } : {}),
  ...(args.view ? { view: args.view } : {}),
  ...(args['no-background'] ? { no_background: true } : {}),
  ...(args.seed ? { seed: Number(args.seed) } : {}),
};

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const data = await res.json();

if (!res.ok) {
  console.error('PixelLab error', res.status, JSON.stringify(data));
  process.exit(1);
}

// Base64Image response shape isn't pinned down beyond "an object with the image data" from the
// OpenAPI summary — handle both a {base64: "..."} wrapper and a bare base64 string.
const base64 = data.image?.base64 ?? (typeof data.image === 'string' ? data.image : null);
if (!base64) {
  console.error('Unexpected response shape — dumping full response for debugging:');
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

const out = args.out ?? `scripts/.gen-art/pixellab-${Date.now()}.png`;
writeBase64Png(base64, out);
if (data.usage) console.log('usage:', JSON.stringify(data.usage));
