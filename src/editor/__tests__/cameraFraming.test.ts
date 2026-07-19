import { describe, it, expect } from 'vitest';
import {
  mapContentBoundsPx,
  boundsOverlap,
  cameraViewportPx,
  type PxBounds,
} from '../cameraFraming';
import {
  createEmptyMap,
  setCell,
  type DecorObject,
  type NodeObject,
  type PortalObject,
} from '../../systems/mapFormat';

const TS = 16;

describe('mapContentBoundsPx', () => {
  it('returns null for a blank map (no tiles, no objects)', () => {
    expect(mapContentBoundsPx(createEmptyMap('m', 'M', 10, 10), TS)).toBeNull();
  });

  it('bounds a single painted tile to that cell span', () => {
    const map = createEmptyMap('m', 'M', 10, 10);
    setCell(map.layers[0].cells, 3, 4, 10, 1);
    expect(mapContentBoundsPx(map, TS)).toEqual({
      minX: 3 * TS,
      minY: 4 * TS,
      maxX: 4 * TS,
      maxY: 5 * TS,
    });
  });

  it('spans the union of painted cells across layers', () => {
    const map = createEmptyMap('m', 'M', 20, 20);
    setCell(map.layers[0].cells, 2, 2, 20, 1);
    setCell(map.layers[0].cells, 15, 17, 20, 1);
    expect(mapContentBoundsPx(map, TS)).toEqual({
      minX: 2 * TS,
      minY: 2 * TS,
      maxX: 16 * TS,
      maxY: 18 * TS,
    });
  });

  it('includes objects even when no tiles are painted', () => {
    const map = createEmptyMap('m', 'M', 30, 30);
    const decor: DecorObject = {
      id: 'decor_0001',
      kind: 'decor',
      asset: 'pack/x.png',
      x: 100,
      y: 200,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
      depth: 0,
    };
    map.objects.push(decor);
    // decor is centred at x,y and widened to a one-tile box
    expect(mapContentBoundsPx(map, TS)).toEqual({
      minX: 100 - TS / 2,
      minY: 200 - TS / 2,
      maxX: 100 + TS / 2,
      maxY: 200 + TS / 2,
    });
  });

  it('bounds a portal by its tile rect and a node by its cell', () => {
    const map = createEmptyMap('m', 'M', 30, 30);
    const node: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 1, row: 1 };
    const portal: PortalObject = {
      id: 'portal_0001',
      kind: 'portal',
      name: 'gate',
      rect: { col: 10, row: 12, w: 3, h: 2 },
      facing: 'down',
    };
    map.objects.push(node, portal);
    expect(mapContentBoundsPx(map, TS)).toEqual({
      minX: 1 * TS,
      minY: 1 * TS,
      maxX: 13 * TS, // portal col 10 + w 3
      maxY: 14 * TS, // portal row 12 + h 2
    });
  });
});

describe('boundsOverlap', () => {
  const content: PxBounds = { minX: 100, minY: 100, maxX: 200, maxY: 200 };

  it('true when boxes intersect', () => {
    expect(boundsOverlap(content, { minX: 150, minY: 150, maxX: 300, maxY: 300 })).toBe(true);
  });

  it('false when disjoint (the stale-camera-over-blank-canvas case)', () => {
    expect(boundsOverlap(content, { minX: 0, minY: 0, maxX: 50, maxY: 50 })).toBe(false);
  });

  it('false when merely touching edges', () => {
    expect(boundsOverlap(content, { minX: 200, minY: 100, maxX: 300, maxY: 200 })).toBe(false);
  });
});

describe('cameraViewportPx', () => {
  it('top-left = scroll, extent = size / zoom (matches Phaser worldView)', () => {
    expect(cameraViewportPx(50, 80, 2, 800, 600)).toEqual({
      minX: 50,
      minY: 80,
      maxX: 50 + 400,
      maxY: 80 + 300,
    });
  });
});
