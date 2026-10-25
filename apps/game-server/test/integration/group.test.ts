import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { WORLD_BOSSES, guildWeek, setWorldBossOverride, tileCenter, worldBossBonus } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { guildQuestEvent, guildQuestsFor } from '../../src/net/guildQuests';
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
  setWorldBossOverride('off');
  await server?.stop();
  await db?.end();
});

async function player(map: string, tx: number, ty: number, level: number, gold = 0) {
  const A = await newPlayer(base, { classId: 'warrior' });
  const c = tileCenter(tx, ty);
  await db.query(`UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, level = $5, gold = $6 WHERE id = $1`, [A.character.id, map, c.x, c.y, level, gold]);
  const a = await enterWorld(base, A.browser.cookie, A.character.id);
  return { A, a, p: server.world.players.get(A.character.id)! };
}
const goldOf = async (id: string) => Number((await db.query(`SELECT gold FROM characters WHERE id = $1`, [id])).rows[0].gold);

describe('world bosses, party finder, guild quests', () => {
  test('a world boss appears on schedule; everyone who hits it gets loot; the top three get more', async () => {
    const def = WORLD_BOSSES[0]!;
    const A = await player(def.map, def.area.x + 2, def.area.y + 2, 40);
    const B = await player(def.map, def.area.x + 3, def.area.y + 2, 40);
    const announces: string[] = [];
    A.a.socket.on('announce', (t: string) => announces.push(t));
    setWorldBossOverride(0);
    const rt = server.world.runtimeOf(A.p);
    const boss = await waitFor(() => [...rt.monsters.values()].find((m) => m.def.id === def.monster && m.alive), 8000);
    assert.ok(boss.def.worldBoss && boss.stats.maxHp > 10000, `big: ${boss.stats.maxHp}`);
    assert.ok(announces.some((t) => t.includes(def.name)), 'server-wide announcement');

    for (const x of [A, B]) {
      x.p.rec.hp = x.p.profile.maxHp = 1_000_000;
      x.p.x = boss.x + (x === A ? 30 : -30);
      x.p.y = boss.y;
      rt.spatial.update(x.p);
    }
    const ga = await goldOf(A.A.character.id);
    const gb = await goldOf(B.A.character.id);
    // B lands a hit on the full-health boss, then A finishes it.
    await waitFor(async () => (await ack(B.a.socket, 'attack', boss.id)).ok && boss.damageBy.has(B.p.id), 4000);
    boss.hp = 1;
    for (let i = 0; i < 20 && boss.alive; i++) {
      await ack(A.a.socket, 'attack', boss.id);
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.equal(boss.alive, false);
    await waitFor(() => announces.some((t) => t.includes('has fallen')), 4000);
    await waitFor(async () => (await goldOf(A.A.character.id)) > ga && (await goldOf(B.A.character.id)) > gb, 5000);
    // Ranked by damage: B did far more (a real hit vs. a 1-HP finisher).
    assert.ok((await goldOf(B.A.character.id)) - gb >= worldBossBonus(1, boss.level).gold, 'first place bonus');
    assert.ok((await goldOf(A.A.character.id)) - ga >= worldBossBonus(2, boss.level).gold, 'second place bonus');
    setWorldBossOverride('off');
    await leaveWorld(A.a.socket);
    await leaveWorld(B.a.socket);
  });

  test('party finder: post, see it, join with one click; level limits apply', async () => {
    const A = await player('greenhaven', 30, 30, 20);
    const B = await player('greenhaven', 31, 30, 18);
    const C = await player('greenhaven', 32, 30, 5);
    const post = await ack(A.a.socket, 'party:post', { activity: 'Dungeon', note: 'Mossy Crypt run', minLevel: 15 });
    assert.equal(post.ok, true, JSON.stringify(post));
    assert.equal((await ack(A.a.socket, 'party:post', { activity: 'Nope' })).ok, false);
    const seen = await ack(B.a.socket, 'party:listings');
    const l = seen.data.listings.find((x: any) => x.leaderId === A.p.id);
    assert.ok(l && l.note === 'Mossy Crypt run' && l.members === 1);
    assert.equal((await ack(C.a.socket, 'party:join', A.p.id)).ok, false, 'too low');
    const join = await ack(B.a.socket, 'party:join', A.p.id);
    assert.equal(join.ok, true, JSON.stringify(join));
    assert.equal(A.p.party?.members.length, 2);
    assert.equal(B.p.party, A.p.party);
    const mine = await ack(A.a.socket, 'party:listings');
    assert.equal(mine.data.mine.members, 2);
    await ack(A.a.socket, 'party:unpost');
    assert.equal((await ack(C.a.socket, 'party:listings')).data.listings.some((x: any) => x.leaderId === A.p.id), false);
    for (const x of [A, B, C]) await leaveWorld(x.a.socket);
  });

  test('guild quests: shared progress, treasury bonus, helpers collect once', async () => {
    const A = await player('greenhaven', 30, 30, 30, 1000);
    const B = await player('greenhaven', 31, 30, 30, 0);
    const made = await ack(A.a.socket, 'guild:create', { name: 'Questers', tag: 'QST' });
    assert.equal(made.ok, true, JSON.stringify(made));
    const gid = A.p.guild!.id;
    await db.query(`INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, 'member')`, [gid, B.p.id]);
    B.p.guild = { id: gid, name: 'Questers', tag: 'QST', rank: 'member' };
    const view = await ack(A.a.socket, 'guild:quests');
    assert.equal(view.ok, true, JSON.stringify(view));
    assert.equal(view.data.quests.length, 3);
    const q = guildQuestsFor(gid, guildWeek(Date.now()))[0]!;
    // Make it a short goal for the test.
    await db.query(`INSERT INTO guild_quests (guild_id, week, quest_id, goal) VALUES ($1, $2, $3, 5)`, [gid, guildWeek(Date.now()), q.id]);
    const deps = { pool: db, world: server.world, log: { info() {}, error() {}, warn() {} } } as any;
    await guildQuestEvent(deps, A.p, q.event, 2);
    await guildQuestEvent(deps, B.p, q.event, 2);
    assert.equal((await ack(B.a.socket, 'guild:questClaim', q.id)).ok, false, 'not done yet');
    await guildQuestEvent(deps, B.p, q.event, 9);
    const t = await db.query(`SELECT treasury FROM guilds WHERE id = $1`, [gid]);
    assert.equal(Number(t.rows[0].treasury), 5000);
    const after = await ack(A.a.socket, 'guild:quests');
    const row = after.data.quests.find((x: any) => x.id === q.id);
    assert.equal(row.progress, 5);
    assert.equal(row.completed, true);
    assert.equal(row.mine, 2);
    const g0 = await goldOf(B.p.id);
    const claim = await ack(B.a.socket, 'guild:questClaim', q.id);
    assert.equal(claim.ok, true, JSON.stringify(claim));
    assert.ok((await goldOf(B.p.id)) > g0);
    assert.equal((await ack(B.a.socket, 'guild:questClaim', q.id)).ok, false, 'once');
    await leaveWorld(A.a.socket);
    await leaveWorld(B.a.socket);
  });
});
