import { describe, expect, it } from 'vitest';
import { MAPS, type Facing } from '@terago/shared';
import {
  distanceTiles,
  facingFromVector,
  setMoveDir,
  setMoveTo,
  stepMovement,
  stopMovement,
  type MovingEntity,
} from './movement.js';

const OAKHAVEN = MAPS.map1!;

function entityAt(x: number, y: number, facing: Facing = 'down'): MovingEntity {
  return { x, y, facing, path: null, heldDirection: null };
}

describe('facingFromVector', () => {
  it('returns null for a zero vector', () => {
    expect(facingFromVector(0, 0)).toBeNull();
  });

  it('picks the cardinal direction for axis-aligned vectors', () => {
    expect(facingFromVector(1, 0)).toBe('right');
    expect(facingFromVector(-1, 0)).toBe('left');
    expect(facingFromVector(0, 1)).toBe('down');
    expect(facingFromVector(0, -1)).toBe('up');
  });

  it('breaks diagonal ties toward vertical', () => {
    expect(facingFromVector(1, 1)).toBe('down');
    expect(facingFromVector(-1, -1)).toBe('up');
  });
});

describe('setMoveDir', () => {
  it('normalizes any magnitude to a unit-ish sign vector', () => {
    const entity = entityAt(10, 7);
    setMoveDir(entity, 5, 0);
    expect(entity.heldDirection).toEqual({ dx: 1, dy: 0 });
  });

  it('treats {0,0} as stop', () => {
    const entity = entityAt(10, 7);
    setMoveDir(entity, 1, 0);
    setMoveDir(entity, 0, 0);
    expect(entity.heldDirection).toBeNull();
  });

  it('cancels an in-progress click-to-move path', () => {
    const entity = entityAt(10, 7);
    expect(setMoveTo(entity, OAKHAVEN, { x: 8, y: 6 })).toBe(true);
    expect(entity.path).not.toBeNull();
    setMoveDir(entity, 1, 0);
    expect(entity.path).toBeNull();
  });
});

describe('setMoveTo', () => {
  it('finds a path to a reachable walkable tile and drops the current tile from it', () => {
    const entity = entityAt(10, 7);
    const ok = setMoveTo(entity, OAKHAVEN, { x: 10, y: 6 });
    expect(ok).toBe(true);
    expect(entity.path).toEqual([{ x: 10, y: 6 }]);
  });

  it('returns false and leaves motion untouched for an unreachable/unwalkable target', () => {
    const entity = entityAt(10, 7);
    setMoveDir(entity, 1, 0);
    const ok = setMoveTo(entity, OAKHAVEN, { x: 0, y: 0 }); // map border, always '#'
    expect(ok).toBe(false);
    expect(entity.heldDirection).toEqual({ dx: 1, dy: 0 }); // untouched
  });

  it('clears the path entirely when the target is the entity\'s own tile', () => {
    const entity = entityAt(10, 7);
    const ok = setMoveTo(entity, OAKHAVEN, { x: 10, y: 7 });
    expect(ok).toBe(true);
    expect(entity.path).toBeNull();
  });
});

describe('stopMovement', () => {
  it('clears both path and heldDirection', () => {
    const entity = entityAt(10, 7);
    setMoveDir(entity, 1, 0);
    stopMovement(entity);
    expect(entity.heldDirection).toBeNull();
    expect(entity.path).toBeNull();
  });
});

describe('stepMovement: WASD (heldDirection)', () => {
  it('moves at speed * dt along a cardinal direction and faces that way', () => {
    const entity = entityAt(10, 7);
    setMoveDir(entity, 1, 0);
    stepMovement(entity, OAKHAVEN, 4, 0.5); // 4 tiles/s for 0.5s = 2 tiles
    expect(entity.x).toBeCloseTo(12, 5);
    expect(entity.y).toBeCloseTo(7, 5);
    expect(entity.facing).toBe('right');
  });

  it('normalizes diagonal speed so it does not exceed cardinal speed', () => {
    const entity = entityAt(10, 7);
    setMoveDir(entity, 1, 1);
    stepMovement(entity, OAKHAVEN, 4, 1); // 4 tiles over 1s
    const traveled = distanceTiles({ x: 10, y: 7 }, entity);
    expect(traveled).toBeCloseTo(4, 5);
  });

  it('does not move through a wall tile', () => {
    // Oakhaven's border is solid; standing one tile in from the left edge
    // and walking left should be blocked entirely (both proposed axes land
    // on/through the border).
    const entity = entityAt(1, 7); // x=1 is the first walkable column
    setMoveDir(entity, -1, 0);
    stepMovement(entity, OAKHAVEN, 4, 1);
    expect(entity.x).toBe(1);
  });

  it('resolves each axis independently, so a blocked x does not also block a valid y', () => {
    // x=1 is the first walkable column (x=0 is the border wall); moving
    // up-left with enough budget pushes the x attempt's rounded tile onto
    // the wall column, which must be rejected, while the y attempt lands on
    // an ordinary interior tile and must still succeed.
    const entity = entityAt(1, 5);
    setMoveDir(entity, -1, -1);
    stepMovement(entity, OAKHAVEN, 4, 0.3); // distance 1.2, diagonal component ~0.85
    expect(entity.x).toBe(1); // x-axis move rejected (would round into the wall column)
    expect(entity.y).toBeLessThan(5); // y-axis move still applied
  });

  it('does nothing when there is no path and no held direction', () => {
    const entity = entityAt(10, 7);
    stepMovement(entity, OAKHAVEN, 4, 1);
    expect(entity.x).toBe(10);
    expect(entity.y).toBe(7);
  });
});

describe('stepMovement: click-to-move (path)', () => {
  it('walks the full path and clears it on arrival, covering extra distance in the same step', () => {
    const entity = entityAt(10, 7);
    expect(setMoveTo(entity, OAKHAVEN, { x: 8, y: 6 })).toBe(true);
    // Distance from (10,7) to (8,6) via at least 2 diagonal-ish hops is a
    // few tiles; 4 tiles/s for 2s = 8 tiles of budget, comfortably enough
    // to finish and clear the path.
    stepMovement(entity, OAKHAVEN, 4, 2);
    expect(entity.x).toBeCloseTo(8, 5);
    expect(entity.y).toBeCloseTo(6, 5);
    expect(entity.path).toBeNull();
  });

  it('stops partway along the path when there is not enough distance budget', () => {
    const entity = entityAt(10, 7);
    setMoveTo(entity, OAKHAVEN, { x: 10, y: 6 }); // single-tile path, distance 1
    stepMovement(entity, OAKHAVEN, 4, 0.1); // budget 0.4 tiles, not enough to arrive
    expect(entity.path).not.toBeNull();
    const traveled = distanceTiles({ x: 10, y: 7 }, entity);
    expect(traveled).toBeCloseTo(0.4, 5);
  });

  it('updates facing toward each waypoint as it is approached', () => {
    const entity = entityAt(10, 7);
    setMoveTo(entity, OAKHAVEN, { x: 10, y: 6 }); // straight up
    stepMovement(entity, OAKHAVEN, 4, 1);
    expect(entity.facing).toBe('up');
  });
});
