import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { GUILD_LEVEL_XP, OUTFITS, tileCenter } from '@terrago/shared';
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

async function player(map: string, tx: number, ty: number, level: number, gold = 0, items: [string, number][] = []) {
  const A = await newPlayer(base, { classId: 'warrior' });
  const c = tileCenter(tx, ty);
  await db.query(`UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, level = $5, gold = $6 WHERE id = $1`, [A.character.id, map, c.x, c.y, level, gold]);
  let slot = 20;
  for (const [id, n] of items) await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1, 'bag', $2, $3, $4)`, [A.character.id, slot++, id, n]);
  const a = await enterWorld(base, A.browser.cookie, A.character.id);
  return { A, a, p: server.world.players.get(A.character.id)! };
}
const count = async (id: string, item: string) => Number((await db.query(`SELECT coalesce(sum(quantity),0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = $2`, [id, item])).rows[0].n);

describe('long-term progression', () => {
  test('exchanges: Arena Tokens buy cosmetics once; Bounty Seals only at a bounty board', async () => {
    const { a, p } = await player('sunfield_plains', 27, 24, 20, 0, [['arena_token', 100], ['bounty_seal', 5]]);
    const v = await ack(a.socket, 'exchange:get', { which: 'arena' });
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.data.balance, 100);
    const buy = await ack(a.socket, 'exchange:buy', { which: 'arena', offer: 'ar_outfit' });
    assert.equal(buy.ok, true, JSON.stringify(buy));
    assert.equal(buy.data.balance, 40);
    assert.ok(buy.data.owned.includes('ar_outfit'));
    assert.equal((await ack(a.socket, 'exchange:buy', { which: 'arena', offer: 'ar_outfit' })).ok, false, 'once');
    const w = await ack(a.socket, 'wardrobe:get');
    assert.ok(w.data.owned.includes(OUTFITS.findIndex((o) => o.name === 'Arena Champion')));
    assert.equal((await ack(a.socket, 'exchange:buy', { which: 'bounty', offer: 'bs_stone' })).ok, false, 'needs a board');
    const seal = await ack(a.socket, 'exchange:buy', { which: 'bounty', offer: 'bs_stone', npcId: 'ranger_wren' });
    assert.equal(seal.ok, true, JSON.stringify(seal));
    assert.equal(await count(p.id, 'enhancement_stone'), 1);
    assert.equal(await count(p.id, 'bounty_seal'), 2);
    await leaveWorld(a.socket);
  });

  test('guild levels: investing treasury Gold (a sink) raises the guild level', async () => {
    const { a, p } = await player('greenhaven', 30, 30, 30, 200000);
    assert.equal((await ack(a.socket, 'guild:create', { name: 'Levelers', tag: 'LVL' })).ok, true);
    await ack(a.socket, 'guild:treasury', { amount: 150000 });
    const inv = await ack(a.socket, 'guild:invest', { gold: 100000 });
    assert.equal(inv.ok, true, JSON.stringify(inv));
    const g = await db.query(`SELECT xp, treasury FROM guilds WHERE id = $1`, [p.guild!.id]);
    assert.equal(Number(g.rows[0].xp), 1000);
    assert.equal(Number(g.rows[0].treasury), 50000, 'the Gold is gone (a sink)');
    const view = await ack(a.socket, 'guild:get');
    assert.equal(view.data.level, 2);
    assert.equal(GUILD_LEVEL_XP[1], 1000);
    await leaveWorld(a.socket);
  });

  test('Endless Rift: pay to enter, clear a floor, get shards, the next floor comes, leave', async () => {
    const { a, p } = await player('greenhaven', 38, 13, 20, 5000);
    const st = await ack(a.socket, 'rift:get', 'rift_keeper_sera');
    assert.equal(st.ok, true, JSON.stringify(st));
    assert.deepEqual(st.data.checkpoints.map((c: any) => c.floor), [1]);
    assert.equal((await ack(a.socket, 'rift:enter', { npcId: 'rift_keeper_sera', floor: 6 })).ok, false, 'no checkpoint yet');
    const enter = await ack(a.socket, 'rift:enter', { npcId: 'rift_keeper_sera', floor: 1 });
    assert.equal(enter.ok, true, JSON.stringify(enter));
    await waitFor(() => p.mapId === 'rift', 4000);
    const rt = server.world.runtimeOf(p);
    const mobs = () => [...rt.monsters.values()].filter((m) => m.alive && m.eventTag?.startsWith('rift:'));
    await waitFor(() => mobs().length >= 4, 3000);
    p.rec.hp = p.profile.maxHp = 1_000_000;
    // Defeat them all.
    for (const m of mobs()) {
      m.hp = 1;
      m.x = p.x + 30;
      m.y = p.y;
      for (let i = 0; i < 10 && m.alive; i++) {
        await ack(a.socket, 'attack', m.id);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await waitFor(async () => (await count(p.id, 'rift_shard')) === 1, 5000);
    const best = await db.query(`SELECT max(floor) AS f FROM rift_runs WHERE character_id = $1`, [p.id]);
    assert.equal(best.rows[0].f, 1);
    await waitFor(() => mobs().length > 0, 8000);
    assert.ok(mobs().every((m) => m.eventTag!.endsWith(':2')), 'floor 2 spawned');
    assert.equal((await ack(a.socket, 'rift:leave')).ok, true);
    await waitFor(() => p.mapId === 'greenhaven', 4000);
    const lb = await ack(a.socket, 'leaderboard:get', 'rift');
    assert.equal(lb.data.rows[0].value, 1);
    await leaveWorld(a.socket);
  });
});
