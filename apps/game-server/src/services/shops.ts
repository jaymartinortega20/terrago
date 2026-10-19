import { BALANCE, getItem, getShop } from '@terrago/game-data';
import { addItem, removeFromSlot, type ShopView } from '@terrago/shared';
import { GameError, withTransaction, type Pool } from '../db';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { changeGold, logItemMovement } from './ledger';
import { getSkill } from './progress';

/**
 * NPC shops. NPCs sell essentials at fixed prices and buy items back below
 * player-market value (vendorValue × quality), so the player economy matters.
 */

export function shopView(npcId: string): ShopView {
  const shop = getShop(npcId);
  if (!shop) throw new GameError("They don't have anything to sell.");
  return { npcId, name: shop.name, sells: shop.sells, buys: shop.buys };
}

/** What an NPC pays for one unit of an item in a slot. */
export function sellPrice(itemId: string, quality: number, durability: number | null): number {
  const def = getItem(itemId);
  if (!def) return 0;
  const q = BALANCE.farming.qualityValue[quality] ?? 1;
  let price = def.vendorValue * q;
  if (durability !== null && def.maxDurability) price *= Math.max(0.1, durability / def.maxDurability);
  return Math.floor(price);
}

export async function buyFromShop(
  pool: Pool,
  characterId: string,
  npcId: string,
  itemId: unknown,
  quantity: unknown,
): Promise<{ message: string; inventory: ReturnType<typeof toState> }> {
  const shop = getShop(npcId);
  if (!shop) throw new GameError('There is no shop here.');
  const entry = shop.sells.find((e) => e.itemId === itemId);
  if (!entry) throw new GameError("They don't sell that.");
  if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 99) throw new GameError('Invalid quantity.');
  const qty = quantity as number;
  const def = getItem(entry.itemId)!;
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, characterId);
    if (entry.requires) {
      const s = await getSkill(tx, characterId, entry.requires.skill as Parameters<typeof getSkill>[2]);
      if (s.level < entry.requires.level) throw new GameError(`Requires ${entry.requires.skill} level ${entry.requires.level}.`);
    }
    const total = entry.price * qty;
    const { after } = await changeGold(tx, characterId, -total, 'npc_purchase', { type: 'shop', id: npcId });
    const { capacity, slots } = await loadSlots(tx, characterId);
    const res = addItem(slots, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: def.bind === 'pickup' }, qty, def.stackSize);
    if (!res.ok) throw new GameError('Your bag is full.');
    await writeSlots(tx, characterId, res.slots, res.changed);
    await logItemMovement(tx, { itemId: def.id, quantity: qty, to: characterId, reason: 'npc_purchase', ref: { type: 'shop', id: npcId } });
    return { message: `Bought ${qty}× ${def.name} for ${total} Gold.`, inventory: toState(capacity, after, res.slots) };
  });
}

export async function sellToShop(
  pool: Pool,
  characterId: string,
  npcId: string,
  slot: unknown,
  quantity: unknown,
): Promise<{ message: string; inventory: ReturnType<typeof toState> }> {
  const shop = getShop(npcId);
  if (!shop) throw new GameError('There is no shop here.');
  if (!Number.isInteger(slot) || !Number.isInteger(quantity) || (quantity as number) < 1) throw new GameError('Invalid request.');
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const { capacity, slots } = await loadSlots(tx, characterId);
    const s = slots[slot as number];
    if (!s) throw new GameError('That slot is empty.');
    const def = getItem(s.itemId);
    if (!def) throw new GameError('Unknown item.');
    if (!shop.buys.includes(def.category)) throw new GameError(`${shop.name} doesn't buy ${def.category} items.`);
    const unit = sellPrice(s.itemId, s.quality, s.durability);
    if (unit <= 0) throw new GameError(`Nobody will pay for ${def.name}.`);
    const qty = Math.min(quantity as number, s.quantity);
    const res = removeFromSlot(slots, slot as number, qty);
    if (!res.ok) throw new GameError(res.error);
    await writeSlots(tx, characterId, res.slots, [slot as number]);
    await logItemMovement(tx, { itemId: s.itemId, quantity: qty, quality: s.quality, from: characterId, reason: 'npc_sale', ref: { type: 'shop', id: npcId } });
    const total = unit * qty;
    const { after } = await changeGold(tx, characterId, total, 'npc_sale', { type: 'shop', id: npcId });
    void gold;
    return { message: `Sold ${qty}× ${def.name} for ${total} Gold.`, inventory: toState(capacity, after, res.slots) };
  });
}

/** Gold to fully repair one item. */
export function repairCost(itemId: string, durability: number | null): number {
  const def = getItem(itemId);
  if (!def?.maxDurability || durability === null || durability >= def.maxDurability) return 0;
  const missing = (def.maxDurability - durability) / def.maxDurability;
  return Math.max(1, Math.ceil(missing * Math.max(5, def.vendorValue * 0.5)));
}

/** Repair every damaged tool and piece of equipment in the bag (a gold sink). */
export async function repairAll(pool: Pool, characterId: string): Promise<{ message: string; inventory: ReturnType<typeof toState> }> {
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, characterId);
    const { capacity, slots } = await loadSlots(tx, characterId);
    let total = 0;
    const changed: number[] = [];
    const next = slots.map((s, i) => {
      if (!s) return s;
      const cost = repairCost(s.itemId, s.durability);
      if (cost <= 0) return s;
      total += cost;
      changed.push(i);
      return { ...s, durability: getItem(s.itemId)!.maxDurability };
    });
    if (total === 0) throw new GameError('Nothing in your bag needs repairing.');
    const { after } = await changeGold(tx, characterId, -total, 'repair', { type: 'npc', id: 'blacksmith_toren' });
    await writeSlots(tx, characterId, next, changed);
    return { message: `Repaired ${changed.length} item${changed.length === 1 ? '' : 's'} for ${total} Gold.`, inventory: toState(capacity, after, next) };
  });
}
