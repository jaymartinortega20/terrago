import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import type { GameServer } from '../../src/app';
import { TEST_DB, ack, enterWorld, leaveWorld, newPlayer, resetDatabase, startTestServer } from './helpers';

let server: GameServer;
let base: string;
let db: pg.Pool;

before(async () => {
  await resetDatabase();
  server = await startTestServer();
  base = `http://127.0.0.1:${server.port()}`;
  db = new pg.Pool({ connectionString: TEST_DB, max: 4 });
});

after(async () => {
  await server?.stop();
  await db?.end();
});

describe('bags', () => {
  test('50 slots to start; identical gear stacks; equip takes one; delete; Bag Expansion up to 250', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    const id = A.character.id;
    const cap = await db.query(`SELECT capacity FROM inventories WHERE character_id = $1 AND container = 'bag'`, [id]);
    assert.equal(cap.rows[0].capacity, 50);
    // Two identical swords in separate slots (as old loot was), plus junk and expansions.
    await db.query(
      `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES
       ($1, 'bag', 20, 'iron_sword', 1, 160), ($1, 'bag', 30, 'iron_sword', 1, 160), ($1, 'bag', 31, 'slime_gel', 5, null), ($1, 'bag', 32, 'bag_expansion', 3, null)`,
      [id],
    );
    await db.query(`UPDATE characters SET level = 20 WHERE id = $1`, [id]);
    const a = await enterWorld(base, A.browser.cookie, id);
    const sorted = await ack(a.socket, 'inventory:sort');
    assert.equal(sorted.ok, true, JSON.stringify(sorted));
    const swords = sorted.data.slots.filter((s: any) => s.itemId === 'iron_sword');
    assert.equal(swords.length, 1, 'merged into one slot');
    assert.equal(swords[0].quantity, 2);

    const eq = await ack(a.socket, 'equip', { from: swords[0].slot });
    assert.equal(eq.ok, true, JSON.stringify(eq));
    const left = await db.query(`SELECT container, quantity FROM inventory_items WHERE character_id = $1 AND item_id = 'iron_sword' ORDER BY container`, [id]);
    assert.deepEqual(left.rows.map((r) => [r.container, r.quantity]), [['bag', 1], ['equip', 1]]);

    const inv = server.world.inventoryCache.get(id)!;
    const gel = inv.slots.find((s) => s.itemId === 'slime_gel')!;
    const del = await ack(a.socket, 'inventory:discard', { slot: gel.slot, quantity: 2 });
    assert.equal(del.ok, true);
    assert.equal(del.data.slots.find((s: any) => s.itemId === 'slime_gel').quantity, 3);
    const logged = await db.query(`SELECT quantity FROM item_transactions WHERE from_character_id = $1 AND reason = 'discard'`, [id]);
    assert.equal(logged.rows[0].quantity, 2);

    const bag = server.world.inventoryCache.get(id)!.slots.find((s) => s.itemId === 'bag_expansion')!;
    const use = await ack(a.socket, 'inventory:use', { slot: bag.slot });
    assert.equal(use.ok, true, JSON.stringify(use));
    assert.equal(use.data.inventory.capacity, 60);
    await db.query(`UPDATE inventories SET capacity = 250 WHERE character_id = $1 AND container = 'bag'`, [id]);
    await leaveWorld(a.socket);
    const b = await enterWorld(base, A.browser.cookie, id);
    const bag2 = server.world.inventoryCache.get(id)!.slots.find((s) => s.itemId === 'bag_expansion')!;
    const max = await ack(b.socket, 'inventory:use', { slot: bag2.slot });
    assert.equal(max.ok, false, 'no bigger than 250');
    await leaveWorld(b.socket);
  });
});
