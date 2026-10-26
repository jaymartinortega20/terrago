import type { BaseStats, DerivedStats } from './types';

export interface XpCurve {
  baseXp: number;
  exponent: number;
  maxLevel: number;
}

/** XP needed to go from `level` to `level + 1`: BaseXP × Level^exponent. */
export function xpToNext(level: number, curve: XpCurve): number {
  if (level >= curve.maxLevel) return 0;
  return Math.round(curve.baseXp * Math.pow(level, curve.exponent));
}

/** Total XP accumulated from level 1 to reach `level`. */
export function totalXpToReach(level: number, curve: XpCurve): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, curve.maxLevel); l++) total += xpToNext(l, curve);
  return total;
}

/** Add XP, rolling over levels. XP at max level is discarded. */
export function applyXp(level: number, xp: number, gained: number, curve: XpCurve): { level: number; xp: number; levelsGained: number } {
  let l = level;
  let x = xp + Math.max(0, Math.floor(gained));
  let levelsGained = 0;
  while (l < curve.maxLevel) {
    const need = xpToNext(l, curve);
    if (x < need) break;
    x -= need;
    l++;
    levelsGained++;
  }
  if (l >= curve.maxLevel) x = 0;
  return { level: l, xp: x, levelsGained };
}

export interface ClassProfile {
  baseStats: BaseStats;
  hpBase: number;
  hpPerLevel: number;
  mpBase: number;
  mpPerLevel: number;
}

export function maxHp(level: number, s: BaseStats, c: ClassProfile): number {
  return c.hpBase + c.hpPerLevel * (level - 1) + s.vitality * 5;
}

export function maxMp(level: number, s: BaseStats, c: ClassProfile): number {
  return c.mpBase + c.mpPerLevel * (level - 1) + s.intelligence * 3;
}

/** Deliberately simple for the MVP; combat (v0.5) will refine these. */
export function derivedStats(level: number, s: BaseStats): DerivedStats {
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    physicalAttack: s.strength * 2 + level,
    magicAttack: s.intelligence * 2 + level,
    physicalDefense: s.vitality + Math.floor(s.strength / 2),
    magicDefense: Math.floor((s.intelligence + s.vitality) / 2),
    accuracy: 80 + s.agility + Math.floor(s.luck / 2),
    evasion: s.agility + Math.floor(s.luck / 3),
    criticalChance: round1(1 + s.luck * 0.3 + s.agility * 0.05),
    criticalDamage: 150 + Math.floor(s.luck / 2),
    movementSpeed: 100,
    attackSpeed: 100 + Math.floor(s.agility / 2),
    gatheringEfficiency: 100 + Math.floor((s.strength + s.agility) / 4),
  };
}

export interface EnergyConfig {
  max: number;
  /** Milliseconds to regenerate one point of Energy. */
  regenIntervalMs: number;
}

/**
 * Energy regenerates from timestamps, never from running timers, so it is
 * correct after logouts and server restarts. Returns the settled value and
 * the timestamp to store, preserving partial progress toward the next point.
 */
export function settleEnergy(stored: number, updatedAtMs: number, nowMs: number, cfg: EnergyConfig): { energy: number; updatedAtMs: number } {
  if (stored >= cfg.max) return { energy: cfg.max, updatedAtMs: nowMs };
  const elapsed = Math.max(0, nowMs - updatedAtMs);
  const points = Math.floor(elapsed / cfg.regenIntervalMs);
  const energy = Math.min(cfg.max, stored + points);
  if (energy >= cfg.max) return { energy, updatedAtMs: nowMs };
  return { energy, updatedAtMs: updatedAtMs + points * cfg.regenIntervalMs };
}

/** Newcomers (under level 15) regain Energy twice as fast, so the first farm days don't stall. */
export const FAST_ENERGY_BELOW = 15;
export function energyFor<T extends EnergyConfig>(cfg: T, level: number): T {
  return level < FAST_ENERGY_BELOW ? { ...cfg, regenIntervalMs: Math.round(cfg.regenIntervalMs / 2) } : cfg;
}
