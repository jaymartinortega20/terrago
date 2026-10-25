import { TILE_SIZE } from './constants';
import type { Direction } from './types';

/**
 * Ground tiles. Each map row is a string; each character is a key in this legend.
 * Tall things (trees, buildings, fences...) are objects, not tiles, so they can be
 * depth-sorted against players.
 */
export const GROUND_TILES = {
  '.': { name: 'grass', solid: false },
  ',': { name: 'grass_tall', solid: false },
  '*': { name: 'flowers', solid: false },
  '=': { name: 'dirt_path', solid: false },
  ':': { name: 'cobblestone', solid: false },
  '_': { name: 'plaza', solid: false },
  's': { name: 'sand', solid: false },
  'd': { name: 'soil', solid: false },
  '~': { name: 'water', solid: true },
  'w': { name: 'shallow_water', solid: true },
  '#': { name: 'cliff', solid: true },
  'b': { name: 'bridge', solid: false },
  'c': { name: 'cave_floor', solid: false },
  'r': { name: 'cave_wall', solid: true },
  'f': { name: 'forest_floor', solid: false },
  'n': { name: 'snow', solid: false },
  'I': { name: 'ice_water', solid: true },
  'L': { name: 'lava', solid: true },
  'a': { name: 'ash', solid: false },
  'u': { name: 'mud', solid: false },
  'q': { name: 'swamp_water', solid: true },
  'k': { name: 'ruin_floor', solid: false },
  'h': { name: 'dune', solid: false },
} as const;

/** Tiles you can fish from (when facing them). */
export const FISHABLE_TILES = new Set(['~', 'w', 'I', 'L', 'q']);

export type GroundTileKey = keyof typeof GROUND_TILES;

export const PROP_TYPES = {
  tree_oak: { w: 1, h: 1, solid: true },
  tree_pine: { w: 1, h: 1, solid: true },
  tree_fruit: { w: 1, h: 1, solid: true },
  bush: { w: 1, h: 1, solid: true },
  rock: { w: 1, h: 1, solid: true },
  stump: { w: 1, h: 1, solid: true },
  fence_h: { w: 1, h: 1, solid: true },
  fence_v: { w: 1, h: 1, solid: true },
  lamp: { w: 1, h: 1, solid: true },
  sign: { w: 1, h: 1, solid: true },
  barrel: { w: 1, h: 1, solid: true },
  crate: { w: 1, h: 1, solid: true },
  well: { w: 2, h: 2, solid: true },
  fountain: { w: 4, h: 3, solid: true },
  market_stall: { w: 3, h: 2, solid: true },
  bench: { w: 2, h: 1, solid: true },
  notice_board: { w: 2, h: 1, solid: true },
  teleport_pad: { w: 3, h: 3, solid: false },
  flower_bed: { w: 2, h: 1, solid: false },
  hay_bale: { w: 1, h: 1, solid: true },
  scarecrow: { w: 1, h: 1, solid: true },
  tree_dead: { w: 1, h: 1, solid: true },
  tree_snow: { w: 1, h: 1, solid: true },
  tree_swamp: { w: 1, h: 1, solid: true },
  tree_ancient: { w: 1, h: 1, solid: true },
  cactus: { w: 1, h: 1, solid: true },
  crystal: { w: 1, h: 1, solid: true },
  stalagmite: { w: 1, h: 1, solid: true },
  ruin_pillar: { w: 1, h: 1, solid: true },
  bones: { w: 1, h: 1, solid: false },
  mushroom_big: { w: 1, h: 1, solid: true },
  reeds: { w: 1, h: 1, solid: false },
  ladder_down: { w: 1, h: 1, solid: false },
  ladder_up: { w: 1, h: 1, solid: false },
  mine_entrance: { w: 3, h: 2, solid: true },
  torch: { w: 1, h: 1, solid: true },
  dock_post: { w: 1, h: 1, solid: true },
  tent: { w: 2, h: 2, solid: true },
  campfire: { w: 1, h: 1, solid: true },
  furnace: { w: 2, h: 2, solid: true },
  anvil: { w: 1, h: 1, solid: true },
  workbench: { w: 2, h: 1, solid: true },
  cooking_pot: { w: 1, h: 1, solid: true },
  alchemy_table: { w: 2, h: 1, solid: true },
  mill: { w: 2, h: 2, solid: true },
  loom: { w: 2, h: 1, solid: true },
  enhance_altar: { w: 2, h: 1, solid: true },
  dungeon_gate: { w: 3, h: 2, solid: true },
} as const;

/** Crafting stations: props you stand next to and use. */
export const STATION_PROPS = ['furnace', 'anvil', 'workbench', 'cooking_pot', 'alchemy_table', 'mill', 'loom', 'enhance_altar'] as const;
export type StationType = (typeof STATION_PROPS)[number];

export type PropType = keyof typeof PROP_TYPES;

export interface BuildingDef {
  kind: 'building';
  id: string;
  /** Label shown on the sign above the door. */
  name: string;
  /** Tile coordinates of the top-left corner and size in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  roof: string;
  wall: string;
  /** Door column, relative to x. The door is on the bottom row. */
  doorX: number;
  /** Look of the building (the client picks a default by id when missing). */
  style?: BuildingStyle;
}

export type BuildingStyle = 'brick' | 'timber' | 'stone' | 'marble' | 'cottage' | 'castle';

export interface PropDef {
  kind: 'prop';
  type: PropType;
  x: number;
  y: number;
  /** Optional text for signs. */
  text?: string;
}

/** A gatherable resource (rock, tree, herb...). Definitions live in game-data nodes.json. */
export interface NodePlacement {
  id: string;
  type: string;
  x: number;
  y: number;
  solid: boolean;
}

export type MapObject = BuildingDef | PropDef;

export interface PortalDef {
  id: string;
  /** Trigger rectangle in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  to: string;
  /** Arrival position in tiles (centre of the tile). */
  toX: number;
  toY: number;
  toDir: Direction;
  label: string;
  /** 'self': enter your own instance of the target map (e.g. your homestead). */
  instance?: 'self';
}

export interface MapDef {
  id: string;
  name: string;
  /** Size in tiles. */
  width: number;
  height: number;
  tileSize: number;
  safeZone: boolean;
  music: string | null;
  spawn: { x: number; y: number; dir: Direction };
  tiles: string[];
  objects: MapObject[];
  portals: PortalDef[];
  /** Instanced maps exist once per owner (homesteads) instead of once for everyone. */
  instanced?: boolean;
  /** The ranked arena: entered only through matchmaking, never saved as a position. */
  arena?: boolean;
  /** Farm plot tile positions in unlock order (homesteads). */
  farmPlots?: [number, number][];
  /** Gatherable nodes (ore rocks, choppable trees, herbs...). */
  nodes?: NodePlacement[];
  /** Fish table used when fishing from water tiles here. */
  fishing?: string;
  /** Visual theme (ground palette, ambient tint). */
  theme?: 'meadow' | 'forest' | 'lake' | 'cave' | 'volcano' | 'snow' | 'desert' | 'swamp' | 'ruins' | 'peak';
  /** Recommended level range shown on entry. */
  levels?: [number, number];
  /** Where you respawn after dying here: map + tile. */
  respawn?: { mapId: string; x: number; y: number };
  /** Monster spawn areas. */
  spawns?: SpawnDef[];
  /** Homestead animal pen (tile rectangle). */
  pen?: { x: number; y: number; w: number; h: number };
  /** Dungeon id: an instanced map shared by your party; monsters don't respawn. */
  dungeon?: string;
}

export interface SpawnDef {
  monster: string;
  level: [number, number];
  count: number;
  /** Tile rectangle monsters spawn and wander in. */
  area: { x: number; y: number; w: number; h: number };
}

/** Tile -> pixel helpers. A position is the bottom-centre of an entity's feet. */
export function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 + 6 };
}

export function pixelToTile(px: number): number {
  return Math.floor(px / TILE_SIZE);
}

export function validateMapDef(map: MapDef): string[] {
  const errors: string[] = [];
  if (map.tiles.length !== map.height) errors.push(`${map.id}: expected ${map.height} rows, got ${map.tiles.length}`);
  map.tiles.forEach((row, y) => {
    if (row.length !== map.width) errors.push(`${map.id}: row ${y} has width ${row.length}, expected ${map.width}`);
    for (const ch of row) {
      if (!(ch in GROUND_TILES)) errors.push(`${map.id}: unknown tile '${ch}' on row ${y}`);
    }
  });
  for (const obj of map.objects) {
    const w = obj.kind === 'building' ? obj.w : PROP_TYPES[obj.type]?.w;
    const h = obj.kind === 'building' ? obj.h : PROP_TYPES[obj.type]?.h;
    if (w === undefined || h === undefined) {
      errors.push(`${map.id}: unknown object ${JSON.stringify(obj)}`);
      continue;
    }
    if (obj.x < 0 || obj.y < 0 || obj.x + w > map.width || obj.y + h > map.height) {
      errors.push(`${map.id}: object out of bounds ${JSON.stringify(obj)}`);
    }
  }
  return errors;
}
