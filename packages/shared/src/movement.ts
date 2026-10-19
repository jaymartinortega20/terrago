import { CORNER_ASSIST_PX } from './constants';
import type { CollisionGrid } from './collision';
import type { Direction } from './types';

export type Axis = -1 | 0 | 1;

export interface MoveInput {
  dx: Axis;
  dy: Axis;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Positions are kept at 1/100 px so client and server never drift apart. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function isAxis(v: unknown): v is Axis {
  return v === -1 || v === 0 || v === 1;
}

export function facingFor(input: MoveInput, previous: Direction): Direction {
  if (input.dx < 0) return 'left';
  if (input.dx > 0) return 'right';
  if (input.dy < 0) return 'up';
  if (input.dy > 0) return 'down';
  return previous;
}

/**
 * Advance a player by one fixed movement step. Pure and deterministic: the
 * client runs it to predict its own movement, the server runs it to decide
 * where the player really is. Clients never send positions, only inputs.
 */
export function stepMovement(pos: Vec2, input: MoveInput, grid: CollisionGrid, speed: number, stepMs: number): Vec2 {
  const { dx, dy } = input;
  if (dx === 0 && dy === 0) return pos;

  const dist = (speed * stepMs) / 1000;
  const k = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;

  let x = pos.x;
  let y = pos.y;

  if (dx !== 0) {
    const nx = moveAxis(x, y, dx * dist * k, true, grid);
    if (nx === x && dy === 0) y = cornerAssist(x, y, dx, true, dist, grid);
    x = nx;
  }
  if (dy !== 0) {
    const ny = moveAxis(x, y, dy * dist * k, false, grid);
    if (ny === y && dx === 0) x = cornerAssist(x, y, dy, false, dist, grid);
    y = ny;
  }

  return { x: round2(x), y: round2(y) };
}

/** Move along one axis in ≤1px increments, stopping flush against walls. */
function moveAxis(x: number, y: number, delta: number, horizontal: boolean, grid: CollisionGrid): number {
  let cur = horizontal ? x : y;
  const sign = Math.sign(delta);
  let remaining = Math.abs(delta);
  while (remaining > 0) {
    const s = Math.min(1, remaining);
    const next = cur + sign * s;
    const blocked = horizontal ? grid.bodyBlocked(next, y) : grid.bodyBlocked(x, next);
    if (blocked) break;
    cur = next;
    remaining -= s;
  }
  return cur;
}

/**
 * When a straight move is fully blocked by a corner the player only barely
 * clips, slide them sideways so doorways and gaps feel forgiving.
 * Returns the new perpendicular coordinate.
 */
function cornerAssist(x: number, y: number, dir: number, horizontal: boolean, dist: number, grid: CollisionGrid): number {
  const perp = horizontal ? y : x;
  for (let off = 1; off <= CORNER_ASSIST_PX; off++) {
    for (const side of [-1, 1]) {
      const p = perp + side * off;
      const ax = horizontal ? x + dir : p;
      const ay = horizontal ? p : y + dir;
      if (grid.bodyBlocked(ax, ay)) continue;
      // The sideways path itself must be clear.
      let clear = true;
      for (let i = 1; i <= off; i++) {
        const q = perp + side * i;
        if (horizontal ? grid.bodyBlocked(x, q) : grid.bodyBlocked(q, y)) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      const nudge = Math.min(dist, off);
      return perp + side * nudge;
    }
  }
  return perp;
}
