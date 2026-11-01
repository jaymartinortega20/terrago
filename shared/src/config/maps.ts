/**
 * M1 map data: Map 1 (Oakhaven Sanctuary) and Map 2 (Whispering Fields), per
 * SPEC.md section 6. These are small generated placeholder layouts, not the
 * final hand-edited Tiled JSON the spec calls for — the server only consumes
 * the collision grid + spawn/portal/NPC/monster-spawn data below, so swapping
 * in real Tiled maps later touches no server logic (see docs/DECISIONS.md).
 */
import type { TileGrid } from '../pathfinding.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PortalDef {
  toMapId: string;
  at: { x: number; y: number };
  targetSpawn: { x: number; y: number };
  minLevel?: number;
}

export interface NpcDef {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface MonsterSpawnArea {
  monsterId: string;
  area: Rect;
  maxAlive: number;
  respawnMs: number;
}

export interface MapDef {
  id: string;
  name: string;
  /** null for the town hub, which has no combat. */
  levelBand: [number, number] | null;
  act: number;
  width: number;
  height: number;
  /** Row 0 = y=0 (top). Each row is `width` characters: '#' blocked, '.' walkable. */
  collisionRows: string[];
  spawnPoint: { x: number; y: number };
  waystone: { x: number; y: number } | null;
  npcs: NpcDef[];
  portals: PortalDef[];
  monsterSpawns: MonsterSpawnArea[];
}

/** Builds a bordered rectangular room with the given obstacle rects carved in as walls. */
function makeRoom(width: number, height: number, obstacles: Rect[]): string[] {
  const rows: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(border ? '#' : '.');
    }
    rows.push(row);
  }
  for (const o of obstacles) {
    for (let y = Math.max(0, o.y); y < Math.min(height, o.y + o.h); y++) {
      for (let x = Math.max(0, o.x); x < Math.min(width, o.x + o.w); x++) {
        rows[y]![x] = '#';
      }
    }
  }
  return rows.map((r) => r.join(''));
}

const OAKHAVEN_OBSTACLES: Rect[] = [
  { x: 3, y: 3, w: 3, h: 2 },
  { x: 14, y: 3, w: 3, h: 2 },
  { x: 3, y: 9, w: 3, h: 2 },
  { x: 14, y: 9, w: 3, h: 2 },
];

export const MAP_OAKHAVEN: MapDef = {
  id: 'map1',
  name: 'Oakhaven Sanctuary',
  levelBand: null,
  act: 1,
  width: 20,
  height: 14,
  collisionRows: makeRoom(20, 14, OAKHAVEN_OBSTACLES),
  spawnPoint: { x: 10, y: 7 },
  waystone: { x: 10, y: 6 },
  npcs: [
    { id: 'elder_fin', name: 'Elder Fin', x: 8, y: 6 },
    { id: 'blacksmith', name: 'Blacksmith', x: 17, y: 7 },
    { id: 'shopkeeper', name: 'Gear Shop', x: 3, y: 7 },
  ],
  portals: [{ toMapId: 'map2', at: { x: 18, y: 7 }, targetSpawn: { x: 2, y: 8 } }],
  monsterSpawns: [],
};

const FIELDS_OBSTACLES: Rect[] = [
  { x: 10, y: 5, w: 2, h: 2 },
  { x: 17, y: 10, w: 2, h: 2 },
];

export const MAP_WHISPERING_FIELDS: MapDef = {
  id: 'map2',
  name: 'Whispering Fields',
  levelBand: [1, 10],
  act: 1,
  width: 24,
  height: 16,
  collisionRows: makeRoom(24, 16, FIELDS_OBSTACLES),
  spawnPoint: { x: 2, y: 8 },
  waystone: null,
  npcs: [],
  portals: [{ toMapId: 'map1', at: { x: 1, y: 8 }, targetSpawn: { x: 17, y: 7 } }],
  monsterSpawns: [
    { monsterId: 'slime', area: { x: 3, y: 2, w: 8, h: 5 }, maxAlive: 6, respawnMs: 15_000 },
    { monsterId: 'slime', area: { x: 14, y: 8, w: 7, h: 5 }, maxAlive: 4, respawnMs: 15_000 },
  ],
};

export const MAPS: Record<string, MapDef> = {
  [MAP_OAKHAVEN.id]: MAP_OAKHAVEN,
  [MAP_WHISPERING_FIELDS.id]: MAP_WHISPERING_FIELDS,
};

/**
 * Adapts a MapDef's collisionRows into the TileGrid shape shared/pathfinding.ts
 * expects, so both the server (movement authority) and the client (path
 * preview, once built) run the exact same A* over the exact same grid.
 * Terrain only: NPC/other-entity tiles don't block movement (classic MMO
 * convention - you can walk through other characters and NPCs).
 */
export function createTileGrid(map: MapDef): TileGrid {
  return {
    width: map.width,
    height: map.height,
    isWalkable(x: number, y: number): boolean {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
      const row = map.collisionRows[y];
      if (!row) return false;
      return row[x] === '.';
    },
  };
}
