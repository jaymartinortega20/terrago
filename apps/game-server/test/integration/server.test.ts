import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { io as ioClient } from 'socket.io-client';
import { CODE_DIR, PROTOCOL_VERSION, type Snapshot } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import {
  Browser,
  ORIGIN,
  TEST_DB,
  type TestSocket,
  ack,
  connectSocket,
  enterWorld,
  newPlayer,
  once,
  resetDatabase,
  startTestServer,
  waitFor,
  walk,
} from './helpers';

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

describe('accounts and sessions', () => {
  test('register sets a secure session cookie; me/logout work', async () => {
    const b = new Browser(base);
    const res = await b.post('/api/auth/register', { email: 'Alice@Example.com', password: 'a long enough password' });
    assert.equal(res.status, 200);
    assert.match(res.setCookie ?? '', /tg_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
    const me = await b.get('/api/auth/me');
    assert.equal(me.data.user.email, 'alice@example.com');

    const { rows } = await db.query(`SELECT password_hash FROM users WHERE email = 'alice@example.com'`);
    assert.match(rows[0].password_hash, /^scrypt\$/, 'password is hashed, never stored in plain text');
    assert.ok(!rows[0].password_hash.includes('a long enough password'));

    await b.post('/api/auth/logout');
    assert.equal((await b.get('/api/auth/me')).status, 401);
  });

  test('duplicate emails and weak passwords are rejected', async () => {
    const b = new Browser(base);
    await b.post('/api/auth/register', { email: 'dup@example.com', password: 'a long enough password' });
    const dup = await new Browser(base).post('/api/auth/register', { email: 'DUP@example.com', password: 'a long enough password' });
    assert.equal(dup.status, 409);
    const weak = await new Browser(base).post('/api/auth/register', { email: 'weak@example.com', password: 'short' });
    assert.equal(weak.status, 400);
  });

  test('wrong password is rejected generically and logged as a security event', async () => {
    const b = new Browser(base);
    await b.post('/api/auth/register', { email: 'bob@example.com', password: 'bobs secret password' });
    const bad = await new Browser(base).post('/api/auth/login', { email: 'bob@example.com', password: 'nope nope nope' });
    assert.equal(bad.status, 401);
    const unknown = await new Browser(base).post('/api/auth/login', { email: 'nobody@example.com', password: 'nope nope nope' });
    assert.equal(unknown.status, 401);
    assert.equal(bad.data.error, unknown.data.error, 'same message for unknown email and bad password');
    const ok = await new Browser(base).post('/api/auth/login', { email: 'bob@example.com', password: 'bobs secret password' });
    assert.equal(ok.status, 200);
    await waitFor(async () => true);
    const ev = await db.query(`SELECT count(*)::int AS n FROM security_events WHERE kind = 'login_failed'`);
    assert.ok(ev.rows[0].n >= 2);
  });

  test('CSRF: cross-site browser requests are refused; JSON only', async () => {
    const crossSite = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ email: 'x1@example.com', password: 'a long enough password' }),
    });
    assert.equal(crossSite.status, 403);
    const evil = await new Browser(base, 'https://evil.example').post('/api/auth/register', { email: 'x2@example.com', password: 'a long enough password' });
    assert.equal(evil.status, 403);
    const form = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=x3@example.com&password=aaaaaaaaaaaa',
    });
    assert.equal(form.status, 415);
  });
});

describe('characters', () => {
  test('creation grants the starter kit and starting gold through the ledgers', async () => {
    const { character } = await newPlayer(base);
    const gold = await db.query('SELECT gold FROM characters WHERE id = $1', [character.id]);
    assert.equal(gold.rows[0].gold, 25);
    const ledger = await db.query('SELECT amount, balance_before, balance_after, reason FROM currency_transactions WHERE character_id = $1', [character.id]);
    assert.deepEqual(ledger.rows, [{ amount: 25, balance_before: 0, balance_after: 25, reason: 'character_creation' }]);
    const items = await db.query(`SELECT item_id, quantity FROM inventory_items WHERE character_id = $1 ORDER BY slot`, [character.id]);
    assert.deepEqual(
      items.rows.map((r) => `${r.item_id}x${r.quantity}`),
      ['worn_hoe x1', 'leaky_watering_can x1', 'carrot_seed x6', 'travelers_bread x3'].map((s) => s.replace(' ', '')),
    );
    const tx = await db.query(`SELECT count(*)::int AS n FROM item_transactions WHERE to_character_id = $1 AND reason = 'starter_kit'`, [character.id]);
    assert.equal(tx.rows[0].n, 4);
  });

  test('names are unique (case-insensitive) and validated; three characters max', async () => {
    const { browser } = await newPlayer(base, { name: 'Unique_One' });
    const look = { bodyType: 'b', skinTone: 0, hairStyle: 0, hairColor: 0, eyeColor: 0, outfit: 0 };
    const taken = await browser.post('/api/characters', { name: 'unique_one', classId: 'mage', appearance: look });
    assert.equal(taken.status, 409);
    const bad = await browser.post('/api/characters', { name: 'Admin_Bob', classId: 'mage', appearance: look });
    assert.equal(bad.status, 400);
    const hack = await browser.post('/api/characters', { name: 'Hacker', classId: 'mage', appearance: { ...look, hairStyle: 999 } });
    assert.equal(hack.status, 400);
    assert.equal((await browser.post('/api/characters', { name: 'SecondChar', classId: 'mage', appearance: look })).status, 200);
    assert.equal((await browser.post('/api/characters', { name: 'ThirdChar', classId: 'rogue', appearance: look })).status, 200);
    const fourth = await browser.post('/api/characters', { name: 'FourthChar', classId: 'rogue', appearance: look });
    assert.equal(fourth.status, 400);
    assert.match(fourth.data.error, /at most 3/);
    const list = await browser.get('/api/characters');
    assert.equal(list.data.characters.length, 3);
  });
});

describe('multiplayer world', () => {
  test('VERSION 0.1 SUCCESS TEST (protocol level): see each other, move, chat, reconnect with saved data', async () => {
    const A = await newPlayer(base);
    const B = await newPlayer(base);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    assert.equal(a.enter.map.id, 'greenhaven');
    assert.equal(b.enter.map.id, 'greenhaven');

    // Each sees the other.
    const bSnaps: Snapshot[] = [];
    b.socket.on('snap', (s) => bSnaps.push(s));
    const aSeesB = once<any[]>(a.socket, 'entity:add');
    const bSeesA = once<any[]>(b.socket, 'entity:add');
    // (B's add for A may already have been sent when B joined)
    const [addedForA] = await Promise.all([aSeesB.catch(() => null), bSeesA.catch(() => null)]);
    void addedForA;
    await waitFor(() => bSnaps.some((s) => s.e.some((e) => e[0] === A.character.id)));

    // A walks right; B sees A's position change in snapshots.
    const startX = bSnaps.at(-1)!.e.find((e) => e[0] === A.character.id)![1];
    await walk(a.socket, 0, 1, 0, 10);
    await waitFor(() => {
      const row = bSnaps.at(-1)?.e.find((e) => e[0] === A.character.id);
      return row && row[1] > startX + 40;
    });

    // A says hello, B hears it.
    const heard = once<any>(b.socket, 'chat');
    const sent = await ack(a.socket, 'chat:send', 'Hello');
    assert.equal(sent.ok, true);
    const msg = await heard;
    assert.equal(msg.text, 'Hello');
    assert.equal(msg.fromName, A.character.name);

    // A "refreshes": disconnect + reconnect; comes back where it was.
    const before = (await waitFor(() => bSnaps.at(-1)?.e.find((e) => e[0] === A.character.id)))!;
    a.socket.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    const again = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.ok(Math.abs(again.enter.position.x - before[1]) < 1, 'position restored');
    assert.equal(again.enter.self.name, A.character.name);
    assert.equal(server.world.players.size >= 2, true);
    const saved = await db.query('SELECT pos_x FROM characters WHERE id = $1', [A.character.id]);
    assert.ok(Math.abs(saved.rows[0].pos_x - before[1]) < 1, 'position persisted on disconnect');

    again.socket.disconnect();
    b.socket.disconnect();
  });

  test('cannot enter the world with someone else\'s character, or without a session', async () => {
    const A = await newPlayer(base);
    const B = await newPlayer(base);
    const s = connectSocket(base, B.browser.cookie, A.character.id);
    const err = await once<Error>(s as any, 'connect_error');
    assert.match(err.message, /Character not found/);
    s.disconnect();
    const anon = connectSocket(base, '', A.character.id);
    const err2 = await once<Error>(anon as any, 'connect_error');
    assert.match(err2.message, /log in/i);
    anon.disconnect();
  });

  test('one-time game tickets let the game connect from another site, exactly once', async () => {
    const A = await newPlayer(base);
    const B = await newPlayer(base);
    const issue = (who: typeof A, characterId: string) => who.browser.post('/api/game/ticket', { characterId });
    const t1 = (await issue(A, A.character.id)).data.ticket as string;
    assert.ok(t1 && t1.length >= 32);

    const connectWithTicket = (ticket: string, characterId: string) =>
      ioClient(base, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        extraHeaders: { origin: ORIGIN }, // no cookie: like a browser on vercel.app talking to onrender.com
        auth: { characterId, protocol: PROTOCOL_VERSION, ticket },
      }) as unknown as TestSocket;

    const ok = connectWithTicket(t1, A.character.id);
    const enter = await once<any>(ok, 'world:enter');
    assert.equal(enter.self.name, A.character.name);
    ok.disconnect();

    const reused = connectWithTicket(t1, A.character.id);
    assert.match((await once<Error>(reused as any, 'connect_error')).message, /log in/i);
    reused.disconnect();

    const t2 = (await issue(A, A.character.id)).data.ticket as string;
    const wrongChar = connectWithTicket(t2, B.character.id);
    await once(wrongChar as any, 'connect_error');
    wrongChar.disconnect();

    const t3 = (await issue(A, A.character.id)).data.ticket as string;
    await A.browser.post('/api/auth/logout');
    const afterLogout = connectWithTicket(t3, A.character.id);
    await once(afterLogout as any, 'connect_error');
    afterLogout.disconnect();

    assert.equal((await new Browser(base).post('/api/game/ticket', { characterId: A.character.id })).status, 401);
  });

  test('cross-site WebSocket connections are refused', async () => {
    const A = await newPlayer(base);
    const s = connectSocket(base, A.browser.cookie, A.character.id, 'https://evil.example');
    await once(s as any, 'connect_error');
    s.disconnect();
  });

  test('the server ignores teleport attempts and malformed packets', async () => {
    const A = await newPlayer(base);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const start = a.enter.position;
    const emitAny = a.socket as unknown as { emit: (...x: unknown[]) => void };
    emitAny.emit('move', { x: 10, y: 10 });
    emitAny.emit('move', [1, 99, 0]);
    emitAny.emit('inventory:move', 'garbage', () => {});
    emitAny.emit('npc:interact', { $where: 1 }, () => {});
    emitAny.emit('chat:send', 'no ack');
    const snap = await once<Snapshot>(a.socket, 'snap');
    assert.equal(snap.x, start.x);
    assert.equal(snap.y, start.y);
    assert.equal(CODE_DIR[snap.dir], start.dir);
    assert.equal(a.socket.connected, true, 'still connected, server healthy');
    a.socket.disconnect();
  });

  test('event floods get the socket disconnected', async () => {
    const A = await newPlayer(base);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const gone = once(a.socket, 'disconnect', 5000);
    for (let i = 0; i < 400; i++) a.socket.emit('ping:check', i, () => {});
    await gone;
    // Security events are written asynchronously (never on the hot path).
    let n = 0;
    for (let i = 0; i < 40 && n === 0; i++) {
      const ev = await db.query(`SELECT count(*)::int AS n FROM security_events WHERE kind = 'socket_flood' AND character_id = $1`, [A.character.id]);
      n = ev.rows[0].n;
      if (n === 0) await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(n, 1);
  });
});

describe('NPCs and inventory', () => {
  test('Mayor Lina: range-checked, first-meeting gift granted exactly once even under concurrent requests', async () => {
    const A = await newPlayer(base);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const far = await ack(a.socket, 'npc:interact', 'mayor_lina');
    assert.equal(far.ok, false);
    assert.match(far.error, /too far/);

    // Walk from the spawn point to Lina (left 2 tiles, up 4 tiles).
    let seq = await walk(a.socket, 0, -1, 0, 12);
    seq = await walk(a.socket, seq, 0, -1, 23);
    await new Promise((r) => setTimeout(r, 300));

    const results = await Promise.all(Array.from({ length: 5 }, () => ack(a.socket, 'npc:interact', 'mayor_lina')));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.find((r) => !r.ok)));
    const withRewards = results.filter((r) => r.data.rewards?.length);
    assert.equal(withRewards.length, 1, 'reward granted exactly once');
    const buns = await db.query(`SELECT coalesce(sum(quantity),0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'honey_bun'`, [A.character.id]);
    assert.equal(buns.rows[0].n, 2);
    const charter = await db.query(`SELECT bound FROM inventory_items WHERE character_id = $1 AND item_id = 'greenhaven_charter'`, [A.character.id]);
    assert.equal(charter.rows[0].bound, true);
    a.socket.disconnect();
  });

  test('inventory move and use persist, consumables restore Energy, tools cannot be eaten', async () => {
    const A = await newPlayer(base);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.equal(a.enter.self.energy, 80);
    const breadSlot = a.enter.inventory.slots.find((s) => s.itemId === 'travelers_bread')!.slot;

    const moved = await ack(a.socket, 'inventory:move', { from: breadSlot, to: 15 });
    assert.equal(moved.ok, true);
    assert.equal(moved.data.slots.find((s: any) => s.itemId === 'travelers_bread').slot, 15);

    const energyUpdate = once<any>(a.socket, 'self:update');
    const used = await ack(a.socket, 'inventory:use', { slot: 15 });
    assert.equal(used.ok, true, JSON.stringify(used));
    assert.equal((await energyUpdate).energy, 95);
    assert.equal(used.data.inventory.slots.find((s: any) => s.slot === 15).quantity, 2);

    const hoe = await ack(a.socket, 'inventory:use', { slot: 0 });
    assert.equal(hoe.ok, false);
    const invalid = await ack(a.socket, 'inventory:move', { from: 0, to: 99 });
    assert.equal(invalid.ok, false);

    // Persisted: reload from the database.
    const row = await db.query(`SELECT slot, quantity FROM inventory_items WHERE character_id = $1 AND item_id = 'travelers_bread'`, [A.character.id]);
    assert.deepEqual(row.rows[0], { slot: 15, quantity: 2 });
    const st = await db.query('SELECT energy FROM character_stats WHERE character_id = $1', [A.character.id]);
    assert.equal(st.rows[0].energy, 95);
    const consumed = await db.query(`SELECT count(*)::int AS n FROM item_transactions WHERE from_character_id = $1 AND reason = 'consume'`, [A.character.id]);
    assert.equal(consumed.rows[0].n, 1);
    a.socket.disconnect();
  });

  test('concurrent inventory moves never duplicate items', async () => {
    const A = await newPlayer(base);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const ops = Array.from({ length: 40 }, (_, i) => ack(a.socket, 'inventory:move', { from: i % 5, to: (i * 7) % 20 }));
    await Promise.all(ops);
    const totals = await db.query(
      `SELECT item_id, sum(quantity)::int AS n FROM inventory_items WHERE character_id = $1 GROUP BY item_id ORDER BY item_id`,
      [A.character.id],
    );
    assert.deepEqual(
      Object.fromEntries(totals.rows.map((r) => [r.item_id, r.n])),
      { carrot_seed: 6, leaky_watering_can: 1, travelers_bread: 3, worn_hoe: 1 },
    );
    a.socket.disconnect();
  });
});

describe('persistence across a server restart', () => {
  test('positions and inventory survive a restart', async () => {
    const A = await newPlayer(base);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    await walk(a.socket, 0, 0, 1, 8);
    const snap = await once<Snapshot>(a.socket, 'snap');
    await ack(a.socket, 'inventory:move', { from: 2, to: 19 });

    await server.stop();
    server = await startTestServer();
    base = `http://127.0.0.1:${server.port()}`;
    A.browser = Object.assign(new Browser(base), { cookie: A.browser.cookie });

    const again = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.ok(Math.abs(again.enter.position.y - snap.y) < 6, `y ${again.enter.position.y} vs ${snap.y}`);
    assert.equal(again.enter.inventory.slots.find((s) => s.itemId === 'carrot_seed')?.slot, 19);
    again.socket.disconnect();
  });

  test('metrics are available locally', async () => {
    const res = await new Browser(base).get('/metrics');
    assert.equal(res.status, 200);
    assert.ok(res.data.metrics.tickMs);
    const health = await new Browser(base).get('/healthz');
    assert.equal(health.data.status, 'healthy');
  });
});
