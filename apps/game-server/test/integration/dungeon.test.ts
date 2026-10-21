import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { getMap } from '@terrago/game-data';
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

/** Walk a live player onto a portal tile (test shortcut: teleport next to it and step). */
async function stepOnto(socket: any, id: string, mapId: string, tx: number, ty: number) {
  const p = server.world.players.get(id)!;
  const c = tileCenter(tx, ty + 1);
  p.x = c.x;
  p.y = c.y;
  server.world.runtimeOf(p).spatial.update(p);
  for (let i = 0; i < 30 && p.mapId === mapId; i++) {
    server.world.enqueueMove(p, [p.lastQueuedSeq + 1, 0, -1]);
    await new Promise((r) => setTimeout(r, 60));
  }
  void socket;
  return p;
}

describe('dungeons (v0.7)', () => {
  test('a party shares one instance; the boss telegraphs, summons, drops loot for everyone once a day', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    const B = await newPlayer(base, { classId: 'priest' });
    for (const x of [A, B]) {
      await db.query(`UPDATE characters SET level = 16, map_id = 'whisperwood', pos_x = $2, pos_y = $3 WHERE id = $1`, [x.character.id, tileCenter(11, 19).x, tileCenter(11, 19).y]);
    }
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    await ack(a.socket, 'party:invite', B.character.id);
    await ack(b.socket, 'invite:respond', { kind: 'party', fromId: A.character.id, accept: true });

    const gate = getMap('whisperwood')!.portals.find((p) => p.id === 'gate_mossy_crypt')!;
    const pa = await stepOnto(a.socket, A.character.id, 'whisperwood', gate.x + 1, gate.y);
    const pb = await stepOnto(b.socket, B.character.id, 'whisperwood', gate.x + 1, gate.y);
    assert.equal(pa.mapId, 'dg_mossy_crypt');
    assert.equal(pb.mapId, 'dg_mossy_crypt');
    const rt = server.world.runtimeOf(pa);
    assert.equal(rt, server.world.runtimeOf(pb), 'same instance');
    assert.equal(rt.owner?.id, A.character.id, "the leader's instance");
    assert.ok(rt.monsters.size >= 8, `monsters spawned (${rt.monsters.size})`);

    // Boss fight: stand next to Varn, let it aggro and wind up a telegraphed attack.
    const boss = [...rt.monsters.values()].find((m) => m.def.id === 'crypt_lord')!;
    const tele: any[] = [];
    a.socket.on('telegraph', (t) => tele.push(t));
    pa.x = boss.x;
    pa.y = boss.y + 30;
    rt.spatial.update(pa);
    pb.x = boss.x + 40;
    pb.y = boss.y + 30;
    rt.spatial.update(pb);
    // Test characters have no armor: keep them topped up so the fight runs its course.
    const heal = setInterval(() => {
      for (const p of [pa, pb]) if (!p.dead) p.rec.hp = p.profile.maxHp;
    }, 100);
    after(() => clearInterval(heal));
    await ack(a.socket, 'attack', boss.id);
    await waitFor(() => tele.length > 0, 9000);
    assert.ok(tele[0].r > 0 && tele[0].ms >= 1000, 'telegraph has a radius and a warning time');

    // Drop it below the summon threshold: adds appear.
    const before = rt.monsters.size;
    boss.hp = Math.round(boss.stats.maxHp * 0.65);
    await waitFor(() => rt.monsters.size > before, 4000);

    // Finish it: both party members get their own loot and a sigil.
    boss.hp = 1;
    pa.rec.hp = pa.profile.maxHp;
    for (let i = 0; i < 20 && boss.alive; i++) {
      await ack(a.socket, 'attack', boss.id);
      await new Promise((r) => setTimeout(r, 400));
    }
    assert.equal(boss.alive, false);
    const sigils = async (id: string) =>
      Number((await db.query(`SELECT coalesce(sum(quantity),0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'dungeon_key'`, [id])).rows[0].n);
    await waitFor(async () => (await sigils(A.character.id)) === 1 && (await sigils(B.character.id)) === 1, 5000);
    // Adds die with their master; dungeon monsters stay dead.
    await waitFor(() => ![...rt.monsters.values()].some((m) => m.temp), 3000);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(boss.alive, false, 'no respawn in a dungeon');

    // Same day again: XP yes, treasure no.
    const flag = await db.query(`SELECT count(*)::int AS n FROM character_flags WHERE character_id = $1 AND flag LIKE 'boss:crypt_lord:%'`, [A.character.id]);
    assert.equal(flag.rows[0].n, 1);
    boss.state = 'idle';
    boss.hp = 1;
    boss.respawnAt = 0;
    boss.damageBy.clear();
    await ack(a.socket, 'attack', boss.id);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(await sigils(A.character.id), 1, 'boss treasure only once per day');

    // Logging out inside puts you back outside.
    await leaveWorld(a.socket);
    await leaveWorld(b.socket);
    const again = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.equal(again.enter.map.id, 'whisperwood');
    await leaveWorld(again.socket);
  });
});
