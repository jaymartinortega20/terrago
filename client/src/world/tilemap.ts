/**
 * Picks which generated tile texture (client/assets/manifest.json's
 * `tiles` entries) belongs at each (x, y) of a MapDef's collision grid,
 * and whether that tile should participate in y-sorting against
 * characters. Pure/no-Phaser so the selection logic itself is testable;
 * the actual Phaser.GameObjects.Image placement is a few lines in
 * WorldScene, which is the only part that needs a live Scene.
 */
import type { MapDef } from '@terago/shared';

/** Deterministic per-tile pseudo-random value in [0, 1) - stable across
 * re-renders (no Date.now()/Math.random()), so the map doesn't visually
 * "shuffle" every time the scene rebuilds (e.g. on a portal crossing back
 * to a map already seen this session). Not the same PRNG as the asset
 * generators (client/src/util/prng.ts) - that one is a seeded sequence
 * generator for drawing a single texture; this is a one-shot hash over
 * (x, y), which is what picking a texture *per grid cell* actually needs. */
function hashTile(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function pick(keys: readonly string[], x: number, y: number, salt: number): string {
  const index = Math.floor(hashTile(x, y, salt) * keys.length) % keys.length;
  return keys[index]!;
}

/**
 * Every map in M1 is one of these two biomes. Repeating an entry weights
 * it more heavily without a separate probability table - plain floor/
 * grass should dominate, with the path/dirt variant as an occasional
 * accent (SPEC.md's "go beyond the minimum on game feel", applied as
 * cheap visual texture rather than meaningful map data, since MapDef
 * carries no actual path-routing information to place these from).
 */
const OAKHAVEN_FLOOR_KEYS = [
  'tile_oakhaven_floor_0',
  'tile_oakhaven_floor_1',
  'tile_oakhaven_floor_2',
  'tile_oakhaven_floor_3',
  'tile_oakhaven_floor_0',
  'tile_oakhaven_floor_1',
  'tile_oakhaven_path_0',
  'tile_oakhaven_path_1',
] as const;

const OAKHAVEN_OBSTACLE_KEYS = ['tile_obstacle_rock_0', 'tile_obstacle_rock_1'] as const;

const FIELDS_GRASS_KEYS = [
  'tile_fields_grass_0',
  'tile_fields_grass_1',
  'tile_fields_grass_2',
  'tile_fields_grass_3',
  'tile_fields_grass_4',
  'tile_fields_grass_0',
  'tile_fields_grass_1',
  'tile_fields_dirt_0',
] as const;

const FIELDS_OBSTACLE_KEYS = ['tile_obstacle_bush_0', 'tile_obstacle_bush_1'] as const;

export type MapTheme = 'oakhaven' | 'fields';

/** M1 has exactly two maps, one per biome - this'll need to become real
 * per-map theme data (MapDef has no theme field yet) once M2 adds more
 * biomes than "town" and "field". */
export function themeFor(map: Pick<MapDef, 'id'>): MapTheme {
  return map.id === 'map1' ? 'oakhaven' : 'fields';
}

function isWaystoneTile(map: MapDef, x: number, y: number): boolean {
  return map.waystone !== null && map.waystone.x === x && map.waystone.y === y;
}

function isBlockedTile(map: MapDef, x: number, y: number): boolean {
  return map.collisionRows[y]?.[x] === '#';
}

/** The manifest texture key for one grid cell. */
export function tileKeyFor(map: MapDef, x: number, y: number): string {
  const theme = themeFor(map);
  if (isWaystoneTile(map, x, y)) return `tile_waystone_${theme}`;
  if (isBlockedTile(map, x, y)) {
    return theme === 'oakhaven' ? pick(OAKHAVEN_OBSTACLE_KEYS, x, y, 1) : pick(FIELDS_OBSTACLE_KEYS, x, y, 1);
  }
  return theme === 'oakhaven' ? pick(OAKHAVEN_FLOOR_KEYS, x, y, 2) : pick(FIELDS_GRASS_KEYS, x, y, 2);
}

/**
 * Whether this tile is tall enough to need y-sorting against characters
 * (SPEC.md section 2: "y-sorting so characters pass in front of and
 * behind objects") - obstacles and the Waystone read as solid 3D-ish
 * objects even though the Waystone tile itself is walkable terrain, while
 * plain floor/grass is flat ground a character always walks fully over.
 */
export function isTallTile(map: MapDef, x: number, y: number): boolean {
  return isWaystoneTile(map, x, y) || isBlockedTile(map, x, y);
}
