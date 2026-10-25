import { setBonuses, type AffixStat } from './affixes';
import type { BaseStats, ClassId, DerivedStats, InventorySlot } from './types';

/**
 * Combat rules shared by client (tooltips, predictions) and server (authority).
 * The server is the only one that ever applies damage.
 */

export const EQUIP_SLOTS = ['mainhand', 'offhand', 'head', 'chest', 'gloves', 'boots', 'ring', 'necklace', 'cape'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];
export const EQUIP_SLOT_INDEX: Record<EquipSlot, number> = Object.fromEntries(EQUIP_SLOTS.map((s, i) => [s, i])) as Record<EquipSlot, number>;

export type WeaponType = 'sword' | 'axe' | 'spear' | 'bow' | 'staff' | 'wand' | 'dagger' | 'mace' | 'shield';

export interface EquipStats {
  atk?: number;
  matk?: number;
  def?: number;
  mdef?: number;
  hp?: number;
  mp?: number;
  str?: number;
  agi?: number;
  int?: number;
  vit?: number;
  luk?: number;
  crit?: number;
}

export interface EquipDef {
  slot: EquipSlot;
  weapon?: WeaponType;
  stats: EquipStats;
  /** Weapons: attack interval and reach in tiles. */
  speedMs?: number;
  range?: number;
  /** Weapons that deal magic damage (staffs, wands). */
  magic?: boolean;
  /** Restrict to classes (weapons). */
  classes?: ClassId[];
}

/** Each enhancement level adds this fraction to an item's stats. */
export const ENHANCE_STEP = 0.08;
export const MAX_ENHANCE = 10;

/** Chance to succeed going from +n to +n+1. */
export function enhanceChance(n: number): number {
  return [1, 0.95, 0.9, 0.8, 0.7, 0.55, 0.45, 0.35, 0.25, 0.15][n] ?? 0;
}

/** Above this level a failure drops the item one level (never destroys it). */
export const ENHANCE_SAFE_LEVEL = 6;

/** Upgrade gems by tier: Ruby for +1..+3, Sapphire for +4..+6, Diamond for +7..+10. */
export type UpgradeGem = 'ruby' | 'sapphire' | 'diamond';

/** Cost to go from +n to +n+1: Gold plus gems (stones = gems, for older callers). */
export function enhanceCost(n: number, vendorValue: number): { gold: number; gem: UpgradeGem; gems: number; stones: number } {
  const gem: UpgradeGem = n < 3 ? 'ruby' : n < 6 ? 'sapphire' : 'diamond';
  const gems = [1, 1, 2, 1, 2, 2, 1, 2, 2, 3][n] ?? 3;
  return { gold: Math.round((50 + vendorValue * 0.5) * (n + 1) ** 1.6), gem, gems, stones: gems };
}

/** How brightly upgraded gear glows: 0 none, 1 faint blue (+4), 2 purple (+7), 3 white-gold radiance (+10). */
export function glowTier(enhance: number | undefined | null): 0 | 1 | 2 | 3 {
  const e = enhance ?? 0;
  return e >= 10 ? 3 : e >= 7 ? 2 : e >= 4 ? 1 : 0;
}

export interface ClassGrowth {
  growth: BaseStats;
}

export function statsAtLevel(base: BaseStats, growth: BaseStats, level: number): BaseStats {
  const l = level - 1;
  return {
    strength: Math.floor(base.strength + growth.strength * l),
    agility: Math.floor(base.agility + growth.agility * l),
    intelligence: Math.floor(base.intelligence + growth.intelligence * l),
    vitality: Math.floor(base.vitality + growth.vitality * l),
    luck: Math.floor(base.luck + growth.luck * l),
  };
}

export interface WeaponProfile {
  type: WeaponType | 'fists';
  speedMs: number;
  range: number;
  magic: boolean;
}

export interface CombatProfile {
  stats: BaseStats;
  derived: DerivedStats;
  maxHp: number;
  maxMp: number;
  weapon: WeaponProfile;
  /** Percent of damage dealt that heals you (gear affixes, sets). */
  lifesteal: number;
}

const FISTS: WeaponProfile = { type: 'fists', speedMs: 900, range: 1.4, magic: false };

/**
 * Everything combat needs about a character: stats at level, equipment
 * bonuses (scaled by enhancement; broken items give nothing), derived values.
 */
export function combatProfile(
  level: number,
  base: BaseStats,
  growth: BaseStats,
  hp: { base: number; perLevel: number; mpBase: number; mpPerLevel: number },
  equipment: InventorySlot[],
  equipDef: (itemId: string) => EquipDef | undefined,
  opts: { passive?: import('./types').JobPassive; resource?: import('./types').ResourceKind } = {},
): CombatProfile {
  const jp = opts.passive ?? {};
  const pct = (v?: number) => 1 + (v ?? 0) / 100;
  const s = statsAtLevel(base, growth, level);
  const bonus: Record<AffixStat, number> = { atk: 0, matk: 0, def: 0, mdef: 0, hp: 0, mp: 0, str: 0, agi: 0, int: 0, vit: 0, luk: 0, crit: 0, aspd: 0, lifesteal: 0, move: 0 };
  let weapon = FISTS;
  const worn: string[] = [];
  for (const e of equipment) {
    const d = equipDef(e.itemId);
    if (!d || (e.durability !== null && e.durability <= 0)) continue;
    worn.push(e.itemId);
    const mult = 1 + (e.enhance ?? 0) * ENHANCE_STEP;
    for (const [k, v] of Object.entries(d.stats) as [keyof EquipStats, number][]) bonus[k] += Math.round(v * mult);
    for (const a of e.affixes ?? []) if (a.stat in bonus) bonus[a.stat as AffixStat] += a.value;
    if (d.slot === 'mainhand' && d.weapon) weapon = { type: d.weapon, speedMs: d.speedMs ?? 1000, range: d.range ?? 1.5, magic: !!d.magic };
  }
  for (const [k, v] of Object.entries(setBonuses(worn)) as [AffixStat, number][]) bonus[k] += v;
  const st: BaseStats = {
    strength: s.strength + bonus.str,
    agility: s.agility + bonus.agi,
    intelligence: s.intelligence + bonus.int,
    vitality: s.vitality + bonus.vit,
    luck: s.luck + bonus.luk,
  };
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const derived: DerivedStats = {
    physicalAttack: Math.round((st.strength * 2 + level + bonus.atk) * pct(jp.atkPct)),
    magicAttack: Math.round((st.intelligence * 2 + level + bonus.matk) * pct(jp.matkPct)),
    physicalDefense: Math.round((st.vitality + Math.floor(st.strength / 2) + bonus.def) * pct(jp.defPct)),
    magicDefense: Math.floor((st.intelligence + st.vitality) / 2) + bonus.mdef,
    accuracy: 80 + st.agility + Math.floor(st.luck / 2),
    evasion: st.agility + Math.floor(st.luck / 3),
    criticalChance: round1(1 + st.luck * 0.3 + st.agility * 0.05 + bonus.crit + (jp.critAdd ?? 0)),
    criticalDamage: 150 + Math.floor(st.luck / 2),
    movementSpeed: 100 + Math.min(15, bonus.move),
    attackSpeed: 100 + Math.floor(st.agility / 2) + Math.min(30, bonus.aspd),
    gatheringEfficiency: 100 + Math.floor((st.strength + st.agility) / 4),
  };
  return {
    stats: st,
    derived,
    maxHp: Math.round((hp.base + hp.perLevel * (level - 1) + st.vitality * 5 + bonus.hp) * pct(jp.hpPct)),
    // Rage and Energy are always out of 100; Mana grows with level and INT.
    maxMp: opts.resource && opts.resource !== 'mana' ? 100 : Math.round((hp.mpBase + hp.mpPerLevel * (level - 1) + st.intelligence * 3 + bonus.mp) * pct(jp.mpPct)),
    weapon: { ...weapon, speedMs: Math.max(350, Math.round(weapon.speedMs * (100 / derived.attackSpeed))) },
    lifesteal: Math.min(10, bonus.lifesteal),
  };
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

export interface MonsterDef {
  id: string;
  name: string;
  hpMult: number;
  atkMult: number;
  defMult: number;
  /** Walking speed (px/s). */
  speed: number;
  /** Tiles. 0 = passive (only fights back). */
  aggro: number;
  /** Attack reach in tiles. */
  range: number;
  cooldownMs: number;
  magic?: boolean;
  xpMult: number;
  gold: [number, number];
  drops: { itemId: string; chance: number; min: number; max: number }[];
  art: { shape: string; color: string; size: number };
  respawnMs: number;
  boss?: boolean;
  /** Boss mechanics. */
  abilities?: BossAbility[];
  /**
   * How it fights: healer (mends nearby monsters), summoner (calls `summon`
   * minions), exploder (runs in and blows up), charger (dashes at you).
   */
  behavior?: 'healer' | 'summoner' | 'exploder' | 'charger';
  summon?: string;
}

/**
 * Boss abilities. slam: telegraphed circle on the current target's spot;
 * nova: circle around the boss; summon: adds at HP thresholds; enrage: damage
 * buff at a threshold.
 */
export interface BossAbility {
  id: string;
  name: string;
  kind: 'slam' | 'nova' | 'summon' | 'enrage' | 'harden';
  everyMs?: number;
  windupMs?: number;
  /** Tiles. */
  radius?: number;
  dmgMult?: number;
  /** HP fractions that trigger the ability once each. */
  atHp?: number[];
  monster?: string;
  count?: number;
  level?: number;
  /** Enrage damage multiplier. */
  dmg?: number;
  /** Harden: damage taken multiplier and how long it lasts; only below this HP fraction. */
  taken?: number;
  durationMs?: number;
  belowHp?: number;
}

/** Dungeon difficulty modes: stronger monsters, extra loot rolls. */
export const DIFFICULTIES = [
  { id: 'normal', name: 'Normal', levels: 0, hp: 1, atk: 1, lootRolls: 1, minLevel: 0 },
  { id: 'hard', name: 'Hard', levels: 8, hp: 1.6, atk: 1.25, lootRolls: 2, minLevel: 0 },
  { id: 'nightmare', name: 'Nightmare', levels: 18, hp: 2.6, atk: 1.6, lootRolls: 3, minLevel: 30 },
  { id: 'mythic', name: 'Mythic', levels: 30, hp: 4, atk: 2, lootRolls: 4, minLevel: 50 },
] as const;
export type DifficultyId = (typeof DIFFICULTIES)[number]['id'];

export function difficultyOf(ownerId: string | undefined | null) {
  const id = ownerId?.split('~')[1];
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[0];
}

export interface MonsterStats {
  maxHp: number;
  atk: number;
  def: number;
  accuracy: number;
  evasion: number;
  xp: number;
}

export function monsterStats(m: MonsterDef, level: number): MonsterStats {
  return {
    maxHp: Math.round((30 + level * 20 + level * level * 0.6) * m.hpMult),
    atk: Math.round((6 + level * 3) * m.atkMult),
    def: Math.round((2 + level * 1.8) * m.defMult),
    accuracy: Math.round(80 + level * 1.5),
    evasion: Math.round(level * 1.2),
    xp: Math.round((8 + level * 6) * m.xpMult),
  };
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

export interface Attacker {
  level: number;
  atk: number;
  accuracy: number;
  critChance: number;
  critDamage: number;
}

export interface Defender {
  level: number;
  def: number;
  evasion: number;
}

export interface HitResult {
  miss: boolean;
  crit: boolean;
  damage: number;
}

/**
 * Level differences matter a lot: each level the target is above you cuts
 * your hit chance and damage; +10 levels is very hard, +15 nearly hopeless.
 */
export function rollHit(a: Attacker, d: Defender, mult: number, rand: () => number): HitResult {
  const dl = d.level - a.level;
  const hit = Math.max(0.15, Math.min(0.99, 0.93 + (a.accuracy - d.evasion) / 300 - 0.035 * Math.max(0, dl)));
  if (rand() >= hit) return { miss: true, crit: false, damage: 0 };
  const atk = Math.max(1, a.atk * mult);
  const raw = atk * (atk / (atk + Math.max(0, d.def)));
  const lf = dl > 0 ? Math.max(0.12, 1 - 0.065 * dl) : Math.min(1.5, 1 + 0.025 * -dl);
  let damage = raw * lf * (0.9 + rand() * 0.2);
  const crit = rand() * 100 < a.critChance;
  if (crit) damage *= a.critDamage / 100;
  return { miss: false, crit, damage: Math.max(1, Math.round(damage)) };
}

// ---------------------------------------------------------------------------
// Skills and effects
// ---------------------------------------------------------------------------

export interface EffectMods {
  /** Multiplier on damage dealt. */
  dmg?: number;
  /** Multiplier on damage taken. */
  taken?: number;
  /** Multiplier on evasion. */
  eva?: number;
  /** Movement speed multiplier (monsters). */
  slow?: number;
  /** Damage (or healing, negative) every second. */
  dot?: number;
  /** Absorbs this much damage. */
  shield?: number;
  /** HP regen per second. */
  regen?: number;
  /** Multiplier on the victim's accuracy (Blind Blitz). */
  acc?: number;
  /** Extra critical chance (percent points) for attacks against this target (Hunter's Eye). */
  critTaken?: number;
}

export interface SkillDef {
  id: string;
  classId: ClassId;
  name: string;
  description: string;
  level: number;
  mp: number;
  cooldownMs: number;
  /** attack: single target; aoe: around the caster (or target); buff: self/party; heal: self or ally; debuff: target. */
  kind: 'attack' | 'aoe' | 'buff' | 'heal' | 'debuff';
  mult: number;
  magic: boolean;
  /** Tiles. */
  range: number;
  radius?: number;
  maxTargets?: number;
  effect?: { id: string; name: string; durationMs: number; mods: EffectMods; scale?: 'int' | 'str' };
  icon: string;
  /** Only for this second job. */
  job?: import('./types').JobId;
}

export interface ActiveEffect {
  id: string;
  name: string;
  until: number;
  mods: EffectMods;
  /** Who applied it (DoT credit). */
  source?: string;
  nextTick?: number;
}

/** Sum of an additive effect (e.g. critTaken) over active effects. */
export function effectSum(effects: ActiveEffect[], key: 'critTaken', now: number): number {
  let s = 0;
  for (const e of effects) if (e.until > now && e.mods[key] !== undefined) s += e.mods[key]!;
  return s;
}

export function effectMult(effects: ActiveEffect[], key: 'dmg' | 'taken' | 'eva' | 'slow' | 'acc', now: number): number {
  let m = 1;
  for (const e of effects) if (e.until > now && e.mods[key] !== undefined) m *= e.mods[key]!;
  return m;
}

/** Death penalty debuff. */
export const WEAKNESS: Omit<ActiveEffect, 'until'> = { id: 'weakness', name: 'Weakness', mods: { dmg: 0.75, taken: 1.15 } };
export const WEAKNESS_MS = 120_000;
/** Out of combat this long before HP/MP regenerate quickly. */
export const OUT_OF_COMBAT_MS = 6_000;
