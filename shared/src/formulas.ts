/**
 * Every stat and combat formula from SPEC.md section 9, as pure functions.
 * Nothing here reads config directly except through BALANCE, so balancing
 * is always a data change, never a logic change.
 */
import { BALANCE } from './config/balance.js';
import type { AttackerCombatInput, AttackOutcome, DefenderCombatInput } from './types.js';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------- attributes -> derived stats ----------------

/** Melee ATK = weapon ATK + STR * 2 + BaseLv / 4 */
export function meleeAtk(weaponAtk: number, str: number, baseLevel: number): number {
  return weaponAtk + str * 2 + Math.floor(baseLevel / 4);
}

/** Ranged ATK = weapon ATK + DEX * 2 + BaseLv / 4 */
export function rangedAtk(weaponAtk: number, dex: number, baseLevel: number): number {
  return weaponAtk + dex * 2 + Math.floor(baseLevel / 4);
}

/** MATK = weapon MATK + INT * 2 + (INT / 7)^2 */
export function matk(weaponMatk: number, int: number): number {
  return weaponMatk + int * 2 + Math.pow(int / 7, 2);
}

/** Weight limit = 2000 + STR * 30 */
export function weightLimit(str: number): number {
  return 2000 + str * 30;
}

/** Attack interval = weapon base interval * (1 - AGI * 0.004), minimum 300ms */
export function attackIntervalMs(weaponBaseIntervalMs: number, agi: number): number {
  return Math.max(BALANCE.minAttackIntervalMs, weaponBaseIntervalMs * (1 - agi * 0.004));
}

/** Max HP = (80 + BaseLv * 12) * (1 + VIT * 0.01) * classModifier */
export function maxHp(baseLevel: number, vit: number, classHpModifier: number): number {
  return Math.round((80 + baseLevel * 12) * (1 + vit * 0.01) * classHpModifier);
}

/** HP regen tick interval (seconds) = max(2, 8 - VIT * 0.06); tripled (i.e. 1/3 the time) out of combat */
export function hpRegenIntervalSeconds(vit: number, inCombat: boolean): number {
  const base = Math.max(2, 8 - vit * 0.06);
  return inCombat ? base : base / 3;
}

/** DEF = armor DEF + VIT / 2 */
export function physicalDef(armorDef: number, vit: number): number {
  return armorDef + Math.floor(vit / 2);
}

/** MDEF = armor MDEF + INT / 2 */
export function magicDef(armorMdef: number, int: number): number {
  return armorMdef + Math.floor(int / 2);
}

/** Crit% = 1 + LUK * 0.3 */
export function critChance(luk: number): number {
  return clamp(1 + luk * 0.3, 0, 100);
}

/** Perfect dodge% = 1 + LUK * 0.1 */
export function perfectDodgeChance(luk: number): number {
  return clamp(1 + luk * 0.1, 0, 100);
}

/** Item trait proc chance multiplier = 1 + LUK * 0.005 */
export function traitProcMultiplier(luk: number): number {
  return 1 + luk * 0.005;
}

/** FLEE = BaseLv + AGI */
export function flee(baseLevel: number, agi: number): number {
  return baseLevel + agi;
}

/** HIT = BaseLv + DEX */
export function hit(baseLevel: number, dex: number): number {
  return baseLevel + dex;
}

/** Max Mana = (40 + BaseLv * 4) * (1 + INT * 0.01) */
export function maxMana(baseLevel: number, int: number): number {
  return Math.round((40 + baseLevel * 4) * (1 + int * 0.01));
}

// ---------------- fast casting ----------------

/** cast time = base * (fixedPortion + variablePortion * (1 - min(DEX,100)/100)) */
export function castTimeMs(baseCastMs: number, dex: number): number {
  const d = clamp(dex, 0, 100);
  return baseCastMs * (BALANCE.castFixedPortion + BALANCE.castVariablePortion * (1 - d / 100));
}

/** True once the variable part is cut by >=50% (DEX >= 50) -> show the "FAST CAST!" floater. */
export function isFastCast(dex: number): boolean {
  return clamp(dex, 0, 100) >= BALANCE.fastCastDexThreshold;
}

/** How much to speed up the cast animation: base / actual cast time. */
export function castAnimationSpeedMultiplier(baseCastMs: number, dex: number): number {
  const actual = castTimeMs(baseCastMs, dex);
  return actual > 0 ? baseCastMs / actual : 1;
}

// ---------------- combat resolution ----------------

/**
 * Resolves one attack, in the exact order from SPEC.md section 9:
 *   1. Perfect dodge roll (defender's LUK) -> stop.
 *   2. Crit roll -> always hits, 1.4x damage.
 *   3. Otherwise a hit roll: clamp(80 + HIT - FLEE, 5, 95)%; miss on failure.
 *   4. Damage = ATK * skillMultiplier * random(0.95-1.05) * 100 / (100 + DEF), min 1.
 *
 * `roll01` is injected (returns 0..1) so this is deterministically testable;
 * defaults to Math.random for real play.
 */
export function resolveAttack(
  attacker: AttackerCombatInput,
  defender: DefenderCombatInput,
  roll01: () => number = Math.random
): AttackOutcome {
  if (roll01() * 100 < defender.perfectDodgeChance) {
    return { kind: 'perfectDodge' };
  }

  const isCrit = roll01() * 100 < attacker.critChance;
  if (isCrit) {
    const damage = Math.max(
      1,
      Math.round(attacker.atk * attacker.skillMultiplier * BALANCE.critDamageMultiplier)
    );
    return { kind: 'hit', crit: true, damage };
  }

  const hitChancePct = clamp(
    80 + attacker.hit - defender.flee,
    BALANCE.minHitChancePct,
    BALANCE.maxHitChancePct
  );
  if (roll01() * 100 >= hitChancePct) {
    return { kind: 'miss' };
  }

  const variance =
    BALANCE.damageVarianceMin + roll01() * (BALANCE.damageVarianceMax - BALANCE.damageVarianceMin);
  const damage = Math.max(
    1,
    Math.round((attacker.atk * attacker.skillMultiplier * variance * 100) / (100 + defender.def))
  );
  return { kind: 'hit', crit: false, damage };
}

// ---------------- progression ----------------

/** Total manually-allocatable stat points at a given Base Level (10 at creation + 5/level). */
export function totalStatPoints(baseLevel: number): number {
  return BALANCE.startingStatPoints + (baseLevel - 1) * BALANCE.statPointsPerLevel;
}

/** EXP required to go from `level` to `level + 1`, per the configured curve. */
export function expToNextLevel(level: number, curve: readonly number[]): number {
  const idx = clamp(level - 1, 0, curve.length - 1);
  return curve[idx]!;
}

/**
 * Applies gained EXP to a level/exp pair, handling multiple level-ups in a single call.
 * Clamps at maxLevel (exp is dropped once the cap is reached).
 */
export function applyExp(
  level: number,
  exp: number,
  gained: number,
  curve: readonly number[],
  maxLevel: number
): { level: number; exp: number; levelsGained: number } {
  let lvl = level;
  let xp = exp + gained;
  let levelsGained = 0;
  while (lvl < maxLevel) {
    const need = expToNextLevel(lvl, curve);
    if (xp < need) break;
    xp -= need;
    lvl += 1;
    levelsGained += 1;
  }
  if (lvl >= maxLevel) {
    xp = 0;
  }
  return { level: lvl, exp: xp, levelsGained };
}
