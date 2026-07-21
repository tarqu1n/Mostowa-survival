import { NODES } from '../../data/nodes';
import { tileKey } from '../../systems/grid';
import { findPath, type Cell, type Dims } from '../../systems/pathfind';
import type { ParsedNodeDef } from '../../systems/nodeDefs';
import type { NpcCharacter } from '../../entities/NpcCharacter';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link DevWorldTools} needs but doesn't own — GameScene supplies these as closures
 * over its own private fields/managers at construction (plan 013/015 coupling rules: managers get
 * narrow interfaces, never a direct manager↔manager edge — the scene mediates). The node/enemy/
 * companion seams route through ResourceNodeManager/EnemyManager/CompanionManager via the scene.
 */
export interface DevWorldToolsDeps {
  /** Clear the task queue + stop the worker (GameScene.cancelAll) — drops harvest orders that
   *  reference the nodes a randomise is about to destroy. */
  cancelAll(): void;
  /** Stop node-fx tweens + destroy fell clones BEFORE their node sprites are freed (NodeFxManager.reset). */
  resetNodeFx(): void;
  /** Destroy every resource node GameObject + reset the array (ResourceNodeManager.clearAll). */
  clearNodes(opts: { resetIds: boolean }): void;
  /** Destroy every enemy GameObject + reset the array (EnemyManager.clearAll). */
  clearEnemies(opts: { resetIds: boolean }): void;
  /** Spawn a resource node at a tile (ResourceNodeManager.addNode). */
  addNode(def: ParsedNodeDef, col: number, row: number): void;
  /** Spawn an enemy at a tile (EnemyManager.addEnemy). */
  addEnemy(id: string, col: number, row: number): void;
  /** The player's current tile — the spawn/scatter anchor. */
  playerTile(): Cell;
  /** Grid bounds for placement checks (the scene's `gridDims`). */
  dims(): Dims;
  /** Pathfinding walkability predicate (the scene's `isBlocked`). */
  isBlocked(col: number, row: number): boolean;
  /** True if a completed wall occupies the tile (BuildManager.isOccupied). */
  isOccupied(col: number, row: number): boolean;
  /** True if an unbuilt blueprint covers the tile (BuildManager.hasSiteTile). */
  hasSiteTile(col: number, row: number): boolean;
  /** The single AI companion, or null when none is spawned (CompanionManager.get()). */
  companion(): NpcCharacter | null;
  /** Spawn the companion at a tile (CompanionManager.spawn). */
  spawnCompanion(col: number, row: number): NpcCharacter;
}

/**
 * Dev-only world tools — the DEV-menu world scatter/spawn seams + the scenario-reset primitive, moved
 * verbatim out of GameScene (behavior-preserving split). GameScene wires the dev-menu bus events
 * (`debug:randomise`/`debug:spawnEnemy`/`debug:spawnNpc`) to these directly, and the DEV test API's
 * `resetTreesAndEnemies` seam routes here.
 *
 * **Stateless — deliberately no `once(SHUTDOWN)` teardown** (mirrors ScenePicker): it holds only the
 * two constructor params, both scene-owned references re-supplied fresh on every (re)start, so there is
 * nothing for a SHUTDOWN hook to clean up. The GameObjects it mutates are owned by the node/enemy/
 * companion managers, which each wire their own teardown.
 */
export class DevWorldTools {
  // Takes `scene` for parity with the `(scene, deps)` manager contract even though every seam it needs
  // is a dep closure (it never reaches scene.add/time/etc directly) — hence the underscore.
  constructor(
    _scene: GameScene,
    private readonly deps: DevWorldToolsDeps,
  ) {}

  /** Destroy every resource node + enemy GameObject and reset both arrays + id counters — the shared
   *  preamble of a full world reset (used by the DEV-only scenario reset via
   *  TestApiDeps.resetTreesAndEnemies; mirrors randomiseWorld's own calls below, which pass
   *  `resetIds: false` since a dev-menu scatter has no need for ids restarting at 0). */
  resetTreesAndEnemies(): void {
    this.deps.resetNodeFx(); // stop node-fx tweens + destroy fell clones BEFORE their node sprites are freed
    this.deps.clearNodes({ resetIds: true });
    this.deps.clearEnemies({ resetIds: true });
  }

  /**
   * Dev menu: clear the scattered world — every resource node and enemy — then scatter a fresh
   * random batch on empty tiles: a mix of trees/rocks/bushes (trees weighted so wood stays plentiful)
   * plus a pack of enemies. The player's own walls/blueprints are left standing (only `occupied`/`siteTiles`
   * are read, never cleared). Enemies keep a few tiles clear of the player so a randomise never spawns
   * an instant bite. Wired to the dev-menu Randomise button.
   */
  randomiseWorld(): void {
    this.deps.cancelAll(); // drop harvest orders that reference the nodes we're about to destroy
    this.deps.resetNodeFx(); // stop node-fx tweens + destroy fell clones BEFORE their node sprites are freed
    this.deps.clearNodes({ resetIds: false }); // keeps its id counter running (pre-existing)
    this.deps.clearEnemies({ resetIds: false }); // same — id counter keeps running (pre-existing)

    const dims = this.deps.dims();
    const pt = this.deps.playerTile();
    const used = new Set<string>([tileKey(pt.col, pt.row)]);
    // Pick a random empty tile (in bounds, not a wall/blueprint/already-used), at least `minPlayerDist`
    // tiles (Chebyshev) from the player. Returns null if it can't find one within the attempt budget.
    const pickTile = (minPlayerDist: number): Cell | null => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const col = Math.floor(Math.random() * dims.cols);
        const row = Math.floor(Math.random() * dims.rows);
        const key = tileKey(col, row);
        if (used.has(key) || this.deps.isOccupied(col, row) || this.deps.hasSiteTile(col, row))
          continue;
        if (Math.max(Math.abs(col - pt.col), Math.abs(row - pt.row)) < minPlayerDist) continue;
        used.add(key);
        return { col, row };
      }
      return null;
    };

    const nodePool = [NODES.tree, NODES.tree, NODES.tree, NODES.rock, NODES.berryBush];
    const nodeCount = 24 + Math.floor(Math.random() * 25); // 24..48
    for (let i = 0; i < nodeCount; i++) {
      const tile = pickTile(0);
      if (!tile) break;
      this.deps.addNode(nodePool[Math.floor(Math.random() * nodePool.length)], tile.col, tile.row);
    }

    const enemyCount = 8 + Math.floor(Math.random() * 9); // 8..16
    for (let i = 0; i < enemyCount; i++) {
      const tile = pickTile(6); // keep enemies clear of the player's tile
      if (!tile) break;
      this.deps.addEnemy('kidZombie', tile.col, tile.row);
    }
  }

  /**
   * Dev menu: drop a single enemy right beside the player so there's always something to fight-test
   * on demand — the quick counterpart to Randomise's scatter. Scans outward in Chebyshev rings from
   * the player's tile (starting at distance 2, so it never lands on or directly touching the player)
   * up to a small cap, taking the first empty, walkable, unoccupied tile it finds. No-ops if the
   * player is boxed in with no clear tile in range. Wired to the dev-menu Spawn Enemy button.
   */
  spawnEnemyNearPlayer(): void {
    // The boar is the default dev spawn (plan 035b Step 4) — fighting it exercises the full loop:
    // 4-way facing, the Attack-anim telegraph, melee, bow, and the HP bar. The skeleton stays
    // reachable via scenarios (the combat/monster e2e specs) as a regression anchor.
    const t = this.firstSpawnableTileNearPlayer();
    if (t) this.deps.addEnemy('boar', t.col, t.row);
  }

  /**
   * First empty, walkable, unoccupied tile near the player — scanned outward in Chebyshev rings from
   * distance 2 (so it never lands on or directly touching the player) up to a small cap. Returns null
   * if the player is boxed in with no clear tile in range. Shared by the dev spawn seams.
   */
  private firstSpawnableTileNearPlayer(): Cell | null {
    const dims = this.deps.dims();
    const pt = this.deps.playerTile();
    const canSpawn = (col: number, row: number): boolean =>
      col >= 0 &&
      row >= 0 &&
      col < dims.cols &&
      row < dims.rows &&
      !this.deps.isOccupied(col, row) &&
      !this.deps.hasSiteTile(col, row) &&
      !this.deps.isBlocked(col, row);

    // Walk out ring by ring; the first empty tile on the nearest ring wins.
    for (let dist = 2; dist <= 8; dist++) {
      for (let col = pt.col - dist; col <= pt.col + dist; col++) {
        for (let row = pt.row - dist; row <= pt.row + dist; row++) {
          if (Math.max(Math.abs(col - pt.col), Math.abs(row - pt.row)) !== dist) continue; // ring edge only
          if (canSpawn(col, row)) return { col, row };
        }
      }
    }
    return null;
  }

  /**
   * Dev menu: spawn the companion Rogue near the player and hand it a path walking back toward the
   * player, so the sprite (idle/walk/death anims) and the walk can be eyeballed on demand. Routes
   * through {@link DevWorldToolsDeps.spawnCompanion} (CompanionManager owns the single companion);
   * reachable from the console via `window.game.events.emit('debug:spawnNpc')` (wired in wireBus,
   * mirroring `debug:spawnEnemy`). No-ops if a companion is already present (one at a time) or the
   * player is boxed in.
   */
  spawnNpcNearPlayer(): void {
    if (this.deps.companion()) return; // one companion at a time — no-op if already spawned
    const t = this.firstSpawnableTileNearPlayer();
    if (!t) return;
    const npc = this.deps.spawnCompanion(t.col, t.row);
    const path = findPath(t, this.deps.playerTile(), this.deps.isBlocked, this.deps.dims());
    if (path) {
      npc.path = path;
      npc.pathIndex = 0;
    }
  }
}
