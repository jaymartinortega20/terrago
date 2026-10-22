import { getItem } from '@terrago/game-data';
import { addItem, removeFromSlot, type InventorySlot } from '@terrago/shared';
import { GameError, withTransaction, type Pool, type Tx } from '../db';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { changeGold } from './ledger';

/** Bank storage: size by tier, upgrades cost Gold (a gold sink). */
export const BANK_TIERS = [
  { capacity: 30, cost: 0 },
  { capacity: 40, cost: 1000 },
  { capacity: 50, cost: 3000 },
  { capacity: 60, cost: 8000 },
  { capacity: 80, cost: 20000 },
];

export interface BankView {
  capacity: number;
  tier: number;
  next: { capacity: number; cost: number } | null;
  slots: InventorySlot[];
}

async function ensureBank(tx: Tx, id: string): Promise<void> {
  await tx.query(`INSERT INTO inventories (character_id, container, capacity) VALUES ($1, 'bank', $2) ON CONFLICT DO NOTHING`, [id, BANK_TIERS[0]!.capacity]);
}

function view(capacity: number, slots: ReturnType<typeof toState>['slots']): BankView {
  const tier = Math.max(0, BANK_TIERS.findIndex((t) => t.capacity === capacity));
  return { capacity, tier, next: BANK_TIERS[tier + 1] ?? null, slots };
}

export async function bankView(pool: Pool, id: string): Promise<BankView> {
  return withTransaction(pool, async (tx) => {
    await ensureBank(tx, id);
    const { capacity, slots } = await loadSlots(tx, id, 'bank');
    return view(capacity, toState(capacity, 0, slots).slots);
  });
}

/** Move a whole stack between bag and bank. */
export async function bankMove(pool: Pool, id: string, dir: 'deposit' | 'withdraw', slot: unknown) {
  if (!Number.isInteger(slot)) throw new GameError('Pick an item.');
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, id);
    await ensureBank(tx, id);
    const bag = await loadSlots(tx, id, 'bag');
    const bank = await loadSlots(tx, id, 'bank');
    const [from, to] = dir === 'deposit' ? [bag, bank] : [bank, bag];
    const item = from.slots[slot as number];
    if (!item) throw new GameError('That slot is empty.');
    const def = getItem(item.itemId)!;
    const added = addItem(to.slots, { ...item }, item.quantity, def.stackSize);
    if (!added.ok) throw new GameError(dir === 'deposit' ? 'Your bank is full. Upgrade it with the banker.' : 'Your bag is full.');
    const taken = removeFromSlot(from.slots, slot as number, item.quantity);
    if (!taken.ok) throw new GameError(taken.error);
    await writeSlots(tx, id, taken.slots, [slot as number], dir === 'deposit' ? 'bag' : 'bank');
    await writeSlots(tx, id, added.slots, added.changed, dir === 'deposit' ? 'bank' : 'bag');
    const bagSlots = dir === 'deposit' ? taken.slots : added.slots;
    const bankSlots = dir === 'deposit' ? added.slots : taken.slots;
    return { inventory: toState(bag.capacity, gold, bagSlots), bank: view(bank.capacity, toState(bank.capacity, 0, bankSlots).slots) };
  });
}

export async function bankUpgrade(pool: Pool, id: string) {
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, id);
    await ensureBank(tx, id);
    const { capacity } = await loadSlots(tx, id, 'bank');
    const tier = BANK_TIERS.findIndex((t) => t.capacity === capacity);
    const next = BANK_TIERS[tier + 1];
    if (!next) throw new GameError('Your vault is as big as it gets.');
    const { after } = await changeGold(tx, id, -next.cost, 'storage', { type: 'bank', id: String(tier + 1) });
    await tx.query(`UPDATE inventories SET capacity = $2 WHERE character_id = $1 AND container = 'bank'`, [id, next.capacity]);
    const bank = await loadSlots(tx, id, 'bank');
    return { gold: after, bank: view(next.capacity, toState(next.capacity, 0, bank.slots).slots), message: `Your vault now holds ${next.capacity} stacks.` };
  });
}
