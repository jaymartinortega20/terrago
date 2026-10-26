import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { OUTFITS } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { TEST_DB, ack, enterWorld, leaveWorld, newPlayer, resetDatabase, startTestServer } from './helpers';

let server: GameServer;
let base: string;
let db: pg.Pool;
let mock: http.Server;
const sessions: { body: any; auth: string | undefined }[] = [];
const SECRET = 'whsk_test_secret';

before(async () => {
  await resetDatabase();
  // A stand-in for PayMongo's API: records the checkout and returns a session.
  mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      sessions.push({ body: JSON.parse(raw), auth: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { id: `cs_test_${sessions.length}`, type: 'checkout_session', attributes: { checkout_url: `https://checkout.example/${sessions.length}` } } }));
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  const port = (mock.address() as { port: number }).port;
  server = await startTestServer({
    PAYMONGO_SECRET_KEY: 'sk_test_abc',
    PAYMONGO_WEBHOOK_SECRET: SECRET,
    PAYMONGO_API_URL: `http://127.0.0.1:${port}/v1`,
    PUBLIC_WEB_URL: 'https://terrago.example',
  });
  base = `http://127.0.0.1:${server.port()}`;
  db = new pg.Pool({ connectionString: TEST_DB, max: 4 });
});

after(async () => {
  await server?.stop();
  await db?.end();
  mock?.close();
});

function paidEvent(orderId: string, sessionId: string, amount: number) {
  return JSON.stringify({
    data: {
      id: 'evt_1',
      type: 'event',
      attributes: {
        type: 'checkout_session.payment.paid',
        livemode: false,
        data: { id: sessionId, type: 'checkout_session', attributes: { reference_number: orderId, payments: [{ attributes: { amount, status: 'paid' } }] } },
      },
    },
  });
}

async function webhook(raw: string, sign = true) {
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
  return fetch(`${base}/api/payments/paymongo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': `t=${t},te=${sign ? sig : 'bad'},li=` },
    body: raw,
  });
}

describe('gems', () => {
  test('buy Gems through PayMongo checkout: only a signed webhook credits them, exactly once', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const s0 = await ack(a.socket, 'gems:get');
    assert.equal(s0.data.balance, 0);
    assert.equal(s0.data.payments, 'test');
    const balances: number[] = [];
    a.socket.on('gems', (g: { balance: number }) => balances.push(g.balance));

    const co = await ack(a.socket, 'gems:checkout', 'gems_550');
    assert.equal(co.ok, true, JSON.stringify(co));
    assert.equal(co.data.url, 'https://checkout.example/1');
    const sent = sessions[0]!;
    assert.match(sent.auth!, /^Basic /);
    assert.equal(Buffer.from(sent.auth!.slice(6), 'base64').toString(), 'sk_test_abc:');
    assert.equal(sent.body.data.attributes.line_items[0].amount, 24900);
    assert.equal(sent.body.data.attributes.reference_number, co.data.orderId);
    assert.ok(sent.body.data.attributes.success_url.startsWith('https://terrago.example/gems?order='));
    assert.equal((await ack(a.socket, 'gems:checkout', 'free_gems')).ok, false);

    const raw = paidEvent(co.data.orderId, 'cs_test_1', 24900);
    assert.equal((await webhook(raw, false)).status, 401, 'unsigned events are ignored');
    assert.equal((await ack(a.socket, 'gems:get')).data.balance, 0);
    assert.equal((await webhook(paidEvent(co.data.orderId, 'cs_test_1', 100))).status, 200, 'underpaid: acknowledged…');
    assert.equal((await ack(a.socket, 'gems:get')).data.balance, 0, '…but nothing credited');
    assert.equal((await webhook(paidEvent(co.data.orderId, 'cs_other', 24900))).status, 200);
    assert.equal((await ack(a.socket, 'gems:get')).data.balance, 0, 'wrong checkout session: nothing credited');
    assert.equal((await webhook(raw)).status, 200);
    assert.equal((await webhook(raw)).status, 200, 'retries are fine');
    const s1 = await ack(a.socket, 'gems:get');
    assert.equal(s1.data.balance, 550, 'credited once');
    assert.ok(balances.includes(550), 'pushed to the game');
    assert.equal(s1.data.history[0].reason, 'purchase');
    const order = await db.query(`SELECT status FROM gem_orders WHERE id = $1`, [co.data.orderId]);
    assert.equal(order.rows[0].status, 'paid');

    // Spend: an outfit for the whole account.
    assert.equal((await ack(a.socket, 'gems:buy', 'skin_shadow_ronin')).ok, false, '700 > 550');
    const buy = await ack(a.socket, 'gems:buy', 'mount_saddle_starlight');
    assert.equal(buy.ok, true, JSON.stringify(buy));
    assert.equal(buy.data.balance, 250);
    assert.equal((await ack(a.socket, 'gems:buy', 'mount_saddle_starlight')).ok, false, 'owned already');
    const stable = await ack(a.socket, 'mount:stable');
    assert.ok(stable.data.styles.includes('saddle_starlight'), 'usable in the stable');
    await db.query(`UPDATE gem_wallets SET balance = 1000 WHERE user_id = (SELECT user_id FROM characters WHERE id = $1)`, [A.character.id]);
    assert.equal((await ack(a.socket, 'gems:buy', 'skin_shadow_ronin')).ok, true);
    const idx = OUTFITS.findIndex((o) => o.name === 'Shadow Ronin');
    const w = await ack(a.socket, 'wardrobe:get');
    assert.ok(w.data.owned.includes(idx));
    assert.equal((await ack(a.socket, 'wardrobe:set', idx)).ok, true);
    await leaveWorld(a.socket);
  });

  test('sell items for Gems on the marketplace (10% tax, no listing fee)', async () => {
    const S = await newPlayer(base, { classId: 'warrior' });
    const B = await newPlayer(base, { classId: 'warrior' });
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', 20, 'iron_sword', 1, 160)`, [S.character.id]);
    await db.query(`INSERT INTO gem_wallets (user_id, balance) SELECT user_id, 300 FROM characters WHERE id = $1`, [B.character.id]);
    const s = await enterWorld(base, S.browser.cookie, S.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    const gold0 = Number((await db.query(`SELECT gold FROM characters WHERE id = $1`, [S.character.id])).rows[0].gold);
    const listed = await ack(s.socket, 'market:list', { slot: 20, quantity: 1, unitPrice: 200, currency: 'gems' });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.equal(Number((await db.query(`SELECT gold FROM characters WHERE id = $1`, [S.character.id])).rows[0].gold), gold0, 'no Gold fee');
    const found = await ack(b.socket, 'market:search', { currency: 'gems' });
    const l = found.data.listings.find((x: any) => x.itemId === 'iron_sword');
    assert.equal(l.currency, 'gems');
    assert.equal((await ack(b.socket, 'market:search', { currency: 'gold' })).data.listings.some((x: any) => x.id === l.id), false);
    const bought = await ack(b.socket, 'market:buy', l.id);
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.equal((await ack(b.socket, 'gems:get')).data.balance, 100);
    assert.equal((await ack(s.socket, 'gems:get')).data.balance, 180, '200 minus 10% tax');
    await leaveWorld(s.socket);
    await leaveWorld(b.socket);
  });
});
