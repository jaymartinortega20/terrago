import type { TileCoord } from './types.js';

export interface TileGrid {
  width: number;
  height: number;
  isWalkable(x: number, y: number): boolean;
}

interface AStarNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
}

const DIRECTIONS: Array<{ dx: number; dy: number; cost: number }> = [
  { dx: 1, dy: 0, cost: 1 },
  { dx: -1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 1, cost: Math.SQRT2 },
  { dx: 1, dy: -1, cost: Math.SQRT2 },
  { dx: -1, dy: 1, cost: Math.SQRT2 },
  { dx: -1, dy: -1, cost: Math.SQRT2 },
];

/** Octile distance: admissible and consistent with the 8-directional costs above. */
function heuristic(a: TileCoord, b: TileCoord): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * A* over a tile collision grid. Returns a path including both the start and goal
 * tiles, or null if the goal is unreachable (or itself not walkable). Diagonal moves
 * are blocked when they would cut through a solid corner, so a path never clips a wall.
 *
 * Lives in shared/ so the client (path preview) and server (movement authority) run
 * the identical algorithm, per SPEC.md section 2.
 */
export function findPath(grid: TileGrid, start: TileCoord, goal: TileCoord): TileCoord[] | null {
  if (!grid.isWalkable(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [{ x: start.x, y: start.y }];

  const open = new Map<string, AStarNode>();
  const closed = new Set<string>();

  const startNode: AStarNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: heuristic(start, goal),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.h;
  open.set(key(start.x, start.y), startNode);

  const maxIterations = grid.width * grid.height + 1;
  let iterations = 0;

  while (open.size > 0) {
    if (++iterations > maxIterations) return null; // safety valve, should never trigger

    let current: AStarNode | null = null;
    for (const node of open.values()) {
      if (!current || node.f < current.f) current = node;
    }
    if (!current) break;

    if (current.x === goal.x && current.y === goal.y) {
      const path: TileCoord[] = [];
      let n: AStarNode | null = current;
      while (n) {
        path.push({ x: n.x, y: n.y });
        n = n.parent;
      }
      return path.reverse();
    }

    open.delete(key(current.x, current.y));
    closed.add(key(current.x, current.y));

    for (const { dx, dy, cost } of DIRECTIONS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      if (!grid.isWalkable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!grid.isWalkable(current.x + dx, current.y) || !grid.isWalkable(current.x, current.y + dy)) {
          continue; // no corner-cutting
        }
      }
      if (closed.has(key(nx, ny))) continue;

      const g = current.g + cost;
      const existing = open.get(key(nx, ny));
      if (existing && existing.g <= g) continue;

      const h = heuristic({ x: nx, y: ny }, goal);
      open.set(key(nx, ny), { x: nx, y: ny, g, h, f: g + h, parent: current });
    }
  }
  return null;
}
