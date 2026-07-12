import { describe, it, expect } from 'vitest';
import { cycleLengthMs, phaseAt, tintAlphaAt, dayCountForTotal } from '../daynight';
import { DAY_MS, TWILIGHT_MS, NIGHT_MAX_ALPHA } from '../../config';

describe('phaseAt', () => {
  it('is day just before the DAY_MS boundary and night at/after it', () => {
    expect(phaseAt(DAY_MS - 1)).toBe('day');
    expect(phaseAt(DAY_MS)).toBe('night');
  });
});

describe('tintAlphaAt', () => {
  it('is 0 mid-day (between dawn-end and dusk-start)', () => {
    const midDay = DAY_MS / 2;
    expect(tintAlphaAt(midDay)).toBe(0);
  });

  it('is NIGHT_MAX_ALPHA mid-night', () => {
    const midNight = DAY_MS + TWILIGHT_MS; // well into the night plateau
    expect(tintAlphaAt(midNight)).toBe(NIGHT_MAX_ALPHA);
  });

  it('ramps 0 -> NIGHT_MAX_ALPHA across the dusk window, continuously', () => {
    const duskStart = DAY_MS - TWILIGHT_MS;
    const duskMid = duskStart + TWILIGHT_MS / 2;
    expect(tintAlphaAt(duskStart)).toBe(0);
    expect(tintAlphaAt(DAY_MS)).toBe(NIGHT_MAX_ALPHA);
    const mid = tintAlphaAt(duskMid);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(NIGHT_MAX_ALPHA);
  });

  it('ramps NIGHT_MAX_ALPHA -> 0 across the dawn window, continuously', () => {
    const dawnMid = TWILIGHT_MS / 2;
    expect(tintAlphaAt(0)).toBe(NIGHT_MAX_ALPHA);
    expect(tintAlphaAt(TWILIGHT_MS)).toBe(0);
    const mid = tintAlphaAt(dawnMid);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(NIGHT_MAX_ALPHA);
  });
});

describe('dayCountForTotal', () => {
  it('is 1 at t=0 and 2 after one full cycle', () => {
    expect(dayCountForTotal(0)).toBe(1);
    expect(dayCountForTotal(cycleLengthMs())).toBe(2);
  });
});
