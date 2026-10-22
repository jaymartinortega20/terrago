import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { getMonster } from '@terrago/game-data';
import { OUTFITS, tileCenter, type CombatEvent } from '@terrago/shared';
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

describe('combat companions and raid loot', () => {
  test('a pet fights the monster its owner is fighting; a Beastmaster gets a hawk', async () => {
    const A = await newPlayer(base, { classId: 'archer' });
    await place(A.character.id, 'sunfield_plains', 45, 10);
    await db.query(`UPDATE characters SET pet = 'pet_cat', level = 10 WHERE id = $1`, [A.character.id]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const events: CombatEvent[] = [];
    a.socket.on('combat', (ev: CombatEvent[]) => events.push(...ev));
    const p = server.world.players.get(A.character.id)!;
    const rt = server.world.runtimeOf(p);
    const m = [...rt.monsters.values()].find((x) => x.alive && x.def.id === 'green_slime')!;
    p.x = m.x;
    p.y = m.y + 20;
    rt.spatial.update(p);
    await ack(a.socket, 'attack', m.id);
    await waitFor(() => events.find((e) => e.sk === 'pet' && e.s === p.id && (e.k === 'hit' || e.k === 'crit')), 6000);
    assert.ok(m.damageBy.get(p.id)! > 0, 'pet damage counts for the owner');

    // Beastmaster: no pet item needed, the hawk comes with the job.
    p.pet = null;
    p.rec.job = 'beastmaster';
    events.length = 0;
    const m2 = [...rt.monsters.values()].find((x) => x.alive && x !== m)!;
    p.x = m2.x;
    p.y = m2.y + 20;
    rt.spatial.update(p);
    await ack(a.socket, 'attack', m2.id);
    await waitFor(() => events.find((e) => e.sk === 'hawk' && e.s === p.id), 6000);
    assert.equal(p.toPublic().job, 'beastmaster');
    await leaveWorld(a.socket);
  });

  test('Pyraxis always drops an Infernal Cache and a skin; the cache holds a mythic weapon for your class', async () => {
    const titan = getMonster('infernal_titan')!;
    assert.ok(titan.drops.some((d) => d.itemId === 'infernal_cache' && d.chance === 1));
    assert.ok(titan.drops.some((d) => d.itemId === 'skin_infernal_warlord' && d.chance === 1));
    const A = await newPlayer(base, { classId: 'mage' });
    await db.query(
      `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', 10, 'infernal_cache', 1, null), ($1, 'bag', 11, 'skin_infernal_warlord', 2, null)`,
      [A.character.id],
    );
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const open = await ack(a.socket, 'inventory:use', { slot: 10 });
    assert.equal(open.ok, true, JSON.stringify(open));
    assert.match(open.data.message, /Infernal Staff/);
    const staff = await db.query(`SELECT count(*)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'infernal_staff'`, [A.character.id]);
    assert.equal(staff.rows[0].n, 1);
    const skin = await ack(a.socket, 'inventory:use', { slot: 11 });
    assert.equal(skin.ok, true, JSON.stringify(skin));
    const warlord = OUTFITS.findIndex((o) => o.name === 'Infernal Warlord');
    const w = await ack(a.socket, 'wardrobe:get');
    assert.ok(w.data.owned.includes(warlord));
    const again = await ack(a.socket, 'inventory:use', { slot: 11 });
    assert.equal(again.ok, false, 'already owned: keep the token to trade');
    assert.equal((await ack(a.socket, 'wardrobe:set', warlord)).ok, true);
    await leaveWorld(a.socket);
  });
});
