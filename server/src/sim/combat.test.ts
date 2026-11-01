import { describe, expect, it } from 'vitest';
import { BALANCE, MONSTERS, type Stats } from '@terago/shared';
import {
  characterAttackIntervalMs,
  characterAttackerInput,
  characterDefenderInput,
  isInCombat,
  monsterAttackerInput,
  monsterDefenderInput,
  performAttack,
  pickBark,
  rollGold,
  rollLoot,
  toWireOutcome,
  type CharacterCombatProfile,
} from './combat.js';

const BASE_STATS: Stats = { STR: 1, AGI: 1, VIT: 1, INT: 1, DEX: 1, LUK: 1 };
const SLIME = MONSTERS.slime!;

function profile(overrides: Partial<CharacterCombatProfile> = {}): CharacterCombatProfile {
  return {
    baseLevel: 1,
    stats: BASE_STATS,
    weaponAtk: 8,
    weaponBaseAttackIntervalMs: 900,
    armorDef: 0,
    ...overrides,
  };
}

describe('characterAttackerInput / characterDefenderInput', () => {
  it('derives ATK/crit/hit from STR/LUK/DEX and base level, matching the raw formulas', () => {
    const p = profile({ stats: { ...BASE_STATS, STR: 10, LUK: 5, DEX: 20 }, baseLevel: 3 });
    const attacker = characterAttackerInput(p);
    // meleeAtk = weaponAtk + STR*2 + floor(level/4) = 8 + 20 + floor(0.75) = 28
    expect(attacker.atk).toBe(8 + 10 * 2 + Math.floor(3 / 4));
    expect(attacker.critChance).toBeCloseTo(1 + 5 * 0.3, 5);
    expect(attacker.hit).toBe(3 + 20);
    expect(attacker.skillMultiplier).toBe(1);
  });

  it('derives DEF/flee/perfectDodge from VIT/AGI/LUK', () => {
    const p = profile({ stats: { ...BASE_STATS, VIT: 10, AGI: 15, LUK: 4 }, baseLevel: 5, armorDef: 2 });
    const defender = characterDefenderInput(p);
    expect(defender.def).toBeCloseTo(2 + 10 / 2, 5);
    expect(defender.flee).toBe(5 + 15);
    expect(defender.perfectDodgeChance).toBeCloseTo(1 + 4 * 0.1, 5);
  });
});

describe('characterAttackIntervalMs', () => {
  it('speeds up with AGI, floored at the minimum interval', () => {
    const slow = characterAttackIntervalMs(profile({ stats: { ...BASE_STATS, AGI: 1 } }));
    const fast = characterAttackIntervalMs(profile({ stats: { ...BASE_STATS, AGI: 200 } }));
    expect(slow).toBeLessThan(900);
    expect(fast).toBe(BALANCE.minAttackIntervalMs);
  });
});

describe('monsterAttackerInput / monsterDefenderInput', () => {
  it('passes the monster def\'s flat combat numbers through unchanged', () => {
    const attacker = monsterAttackerInput(SLIME);
    expect(attacker).toEqual({ atk: SLIME.atk, skillMultiplier: 1, critChance: SLIME.critChance, hit: SLIME.hit });
    const defender = monsterDefenderInput(SLIME);
    expect(defender).toEqual({ def: SLIME.def, flee: SLIME.flee, perfectDodgeChance: 0 });
  });
});

describe('performAttack', () => {
  const attacker = characterAttackerInput(profile());
  const defender = monsterDefenderInput(SLIME);
  // With the default profile vs. the Slime: attacker.hit = 1+1 = 2,
  // defender.flee = 5, so hitChancePct = clamp(80+2-5, 5, 95) = 77, and
  // attacker.critChance = 1 + 1*0.3 = 1.3. A constant roll of 0.5 clears
  // the dodge check (defender's perfectDodgeChance is 0) and the crit
  // check (50 >= 1.3) and the hit check (50 < 77, so NOT a miss), landing
  // on a guaranteed plain hit with full-midpoint damage variance.

  it('applies damage and reports death when HP drops to 0', () => {
    const result = performAttack(attacker, defender, 1, () => 0.5);
    expect(result.outcome.kind).toBe('hit');
    expect(result.newHp).toBe(0);
    expect(result.died).toBe(true);
  });

  it('never reports negative HP even if damage exceeds remaining HP', () => {
    const result = performAttack(attacker, defender, 3, () => 0.5);
    expect(result.newHp).toBeGreaterThanOrEqual(0);
  });

  it('leaves HP untouched on a miss', () => {
    // A roll of 0.9 still clears dodge (chance 0) and crit (1.3), but
    // 90 >= hitChancePct (77) triggers the miss branch.
    const result = performAttack(attacker, defender, 45, () => 0.9);
    expect(result.outcome.kind).toBe('miss');
    expect(result.newHp).toBe(45);
    expect(result.died).toBe(false);
  });

  it('leaves HP untouched on a perfect dodge', () => {
    // Use a character defender with LUK high enough for a non-zero
    // perfectDodgeChance (monsters never have one - see monsterDefenderInput),
    // so a roll of 0 (0 < any positive chance) guarantees the dodge branch.
    const luckyDefender = characterDefenderInput(profile({ stats: { ...BASE_STATS, LUK: 10 } }));
    const result = performAttack(monsterAttackerInput(SLIME), luckyDefender, 45, () => 0);
    expect(result.outcome.kind).toBe('perfectDodge');
    expect(result.newHp).toBe(45);
  });
});

describe('toWireOutcome', () => {
  it('maps every AttackOutcome kind to the combat:result wire enum', () => {
    expect(toWireOutcome({ kind: 'perfectDodge' })).toBe('perfectDodge');
    expect(toWireOutcome({ kind: 'miss' })).toBe('miss');
    expect(toWireOutcome({ kind: 'hit', crit: false, damage: 5 })).toBe('hit');
    expect(toWireOutcome({ kind: 'hit', crit: true, damage: 5 })).toBe('crit');
  });
});

describe('isInCombat', () => {
  it('is false when nothing has happened yet', () => {
    expect(isInCombat(null, 10_000)).toBe(false);
  });

  it('is true within the combat-state window and false after it elapses', () => {
    const last = 10_000;
    expect(isInCombat(last, last + BALANCE.combatStateDurationMs - 1)).toBe(true);
    expect(isInCombat(last, last + BALANCE.combatStateDurationMs)).toBe(false);
  });
});

describe('rollLoot', () => {
  it('includes a drop whose roll beats its chance and rolls qty within [min,max]', () => {
    const drops = rollLoot(SLIME.drops, () => 0); // 0 < any positive chance -> every entry included, qty rolls to its min
    expect(drops).toHaveLength(SLIME.drops.length);
    for (const [i, d] of drops.entries()) {
      expect(d.itemId).toBe(SLIME.drops[i]!.itemId);
      expect(d.qty).toBe(SLIME.drops[i]!.minQty);
    }
  });

  it('excludes a drop whose roll fails its chance', () => {
    const drops = rollLoot(SLIME.drops, () => 0.999999); // never beats any chance < 1
    expect(drops).toHaveLength(0);
  });

  it('rolls qty up to maxQty when the second roll is high', () => {
    const drops = rollLoot(
      [{ itemId: 'slime_gel', chance: 1, minQty: 1, maxQty: 2 }],
      () => 0.999999 // beats chance=1? no: 0.999999 < 1 is true, so included; second call also 0.999999 -> floor(0.999999*2)=1 -> qty=1+1=2
    );
    expect(drops).toEqual([{ itemId: 'slime_gel', qty: 2 }]);
  });
});

describe('rollGold', () => {
  it('stays within [baseGoldMin, baseGoldMax]', () => {
    for (const roll of [0, 0.5, 0.999999]) {
      const gold = rollGold(SLIME, () => roll);
      expect(gold).toBeGreaterThanOrEqual(SLIME.baseGoldMin);
      expect(gold).toBeLessThanOrEqual(SLIME.baseGoldMax);
    }
  });
});

describe('pickBark', () => {
  it('returns one of the monster\'s configured barks', () => {
    const bark = pickBark(SLIME, () => 0);
    expect(SLIME.aggroBarks).toContain(bark);
  });

  it('returns null for a monster with no barks', () => {
    expect(pickBark({ ...SLIME, aggroBarks: [] })).toBeNull();
  });
});
