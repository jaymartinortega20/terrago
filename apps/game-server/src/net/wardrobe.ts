import { BASE_OUTFIT_COUNT, OUTFITS, type Appearance } from '@terrago/shared';
import { GameError, type Pool } from '../db';
import { premiumOutfits } from '../services/gems';
import type { World } from '../world/world';
import type { Player } from '../world/player';

/** Skins this character owns (outfit indexes beyond the starter outfits). */
export async function ownedSkins(pool: Pool, characterId: string): Promise<number[]> {
  const { rows } = await pool.query<{ outfit: number }>(
    `SELECT outfit FROM character_skins WHERE character_id = $1 ORDER BY outfit`,
    [characterId],
  );
  // Gem Shop skins belong to the whole account.
  const u = await pool.query<{ user_id: string }>(`SELECT user_id FROM characters WHERE id = $1`, [characterId]);
  const premium = u.rows[0] ? await premiumOutfits(pool, u.rows[0].user_id) : [];
  return [...new Set([...rows.map((r) => r.outfit), ...premium])].filter((o) => o >= 0 && o < OUTFITS.length).sort((a, b) => a - b);
}

/** Put on an outfit: any starter outfit, or a skin you own. Everyone nearby sees the change. */
export async function wearOutfit(pool: Pool, world: World, p: Player, outfit: unknown): Promise<{ outfit: number; owned: number[] }> {
  const o = Number(outfit);
  if (!Number.isInteger(o) || o < 0 || o >= OUTFITS.length) throw new GameError('Unknown outfit.');
  const owned = await ownedSkins(pool, p.id);
  if (o >= BASE_OUTFIT_COUNT && !owned.includes(o)) throw new GameError("You don't own that skin.");
  await applyAppearance(pool, world, p.id, { outfit: o });
  return { outfit: o, owned };
}

/** Change a character's look in the database and, if they're online, on screen for everyone. */
export async function applyAppearance(pool: Pool, world: World, characterId: string, patch: Partial<Appearance>): Promise<Appearance> {
  const { rows } = await pool.query<{ appearance: Appearance }>(
    `UPDATE characters SET appearance = appearance || $2::jsonb WHERE id = $1 RETURNING appearance`,
    [characterId, JSON.stringify(patch)],
  );
  if (!rows[0]) throw new GameError('No such character.');
  const p = world.players.get(characterId);
  if (p) {
    p.rec.appearance = rows[0].appearance;
    world.broadcastLook(p, { appearance: rows[0].appearance });
    p.conn?.send('entity:update', p.id, { appearance: rows[0].appearance });
  }
  return rows[0].appearance;
}
