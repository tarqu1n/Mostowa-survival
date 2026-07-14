import type Phaser from 'phaser';
import type { DecorAnim, DecorObject } from '../systems/mapFormat';
import { tileImageKey } from '../data/tileset';

/**
 * Shared decor sprite/texture resolution (plan 014 step 7b). Phaser-coupled (every exported function
 * takes a live `Phaser.Scene`) but otherwise dependency-light: only `Phaser` (types — `import type`,
 * so this module carries no Phaser runtime import of its own), `DecorObject`/`DecorAnim`
 * (`systems/mapFormat`, itself Phaser-free), and `tileImageKey` (`data/tileset`, also Phaser-free).
 * Deliberately NO import of `src/editor/catalog.ts` or any other `src/editor/` module — a
 * `DecorObject` carries every field this needs (its catalog `asset` id plus optional `region`/
 * `anim`), so `EditorScene.ts` and the step-11 game loader can call the exact same functions with no
 * divergent implementation and no catalog dependency baked into the shipped game bundle.
 *
 * Two-phase, mirroring `EditorScene`'s existing texture lifecycle (queue → `load.start()` → the
 * loader's COMPLETE event → bake/draw): `queueDecorTexture` queues the load during the queueing phase
 * (idempotent — skips a texture that's already resident, or already queued this batch when a `seen`
 * set is threaded through); once the loader has finished, `resolveDecorDraw` ensures the region
 * sub-frame or the anim exists and returns how to draw this decor instance. Both are keyed off the
 * same deterministic `decorTextureKey` so the two phases always agree on which texture they mean.
 */

/** How to draw a resolved decor: the whole loaded image, a named sub-frame cropped from it (a
 *  `region` decor), or a spritesheet texture + an `anims`-registered key to `.play()` (an `anim`
 *  decor). Exactly one of `region`/`anim` is ever set on a given `DecorObject` (mapFormat enforces
 *  the mutual exclusivity), so this is a plain discriminated union, not an approximation of one. */
export type DecorDraw =
  | { kind: 'whole'; key: string }
  | { kind: 'region'; key: string; frame: string }
  | { kind: 'anim'; key: string; animKey: string };

/**
 * Deterministic Phaser texture key for the sheet/image a decor needs, given its resolved pack-relative
 * `path` (the caller parses the `DecorObject.asset` catalog id — e.g. via the editor's
 * `parseAssetId` — since that string-splitting logic is editor-specific and this module must stay
 * catalog/editor-free; see module doc).
 *
 * A static crop (`region`) or a plain whole-image decor share the ordinary whole-image key
 * (`tileImageKey` — the same one `EditorScene`/`PreloadScene` already use for any standalone-image
 * tile/decor), so a cropped decor and an uncropped one referencing the same source PNG load it
 * exactly once. An animated decor gets its OWN key with the frame dimensions baked in: Phaser slices a
 * spritesheet texture at load time, so two different `frameWidth`/`frameHeight` pairs over the same
 * URL can't share one texture object the way two whole-image reads of the same URL can.
 */
export function decorTextureKey(path: string, anim?: DecorAnim): string {
  if (!anim) return tileImageKey(path);
  const sanitized = path.replace(/[^a-zA-Z0-9]+/g, '-');
  return `decoranimtex-${sanitized}-${anim.frameWidth}x${anim.frameHeight}`;
}

/**
 * Queue this decor's texture load if it isn't already resident. Pass the SAME `seen` set across a
 * whole queueing pass (mirrors `EditorScene.queueTextures`'s existing `addImage`/`addSheet` closures,
 * which this supersedes for decor) so multiple decor instances sharing a source, or a decor sharing a
 * source with a palette tile, never double-queue the same key within one batch — `textures.exists`
 * alone only catches a texture already loaded from a PRIOR batch, not one merely queued in this one.
 * Returns whether a load was actually queued; the caller is responsible for `scene.load.start()` and
 * awaiting the loader's COMPLETE event before drawing (unchanged from today's texture lifecycle).
 */
export function queueDecorTexture(
  scene: Phaser.Scene,
  obj: DecorObject,
  path: string,
  url: string,
  seen?: Set<string>,
): boolean {
  const key = decorTextureKey(path, obj.anim);
  if (scene.textures.exists(key) || seen?.has(key)) return false;
  seen?.add(key);
  if (obj.anim) {
    scene.load.spritesheet(key, url, {
      frameWidth: obj.anim.frameWidth,
      frameHeight: obj.anim.frameHeight,
    });
  } else {
    scene.load.image(key, url);
  }
  return true;
}

/**
 * Once `obj`'s texture is resident (after `queueDecorTexture`'s load, if any, has completed), ensure
 * the region sub-frame or the anim exists — idempotent, a second call for the same region/anim is a
 * no-op — and return how to draw it. `undefined` if the base texture isn't resident (caller skips
 * cleanly, matching every other "texture failed to load" path in this codebase).
 *
 * DEV-only content-drift guard (critique #3): `parseMap` is asset-blind — it validates a `region`'s
 * ints/positivity but can't know whether the sprite it once pointed at has since moved inside a
 * same-size sheet (only re-running `scripts/pixel-crawler/gen_regions.py` + a catalog regen can catch
 * that, and even that only catches a sheet that changed SIZE, not one whose content shuffled
 * internally at the same size). Once the real texture is loaded here, though, its actual pixel
 * dimensions are known — so a `region` that no longer fits inside them is the one drift symptom this
 * module CAN observe, and is worth a loud dev-only warning even though it can't catch every case.
 */
export function resolveDecorDraw(
  scene: Phaser.Scene,
  obj: DecorObject,
  path: string,
): DecorDraw | undefined {
  const key = decorTextureKey(path, obj.anim);
  if (!scene.textures.exists(key)) return undefined;

  if (obj.anim) {
    const { frameWidth, frameHeight, frames, fps } = obj.anim;
    const animKey = `decoranim:${obj.asset}:${frameWidth}x${frameHeight}@${fps}`;
    if (!scene.anims.exists(animKey)) {
      scene.anims.create({
        key: animKey,
        frames: scene.anims.generateFrameNumbers(key, { start: 0, end: frames - 1 }),
        frameRate: fps,
        repeat: -1,
      });
    }
    return { kind: 'anim', key, animKey };
  }

  if (obj.region) {
    const { x, y, w, h } = obj.region;
    const frameName = `r${x}_${y}_${w}_${h}`;
    const texture = scene.textures.get(key);
    if (!texture.has(frameName)) {
      if (import.meta.env.DEV) {
        const src = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
        const srcW = src.width;
        const srcH = src.height;
        if ((srcW > 0 && x + w > srcW) || (srcH > 0 && y + h > srcH)) {
          console.warn(
            `[decorSprites] decor "${obj.id}" (${obj.asset}) region {x:${x},y:${y},w:${w},h:${h}} ` +
              `exceeds the loaded sheet's real size (${srcW}x${srcH}) — the sheet may have changed ` +
              `since this map was authored. Re-run gen_regions.py + npm run assets:catalog, then ` +
              `re-place this decor.`,
          );
        }
      }
      texture.add(frameName, 0, x, y, w, h);
    }
    return { kind: 'region', key, frame: frameName };
  }

  return { kind: 'whole', key };
}
