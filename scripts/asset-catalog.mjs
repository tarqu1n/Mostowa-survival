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
 *     exclude: string[] }                                               // glob patterns, dropped entirely
 *
 * Every path in rules/overrides/exclude and in the emitted catalog is POSIX-relative to the pack
 * root (forward slashes even on Windows) — stable across OSes and re-zips of the source pack.
 *
 * Re-run: `npm run assets:catalog`. Deterministic (no timestamps, no RNG) — packs/assets/tags are all
 * sorted, so an unchanged pack dir re-generates a byte-identical file (safe to diff in review).
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

// ---- Animation-strip frame count: frames run along whichever axis is the larger dimension,
// each frame square with side = the smaller dimension (matches every currently-wired strip in
// src/data/tileset.ts: e.g. Idle_Down-Sheet.png 256x64 -> frameSize 64, frames 4). A handful of
// pack sheets (mostly animated crafting-station props, not yet wired into the game) don't divide
// evenly under this rule — those get a best-effort rounded frame count plus a console warning; fix
// with a `frames` override in pack.json once/if the asset is actually wired in. ----
function stripFrames(w, h, relPath, warnings) {
  const [frameSize, span] = w >= h ? [h, w] : [w, h];
  const exact = span / frameSize;
  const frames = Math.max(1, Math.round(exact));
  if (frames !== exact) {
    warnings.push(
      `${relPath}: strip ${w}x${h} doesn't divide evenly (${exact}) -> rounded to ${frames} frames`,
    );
  }
  return frames;
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
    asset.frames = stripFrames(w, h, relPath, warnings);
  }

  const override = pack.overrides?.[relPath];
  if (override) asset = { ...asset, ...override };
  return asset;
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
    for (const rel of kept) assets.push(buildAsset(pack, rel, warnings));
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
