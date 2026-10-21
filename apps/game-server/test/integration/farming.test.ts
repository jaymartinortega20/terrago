import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { getCrop } from '@terrago/game-data';
import { cropStatus, tileCenter, type InventoryState, type PlotObject, type WorldObject } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { harvest } from '../../src/services/farming';
import { Browser, TEST_DB, ack, enterWorld, leaveWorld, newPlayer, once, resetDatabase, startTestServer, waitFor } from './helpers';

let server: GameServer;
let base: string;
let db: pg.Pool;

before(async () => {
  await resetDatabase();
  server = await startTestServer();
  base = `http://127.0.0.1:${server.port()}`;
  db = new pg.Pool({ connectionString: TEST_DB, max: 2 });
});

after(async () => {
  await server?.stop();
  await db?.end();
});

/** Put a character somewhere before it enters the world (tests don't need to walk across maps). */
async function place(characterId: string, mapId: string, tx: number, ty: number, dir = 'up') {
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, direction = $5 WHERE id = $1', [characterId, mapId, c.x, c.y, dir]);
}

/** Pretend `minutes` passed for every plot of a farm (shifts its timestamps into the past). */
async function timeTravel(characterId: string, minutes: number) {
  await db.query(
    `UPDATE farm_plots SET progress_at = progress_at - make_interval(mins => $2), water_until = water_until - make_interval(mins => $2)
      WHERE character_id = $1`,
    [characterId, minutes],
  );
}

function plotAt(objects: WorldObject[], index: number): PlotObject {
  return objects.find((o): o is PlotObject => o.kind === 'plot' && o.index === index)!;
}

describe('farming (v0.2 success test)', () => {
  test('till, plant, water, leave, come back later: the crop grew while offline; harvest, XP, sell', async () => {
    const A = await newPlayer(base);
    // Plot 0 is tile (12, 9). Stand just south of it, facing up.
    await place(A.character.id, 'homestead', 12, 10);
    let a = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.equal(a.enter.map.id, 'homestead');
    assert.equal(a.enter.map.owner?.id, A.character.id);
    const plots = a.enter.objects.filter((o) => o.kind === 'plot') as PlotObject[];
    assert.equal(plots.filter((p) => !p.locked).length, 12, 'starter farm has 12 plots');
    assert.equal(plots.filter((p) => p.locked).length, 12, 'next tier shown as locked');

    const objs = new Map(a.enter.objects.map((o) => [o.id, o]));
    a.socket.on('objects:set', (list) => list.forEach((o) => objs.set(o.id, o)));
    let inv: InventoryState = a.enter.inventory;
    a.socket.on('inventory:update', (i) => (inv = i));
    const pause = () => new Promise((r) => setTimeout(r, 220)); // action cooldown

    const tilled = await ack(a.socket, 'act', { tx: 12, ty: 9 });
    assert.equal(tilled.ok, true, JSON.stringify(tilled));
    await waitFor(() => plotAt([...objs.values()], 0).tilled);
    await pause();

    const seedSlot = inv.slots.find((s) => s.itemId === 'carrot_seed')!.slot;
    const planted = await ack(a.socket, 'act', { tx: 12, ty: 9, slot: seedSlot });
    assert.equal(planted.ok, true, JSON.stringify(planted));
    assert.match(planted.data.message, /Planted Carrot/);
    await waitFor(() => plotAt([...objs.values()], 0).crop?.cropId === 'carrot');
    assert.equal(inv.slots.find((s) => s.itemId === 'carrot_seed')!.quantity, 5);
    await pause();

    const watered = await ack(a.socket, 'act', { tx: 12, ty: 9 });
    assert.equal(watered.ok, true, JSON.stringify(watered));
    assert.match(watered.data.message, /Watered/);
    await pause();

    const early = await ack(a.socket, 'act', { tx: 12, ty: 9 });
    assert.equal(early.ok, true);
    assert.match(early.data.message, /Carrot: \d+% grown — ready in/);

    // Too far / locked plots are refused.
    await pause();
    assert.equal((await ack(a.socket, 'act', { tx: 20, ty: 9 })).ok, false);
    await pause();
    const locked = await ack(a.socket, 'act', { tx: 12, ty: 11 }); // plot 12 (tier 2)
    assert.equal(locked.ok, false);
    assert.match(locked.error, /wild/);

    // Leave the game. Five minutes pass. The server restarts too — no timers are needed.
    await leaveWorld(a.socket);
    await new Promise((r) => setTimeout(r, 100));
    await server.stop();
    await timeTravel(A.character.id, 5);
    server = await startTestServer();
    base = `http://127.0.0.1:${server.port()}`;
    A.browser = Object.assign(new Browser(base), { cookie: A.browser.cookie });

    a = await enterWorld(base, A.browser.cookie, A.character.id);
    const back = plotAt(a.enter.objects, 0);
    assert.equal(back.crop?.cropId, 'carrot');
    assert.equal(cropStatus(back.crop!, getCrop('carrot')!, Date.now()).ready, true, 'grew while offline');

    const selfUpdate = once<any>(a.socket, 'self:update');
    const harvested = await ack(a.socket, 'act', { tx: 12, ty: 9 });
    assert.equal(harvested.ok, true, JSON.stringify(harvested));
    assert.match(harvested.data.message, /Harvested 1× .*Carrot/);
    const upd = await selfUpdate;
    assert.equal(upd.skills.farming.xp, 6);

    const carrots = await db.query(`SELECT quantity FROM inventory_items WHERE character_id = $1 AND item_id = 'carrot'`, [A.character.id]);
    assert.equal(carrots.rows[0].quantity, 1);
    const skill = await db.query(`SELECT level, xp FROM character_skills WHERE character_id = $1 AND skill = 'farming'`, [A.character.id]);
    assert.deepEqual(skill.rows[0], { level: 1, xp: 6 });
    const logged = await db.query(`SELECT count(*)::int AS n FROM item_transactions WHERE to_character_id = $1 AND reason = 'harvest'`, [A.character.id]);
    assert.equal(logged.rows[0].n, 1);
    const plotRow = await db.query('SELECT tilled, crop_id FROM farm_plots WHERE character_id = $1 AND plot_index = 0', [A.character.id]);
    assert.deepEqual(plotRow.rows[0], { tilled: true, crop_id: null }, 'soil stays tilled after harvest');
    await leaveWorld(a.socket);
    // Let the server finish saving the old position before moving the character.
    await waitFor(() => !server.world.players.has(A.character.id), 5000);
    await new Promise((r) => setTimeout(r, 200));

    // Sell the carrot to Farmer Rowan and buy more seeds.
    await place(A.character.id, 'greenhaven', 12, 35, 'up');
    await new Promise((r) => setTimeout(r, 100));
    const g = await enterWorld(base, A.browser.cookie, A.character.id);
    const shop = await ack(g.socket, 'shop:get', 'farmer_rowan');
    assert.equal(shop.ok, true, JSON.stringify(shop));
    assert.ok(shop.data.sells.some((e: any) => e.itemId === 'potato_seed'));
    const goldBefore = g.enter.inventory.gold;
    const carrotSlot = g.enter.inventory.slots.find((s) => s.itemId === 'carrot')!;
    const sold = await ack(g.socket, 'shop:sell', { npcId: 'farmer_rowan', slot: carrotSlot.slot, quantity: 1 });
    assert.equal(sold.ok, true, JSON.stringify(sold));
    const bought = await ack(g.socket, 'shop:buy', { npcId: 'farmer_rowan', itemId: 'carrot_seed', quantity: 2 });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    const gold = await db.query('SELECT gold FROM characters WHERE id = $1', [A.character.id]);
    const ledger = await db.query(
      `SELECT reason, amount FROM currency_transactions WHERE character_id = $1 AND reason IN ('npc_sale','npc_purchase') ORDER BY id`,
      [A.character.id],
    );
    assert.equal(ledger.rows[0].reason, 'npc_sale');
    assert.ok(ledger.rows[0].amount >= 10);
    assert.deepEqual(ledger.rows[1], { reason: 'npc_purchase', amount: -16 });
    assert.equal(gold.rows[0].gold, goldBefore + ledger.rows[0].amount - 16);

    // Buying something gated behind Farming level is refused.
    const gated = await ack(g.socket, 'shop:buy', { npcId: 'farmer_rowan', itemId: 'pumpkin_seed', quantity: 1 });
    assert.equal(gated.ok, false);
    assert.match(gated.error, /farming level 14/i);
    // Not in range of Mira.
    assert.equal((await ack(g.socket, 'shop:get', 'merchant_mira')).ok, false);
    g.socket.disconnect();
  });

  test('crops do not grow in dry soil, and regrowing crops come back', async () => {
    const A = await newPlayer(base);
    await place(A.character.id, 'homestead', 12, 10);
    await db.query(`INSERT INTO character_skills (character_id, skill, level, xp) VALUES ($1, 'farming', 10, 0)`, [A.character.id]);
    await db.query(`INSERT INTO farms (character_id) VALUES ($1)`, [A.character.id]);
    // Plot 0: tilled + tomato, never watered. Plot 1: tilled, wet tomato.
    await db.query(
      `INSERT INTO farm_plots (character_id, plot_index, tilled, crop_id, progress_at, water_until) VALUES
         ($1, 0, true, 'tomato', now() - interval '30 min', 'epoch'),
         ($1, 1, true, 'tomato', now() - interval '30 min', now() + interval '30 min')`,
      [A.character.id],
    );
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const tomato = getCrop('tomato')!;
    assert.equal(cropStatus(plotAt(a.enter.objects, 0).crop!, tomato, Date.now()).progress, 0);
    assert.equal(cropStatus(plotAt(a.enter.objects, 1).crop!, tomato, Date.now()).ready, true);

    // Plot 1 is (13, 9); stand under it.
    await leaveWorld(a.socket);
    await place(A.character.id, 'homestead', 13, 10);
    await new Promise((r) => setTimeout(r, 100));
    const b = await enterWorld(base, A.browser.cookie, A.character.id);
    const res = await ack(b.socket, 'act', { tx: 13, ty: 9 });
    assert.equal(res.ok, true, JSON.stringify(res));
    const row = await db.query('SELECT crop_id, harvests, growth_done_ms FROM farm_plots WHERE character_id = $1 AND plot_index = 1', [A.character.id]);
    assert.equal(row.rows[0].crop_id, 'tomato', 'tomato regrows');
    assert.equal(row.rows[0].harvests, 1);
    assert.equal(Number(row.rows[0].growth_done_ms), tomato.growthMs - tomato.regrowMs!);
    b.socket.disconnect();
  });

  test('concurrent harvests of one plot pay out exactly once', async () => {
    const A = await newPlayer(base);
    await db.query(`INSERT INTO farms (character_id) VALUES ($1)`, [A.character.id]);
    await db.query(
      `INSERT INTO farm_plots (character_id, plot_index, tilled, crop_id, progress_at, water_until)
       VALUES ($1, 3, true, 'carrot', now() - interval '10 min', now() + interval '1 hour')`,
      [A.character.id],
    );
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => harvest(server.pool, A.character.id, 3)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const carrots = await db.query(`SELECT coalesce(sum(quantity), 0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'carrot'`, [A.character.id]);
    assert.equal(carrots.rows[0].n, 1);
    const xp = await db.query(`SELECT xp FROM character_skills WHERE character_id = $1 AND skill = 'farming'`, [A.character.id]);
    assert.equal(Number(xp.rows[0].xp), 6);
  });

  test('farm expansion needs level, materials and gold; repairs cost gold', async () => {
    const A = await newPlayer(base);
    await place(A.character.id, 'greenhaven', 12, 35, 'up');
    const g = await enterWorld(base, A.browser.cookie, A.character.id);
    const info = await ack(g.socket, 'farm:info', 'farmer_rowan');
    assert.equal(info.ok, true);
    assert.equal(info.data.tier, 1);
    assert.equal(info.data.next.plots, 24);

    const tooLow = await ack(g.socket, 'farm:upgrade', 'farmer_rowan');
    assert.equal(tooLow.ok, false);
    assert.match(tooLow.error, /Farming level 5/);

    await db.query(`INSERT INTO character_skills (character_id, skill, level, xp) VALUES ($1, 'farming', 5, 0)`, [A.character.id]);
    const noMats = await ack(g.socket, 'farm:upgrade', 'farmer_rowan');
    assert.equal(noMats.ok, false);
    assert.match(noMats.error, /Softwood Log/);

    await db.query(
      `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1, 'bag', 10, 'softwood_log', 20), ($1, 'bag', 11, 'stone', 25)`,
      [A.character.id],
    );
    const noGold = await ack(g.socket, 'farm:upgrade', 'farmer_rowan');
    assert.equal(noGold.ok, false);
    assert.match(noGold.error, /Not enough Gold/);
    const stillThere = await db.query(`SELECT quantity FROM inventory_items WHERE character_id = $1 AND item_id = 'softwood_log'`, [A.character.id]);
    assert.equal(stillThere.rows[0].quantity, 20, 'failed upgrade rolled back the materials');

    await db.query('UPDATE characters SET gold = 1000 WHERE id = $1', [A.character.id]);
    const ok = await ack(g.socket, 'farm:upgrade', 'farmer_rowan');
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const farm = await db.query('SELECT tier FROM farms WHERE character_id = $1', [A.character.id]);
    assert.equal(farm.rows[0].tier, 2);
    const left = await db.query(`SELECT item_id, quantity FROM inventory_items WHERE character_id = $1 AND item_id IN ('softwood_log','stone')`, [A.character.id]);
    assert.deepEqual(left.rows, [{ item_id: 'stone', quantity: 5 }]);
    const gold = await db.query('SELECT gold FROM characters WHERE id = $1', [A.character.id]);
    assert.equal(gold.rows[0].gold, 600);
    await leaveWorld(g.socket);

    // Repair at Toren.
    await db.query(`UPDATE inventory_items SET durability = 0 WHERE character_id = $1 AND item_id = 'worn_hoe'`, [A.character.id]);
    await place(A.character.id, 'greenhaven', 46, 21, 'up');
    await new Promise((r) => setTimeout(r, 100));
    const t = await enterWorld(base, A.browser.cookie, A.character.id);
    const quote = await ack(t.socket, 'repair:quote', 'blacksmith_toren');
    assert.deepEqual(quote.data, { cost: 5, items: 1 });
    const fixed = await ack(t.socket, 'repair:all', 'blacksmith_toren');
    assert.equal(fixed.ok, true, JSON.stringify(fixed));
    const hoe = await db.query(`SELECT durability FROM inventory_items WHERE character_id = $1 AND item_id = 'worn_hoe'`, [A.character.id]);
    assert.equal(hoe.rows[0].durability, 120);
    t.socket.disconnect();
  });
});
