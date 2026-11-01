/**
 * Validates move intents against the tile grid using shared/pathfinding
 * (docs/ARCHITECTURE.md). Pure motion primitives only - no networking, no
 * knowledge of characters/monsters/combat, so they're trivially unit
 * testable and reusable for both click-to-move and WASD.
 */
import {
  createTileGrid,
  findPath,
  type Facing,
  type MapDef,
  type TileCoord,
  type TileGrid,
} from '@terago/shared';

export interface MovingEntity {
  x: number;
  y: number;
  facing: Facing;
  /** Remaining click-to-move waypoints, nearest first, never including the
   * entity's own current tile (setMoveTo drops it immediately). */
  path: TileCoord[] | null;
  /** Unit-ish direction from the most recent move:dir intent ({0,0} is sent
   * as null, meaning "stop"). Cleared whenever a click-to-move path is set. */
  heldDirection: { dx: number; dy: number } | null;
}

const ARRIVAL_EPSILON_TILES = 0.001;

/** 4-way facing from a movement vector. Ties (perfect diagonals) favor
 * vertical, since a paper-doll sprite only has down/up/left/right frames. */
export function facingFromVector(dx: number, dy: number): Facing | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'down' : 'up';
  return dx > 0 ? 'right' : 'left';
}

/** Computes an A* path to `target` on `map` and installs it on the entity,
 * replacing any held WASD direction. Returns false (leaving the entity's
 * motion untouched) if the target is unreachable or off the walkable grid. */
export function setMoveTo(entity: MovingEntity, map: MapDef, target: TileCoord): boolean {
  const grid = createTileGrid(map);
  const start: TileCoord = { x: Math.round(entity.x), y: Math.round(entity.y) };
  const path = findPath(grid, start, target);
  if (!path) return false;
  entity.heldDirection = null;
  // findPath always includes the start tile as element 0; drop it so the
  // entity is always walking toward "the next tile", never "here".
  entity.path = path.length > 1 ? path.slice(1) : null;
  return true;
}

/** Sets (or, for {0,0}, clears) the entity's held WASD direction, canceling
 * any in-progress click-to-move path per SPEC.md section 7 ("W A S D ...
 * cancels any click-to-move path"). */
export function setMoveDir(entity: MovingEntity, dx: number, dy: number): void {
  entity.path = null;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  entity.heldDirection = sx === 0 && sy === 0 ? null : { dx: sx, dy: sy };
}

export function stopMovement(entity: MovingEntity): void {
  entity.path = null;
  entity.heldDirection = null;
}

function isPointWalkable(grid: TileGrid, x: number, y: number): boolean {
  // Fractional WASD positions are collision-checked against the tile they're
  // nearest to: tile (ix, iy) owns the continuous region [ix-0.5, ix+0.5) on
  // each axis, so Math.round maps a point back to its owning tile.
  return grid.isWalkable(Math.round(x), Math.round(y));
}

/** Advances one moving entity by `dtSeconds` at `speedTilesPerSec`, mutating
 * x/y/facing/path/heldDirection in place. A path is followed waypoint by
 * waypoint (already collision-free, since A* produced it); WASD movement is
 * collision-checked per axis so the entity slides along a wall instead of
 * sticking the moment a diagonal nudge would clip a corner. */
export function stepMovement(
  entity: MovingEntity,
  map: MapDef,
  speedTilesPerSec: number,
  dtSeconds: number
): void {
  const distance = speedTilesPerSec * dtSeconds;
  if (distance <= 0) return;

  if (entity.path && entity.path.length > 0) {
    stepAlongPath(entity, distance);
    return;
  }

  if (entity.heldDirection) {
    const { dx, dy } = entity.heldDirection;
    const len = Math.hypot(dx, dy) || 1;
    const grid = createTileGrid(map);
    moveWithAxisCollision(entity, grid, (dx / len) * distance, (dy / len) * distance);
    const facing = facingFromVector(dx, dy);
    if (facing) entity.facing = facing;
  }
}

function stepAlongPath(entity: MovingEntity, distance: number): void {
  let remaining = distance;
  while (remaining > ARRIVAL_EPSILON_TILES && entity.path && entity.path.length > 0) {
    const waypoint = entity.path[0]!;
    const dx = waypoint.x - entity.x;
    const dy = waypoint.y - entity.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= ARRIVAL_EPSILON_TILES) {
      entity.x = waypoint.x;
      entity.y = waypoint.y;
      entity.path.shift();
      continue;
    }

    const facing = facingFromVector(dx, dy);
    if (facing) entity.facing = facing;

    if (dist <= remaining) {
      entity.x = waypoint.x;
      entity.y = waypoint.y;
      remaining -= dist;
      entity.path.shift();
    } else {
      const ratio = remaining / dist;
      entity.x += dx * ratio;
      entity.y += dy * ratio;
      remaining = 0;
    }
  }
  if (entity.path && entity.path.length === 0) entity.path = null;
}

function moveWithAxisCollision(entity: MovingEntity, grid: TileGrid, dx: number, dy: number): void {
  const newX = entity.x + dx;
  if (isPointWalkable(grid, newX, entity.y)) {
    entity.x = newX;
  }
  const newY = entity.y + dy;
  if (isPointWalkable(grid, entity.x, newY)) {
    entity.y = newY;
  }
}

export function distanceTiles(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
