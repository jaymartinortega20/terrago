import { describe, expect, it } from 'vitest';
import { findPath, type TileGrid } from './pathfinding.js';

function gridFromRows(rows: string[]): TileGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return {
    width,
    height,
    isWalkable(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return rows[y]?.[x] !== '#';
    },
  };
}

describe('findPath (A*)', () => {
  it('finds a straight path on an open grid', () => {
    const grid = gridFromRows(['.....', '.....', '.....']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual({ x: 0, y: 0 });
    expect(path?.at(-1)).toEqual({ x: 4, y: 0 });
  });

  it('returns a single-tile path when start equals goal', () => {
    const grid = gridFromRows(['...']);
    const path = findPath(grid, { x: 1, y: 0 }, { x: 1, y: 0 });
    expect(path).toEqual([{ x: 1, y: 0 }]);
  });

  it('returns null when the goal tile is not walkable', () => {
    const grid = gridFromRows(['.#.']);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it('returns null when the goal is fully walled off', () => {
    const grid = gridFromRows(['.#.', '###', '.#.']);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 0, y: 2 })).toBeNull();
  });

  it('routes around an obstacle', () => {
    const grid = gridFromRows(['...', '.#.', '...']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path?.some((p) => p.x === 1 && p.y === 1)).toBe(false); // never steps on the wall
  });

  it('never cuts a diagonal through two blocked corners', () => {
    // Walking from (0,0) to (1,1) diagonally would clip both the (1,0) and (0,1) walls.
    const grid = gridFromRows(['.#', '#.']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(path).toBeNull();
  });

  it('prefers the shorter diagonal path when nothing blocks it', () => {
    const grid = gridFromRows(['..', '..']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });
});
