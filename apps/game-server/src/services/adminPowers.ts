/**
 * Game-master powers. Every change goes through the normal ledgers (Gold and
 * item logs, reason 'admin') so the economy dashboard and audits stay honest.
 */
import { BALANCE, getItem, getMap, waystones } from '@terrago/game-data';
import { addItem, xpToNext, type InventoryState } from '@terrago/shared';
import { GameError, withTransaction, type Pool } from '../db';
import type { World } from '../world/world';
import { getInventory, loadSlots, lockCharacter, writeSlots } from './inventory';
import { changeGold, logItemMovement } from './ledger';
import { grantKillRewards } from './equipment';
import { loadSkills } from './progress';

export const MAX_GIFT_GOLD = 1_000_000_000;
export const MAX_GIFT_QTY = 9_999;

type Items = { itemId: string; quantity: number }[];

/** Push a fresh inventory to an online player. */
async function refreshInventory(pool: Pool, world: World, characterId: string): Promise<InventoryState | null> {
  const p = world.players.get(characterId);
  if (!p) return null;
  const inv = await getInventory(pool, characterId);
  world.inventoryCache.set(characterId, inv);
  p.rec.gold = inv.gold;
  p.conn?.send('inventory:update', inv);
  return inv;
}

/** Put items into the bank (for gifts that don't fit the bag). Returns what still didn't fit. */
async function giveToBank(pool: Pool, characterId: string, items: Items, by: string): Promise<Items> {
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, characterId);
    let { slots } = await loadSlots(tx, characterId, 'bank');
    const changed = new Set<number>();
    const left: Items = [];
    for (const it of items) {
      const def = getItem(it.itemId);
      if (!def) continue;
      const res = addItem(slots, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: def.bind === 'pickup', enhance: 0 }, it.quantity, def.stackSize, false);
      if (!res.ok || res.added === 0) {
        left.push(it);
        continue;
      }
      slots = res.slots;
      res.changed.forEach((i) => changed.add(i));
      await logItemMovement(tx, { itemId: def.id, quantity: res.added, to: characterId, reason: 'admin', ref: { type: 'admin', id: by } });
      if (res.added < it.quantity) left.push({ itemId: def.id, quantity: it.quantity - res.added });
    }
    if (changed.size) await writeSlots(tx, characterId, slots, [...changed], 'bank');
    return left;
  });
}

/** Give Gold and any number of items. Bag first, then the bank; reports what didn't fit. */
export async function adminGive(pool: Pool, world: World, characterId: string, gold: number, items: Items, by: string): Promise<{ bag: number; bank: number; leftover: Items }> {
  if (!Number.isSafeInteger(gold) || gold < 0 || gold > MAX_GIFT_GOLD) throw new GameError(`Gold must be 0–${MAX_GIFT_GOLD.toLocaleString()}.`);
  if (items.length > 200) throw new GameError('Up to 200 different items at a time.');
  for (const it of items) {
    if (!getItem(it.itemId)) throw new GameError(`Unknown item: ${it.itemId}`);
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_GIFT_QTY) throw new GameError(`Quantity must be 1–${MAX_GIFT_QTY}.`);
  }
  if (!gold && !items.length) throw new GameError('Nothing to give.');
  const res = await grantKillRewards(pool, characterId, { xp: 0, gold, items, monster: `admin:${by}` }, 'admin');
  const intoBag = items.reduce((a, i) => a + i.quantity, 0) - res.overflow.reduce((a, i) => a + i.quantity, 0);
  const leftover = res.overflow.length ? await giveToBank(pool, characterId, res.overflow, by) : [];
  const intoBank = res.overflow.reduce((a, i) => a + i.quantity, 0) - leftover.reduce((a, i) => a + i.quantity, 0);
  await refreshInventory(pool, world, characterId);
  const p = world.players.get(characterId);
  if (p) {
    const what = [gold ? `${gold.toLocaleString()} Gold` : '', items.length === 1 ? `${items[0]!.quantity}× ${getItem(items[0]!.itemId)!.name}` : items.length ? `${items.length} kinds of items` : ''].filter(Boolean).join(' and ');
    world.system(p, `🎁 A game master sent you ${what}.${intoBank ? ' Some went to your bank (bag full).' : ''}`);
  }
  return { bag: intoBag, bank: intoBank, leftover };
}

/** Set Gold to an exact amount (logged as an admin change). */
export async function adminSetGold(pool: Pool, world: World, characterId: string, target: number, by: string): Promise<number> {
  if (!Number.isSafeInteger(target) || target < 0 || target > 100 * MAX_GIFT_GOLD) throw new GameError('Gold must be 0–100,000,000,000.');
  const after = await withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    if (target === gold) return gold;
    return (await changeGold(tx, characterId, target - gold, 'admin', { type: 'admin', id: by })).after;
  });
  await refreshInventory(pool, world, characterId);
  return after;
}

/** Set character level (XP resets to the start of that level) and heal fully. */
export async function adminSetLevel(pool: Pool, world: World, characterId: string, level: number): Promise<void> {
  const max = BALANCE.xpCurve.maxLevel;
  if (!Number.isInteger(level) || level < 1 || level > max) throw new GameError(`Level must be 1–${max}.`);
  const { rowCount } = await pool.query(`UPDATE characters SET level = $2, xp = 0 WHERE id = $1`, [characterId, level]);
  if (!rowCount) throw new GameError('No such character.');
  const p = world.players.get(characterId);
  // Offline: store "full" HP/MP; it is capped to the real maximum when they log in.
  if (!p) {
    await pool.query(`UPDATE character_stats SET hp = 1000000, mp = 1000000 WHERE character_id = $1`, [characterId]);
    return;
  }
  p.rec.level = level;
  p.rec.xp = 0;
  world.refreshProfile(p);
  p.rec.hp = p.profile.maxHp;
  p.rec.mp = p.profile.maxMp;
  p.dirty = true;
  p.conn?.send('self:update', {
    level,
    xp: 0,
    xpToNext: xpToNext(level, BALANCE.xpCurve),
    hp: p.rec.hp,
    mp: p.rec.mp,
    maxHp: p.profile.maxHp,
    maxMp: p.profile.maxMp,
    stats: p.profile.stats,
    derived: p.profile.derived,
  });
  world.system(p, `⭐ A game master set you to level ${level}.`);
}

/** Set every profession (farming, mining, cooking...) to a level. */
export async function adminSetProfessions(pool: Pool, world: World, characterId: string, level: number): Promise<void> {
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new GameError('Profession level must be 1–100.');
  await pool.query(
    `INSERT INTO character_skills (character_id, skill, level, xp)
       SELECT $1, s, $2, 0 FROM unnest(ARRAY['farming','mining','woodcutting','fishing','gathering','cooking','smithing','alchemy','crafting','trading']) AS s
     ON CONFLICT (character_id, skill) DO UPDATE SET level = EXCLUDED.level, xp = 0, updated_at = now()`,
    [characterId, level],
  );
  const p = world.players.get(characterId);
  if (!p) return;
  p.rec.skills = await loadSkills(pool, characterId);
  p.conn?.send('self:update', { skills: p.rec.skills });
  world.system(p, `⭐ A game master set all your professions to level ${level}.`);
}

/** Full HP, MP and energy. */
export async function adminHeal(pool: Pool, world: World, characterId: string): Promise<void> {
  const max = BALANCE.energy.max;
  await pool.query(`UPDATE character_stats SET energy = $2, energy_updated_at = now(), hp = 1000000, mp = 1000000 WHERE character_id = $1`, [characterId, max]);
  const p = world.players.get(characterId);
  if (!p) return;
  p.rec.hp = p.profile.maxHp;
  p.rec.mp = p.profile.maxMp;
  p.rec.energy = max;
  p.rec.energyUpdatedAt = Date.now();
  p.dirty = true;
  p.conn?.send('self:update', { hp: p.rec.hp, mp: p.rec.mp, energy: max });
}

/** Unlock every waystone for fast travel. */
export async function adminUnlockWaystones(pool: Pool, characterId: string): Promise<number> {
  const maps = [...new Set(waystones().map((w) => w.mapId))];
  await pool.query(`INSERT INTO character_flags (character_id, flag) SELECT $1, 'visited:' || m FROM unnest($2::text[]) AS m ON CONFLICT DO NOTHING`, [characterId, maps]);
  return maps.length;
}

/** Move a character to a map (at its arrival point, or a tile). Online players move instantly. */
export async function adminTeleport(pool: Pool, world: World, characterId: string, mapId: string, tx?: number, ty?: number): Promise<void> {
  const def = getMap(mapId);
  if (!def || def.dungeon) throw new GameError('Unknown map (dungeons can only be entered at their gate).');
  const x = Number.isInteger(tx) ? tx! : def.spawn.x;
  const y = Number.isInteger(ty) ? ty! : def.spawn.y;
  if (x < 0 || y < 0 || x >= def.width || y >= def.height) throw new GameError('That tile is outside the map.');
  const p = world.players.get(characterId);
  if (p) {
    world.setMount(p, null, 1);
    await world.moveTo(p, mapId, null, x, y, 'down');
    world.system(p, `✨ A game master moved you to ${def.name}.`);
    return;
  }
  await pool.query(`UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4 WHERE id = $1`, [characterId, mapId, x * 32 + 16, y * 32 + 16]);
}
