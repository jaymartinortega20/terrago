import { ITEMS } from '@terrago/game-data';
import type { Pool } from '../db';

/** Upsert item definitions from game data so inventory rows have FK integrity. */
export async function syncItemDefinitions(pool: Pool): Promise<number> {
  await pool.query(
    `INSERT INTO items (id, name, category, rarity, stack_size, tradable, bind, max_durability, vendor_value, updated_at)
     SELECT * , now() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::bool[], $7::text[], $8::int[], $9::int[])
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, rarity = EXCLUDED.rarity, stack_size = EXCLUDED.stack_size,
       tradable = EXCLUDED.tradable, bind = EXCLUDED.bind, max_durability = EXCLUDED.max_durability,
       vendor_value = EXCLUDED.vendor_value, updated_at = now()`,
    [
      ITEMS.map((i) => i.id),
      ITEMS.map((i) => i.name),
      ITEMS.map((i) => i.category),
      ITEMS.map((i) => i.rarity),
      ITEMS.map((i) => i.stackSize),
      ITEMS.map((i) => i.tradable),
      ITEMS.map((i) => i.bind),
      ITEMS.map((i) => i.maxDurability),
      ITEMS.map((i) => i.vendorValue),
    ],
  );
  return ITEMS.length;
}
