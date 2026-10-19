import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CollisionGrid, buildCollisionGrid } from '../src/collision';
import { PLAYER_BODY, PLAYER_SPEED, SIM, TILE_SIZE } from '../src/constants';
import type { MapDef } from '../src/map';
import { facingFor, stepMovement } from '../src/movement';

function gridFrom(rows: string[]): CollisionGrid {
  const map: MapDef = {
    id: 't',
    name: 'Test',
    width: rows[0]!.length,
    height: rows.length,
    tileSize: TILE_SIZE,
    safeZone: true,
    music: null,
    spawn: { x: 1, y: 1, dir: 'down' },
    tiles: rows,
    objects: [],
    portals: [],
  };
  return buildCollisionGrid(map);
}

const open = gridFrom(['..........', '..........', '..........', '..........', '..........']);
const step = SIM.stepMs;
const dist = (PLAYER_SPEED * step) / 1000;

describe('stepMovement', () => {
  test('moves the expected distance per step', () => {
    const p = stepMovement({ x: 100, y: 100 }, { dx: 1, dy: 0 }, open, PLAYER_SPEED, step);
    assert.equal(p.x, 100 + dist);
    assert.equal(p.y, 100);
  });

  test('diagonal movement is normalised (no faster diagonals)', () => {
    const p = stepMovement({ x: 100, y: 100 }, { dx: 1, dy: 1 }, open, PLAYER_SPEED, step);
    const moved = Math.hypot(p.x - 100, p.y - 100);
    assert.ok(Math.abs(moved - dist) < 0.02, `moved ${moved}, expected ${dist}`);
  });

  test('no input means no movement', () => {
    const start = { x: 50, y: 60 };
    assert.deepEqual(stepMovement(start, { dx: 0, dy: 0 }, open, PLAYER_SPEED, step), start);
  });

  test('stops flush against walls and never enters them', () => {
    // Wall column at tile x=5 (pixels 160..192).
    const walled = gridFrom(['.....#....', '.....#....', '.....#....', '.....#....', '.....#....']);
    let p = { x: 120, y: 80 };
    for (let i = 0; i < 40; i++) p = stepMovement(p, { dx: 1, dy: 0 }, walled, PLAYER_SPEED, step);
    assert.ok(p.x + PLAYER_BODY.halfWidth <= 160, `body edge ${p.x + PLAYER_BODY.halfWidth} entered wall`);
    assert.ok(p.x + PLAYER_BODY.halfWidth > 159, 'should end flush against the wall');
    assert.equal(walled.bodyBlocked(p.x, p.y), false);
  });

  test('cannot leave the map', () => {
    let p = { x: 20, y: 20 };
    for (let i = 0; i < 50; i++) p = stepMovement(p, { dx: -1, dy: -1 }, open, PLAYER_SPEED, step);
    assert.ok(p.x - PLAYER_BODY.halfWidth >= 0);
    assert.ok(p.y - PLAYER_BODY.height >= 0);
  });

  test('is deterministic: same inputs give identical positions', () => {
    const inputs = Array.from({ length: 200 }, (_, i) => ({ dx: ((i % 3) - 1) as -1 | 0 | 1, dy: (((i >> 2) % 3) - 1) as -1 | 0 | 1 }));
    const run = () => inputs.reduce((p, inp) => stepMovement(p, inp, open, PLAYER_SPEED, step), { x: 150, y: 90 });
    assert.deepEqual(run(), run());
  });

  test('corner assist slides a player into a doorway they barely miss', () => {
    // A one-tile gap at x=4 in a horizontal wall on row 2.
    const door = gridFrom(['..........', '..........', '####.#####', '..........', '..........']);
    // Player is 5px left of the gap centre, walking up.
    let p = { x: 4 * TILE_SIZE + 16 - 5, y: 3 * TILE_SIZE + 20 };
    for (let i = 0; i < 30; i++) p = stepMovement(p, { dx: 0, dy: -1 }, door, PLAYER_SPEED, step);
    assert.ok(p.y < 2 * TILE_SIZE + 8, `player should pass through the gap, y=${p.y}`);
    assert.equal(door.bodyBlocked(p.x, p.y), false);
  });
});

describe('facingFor', () => {
  test('prefers horizontal facing on diagonals and keeps facing when idle', () => {
    assert.equal(facingFor({ dx: 1, dy: -1 }, 'down'), 'right');
    assert.equal(facingFor({ dx: 0, dy: -1 }, 'down'), 'up');
    assert.equal(facingFor({ dx: 0, dy: 0 }, 'left'), 'left');
  });
});
