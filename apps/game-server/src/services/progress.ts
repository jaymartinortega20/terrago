import { BALANCE } from '@terrago/game-data';
import {
  SKILL_IDS,
  addSkillXp,
  applyXp,
  emptySkills,
  settleEnergy,
  type SkillId,
  type SkillProgress,
  type SkillSet,
} from '@terrago/shared';
import { GameError, type Pool, type Tx } from '../db';

/**
 * Character progression helpers that run inside an open transaction:
 * Energy, profession XP and character XP. Callers must already hold the
 * character row lock (lockCharacter) so concurrent actions serialize.
 */

export async function loadSkills(db: Pool | Tx, characterId: string): Promise<SkillSet> {
  const skills = emptySkills(BALANCE.skillCurve);
  const { rows } = await db.query<{ skill: SkillId; level: number; xp: number }>(
    'SELECT skill, level, xp FROM character_skills WHERE character_id = $1',
    [characterId],
  );
  for (const r of rows) {
    if (!(SKILL_IDS as readonly string[]).includes(r.skill)) continue;
    skills[r.skill] = addSkillXp({ level: r.level, xp: Number(r.xp) }, 0, BALANCE.skillCurve);
  }
  return skills;
}

export async function getSkill(tx: Tx, characterId: string, skill: SkillId): Promise<SkillProgress> {
  const { rows } = await tx.query<{ level: number; xp: number }>(
    'SELECT level, xp FROM character_skills WHERE character_id = $1 AND skill = $2',
    [characterId, skill],
  );
  const r = rows[0];
  return addSkillXp({ level: r?.level ?? 1, xp: Number(r?.xp ?? 0) }, 0, BALANCE.skillCurve);
}

export async function grantSkillXpTx(
  tx: Tx,
  characterId: string,
  skill: SkillId,
  amount: number,
): Promise<SkillProgress & { levelsGained: number }> {
  const cur = await getSkill(tx, characterId, skill);
  const next = addSkillXp(cur, Math.max(0, Math.floor(amount)), BALANCE.skillCurve);
  await tx.query(
    `INSERT INTO character_skills (character_id, skill, level, xp, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (character_id, skill) DO UPDATE SET level = EXCLUDED.level, xp = EXCLUDED.xp, updated_at = now()`,
    [characterId, skill, next.level, next.xp],
  );
  return next;
}

export async function grantCharacterXpTx(
  tx: Tx,
  characterId: string,
  amount: number,
): Promise<{ level: number; xp: number; levelsGained: number }> {
  const { rows } = await tx.query<{ level: number; xp: number }>('SELECT level, xp FROM characters WHERE id = $1', [characterId]);
  const r = rows[0];
  if (!r) throw new Error(`Character ${characterId} not found`);
  const res = applyXp(r.level, Number(r.xp), Math.max(0, Math.floor(amount)), BALANCE.xpCurve);
  if (res.level !== r.level || res.xp !== Number(r.xp)) {
    await tx.query('UPDATE characters SET level = $2, xp = $3 WHERE id = $1', [characterId, res.level, res.xp]);
  }
  return res;
}

/** Spend Energy (settled from its timestamp first). Throws if there isn't enough. */
export async function spendEnergyTx(
  tx: Tx,
  characterId: string,
  amount: number,
  now = Date.now(),
): Promise<{ energy: number; energyUpdatedAt: number }> {
  const st = await tx.query<{ energy: number; energy_updated_at: Date }>(
    'SELECT energy, energy_updated_at FROM character_stats WHERE character_id = $1',
    [characterId],
  );
  const row = st.rows[0]!;
  const settled = settleEnergy(row.energy, new Date(row.energy_updated_at).getTime(), now, BALANCE.energy);
  if (amount <= 0) return { energy: settled.energy, energyUpdatedAt: settled.updatedAtMs };
  if (settled.energy < amount) throw new GameError("You're too tired. Eat something or rest a while.");
  const energy = settled.energy - amount;
  // Regeneration restarts from now if we were full; otherwise keep partial progress.
  const energyUpdatedAt = settled.energy >= BALANCE.energy.max ? now : settled.updatedAtMs;
  await tx.query('UPDATE character_stats SET energy = $2, energy_updated_at = $3 WHERE character_id = $1', [
    characterId,
    energy,
    new Date(energyUpdatedAt),
  ]);
  return { energy, energyUpdatedAt };
}

/** Changes produced by an action, for the caller to push to the client and live state. */
export interface ProgressDelta {
  energy?: { energy: number; energyUpdatedAt: number };
  skill?: { id: SkillId; progress: SkillProgress; levelsGained: number };
  character?: { level: number; xp: number; levelsGained: number };
}
