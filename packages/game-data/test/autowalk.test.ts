import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAYER_SPEED, TILE_SIZE, buildCollisionGrid, findPath, inputToward, nextPortal, stepMovement, tileCenter, waypointRadius } from '@terrago/shared';
import { NPCS, QUESTS, getMap } from '../src';

/** Walk from the map's arrival point to a tile with the real movement code. */
function walk(mapId: string, to: { x: number; y: number }, speed = 1): string | null {
  const stepPx = (PLAYER_SPEED * speed * 50) / 1000;
  const near = waypointRadius(stepPx);
  const map = getMap(mapId)!;
  const grid = buildCollisionGrid(map, NPCS.filter((n) => n.mapId === mapId).map((n) => ({ x: n.x, y: n.y })));
  let pos = tileCenter(map.spawn.x, map.spawn.y);
  const path = findPath(grid, map.spawn, to, 1);
  if (!path) return `${mapId} → ${to.x},${to.y}: no path`;
  for (let steps = 0; path.length; steps++) {
    if (steps > 20000) return `${mapId} → ${to.x},${to.y}: too long`;
    const w = path[0]!;
    const c = tileCenter(w.x, w.y);
    if (Math.abs(c.x - pos.x) <= near && Math.abs(c.y - pos.y) <= near) {
      path.shift();
      continue;
    }
    const next = stepMovement(pos, inputToward(pos, w, TILE_SIZE, stepPx), grid, PLAYER_SPEED * speed, 50);
    if (next.x === pos.x && next.y === pos.y) return `${mapId} → ${to.x},${to.y}: stuck at ${Math.floor(pos.x / 32)},${Math.floor(pos.y / 32)}`;
    pos = next;
  }
  return null;
}

test('auto-walk reaches every quest target and every NPC', () => {
  const fails: string[] = [];
  for (const q of QUESTS) for (const s of q.steps) if (s.where) fails.push(walk(s.where.map, s.where) ?? '');
  for (const n of NPCS) fails.push(walk(n.mapId, n) ?? '');
  assert.deepEqual(fails.filter(Boolean), []);
});

test('auto-walk arrives on fast mounts too (no back-and-forth overshoot loop)', () => {
  const fails: string[] = [];
  for (const speed of [1.16, 1.5, 2.15, 2.6, 3.2])
    for (const q of QUESTS) for (const s of q.steps) if (s.where) fails.push(walk(s.where.map, s.where, speed) ?? '');
  assert.deepEqual(fails.filter(Boolean), []);
});

test('portals route between maps', () => {
  assert.equal(nextPortal('greenhaven', 'glacial_depths', getMap)?.to, 'desolate_crags');
  assert.equal(nextPortal('sunfield_plains', 'infernal_caldera', getMap)?.to, 'greenhaven');
  assert.equal(nextPortal('glacial_depths', 'sunfield_plains', getMap)?.to, 'desolate_crags');
  assert.equal(nextPortal('greenhaven', 'greenhaven', getMap), null);
});
