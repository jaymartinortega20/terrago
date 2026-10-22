import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { getCrop } from '@terrago/game-data';
import { cropStatus, tileCenter, type PlotObject, type WorldObject } from '@terrago/shared';
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
  process.env.TERRAGO_PESTS = 'off';
  await server?.stop();
  await db?.end();
});
async function place(id: string, tx: number, ty: number) {
  const c = tileCenter(tx, ty);
  await db.query(`UPDATE characters SET map_id = 'homestead', pos_x = $2, pos_y = $3, direction = 'up' WHERE id = $1`, [id, c.x, c.y]);
}
const pause = () => new Promise((r) => setTimeout(r, 230));
const count = async (id: string, itemId: string) =>
  Number((await db.query(`SELECT coalesce(sum(quantity),0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = $2 AND container = 'bag'`, [id, itemId])).rows[0].n);

describe('farm life: pests and animals', () => {
  test('pests stall a crop until you clear them', async () => {
    process.env.TERRAGO_PESTS = 'always';
    const A = await newPlayer(base);
    await place(A.character.id, 12, 10);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const objs = new Map(a.enter.objects.map((o) => [o.id, o]));
    a.socket.on('objects:set', (list) => list.forEach((o) => objs.set(o.id, o)));
    const plot = () => [...objs.values()].find((o): o is PlotObject => o.kind === 'plot' && o.index === 0)!;
    await ack(a.socket, 'act', { tx: 12, ty: 9 });
    await pause();
    const seed = a.enter.inventory.slots.find((s) => s.itemId === 'carrot_seed')!.slot;
    await ack(a.socket, 'act', { tx: 12, ty: 9, slot: seed });
    await pause();
    await ack(a.socket, 'act', { tx: 12, ty: 9 }); // water
    await waitFor(() => plot().crop?.pestAt);
    const def = getCrop('carrot')!;
    // Jump far ahead: the crop stops at the pest point instead of finishing.
    await db.query(`UPDATE farm_plots SET progress_at = progress_at - interval '3 hours', water_until = now() + interval '1 hour' WHERE character_id = $1`, [A.character.id]);
    await leaveWorld(a.socket);
    const b = await enterWorld(base, A.browser.cookie, A.character.id);
    const p0 = b.enter.objects.find((o: WorldObject): o is PlotObject => o.kind === 'plot' && o.index === 0)!;
    const st = cropStatus(p0.crop!, def, Date.now());
    assert.equal(st.pests, true);
    assert.equal(st.ready, false, 'pests stopped the growth');
    const cleared = await ack(b.socket, 'act', { tx: 12, ty: 9 });
    assert.equal(cleared.ok, true, JSON.stringify(cleared));
    assert.match(cleared.data.message, /pests/);
    const row = await db.query('SELECT pest_at_ms FROM farm_plots WHERE character_id = $1 AND plot_index = 0', [A.character.id]);
    assert.equal(row.rows[0].pest_at_ms, null);
    await leaveWorld(b.socket);
    process.env.TERRAGO_PESTS = 'off';
  });

  test('animals: release, feed, products only while fed, collect', async () => {
    const A = await newPlayer(base);
    const id = A.character.id;
    await db.query(`INSERT INTO character_skills (character_id, skill, level, xp) VALUES ($1, 'farming', 20, 0) ON CONFLICT (character_id, skill) DO UPDATE SET level = 20`, [id]);
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1,'bag',10,'chicken',1),($1,'bag',11,'cow',2),($1,'bag',12,'animal_feed',5)`, [id]);
    await place(id, 8, 20); // by the pen gate
    const a = await enterWorld(base, A.browser.cookie, id);
    assert.equal((await ack(a.socket, 'animals:add', 10)).ok, true);
    assert.equal((await ack(a.socket, 'animals:add', 11)).ok, true);
    const third = await ack(a.socket, 'animals:add', 11);
    assert.equal(third.ok, false, 'starter pen holds two');
    assert.match(third.error, /holds 2/);
    // Not fed yet: nothing to collect even after hours.
    await db.query(`UPDATE farm_animals SET collected_at = now() - interval '5 hours' WHERE character_id = $1`, [id]);
    assert.equal((await ack(a.socket, 'animals:collect')).ok, false);
    const fed = await ack(a.socket, 'animals:feed');
    assert.equal(fed.ok, true, JSON.stringify(fed));
    assert.equal(await count(id, 'animal_feed'), 3);
    // Two hours of fed time pass.
    await db.query(`UPDATE farm_animals SET collected_at = collected_at - interval '2 hours', fed_until = fed_until - interval '2 hours' WHERE character_id = $1`, [id]);
    const got = await ack(a.socket, 'animals:collect');
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(await count(id, 'egg'), 3, 'chicken: one egg per 30 min, capped at 3');
    assert.equal(await count(id, 'milk'), 2, 'cow: one milk per 45 min');
    await leaveWorld(a.socket);
  });
});
