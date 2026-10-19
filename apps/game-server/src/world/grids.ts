import { npcsForMap } from '@terrago/game-data';
import { buildCollisionGrid, type CollisionGrid, type MapDef } from '@terrago/shared';

const cache = new Map<string, CollisionGrid>();

/** Collision grid for a map, with NPC tiles marked solid. Same inputs the client uses. */
export function collisionGridFor(map: MapDef): CollisionGrid {
  let grid = cache.get(map.id);
  if (!grid) {
    grid = buildCollisionGrid(
      map,
      npcsForMap(map.id).map((n) => ({ x: n.x, y: n.y })),
    );
    cache.set(map.id, grid);
  }
  return grid;
}
