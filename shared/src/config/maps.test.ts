import { describe, expect, it } from 'vitest';
import { MAPS, createTileGrid, type MapDef } from './maps.js';

function isWalkable(map: MapDef, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.collisionRows[y]?.[x] !== '#';
}

describe('map data integrity', () => {
  for (const map of Object.values(MAPS)) {
    describe(map.name, () => {
      it('has exactly `height` rows, each exactly `width` characters', () => {
        expect(map.collisionRows).toHaveLength(map.height);
        for (const row of map.collisionRows) {
          expect(row).toHaveLength(map.width);
        }
      });

      it('is fully bordered (no walk-off-the-edge gaps)', () => {
        for (let x = 0; x < map.width; x++) {
          expect(isWalkable(map, x, 0)).toBe(false);
          expect(isWalkable(map, x, map.height - 1)).toBe(false);
        }
        for (let y = 0; y < map.height; y++) {
          expect(isWalkable(map, 0, y)).toBe(false);
          expect(isWalkable(map, map.width - 1, y)).toBe(false);
        }
      });

      it('spawn point is walkable', () => {
        expect(isWalkable(map, map.spawnPoint.x, map.spawnPoint.y)).toBe(true);
      });

      it('waystone (if any) sits on a walkable tile', () => {
        if (map.waystone) {
          expect(isWalkable(map, map.waystone.x, map.waystone.y)).toBe(true);
        }
      });

      it('every NPC sits on a walkable tile', () => {
        for (const npc of map.npcs) {
          expect(isWalkable(map, npc.x, npc.y)).toBe(true);
        }
      });

      it('every portal trigger tile is walkable and points at a walkable tile on its target map', () => {
        for (const portal of map.portals) {
          expect(isWalkable(map, portal.at.x, portal.at.y)).toBe(true);
          const target = MAPS[portal.toMapId];
          expect(target).toBeDefined();
          if (target) {
            expect(isWalkable(target, portal.targetSpawn.x, portal.targetSpawn.y)).toBe(true);
          }
        }
      });

      it('every monster spawn area stays inside the map bounds', () => {
        for (const spawn of map.monsterSpawns) {
          expect(spawn.area.x).toBeGreaterThanOrEqual(0);
          expect(spawn.area.y).toBeGreaterThanOrEqual(0);
          expect(spawn.area.x + spawn.area.w).toBeLessThanOrEqual(map.width);
          expect(spawn.area.y + spawn.area.h).toBeLessThanOrEqual(map.height);
        }
      });

      it('every monster spawn area contains at least one walkable tile', () => {
        for (const spawn of map.monsterSpawns) {
          let anyWalkable = false;
          for (let y = spawn.area.y; y < spawn.area.y + spawn.area.h && !anyWalkable; y++) {
            for (let x = spawn.area.x; x < spawn.area.x + spawn.area.w; x++) {
              if (isWalkable(map, x, y)) {
                anyWalkable = true;
                break;
              }
            }
          }
          expect(anyWalkable).toBe(true);
        }
      });
    });
  }
});

describe('createTileGrid', () => {
  for (const map of Object.values(MAPS)) {
    it(`${map.name}: matches collisionRows for every tile, including out-of-bounds`, () => {
      const grid = createTileGrid(map);
      expect(grid.width).toBe(map.width);
      expect(grid.height).toBe(map.height);
      for (let y = -1; y <= map.height; y++) {
        for (let x = -1; x <= map.width; x++) {
          expect(grid.isWalkable(x, y)).toBe(isWalkable(map, x, y));
        }
      }
    });
  }
});
