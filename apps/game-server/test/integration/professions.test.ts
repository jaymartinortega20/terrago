import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import type { GameServer } from '../../src/app';
import { craft } from '../../src/services/gathering';
import { TEST_DB, ack, enterWorld, leaveWorld, newPlayer, resetDatabase, startTestServer } from './helpers';

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

const setSkill = (id: string, skill: string, level: number) =>
  db.query(`INSERT INTO character_skills (character_id, skill, level, xp) VALUES ($1, $2, $3, 0) ON CONFLICT (character_id, skill) DO UPDATE SET level = $3`, [id, skill, level]);
const count = async (id: string, itemId: string) =>
  Number((await db.query(`SELECT coalesce(sum(quantity),0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = $2`, [id, itemId])).rows[0].n);

describe('professions: specializations', () => {
  test('need level 40; max two; changing costs gold; top gear needs the right specialist; doubled outputs', async () => {
    const A = await newPlayer(base);
    const id = A.character.id;
    const a = await enterWorld(base, A.browser.cookie, id);
    assert.equal((await ack(a.socket, 'spec:choose', { skill: 'smithing', spec: 'weapon_smith' })).ok, false, 'level 40 needed');
    for (const s of ['smithing', 'crafting', 'alchemy', 'cooking']) await setSkill(id, s, 60);
    assert.equal((await ack(a.socket, 'spec:choose', { skill: 'smithing', spec: 'armor_smith' })).ok, true);
    assert.equal((await ack(a.socket, 'spec:choose', { skill: 'crafting', spec: 'artificer' })).ok, true);
    const third = await ack(a.socket, 'spec:choose', { skill: 'alchemy', spec: 'potion_master' });
    assert.equal(third.ok, false, 'two at most');
    assert.equal((await ack(a.socket, 'spec:choose', { skill: 'smithing', spec: 'bowyer' })).ok, false, 'spec must match the skill');

    // An Armor Smith cannot forge an Obsidian sword.
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1,'bag',10,'obsidian_bar',20),($1,'bag',11,'elderwood_plank',20),($1,'bag',12,'softwood_log',10)`, [id]);
    await db.query('UPDATE characters SET gold = 10000 WHERE id = $1', [id]);
    await assert.rejects(craft(server.pool, id, 'forge_w_obsidian_sword', 1), /Weapon Smith/);
    // Retrain as Weapon Smith (5,000 Gold).
    assert.equal((await ack(a.socket, 'spec:choose', { skill: 'smithing', spec: 'weapon_smith' })).ok, true);
    assert.equal(Number((await db.query('SELECT gold FROM characters WHERE id = $1', [id])).rows[0].gold), 5000);
    // Artificer: planks come out doubled.
    const before = await count(id, 'softwood_plank');
    await craft(server.pool, id, 'saw_softwood', 1);
    const recipe = (await import('@terrago/game-data')).getRecipe('saw_softwood')!;
    assert.equal((await count(id, 'softwood_plank')) - before, recipe.output.quantity * 2);
    await leaveWorld(a.socket);
  });
});
