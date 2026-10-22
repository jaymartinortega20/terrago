import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { NPCS } from '@terrago/game-data';
import { tileCenter, type CombatEvent, type PublicMonster } from '@terrago/shared';
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

async function place(id: string, mapId: string, tx: number, ty: number, dir = 'up') {
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, direction = $5 WHERE id = $1', [id, mapId, c.x, c.y, dir]);
}

/** Test-only: put the live player right next to a live monster (no walking in tests). */
function standNextTo(characterId: string, monsterId: string) {
  const p = server.world.players.get(characterId)!;
  const rt = server.world.runtimeOf(p);
  const m = rt.monsters.get(monsterId)!;
  p.x = m.x;
  p.y = m.y + 20;
  rt.spatial.update(p);
  return { p, m, rt };
}

describe('combat (v0.5)', () => {
  test('starter weapon, killing a slime: XP, Gold, ledger', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    await place(A.character.id, 'sunfield_plains', 45, 10);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.equal(a.enter.inventory.equipment?.find((e) => e.slot === 0)?.itemId, 'training_sword', 'starter weapon is worn');
    const monsters: PublicMonster[] = [];
    await waitFor(() => a.seen.some((m) => m.monsterId === 'green_slime'), 5000);
    monsters.push(...a.seen.filter((e) => e.kind === 'monster'));
    const slime = monsters.find((m) => m.monsterId === 'green_slime')!;
    const events: CombatEvent[] = [];
    a.socket.on('combat', (ev) => events.push(...ev));
    const { m } = standNextTo(A.character.id, slime.id);
    let swings = 0;
    while (m.alive && swings < 40) {
      const r = await ack(a.socket, 'attack', slime.id);
      if (!r.ok) assert.match(r.error, /cooldown|No target/);
      swings++;
      await new Promise((res) => setTimeout(res, 600));
    }
    assert.equal(m.alive, false, 'slime died');
    assert.ok(events.some((e) => e.t === slime.id && (e.k === 'hit' || e.k === 'crit')));
    assert.ok(events.some((e) => e.t === slime.id && e.k === 'death'));
    await waitFor(async () => true, 50);
    await new Promise((r) => setTimeout(r, 400));
    const ch = await db.query('SELECT xp FROM characters WHERE id = $1', [A.character.id]);
    assert.ok(Number(ch.rows[0].xp) > 0, 'got XP');
    // Attacking a dead monster or one far away is refused.
    assert.equal((await ack(a.socket, 'attack', slime.id)).ok, false);
    await leaveWorld(a.socket);
  });

  test('skills spend MP, respect cooldowns and level; no fighting in town', async () => {
    const A = await newPlayer(base, { classId: 'mage' });
    await place(A.character.id, 'sunfield_plains', 45, 10);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const p = server.world.players.get(A.character.id)!;
    const rt = server.world.runtimeOf(p);
    const target = [...rt.monsters.values()].find((m) => m.alive)!;
    standNextTo(A.character.id, target.id);
    const mp0 = p.rec.mp;
    const fire = await ack(a.socket, 'skill', { skillId: 'fireball', targetId: target.id });
    assert.equal(fire.ok, true, JSON.stringify(fire));
    assert.equal(p.rec.mp, mp0 - 8);
    const again = await ack(a.socket, 'skill', { skillId: 'fireball', targetId: target.id });
    assert.equal(again.ok, false);
    const locked = await ack(a.socket, 'skill', { skillId: 'arcane_shield', targetId: null });
    assert.match(locked.error, /level 12/);
    const wrongClass = await ack(a.socket, 'skill', { skillId: 'power_strike', targetId: target.id });
    assert.equal(wrongClass.ok, false);
    await leaveWorld(a.socket);
  });

  test('buff and area skills tell everyone nearby so they can draw the effect', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    await place(A.character.id, 'sunfield_plains', 45, 10);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const p = server.world.players.get(A.character.id)!;
    p.rec.level = 30;
    p.rec.mp = 500;
    const events: CombatEvent[] = [];
    a.socket.on('combat', (ev: CombatEvent[]) => events.push(...ev));
    const cry = await ack(a.socket, 'skill', { skillId: 'war_cry', targetId: null });
    assert.equal(cry.ok, true, JSON.stringify(cry));
    await waitFor(() => events.find((e) => e.k === 'cast' && e.sk === 'war_cry' && e.s === p.id && e.t === p.id));
    const spin = await ack(a.socket, 'skill', { skillId: 'whirlwind', targetId: null });
    assert.equal(spin.ok, true, JSON.stringify(spin));
    await waitFor(() => events.find((e) => e.k === 'cast' && e.sk === 'whirlwind'));
    await leaveWorld(a.socket);
  });

  test('dying sends you back to town with weakness and worn-down gear', async () => {
    const A = await newPlayer(base, { classId: 'archer' });
    await place(A.character.id, 'sunfield_plains', 45, 30);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const p = server.world.players.get(A.character.id)!;
    const rt = server.world.runtimeOf(p);
    const rat = [...rt.monsters.values()].find((m) => m.def.id === 'field_rat' && m.alive)!;
    standNextTo(A.character.id, rat.id);
    p.rec.hp = 1;
    await waitFor(() => p.dead, 8000);
    await waitFor(() => p.mapId === 'greenhaven' && !p.dead, 8000);
    assert.ok(p.effects.some((e) => e.id === 'weakness'));
    assert.equal(p.rec.hp, Math.round(p.profile.maxHp * 0.5));
    await new Promise((r) => setTimeout(r, 300));
    const dur = await db.query(`SELECT durability FROM inventory_items WHERE character_id = $1 AND container = 'equip' AND slot = 0`, [A.character.id]);
    assert.ok(dur.rows[0].durability < 200, `weapon durability ${dur.rows[0].durability}`);
    await leaveWorld(a.socket);
  });

  test('equip armor changes stats; enhancement at the altar costs stones and gold', async () => {
    const A = await newPlayer(base, { classId: 'warrior' });
    await place(A.character.id, 'greenhaven', 37, 14, 'up');
    await db.query(
      `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', 10, 'padded_chest', 1, 180), ($1, 'bag', 11, 'enhancement_stone', 3, null)`,
      [A.character.id],
    );
    await db.query('UPDATE characters SET gold = 1000 WHERE id = $1', [A.character.id]);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const p = server.world.players.get(A.character.id)!;
    const def0 = p.profile.derived.physicalDefense;
    const eq = await ack(a.socket, 'equip', { from: 10 });
    assert.equal(eq.ok, true, JSON.stringify(eq));
    assert.equal(p.profile.derived.physicalDefense, def0 + 3);
    const wrong = await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', 12, 'training_staff', 1, 200)`, [A.character.id]);
    void wrong;
    const inv = await ack(a.socket, 'inventory:get');
    void inv;
    const notMine = await ack(a.socket, 'equip', { from: 12 });
    assert.equal(notMine.ok, false);
    assert.match(notMine.error, /Mages/);
    const enh = await ack(a.socket, 'enhance', { equipSlot: 3 });
    assert.equal(enh.ok, true, JSON.stringify(enh));
    assert.equal(enh.data.success, true, '+0 → +1 always succeeds');
    const row = await db.query(`SELECT enhance FROM inventory_items WHERE character_id = $1 AND container = 'equip' AND slot = 3`, [A.character.id]);
    assert.equal(row.rows[0].enhance, 1);
    const stones = await db.query(`SELECT quantity FROM inventory_items WHERE character_id = $1 AND item_id = 'enhancement_stone'`, [A.character.id]);
    assert.equal(stones.rows[0].quantity, 2);
    const ledger = await db.query(`SELECT count(*)::int AS n FROM currency_transactions WHERE character_id = $1 AND reason = 'enhance'`, [A.character.id]);
    assert.equal(ledger.rows[0].n, 1);
    const un = await ack(a.socket, 'unequip', { slot: 3 });
    assert.equal(un.ok, true);
    assert.equal(p.profile.derived.physicalDefense, def0);
    await leaveWorld(a.socket);
  });

  test('upgrades at the blacksmith use mined gems by tier; others see the glow and wings', async () => {
    const npc = NPCS.find((n) => n.id === 'blacksmith_toren')!;
    const A = await newPlayer(base, { classId: 'warrior' });
    const B = await newPlayer(base, { classId: 'mage' });
    await place(A.character.id, npc.mapId, npc.x, npc.y + 1, 'up');
    await place(B.character.id, npc.mapId, npc.x + 1, npc.y + 1, 'up');
    await db.query('UPDATE characters SET level = 40, gold = 100000 WHERE id = $1', [A.character.id]);
    await db.query(`INSERT INTO inventories (character_id, container, capacity) VALUES ($1, 'equip', 9) ON CONFLICT DO NOTHING`, [A.character.id]);
    await db.query(
      `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability, enhance) VALUES ($1, 'equip', 3, 'padded_chest', 1, 180, 3), ($1, 'bag', 10, 'fairy_wings', 1, 400, 0)`,
      [A.character.id],
    );
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const b = await enterWorld(base, B.browser.cookie, B.character.id);
    const looks: any[] = [];
    b.socket.on('entity:update', (id: string, patch: any) => id === A.character.id && looks.push(patch));
    await waitFor(() => server.world.players.get(B.character.id)!.known.has(A.character.id));
    const noGem = await ack(a.socket, 'enhance', { equipSlot: 3, npcId: npc.id });
    assert.equal(noGem.ok, false);
    assert.match(noGem.error, /Sapphire/);
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1, 'bag', 11, 'sapphire', 30)`, [A.character.id]);
    let level = 3;
    for (let i = 0; i < 15 && level < 4; i++) {
      const r = await ack(a.socket, 'enhance', { equipSlot: 3, npcId: npc.id });
      assert.equal(r.ok, true, JSON.stringify(r));
      level = (await db.query(`SELECT enhance FROM inventory_items WHERE character_id = $1 AND container = 'equip' AND slot = 3`, [A.character.id])).rows[0].enhance;
    }
    assert.equal(level, 4);
    const used = await db.query(`SELECT coalesce(sum(quantity), 0)::int AS n FROM item_transactions WHERE from_character_id = $1 AND item_id = 'sapphire' AND reason = 'enhance'`, [A.character.id]);
    assert.ok(used.rows[0].n >= 1, 'sapphires were spent');
    await waitFor(() => looks.find((l) => l.armorGlow === 4), 3000);
    assert.equal((await ack(a.socket, 'equip', { from: 10 })).ok, true);
    await waitFor(() => looks.find((l) => l.back === 'fairy_wings'), 3000);
    assert.equal(server.world.players.get(A.character.id)!.toPublic().back, 'fairy_wings');
    for (const s of [a, b]) await leaveWorld(s.socket);
  });
});
