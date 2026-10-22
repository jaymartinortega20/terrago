import { BALANCE, getClass, getItem, getMap } from '@terrago/game-data';
import { ACCOUNT, maxHp, maxMp, settleEnergy, tileCenter, toInventorySlots, type CharacterSummary, type CreateCharacterInput } from '@terrago/shared';
import { GameError, isUniqueViolation, withTransaction, type Pool } from '../db';
import { sanitizePosition, type CharacterRecord, type PositionSave } from '../world/characterState';

export type { CharacterRecord, PositionSave } from '../world/characterState';
export { buildSelfState } from '../world/characterState';
import { consumeFromSlotTx, grantItemsTx, loadSlots, lockCharacter, toState } from './inventory';
export { loadSlots };
import { changeGold } from './ledger';
import { loadSpecs } from './specs';
import { loadSkills } from './progress';

function toSummary(r: Record<string, any>): CharacterSummary {
  return {
    id: r.id,
    name: r.name,
    classId: r.class_id,
    level: r.level,
    mapId: r.map_id,
    appearance: r.appearance,
    createdAt: new Date(r.created_at).toISOString(),
    lastPlayedAt: r.last_played_at ? new Date(r.last_played_at).toISOString() : null,
  };
}

export async function listCharacters(pool: Pool, userId: string): Promise<CharacterSummary[]> {
  const { rows } = await pool.query(
    `SELECT id, name, class_id, level, map_id, appearance, created_at, last_played_at
       FROM characters WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY last_played_at DESC NULLS LAST, created_at ASC`,
    [userId],
  );
  return rows.map(toSummary);
}

/**
 * Create a character with its stats, starter bag, starter items and starting
 * Gold in a single transaction. Starting Gold goes through the ledger like any
 * other Gold change.
 */
export async function createCharacter(pool: Pool, userId: string, input: CreateCharacterInput): Promise<CharacterSummary> {
  const cls = getClass(input.classId);
  const startMap = getMap(BALANCE.character.startingMap)!;
  const spawn = tileCenter(startMap.spawn.x, startMap.spawn.y);

  try {
    return await withTransaction(pool, async (tx) => {
      // Lock the account row so two parallel requests can't exceed the slot limit.
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const count = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM characters WHERE user_id = $1 AND deleted_at IS NULL',
        [userId],
      );
      if ((count.rows[0]?.n ?? 0) >= ACCOUNT.maxCharacters) {
        throw new GameError(`You can have at most ${ACCOUNT.maxCharacters} characters.`);
      }

      const { rows } = await tx.query(
        `INSERT INTO characters (user_id, name, class_id, appearance, map_id, pos_x, pos_y, direction)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, class_id, level, map_id, appearance, created_at, last_played_at`,
        [userId, input.name, input.classId, JSON.stringify(input.appearance), startMap.id, spawn.x, spawn.y, startMap.spawn.dir],
      );
      const created = rows[0]!;
      const s = cls.baseStats;
      await tx.query(
        `INSERT INTO character_stats (character_id, strength, agility, intelligence, vitality, luck, hp, mp, energy)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [created.id, s.strength, s.agility, s.intelligence, s.vitality, s.luck, maxHp(1, s, cls), maxMp(1, s, cls), BALANCE.energy.startingEnergy],
      );
      await tx.query(`INSERT INTO inventories (character_id, container, capacity) VALUES ($1, 'bag', $2), ($1, 'equip', 9)`, [
        created.id,
        BALANCE.character.inventoryCapacity,
      ]);
      await grantItemsTx(tx, created.id, BALANCE.character.starterItems, 'starter_kit');
      if (BALANCE.character.startingGold > 0) {
        await changeGold(tx, created.id, BALANCE.character.startingGold, 'character_creation');
      }
      return toSummary(created);
    });
  } catch (err) {
    if (isUniqueViolation(err, 'characters_name_key')) throw new GameError('That name is already taken.', 409);
    throw err;
  }
}

/** Load a character for entering the world. Returns null if it doesn't belong to the user. */
export async function loadCharacter(pool: Pool, userId: string, characterId: string): Promise<CharacterRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(characterId)) return null;
  const { rows } = await pool.query(
    `SELECT c.*, s.strength, s.agility, s.intelligence, s.vitality, s.luck, s.hp, s.mp, s.energy, s.energy_updated_at
       FROM characters c JOIN character_stats s ON s.character_id = c.id
      WHERE c.id = $1 AND c.user_id = $2 AND c.deleted_at IS NULL`,
    [characterId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  const rec: CharacterRecord = {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    classId: r.class_id,
    level: r.level,
    xp: Number(r.xp),
    gold: Number(r.gold),
    appearance: r.appearance,
    mapId: r.map_id,
    x: r.pos_x,
    y: r.pos_y,
    dir: r.direction,
    stats: { strength: r.strength, agility: r.agility, intelligence: r.intelligence, vitality: r.vitality, luck: r.luck },
    hp: r.hp,
    mp: r.mp,
    energy: r.energy,
    energyUpdatedAt: new Date(r.energy_updated_at).getTime(),
    skills: await loadSkills(pool, characterId),
    specs: await loadSpecs(pool, characterId),
    equipment: toInventorySlots((await loadSlots(pool, characterId, 'equip')).slots),
  };
  return sanitizePosition(rec);
}

/** Persist many positions in one statement (periodic save, shutdown). */
export async function savePositions(pool: Pool, saves: PositionSave[]): Promise<void> {
  if (saves.length === 0) return;
  await pool.query(
    `UPDATE characters c
        SET map_id = v.map_id, pos_x = v.x, pos_y = v.y, direction = v.dir, last_played_at = now()
       FROM unnest($1::uuid[], $2::text[], $3::float8[], $4::float8[], $5::text[]) AS v(id, map_id, x, y, dir)
      WHERE c.id = v.id`,
    [saves.map((s) => s.id), saves.map((s) => s.mapId), saves.map((s) => s.x), saves.map((s) => s.y), saves.map((s) => s.dir)],
  );
  const withHp = saves.filter((s) => s.hp !== undefined);
  if (withHp.length) {
    await pool.query(
      `UPDATE character_stats cs SET hp = GREATEST(0, v.hp), mp = GREATEST(0, v.mp)
         FROM unnest($1::uuid[], $2::int[], $3::int[]) AS v(id, hp, mp) WHERE cs.character_id = v.id`,
      [withHp.map((s) => s.id), withHp.map((s) => Math.round(s.hp!)), withHp.map((s) => Math.round(s.mp ?? 0))],
    );
  }
}

/**
 * Eat/drink a consumable. Energy is settled from its timestamp first, then the
 * item is removed and Energy applied in the same transaction.
 */
export async function useItem(
  pool: Pool,
  characterId: string,
  slot: number,
): Promise<{ inventory: ReturnType<typeof toState>; energy: number; energyUpdatedAt: number; message: string; hp: number; mp: number }> {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const { slots } = await loadSlots(tx, characterId);
    const s = Number.isInteger(slot) ? slots[slot] : undefined;
    if (!s) throw new GameError('That slot is empty.');
    const def = getItem(s.itemId);
    if (!def?.consumable) throw new GameError(`${def?.name ?? 'That item'} can't be used right now.`);

    const st = await tx.query<{ energy: number; energy_updated_at: Date }>(
      'SELECT energy, energy_updated_at FROM character_stats WHERE character_id = $1',
      [characterId],
    );
    const now = Date.now();
    const settled = settleEnergy(st.rows[0]!.energy, new Date(st.rows[0]!.energy_updated_at).getTime(), now, BALANCE.energy);
    const gain = def.consumable.energy ?? 0;
    const hpGain = def.consumable.hp ?? 0;
    const mpGain = def.consumable.mp ?? 0;
    if (gain > 0 && hpGain === 0 && mpGain === 0 && settled.energy >= BALANCE.energy.max) throw new GameError("You're full of energy already.");

    const res = await consumeFromSlotTx(tx, characterId, slot, 1, 'consume');
    const energy = Math.min(BALANCE.energy.max, settled.energy + gain);
    const energyUpdatedAt = energy >= BALANCE.energy.max ? now : settled.updatedAtMs;
    await tx.query('UPDATE character_stats SET energy = $2, energy_updated_at = $3 WHERE character_id = $1', [
      characterId,
      energy,
      new Date(energyUpdatedAt),
    ]);
    return {
      inventory: toState(res.capacity, gold, res.slots),
      energy,
      energyUpdatedAt,
      message: [`You use the ${def.name}.`, gain ? `Energy +${energy - settled.energy}` : '', hpGain ? `HP +${hpGain}` : '', mpGain ? `MP +${mpGain}` : ''].filter(Boolean).join(' '),
      hp: hpGain,
      mp: mpGain,
    };
  });
}
