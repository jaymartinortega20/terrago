import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { NPCS, getClass } from '@terrago/game-data';
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

async function place(id: string, mapId: string, tx: number, ty: number) {
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4 WHERE id = $1', [id, mapId, c.x, c.y]);
}

describe('classes, resources, stat points and second jobs', () => {
  test('only Warrior, Mage, Archer and Acolyte exist; each has its own resource', async () => {
    const A = await newPlayer(base, { classId: 'archer' });
    assert.ok(A.character.id);
    await assert.rejects(newPlayer(base, { classId: 'rogue' }));
    assert.equal(getClass('warrior').resource, 'rage');
    assert.equal(getClass('archer').resource, 'energy');
    assert.equal(getClass('mage').resource, 'mana');
    assert.equal(getClass('acolyte').resource, 'mana');
  });

  test('stat points: 5 per level, spent by the player, change derived stats', async () => {
    const P = await newPlayer(base, { classId: 'warrior' });
    await db.query('UPDATE characters SET level = 3 WHERE id = $1', [P.character.id]);
    const s = await enterWorld(base, P.browser.cookie, P.character.id);
    assert.equal(s.enter.self.statPoints, 10);
    const p = server.world.players.get(P.character.id)!;
    const atk0 = p.profile.derived.physicalAttack;
    const hp0 = p.profile.maxHp;
    assert.equal((await ack(s.socket, 'stats:add', { stat: 'strength', amount: 4 })).ok, true);
    assert.equal((await ack(s.socket, 'stats:add', { stat: 'vitality', amount: 6 })).ok, true);
    assert.equal(p.profile.derived.physicalAttack, atk0 + 8);
    assert.equal(p.profile.maxHp, hp0 + 30);
    const none = await ack(s.socket, 'stats:add', { stat: 'luck', amount: 1 });
    assert.equal(none.ok, false);
    assert.equal((await ack(s.socket, 'stats:add', { stat: 'charisma', amount: 1 })).ok, false);
    const row = await db.query('SELECT strength, vitality FROM character_stats WHERE character_id = $1', [P.character.id]);
    assert.equal(row.rows[0].strength, getClass('warrior').baseStats.strength + 4, 'saved');
    await leaveWorld(s.socket);
  });

  test('Warriors start with no Rage and build it by fighting; Archers have fast Energy', async () => {
    const W = await newPlayer(base, { classId: 'warrior' });
    await place(W.character.id, 'sunfield_plains', 45, 10);
    const w = await enterWorld(base, W.browser.cookie, W.character.id);
    assert.equal(w.enter.self.mp, 0, 'rage starts empty');
    assert.equal(w.enter.self.maxMp, 100);
    const p = server.world.players.get(W.character.id)!;
    const no = await ack(w.socket, 'skill', { skillId: 'power_strike', targetId: null });
    assert.equal(no.ok, false);
    assert.match(no.error, /Rage|target/);
    const rt = server.world.runtimeOf(p);
    const m = [...rt.monsters.values()].find((x) => x.alive)!;
    p.x = m.x;
    p.y = m.y + 20;
    rt.spatial.update(p);
    for (let i = 0; i < 12 && p.rec.mp === 0 && m.alive; i++) {
      await ack(w.socket, 'attack', m.id);
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(p.rec.mp > 0, 'hits build rage');
    await leaveWorld(w.socket);

    const A = await newPlayer(base, { classId: 'archer' });
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const pa = server.world.players.get(A.character.id)!;
    assert.equal(a.enter.self.maxMp, 100);
    pa.rec.mp = 0;
    await waitFor(() => pa.rec.mp >= 10, 3000);
    await leaveWorld(a.socket);
  });

  test('second job at level 40 from the Job Trainer: once, from your own class, unlocks job skills', async () => {
    const npc = NPCS.find((n) => n.id === 'job_master_aldric')!;
    const P = await newPlayer(base, { classId: 'archer' });
    await place(P.character.id, npc.mapId, npc.x, npc.y + 1);
    const s = await enterWorld(base, P.browser.cookie, P.character.id);
    const p = server.world.players.get(P.character.id)!;
    const early = await ack(s.socket, 'job:advance', { npcId: npc.id, job: 'beastmaster' });
    assert.equal(early.ok, false);
    assert.match(early.error, /level 40/);
    p.rec.level = 40;
    assert.equal((await ack(s.socket, 'job:advance', { npcId: npc.id, job: 'paladin' })).ok, false, 'not an archer job');
    const ok = await ack(s.socket, 'job:advance', { npcId: npc.id, job: 'beastmaster' });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(p.rec.job, 'beastmaster');
    assert.equal((await db.query('SELECT job FROM characters WHERE id = $1', [P.character.id])).rows[0].job, 'beastmaster');
    assert.equal((await ack(s.socket, 'job:advance', { npcId: npc.id, job: 'ranger' })).ok, false, 'final');
    // A Ranger skill is refused; the Beastmaster's hawk skill needs a target (so it is known).
    const wrong = await ack(s.socket, 'skill', { skillId: 'piercing_arrow', targetId: null });
    assert.match(wrong.error, /Ranger skill/);
    p.rec.mp = 100;
    const hawk = await ack(s.socket, 'skill', { skillId: 'falcon_strike', targetId: null });
    assert.doesNotMatch(hawk.error ?? '', /skill\./);
    await leaveWorld(s.socket);
  });
});
