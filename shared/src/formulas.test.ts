import { describe, expect, it } from 'vitest';
import {
  applyExp,
  attackIntervalMs,
  castAnimationSpeedMultiplier,
  castTimeMs,
  clamp,
  critChance,
  expToNextLevel,
  flee,
  hit,
  isFastCast,
  magicDef,
  matk,
  maxHp,
  maxMana,
  meleeAtk,
  perfectDodgeChance,
  physicalDef,
  rangedAtk,
  resolveAttack,
  totalStatPoints,
  weightLimit,
} from './formulas.js';
import { BALANCE } from './config/balance.js';

describe('clamp', () => {
  it('clamps within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe('attribute formulas (SPEC.md section 9)', () => {
  it('meleeAtk = weaponAtk + STR*2 + BaseLv/4', () => {
    expect(meleeAtk(10, 20, 40)).toBe(10 + 40 + 10);
  });

  it('rangedAtk = weaponAtk + DEX*2 + BaseLv/4', () => {
    expect(rangedAtk(5, 15, 20)).toBe(5 + 30 + 5);
  });

  it('matk = weaponMatk + INT*2 + (INT/7)^2', () => {
    expect(matk(8, 14)).toBeCloseTo(8 + 28 + Math.pow(14 / 7, 2));
  });

  it('weightLimit = 2000 + STR*30', () => {
    expect(weightLimit(10)).toBe(2300);
  });

  it('attackIntervalMs scales down with AGI and floors at 300ms', () => {
    expect(attackIntervalMs(1000, 0)).toBe(1000);
    expect(attackIntervalMs(1000, 50)).toBeCloseTo(1000 * (1 - 50 * 0.004));
    expect(attackIntervalMs(1000, 1000)).toBe(300); // would go negative without the floor
  });

  it('maxHp applies the VIT% bonus and class modifier', () => {
    const base = (80 + 10 * 12) * (1 + 20 * 0.01);
    expect(maxHp(10, 20, 1)).toBe(Math.round(base));
    expect(maxHp(10, 20, 1.3)).toBe(Math.round(base * 1.3));
  });

  it('physicalDef = armorDef + floor(VIT/2)', () => {
    expect(physicalDef(5, 11)).toBe(5 + 5);
  });

  it('magicDef = armorMdef + floor(INT/2)', () => {
    expect(magicDef(5, 11)).toBe(5 + 5);
  });

  it('critChance = 1 + LUK*0.3, clamped to 100', () => {
    expect(critChance(10)).toBeCloseTo(4);
    expect(critChance(1000)).toBe(100);
  });

  it('perfectDodgeChance = 1 + LUK*0.1', () => {
    expect(perfectDodgeChance(10)).toBeCloseTo(2);
  });

  it('flee = BaseLv + AGI, hit = BaseLv + DEX', () => {
    expect(flee(10, 15)).toBe(25);
    expect(hit(10, 20)).toBe(30);
  });

  it('maxMana = (40 + BaseLv*4) * (1 + INT*0.01)', () => {
    expect(maxMana(10, 20)).toBe(Math.round((40 + 40) * 1.2));
  });
});

describe('fast casting (SPEC.md section 9)', () => {
  it('0 DEX: full base cast time', () => {
    expect(castTimeMs(1000, 0)).toBeCloseTo(1000);
  });

  it('100 DEX: only the fixed 20% remains', () => {
    expect(castTimeMs(1000, 100)).toBeCloseTo(200);
  });

  it('50 DEX: variable part cut by exactly half', () => {
    // fixed 20% (200) + half of the variable 80% (400) = 600
    expect(castTimeMs(1000, 50)).toBeCloseTo(600);
  });

  it('isFastCast flips on at DEX 50, per spec', () => {
    expect(isFastCast(49)).toBe(false);
    expect(isFastCast(50)).toBe(true);
  });

  it('DEX is capped at 100 for casting purposes', () => {
    expect(castTimeMs(1000, 200)).toBeCloseTo(castTimeMs(1000, 100));
  });

  it('castAnimationSpeedMultiplier speeds up proportionally', () => {
    expect(castAnimationSpeedMultiplier(1000, 100)).toBeCloseTo(1000 / 200);
  });
});

describe('resolveAttack (SPEC.md section 9 order of operations)', () => {
  const attacker = { atk: 100, skillMultiplier: 1, critChance: 10, hit: 50 };
  const defender = { def: 0, flee: 0, perfectDodgeChance: 5 };

  it('perfect dodge takes priority over everything else', () => {
    const outcome = resolveAttack(attacker, defender, () => 0); // always "wins" every roll
    expect(outcome.kind).toBe('perfectDodge');
  });

  it('a crit always hits, even if the hit roll would have missed', () => {
    const rolls = [0.5, 0]; // fail dodge (0.5 > 0.05), then succeed crit (0 < critChance)
    let i = 0;
    const outcome = resolveAttack(attacker, { ...defender, flee: 10_000 }, () => rolls[i++] ?? 1);
    expect(outcome.kind).toBe('hit');
    if (outcome.kind === 'hit') {
      expect(outcome.crit).toBe(true);
      expect(outcome.damage).toBe(Math.round(100 * BALANCE.critDamageMultiplier));
    }
  });

  it('miss when the hit roll fails', () => {
    const rolls = [0.5, 0.5, 0.999]; // no dodge, no crit, hit roll fails
    let i = 0;
    const outcome = resolveAttack(attacker, defender, () => rolls[i++] ?? 1);
    expect(outcome.kind).toBe('miss');
  });

  it('a normal hit applies the DEF formula and damage variance window', () => {
    const rolls = [0.5, 0.5, 0.0, 0.5]; // no dodge, no crit, hit succeeds, variance = midpoint
    let i = 0;
    const outcome = resolveAttack({ ...attacker, hit: 1000 }, { ...defender, def: 100 }, () => rolls[i++] ?? 1);
    expect(outcome.kind).toBe('hit');
    if (outcome.kind === 'hit') {
      expect(outcome.crit).toBe(false);
      // variance midpoint = 1.0, DEF 100 halves the damage
      expect(outcome.damage).toBe(Math.round((100 * 1 * 1.0 * 100) / (100 + 100)));
    }
  });

  it('damage is never less than 1', () => {
    const rolls = [0.5, 0.5, 0.0, 0.5];
    let i = 0;
    const outcome = resolveAttack(
      { atk: 1, skillMultiplier: 1, critChance: 0, hit: 1000 },
      { def: 100_000, flee: 0, perfectDodgeChance: 0 },
      () => rolls[i++] ?? 1
    );
    expect(outcome.kind).toBe('hit');
    if (outcome.kind === 'hit') expect(outcome.damage).toBeGreaterThanOrEqual(1);
  });
});

describe('progression', () => {
  it('totalStatPoints: 10 at level 1, 505 by level 100', () => {
    expect(totalStatPoints(1)).toBe(10);
    expect(totalStatPoints(100)).toBe(10 + 99 * 5);
  });

  it('expToNextLevel reads the curve by level, clamped to its length', () => {
    const curve = [10, 20, 30];
    expect(expToNextLevel(1, curve)).toBe(10);
    expect(expToNextLevel(3, curve)).toBe(30);
    expect(expToNextLevel(99, curve)).toBe(30); // clamped, doesn't throw
  });

  it('applyExp advances exactly one level when exp crosses the threshold', () => {
    const curve = [100, 150, 200];
    const result = applyExp(1, 90, 20, curve, 10);
    expect(result.level).toBe(2);
    expect(result.exp).toBe(10);
    expect(result.levelsGained).toBe(1);
  });

  it('applyExp handles multiple level-ups from one large gain', () => {
    const curve = [10, 10, 10, 10];
    const result = applyExp(1, 0, 35, curve, 10);
    expect(result.level).toBe(4);
    expect(result.exp).toBe(5);
    expect(result.levelsGained).toBe(3);
  });

  it('applyExp clamps at maxLevel and drops overflow exp', () => {
    const curve = [10];
    const result = applyExp(1, 0, 10_000, curve, 2);
    expect(result.level).toBe(2);
    expect(result.exp).toBe(0);
  });
});
