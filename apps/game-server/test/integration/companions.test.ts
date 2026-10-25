import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { petStats, petXpToNext, tileCenter, type CombatEvent, type PetView } from '@terrago/shared';
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

async function setup(opts: { classId?: string; map: string; tx: number; ty: number; level?: number; items?: [string, number][]; gold?: number; pet?: string }) {
  const A = await newPlayer(base, { classId: opts.classId ?? 'warrior' });
  const c = tileCenter(opts.tx, opts.ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, level = $5, gold = $6, pet = $7 WHERE id = $1', [A.character.id, opts.map, c.x, c.y, opts.level ?? 50, opts.gold ?? 0, opts.pet ?? null]);
  let slot = 10;
  for (const [id, n] of opts.items ?? []) {
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', $2, $3, $4, null)`, [A.character.id, slot++, id, n]);
  }
  const a = await enterWorld(base, A.browser.cookie, A.character.id);
  const p = server.world.players.get(A.character.id)!;
  return { A, a, p };
}

describe('mounts', () => {
  test('getting on takes 0.5 s; moving cancels it; the stable picks the mount and its look', async () => {
    const { A, a, p } = await setup({ map: 'greenhaven', tx: 45, ty: 23, items: [['brown_pony', 1], ['war_wolf', 1]], gold: 15_000 });
    const self: any[] = [];
    a.socket.on('self:update', (u: any) => self.push(u));
    const start = await ack(a.socket, 'mount:toggle');
    assert.equal(start.ok, true, JSON.stringify(start));
    assert.equal(start.data.channelMs, 500);
    assert.equal(p.mount, null, 'not on yet');
    await waitFor(() => self.some((u) => u.mountChannelUntil));
    server.world.enqueueMove(p, [p.lastQueuedSeq + 1, 1, 0]);
    await waitFor(() => p.mountChannel === null);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(p.mount, null, 'moving cancelled it');

    await ack(a.socket, 'mount:toggle');
    await waitFor(() => p.mount === 'war_wolf', 3000);
    assert.equal(p.speed, 2.15, 'rides the fastest mount by default');

    const st = await ack(a.socket, 'mount:stable');
    assert.deepEqual(st.data.owned.sort(), ['brown_pony', 'war_wolf']);
    assert.ok(st.data.styles.includes('saddle_leather'), 'a basic saddle for everyone');
    const choose = await ack(a.socket, 'mount:choose', 'brown_pony');
    assert.equal(choose.ok, true, JSON.stringify(choose));
    assert.equal(p.mount, 'brown_pony', 'swapped while riding');
    assert.equal(p.speed, 1.45);

    assert.equal((await ack(a.socket, 'mount:style', { slot: 'trail', id: 'trail_ember' })).ok, false, 'must buy it first');
    const poor = await ack(a.socket, 'mount:buyStyle', { id: 'barding_celestial', npcId: 'stablemaster_hana' });
    assert.equal(poor.ok, false, 'not enough gold');
    const gold0 = Number((await db.query(`SELECT gold FROM characters WHERE id = $1`, [A.character.id])).rows[0].gold);
    const buy = await ack(a.socket, 'mount:buyStyle', { id: 'trail_ember', npcId: 'stablemaster_hana' });
    assert.equal(buy.ok, true, JSON.stringify(buy));
    assert.equal((await ack(a.socket, 'mount:buyStyle', { id: 'trail_ember', npcId: 'stablemaster_hana' })).ok, false, 'only once');
    const gold = await db.query(`SELECT gold FROM characters WHERE id = $1`, [A.character.id]);
    assert.equal(Number(gold.rows[0].gold), gold0 - 12_000);
    const ledger = await db.query(`SELECT amount FROM currency_transactions WHERE character_id = $1 AND reason = 'npc_purchase'`, [A.character.id]);
    assert.deepEqual(ledger.rows.map((r) => Number(r.amount)), [-12_000]);
    const look = await ack(a.socket, 'mount:style', { slot: 'trail', id: 'trail_ember' });
    assert.equal(look.ok, true);
    assert.equal(p.toPublic().mountLook?.trail, 'trail_ember', 'others see the trail');
    await leaveWorld(a.socket);
  });

  test('a hit knocks a rider off and slows them for 2 s; attacking dismounts with no penalty', async () => {
    const { a, p } = await setup({ map: 'sunfield_plains', tx: 45, ty: 10, level: 30, items: [['brown_pony', 1]] });
    await ack(a.socket, 'mount:toggle');
    await waitFor(() => p.mount === 'brown_pony', 3000);
    const rt = server.world.runtimeOf(p);
    server.world.combat.damagePlayer(rt, p, 1, 'test', 'hit');
    assert.equal(p.mount, null, 'knocked off');
    assert.ok(p.slowUntil > Date.now());
    assert.equal(p.speed, 0.6);
    await waitFor(() => p.speed === 1, 4000);

    p.lastCombatAt = 0;
    await ack(a.socket, 'mount:toggle');
    await waitFor(() => p.mount === 'brown_pony', 3000);
    const m = [...rt.monsters.values()].find((x) => x.alive && x.def.id === 'green_slime')!;
    p.x = m.x;
    p.y = m.y + 20;
    rt.spatial.update(p);
    const events: CombatEvent[] = [];
    a.socket.on('combat', (ev: CombatEvent[]) => events.push(...ev));
    const hit = await ack(a.socket, 'attack', m.id);
    assert.equal(hit.ok, true, JSON.stringify(hit));
    assert.equal(p.mount, null, 'got off to attack');
    assert.equal(p.slowUntil, 0, 'no penalty for attacking');
    await waitFor(() => events.some((e) => e.s === p.id && e.t === m.id));
    await leaveWorld(a.socket);
  });

  test('Glacial Depths slows everyone except an Ice Walker mount', async () => {
    const { a, p } = await setup({ map: 'glacial_depths', tx: 31, ty: 44, level: 60, items: [['brown_pony', 1], ['war_wolf', 1]] });
    assert.equal(p.speed, 0.8, 'on foot on the ice');
    await ack(a.socket, 'mount:choose', 'brown_pony');
    await ack(a.socket, 'mount:toggle');
    await waitFor(() => p.mount === 'brown_pony', 3000);
    assert.equal(p.speed, 1.16, 'the pony slips too');
    await ack(a.socket, 'mount:choose', 'war_wolf');
    assert.equal(p.speed, 2.15, 'the War Wolf ignores the ice');
    await leaveWorld(a.socket);
  });
});

describe('pet growth', () => {
  test('pets siphon 10% of kill EXP, eat fish and treats, cap at the owner level and spend growth points', async () => {
    const { A, a, p } = await setup({ map: 'sunfield_plains', tx: 45, ty: 10, level: 30, pet: 'pet_dog', items: [['minnow', 2], ['premium_pet_treat', 20], ['golden_koi', 1]] });
    await waitFor(() => p.petState && !p.petState.stub);
    const updates: (PetView | null)[] = [];
    a.socket.on('pet:update', (v: PetView | null) => updates.push(v));
    const menu0 = await ack(a.socket, 'pet:get');
    assert.equal(menu0.ok, true, JSON.stringify(menu0));
    assert.equal(menu0.data.active.id, 'pet_dog');
    assert.equal(menu0.data.active.level, 1);
    assert.equal(menu0.data.active.loyalty, 50);

    // A kill: the pet gets a tenth of the EXP.
    const rt = server.world.runtimeOf(p);
    const m = [...rt.monsters.values()].find((x) => x.alive && x.def.id === 'green_slime')!;
    p.x = m.x;
    p.y = m.y + 20;
    rt.spatial.update(p);
    for (let i = 0; i < 30 && m.alive; i++) {
      await ack(a.socket, 'attack', m.id);
      await new Promise((r) => setTimeout(r, 450));
    }
    assert.equal(m.alive, false, 'slime defeated');
    const row = await waitFor(async () => (await db.query(`SELECT level, xp, kills FROM character_pets WHERE character_id = $1 AND pet_id = 'pet_dog'`, [A.character.id])).rows[0], 6000);
    assert.equal(row.kills, 1);
    assert.ok(row.level > 1 || row.xp > 0, 'pet gained EXP');

    // Feeding: rare fish are refused; common fish and treats work.
    const inv = server.world.inventoryCache.get(p.id)!;
    const slotOf = (id: string) => inv.slots.find((s) => s.itemId === id)!.slot;
    assert.equal((await ack(a.socket, 'pet:feed', { slot: slotOf('golden_koi') })).ok, false, 'not that one');
    const fish = await ack(a.socket, 'pet:feed', { slot: slotOf('minnow') });
    assert.equal(fish.ok, true, JSON.stringify(fish));
    assert.match(fish.data.message, /\+60 Pet EXP/);
    for (let i = 0; i < 20; i++) await ack(a.socket, 'pet:feed', { slot: server.world.inventoryCache.get(p.id)!.slots.find((s) => s.itemId === 'premium_pet_treat')?.slot ?? -1 });
    const fed = (await ack(a.socket, 'pet:get')).data.active as PetView;
    assert.equal(fed.level, 30, 'never above the owner level');
    assert.equal(fed.xp, petXpToNext(30) - 1, 'banks EXP for when the owner levels');
    assert.equal(fed.loyalty, 100, 'treats raise loyalty (capped)');
    assert.equal(fed.points, 3, 'one growth point per 10 levels');
    assert.equal(fed.maxHp, petStats('dog', 30).maxHp);

    // Growth points: Swift Bond speeds the owner up.
    assert.equal((await ack(a.socket, 'pet:grow', { trait: 'speed' })).ok, true);
    assert.equal(p.speed, 1.02);
    await ack(a.socket, 'pet:grow', { trait: 'crit' });
    await ack(a.socket, 'pet:grow', { trait: 'leech' });
    const none = await ack(a.socket, 'pet:grow', { trait: 'speed' });
    assert.equal(none.ok, false, 'no points left');

    // Dying costs 5 loyalty.
    server.world.combat.damagePlayer(rt, p, 999_999, 'test', 'hit');
    await waitFor(async () => (await db.query(`SELECT loyalty FROM character_pets WHERE character_id = $1 AND pet_id = 'pet_dog'`, [A.character.id])).rows[0]?.loyalty === 95, 4000);
    assert.ok(updates.some((u) => u?.loyalty === 95));
    await leaveWorld(a.socket);
  });

  test('a sulking pet (loyalty under 20) cheers up when fed; a taunting dog takes the hits', async () => {
    const { A, a, p } = await setup({ map: 'sunfield_plains', tx: 45, ty: 12, level: 30, pet: 'pet_dog', items: [['minnow', 1]] });
    await db.query(`INSERT INTO character_pets (character_id, pet_id, level, loyalty) VALUES ($1, 'pet_dog', 20, 8)`, [A.character.id]);
    await waitFor(() => p.petState && !p.petState.stub);
    p.petState = null;
    const before = (await ack(a.socket, 'pet:get')).data.active as PetView;
    assert.equal(before.loyalty, 8);
    const fed = await ack(a.socket, 'pet:feed', { slot: server.world.inventoryCache.get(p.id)!.slots.find((s) => s.itemId === 'minnow')!.slot });
    assert.equal(fed.data.active.loyalty, 20);

    const rt = server.world.runtimeOf(p);
    const m = [...rt.monsters.values()].find((x) => x.alive)!;
    p.petState!.tauntUntil = Date.now() + 3000;
    const hp = p.rec.hp;
    const pet0 = p.petState!.hp;
    (server.world.combat as any).petIntercept(rt, p, m, 40, Date.now());
    assert.equal(p.rec.hp, hp, 'owner untouched');
    assert.equal(p.petState!.hp, pet0 - 24, 'tank pets take hits at 60%');
    await leaveWorld(a.socket);
  });
});

describe('food buffs and pet evolution', () => {
  test('cooked food gives one Well Fed buff at a time that changes your fighting', async () => {
    const { a, p } = await setup({ map: 'greenhaven', tx: 30, ty: 30, level: 40, items: [['salmon_steak', 2], ['pumpkin_pie', 1]] });
    const inv = server.world.inventoryCache.get(p.id)!;
    const salmon = inv.slots.find((s) => s.itemId === 'salmon_steak')!;
    const r1 = await ack(a.socket, 'inventory:use', { slot: salmon.slot });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.match(r1.data.message, /Sea Strength/);
    const food = p.effects.filter((e) => e.id.startsWith('food:'));
    assert.equal(food.length, 1);
    assert.equal(food[0]!.mods.dmg, 1.08);
    const pie = server.world.inventoryCache.get(p.id)!.slots.find((s) => s.itemId === 'pumpkin_pie')!;
    assert.equal((await ack(a.socket, 'inventory:use', { slot: pie.slot })).ok, true);
    const now = p.effects.filter((e) => e.id.startsWith('food:'));
    assert.equal(now.length, 1, 'a new dish replaces the old buff');
    assert.equal(now[0]!.mods.xp, 1.1);
    await leaveWorld(a.socket);
  });

  test('pets evolve at level 30 with loyalty, a stone and Gold — stronger and visible to others', async () => {
    const { A, a, p } = await setup({ map: 'greenhaven', tx: 30, ty: 30, level: 40, pet: 'pet_dog', gold: 9000, items: [['evolution_stone', 1]] });
    await db.query(`INSERT INTO character_pets (character_id, pet_id, level, loyalty) VALUES ($1, 'pet_dog', 30, 70)`, [A.character.id]);
    await ack(a.socket, 'pet:get');
    await waitFor(() => p.petState && !p.petState.stub && p.petState.level === 30);
    const before = p.petState!;
    const hp1 = (await ack(a.socket, 'pet:get')).data.active.maxHp;
    await db.query(`UPDATE characters SET gold = 5000 WHERE id = $1`, [A.character.id]); // achievements may have paid out on login
    const poor = await ack(a.socket, 'pet:evolve');
    assert.equal(poor.ok, false, 'not enough Gold');
    await db.query(`UPDATE characters SET gold = 20000 WHERE id = $1`, [A.character.id]);
    const evo = await ack(a.socket, 'pet:evolve');
    assert.equal(evo.ok, true, JSON.stringify(evo));
    assert.equal(evo.data.active.stage, 2);
    assert.ok(evo.data.active.maxHp > hp1 * 1.3, `${hp1} → ${evo.data.active.maxHp}`);
    assert.equal(before.stage, 2);
    assert.equal(p.petStage, 2);
    assert.equal(p.toPublic().petStage, 2);
    const row = await db.query(`SELECT stage FROM character_pets WHERE character_id = $1 AND pet_id = 'pet_dog'`, [A.character.id]);
    assert.equal(row.rows[0].stage, 2);
    const stones = await db.query(`SELECT count(*)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'evolution_stone'`, [A.character.id]);
    assert.equal(stones.rows[0].n, 0, 'stone used');
    assert.equal((await ack(a.socket, 'pet:evolve')).ok, false, 'stage 3 needs level 60');
    await leaveWorld(a.socket);
  });
});
