import { describe, it, expect } from 'vitest';
import { MANIFEST, WORLD, WORLD_INDEX, originOf, loadMapFile } from '../mapRuntime';

describe('mapRuntime', () => {
  it('eager-parses MANIFEST and WORLD at module load', () => {
    expect(MANIFEST.schemaVersion).toBe(1);
    expect(MANIFEST.maps.some((m) => m.id === 'the-moon')).toBe(true);
    expect(WORLD.schemaVersion).toBe(1);
  });

  it('builds a WORLD_INDEX from the eager manifest (no map files loaded)', () => {
    // Nothing is placed in world.json/manifest.json, so no tile resolves to a map.
    expect(WORLD_INDEX.mapAt(0, 0)).toBeNull();
  });

  it("originOf('the-moon') is {col:0,row:0} — the start map must sit at the world origin", () => {
    // INVARIANT, not just a value check. GameScene.buildWorld spawns the player at SPAWN_TILE and
    // sizes the pathfinder grid (gridDims) assuming the start map is at origin {0,0}; nodes are also
    // placed at raw local tiles. Placing the-moon anywhere else in the World view shifts the world
    // but NOT the nodes/pathfinder bounds, so trees render off-screen and every path fails (the
    // player spawns outside gridDims). Keep the-moon UNPLACED: if this goes red, a placement snuck
    // into world.json and would ship a broken game — fix the data, don't relax the test.
    expect(WORLD.placements.some((p) => p.mapId === 'the-moon')).toBe(false);
    expect(originOf('the-moon')).toEqual({ col: 0, row: 0 });
  });

  it('originOf returns {col:0,row:0} for an unknown map id too', () => {
    expect(originOf('does-not-exist')).toEqual({ col: 0, row: 0 });
  });

  it("loadMapFile('the-moon') resolves a parsed MapFile matching the manifest entry", async () => {
    const map = await loadMapFile('the-moon');
    expect(map.meta.id).toBe('the-moon');
    expect(map.meta.width).toBe(245);
    expect(map.meta.height).toBe(280);
    const manifestEntry = MANIFEST.maps.find((m) => m.id === 'the-moon');
    expect(manifestEntry).toBeDefined();
    expect(map.meta.width).toBe(manifestEntry?.width);
    expect(map.meta.height).toBe(manifestEntry?.height);
    expect(map.meta.name).toBe(manifestEntry?.name);
  });

  it('loadMapFile rejects an id with no matching map file', async () => {
    await expect(loadMapFile('does-not-exist')).rejects.toThrow(/no map file found/);
  });
});
