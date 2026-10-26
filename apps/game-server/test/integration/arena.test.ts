import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { arenaDelta, tileCenter, type ArenaEvent } from '@terrago/shared';
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

async function fighter(level: number, tx: number) {
  const A = await newPlayer(base, { classId: 'warrior' });
  const c = tileCenter(tx, 30);
  await db.query(`UPDATE characters SET map_id = 'greenhaven', pos_x = $2, pos_y = $3, level = $4 WHERE id = $1`, [A.character.id, c.x, c.y, level]);
  const a = await enterWorld(base, A.browser.cookie, A.character.id);
  const events: ArenaEvent[] = [];
  a.socket.on('arena', (e: ArenaEvent) => events.push(e));
  return { A, a, p: server.world.players.get(A.character.id)!, events, home: { x: c.x, y: c.y } };
}

describe('ranked arena', () => {
  test('queue → matched → fight in the ring → rated → back home', async () => {
    const low = await fighter(5, 30);
    assert.equal((await ack(low.a.socket, 'arena:queue')).ok, false, 'level 15+');
    const A = await fighter(30, 31);
    const B = await fighter(32, 33);
    const q1 = await ack(A.a.socket, 'arena:queue');
    assert.equal(q1.ok, true, JSON.stringify(q1));
    assert.equal(q1.data.queued, true);
    assert.equal(q1.data.rating, 1000);
    await ack(B.a.socket, 'arena:queue');
    await waitFor(() => A.events.some((e) => e.kind === 'found') && B.events.some((e) => e.kind === 'found'), 6000);
    await waitFor(() => A.p.mapId === 'arena' && B.p.mapId === 'arena', 4000);
    assert.equal(server.world.runtimeOf(A.p), server.world.runtimeOf(B.p), 'same ring');
    // The fight starts after the countdown.
    await waitFor(() => A.p.duel?.with === B.p, 6000);
    B.p.rec.hp = 2;
    for (let i = 0; i < 20 && !A.events.some((e) => e.kind === 'result'); i++) {
      A.p.x = B.p.x - 30;
      A.p.y = B.p.y;
      server.world.runtimeOf(A.p).spatial.update(A.p);
      await ack(A.a.socket, 'attack', B.p.id);
      await new Promise((r) => setTimeout(r, 400));
    }
    const ra = A.events.find((e) => e.kind === 'result') as Extract<ArenaEvent, { kind: 'result' }>;
    const rb = await waitFor(() => B.events.find((e) => e.kind === 'result') as Extract<ArenaEvent, { kind: 'result' }> | undefined, 4000);
    assert.equal(ra.won, true);
    assert.equal(rb.won, false);
    const d = arenaDelta(1000, 1000);
    assert.equal(ra.rating, 1000 + d);
    assert.equal(rb.rating, 1000 - d);
    assert.ok(ra.gold > 0 && rb.gold === 0);
    assert.equal(ra.tokens, 3, 'winner: 3 Arena Tokens');
    assert.equal(rb.tokens, 1, 'loser: 1 Arena Token');
    const rows = await db.query(`SELECT character_id, rating, wins, losses FROM arena_ratings ORDER BY rating DESC`);
    assert.deepEqual(rows.rows.map((r) => [r.character_id, r.rating, r.wins, r.losses]), [
      [A.p.id, 1000 + d, 1, 0],
      [B.p.id, 1000 - d, 0, 1],
    ]);
    // Sent home with full health.
    await waitFor(() => A.p.mapId === 'greenhaven' && B.p.mapId === 'greenhaven', 8000);
    assert.equal(B.p.rec.hp, B.p.profile.maxHp);
    assert.ok(Math.hypot(A.p.x - A.home.x, A.p.y - A.home.y) < 40, 'back where they were');
    const board = await ack(A.a.socket, 'leaderboard:get', 'arena');
    assert.equal(board.data.rows[0].name, A.p.name);
    for (const x of [low, A, B]) await leaveWorld(x.a.socket);
  });

  test('leaving during the countdown forfeits the match', async () => {
    const A = await fighter(40, 31);
    const B = await fighter(40, 33);
    await ack(A.a.socket, 'arena:queue');
    await ack(B.a.socket, 'arena:queue');
    await waitFor(() => A.p.mapId === 'arena' && B.p.mapId === 'arena', 8000);
    await leaveWorld(B.a.socket);
    await server.world.leave(B.p);
    const r = await waitFor(() => A.events.find((e) => e.kind === 'result') as Extract<ArenaEvent, { kind: 'result' }> | undefined, 4000);
    assert.equal(r.won, true);
    await waitFor(() => A.p.mapId === 'greenhaven', 8000);
    // B's saved position is never the arena.
    const saved = await db.query(`SELECT map_id FROM characters WHERE id = $1`, [B.p.id]);
    const { sanitizePosition } = await import('../../src/world/characterState');
    assert.equal(sanitizePosition({ mapId: saved.rows[0].map_id, x: 100, y: 100 } as any).mapId, 'greenhaven');
    await leaveWorld(A.a.socket);
  });
});
