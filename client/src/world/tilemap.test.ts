import { describe, expect, it } from 'vitest';
import { MAP_OAKHAVEN, MAP_WHISPERING_FIELDS } from '@terago/shared';
import { listAllAssetEntries } from '../assets/manifest.js';
import { isTallTile, themeFor, tileKeyFor } from './tilemap.js';

const knownKeys = new Set(listAllAssetEntries().map((e) => e.key));

function forEveryCell(map: typeof MAP_OAKHAVEN, fn: (x: number, y: number) => void): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) fn(x, y);
  }
}

describe('themeFor', () => {
  it('maps map1 to oakhaven and anything else to fields', () => {
    expect(themeFor(MAP_OAKHAVEN)).toBe('oakhaven');
    expect(themeFor(MAP_WHISPERING_FIELDS)).toBe('fields');
  });
});

describe('tileKeyFor', () => {
  it('returns a key that actually exists in the generated manifest, for every cell of both M1 maps', () => {
    for (const map of [MAP_OAKHAVEN, MAP_WHISPERING_FIELDS]) {
      forEveryCell(map, (x, y) => {
        const key = tileKeyFor(map, x, y);
        expect(knownKeys.has(key), `${map.id} (${x},${y}) -> unknown key "${key}"`).toBe(true);
      });
    }
  });

  it('is deterministic for the same cell', () => {
    expect(tileKeyFor(MAP_OAKHAVEN, 5, 5)).toBe(tileKeyFor(MAP_OAKHAVEN, 5, 5));
  });

  it("picks the themed waystone key at Oakhaven's waystone tile", () => {
    const { x, y } = MAP_OAKHAVEN.waystone!;
    expect(tileKeyFor(MAP_OAKHAVEN, x, y)).toBe('tile_waystone_oakhaven');
  });

  it('picks a rock obstacle key for a blocked Oakhaven tile', () => {
    // (0,0) is always border, always blocked, for every M1 map.
    expect(tileKeyFor(MAP_OAKHAVEN, 0, 0)).toMatch(/^tile_obstacle_rock_/);
  });

  it('picks a bush obstacle key for a blocked Whispering Fields tile', () => {
    expect(tileKeyFor(MAP_WHISPERING_FIELDS, 0, 0)).toMatch(/^tile_obstacle_bush_/);
  });

  it('picks a plain floor/grass key for an ordinary walkable tile', () => {
    const { x, y } = MAP_OAKHAVEN.spawnPoint;
    expect(tileKeyFor(MAP_OAKHAVEN, x, y)).toMatch(/^tile_oakhaven_(floor|path)_/);
  });
});

describe('isTallTile', () => {
  it('is true for the Waystone tile even though it is walkable terrain', () => {
    const { x, y } = MAP_OAKHAVEN.waystone!;
    expect(tileKeyFor(MAP_OAKHAVEN, x, y)).not.toContain('obstacle'); // sanity: walkable, not blocked
    expect(isTallTile(MAP_OAKHAVEN, x, y)).toBe(true);
  });

  it('is true for a blocked/obstacle tile', () => {
    expect(isTallTile(MAP_OAKHAVEN, 0, 0)).toBe(true);
  });

  it('is false for plain walkable ground', () => {
    const { x, y } = MAP_OAKHAVEN.spawnPoint;
    expect(isTallTile(MAP_OAKHAVEN, x, y)).toBe(false);
  });
});
