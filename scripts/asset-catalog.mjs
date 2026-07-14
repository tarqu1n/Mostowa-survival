/**
 * Generate `public/assets/asset-catalog.json` — the Map Builder editor's Library-panel index — by
 * scanning every `public/assets/tilesets/<pack>/` dir that carries a `pack.json` manifest and
 * classifying each PNG per that manifest's `rules` (see docs/ASSETS.md "Pack manifests & asset
 * catalog" and each `pack.json`'s own comment-free shape below).
 *
 * No npm deps beyond Node built-ins: PNG width/height are read directly off the IHDR chunk
 * (big-endian uint32 at byte offsets 16/20 — PNG signature is 8 bytes, then a 4-byte chunk length +
 * 4-byte "IHDR" tag, then width/height; see `readPngSize`), no image library needed.
 *
 * `pack.json` shape:
 *   { id, name, author, sourceUrl, licence, tileSize,
 *     rules: { tile: string[], strip: string[], selfMade: string[] },   // glob patterns, see `globToRegExp`
 *     overrides: { [relativePath]: Partial<Asset> },                    // exact-path escape hatch
 *     exclude: string[],                                                // glob patterns, dropped entirely
 *     regionParams: { [relativePath]: Partial<DetectionParams> },       // consumed by gen_regions.py, not here
 *     regions: { [relativePath]: Array<{x,y,w,h}> } }                   // consumed by gen_regions.py, not here
 *
 * Every path in rules/overrides/exclude and in the emitted catalog is POSIX-relative to the pack
 * root (forward slashes even on Windows) — stable across OSes and re-zips of the source pack.
 *
 * Re-run: `npm run assets:catalog`. Deterministic (no timestamps, no RNG) — packs/assets/tags are all
 * sorted, so an unchanged pack dir re-generates a byte-identical file (safe to diff in review).
 *
 * Atlas sprite regions (plan 014 step 7a): `object`-type assets whose sheet is a multi-sprite atlas
 * get per-sprite bounding boxes merged in from `<pack>/regions.json` (see
 * `scripts/pixel-crawler/gen_regions.py`, which generates it — never hand-write it, only its
 * `pack.json` `regionParams`/`regions` overrides). Regen order matters: `gen_regions.py` must run
 * BEFORE this script so the sidecar it reads is current. See `mergeRegions` below.
 */
import {
  openSync,
  readSync,
  closeSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { join, dirname, relative, extname, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TILESETS_DIR = join(ROOT, 'public/assets/tilesets');
const OUTPUT_PATH = join(ROOT, 'public/assets/asset-catalog.json');

// ---- PNG IHDR size read (no image-parsing dep) ----
// PNG = 8-byte signature, then the IHDR chunk: 4-byte length (always 13) + 4-byte "IHDR" tag +
// 4-byte width + 4-byte height (both big-endian uint32), so only the first 24 bytes matter.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function readPngSize(absPath) {
  const fd = openSync(absPath, 'r');
  try {
    const header = Buffer.alloc(24);
    readSync(fd, header, 0, 24, 0);
    if (!header.subarray(0, 8).equals(PNG_SIG))
      throw new Error(`not a PNG (bad signature): ${absPath}`);
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    closeSync(fd);
  }
}

// ---- Minimal glob matcher (`*` = within one path segment, `**` = across segments) ----
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++; // consume the second '*'
      if (glob[i + 1] === '/') {
        re += '(?:.*/)?';
        i++; // consume the following '/' too — '**/' may match zero directories
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(patterns, relPath) {
  return patterns.some((p) => globToRegExp(p).test(relPath));
}

// ---- Path -> tags/category (mechanical, no per-file judgement) ----
function tokenize(relPath) {
  const noExt = relPath.slice(0, relPath.length - extname(relPath).length);
  const words = noExt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return Array.from(new Set(words)).sort();
}

function categoryOf(relPath) {
  const dir = dirname(relPath);
  return dir === '.' ? '(root)' : dir;
}

// ---- Recursively list every .png under a dir, as POSIX paths relative to `root` ----
function listPngs(root, dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      listPngs(root, abs, out);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.png') {
      // `relative()` uses the OS separator; normalise to POSIX for glob matching / catalog ids.
      out.push(relative(root, abs).split(sep).join('/'));
    }
  }
  return out;
}

// ---- Animation-strip frame math: a strip is always ONE HORIZONTAL ROW of `frames`, so the frame
// height is simply the sheet height, and frame width is `w / frames` — never a square/smaller-dim
// GUESS (the previous rule here: frameSize = min(w,h), frames = round(max(w,h)/frameSize)). That
// guess is provably wrong whenever a strip's frames aren't square: e.g. Fire_01-Sheet.png 128x48 is
// really 4 frames of 32x48, but the old rule picked frameSize=48 (assuming square) and rounded
// 128/48=2.667 to 3 — both the frame count AND width would have been wrong, reproducing the exact
// flicker/"flying" slice bug `StripAnim.frameWidth` exists to fix (src/data/tileset.ts L44-50).
// `frames` can only be derived automatically in the unambiguous case (`w` a whole multiple of `h`,
// i.e. square frames) — anything else needs an explicit `frames` override in pack.json (don't
// guess); unresolved strips fall back to treating the whole sheet as one unsliced frame and warn. */
function stripFrameDims(w, h, relPath, framesOverride, warnings) {
  const frameHeight = h;
  let frames = framesOverride;
  if (frames === undefined) {
    if (w % h === 0) {
      frames = w / h; // square frames — the only case derivable without a pack.json override
    } else {
      frames = 1; // unresolved: render unsliced rather than mis-slice on a wrong guess
      warnings.push(
        `${relPath}: strip ${w}x${h} isn't a whole multiple of its own height (non-square frames) ` +
          `and has no 'frames' override in pack.json -> treating as 1 unsliced frame`,
      );
    }
  }
  const frameWidth = w / frames;
  if (!Number.isInteger(frameWidth)) {
    warnings.push(
      `${relPath}: strip ${w}x${h} with frames=${frames} (from pack.json override) gives a ` +
        `non-integer frameWidth ${frameWidth} -> check the override`,
    );
  }
  return { frameWidth, frameHeight, frames };
}

function buildAsset(pack, relPath, warnings) {
  const abs = join(TILESETS_DIR, pack.id, relPath);
  const { width: w, height: h } = readPngSize(abs);
  const type = matchesAny(pack.rules.tile, relPath)
    ? 'tile'
    : matchesAny(pack.rules.strip, relPath)
      ? 'strip'
      : 'object';
  const origin = matchesAny(pack.rules.selfMade ?? [], relPath) ? 'self-made' : 'pack';
  const override = pack.overrides?.[relPath];

  let asset = {
    id: `${pack.id}/${relPath}`,
    pack: pack.id,
    type,
    source:
      type === 'tile'
        ? { kind: 'sheetFrame', sheet: relPath, frame: 0 }
        : { kind: 'image', path: relPath },
    w,
    h,
    category: categoryOf(relPath),
    tags: tokenize(relPath),
    origin,
  };
  if (type === 'tile') {
    const cols = w / pack.tileSize;
    const rows = h / pack.tileSize;
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
      warnings.push(
        `${relPath}: tile sheet ${w}x${h} isn't a whole multiple of tileSize ${pack.tileSize}`,
      );
    }
    asset.frames = Math.floor(cols) * Math.floor(rows);
  } else if (type === 'strip') {
    // `frames` can come from the override (checked here, ahead of the generic override-merge
    // below, since frameWidth math NEEDS frames up front) — the generic merge re-applies it
    // afterwards too, harmlessly (same value).
    const { frameWidth, frameHeight, frames } = stripFrameDims(
      w,
      h,
      relPath,
      override?.frames,
      warnings,
    );
    asset.frameWidth = frameWidth;
    asset.frameHeight = frameHeight;
    asset.frames = frames;
  }

  if (override) asset = { ...asset, ...override };
  return asset;
}

// Below this pixel area, a missing regions.json sidecar entry isn't worth flagging — the small
// already-single-sprite `_derived/*.png` extracts are the common case and never need one.
const LARGE_OBJECT_AREA = 128 * 128;

/** Read `<pack>/regions.json` if present (absent is fine — e.g. a pack with no `object` sheets
 *  yet, like the `mostowo-custom` skeleton). Only checks the sidecar's OWN shape; cross-checking
 *  its contents against the actual assets is `mergeRegions`'s job (it needs each asset's w/h). */
function loadRegionsSidecar(pack) {
  const path = join(TILESETS_DIR, pack.id, 'regions.json');
  if (!existsSync(path)) return null;
  const sidecar = JSON.parse(readFileSync(path, 'utf8'));
  if (sidecar.schemaVersion !== 1) {
    throw new Error(`${pack.id}/regions.json: unsupported schemaVersion ${sidecar.schemaVersion}`);
  }
  if (typeof sidecar.sheets !== 'object' || sidecar.sheets === null) {
    throw new Error(`${pack.id}/regions.json: "sheets" must be an object`);
  }
  return sidecar;
}

/**
 * Merge `<pack>/regions.json` (generated by `scripts/pixel-crawler/gen_regions.py`, never
 * hand-edited) into this pack's already-built `object`-type assets, mutating their `.regions` in
 * place. Validates the sidecar is still CURRENT against the PNGs this run just measured: every
 * sheet key must name a real object-type asset (a stale entry for a renamed/reclassified/deleted
 * PNG is FATAL — the classification rules live in `pack.json` and `gen_regions.py` reads the same
 * ones, so this should only fire on a genuinely stale regen), and every region rect must fit inside
 * that asset's own w/h (FATAL on out-of-bounds — content drift the sidecar didn't catch up to; see
 * `mapFormat.ts`'s content-drift note on `DecorObject.region` for why re-running `gen_regions.py`
 * is the only guard against a sprite moving inside a same-size sheet). An asset gains a `regions`
 * array only when the sidecar lists >=2 regions for it — 1 or 0 stays a plain single object.
 */
function mergeRegions(pack, packAssets, warnings) {
  const sidecar = loadRegionsSidecar(pack);
  const objectAssets = new Map(
    packAssets.filter((a) => a.type === 'object').map((a) => [a.id.slice(pack.id.length + 1), a]),
  );

  if (sidecar) {
    for (const [relPath, entry] of Object.entries(sidecar.sheets)) {
      const asset = objectAssets.get(relPath);
      if (!asset) {
        throw new Error(
          `${pack.id}/regions.json references "${relPath}", which is not a current object-type ` +
            `asset (stale sidecar — rerun scripts/pixel-crawler/gen_regions.py)`,
        );
      }
      const regions = entry.regions ?? [];
      for (const r of regions) {
        const intFields = [r.x, r.y, r.w, r.h].every((n) => Number.isInteger(n));
        if (!intFields || r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0) {
          throw new Error(
            `${pack.id}/regions.json: "${relPath}" region ${r.key} has invalid bounds`,
          );
        }
        if (r.x + r.w > asset.w || r.y + r.h > asset.h) {
          throw new Error(
            `${pack.id}/regions.json: "${relPath}" region ${r.key} (${r.x},${r.y},${r.w},${r.h}) ` +
              `is out of bounds for ${asset.w}x${asset.h} (stale sidecar — rerun gen_regions.py)`,
          );
        }
      }
      if (regions.length >= 2) {
        asset.regions = regions
          .map((r) => ({ key: r.key, x: r.x, y: r.y, w: r.w, h: r.h }))
          .sort((a, b) => a.y - b.y || a.x - b.x);
      }
    }
  }

  for (const asset of objectAssets.values()) {
    const relPath = asset.id.slice(pack.id.length + 1);
    const hasEntry = sidecar?.sheets?.[relPath] !== undefined;
    if (!hasEntry && asset.w * asset.h >= LARGE_OBJECT_AREA) {
      warnings.push(
        `${asset.id}: large object PNG (${asset.w}x${asset.h}) has no regions.json sidecar entry ` +
          `-> rerun scripts/pixel-crawler/gen_regions.py`,
      );
    }
  }
}

function loadPacks() {
  const packs = [];
  for (const entry of readdirSync(TILESETS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(TILESETS_DIR, entry.name, 'pack.json');
    if (!existsSync(manifestPath)) continue; // e.g. zombie-apocalypse — retired, unwired, no manifest
    const pack = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (pack.id !== entry.name) {
      throw new Error(`pack.json id "${pack.id}" must match its folder name "${entry.name}"`);
    }
    packs.push(pack);
  }
  return packs.sort((a, b) => a.id.localeCompare(b.id));
}

function assertValidCatalog(catalog) {
  if (!Array.isArray(catalog.generatedFrom)) throw new Error('generatedFrom must be an array');
  if (!Array.isArray(catalog.packs)) throw new Error('packs must be an array');
  if (!Array.isArray(catalog.assets)) throw new Error('assets must be an array');
  const packIds = new Set(catalog.packs.map((p) => p.id));
  const seenIds = new Set();
  for (const p of catalog.packs) {
    for (const field of ['id', 'name', 'licence']) {
      if (typeof p[field] !== 'string')
        throw new Error(`pack ${p.id ?? '?'} missing string ${field}`);
    }
    if (typeof p.tileSize !== 'number') throw new Error(`pack ${p.id} missing numeric tileSize`);
  }
  for (const a of catalog.assets) {
    if (seenIds.has(a.id)) throw new Error(`duplicate asset id: ${a.id}`);
    seenIds.add(a.id);
    if (!packIds.has(a.pack)) throw new Error(`asset ${a.id} references unknown pack ${a.pack}`);
    if (!['tile', 'strip', 'object'].includes(a.type))
      throw new Error(`asset ${a.id} bad type ${a.type}`);
    if (typeof a.w !== 'number' || typeof a.h !== 'number')
      throw new Error(`asset ${a.id} missing w/h`);
    if (!Array.isArray(a.tags)) throw new Error(`asset ${a.id} tags must be an array`);
    if (a.type === 'strip') {
      if (typeof a.frameWidth !== 'number' || typeof a.frameHeight !== 'number') {
        throw new Error(`asset ${a.id} (strip) missing frameWidth/frameHeight`);
      }
    }
    if (a.regions !== undefined) {
      if (a.type !== 'object') throw new Error(`asset ${a.id} has regions but isn't type 'object'`);
      if (!Array.isArray(a.regions) || a.regions.length < 2) {
        throw new Error(`asset ${a.id} regions must be an array of >=2 entries when present`);
      }
      for (const r of a.regions) {
        if (
          typeof r.key !== 'string' ||
          typeof r.x !== 'number' ||
          typeof r.y !== 'number' ||
          typeof r.w !== 'number' ||
          typeof r.h !== 'number'
        ) {
          throw new Error(`asset ${a.id} has a malformed region entry`);
        }
      }
    }
  }
}

function main() {
  const packs = loadPacks();
  const warnings = [];
  const assets = [];
  for (const pack of packs) {
    const packDir = join(TILESETS_DIR, pack.id);
    const allPngs = listPngs(packDir);
    const kept = allPngs.filter((rel) => !matchesAny(pack.exclude ?? [], rel));
    const packAssets = kept.map((rel) => buildAsset(pack, rel, warnings));
    mergeRegions(pack, packAssets, warnings);
    assets.push(...packAssets);
  }
  assets.sort((a, b) => a.id.localeCompare(b.id));
  for (const a of assets) a.tags.sort();

  const catalog = {
    generatedFrom: packs.map((p) => p.id).sort(),
    packs: packs
      .map((p) => ({ id: p.id, name: p.name, licence: p.licence, tileSize: p.tileSize }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    assets,
  };

  assertValidCatalog(catalog);
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);

  for (const w of warnings) console.warn(`[assets:catalog] warn: ${w}`);
  console.log(
    `[assets:catalog] wrote ${relative(ROOT, OUTPUT_PATH)}: ${assets.length} assets across ${packs.length} packs (${warnings.length} warnings)`,
  );
}

main();
