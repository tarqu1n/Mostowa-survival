import { describe, it, expect } from 'vitest';
import { isInBase, baseZoneTileRect } from '../base';
import { BASE_ZONE } from '../../config';

describe('isInBase', () => {
  it('is true at each corner of the inclusive rectangle', () => {
    expect(isInBase(BASE_ZONE.minCol, BASE_ZONE.minRow)).toBe(true);
    expect(isInBase(BASE_ZONE.maxCol, BASE_ZONE.minRow)).toBe(true);
    expect(isInBase(BASE_ZONE.minCol, BASE_ZONE.maxRow)).toBe(true);
    expect(isInBase(BASE_ZONE.maxCol, BASE_ZONE.maxRow)).toBe(true);
  });

  it('is true at the centre', () => {
    const centreCol = Math.floor((BASE_ZONE.minCol + BASE_ZONE.maxCol) / 2);
    const centreRow = Math.floor((BASE_ZONE.minRow + BASE_ZONE.maxRow) / 2);
    expect(isInBase(centreCol, centreRow)).toBe(true);
  });

  it('is false just outside each edge', () => {
    const centreRow = Math.floor((BASE_ZONE.minRow + BASE_ZONE.maxRow) / 2);
    const centreCol = Math.floor((BASE_ZONE.minCol + BASE_ZONE.maxCol) / 2);
    expect(isInBase(BASE_ZONE.minCol - 1, centreRow)).toBe(false);
    expect(isInBase(BASE_ZONE.maxCol + 1, centreRow)).toBe(false);
    expect(isInBase(centreCol, BASE_ZONE.minRow - 1)).toBe(false);
    expect(isInBase(centreCol, BASE_ZONE.maxRow + 1)).toBe(false);
  });

  it('is false for a far-away tile', () => {
    expect(isInBase(0, 0)).toBe(false);
    expect(isInBase(60, 60)).toBe(false);
  });
});

describe('baseZoneTileRect', () => {
  it('returns the BASE_ZONE bounds', () => {
    expect(baseZoneTileRect()).toEqual(BASE_ZONE);
  });
});
