import { describe, it, expect } from 'vitest';
import { computeAutoAlign, parseSidecar, type Sidecar } from '../underlayAlign';

const REAL_SIDECAR = {
  name: 'mostowo',
  source: 'openstreetmap',
  center: { lat: 54.07, lon: 16.36 },
  grid: { w: 128, h: 160 },
  metresPerTile: 3,
  pxPerTile: 16,
  image: { w: 2048, h: 2560 },
  metresPerPixel: 0.1875,
  zoom: 18.9,
  bbox: { north: 1, south: 2, east: 3, west: 4 },
  extentMetres: { w: 384, h: 480 },
};

describe('parseSidecar', () => {
  it('narrows a valid (real-shaped) sidecar to the {pxPerTile, image, grid} subset', () => {
    expect(parseSidecar(REAL_SIDECAR)).toEqual({
      pxPerTile: 16,
      image: { w: 2048, h: 2560 },
      grid: { w: 128, h: 160 },
    });
  });

  it('returns null for non-object input', () => {
    expect(parseSidecar(null)).toBeNull();
    expect(parseSidecar(undefined)).toBeNull();
    expect(parseSidecar('nope')).toBeNull();
    expect(parseSidecar(42)).toBeNull();
    expect(parseSidecar([])).toBeNull();
  });

  it('returns null when a required field is missing or wrong-typed', () => {
    expect(parseSidecar({})).toBeNull();
    expect(parseSidecar({ ...REAL_SIDECAR, pxPerTile: '16' })).toBeNull();
    expect(parseSidecar({ ...REAL_SIDECAR, image: undefined })).toBeNull();
    expect(parseSidecar({ ...REAL_SIDECAR, image: { w: 2048 } })).toBeNull();
    expect(parseSidecar({ ...REAL_SIDECAR, grid: { w: 128 } })).toBeNull();
  });

  it('rejects non-finite or non-positive pxPerTile', () => {
    expect(parseSidecar({ ...REAL_SIDECAR, pxPerTile: NaN })).toBeNull();
    expect(parseSidecar({ ...REAL_SIDECAR, pxPerTile: Infinity })).toBeNull();
    expect(parseSidecar({ ...REAL_SIDECAR, pxPerTile: 0 })).toBeNull();
    expect(parseSidecar({ ...REAL_SIDECAR, pxPerTile: -16 })).toBeNull();
  });

  it('ignores extra/unknown fields (the real sidecar carries plenty)', () => {
    const parsed = parseSidecar(REAL_SIDECAR);
    expect(parsed).not.toHaveProperty('name');
    expect(parsed).not.toHaveProperty('metresPerTile');
  });
});

describe('computeAutoAlign', () => {
  const sidecar: Sidecar = { pxPerTile: 16, image: { w: 2048, h: 2560 }, grid: { w: 128, h: 160 } };

  it('with a matching sidecar (pxPerTile === tileSize): scale 1, zero offset, no warning', () => {
    const result = computeAutoAlign({ sidecar, imageW: 2048, imageH: 2560, tileSize: 16 });
    expect(result).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(result.warning).toBeUndefined();
  });

  it('with a size-mismatched image: warns but still returns the sidecar-derived scale/offset', () => {
    const result = computeAutoAlign({ sidecar, imageW: 1024, imageH: 1280, tileSize: 16 });
    expect(result.scale).toBe(1);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('1024');
    expect(result.warning).toContain('1280');
    expect(result.warning).toContain('2048');
    expect(result.warning).toContain('2560');
  });

  it('without a sidecar (undefined or null): identity scale/offset, no warning', () => {
    expect(
      computeAutoAlign({ sidecar: undefined, imageW: 999, imageH: 999, tileSize: 16 }),
    ).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(computeAutoAlign({ sidecar: null, imageW: 999, imageH: 999, tileSize: 16 })).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('derives a non-1 scale when pxPerTile differs from tileSize', () => {
    const result = computeAutoAlign({
      sidecar: { ...sidecar, pxPerTile: 32 },
      imageW: 2048,
      imageH: 2560,
      tileSize: 16,
    });
    expect(result.scale).toBe(0.5);
  });
});
