import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { getMap } from '@terrago/game-data';
import { tileCenter, type CombatEvent } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { TEST_DB, enterWorld, leaveWorld, newPlayer, resetDatabase, startTestServer, waitFor } from './helpers';

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

async function at(mapId: string, tx: number, ty: number, level: number) {
  const A = await newPlayer(base, { classId: 'warrior' });
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, level = $5 WHERE id = $1', [A.character.id, mapId, c.x, c.y, level]);
  const a = await enterWorld(base, A.browser.cookie, A.character.id);
  const p = server.world.players.get(A.character.id)!;
  const events: CombatEvent[] = [];
  a.socket.on('combat', (ev: CombatEvent[]) => events.push(...ev));
  return { a, p, events, rt: server.world.runtimeOf(p) };
}

describe('late-map monsters', () => {
  test('the Crags and Glacial Depths have 6+ kinds of monsters each', () => {
    for (const id of ['desolate_crags', 'glacial_depths']) {
      const kinds = new Set(getMap(id)!.spawns!.map((s) => s.monster));
      assert.ok(kinds.size >= 6, `${id}: ${[...kinds].join(', ')}`);
    }
  });

  test('healers mend wounded monsters; exploders blow up next to you; chargers dash', async () => {
    const { a, p, events, rt } = await at('desolate_crags', 20, 14, 60);
    p.rec.hp = p.profile.maxHp = 1_000_000;
    const shaman = [...rt.monsters.values()].find((m) => m.def.id === 'crag_shaman' && m.alive)!;
    const wounded = [...rt.monsters.values()].find((m) => m !== shaman && m.alive)!;
    wounded.x = shaman.x + 20;
    wounded.y = shaman.y;
    wounded.hp = Math.round(wounded.stats.maxHp * 0.3);
    p.x = shaman.x + 60;
    p.y = shaman.y;
    rt.spatial.update(p);
    shaman.state = 'chase';
    shaman.targetId = p.id;
    await waitFor(() => events.find((e) => e.s === shaman.id && e.k === 'heal' && e.sk === 'monster_heal'), 6000);
    assert.ok(wounded.hp > wounded.stats.maxHp * 0.3, 'healed');

    const mite = [...rt.monsters.values()].find((m) => m.def.id === 'boulder_mite' && m.alive)!;
    p.x = mite.x + 20;
    p.y = mite.y;
    rt.spatial.update(p);
    mite.state = 'chase';
    mite.targetId = p.id;
    await waitFor(() => events.find((e) => e.s === mite.id && e.sk === 'monster_explode'), 6000);
    await waitFor(() => !mite.alive, 2000);
    assert.ok(events.some((e) => e.s === mite.id && e.t === p.id && e.a > 0), 'the blast hurt the player');

    const scorpion = [...rt.monsters.values()].find((m) => m.def.id === 'sand_scorpion' && m.alive)!;
    p.x = scorpion.x + 5 * 32;
    p.y = scorpion.y;
    rt.spatial.update(p);
    scorpion.state = 'chase';
    scorpion.targetId = p.id;
    await waitFor(() => events.find((e) => e.s === scorpion.id && e.sk === 'monster_charge'), 6000);
    await leaveWorld(a.socket);
  });

  test('summoners call minions; elites are tougher and named', async () => {
    const { a, p, events, rt } = await at('glacial_depths', 45, 10, 95);
    p.rec.hp = p.profile.maxHp = 1_000_000;
    const warlock = [...rt.monsters.values()].find((m) => m.def.id === 'glacier_warlock' && m.alive)!;
    p.x = warlock.x + 60;
    p.y = warlock.y;
    rt.spatial.update(p);
    warlock.state = 'chase';
    warlock.targetId = p.id;
    await waitFor(() => events.find((e) => e.s === warlock.id && e.sk === 'monster_summon'), 8000);
    assert.equal(warlock.adds.filter((x) => x.alive).length, 2);

    // Force an elite roll.
    const combat = server.world.combat as any;
    const realRand = combat.rand;
    combat.rand = () => 0.01;
    const m = [...rt.monsters.values()].find((x) => x.def.id === 'frost_yeti')!;
    const before = m.stats.maxHp;
    combat.rollElite(rt, m, m.stats);
    combat.rand = realRand;
    assert.equal(m.elite, true);
    assert.equal(m.stats.maxHp, before * 3);
    assert.equal(m.toPublic().name, 'Elite Frost Yeti');
    await leaveWorld(a.socket);
  });
});

describe('monster AI loops', () => {
  test("a monster that can't get home doesn't stay stuck in 'return' forever", async () => {
    const { a, rt } = await at('desolate_crags', 31, 44, 60);
    const m = [...rt.monsters.values()].find((x) => x.alive && x.def.id === 'earth_elemental')!;
    // Somewhere far from its spawn, half dead, heading home — and taking far too long.
    m.x = 50 * 32;
    m.y = 40 * 32;
    m.hp = 5;
    m.state = 'return';
    m.returnSince = Date.now() - 9000;
    await waitFor(() => m.state === 'idle', 2000);
    const area = m.spawn.area;
    assert.ok(m.x >= area.x * 32 && m.x <= (area.x + area.w) * 32 && m.y >= area.y * 32 && m.y <= (area.y + area.h + 1) * 32, 'back home');
    assert.equal(m.hp, m.stats.maxHp, 'healed');
    await leaveWorld(a.socket);
  });
});
