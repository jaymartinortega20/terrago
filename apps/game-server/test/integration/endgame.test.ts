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

  test('new regions are connected and their world bosses spawn', async () => {
    for (const [id, boss] of [['ancient_ruins', 'stoneheart_golem'], ['dragonspire', 'ancient_wyvern']] as const) {
      const def = getMap(id)!;
      assert.ok(def.spawns?.some((s) => s.monster === boss));
    }
    assert.ok(getMap('crystal_lake')!.portals.some((p) => p.to === 'dusthaven_desert'));
    assert.ok(getMap('ancient_ruins')!.portals.some((p) => p.to === 'dg_sunken_sanctum'));
  });

  test('harden: below its HP threshold a boss shrugs off damage for a while', async () => {
    const A = await newPlayer(base);
    const c = tileCenter(30, 15);
    await db.query(`UPDATE characters SET level = 80, map_id = 'ancient_ruins', pos_x = $2, pos_y = $3 WHERE id = $1`, [A.character.id, c.x, c.y]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const p = server.world.players.get(A.character.id)!;
    const rt = server.world.runtimeOf(p);
    const golem = [...rt.monsters.values()].find((m) => m.def.id === 'stoneheart_golem')!;
    const heal = setInterval(() => (p.rec.hp = p.profile.maxHp), 100);
    golem.hp = Math.round(golem.stats.maxHp * 0.5);
    p.x = golem.x;
    p.y = golem.y + 40;
    rt.spatial.update(p);
    await ack(a.socket, 'attack', golem.id);
    await waitFor(() => golem.effects.some((e) => e.id === 'stone_skin'), 8000);
    clearInterval(heal);
    assert.equal(golem.effects.find((e) => e.id === 'stone_skin')!.mods.taken, 0.25);
    await leaveWorld(a.socket);
  });
});
