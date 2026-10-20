import { PLAYER_BODY } from './constants';
import { GROUND_TILES, PROP_TYPES, type GroundTileKey, type MapDef, type PropType } from './map';

/** Solid but low: you can shoot over these. */
const LOW_PROPS = new Set<PropType>(['fence_h', 'fence_v', 'bench', 'crate', 'barrel', 'hay_bale', 'anvil', 'campfire', 'dock_post', 'cooking_pot', 'rock', 'stump', 'bush', 'sign']);

/**
 * Tile-based collision. Built identically on client (for prediction) and
 * server (authoritative), from the same map data.
 */
export class CollisionGrid {
  readonly pixelWidth: number;
  readonly pixelHeight: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly tileSize: number,
    private readonly solid: Uint8Array,
    /** Tiles that block arrows and spells (walls, buildings, trees, rocks — not water or fences). */
    private readonly sight: Uint8Array = solid,
  ) {
    this.pixelWidth = width * tileSize;
    this.pixelHeight = height * tileSize;
  }

  isSolidTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    return this.solid[ty * this.width + tx] === 1;
  }

  /** True if the pixel rectangle [left,right) x [top,bottom) touches a solid tile or leaves the map. */
  rectBlocked(left: number, top: number, right: number, bottom: number): boolean {
    if (left < 0 || top < 0 || right > this.pixelWidth || bottom > this.pixelHeight) return true;
    const ts = this.tileSize;
    const tx0 = Math.floor(left / ts);
    const ty0 = Math.floor(top / ts);
    const tx1 = Math.floor((right - 1e-6) / ts);
    const ty1 = Math.floor((bottom - 1e-6) / ts);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.isSolidTile(tx, ty)) return true;
      }
    }
    return false;
  }

  blocksSight(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    return this.sight[ty * this.width + tx] === 1;
  }

  /** Can a ranged attack travel from (x0,y0) to (x1,y1)? The start and end tiles never block. */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const ts = this.tileSize;
    const s0 = Math.floor(x0 / ts) + ',' + Math.floor(y0 / ts);
    const s1 = Math.floor(x1 / ts) + ',' + Math.floor(y1 / ts);
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
    for (let i = 1; i < steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      const tx = Math.floor(x / ts);
      const ty = Math.floor(y / ts);
      const k = tx + ',' + ty;
      if (k === s0 || k === s1) continue;
      if (this.blocksSight(tx, ty)) return false;
    }
    return true;
  }

  /** Does a player whose feet are at (x, y) overlap anything solid? */
  bodyBlocked(x: number, y: number): boolean {
    return this.rectBlocked(x - PLAYER_BODY.halfWidth, y - PLAYER_BODY.height, x + PLAYER_BODY.halfWidth, y);
  }
}

/**
 * Build the collision grid for a map. `blockers` are extra solid tiles
 * (e.g. NPC positions) supplied by the caller.
 */
export function buildCollisionGrid(map: MapDef, blockers: { x: number; y: number }[] = []): CollisionGrid {
  const solid = new Uint8Array(map.width * map.height);
  const sight = new Uint8Array(map.width * map.height);
  const mark = (tx: number, ty: number, blocksSight = false) => {
    if (tx >= 0 && ty >= 0 && tx < map.width && ty < map.height) {
      solid[ty * map.width + tx] = 1;
      if (blocksSight) sight[ty * map.width + tx] = 1;
    }
  };

  for (let y = 0; y < map.height; y++) {
    const row = map.tiles[y] ?? '';
    for (let x = 0; x < map.width; x++) {
      const key = (row[x] ?? '.') as GroundTileKey;
      if (GROUND_TILES[key]?.solid) mark(x, y, key === '#' || key === 'r');
    }
  }

  for (const obj of map.objects) {
    if (obj.kind === 'building') {
      for (let y = obj.y; y < obj.y + obj.h; y++) for (let x = obj.x; x < obj.x + obj.w; x++) mark(x, y, true);
    } else {
      const def = PROP_TYPES[obj.type];
      if (!def.solid) continue;
      const tall = !LOW_PROPS.has(obj.type);
      for (let y = obj.y; y < obj.y + def.h; y++) for (let x = obj.x; x < obj.x + def.w; x++) mark(x, y, tall);
    }
  }

  for (const n of map.nodes ?? []) if (n.solid) mark(n.x, n.y, true);
  for (const b of blockers) mark(b.x, b.y);

  return new CollisionGrid(map.width, map.height, map.tileSize, solid, sight);
}
