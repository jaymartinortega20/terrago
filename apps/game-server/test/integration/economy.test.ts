import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { getNpc } from '../../src/services/npcs';
import { waystones } from '@terrago/game-data';
import { tileCenter } from '@terrago/shared';
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
async function place(id: string, mapId: string, tx: number, ty: number) {
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, gold = 30000 WHERE id = $1', [id, mapId, c.x, c.y]);
}
const gold = async (id: string) => Number((await db.query('SELECT gold FROM characters WHERE id = $1', [id])).rows[0].gold);
const count = async (id: string, itemId: string, container = 'bag') =>
  Number((await db.query(`SELECT coalesce(sum(quantity),0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = $2 AND container = $3`, [id, itemId, container])).rows[0].n);

describe('bank, waystones, stalls', () => {
  test('bank: deposit, withdraw, upgrade; only next to the banker', async () => {
    const A = await newPlayer(base);
    const npc = getNpc('banker_orrin')!;
    await place(A.character.id, 'greenhaven', npc.x - 1, npc.y);
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1,'bag',10,'iron_ore',7)`, [A.character.id]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const v = await ack(a.socket, 'bank:get', 'banker_orrin');
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.data.capacity, 30);
    const dep = await ack(a.socket, 'bank:move', { npcId: 'banker_orrin', dir: 'deposit', slot: 10 });
    assert.equal(dep.ok, true, JSON.stringify(dep));
    assert.equal(await count(A.character.id, 'iron_ore', 'bank'), 7);
    assert.equal(await count(A.character.id, 'iron_ore', 'bag'), 0);
    const bankSlot = dep.data.slots.find((s: any) => s.itemId === 'iron_ore').slot;
    assert.equal((await ack(a.socket, 'bank:move', { npcId: 'banker_orrin', dir: 'withdraw', slot: bankSlot })).ok, true);
    assert.equal(await count(A.character.id, 'iron_ore', 'bag'), 7);
    const up = await ack(a.socket, 'bank:upgrade', 'banker_orrin');
    assert.equal(up.data.bank.capacity, 40);
    assert.equal(await gold(A.character.id), 29000);
    const p = server.world.players.get(A.character.id)!;
    p.x = tileCenter(30, 26).x;
    p.y = tileCenter(30, 26).y;
    assert.equal((await ack(a.socket, 'bank:get', 'banker_orrin')).ok, false, 'too far from the banker');
    await leaveWorld(a.socket);
  });

  test('waystones: travel only from a pad, to visited places, for a fee', async () => {
    const A = await newPlayer(base);
    const gh = waystones().find((w) => w.mapId === 'greenhaven')!;
    const sf = waystones().find((w) => w.mapId === 'sunfield_plains')!;
    const fp = waystones().find((w) => w.mapId === 'frostpine_peaks')!;
    await place(A.character.id, 'greenhaven', 31, 26);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.equal((await ack(a.socket, 'travel:go', 'sunfield_plains')).ok, false, 'not on a pad');
    const p = server.world.players.get(A.character.id)!;
    p.x = tileCenter(gh.x, gh.y).x;
    p.y = tileCenter(gh.x, gh.y).y;
    const list = await ack(a.socket, 'travel:list');
    assert.equal(list.data.atWaystone, true);
    assert.equal(list.data.options.find((o: any) => o.mapId === 'frostpine_peaks').known, false);
    assert.equal((await ack(a.socket, 'travel:go', 'frostpine_peaks')).ok, false, 'not attuned');
    const g0 = await gold(A.character.id);
    const go = await ack(a.socket, 'travel:go', 'sunfield_plains');
    assert.equal(go.ok, true, JSON.stringify(go));
    await waitFor(() => p.mapId === 'sunfield_plains');
    assert.equal(await gold(A.character.id), g0 - sf.fee);
    void fp;
    await leaveWorld(a.socket);
  });

  test('stalls: open in town, buy at the shown price with 3% tax, moving closes it', async () => {
    const S = await newPlayer(base);
    const B = await newPlayer(base);
    await place(S.character.id, 'greenhaven', 31, 26);
    await place(B.character.id, 'greenhaven', 32, 26);
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1,'bag',10,'gold_ore',5),($1,'bag',11,'carrot',3)`, [S.character.id]);
    const s = await enterWorld(base, S.browser.cookie, S.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    const looks: any[] = [];
    b.socket.on('entity:update', (id, patch) => id === S.character.id && looks.push(patch));
    await waitFor(() => b.seen.some((e) => e.id === S.character.id), 5000);
    const open = await ack(s.socket, 'stall:open', { name: 'Shiny Ore!', items: [{ slot: 10, price: 100 }, { slot: 11, price: 5 }] });
    assert.equal(open.ok, true, JSON.stringify(open));
    await waitFor(() => looks.some((l) => l.shop === 'Shiny Ore!'));
    const view = await ack(b.socket, 'stall:view', S.character.id);
    assert.equal(view.data.items.length, 2);
    assert.equal((await ack(b.socket, 'stall:buy', { sellerId: S.character.id, slot: 10, itemId: 'gold_ore', price: 90 })).ok, false, 'must agree to the real price');
    const gS = await gold(S.character.id);
    const gB = await gold(B.character.id);
    const buy = await ack(b.socket, 'stall:buy', { sellerId: S.character.id, slot: 10, itemId: 'gold_ore', price: 100 });
    assert.equal(buy.ok, true, JSON.stringify(buy));
    assert.equal(await count(B.character.id, 'gold_ore'), 5);
    assert.equal(await gold(B.character.id), gB - 500);
    assert.equal(await gold(S.character.id), gS + 500 - 15);
    assert.equal((await ack(b.socket, 'stall:buy', { sellerId: S.character.id, slot: 10, itemId: 'gold_ore', price: 100 })).ok, false, 'sold once');
    // Seller walks away: the stall closes.
    s.socket.emit('move', [1, 1, 0]);
    await waitFor(() => looks.some((l) => l.shop === null));
    assert.equal((await ack(b.socket, 'stall:view', S.character.id)).ok, false);
    await leaveWorld(s.socket);
    await leaveWorld(b.socket);
  });
});
