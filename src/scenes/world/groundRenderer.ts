import Phaser from 'phaser';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, GROUND_CHUNK_ROWS } from '../../config';
import { ACTIVE_TILESET, resolveTile, pickWeighted } from '../../data/tileset';

/**
 * Ground pass: weighted-random grass variants per tile so the common variants dominate and rarer
 * ones just sprinkle in (vs a flat fill or an obvious checkerboard).
 *
 * Baked into RenderTextures rather than ~900 separate tile images. Individually-placed frames
 * of a shared spritesheet bleed at fractional zoom (e.g. 150%): a 16px source tile scaled to 24px
 * samples just past its atlas cell and picks up a neighbouring (dark) frame, showing as thin
 * vertical seams that crawl as the camera scrolls. Baked side-by-side at integer 1:1, every tile's
 * neighbour is the actual adjacent grass — no cross-frame bleed, and one object means no inter-tile
 * gaps either. The camera then scales the baked texture, which nearest-samples cleanly.
 *
 * The bake is split into vertical chunks of `GROUND_CHUNK_ROWS` tile-rows (stacked, tile-aligned,
 * drawn 1:1 so their edges are seamless adjacent grass). A single map-tall texture (1280px after
 * the map doubled) grew faint evenly-spaced dark horizontal lines toward the bottom on real mobile
 * GPUs — a NEAREST-at-`mediump` texel-rounding artifact whose error grows with texture height.
 * Capping chunk height keeps that error sub-texel so no row is mis-sampled. See GROUND_CHUNK_ROWS.
 */
export function drawGround(scene: Phaser.Scene): void {
  const groundVariants = ACTIVE_TILESET.tiles.ground.map((g) => ({
    ...resolveTile(g.source),
    weight: g.weight,
  }));
  const cols = Math.ceil(MAP_WIDTH / TILE_SIZE);
  const rows = Math.ceil(MAP_HEIGHT / TILE_SIZE);
  for (let startRow = 0; startRow < rows; startRow += GROUND_CHUNK_ROWS) {
    const chunkRows = Math.min(GROUND_CHUNK_ROWS, rows - startRow);
    const rt = scene.add
      .renderTexture(0, startRow * TILE_SIZE, cols * TILE_SIZE, chunkRows * TILE_SIZE)
      .setOrigin(0, 0)
      .setDepth(0);
    // Batch each chunk's tile draws into ONE flush (beginDraw…endDraw). A per-tile drawFrame()
    // flushes the GPU each call — fine at ~900 tiles, but the doubled map is cols*rows ≈ 3600, and
    // per-call flushes on the headless software renderer took ~25s. Batched, it's one pass per chunk.
    rt.beginDraw();
    for (let row = 0; row < chunkRows; row++) {
      for (let col = 0; col < cols; col++) {
        const pick = pickWeighted(groundVariants);
        rt.batchDrawFrame(pick.key, pick.frame, col * TILE_SIZE, row * TILE_SIZE);
      }
    }
    rt.endDraw();
    rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp pixels when the camera scales it
  }
}
