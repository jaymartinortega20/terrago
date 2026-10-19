import { applyXp, xpToNext, type XpCurve } from './progression';

/** Profession skills. Each levels independently from 1 to 100. */
export const SKILL_IDS = [
  'farming',
  'mining',
  'woodcutting',
  'fishing',
  'gathering',
  'cooking',
  'smithing',
  'alchemy',
  'crafting',
  'trading',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export const SKILL_NAMES: Record<SkillId, string> = {
  farming: 'Farming',
  mining: 'Mining',
  woodcutting: 'Woodcutting',
  fishing: 'Fishing',
  gathering: 'Gathering',
  cooking: 'Cooking',
  smithing: 'Smithing',
  alchemy: 'Alchemy',
  crafting: 'Crafting',
  trading: 'Trading',
};

export interface SkillProgress {
  level: number;
  xp: number;
  /** XP needed for the next level (0 at max). */
  next: number;
}

export type SkillSet = Record<SkillId, SkillProgress>;

export function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && (SKILL_IDS as readonly string[]).includes(v);
}

export function emptySkills(curve: XpCurve): SkillSet {
  const out = {} as SkillSet;
  for (const id of SKILL_IDS) out[id] = { level: 1, xp: 0, next: xpToNext(1, curve) };
  return out;
}

export function addSkillXp(p: { level: number; xp: number }, gained: number, curve: XpCurve): SkillProgress & { levelsGained: number } {
  const r = applyXp(p.level, p.xp, gained, curve);
  return { level: r.level, xp: r.xp, next: xpToNext(r.level, curve), levelsGained: r.levelsGained };
}
