import { ITEMS, getClass, getItem } from '@terrago/game-data';
import { OUTFITS, addItem, type ClassId } from '@terrago/shared';
import { GameError, withTransaction, type Pool } from '../db';
import { consumeFromSlotTx, loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { logItemMovement } from './ledger';

/** Mythic weapons a cache can hold, by class. */
export function cacheWeapons(classId: ClassId): string[] {
  const weapons = getClass(classId).weapons;
  return ITEMS.filter((i) => i.rarity === 'mythic' && i.id.startsWith('infernal_') && i.equip?.weapon && weapons.includes(i.equip.weapon) && i.equip.classes?.includes(classId)).map((i) => i.id);
}

/**
 * Use an unlock item from the bag: a skin token adds an exclusive skin to the
 * wardrobe; an Infernal Cache turns into a mythic weapon for your class.
 */
export async function useUnlock(pool: Pool, characterId: string, classId: ClassId, slot: number, rand = Math.random): Promise<{ inventory: ReturnType<typeof toState>; message: string }> {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const before = await loadSlots(tx, characterId);
    const s = before.slots[slot];
    const def = s ? getItem(s.itemId) : undefined;
    if (!def?.unlock) throw new GameError("That can't be used.");
    if (def.unlock.skin) {
      const outfit = OUTFITS.findIndex((o) => o.name === def.unlock!.skin);
      if (outfit < 0) throw new GameError('Unknown skin.');
      const owned = await tx.query(`SELECT 1 FROM character_skins WHERE character_id = $1 AND outfit = $2`, [characterId, outfit]);
      if (owned.rowCount) throw new GameError(`You already own the ${def.unlock.skin} skin. Trade this one to a friend!`);
      const res = await consumeFromSlotTx(tx, characterId, slot, 1, 'consume');
      await tx.query(`INSERT INTO character_skins (character_id, outfit) VALUES ($1, $2)`, [characterId, outfit]);
      return { inventory: toState(res.capacity, gold, res.slots), message: `👑 ${def.unlock.skin} skin unlocked! Wear it from Character → Wardrobe.` };
    }
    const pool_ = cacheWeapons(classId);
    if (!pool_.length) throw new GameError('Nothing in here fits your class.');
    const res = await consumeFromSlotTx(tx, characterId, slot, 1, 'consume');
    const pick = getItem(pool_[Math.floor(rand() * pool_.length)]!)!;
    const added = addItem(res.slots, { itemId: pick.id, quality: 0, durability: pick.maxDurability, bound: false, enhance: 0 }, 1, pick.stackSize, false);
    if (!added.ok || added.added < 1) throw new GameError('Make room in your bag first.');
    await writeSlots(tx, characterId, added.slots, added.changed);
    await logItemMovement(tx, { itemId: pick.id, quantity: 1, to: characterId, reason: 'loot', ref: { type: 'cache', id: def.id } });
    return { inventory: toState(res.capacity, gold, added.slots), message: `🔥 The cache opens: ${pick.name}!` };
  });
}
