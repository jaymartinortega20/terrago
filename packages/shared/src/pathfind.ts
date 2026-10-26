import type { CollisionGrid } from './collision';
import type { MapDef } from './map';
import type { MoveInput } from './movement';

/**
 * Auto-walk: A* over the tile grid (8 directions, no corner cutting), and a
 * breadth-first search over portals for targets on other maps.
 */

export interface PathTile {
  x: number;
  y: number;
}

/** Shortest walkable tile path from `from` to the free tile nearest `to` (within `near`). */
export function findPath(grid: CollisionGrid, from: PathTile, to: PathTile, near = 1, maxNodes = 40_000): PathTile[] | null {
  const W = grid.width;
  const H = grid.height;
  const free = (x: number, y: number) => !grid.isSolidTile(x, y);
  // Goal: any free tile within `near` of the target (NPCs and nodes stand on solid tiles).
  const goal = new Set<number>();
  for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) if (free(to.x + dx, to.y + dy)) goal.add((to.y + dy) * W + (to.x + dx));
  if (!goal.size) {
    // Widen the search ring until we find somewhere to stand.
    for (let r = near + 1; r <= near + 4 && !goal.size; r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (free(to.x + dx, to.y + dy)) goal.add((to.y + dy) * W + (to.x + dx));
    if (!goal.size) return null;
  }
  const start = from.y * W + from.x;
  if (goal.has(start)) return [];
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const h = (i: number) => {
    const x = i % W;
    const y = (i / W) | 0;
    const ex = Math.abs(x - to.x);
    const ey = Math.abs(y - to.y);
    return Math.max(ex, ey) + 0.414 * Math.min(ex, ey);
  };
  // Small binary heap of [f, index].
  const heap: [number, number][] = [[h(start), start]];
  const push = (n: [number, number]) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  let seen = 0;
  while (heap.length && seen++ < maxNodes) {
    const [, cur] = pop();
    if (goal.has(cur)) {
      const out: PathTile[] = [];
      let c: number | undefined = cur;
      while (c !== undefined && c !== start) {
        out.push({ x: c % W, y: (c / W) | 0 });
        c = came.get(c);
      }
      return out.reverse();
    }
    const cx = cur % W;
    const cy = (cur / W) | 0;
    const gc = g.get(cur)!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !free(nx, ny)) continue;
        if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue; // no corner cutting
        const ni = ny * W + nx;
        const ng = gc + (dx && dy ? 1.414 : 1);
        if (ng >= (g.get(ni) ?? Infinity)) continue;
        g.set(ni, ng);
        came.set(ni, cur);
        push([ng + h(ni), ni]);
      }
    }
  }
  return null;
}

/** The portal on `from` to take next on the way to map `to` (null if unreachable). */
export function nextPortal(from: string, to: string, getMap: (id: string) => MapDef | undefined): { x: number; y: number; to: string } | null {
  if (from === to) return null;
  const prev = new Map<string, { map: string; portal: MapDef['portals'][number] }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const id = queue.shift()!;
    const m = getMap(id);
    for (const p of m?.portals ?? []) {
      // Don't route through dungeons unless that's where we're going.
      if (seen.has(p.to) || (p.to.startsWith('dg_') && p.to !== to)) continue;
      seen.add(p.to);
      prev.set(p.to, { map: id, portal: p });
      if (p.to === to) {
        let at = to;
        while (prev.get(at)!.map !== from) at = prev.get(at)!.map;
        const pt = prev.get(at)!.portal;
        return { x: pt.x + Math.floor((pt.w ?? 1) / 2), y: pt.y + Math.floor((pt.h ?? 1) / 2), to: pt.to };
      }
      queue.push(p.to);
    }
  }
  return null;
}

/**
 * How close counts as "at" a waypoint. It must be at least one movement step,
 * or a fast mount (12+ px per step) jumps over the target every step and
 * walks back and forth forever.
 */
export function waypointRadius(stepPx: number): number {
  return Math.max(4, stepPx * 0.75);
}

/** Arrow-key input that walks from `pos` toward the centre of tile `t`. */
export function inputToward(pos: { x: number; y: number }, t: PathTile, tileSize: number, stepPx = 6): MoveInput {
  const tx = (t.x + 0.5) * tileSize;
  const ty = (t.y + 0.5) * tileSize + 6; // positions are at the feet
  const ex = tx - pos.x;
  const ey = ty - pos.y;
  // Don't step on an axis that's already closer than half a step (that only overshoots).
  const dz = Math.max(3, stepPx / 2);
  return { dx: (ex > dz ? 1 : ex < -dz ? -1 : 0) as MoveInput['dx'], dy: (ey > dz ? 1 : ey < -dz ? -1 : 0) as MoveInput['dy'] };
}
