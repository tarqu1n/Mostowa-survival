/**
 * Data-driven content types. Items, resource nodes, and buildables are plain data
 * (see src/data/*.ts); adding content means editing those records, not the systems.
 */

/** An inventory item. `color` is the placeholder icon/rect colour (hex number). */
export interface ItemDef {
  id: string;
  name: string;
  color: number;
}

/** A harvestable world node (e.g. a tree). Yields an item per hit until depleted, then regrows. */
export interface ResourceNodeDef {
  id: string;
  name: string;
  maxHp: number;
  woodItemId: string;
  woodPerHit: number;
  regrowMs: number;
  color: number;
  stumpColor: number;
}

/** A placeable structure. `cost` maps item id → quantity consumed on build. */
export interface BuildableDef {
  id: string;
  name: string;
  cost: Record<string, number>;
  color: number;
}
