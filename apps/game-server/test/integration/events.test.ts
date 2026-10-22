import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { tileCenter } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { TEST_DB, enterWorld, leaveWorld, newPlayer, resetDatabase, startTestServer, waitFor } from './helpers';

let server: GameServer;
let base: string;
let db: pg.Pool;
before(async () => {
  await resetDatabase();
  server = await startTestServer({ EVENTS: 'slime_rain' });
  base = `http://127.0.0.1:${server.port()}`;
  db = new pg.Pool({ connectionString: TEST_DB, max: 2 });
});
after(async () => {
  await server?.stop();
  await db?.end();
});

describe('world events', () => {
  test('an invasion is announced and spawns its monsters and boss where players are', async () => {
    const A = await newPlayer(base);
    const c = tileCenter(30, 3);
    await db.query(`UPDATE characters SET map_id = 'sunfield_plains', pos_x = $2, pos_y = $3 WHERE id = $1`, [A.character.id, c.x, c.y]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const rt = server.world.runtimeOf(server.world.players.get(A.character.id)!);
    await waitFor(() => [...rt.monsters.values()].some((m) => m.def.id === 'king_slime'), 8000);
    const invaders = [...rt.monsters.values()].filter((m) => m.eventTag);
    assert.equal(invaders.length, 17, '10 green + 6 blue + the King');
    await leaveWorld(a.socket);
  });
});
