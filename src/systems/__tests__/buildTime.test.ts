import { describe, it, expect } from 'vitest';
import { buildTimeFor } from '../buildTime';
import { BUILD_MS } from '../../config';

describe('buildTimeFor', () => {
  it('returns the per-buildable buildTimeMs when set', () => {
    expect(buildTimeFor({ buildTimeMs: 4200 })).toBe(4200);
  });

  it('falls back to BUILD_MS when buildTimeMs is absent', () => {
    expect(buildTimeFor({})).toBe(BUILD_MS);
  });

  it('falls back to BUILD_MS when buildTimeMs is undefined', () => {
    expect(buildTimeFor({ buildTimeMs: undefined })).toBe(BUILD_MS);
  });

  it('treats 0 as an explicit value (not the fallback)', () => {
    // `??` only falls back on null/undefined, so an explicit 0 stays 0 (instant build).
    expect(buildTimeFor({ buildTimeMs: 0 })).toBe(0);
  });
});
