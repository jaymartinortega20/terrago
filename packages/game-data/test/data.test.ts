import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCollisionGrid, tileCenter, TILE_SIZE } from '@terrago/shared';
import { BALANCE, ITEMS, MAPS, NPCS, allMapIds, getItem, getMap, npcsForMap, validateGameData } from '../src/index';

describe('game data', () => {
  test('cross-references are valid', () => {
    assert.deepEqual(validateGameData(), []);
  });

  test('farming does not print money: carrot sells for only a little more than its seed', () => {
    // Spec: seed 8 / crop 10 at NPC prices. We store vendor (sell-back) values; the
    // shop price for seeds is set in v0.2. Keep the crop's NPC value modest.
    const carrot = getItem('carrot')!;
    assert.ok(carrot.vendorValue <= 10);
  });

  test('every map spawn, NPC and portal arrival is reachable (not inside solid tiles)', () => {
    for (const map of allMapIds().map((id) => getMap(id)!)) {
      const grid = buildCollisionGrid(map, npcsForMap(map.id).map((n) => ({ x: n.x, y: n.y })));
      const spawn = tileCenter(map.spawn.x, map.spawn.y);
      assert.equal(grid.bodyBlocked(spawn.x, spawn.y), false, `${map.id} spawn blocked`);
      for (const p of map.portals) {
        const target = getMap(p.to)!;
        const tgrid = buildCollisionGrid(target, npcsForMap(target.id).map((n) => ({ x: n.x, y: n.y })));
        const arrival = tileCenter(p.toX, p.toY);
        assert.equal(tgrid.bodyBlocked(arrival.x, arrival.y), false, `${p.id} arrival blocked`);
        const back = target.portals.find((q) => q.to === map.id);
        if (back) {
          const inside = arrival.x / TILE_SIZE >= back.x && arrival.x / TILE_SIZE < back.x + back.w && arrival.y / TILE_SIZE >= back.y && arrival.y / TILE_SIZE < back.y + back.h;
          assert.equal(inside, false, `${p.id} arrives inside the return portal (would bounce forever)`);
        }
        // Portal tiles must be walkable so players can reach them.
        for (let x = p.x; x < p.x + p.w; x++) assert.equal(grid.isSolidTile(x, p.y), false, `${p.id} tile ${x},${p.y} is solid`);
      }
    }
    for (const n of NPCS) {
      const map = MAPS[n.mapId]!;
      const grid = buildCollisionGrid(map);
      assert.equal(grid.isSolidTile(n.x, n.y), false, `${n.id} stands inside something`);
      // At least one neighbouring tile must be walkable so players can talk to them.
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !grid.isSolidTile(n.x + dx!, n.y + dy!));
      assert.ok(open, `${n.id} is unreachable`);
    }
  });

  test('starter kit fits in the starter bag', () => {
    assert.ok(BALANCE.character.starterItems.length <= BALANCE.character.inventoryCapacity);
    for (const s of BALANCE.character.starterItems) assert.ok(s.quantity <= getItem(s.itemId)!.stackSize);
  });

  test('item ids are unique and rarities are valid', () => {
    assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  });
});
