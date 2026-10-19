import { GameError, type Tx } from '../db';

export type GoldReason =
  | 'character_creation'
  | 'quest'
  | 'npc_sale'
  | 'npc_purchase'
  | 'marketplace_sale'
  | 'marketplace_purchase'
  | 'marketplace_fee'
  | 'marketplace_tax'
  | 'trade'
  | 'repair'
  | 'teleport'
  | 'craft'
  | 'admin'
  | 'farm_upgrade'
  | 'loot'
  | 'enhance'
  | 'guild'
  | 'storage'
  | 'daily_reward'
  | 'achievement'
  | 'specialization'
  | 'skill_training'
  | 'death';

export type ItemReason =
  | 'starter_kit'
  | 'npc_reward'
  | 'consume'
  | 'npc_sale'
  | 'npc_purchase'
  | 'trade'
  | 'marketplace'
  | 'craft'
  | 'harvest'
  | 'gather'
  | 'loot'
  | 'admin'
  | 'plant'
  | 'fertilize'
  | 'farm_upgrade'
  | 'tool_broken'
  | 'quest'
  | 'daily_reward'
  | 'achievement'
  | 'enhance'
  | 'pickup'
  | 'mail'
  | 'discard'
  | 'equip';

/**
 * Change a character's Gold inside an open transaction and write the ledger
 * row (before/after balance, reason). Refuses to go negative. The character
 * row is locked FOR UPDATE so concurrent changes serialize.
 */
export async function changeGold(
  tx: Tx,
  characterId: string,
  amount: number,
  reason: GoldReason,
  ref?: { type: string; id: string },
): Promise<{ before: number; after: number }> {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error(`Invalid gold amount ${amount}`);
  const { rows } = await tx.query<{ gold: number }>('SELECT gold FROM characters WHERE id = $1 FOR UPDATE', [characterId]);
  const row = rows[0];
  if (!row) throw new Error(`Character ${characterId} not found`);
  const before = Number(row.gold);
  const after = before + amount;
  if (after < 0) throw new GameError('Not enough Gold.');
  await tx.query('UPDATE characters SET gold = $2 WHERE id = $1', [characterId, after]);
  await tx.query(
    `INSERT INTO currency_transactions (character_id, amount, balance_before, balance_after, reason, ref_type, ref_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [characterId, amount, before, after, reason, ref?.type ?? null, ref?.id ?? null],
  );
  return { before, after };
}

export async function logItemMovement(
  tx: Tx,
  entry: {
    itemId: string;
    quantity: number;
    quality?: number;
    from?: string | null;
    to?: string | null;
    reason: ItemReason;
    ref?: { type: string; id: string };
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO item_transactions (item_id, quantity, quality, from_character_id, to_character_id, reason, ref_type, ref_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.itemId,
      entry.quantity,
      entry.quality ?? 0,
      entry.from ?? null,
      entry.to ?? null,
      entry.reason,
      entry.ref?.type ?? null,
      entry.ref?.id ?? null,
    ],
  );
}
