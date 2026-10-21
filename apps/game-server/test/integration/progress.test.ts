import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import type { GameServer } from '../../src/app';
import { progressEvent, tasksFor } from '../../src/net/journal';
import { createLogger } from '../../src/logger';
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

const gold = async (id: string) => Number((await db.query('SELECT gold FROM characters WHERE id = $1', [id])).rows[0].gold);

describe('dailies, achievements, leaderboards (v0.9)', () => {
  test('login reward once a day; daily task progress, claim once; achievements unlock with gold', async () => {
    const A = await newPlayer(base);
    await db.query('UPDATE characters SET level = 15 WHERE id = $1', [A.character.id]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const toasts: any[] = [];
    a.socket.on('achievement', (x) => toasts.push(x));

    // Level 15 already earned "Seasoned" (level 10) on joining.
    await waitFor(() => toasts.some((t) => t.id === 'level_10'));
    const j0 = await ack(a.socket, 'journal:get');
    assert.equal(j0.ok, true);
    assert.equal(j0.data.login.claimedToday, false);
    assert.equal(j0.data.tasks.length, 3);
    const g0 = await gold(A.character.id);
    assert.equal((await ack(a.socket, 'daily:login')).ok, true);
    assert.equal(await gold(A.character.id), g0 + 50);
    assert.equal((await ack(a.socket, 'daily:login')).ok, false, 'only once a day');

    // Push the first task to completion through the event pipeline.
    const p = server.world.players.get(A.character.id)!;
    const deps = { pool: server.pool, world: server.world, log: createLogger('error') };
    const task = tasksFor(p.id, 15)[0]!;
    assert.equal((await ack(a.socket, 'daily:task', task.id)).ok, false, 'not finished yet');
    progressEvent(deps, p, task.event as any, task.target ?? 'x', task.count);
    await waitFor(async () => (await ack(a.socket, 'journal:get')).data.tasks.find((t: any) => t.id === task.id).progress === task.count);
    const g1 = await gold(A.character.id);
    assert.equal((await ack(a.socket, 'daily:task', task.id)).ok, true);
    assert.equal(await gold(A.character.id), g1 + 30 + 15 * 8);
    assert.equal((await ack(a.socket, 'daily:task', task.id)).ok, false, 'claim once');

    // Kills feed counters: first kill unlocks First Blood (+20 Gold), once.
    progressEvent(deps, p, 'kill', 'green_slime', 1);
    await waitFor(() => toasts.some((t) => t.id === 'first_blood'));
    progressEvent(deps, p, 'kill', 'green_slime', 1);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(toasts.filter((t) => t.id === 'first_blood').length, 1);
    const j = await ack(a.socket, 'journal:get');
    assert.equal(j.data.achievements.find((x: any) => x.id === 'first_blood').progress, 1);
    assert.ok(j.data.achievements.find((x: any) => x.id === 'first_blood').unlockedAt);

    const lb = await ack(a.socket, 'leaderboard:get', 'level');
    assert.equal(lb.ok, true);
    assert.equal(lb.data.rows[0].name, A.character.name);
    assert.equal(lb.data.me.rank, 1);
    assert.equal((await ack(a.socket, 'leaderboard:get', 'nope')).ok, false);
    await leaveWorld(a.socket);
  });

  test('admin API: players only get 403; admins can mute, give, announce, ban', async () => {
    const Admin = await newPlayer(base);
    const Bad = await newPlayer(base);
    assert.equal((await Bad.browser.get('/api/admin/overview')).status, 403);
    await db.query(`UPDATE users SET roles = ARRAY['player','admin'] WHERE lower(email) = lower($1)`, [Admin.email]);
    const me = await Admin.browser.get('/api/auth/me');
    assert.ok(me.data.user.roles.includes('admin'));
    const bad = await enterWorld(base, Bad.browser.cookie, Bad.character.id);
    const chat: any[] = [];
    bad.socket.on('chat', (m) => chat.push(m));
    const ov = await Admin.browser.get('/api/admin/overview');
    assert.equal(ov.status, 200);
    assert.ok(ov.data.stats.online >= 1);

    assert.equal((await Admin.browser.post('/api/admin/mute', { characterId: Bad.character.id, minutes: 30 })).status, 200);
    const said = await ack(bad.socket, 'chat:send', 'can you hear me');
    assert.equal(said.ok, false, 'muted players cannot chat');
    assert.match(said.error, /muted/);

    const g0 = await gold(Bad.character.id);
    assert.equal((await Admin.browser.post('/api/admin/give', { characterId: Bad.character.id, gold: 123, itemId: 'carrot', quantity: 2 })).status, 200);
    assert.equal(await gold(Bad.character.id), g0 + 123);
    const led = await db.query(`SELECT count(*)::int AS n FROM currency_transactions WHERE character_id = $1 AND reason = 'admin'`, [Bad.character.id]);
    assert.equal(led.rows[0].n, 1, 'admin gifts are on the ledger');

    assert.equal((await Admin.browser.post('/api/admin/announce', { text: 'Server restart in 5 minutes' })).status, 200);
    await waitFor(() => chat.some((m) => m.text.includes('Server restart')));

    const players = await Admin.browser.get(`/api/admin/players?q=${encodeURIComponent(Bad.character.name)}`);
    const row = players.data.players[0];
    assert.equal(row.name, Bad.character.name);
    const ended = new Promise((r) => bad.socket.once('session:end', r));
    assert.equal((await Admin.browser.post('/api/admin/ban', { userId: row.user_id, days: 2, reason: 'spam' })).status, 200);
    await ended;
    assert.equal((await Bad.browser.get('/api/characters')).status, 401, 'sessions revoked');
    const log = await Admin.browser.get('/api/admin/log');
    assert.deepEqual(log.data.log.map((x: any) => x.action).slice(0, 4), ['ban', 'announce', 'give', 'mute']);
  });
});
