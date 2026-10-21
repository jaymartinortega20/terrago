import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { tileCenter, type TradeView } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { TEST_DB, ack, enterWorld, leaveWorld, newPlayer, resetDatabase, startTestServer, waitFor } from './helpers';

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

const give = (id: string, slot: number, itemId: string, qty: number) =>
  db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1, 'bag', $2, $3, $4)`, [id, slot, itemId, qty]);
const gold = async (id: string) => Number((await db.query('SELECT gold FROM characters WHERE id = $1', [id])).rows[0].gold);
const count = async (id: string, itemId: string) =>
  Number((await db.query(`SELECT coalesce(sum(quantity),0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = $2`, [id, itemId])).rows[0].n);
async function place(id: string, tx: number, ty: number) {
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4 WHERE id = $1', [id, 'greenhaven', c.x, c.y]);
}

describe('marketplace (third milestone)', () => {
  test('A lists Iron Ore, B finds and buys it; tax, fee, logs; refresh keeps balances', async () => {
    const A = await newPlayer(base);
    const B = await newPlayer(base);
    await give(A.character.id, 10, 'iron_ore', 10);
    await db.query('UPDATE characters SET gold = 1000 WHERE id = $1', [B.character.id]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    const goldA0 = await gold(A.character.id);

    const listed = await ack(a.socket, 'market:list', { slot: 10, quantity: 10, unitPrice: 20 });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.equal(await count(A.character.id, 'iron_ore'), 0, 'item is in escrow');
    assert.equal(await gold(A.character.id), goldA0 - 2, 'listing fee (1%, min 2)');

    const found = await ack(b.socket, 'market:search', { search: 'iron', sort: 'price_asc' });
    assert.equal(found.ok, true);
    const listing = found.data.listings.find((l: any) => l.itemId === 'iron_ore');
    assert.ok(listing);
    assert.equal(listing.sellerName, A.character.name);

    assert.equal((await ack(a.socket, 'market:buy', listing.id)).ok, false, "can't buy your own listing");
    const bought = await ack(b.socket, 'market:buy', listing.id);
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.equal(await count(B.character.id, 'iron_ore'), 10);
    assert.equal(await gold(B.character.id), 1000 - 200);
    assert.equal(await gold(A.character.id), goldA0 - 2 + 200 - 10, 'seller gets total minus 5% tax');
    assert.equal((await ack(b.socket, 'market:buy', listing.id)).ok, false, 'listing disappears after the sale');
    const tx = await db.query('SELECT total, tax FROM marketplace_transactions WHERE listing_id = $1', [listing.id]);
    assert.deepEqual(tx.rows[0], { total: 200, tax: 10 });
    const moved = await db.query(`SELECT count(*)::int AS n FROM item_transactions WHERE reason = 'marketplace' AND to_character_id = $1`, [B.character.id]);
    assert.equal(moved.rows[0].n, 1);

    // Refresh both: balances and bags are the same.
    await leaveWorld(a.socket);
    await leaveWorld(b.socket);
    const a2 = await enterWorld(base, A.browser.cookie, A.character.id);
    const b2 = await enterWorld(base, B.browser.cookie, B.character.id);
    assert.equal(a2.enter.inventory.gold, goldA0 - 2 + 190);
    assert.equal(b2.enter.inventory.slots.find((s) => s.itemId === 'iron_ore')?.quantity, 10);
    await leaveWorld(a2.socket);
    await leaveWorld(b2.socket);
  });

  test('two buyers racing for one listing: exactly one gets it, nothing duplicates', async () => {
    const S = await newPlayer(base);
    const buyers = await Promise.all([newPlayer(base), newPlayer(base), newPlayer(base)]);
    await give(S.character.id, 10, 'copper_bar', 5);
    for (const x of buyers) await db.query('UPDATE characters SET gold = 1000 WHERE id = $1', [x.character.id]);
    const s = await enterWorld(base, S.browser.cookie, S.character.id);
    await ack(s.socket, 'market:list', { slot: 10, quantity: 5, unitPrice: 30 });
    const id = (await ack(s.socket, 'market:mine')).data.listings[0].id;
    const socks = await Promise.all(buyers.map((x) => enterWorld(base, x.browser.cookie, x.character.id)));
    const results = await Promise.all(socks.map((x) => ack(x.socket, 'market:buy', id)));
    assert.equal(results.filter((r) => r.ok).length, 1);
    let total = 0;
    for (const x of buyers) total += await count(x.character.id, 'copper_bar');
    assert.equal(total, 5);
    const spent = (await Promise.all(buyers.map((x) => gold(x.character.id)))).reduce((n, g) => n + (1000 - g), 0);
    assert.equal(spent, 150);
    for (const x of [s, ...socks]) await leaveWorld(x.socket);
  });

  test('cancel returns the item; bound items cannot be listed', async () => {
    const A = await newPlayer(base);
    await give(A.character.id, 10, 'carrot', 3);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    await ack(a.socket, 'market:list', { slot: 10, quantity: 3, unitPrice: 15 });
    const id = (await ack(a.socket, 'market:mine')).data.listings[0].id;
    assert.equal((await ack(a.socket, 'market:cancel', id)).ok, true);
    assert.equal(await count(A.character.id, 'carrot'), 3);
    const hoe = a.enter.inventory.slots.find((x) => x.itemId === 'worn_hoe')!;
    const bound = await ack(a.socket, 'market:list', { slot: hoe.slot, quantity: 1, unitPrice: 5 });
    assert.equal(bound.ok, false);
    await leaveWorld(a.socket);
  });
});

describe('direct trade', () => {
  test('offer, lock, confirm swaps items and gold atomically; changes unlock', async () => {
    const A = await newPlayer(base);
    const B = await newPlayer(base);
    await place(A.character.id, 31, 26);
    await place(B.character.id, 32, 26);
    await give(A.character.id, 10, 'iron_ore', 4);
    await db.query('UPDATE characters SET gold = 500 WHERE id = $1', [B.character.id]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    let va: TradeView | null = null;
    a.socket.on('trade:update', (v) => (va = v));
    const goldA0 = await gold(A.character.id);
    assert.equal((await ack(a.socket, 'trade:request', B.character.id)).ok, true);
    assert.equal((await ack(b.socket, 'trade:respond', { fromId: A.character.id, accept: true })).ok, true);
    await waitFor(() => va);
    await ack(a.socket, 'trade:offer', { items: [{ slot: 10, quantity: 4 }], gold: 0 });
    await ack(b.socket, 'trade:offer', { items: [], gold: 120 });
    assert.equal((await ack(a.socket, 'trade:confirm')).ok, false, 'must lock first');
    await ack(a.socket, 'trade:lock');
    await ack(b.socket, 'trade:lock');
    // B changes the offer after A locked: both unlock.
    await ack(b.socket, 'trade:offer', { items: [], gold: 100 });
    await waitFor(() => va && !va.mine.locked && va.theirs.gold === 100);
    await ack(a.socket, 'trade:lock');
    await ack(b.socket, 'trade:lock');
    await ack(a.socket, 'trade:confirm');
    const done = await ack(b.socket, 'trade:confirm');
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(await count(B.character.id, 'iron_ore'), 4);
    assert.equal(await count(A.character.id, 'iron_ore'), 0);
    assert.equal(await gold(A.character.id), goldA0 + 100);
    assert.equal(await gold(B.character.id), 400);
    const log = await db.query('SELECT a_gold, b_gold FROM direct_trade_logs WHERE a_id = $1', [A.character.id]);
    assert.deepEqual(log.rows[0], { a_gold: 0, b_gold: 100 });
    await leaveWorld(a.socket);
    await leaveWorld(b.socket);
  });

  test('moving the offered item away before the swap makes the trade fail cleanly (no dupe)', async () => {
    const A = await newPlayer(base);
    const B = await newPlayer(base);
    await place(A.character.id, 31, 26);
    await place(B.character.id, 32, 26);
    await give(A.character.id, 10, 'gold_ore', 2);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    await ack(a.socket, 'trade:request', B.character.id);
    await ack(b.socket, 'trade:respond', { fromId: A.character.id, accept: true });
    await ack(a.socket, 'trade:offer', { items: [{ slot: 10, quantity: 2 }], gold: 0 });
    await ack(a.socket, 'trade:lock');
    await ack(b.socket, 'trade:lock');
    // Sneakily move the ore to another slot via the inventory API.
    await ack(a.socket, 'inventory:move', { from: 10, to: 15 });
    await ack(a.socket, 'trade:confirm');
    const res = await ack(b.socket, 'trade:confirm');
    assert.equal(res.ok, false);
    assert.equal(await count(A.character.id, 'gold_ore'), 2);
    assert.equal(await count(B.character.id, 'gold_ore'), 0);
    await leaveWorld(a.socket);
    await leaveWorld(b.socket);
  });
});
