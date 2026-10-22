import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
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

describe('pets', () => {
  test('using a pet calls it (others see it), using again sends it home; it is remembered', async () => {
    const A = await newPlayer(base);
    const B = await newPlayer(base);
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1,'bag',10,'pet_dog',1)`, [A.character.id]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    await waitFor(() => b.seen.some((e) => e.id === A.character.id), 5000);
    const looks: any[] = [];
    b.socket.on('entity:update', (id, patch) => id === A.character.id && looks.push(patch));
    let selfPet: string | null | undefined;
    a.socket.on('self:update', (s) => 'pet' in s && (selfPet = s.pet));
    const call = await ack(a.socket, 'inventory:use', { slot: 10 });
    assert.equal(call.ok, true, JSON.stringify(call));
    assert.match(call.data.message, /following you/);
    await waitFor(() => selfPet === 'pet_dog' && looks.some((l) => l.pet === 'pet_dog'));
    assert.equal((await db.query('SELECT pet FROM characters WHERE id = $1', [A.character.id])).rows[0].pet, 'pet_dog');
    const items = await db.query(`SELECT count(*)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'pet_dog'`, [A.character.id]);
    assert.equal(items.rows[0].n, 1, 'pets are not used up');
    await ack(a.socket, 'inventory:use', { slot: 10 });
    await waitFor(() => selfPet === null);
    await leaveWorld(a.socket);
    await leaveWorld(b.socket);
  });
});
