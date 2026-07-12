/**
 * Regenerate the placeholder art this game ships before real art lands (plan 009's Gemini pipeline).
 * Self-contained PNG encoder (Node `zlib` only — no image deps in this repo), RGBA/8-bit.
 *
 * Emits:
 *   - public/assets/icons/berries.png                          (32×32 item icon — plan 004 step 5)
 *   - public/assets/tilesets/pixel-crawler/_derived/bush.png   (berry-bush node sprite — plan 004 step 5)
 *
 * Re-run: `node scripts/placeholder-art.mjs`. Deterministic (no RNG), so it's safe to re-run.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---- Minimal RGBA raster ----
class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4); // transparent by default
  }
  set(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.px[i] = r;
    this.px[i + 1] = g;
    this.px[i + 2] = b;
    this.px[i + 3] = a;
  }
  disc(cx, cy, rad, colour) {
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rad * rad) this.set(x, y, colour);
      }
    }
  }
}

// ---- PNG encode (colour type 6, 8-bit; CRC32 + zlib IDAT) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(raster) {
  const { w, h, px } = raster;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10-12 = compression/filter/interlace = 0
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    px.subarray(y * w * 4, (y + 1) * w * 4).forEach((v, i) => {
      raw[y * (w * 4 + 1) + 1 + i] = v;
    });
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function write(path, raster) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(raster));
  console.log(`wrote ${path} (${raster.w}×${raster.h})`);
}

// ---- Palette (matches items.ts `berries` colour 0x7a2f4a + a leafy green) ----
const BERRY = [0x9a, 0x2f, 0x4a, 255]; // ripe berry red-magenta
const BERRY_HI = [0xc8, 0x5a, 0x78, 255]; // highlight
const LEAF = [0x2f, 0x6d, 0x34, 255]; // bush/leaf green (tree-ish)
const LEAF_HI = [0x47, 0x8a, 0x45, 255];

// ---- berries.png: a cluster of berries with a leaf (32×32 icon) ----
{
  const r = new Raster(32, 32);
  r.disc(16, 20, 8, BERRY); // main cluster body
  r.disc(11, 15, 5, BERRY);
  r.disc(21, 15, 5, BERRY);
  r.disc(9, 13, 1.5, BERRY_HI); // little highlights
  r.disc(19, 13, 1.5, BERRY_HI);
  r.disc(14, 18, 1.5, BERRY_HI);
  r.disc(16, 6, 4, LEAF); // leaf on top
  r.disc(16, 5, 1.5, LEAF_HI);
  write('public/assets/icons/berries.png', r);
}

// ---- bush.png: a low green mound dotted with berries (28×24 node sprite) ----
{
  const r = new Raster(28, 24);
  r.disc(14, 16, 9, LEAF); // mound body
  r.disc(8, 14, 6, LEAF);
  r.disc(20, 14, 6, LEAF);
  r.disc(10, 10, 2, LEAF_HI); // leafy highlights
  r.disc(18, 11, 2, LEAF_HI);
  r.disc(9, 15, 2, BERRY); // berries peeking through
  r.disc(15, 12, 2, BERRY);
  r.disc(20, 16, 2, BERRY);
  r.disc(13, 18, 2, BERRY);
  write('public/assets/tilesets/pixel-crawler/_derived/bush.png', r);
}
