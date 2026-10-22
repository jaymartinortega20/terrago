import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { DUNGEONS, getMap } from '@terrago/game-data';
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
  db = new pg.Pool({ connectionString: TEST_DB, max: 2 });
});
after(async () => {
  await server?.stop();
  await db?.end();
});

describe('endgame: difficulty modes, world bosses', () => {
  test('Hard is its own instance with stronger monsters; Mythic needs level 50', async () => {
    const A = await newPlayer(base);
    const d = DUNGEONS.find((x) => x.id === 'mossy_crypt')!;
    const c = tileCenter(d.entrance.x + 1, d.entrance.y + 3);
    await db.query(`UPDATE characters SET level = 20, map_id = $2, pos_x = $3, pos_y = $4 WHERE id = $1`, [A.character.id, d.entrance.map, c.x, c.y]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.equal((await ack(a.socket, 'dungeon:enter', { dungeonId: 'mossy_crypt', difficulty: 'mythic' })).ok, false, 'mythic needs level 50');
    const res = await ack(a.socket, 'dungeon:enter', { dungeonId: 'mossy_crypt', difficulty: 'hard' });
    assert.equal(res.ok, true, JSON.stringify(res));
    const p = server.world.players.get(A.character.id)!;
    await waitFor(() => p.mapId === 'dg_mossy_crypt');
    const rt = server.world.runtimeOf(p);
    assert.equal(rt.owner?.id, `${A.character.id}~hard`);
    const boss = [...rt.monsters.values()].find((m) => m.def.id === 'crypt_lord')!;
    assert.equal(boss.level, d.boss.level + 8, 'Hard adds 8 levels');
    await leaveWorld(a.socket);
  });

  test('the six maps are connected in order and their bosses spawn', async () => {
    const chain = ['greenhaven', 'desolate_crags', 'glacial_depths', 'dragonspire', 'infernal_caldera'];
    for (let i = 0; i < chain.length - 1; i++) assert.ok(getMap(chain[i]!)!.portals.some((p) => p.to === chain[i + 1]), `${chain[i]} -> ${chain[i + 1]}`);
    assert.ok(getMap('greenhaven')!.portals.some((p) => p.to === 'sunfield_plains'));
    assert.equal(getMap('greenhaven')!.name, 'Oakhaven Sanctuary');
    assert.equal(getMap('sunfield_plains')!.name, 'Whispering Fields');
    assert.ok(getMap('sunfield_plains')!.spawns?.some((s) => s.monster === 'fields_warden' && s.level[0] === 40));
    assert.ok(getMap('infernal_caldera')!.spawns?.some((s) => s.monster === 'infernal_titan'));
    assert.ok(getMap('dragonspire')!.spawns!.every((s) => s.level[0] === 100), "everything on Dragon's Peak is level 100");
    assert.ok(getMap('glacial_depths')!.portals.some((p) => p.to === 'dg_sunken_sanctum'));
    for (const old of ['whisperwood', 'crystal_lake', 'irondeep_entrance', 'frostpine_peaks', 'mirefen_swamp', 'dusthaven_desert', 'ember_ridge', 'ancient_ruins']) assert.equal(getMap(old), undefined, `${old} is gone`);
  });

  test('harden: below its HP threshold a boss shrugs off damage for a while', async () => {
    const A = await newPlayer(base);
    const c = tileCenter(24, 22);
    await db.query(`UPDATE characters SET level = 100, map_id = 'infernal_caldera', pos_x = $2, pos_y = $3 WHERE id = $1`, [A.character.id, c.x, c.y]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const p = server.world.players.get(A.character.id)!;
    const rt = server.world.runtimeOf(p);
    const golem = [...rt.monsters.values()].find((m) => m.def.id === 'infernal_titan')!;
    const heal = setInterval(() => (p.rec.hp = p.profile.maxHp), 100);
    golem.hp = Math.round(golem.stats.maxHp * 0.5);
    p.x = golem.x;
    p.y = golem.y + 40;
    rt.spatial.update(p);
    await ack(a.socket, 'attack', golem.id);
    await waitFor(() => golem.effects.some((e) => e.id === 'obsidian_shell'), 8000);
    clearInterval(heal);
    assert.equal(golem.effects.find((e) => e.id === 'obsidian_shell')!.mods.taken, 0.15);
    await leaveWorld(a.socket);
  });
});
