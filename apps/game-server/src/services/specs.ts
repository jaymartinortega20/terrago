import { getItem } from '@terrago/game-data';
import { SKILL_NAMES, SPEC_CHANGE_COST, SPEC_LEVEL, SPEC_MAX, getSpec, type RecipeDef, type SkillId } from '@terrago/shared';
import { GameError, withTransaction, type Pool, type Tx } from '../db';
import { lockCharacter } from './inventory';
import { changeGold } from './ledger';
import { getSkill } from './progress';

export async function loadSpecs(db: Pool | Tx, characterId: string): Promise<Record<string, string>> {
  const { rows } = await db.query(`SELECT skill, spec FROM character_specializations WHERE character_id = $1`, [characterId]);
  return Object.fromEntries(rows.map((r) => [r.skill, r.spec]));
}

export async function specFor(db: Pool | Tx, characterId: string, skill: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT spec FROM character_specializations WHERE character_id = $1 AND skill = $2`, [characterId, skill]);
  return rows[0]?.spec ?? null;
}

/** Pick (or change) a specialization. First picks are free; changing one costs Gold. */
export async function chooseSpec(pool: Pool, characterId: string, skill: unknown, specId: unknown): Promise<{ specs: Record<string, string>; gold: number | null; message: string }> {
  const spec = typeof specId === 'string' ? getSpec(specId) : undefined;
  if (!spec || spec.skill !== skill) throw new GameError('Unknown specialization.');
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, characterId);
    const lvl = (await getSkill(tx, characterId, spec.skill as SkillId)).level;
    const name = SKILL_NAMES[spec.skill as SkillId];
    if (lvl < SPEC_LEVEL) throw new GameError(`Reach ${name} level ${SPEC_LEVEL} to specialize.`);
    const current = await loadSpecs(tx, characterId);
    if (current[spec.skill] === spec.id) throw new GameError(`You are already a ${spec.name}.`);
    let gold: number | null = null;
    if (current[spec.skill]) {
      gold = (await changeGold(tx, characterId, -SPEC_CHANGE_COST, 'specialization', { type: 'spec', id: spec.id })).after;
    } else if (Object.keys(current).length >= SPEC_MAX) {
      throw new GameError(`You can specialize in ${SPEC_MAX} professions at most. Other players are your specialists for the rest!`);
    }
    await tx.query(
      `INSERT INTO character_specializations (character_id, skill, spec) VALUES ($1, $2, $3)
       ON CONFLICT (character_id, skill) DO UPDATE SET spec = EXCLUDED.spec, chosen_at = now()`,
      [characterId, spec.skill, spec.id],
    );
    return {
      specs: { ...current, [spec.skill]: spec.id },
      gold,
      message: gold !== null ? `You retrained as a ${spec.name} (-${SPEC_CHANGE_COST} Gold).` : `You are now a ${spec.name}!`,
    };
  });
}

/** Output multiplier, fee waiver and XP bonus a specialization gives on a recipe. */
export function specEffect(recipe: RecipeDef, spec: string | null): { outMult: number; xpMult: number; noFee: boolean } {
  const out = recipe.output.itemId;
  const cat = getItem(out)?.category;
  const dairyOrBaked = /cheese|butter|bread|pie|cake|cookie/.test(out);
  let outMult = 1;
  let noFee = false;
  if (spec === 'potion_master' && recipe.skill === 'alchemy' && cat === 'consumable') outMult = 2;
  if (spec === 'enhancement_alchemist' && out === 'enhancement_stone') outMult = 2;
  if (spec === 'artificer' && recipe.skill === 'crafting' && /plank|rope|rod/.test(out)) outMult = 2;
  if (spec === 'chef' && recipe.skill === 'cooking' && !dairyOrBaked) outMult = 2;
  if (spec === 'brewer' && dairyOrBaked) {
    outMult = 2;
    noFee = true;
  }
  return { outMult, xpMult: recipe.spec && recipe.spec === spec ? 1.5 : 1, noFee };
}
