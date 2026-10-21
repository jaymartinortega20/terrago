import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { tileCenter, type ChatMessage, type GuildView, type InvitePayload, type PartyView, type PublicMonster } from '@terrago/shared';
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

async function place(id: string, mapId: string, tx: number, ty: number) {
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4 WHERE id = $1', [id, mapId, c.x, c.y]);
}

/** Two (or more) logged-in players with chat/invite/party/guild listeners. */
async function crew(n: number, mapId = 'greenhaven', tx = 31, ty = 26) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = await newPlayer(base, { classId: 'warrior' });
    await db.query('UPDATE characters SET level = 3, gold = 2000 WHERE id = $1', [P.character.id]);
    await place(P.character.id, mapId, tx + i, ty);
    const s = await enterWorld(base, P.browser.cookie, P.character.id);
    const box = { chat: [] as ChatMessage[], invites: [] as InvitePayload[], party: null as PartyView | null, guild: null as GuildView | null };
    s.socket.on('chat', (m) => box.chat.push(m));
    s.socket.on('invite', (v) => box.invites.push(v));
    s.socket.on('party', (v) => (box.party = v));
    s.socket.on('guild', (v) => (box.guild = v));
    out.push({ ...P, ...s, box, id: P.character.id, name: P.character.name });
  }
  return out;
}
const say = (s: any, text: string) => ack(s.socket, 'chat:send', text);

describe('social (v0.6)', () => {
  test('party: invite, accept, party chat, shared XP and kill credit, leave', async () => {
    const [A, B, C] = await crew(3, 'sunfield_plains', 45, 10);
    assert.equal((await ack(A!.socket, 'party:invite', B!.id)).ok, true);
    await waitFor(() => B!.box.invites.find((i) => i.kind === 'party'));
    assert.equal((await ack(B!.socket, 'invite:respond', { kind: 'party', fromId: A!.id, accept: true })).ok, true);
    await waitFor(() => A!.box.party?.members.length === 2);
    assert.equal(A!.box.party!.leaderId, A!.id);
    assert.equal((await ack(B!.socket, 'party:invite', C!.id)).ok, false, 'only the leader invites');

    await say(A, '/p hello team');
    await waitFor(() => B!.box.chat.find((m) => m.channel === 'party' && m.text === 'hello team'));
    assert.ok(!C!.box.chat.some((m) => m.channel === 'party'), 'outsiders do not see party chat');

    // A kills a slime alone; B (in party, nearby) shares the XP and gets kill credit.
    const pa = server.world.players.get(A!.id)!;
    const pb = server.world.players.get(B!.id)!;
    const rt = server.world.runtimeOf(pa);
    const m = [...rt.monsters.values()].find((x) => x.def.id === 'green_slime' && x.alive)!;
    pa.x = m.x;
    pa.y = m.y + 20;
    rt.spatial.update(pa);
    const xpA = pa.rec.xp;
    const xpB = pb.rec.xp;
    for (let i = 0; i < 40 && m.alive; i++) {
      await ack(A!.socket, 'attack', m.id);
      await new Promise((r) => setTimeout(r, 600));
    }
    assert.equal(m.alive, false);
    await waitFor(() => pb.rec.xp > xpB && pa.rec.xp > xpA);
    const gainA = pa.rec.xp - xpA;
    const gainB = pb.rec.xp - xpB;
    assert.ok(Math.abs(gainA - gainB) <= 1, `even split ${gainA} vs ${gainB}`);
    assert.ok(gainA + gainB > m.stats.xp, 'party bonus: more XP in total than solo');

    assert.equal((await ack(B!.socket, 'party:leave')).ok, true);
    await waitFor(() => A!.box.party === null);
    for (const x of [A, B, C]) await leaveWorld(x!.socket);
  });

  test('world chat, whispers, /r, mute and block', async () => {
    const [A, B, C] = await crew(3);
    await say(A, '/g hello world');
    await waitFor(() => C!.box.chat.find((m) => m.channel === 'global' && m.text === 'hello world'));
    const cool = await say(A, '/g again');
    assert.equal(cool.ok, true);
    await waitFor(() => A!.box.chat.find((m) => m.channel === 'system' && /wait/.test(m.text)));

    await say(A, `/w ${B!.name} psst`);
    await waitFor(() => B!.box.chat.find((m) => m.channel === 'whisper' && m.text === 'psst'));
    assert.ok(!C!.box.chat.some((m) => m.channel === 'whisper'), 'whispers are private');
    await say(B, '/r hi back');
    await waitFor(() => A!.box.chat.find((m) => m.channel === 'whisper' && m.text === 'hi back' && m.fromId === B!.id));

    // B mutes A: A's local/world chat no longer reaches B.
    assert.equal((await ack(B!.socket, 'block:set', { targetId: A!.id, kind: 'mute' })).ok, true);
    await say(A, 'local after mute');
    await waitFor(() => C!.box.chat.find((m) => m.text === 'local after mute'));
    assert.ok(!B!.box.chat.some((m) => m.text === 'local after mute'));
    // Block: no whispers, trades or invites.
    await ack(B!.socket, 'block:set', { targetId: A!.id, kind: 'block' });
    await say(A, `/w ${B!.name} let me in`);
    await waitFor(() => A!.box.chat.find((m) => m.channel === 'system' && /isn't accepting whispers/.test(m.text)));
    assert.equal((await ack(A!.socket, 'trade:request', B!.id)).ok, false);
    assert.equal((await ack(A!.socket, 'party:invite', B!.id)).ok, false);
    const fv = await ack(B!.socket, 'friends:get');
    assert.deepEqual(fv.data.blocked.map((x: any) => x.kind), ['block']);

    const rep = await ack(B!.socket, 'report', { targetId: A!.id, reason: 'spamming the chat' });
    assert.equal(rep.ok, true);
    const row = await db.query('SELECT reason, context FROM player_reports WHERE target_id = $1', [A!.id]);
    assert.equal(row.rows[0].reason, 'spamming the chat');
    assert.ok(row.rows[0].context.some((c: any) => c.text === 'hello world'), 'report carries recent lines');
    for (const x of [A, B, C]) await leaveWorld(x!.socket);
  });

  test('friends: request, accept, online list, remove; profile', async () => {
    const [A, B] = await crew(2);
    assert.equal((await ack(A!.socket, 'friends:add', B!.name)).ok, true);
    await waitFor(() => B!.box.invites.find((i) => i.kind === 'friend'));
    await ack(B!.socket, 'invite:respond', { kind: 'friend', fromId: A!.id, accept: true });
    const fa = await ack(A!.socket, 'friends:get');
    assert.equal(fa.data.friends[0].name, B!.name);
    assert.equal(fa.data.friends[0].online, true);
    const prof = await ack(A!.socket, 'profile:get', B!.name);
    assert.equal(prof.ok, true);
    assert.equal(prof.data.friend, true);
    assert.equal(prof.data.level, 3);
    await ack(A!.socket, 'friends:remove', B!.id);
    const n = await db.query('SELECT count(*)::int AS n FROM friendships WHERE character_id = $1 OR friend_id = $1', [A!.id]);
    assert.equal(n.rows[0].n, 0);
    for (const x of [A, B]) await leaveWorld(x!.socket);
  });

  test('guilds: create (costs gold), invite, chat, ranks, treasury, leadership hand-over', async () => {
    const [A, B, C] = await crew(3);
    const bad = await ack(A!.socket, 'guild:create', { name: 'x', tag: 'TOOLONG' });
    assert.equal(bad.ok, false);
    const made = await ack(A!.socket, 'guild:create', { name: 'Iron Roots', tag: 'IRT' });
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(Number((await db.query('SELECT gold FROM characters WHERE id = $1', [A!.id])).rows[0].gold), 1500);
    assert.equal((await ack(B!.socket, 'guild:create', { name: 'iron roots', tag: 'ZZ' })).ok, false, 'names are unique');

    await ack(A!.socket, 'guild:invite', B!.name);
    await waitFor(() => B!.box.invites.find((i) => i.kind === 'guild'));
    assert.equal((await ack(B!.socket, 'invite:respond', { kind: 'guild', fromId: A!.id, accept: true })).ok, true);
    await waitFor(() => A!.box.guild?.members.length === 2);
    assert.equal(server.world.players.get(B!.id)!.toPublic().guild, 'IRT', 'tag shows on the character');
    assert.equal((await ack(B!.socket, 'guild:invite', C!.name)).ok, false, 'members cannot invite');

    await say(B, '/gu for the roots!');
    await waitFor(() => A!.box.chat.find((m) => m.channel === 'guild' && m.text === 'for the roots!'));
    assert.ok(!C!.box.chat.some((m) => m.text === 'for the roots!'));

    assert.equal((await ack(B!.socket, 'guild:treasury', { amount: 300 })).ok, true);
    assert.equal((await ack(B!.socket, 'guild:treasury', { amount: -100 })).ok, false, 'only the leader withdraws');
    assert.equal((await ack(A!.socket, 'guild:treasury', { amount: -100 })).ok, true);
    const t = await db.query('SELECT treasury FROM guilds WHERE tag = $1', ['IRT']);
    assert.equal(Number(t.rows[0].treasury), 200);

    assert.equal((await ack(A!.socket, 'guild:rank', { id: B!.id, rank: 'officer' })).ok, true);
    await waitFor(() => B!.box.guild?.myRank === 'officer');
    // Leader leaves: the officer takes over.
    await ack(A!.socket, 'guild:leave');
    await waitFor(() => B!.box.guild?.myRank === 'leader');
    assert.equal(server.world.players.get(A!.id)!.guild, null);
    await ack(B!.socket, 'guild:leave');
    const left = await db.query('SELECT count(*)::int AS n FROM guilds WHERE tag = $1', ['IRT']);
    assert.equal(left.rows[0].n, 0, 'last one out disbands the guild');
    for (const x of [A, B, C]) await leaveWorld(x!.socket);
  });
});
