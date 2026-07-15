/**
 * Map-reference capture (dev-only tracing aid) — renders a top-down OSM slice of a real
 * location at an EXACT metres-per-pixel and screenshots it with Playwright, so it drops onto the
 * Map Builder's grid 1:1 for hand-tracing (see docs/EDITOR.md — reference-underlay feature).
 *
 * NOT Google Maps: we render OpenStreetMap raster tiles (ODbL, license-clean) via MapLibre GL and
 * only ever read a *coordinate* from the author — never Google's copyrighted imagery. Output is a
 * dev artifact under out/ — COMMITTED to the repo and served to the editor by the dev-only
 * `/__editor` middleware (never in the prod bundle; editor is serve-only): a PNG + a sidecar JSON
 * the editor underlay consumes to auto-align (no eyeballing the scale bar).
 *
 * Run: `node scripts/map-reference/capture.mjs`  (edit the CONFIG block or pass env overrides).
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---- CONFIG (Mostowo camp/base slice — plan 021 curated slice) ----
const CONFIG = {
  name: process.env.MAPREF_NAME ?? 'mostowo',
  // Center = player spawn / base (author-supplied coordinate, not scraped).
  centerLat: Number(process.env.MAPREF_LAT ?? 54.072585545501475),
  centerLon: Number(process.env.MAPREF_LON ?? 16.360252413187283),
  gridW: Number(process.env.MAPREF_GRID_W ?? 128), // tiles E-W
  gridH: Number(process.env.MAPREF_GRID_H ?? 160), // tiles N-S
  metresPerTile: Number(process.env.MAPREF_M_PER_TILE ?? 3),
  pxPerTile: Number(process.env.MAPREF_PX_PER_TILE ?? 16),
  // maplibre-gl pinned so a CDN bump can't silently change tile scaling.
  maplibreVersion: '4.7.1',
};

const OSM_TILE_MAX_ZOOM = 19; // OSM standard raster tops out here; MapLibre overzooms above it.
const EARTH_EQ_MPP_Z0 = 156543.03392804097; // metres/pixel at the equator, zoom 0, 256px tiles.
// Polite, identifying UA per the OSM tile usage policy (faking a browser UA gets you blocked).
const USER_AGENT =
  'mostowo-survival-mapref/1.0 (dev tracing tool; https://github.com/third-bridge/mostowo-survival)';

const rad = (deg) => (deg * Math.PI) / 180;

/** Derive the exact fractional zoom + geometry that makes 1 screenshot pixel == metresPerPixel. */
export function derive(cfg) {
  const imageW = cfg.gridW * cfg.pxPerTile;
  const imageH = cfg.gridH * cfg.pxPerTile;
  const metresPerPixel = cfg.metresPerTile / cfg.pxPerTile;
  const cosLat = Math.cos(rad(cfg.centerLat));
  // metresPerPixel = EARTH_EQ_MPP_Z0 * cosLat / 2^zoom  →  solve for zoom.
  const zoom = Math.log2((EARTH_EQ_MPP_Z0 * cosLat) / metresPerPixel);
  // Half-extents in metres → lat/lon deltas (WGS84 approx) for the sidecar bbox.
  const halfWm = (cfg.gridW * cfg.metresPerTile) / 2;
  const halfHm = (cfg.gridH * cfg.metresPerTile) / 2;
  const dLat = halfHm / 111320;
  const dLon = halfWm / (111320 * cosLat);
  return {
    imageW,
    imageH,
    metresPerPixel,
    zoom,
    bbox: {
      north: cfg.centerLat + dLat,
      south: cfg.centerLat - dLat,
      east: cfg.centerLon + dLon,
      west: cfg.centerLon - dLon,
    },
    extentMetres: { w: cfg.gridW * cfg.metresPerTile, h: cfg.gridH * cfg.metresPerTile },
  };
}

/** Self-contained MapLibre page: OSM raster source, exact center/zoom, no UI chrome. Sets
 *  window.__mapReady on 'idle' so Playwright can wait for a fully-rendered frame. */
export function buildHtml(cfg, d) {
  const v = cfg.maplibreVersion;
  const style = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: OSM_TILE_MAX_ZOOM,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://unpkg.com/maplibre-gl@${v}/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://unpkg.com/maplibre-gl@${v}/dist/maplibre-gl.js"></script>
<style>html,body{margin:0;padding:0}#map{width:${d.imageW}px;height:${d.imageH}px}</style>
</head><body><div id="map"></div><script>
  const map = new maplibregl.Map({
    container: 'map',
    style: ${JSON.stringify(style)},
    center: [${cfg.centerLon}, ${cfg.centerLat}],
    zoom: ${d.zoom},
    maxZoom: 24,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    preserveDrawingBuffer: true,
    pixelRatio: 1,
  });
  window.__mapReady = false;
  map.on('idle', () => { window.__mapReady = true; });
  map.on('error', (e) => { window.__mapError = String(e && e.error || e); });
</script></body></html>`;
}

export async function capture(cfg) {
  const d = derive(cfg);
  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');
  await mkdir(outDir, { recursive: true });

  console.log(
    `[mapref] ${cfg.name}: ${cfg.gridW}x${cfg.gridH} tiles @ ${cfg.metresPerTile}m/tile → ` +
      `${d.imageW}x${d.imageH}px, ${d.metresPerPixel.toFixed(4)} m/px, zoom ${d.zoom.toFixed(3)}`,
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: d.imageW, height: d.imageH },
    deviceScaleFactor: 1,
    userAgent: USER_AGENT,
  });
  const page = await context.newPage();
  try {
    await page.setContent(buildHtml(cfg, d), { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction('window.__mapReady === true || window.__mapError', {
      timeout: 60_000,
    });
    const err = await page.evaluate('window.__mapError');
    if (err) throw new Error(`MapLibre reported an error: ${err}`);
    // One extra settle frame so the final raster composite is flushed before capture.
    await page.waitForTimeout(500);

    const pngPath = join(outDir, `${cfg.name}-reference.png`);
    await page.locator('#map').screenshot({ path: pngPath });

    const sidecar = {
      name: cfg.name,
      source: 'openstreetmap',
      center: { lat: cfg.centerLat, lon: cfg.centerLon },
      grid: { w: cfg.gridW, h: cfg.gridH },
      metresPerTile: cfg.metresPerTile,
      pxPerTile: cfg.pxPerTile,
      image: { w: d.imageW, h: d.imageH },
      metresPerPixel: d.metresPerPixel,
      zoom: d.zoom,
      bbox: d.bbox,
      extentMetres: d.extentMetres,
    };
    const jsonPath = join(outDir, `${cfg.name}-reference.json`);
    await writeFile(jsonPath, `${JSON.stringify(sidecar, null, 2)}\n`);

    console.log(`[mapref] wrote ${pngPath}`);
    console.log(`[mapref] wrote ${jsonPath}`);

    return { pngPath, jsonPath, sidecar };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  capture(CONFIG).catch((e) => {
    console.error('[mapref] failed:', e.message);
    process.exitCode = 1;
  });
}
