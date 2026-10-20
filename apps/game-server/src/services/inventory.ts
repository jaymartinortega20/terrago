import { getItem } from '@terrago/game-data';
import {
  addItem,
  emptySlots,
  moveItem,
  removeFromSlot,
  toInventorySlots,
  type InventoryState,
  type Slots,
} from '@terrago/shared';
import { GameError, withTransaction, type Pool, type Tx } from '../db';
import { logItemMovement, type ItemReason } from './ledger';

/**
 * Server-side inventory. Every mutation:
 *   1. opens a transaction and locks the character row (serializes all
 *      inventory/gold changes for that character),
 *   2. loads the slots, applies a pure rule from @terrago/shared,
 *   3. writes only the changed slots and an item ledger entry,
 *   4. commits — or rolls back entirely on any error.
 */

const lookup = (id: string) => {
  const def = getItem(id);
  return def ? { stackSize: def.stackSize } : undefined;
};

export async function lockCharacter(tx: Tx, characterId: string): Promise<{ gold: number }> {
  const { rows } = await tx.query<{ gold: number }>(
    'SELECT gold FROM characters WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
    [characterId],
  );
  if (!rows[0]) throw new GameError('Character not found.', 404);
  return { gold: Number(rows[0].gold) };
}

export type Container = 'bag' | 'equip';

export async function loadSlots(tx: Tx | Pool, characterId: string, container: Container = 'bag'): Promise<{ capacity: number; slots: Slots }> {
  const cap = await tx.query<{ capacity: number }>(`SELECT capacity FROM inventories WHERE character_id = $1 AND container = $2`, [characterId, container]);
  const capacity = cap.rows[0]?.capacity ?? (container === 'equip' ? 9 : 0);
  const slots = emptySlots(capacity);
  const { rows } = await tx.query(
    `SELECT slot, item_id, quantity, quality, durability, bound, enhance
       FROM inventory_items WHERE character_id = $1 AND container = $2`,
    [characterId, container],
  );
  for (const r of rows) {
    if (r.slot < capacity) {
      slots[r.slot] = { itemId: r.item_id, quantity: r.quantity, quality: r.quality, durability: r.durability, bound: r.bound, enhance: r.enhance };
    }
  }
  return { capacity, slots };
}

export async function writeSlots(tx: Tx, characterId: string, slots: Slots, changed: number[], container: Container = 'bag'): Promise<void> {
  if (container === 'equip') {
    await tx.query(`INSERT INTO inventories (character_id, container, capacity) VALUES ($1, 'equip', 9) ON CONFLICT DO NOTHING`, [characterId]);
  }
  for (const i of changed) {
    const s = slots[i];
    if (!s) {
      await tx.query(`DELETE FROM inventory_items WHERE character_id = $1 AND container = $3 AND slot = $2`, [characterId, i, container]);
    } else {
      await tx.query(
        `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, quality, durability, bound, enhance)
         VALUES ($1, $9, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (character_id, container, slot)
         DO UPDATE SET item_id = EXCLUDED.item_id, quantity = EXCLUDED.quantity, quality = EXCLUDED.quality,
                       durability = EXCLUDED.durability, bound = EXCLUDED.bound, enhance = EXCLUDED.enhance`,
        [characterId, i, s.itemId, s.quantity, s.quality, s.durability, s.bound, s.enhance ?? 0, container],
      );
    }
  }
}

/** Inventory snapshot for the client. Equipment is included when known (otherwise the client keeps what it has). */
export function toState(capacity: number, gold: number, slots: Slots, equipment?: Slots): InventoryState {
  return { capacity, gold, slots: toInventorySlots(slots), ...(equipment ? { equipment: toInventorySlots(equipment) } : {}) } as InventoryState;
}

export async function getInventory(pool: Pool, characterId: string): Promise<InventoryState> {
  const [{ capacity, slots }, equip, gold] = await Promise.all([
    loadSlots(pool, characterId),
    loadSlots(pool, characterId, 'equip'),
    pool.query<{ gold: number }>('SELECT gold FROM characters WHERE id = $1', [characterId]),
  ]);
  return toState(capacity, Number(gold.rows[0]?.gold ?? 0), slots, equip.slots);
}

/**
 * Grant several items at once, all-or-nothing (inside an existing transaction).
 * Throws GameError if the bag can't hold everything.
 */
export async function grantItemsTx(
  tx: Tx,
  characterId: string,
  grants: { itemId: string; quantity: number; quality?: number }[],
  reason: ItemReason,
  ref?: { type: string; id: string },
): Promise<{ capacity: number; slots: Slots }> {
  const { capacity, slots: initial } = await loadSlots(tx, characterId);
  let slots = initial;
  const changed = new Set<number>();
  for (const g of grants) {
    const def = getItem(g.itemId);
    if (!def) throw new Error(`Unknown item ${g.itemId}`);
    const res = addItem(
      slots,
      { itemId: def.id, quality: g.quality ?? 0, durability: def.maxDurability, bound: def.bind === 'pickup', enhance: 0 },
      g.quantity,
      def.stackSize,
    );
    if (!res.ok) throw new GameError('Your bag is full. Make some room first.');
    slots = res.slots;
    res.changed.forEach((i) => changed.add(i));
  }
  await writeSlots(tx, characterId, slots, [...changed]);
  for (const g of grants) {
    await logItemMovement(tx, { itemId: g.itemId, quantity: g.quantity, quality: g.quality ?? 0, to: characterId, reason, ref });
  }
  return { capacity, slots };
}

export async function moveInventoryItem(pool: Pool, characterId: string, from: number, to: number): Promise<InventoryState> {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const { capacity, slots } = await loadSlots(tx, characterId);
    const res = moveItem(slots, from, to, lookup);
    if (!res.ok) throw new GameError(res.error);
    await writeSlots(tx, characterId, res.slots, res.changed);
    return toState(capacity, gold, res.slots);
  });
}

/** Remove `quantity` from a slot inside an open transaction and log it. */
export async function consumeFromSlotTx(
  tx: Tx,
  characterId: string,
  slot: number,
  quantity: number,
  reason: ItemReason,
): Promise<{ capacity: number; slots: Slots; removedItemId: string }> {
  const { capacity, slots } = await loadSlots(tx, characterId);
  const res = removeFromSlot(slots, slot, quantity);
  if (!res.ok) throw new GameError(res.error);
  await writeSlots(tx, characterId, res.slots, [slot]);
  await logItemMovement(tx, { itemId: res.removed.itemId, quantity, quality: res.removed.quality, from: characterId, reason });
  return { capacity, slots: res.slots, removedItemId: res.removed.itemId };
}
