import { describe, it, expect } from 'vitest';
import { decorTextureKey } from '../decorSprites';
import { tileImageKey } from '../../data/tileset';

/**
 * Tier-1 coverage for `decorSprites.ts`'s only Phaser-free piece — `decorTextureKey`'s pure
 * path/anim → key derivation. `queueDecorTexture`/`resolveDecorDraw` need a live `Phaser.Scene`
 * (texture manager, loader, anims manager) and are exercised live at `npm run editor` instead (see
 * plan 014 step 7b's acceptance notes) — there's no Phaser/DOM test harness in this repo.
 */
describe('decorTextureKey', () => {
  const PATH = 'Environment/Props/Static/Rocks.png';

  it('matches the ordinary whole-image key (tileImageKey) when no anim is given', () => {
    expect(decorTextureKey(PATH)).toBe(tileImageKey(PATH));
  });

  it('is deterministic: the same path+anim always derives the same key', () => {
    const anim = { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 };
    expect(decorTextureKey(PATH, anim)).toBe(decorTextureKey(PATH, anim));
  });

  it('differs from the whole-image key when an anim is given (distinct Phaser texture object)', () => {
    const anim = { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 };
    expect(decorTextureKey(PATH, anim)).not.toBe(decorTextureKey(PATH));
  });

  it('differs across distinct frameWidth/frameHeight pairs over the same path', () => {
    const a = decorTextureKey(PATH, { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 });
    const b = decorTextureKey(PATH, { frameWidth: 16, frameHeight: 16, frames: 8, fps: 8 });
    expect(a).not.toBe(b);
  });

  it('is unaffected by fps/frames — only the Phaser-load-relevant frame dimensions key the texture', () => {
    const a = decorTextureKey(PATH, { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 });
    const b = decorTextureKey(PATH, { frameWidth: 32, frameHeight: 48, frames: 6, fps: 12 });
    expect(a).toBe(b);
  });
});
