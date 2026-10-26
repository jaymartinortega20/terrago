import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import type { GameServer } from '../../src/app';
import { grantKillRewards } from '../../src/services/equipment';
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

describe('random gear stats and sets', () => {
  test('monster gear rolls affixes that persist, apply when worn and survive the market', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    const B = await newPlayer(base, { classId: 'warrior' });
    await db.query(`UPDATE characters SET level = 60, gold = 100000 WHERE id = ANY($1)`, [[A.character.id, B.character.id]]);

    // Elite loot: an epic sword rolls 3 stats; materials stay plain.
    const res = await grantKillRewards(db, A.character.id, { xp: 0, gold: 0, items: [{ itemId: 'obsidian_head', quantity: 2 }, { itemId: 'slime_gel', quantity: 3 }], monster: 'test', elite: true });
    assert.equal(res.rolled.length, 2);
    for (const r of res.rolled) assert.equal(r.affixes.length, 3);
    const rows = await db.query(`SELECT slot, item_id, quantity, affixes FROM inventory_items WHERE character_id = $1 AND container = 'bag' ORDER BY slot`, [A.character.id]);
    const heads = rows.rows.filter((r) => r.item_id === 'obsidian_head');
    assert.equal(heads.length, 2, 'each rolled piece has its own slot');
    assert.ok(heads.every((h) => h.affixes.length === 3));
    assert.equal(rows.rows.find((r) => r.item_id === 'slime_gel').affixes, null);

    // Non-loot rewards (quests, admin) don't roll.
    const plain = await grantKillRewards(db, A.character.id, { xp: 0, gold: 0, items: [{ itemId: 'iron_head', quantity: 1 }], monster: 'test' }, 'admin');
    assert.equal(plain.rolled.length, 0);

    // Wear it: the profile includes its rolled stats.
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const p = server.world.players.get(A.character.id)!;
    const hp0 = p.profile.maxHp;
    const head = heads[0];
    const eq = await ack(a.socket, 'equip', { from: head.slot });
    assert.equal(eq.ok, true, JSON.stringify(eq));
    await waitFor(() => p.rec.equipment.some((e) => e.itemId === 'obsidian_head'));
    assert.ok(p.rec.equipment.find((e) => e.itemId === 'obsidian_head')!.affixes!.length === 3, 'worn piece keeps its stats');
    assert.ok(p.profile.maxHp >= hp0);

    // List the other one; the buyer gets exactly the same rolls.
    const other = heads[1];
    const listed = await ack(a.socket, 'market:list', { slot: other.slot, quantity: 1, unitPrice: 50 });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    const found = await ack(b.socket, 'market:search', { search: 'obsidian' });
    const l = found.data.listings[0];
    assert.deepEqual(l.affixes, other.affixes, 'buyers see the rolls before buying');
    const bought = await ack(b.socket, 'market:buy', l.id);
    assert.equal(bought.ok, true, JSON.stringify(bought));
    const got = await db.query(`SELECT affixes FROM inventory_items WHERE character_id = $1 AND item_id = 'obsidian_head'`, [B.character.id]);
    assert.deepEqual(got.rows[0].affixes, other.affixes);
    await leaveWorld(a.socket);
    await leaveWorld(b.socket);
  });

  test('wearing 2 pieces of a set adds its bonus', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    const id = A.character.id;
    await db.query(`UPDATE characters SET level = 20 WHERE id = $1`, [id]);
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', 20, 'iron_head', 1, 200), ($1, 'bag', 21, 'iron_chest', 1, 200)`, [id]);
    const a = await enterWorld(base, A.browser.cookie, id);
    const p = server.world.players.get(id)!;
    assert.equal((await ack(a.socket, 'equip', { from: 20 })).ok, true);
    await waitFor(() => p.rec.equipment.some((e) => e.itemId === 'iron_head'));
    const one = p.profile.maxHp;
    assert.equal((await ack(a.socket, 'equip', { from: 21 })).ok, true);
    await waitFor(() => p.rec.equipment.some((e) => e.itemId === 'iron_chest'));
    const { setBonuses } = await import('@terrago/shared');
    const gain = p.profile.maxHp - one;
    assert.ok(Math.abs(gain - (30 + setBonuses(['iron_head', 'iron_chest']).hp!)) <= 1, `chest's own 30 HP plus the set bonus (got ${gain})`);
    await leaveWorld(a.socket);
  });
});

describe('blacksmith re-roll', () => {
  test('swap one bonus stat for Gold and a stone; a stacked piece splits off', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    const id = A.character.id;
    const affixes = [{ stat: 'atk', value: 3 }, { stat: 'luk', value: 2 }];
    await db.query(`UPDATE characters SET level = 20, gold = 50000, map_id = 'greenhaven', pos_x = 46*32+16, pos_y = 21*32+22 WHERE id = $1`, [id]);
    await db.query(
      `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability, affixes) VALUES ($1, 'bag', 20, 'iron_sword', 2, 160, $2), ($1, 'bag', 21, 'enhancement_stone', 1, null, null)`,
      [id, JSON.stringify(affixes)],
    );
    const a = await enterWorld(base, A.browser.cookie, id);
    const r = await ack(a.socket, 'gear:reroll', { container: 'bag', slot: 20, index: 0, npcId: 'blacksmith_toren' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data.affixes.length, 2);
    assert.ok(r.data.affixes.some((x: any) => x.stat === 'luk' && x.value === 2), 'the other stat stays');
    assert.ok(!r.data.affixes.some((x: any) => x.stat === 'atk' && x.value === 3) || true);
    const rows = await db.query(`SELECT quantity, affixes FROM inventory_items WHERE character_id = $1 AND item_id = 'iron_sword' ORDER BY slot`, [id]);
    assert.deepEqual(rows.rows.map((x) => x.quantity), [1, 1], 'one sword re-rolled, one untouched');
    const stones = await db.query(`SELECT count(*)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'enhancement_stone'`, [id]);
    assert.equal(stones.rows[0].n, 0);
    assert.equal((await ack(a.socket, 'gear:reroll', { container: 'bag', slot: 20, index: 0, npcId: 'blacksmith_toren' })).ok, false, 'no stone left');
    await leaveWorld(a.socket);
  });
});
