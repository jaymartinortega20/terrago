/**
 * Applies shared/formulas to resolve attacks server-side (docs/ARCHITECTURE.md).
 * Builds the AttackerCombatInput/DefenderCombatInput shapes shared/formulas.ts
 * expects from a character's stats+weapon or a monster's flat combat stats,
 * then wraps resolveAttack with HP bookkeeping and loot/gold rolls. No
 * networking, no room/entity knowledge - all pure and unit testable.
 */
import {
  BALANCE,
  attackIntervalMs as weaponAttackIntervalMs,
  critChance,
  flee,
  hit,
  meleeAtk,
  perfectDodgeChance,
  physicalDef,
  resolveAttack,
  type AttackOutcome,
  type AttackerCombatInput,
  type DefenderCombatInput,
  type DropEntry,
  type MonsterDef,
  type Stats,
} from '@terago/shared';

export interface CharacterCombatProfile {
  baseLevel: number;
  stats: Stats;
  /** 0 for bare fists - M1 has no unarmed-combat design, but nothing should
   * throw if a character somehow has no weapon equipped. */
  weaponAtk: number;
  weaponBaseAttackIntervalMs: number;
  /** Sum of equipped armor's `def` field; 0 in M1 (no armor items yet). */
  armorDef: number;
}

/** A basic weapon attack: ATK from STR + weapon, no skill multiplier (M1 has
 * no skills yet - every job's skill tree arrives in M2+). */
export function characterAttackerInput(c: CharacterCombatProfile): AttackerCombatInput {
  return {
    atk: meleeAtk(c.weaponAtk, c.stats.STR, c.baseLevel),
    skillMultiplier: 1,
    critChance: critChance(c.stats.LUK),
    hit: hit(c.baseLevel, c.stats.DEX),
  };
}

export function characterDefenderInput(c: CharacterCombatProfile): DefenderCombatInput {
  return {
    def: physicalDef(c.armorDef, c.stats.VIT),
    flee: flee(c.baseLevel, c.stats.AGI),
    perfectDodgeChance: perfectDodgeChance(c.stats.LUK),
  };
}

export function characterAttackIntervalMs(c: CharacterCombatProfile): number {
  return weaponAttackIntervalMs(c.weaponBaseAttackIntervalMs, c.stats.AGI);
}

/** Monsters carry flat, already-final combat numbers in their MonsterDef
 * (config/monsters.ts) rather than derived stats - there's no monster-side
 * STR/AGI/etc. in SPEC.md, just tuned atk/def/flee/hit/critChance per
 * monster. Perfect dodge is a player-only LUK mechanic (SPEC.md section 9
 * lists it under player attributes only), so monsters never perfect-dodge. */
export function monsterAttackerInput(m: MonsterDef): AttackerCombatInput {
  return { atk: m.atk, skillMultiplier: 1, critChance: m.critChance, hit: m.hit };
}

export function monsterDefenderInput(m: MonsterDef): DefenderCombatInput {
  return { def: m.def, flee: m.flee, perfectDodgeChance: 0 };
}

export interface AttackResult {
  outcome: AttackOutcome;
  /** Defender's HP after this attack, clamped to >= 0. */
  newHp: number;
  died: boolean;
}

/** Resolves one attack and applies its damage to the defender's current HP.
 * A miss/perfectDodge leaves HP untouched. */
export function performAttack(
  attacker: AttackerCombatInput,
  defender: DefenderCombatInput,
  defenderCurrentHp: number,
  roll01: () => number = Math.random
): AttackResult {
  const outcome = resolveAttack(attacker, defender, roll01);
  if (outcome.kind !== 'hit') {
    return { outcome, newHp: defenderCurrentHp, died: false };
  }
  const newHp = Math.max(0, defenderCurrentHp - outcome.damage);
  return { outcome, newHp, died: newHp <= 0 };
}

/** Maps the 3-case AttackOutcome onto the 4-case `combat:result` wire enum
 * (shared/schemas.ts CombatResultSchema), where a crit is its own value
 * rather than a `hit` with a flag, since that's what the client's damage
 * floater styling keys on. */
export function toWireOutcome(outcome: AttackOutcome): 'perfectDodge' | 'miss' | 'hit' | 'crit' {
  if (outcome.kind === 'hit') return outcome.crit ? 'crit' : 'hit';
  return outcome.kind;
}

/** True while a character/monster is "in combat" (SPEC.md section 7: 6s
 * after dealing or taking damage - blocks mounting and Waystone travel,
 * triples HP regen interval when false). `lastCombatActionAt` is a plain
 * epoch-ms timestamp, or null if nothing has happened yet this session. */
export function isInCombat(lastCombatActionAt: number | null, nowMs: number): boolean {
  return lastCombatActionAt !== null && nowMs - lastCombatActionAt < BALANCE.combatStateDurationMs;
}

/** Rolls each of a monster's drop entries independently (SPEC.md doesn't
 * say drops are mutually exclusive, and config/monsters.ts's slime has two
 * low, unrelated chances, so independent rolls are the natural reading). */
export function rollLoot(
  drops: readonly DropEntry[],
  roll01: () => number = Math.random
): Array<{ itemId: string; qty: number }> {
  const results: Array<{ itemId: string; qty: number }> = [];
  for (const drop of drops) {
    if (roll01() >= drop.chance) continue;
    const span = drop.maxQty - drop.minQty;
    const qty = span <= 0 ? drop.minQty : drop.minQty + Math.floor(roll01() * (span + 1));
    results.push({ itemId: drop.itemId, qty });
  }
  return results;
}

export function rollGold(monster: MonsterDef, roll01: () => number = Math.random): number {
  const span = monster.baseGoldMax - monster.baseGoldMin;
  if (span <= 0) return monster.baseGoldMin;
  return monster.baseGoldMin + Math.floor(roll01() * (span + 1));
}

/** Monster barks (config/monsters.ts aggroBarks) picked on first aggro, per
 * SPEC.md M1 acceptance criteria ("monster barks in chat"). */
export function pickBark(monster: MonsterDef, roll01: () => number = Math.random): string | null {
  if (monster.aggroBarks.length === 0) return null;
  const idx = Math.floor(roll01() * monster.aggroBarks.length);
  return monster.aggroBarks[Math.min(idx, monster.aggroBarks.length - 1)]!;
}
