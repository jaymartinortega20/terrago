import { getClass, getItem } from '@terrago/game-data';
import {
  EQUIP_SLOT_INDEX,
  ENHANCE_SAFE_LEVEL,
  MAX_ENHANCE,
  addItem,
  enhanceChance,
  enhanceCost,
  removeItemById,
  type ClassId,
  type SlotItem,
  type Slots,
} from '@terrago/shared';
import { GameError, withTransaction, type Pool } from '../db';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { specFor } from './specs';
import { changeGold, logItemMovement } from './ledger';
import { grantCharacterXpTx, type ProgressDelta } from './progress';

/**
 * Worn equipment lives in the 'equip' container (slot = EQUIP_SLOTS index).
 * Equipping swaps a bag slot with an equipment slot in one transaction.
 */

type Inv = ReturnType<typeof toState>;

export async function equip(pool: Pool, characterId: string, from: unknown, level: number, classId: ClassId): Promise<Inv> {
  if (!Number.isInteger(from)) throw new GameError('Invalid slot.');
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const bag = await loadSlots(tx, characterId);
    const eq = await loadSlots(tx, characterId, 'equip');
    const item = bag.slots[from as number];
    if (!item) throw new GameError('That slot is empty.');
    const def = getItem(item.itemId);
    if (!def?.equip) throw new GameError(`${def?.name ?? 'That'} can't be worn.`);
    if (level < def.levelRequirement) throw new GameError(`You need level ${def.levelRequirement} to use ${def.name}.`);
    if (def.equip.classes && !def.equip.classes.includes(classId)) {
      throw new GameError(`${def.name} is for ${def.equip.classes.map((c) => getClass(c).name).join('/')}s.`);
    }
    const target = EQUIP_SLOT_INDEX[def.equip.slot];
    let bagSlots: Slots = bag.slots.map((s) => (s ? { ...s } : null));
    const eqSlots = eq.slots.map((s) => (s ? { ...s } : null));
    const prev = eqSlots[target] ?? null;
    // Wear one piece from the stack.
    eqSlots[target] = { ...item, quantity: 1, bound: item.bound || def.bind === 'equip' };
    const changed = new Set<number>([from as number]);
    if (item.quantity > 1) {
      bagSlots[from as number] = { ...item, quantity: item.quantity - 1 };
      if (prev) {
        const pdef = getItem(prev.itemId);
        const res = addItem(bagSlots, { ...prev, quantity: undefined } as unknown as Omit<SlotItem, 'quantity'>, prev.quantity, pdef?.stackSize ?? 1);
        if (!res.ok) throw new GameError('Make room in your bag first.');
        bagSlots = res.slots;
        res.changed.forEach((i) => changed.add(i));
      }
    } else bagSlots[from as number] = prev;
    await writeSlots(tx, characterId, bagSlots, [...changed]);
    await writeSlots(tx, characterId, eqSlots, [target], 'equip');
    return toState(bag.capacity, gold, bagSlots, eqSlots);
  });
}

export async function unequip(pool: Pool, characterId: string, slot: unknown): Promise<Inv> {
  if (!Number.isInteger(slot)) throw new GameError('Invalid slot.');
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const bag = await loadSlots(tx, characterId);
    const eq = await loadSlots(tx, characterId, 'equip');
    const item = eq.slots[slot as number];
    if (!item) throw new GameError('Nothing is worn there.');
    const res = addItem(bag.slots, { ...item, quantity: undefined } as unknown as Omit<SlotItem, 'quantity'>, item.quantity, getItem(item.itemId)?.stackSize ?? 1);
    if (!res.ok) throw new GameError('Your bag is full.');
    const bagSlots = res.slots;
    const eqSlots = eq.slots.map((s) => (s ? { ...s } : null));
    eqSlots[slot as number] = null;
    await writeSlots(tx, characterId, bagSlots, res.changed);
    await writeSlots(tx, characterId, eqSlots, [slot as number], 'equip');
    return toState(bag.capacity, gold, bagSlots, eqSlots);
  });
}

/** Give a character its class's starter weapon once (worn straight away if the hand is empty). */
export async function grantStarterWeapon(pool: Pool, characterId: string, classId: ClassId): Promise<boolean> {
  return withTransaction(pool, async (tx) => {
    const flag = await tx.query(`INSERT INTO character_flags (character_id, flag) VALUES ($1, 'starter_weapon') ON CONFLICT DO NOTHING RETURNING flag`, [characterId]);
    if (!flag.rowCount) return false;
    await lockCharacter(tx, characterId);
    const weaponId = getClass(classId).starterWeapon;
    const def = getItem(weaponId)!;
    const eq = await loadSlots(tx, characterId, 'equip');
    const hand = EQUIP_SLOT_INDEX.mainhand;
    if (!eq.slots[hand]) {
      eq.slots[hand] = { itemId: def.id, quantity: 1, quality: 0, durability: def.maxDurability, bound: true, enhance: 0 };
      await writeSlots(tx, characterId, eq.slots, [hand], 'equip');
    } else {
      const bag = await loadSlots(tx, characterId);
      const res = addItem(bag.slots, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: true, enhance: 0 }, 1, 1);
      if (!res.ok) return false;
      await writeSlots(tx, characterId, res.slots, res.changed);
    }
    await logItemMovement(tx, { itemId: def.id, quantity: 1, to: characterId, reason: 'starter_kit' });
    return true;
  });
}

/** Wear one worn item by `amount` durability. Returns the new equipment if anything changed. */
export async function wearEquipment(pool: Pool, characterId: string, slots: number[], amount = 1): Promise<Slots | null> {
  return withTransaction(pool, async (tx) => {
    const eq = await loadSlots(tx, characterId, 'equip');
    const changed: number[] = [];
    for (const i of slots) {
      const s = eq.slots[i];
      if (!s || s.durability === null || s.durability <= 0) continue;
      s.durability = Math.max(0, s.durability - amount);
      changed.push(i);
    }
    if (!changed.length) return null;
    await writeSlots(tx, characterId, eq.slots, changed, 'equip');
    return eq.slots;
  });
}

/** Death: every worn item loses 10% of its maximum durability. */
export async function deathPenalty(pool: Pool, characterId: string): Promise<Slots | null> {
  return withTransaction(pool, async (tx) => {
    const eq = await loadSlots(tx, characterId, 'equip');
    const changed: number[] = [];
    eq.slots.forEach((s, i) => {
      if (!s || s.durability === null) return;
      const max = getItem(s.itemId)?.maxDurability ?? 0;
      s.durability = Math.max(0, s.durability - Math.ceil(max * 0.1));
      changed.push(i);
    });
    if (!changed.length) return null;
    await writeSlots(tx, characterId, eq.slots, changed, 'equip');
    return eq.slots;
  });
}

/**
 * Enhance a worn item (+1). Costs Gold and Enhancement Stones whatever
 * happens. Failure never destroys the item; above +6 it drops one level.
 */
export async function enhance(pool: Pool, characterId: string, equipSlot: unknown, rand: () => number = Math.random): Promise<{ success: boolean; message: string; inventory: Inv }> {
  if (!Number.isInteger(equipSlot)) throw new GameError('Invalid slot.');
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, characterId);
    const bag = await loadSlots(tx, characterId);
    const eq = await loadSlots(tx, characterId, 'equip');
    const item = eq.slots[equipSlot as number];
    if (!item) throw new GameError('Wear the item you want to enhance.');
    const def = getItem(item.itemId)!;
    const lvl = item.enhance ?? 0;
    if (lvl >= MAX_ENHANCE) throw new GameError(`${def.name} is already +${MAX_ENHANCE}.`);
    const cost = enhanceCost(lvl, def.vendorValue);
    // Gems from mining (Ruby / Sapphire / Diamond). Blessed Enhancement Stones count as Rubies.
    let stones = removeItemById(bag.slots, cost.gem, cost.gems);
    let paidWith: string = cost.gem;
    if (!stones.ok && cost.gem === 'ruby') {
      stones = removeItemById(bag.slots, 'enhancement_stone', cost.gems);
      paidWith = 'enhancement_stone';
    }
    const gemName = getItem(cost.gem)?.name ?? cost.gem;
    if (!stones.ok) throw new GameError(`You need ${cost.gems} ${gemName}${cost.gems > 1 ? 's' : ''} for +${lvl + 1}. Mine them in the ${cost.gem === 'diamond' ? 'Glacial Depths' : 'Desolate Crags'}.`);
    await logItemMovement(tx, { itemId: paidWith, quantity: cost.gems, from: characterId, reason: 'enhance' });
    const { after } = await changeGold(tx, characterId, -cost.gold, 'enhance', { type: 'item', id: def.id });
    const alchemist = (await specFor(tx, characterId, 'alchemy')) === 'enhancement_alchemist';
    const success = rand() < enhanceChance(lvl) + (alchemist ? 0.05 : 0);
    const next = success ? lvl + 1 : lvl >= ENHANCE_SAFE_LEVEL ? lvl - 1 : lvl;
    const eqSlots = eq.slots.map((s) => (s ? { ...s } : null));
    eqSlots[equipSlot as number] = { ...item, enhance: next };
    await writeSlots(tx, characterId, stones.slots, stones.changed);
    await writeSlots(tx, characterId, eqSlots, [equipSlot as number], 'equip');
    const message = success
      ? `Success! ${def.name} is now +${next}.`
      : next < lvl
        ? `Failed... ${def.name} dropped to +${next}.`
        : `Failed. ${def.name} stays at +${lvl}.`;
    return { success, message, inventory: toState(bag.capacity, after, stones.slots, eqSlots) };
  });
}

/**
 * Kill rewards for one player: XP, Gold and loot. Loot that doesn't fit is
 * returned so the world can drop it on the ground for its owner.
 */
export async function grantKillRewards(
  pool: Pool,
  characterId: string,
  r: { xp: number; gold: number; items: { itemId: string; quantity: number }[]; monster: string },
  reason: 'loot' | 'daily_reward' | 'achievement' | 'admin' = 'loot',
): Promise<{ delta: ProgressDelta; inventory: Inv | null; overflow: { itemId: string; quantity: number }[] }> {
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, characterId);
    const delta: ProgressDelta = {};
    if (r.xp > 0) delta.character = await grantCharacterXpTx(tx, characterId, r.xp);
    let inventory: Inv | null = null;
    const overflow: { itemId: string; quantity: number }[] = [];
    if (r.gold > 0 || r.items.length) {
      let { capacity, slots } = await loadSlots(tx, characterId);
      const changed = new Set<number>();
      for (const it of r.items) {
        const def = getItem(it.itemId);
        if (!def) continue;
        const res = addItem(slots, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: def.bind === 'pickup', enhance: 0 }, it.quantity, def.stackSize, false);
        if (!res.ok) {
          overflow.push(it);
          continue;
        }
        slots = res.slots;
        res.changed.forEach((i) => changed.add(i));
        if (res.added > 0) await logItemMovement(tx, { itemId: def.id, quantity: res.added, to: characterId, reason, ref: { type: reason === 'loot' ? 'monster' : reason, id: r.monster } });
        if (res.added < it.quantity) overflow.push({ itemId: def.id, quantity: it.quantity - res.added });
      }
      await writeSlots(tx, characterId, slots, [...changed]);
      let gold = (await lockCharacter(tx, characterId)).gold;
      if (r.gold > 0) gold = (await changeGold(tx, characterId, r.gold, reason, { type: reason === 'loot' ? 'monster' : reason, id: r.monster })).after;
      inventory = toState(capacity, gold, slots);
    }
    return { delta, inventory, overflow };
  });
}

/** Pick up a ground drop (all-or-nothing). */
export async function pickUp(pool: Pool, characterId: string, itemId: string, quantity: number, quality: number): Promise<Inv> {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const { capacity, slots } = await loadSlots(tx, characterId);
    const def = getItem(itemId)!;
    const res = addItem(slots, { itemId, quality, durability: def.maxDurability, bound: def.bind === 'pickup', enhance: 0 }, quantity, def.stackSize);
    if (!res.ok) throw new GameError('Your bag is full.');
    await writeSlots(tx, characterId, res.slots, res.changed);
    await logItemMovement(tx, { itemId, quantity, quality, to: characterId, reason: 'pickup' });
    return toState(capacity, gold, res.slots);
  });
}
