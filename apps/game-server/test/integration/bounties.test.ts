import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { QUESTS } from '@terrago/game-data';
import { tileCenter } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { bountyOffers } from '../../src/net/bounties';
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

async function atWren(level: number, done: string[] = []) {
  const A = await newPlayer(base, { classId: 'warrior' });
  const c = tileCenter(27, 24); // next to Ranger Wren
  await db.query(`UPDATE characters SET map_id = 'sunfield_plains', pos_x = $2, pos_y = $3, level = $4 WHERE id = $1`, [A.character.id, c.x, c.y, level]);
  for (const q of done) await db.query(`INSERT INTO quest_progress (character_id, quest_id, step, done) VALUES ($1, $2, 99, true)`, [A.character.id, q]);
  const a = await enterWorld(base, A.browser.cookie, A.character.id);
  return { A, a, p: server.world.players.get(A.character.id)! };
}

describe('story chains and bounties', () => {
  test('every map has a story chain, and every step knows where to go', () => {
    const chains = new Set(QUESTS.map((q) => q.chain).filter(Boolean));
    assert.ok(chains.size >= 5, [...chains].join(', '));
    const missing = QUESTS.flatMap((q) => q.steps.filter((s) => (s.type === 'kill' || s.type === 'talk') && !s.where && q.id !== 'q_crypt').map((s) => `${q.id}: ${s.text}`));
    assert.deepEqual(missing, []);
  });

  test('chain quests open by level', async () => {
    const { a } = await atWren(1, ['q_pony']);
    const low = await ack(a.socket, 'quest:accept', { npcId: 'ranger_wren', questId: 'q_sf_rats' });
    assert.equal(low.ok, false, 'level 1 is too low');
    await leaveWorld(a.socket);
    const { a: b } = await atWren(3, ['q_pony']);
    const ok = await ack(b.socket, 'quest:accept', { npcId: 'ranger_wren', questId: 'q_sf_rats' });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    await leaveWorld(b.socket);
  });

  test('three daily bounties for your level: accept, hunt, hand in', async () => {
    const { A, a, p } = await atWren(5);
    const offers = bountyOffers(A.character.id, 5);
    assert.equal(new Set(offers.map((o) => o.c.monsterId)).size, 3, 'three different monsters');
    const board = await ack(a.socket, 'bounty:board', 'ranger_wren');
    assert.equal(board.ok, true, JSON.stringify(board));
    assert.equal(board.data.bounties.length, 3);
    const easy = board.data.bounties[0];
    assert.equal(easy.tier, 'Easy');
    assert.equal(easy.where.map, 'sunfield_plains');

    const acc = await ack(a.socket, 'bounty:accept', { npcId: 'ranger_wren', idx: 0 });
    assert.equal(acc.ok, true, JSON.stringify(acc));
    assert.equal(acc.data.bounties[0].accepted, true);
    assert.equal((await ack(a.socket, 'bounty:accept', { npcId: 'ranger_wren', idx: 0 })).ok, false, 'only once');
    assert.equal((await ack(a.socket, 'bounty:claim', { npcId: 'ranger_wren', idx: 0 })).ok, false, 'not finished yet');

    // A real kill counts.
    const rt = server.world.runtimeOf(p);
    const m = [...rt.monsters.values()].find((x) => x.def.id === easy.monsterId && x.alive)!;
    m.x = p.x + 30;
    m.y = p.y;
    m.hp = 1;
    p.rec.hp = p.profile.maxHp = 100000;
    for (let i = 0; i < 20 && m.alive; i++) {
      await ack(a.socket, 'attack', m.id);
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.equal(m.alive, false);
    const prog = async () => (await db.query(`SELECT progress FROM bounties WHERE character_id = $1 AND idx = 0`, [A.character.id])).rows[0].progress;
    await waitFor(async () => (await prog()) === 1, 4000);

    await db.query(`UPDATE bounties SET progress = count WHERE character_id = $1 AND idx = 0`, [A.character.id]);
    const gold0 = Number((await db.query(`SELECT gold FROM characters WHERE id = $1`, [A.character.id])).rows[0].gold);
    const claim = await ack(a.socket, 'bounty:claim', { npcId: 'ranger_wren', idx: 0 });
    assert.equal(claim.ok, true, JSON.stringify(claim));
    assert.equal(claim.data.board.bounties[0].claimed, true);
    const gold1 = Number((await db.query(`SELECT gold FROM characters WHERE id = $1`, [A.character.id])).rows[0].gold);
    assert.equal(gold1 - gold0, easy.reward.gold);
    assert.equal((await ack(a.socket, 'bounty:claim', { npcId: 'ranger_wren', idx: 0 })).ok, false, 'no double claim');

    // Boards only work up close, and only at board NPCs.
    assert.equal((await ack(a.socket, 'bounty:board', 'mayor_lina')).ok, false);
    await leaveWorld(a.socket);
  });
});
