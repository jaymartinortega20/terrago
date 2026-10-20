import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { tileCenter, type QuestState } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { TEST_DB, ack, enterWorld, leaveWorld, newPlayer, once, resetDatabase, startTestServer, waitFor } from './helpers';

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

async function place(id: string, mapId: string, tx: number, ty: number, dir = 'up') {
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, direction = $5 WHERE id = $1', [id, mapId, c.x, c.y, dir]);
}

describe('guide quests, mounts, duels, line of sight', () => {
  test('quest chain: Lina → Hana gives a pony → riding is faster', async () => {
    const A = await newPlayer(base);
    await place(A.character.id, 'greenhaven', 29, 22, 'left'); // next to Mayor Lina (28,22)
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    let quests: QuestState[] = await once<QuestState[]>(a.socket, 'quests');
    a.socket.on('quests', (q) => (quests = q));
    assert.deepEqual(quests[0], { id: 'q_welcome', step: 0, count: 0, done: false });
    const talk = await ack(a.socket, 'npc:interact', 'mayor_lina');
    assert.equal(talk.ok, true);
    await waitFor(() => quests.some((q) => q.id === 'q_pony'));
    assert.equal(quests.find((q) => q.id === 'q_welcome')!.done, true);
    // No mount yet.
    assert.equal((await ack(a.socket, 'mount:toggle')).ok, false);
    const p = server.world.players.get(A.character.id)!;
    p.x = tileCenter(45, 23).x;
    p.y = tileCenter(45, 23).y; // next to Hana (44,23)
    await ack(a.socket, 'npc:interact', 'stablemaster_hana');
    await waitFor(() => quests.find((q) => q.id === 'q_pony')?.step === 1);
    const pony = await db.query(`SELECT count(*)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'brown_pony'`, [A.character.id]);
    assert.equal(pony.rows[0].n, 1, 'Hana handed over the pony');
    await new Promise((r) => setTimeout(r, 200));
    const ride = await ack(a.socket, 'mount:toggle');
    assert.equal(ride.ok, true, JSON.stringify(ride));
    assert.equal(p.speed, 1.45);
    await waitFor(() => quests.find((q) => q.id === 'q_pony')?.done);
    assert.ok(quests.some((q) => q.id === 'q_homestead'));
    // Riding covers more ground per step.
    const y0 = p.y;
    for (let s = 1; s <= 5; s++) server.world.enqueueMove(p, [p.lastQueuedSeq + 1, 0, 1]);
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(p.y - y0 > 5 * 112 * 0.05 * 1.3, `moved ${p.y - y0}px`);
    await leaveWorld(a.socket);
  });

  test('duels: challenge, accept, fight to 1 HP — nobody dies', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    const B = await newPlayer(base, { classId: 'warrior' });
    await place(A.character.id, 'greenhaven', 31, 26);
    await place(B.character.id, 'greenhaven', 32, 26);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    assert.equal((await ack(a.socket, 'attack', B.character.id)).ok, false, 'no fighting without a duel');
    await ack(a.socket, 'chat:send', `/duel ${B.character.name}`);
    const duel = once<any>(a.socket, 'duel');
    await ack(b.socket, 'chat:send', '/accept');
    assert.equal((await duel).with.id, B.character.id);
    const pb = server.world.players.get(B.character.id)!;
    pb.rec.hp = 3;
    for (let i = 0; i < 20 && server.world.players.get(A.character.id)!.duel; i++) {
      await ack(a.socket, 'attack', B.character.id);
      await new Promise((r) => setTimeout(r, 900));
    }
    assert.equal(server.world.players.get(A.character.id)!.duel, null, 'duel ended');
    assert.equal(pb.rec.hp, 1, 'loser left at 1 HP');
    assert.equal(pb.dead, false);
    await leaveWorld(a.socket);
    await leaveWorld(b.socket);
  });

  test('ranged attacks need line of sight', async () => {
    const grid = server.world.getRuntime('greenhaven') ?? null;
    void grid;
    const A = await newPlayer(base);
    await place(A.character.id, 'greenhaven', 31, 26);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const rt = server.world.runtimeOf(server.world.players.get(A.character.id)!);
    // The fountain (30..33, 21..23) blocks sight across it; open plaza doesn't.
    const c = (x: number, y: number) => tileCenter(x, y);
    assert.equal(rt.grid.lineOfSight(c(31, 19).x, c(31, 19).y, c(31, 25).x, c(31, 25).y), false);
    assert.equal(rt.grid.lineOfSight(c(25, 19).x, c(25, 19).y, c(25, 25).x, c(25, 25).y), true);
    await leaveWorld(a.socket);
  });
});
