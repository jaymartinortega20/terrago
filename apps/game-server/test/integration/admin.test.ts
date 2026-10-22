import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { BASE_OUTFIT_COUNT, OUTFITS, currentEvent, setManualEvent } from '@terrago/shared';
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
  setManualEvent(null);
  await server?.stop();
  await db?.end();
});

async function makeAdmin() {
  const Admin = await newPlayer(base);
  await db.query(`UPDATE users SET roles = ARRAY['player','admin'] WHERE lower(email) = lower($1)`, [Admin.email]);
  return Admin;
}

describe('admin tools (economy, flags, player detail, settings, events)', () => {
  test('economy dashboard: gold created by source, suspicious gifts; players get 403', async () => {
    const Admin = await makeAdmin();
    const A = await newPlayer(base);
    const B = await newPlayer(base);
    assert.equal((await A.browser.get('/api/admin/economy')).status, 403);
    assert.equal((await Admin.browser.post('/api/admin/give', { characterId: A.character.id, gold: 25000 })).status, 200);
    // A gives B lots of gold for nothing: a classic real-money-trading pattern.
    await db.query(`INSERT INTO direct_trade_logs (a_id, b_id, a_gold, b_gold) VALUES ($1, $2, 20000, 0)`, [A.character.id, B.character.id]);
    const res = await Admin.browser.get('/api/admin/economy?days=7');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const e = res.data;
    assert.equal(e.days, 7);
    assert.ok(e.sources.find((s: any) => s.reason === 'admin' && s.amount >= 25000), 'admin gold shows as a source');
    assert.ok(e.totals.created >= 25000);
    assert.ok(e.totals.supply >= 25000);
    assert.ok(e.daily.length >= 1);
    assert.ok(e.suspicious.giftTrades.some((t: any) => t.a_name === A.character.name && t.a_gold === 20000));
    assert.ok(Array.isArray(e.topItems) && Array.isArray(e.rare));
  });

  test('anti-bot flags can be reviewed; player detail shows inventory, gold history and flags', async () => {
    const Admin = await makeAdmin();
    const P = await newPlayer(base);
    const { rows } = await db.query(
      `INSERT INTO security_events (kind, character_id, details) VALUES ('bot_loop', $1, '{"actions30m": 400}') RETURNING id`,
      [P.character.id],
    );
    const id = Number(rows[0].id);
    const open = await Admin.browser.get('/api/admin/flags');
    assert.ok(open.data.flags.some((f: any) => Number(f.id) === id && f.character_name === P.character.name));
    assert.equal((await Admin.browser.post('/api/admin/flag', { id, verdict: 'cleared', note: 'was fishing AFK' })).status, 200);
    assert.equal((await Admin.browser.post('/api/admin/flag', { id, verdict: 'cleared' })).status, 404, 'only once');
    const after = await Admin.browser.get('/api/admin/flags');
    assert.ok(!after.data.flags.some((f: any) => Number(f.id) === id), 'reviewed flags leave the open list');
    const all = await Admin.browser.get('/api/admin/flags?status=all');
    assert.match(all.data.flags.find((f: any) => Number(f.id) === id).review_note, /cleared: was fishing AFK/);

    await Admin.browser.post('/api/admin/give', { characterId: P.character.id, gold: 77, itemId: 'carrot', quantity: 3 });
    const d = await Admin.browser.get(`/api/admin/player?id=${P.character.id}`);
    assert.equal(d.status, 200, JSON.stringify(d.data));
    assert.equal(d.data.character.name, P.character.name);
    assert.ok(d.data.items.some((i: any) => i.item_id === 'carrot' && i.quantity >= 3));
    assert.ok(d.data.gold.some((g: any) => g.reason === 'admin' && g.amount === 77));
    assert.ok(d.data.itemLog.some((t: any) => t.item_id === 'carrot'));
    assert.ok(d.data.flags.some((f: any) => f.kind === 'bot_loop'));
    assert.equal((await Admin.browser.get('/api/admin/player?id=nope')).status, 400);
  });

  test('settings: message of the day, closing registration, XP rate limits', async () => {
    const Admin = await makeAdmin();
    assert.equal((await Admin.browser.post('/api/admin/settings', { xpRate: 4 })).status, 400);
    const ok = await Admin.browser.post('/api/admin/settings', { motd: 'Welcome to the beta!', xpRate: 1.5 });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.settings.xpRate, 1.5);
    const P = await newPlayer(base);
    const s = await enterWorld(base, P.browser.cookie, P.character.id);
    const chat: any[] = [];
    s.socket.on('chat', (m) => chat.push(m));
    // The MOTD may arrive before the listener; it is also stored in settings.
    const st = await Admin.browser.get('/api/admin/settings');
    assert.equal(st.data.settings.motd, 'Welcome to the beta!');
    await leaveWorld(s.socket);

    await Admin.browser.post('/api/admin/settings', { registrationOpen: false });
    await assert.rejects(newPlayer(base), /closed/);
    await Admin.browser.post('/api/admin/settings', { registrationOpen: true, xpRate: 1, motd: '' });
    await newPlayer(base);
  });

  test('events: an admin starts a world event for everyone and stops it', async () => {
    const Admin = await makeAdmin();
    const P = await newPlayer(base);
    const s = await enterWorld(base, P.browser.cookie, P.character.id);
    const got: any[] = [];
    s.socket.on('event:manual', (ev) => got.push(ev));
    assert.equal((await Admin.browser.post('/api/admin/event', { id: 'nope' })).status, 400);
    const start = await Admin.browser.post('/api/admin/event', { id: 'double_xp', minutes: 30 });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    assert.equal(start.data.current.def.id, 'double_xp');
    await waitFor(() => got.find((e) => e?.id === 'double_xp'));
    assert.equal(currentEvent(Date.now())?.def.id, 'double_xp');
    const stop = await Admin.browser.post('/api/admin/event', { id: null });
    assert.equal(stop.status, 200);
    await waitFor(() => got.length === 2 && got[1] === null);
    assert.equal(currentEvent(Date.now()), null);
    await leaveWorld(s.socket);
  });

  test('game master: give lots of items and Gold, set Gold/level/professions, heal, waystones, teleport', async () => {
    const Admin = await makeAdmin();
    const P = await newPlayer(base);
    assert.equal((await P.browser.post('/api/admin/give', { characterId: P.character.id, gold: 5 })).status, 403, 'players cannot');
    const s = await enterWorld(base, P.browser.cookie, P.character.id);
    const g = await Admin.browser.post('/api/admin/give', {
      characterId: P.character.id,
      gold: 250_000_000,
      items: [
        { itemId: 'carrot', quantity: 500 },
        { itemId: 'star_metal_sword', quantity: 1 },
        { itemId: 'iron_ore', quantity: 9999 },
      ],
    });
    assert.equal(g.status, 200, JSON.stringify(g.data));
    assert.ok(g.data.bag > 0);
    const gold = await db.query('SELECT gold FROM characters WHERE id = $1', [P.character.id]);
    assert.ok(Number(gold.rows[0].gold) >= 250_000_000);
    assert.equal(server.world.players.get(P.character.id)!.rec.gold, Number(gold.rows[0].gold), 'online player sees it at once');
    assert.equal((await Admin.browser.post('/api/admin/give', { characterId: P.character.id, items: [{ itemId: 'nope', quantity: 1 }] })).status, 400);
    assert.equal((await Admin.browser.post('/api/admin/give', { characterId: P.character.id, gold: 2_000_000_000 })).status, 400);

    assert.equal((await Admin.browser.post('/api/admin/gold', { characterId: P.character.id, gold: 777 })).status, 200);
    assert.equal(Number((await db.query('SELECT gold FROM characters WHERE id = $1', [P.character.id])).rows[0].gold), 777);
    const led = await db.query(`SELECT count(*)::int AS n FROM currency_transactions WHERE character_id = $1 AND reason = 'admin'`, [P.character.id]);
    assert.ok(led.rows[0].n >= 2, 'every change is on the ledger');

    assert.equal((await Admin.browser.post('/api/admin/level', { characterId: P.character.id, level: 100, professions: 100 })).status, 200);
    const pl = server.world.players.get(P.character.id)!;
    assert.equal(pl.rec.level, 100);
    assert.equal(pl.rec.skills.mining.level, 100);
    assert.equal((await Admin.browser.post('/api/admin/level', { characterId: P.character.id, level: 101 })).status, 400);

    pl.rec.hp = 1;
    assert.equal((await Admin.browser.post('/api/admin/heal', { characterId: P.character.id })).status, 200);
    assert.equal(pl.rec.hp, pl.profile.maxHp);
    const w = await Admin.browser.post('/api/admin/waystones', { characterId: P.character.id });
    assert.ok(w.data.unlocked >= 5);
    assert.equal((await Admin.browser.post('/api/admin/teleport', { characterId: P.character.id, mapId: 'desolate_crags' })).status, 200);
    await waitFor(() => server.world.players.get(P.character.id)?.mapId === 'desolate_crags');
    assert.equal((await Admin.browser.post('/api/admin/teleport', { characterId: P.character.id, mapId: 'atlantis' })).status, 400);
    // Offline level-up: full HP when they come back (capped to the real maximum).
    const Q = await newPlayer(base);
    await Admin.browser.post('/api/admin/level', { characterId: Q.character.id, level: 50 });
    const q = await enterWorld(base, Q.browser.cookie, Q.character.id);
    const pq = server.world.players.get(Q.character.id)!;
    assert.equal(pq.rec.level, 50);
    assert.equal(pq.rec.hp, pq.profile.maxHp);
    await leaveWorld(q.socket);
    const mine = await Admin.browser.get('/api/admin/mine');
    assert.equal(mine.data.characters.length, 1);
    await leaveWorld(s.socket);
  });

  test('skins: admins give exclusive skins; players can only wear what they own', async () => {
    const Admin = await makeAdmin();
    const P = await newPlayer(base);
    const s = await enterWorld(base, P.browser.cookie, P.character.id);
    const royal = OUTFITS.findIndex((o) => o.name === 'Royal Regalia');
    assert.ok(royal >= BASE_OUTFIT_COUNT);
    const no = await ack(s.socket, 'wardrobe:set', royal);
    assert.equal(no.ok, false, 'not owned yet');
    assert.equal((await Admin.browser.post('/api/admin/skin', { characterId: P.character.id, outfit: 0 })).status, 400, 'starter outfits are not skins');
    const give = await Admin.browser.post('/api/admin/skin', { characterId: P.character.id, outfit: royal });
    assert.deepEqual(give.data.owned, [royal]);
    const yes = await ack(s.socket, 'wardrobe:set', royal);
    assert.equal(yes.ok, true, JSON.stringify(yes));
    assert.equal(server.world.players.get(P.character.id)!.rec.appearance.outfit, royal);
    const w = await ack(s.socket, 'wardrobe:get');
    assert.deepEqual(w.data, { outfit: royal, owned: [royal] });
    await Admin.browser.post('/api/admin/skin', { characterId: P.character.id, outfit: royal, revoke: true });
    assert.equal(server.world.players.get(P.character.id)!.rec.appearance.outfit, 0, 'taking a worn skin puts the starter outfit back on');
    // Nobody can pick a skin when creating a character.
    const bad = await P.browser.post('/api/characters', {
      name: 'Sneakyking',
      classId: 'warrior',
      appearance: { bodyType: 'a', skinTone: 1, hairStyle: 0, hairColor: 1, eyeColor: 0, outfit: royal },
    });
    assert.equal(bad.status, 400);
    await leaveWorld(s.socket);
  });
});
