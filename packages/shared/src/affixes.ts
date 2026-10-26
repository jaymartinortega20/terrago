import type { ItemAffix, Rarity as ItemRarity } from './types';

/**
 * Random gear stats ("affixes") and armour set bonuses.
 *
 * Gear that drops from monsters can roll extra stats on top of its base ones.
 * Rarer drops roll more of them; Elite monsters roll one more. Values grow with
 * the item's level requirement so a level-70 drop is worth chasing.
 * Crafted, bought and quest items have no affixes (they're predictable).
 */

export type AffixStat =
  | 'atk'
  | 'matk'
  | 'def'
  | 'mdef'
  | 'hp'
  | 'mp'
  | 'str'
  | 'agi'
  | 'int'
  | 'vit'
  | 'luk'
  | 'crit'
  | 'aspd'
  | 'lifesteal'
  | 'move';

interface AffixSpec {
  label: string;
  /** Shown as "+4%" rather than "+4". */
  pct?: boolean;
  /** Value range at level 1 and how much each level adds (both ends). */
  min: number;
  max: number;
  perLevel: number;
  /** Hard cap (percent stats). */
  cap?: number;
  /** Which kinds of gear can roll it. */
  on: ('weapon' | 'armor' | 'boots' | 'jewel')[];
}

export const AFFIXES: Record<AffixStat, AffixSpec> = {
  atk: { label: 'Attack', min: 1, max: 3, perLevel: 0.35, on: ['weapon', 'jewel'] },
  matk: { label: 'Magic Attack', min: 1, max: 3, perLevel: 0.35, on: ['weapon', 'jewel'] },
  def: { label: 'Defense', min: 1, max: 3, perLevel: 0.3, on: ['armor', 'boots'] },
  mdef: { label: 'Magic Defense', min: 1, max: 3, perLevel: 0.25, on: ['armor', 'boots', 'jewel'] },
  hp: { label: 'Max HP', min: 8, max: 20, perLevel: 3.5, on: ['armor', 'boots', 'jewel'] },
  mp: { label: 'Max MP', min: 5, max: 12, perLevel: 2, on: ['armor', 'jewel'] },
  str: { label: 'Strength', min: 1, max: 2, perLevel: 0.12, on: ['weapon', 'armor', 'jewel'] },
  agi: { label: 'Agility', min: 1, max: 2, perLevel: 0.12, on: ['weapon', 'armor', 'boots', 'jewel'] },
  int: { label: 'Intelligence', min: 1, max: 2, perLevel: 0.12, on: ['weapon', 'armor', 'jewel'] },
  vit: { label: 'Vitality', min: 1, max: 2, perLevel: 0.12, on: ['armor', 'boots', 'jewel'] },
  luk: { label: 'Luck', min: 1, max: 2, perLevel: 0.12, on: ['weapon', 'jewel'] },
  crit: { label: 'Critical', pct: true, min: 1, max: 2, perLevel: 0.04, cap: 5, on: ['weapon', 'jewel'] },
  aspd: { label: 'Attack Speed', pct: true, min: 2, max: 4, perLevel: 0.05, cap: 8, on: ['weapon'] }, // also gloves (see affixPool)
  lifesteal: { label: 'Lifesteal', pct: true, min: 1, max: 2, perLevel: 0.03, cap: 4, on: ['weapon'] },
  move: { label: 'Move Speed', pct: true, min: 2, max: 3, perLevel: 0.03, cap: 6, on: ['boots'] },
};

/** How many affixes a drop of this rarity rolls: [min, max]. */
const COUNT: Record<ItemRarity, [number, number]> = {
  common: [0, 1],
  uncommon: [1, 1],
  rare: [1, 2],
  epic: [2, 2],
  legendary: [2, 3],
  mythic: [3, 3],
};

export const MAX_AFFIXES = 4;

export interface AffixItem {
  rarity: ItemRarity;
  levelRequirement: number;
  category: string;
  equip?: { slot: string } | null;
}

function gearKind(item: AffixItem): 'weapon' | 'armor' | 'boots' | 'jewel' | 'gloves' | null {
  const slot = item.equip?.slot;
  if (!slot) return null;
  if (slot === 'mainhand') return 'weapon';
  if (slot === 'boots') return 'boots';
  if (slot === 'gloves') return 'gloves';
  if (slot === 'ring' || slot === 'necklace') return 'jewel';
  if (item.category === 'weapon' || item.category === 'armor') return 'armor';
  return null;
}

/** The affixes this kind of gear can roll. */
export function affixPool(item: AffixItem): AffixStat[] {
  const kind = gearKind(item);
  if (!kind) return [];
  const k = kind === 'gloves' ? 'armor' : kind;
  return (Object.keys(AFFIXES) as AffixStat[]).filter((s) => {
    if (s === 'aspd') return kind === 'weapon' || kind === 'gloves';
    return AFFIXES[s].on.includes(k);
  });
}

/** One affix's value for an item of this level. */
export function affixValue(stat: AffixStat, level: number, rand: () => number): number {
  const a = AFFIXES[stat];
  const lo = a.min + a.perLevel * (level - 1);
  const hi = a.max + a.perLevel * (level - 1);
  const v = Math.max(1, Math.round(lo + (hi - lo) * rand()));
  return a.cap ? Math.min(a.cap, v) : v;
}

/** Roll the random stats for one dropped piece of gear (none for non-gear). */
export function rollAffixes(item: AffixItem, rand: () => number = Math.random, opts: { elite?: boolean } = {}): ItemAffix[] {
  const pool = affixPool(item);
  if (!pool.length) return [];
  const [lo, hi] = COUNT[item.rarity] ?? [0, 1];
  let n = lo + Math.floor(rand() * (hi - lo + 1));
  if (opts.elite) n += 1;
  n = Math.min(MAX_AFFIXES, n, pool.length);
  const picks: ItemAffix[] = [];
  const left = [...pool];
  for (let i = 0; i < n; i++) {
    const at = Math.floor(rand() * left.length);
    const stat = left.splice(at, 1)[0]!;
    picks.push({ stat, value: affixValue(stat, Math.max(1, item.levelRequirement), rand) });
  }
  // Stable order makes identical rolls stack and look tidy.
  return picks.sort((a, b) => a.stat.localeCompare(b.stat));
}

/** "+4% Critical", "+12 Max HP". */
export function affixText(a: ItemAffix): string {
  const spec = AFFIXES[a.stat as AffixStat];
  if (!spec) return `+${a.value} ${a.stat}`;
  return `+${a.value}${spec.pct ? '%' : ''} ${spec.label}`;
}

// ---------------------------------------------------------------------------
// Armour sets
// ---------------------------------------------------------------------------

export type SetBonus = Partial<Record<AffixStat, number>>;

export interface ArmorSet {
  id: string;
  name: string;
  level: number;
  /** Bonus at 2 pieces and (added on top) at 4 pieces. */
  two: SetBonus;
  four: SetBonus;
}

const SET_PIECES = ['head', 'chest', 'gloves', 'boots', 'shield'] as const;

function makeSet(id: string, name: string, level: number, flavour: SetBonus): ArmorSet {
  const s = (base: number, per: number) => Math.round(base + per * level);
  return {
    id,
    name,
    level,
    two: { hp: s(15, 4), def: s(2, 0.3) },
    four: { ...flavour, atk: s(2, 0.4), matk: s(2, 0.4), mdef: s(2, 0.3) },
  };
}

export const ARMOR_SETS: ArmorSet[] = [
  makeSet('padded', 'Padded', 1, { agi: 2 }),
  makeSet('copper', 'Copper', 5, { vit: 2 }),
  makeSet('iron', 'Iron', 12, { vit: 3, str: 2 }),
  makeSet('silver', 'Silver', 22, { int: 4, mp: 30 }),
  makeSet('gold', 'Gold', 32, { luk: 5, crit: 2 }),
  makeSet('mithril', 'Mithril', 42, { agi: 6, aspd: 4 }),
  makeSet('obsidian', 'Obsidian', 56, { str: 8, lifesteal: 2 }),
  makeSet('star_metal', 'Star Metal', 70, { crit: 3, move: 4, vit: 8 }),
];

/** Which set an item belongs to, if any (e.g. "iron_boots" → Iron). */
export function setOf(itemId: string): ArmorSet | undefined {
  for (const s of ARMOR_SETS) {
    if (!itemId.startsWith(`${s.id}_`)) continue;
    const rest = itemId.slice(s.id.length + 1);
    if ((SET_PIECES as readonly string[]).includes(rest)) return s;
  }
  return undefined;
}

/** Sets being worn and how many pieces of each. */
export function wornSets(itemIds: string[]): { set: ArmorSet; pieces: number }[] {
  const n = new Map<ArmorSet, number>();
  for (const id of new Set(itemIds)) {
    const s = setOf(id);
    if (s) n.set(s, (n.get(s) ?? 0) + 1);
  }
  return [...n.entries()].map(([set, pieces]) => ({ set, pieces }));
}

/** The total bonus from every set being worn. */
export function setBonuses(itemIds: string[]): SetBonus {
  const out: SetBonus = {};
  const add = (b: SetBonus) => {
    for (const [k, v] of Object.entries(b) as [AffixStat, number][]) out[k] = (out[k] ?? 0) + v;
  };
  for (const { set, pieces } of wornSets(itemIds)) {
    if (pieces >= 2) add(set.two);
    if (pieces >= 4) add(set.four);
  }
  return out;
}

export function bonusText(b: SetBonus): string {
  return (Object.entries(b) as [AffixStat, number][]).map(([stat, value]) => affixText({ stat, value })).join(', ');
}

/** Blacksmith re-roll price for one bonus stat: Gold (a sink) plus an Enhancement Stone. */
export function rerollCost(levelRequirement: number): { gold: number; stones: number } {
  return { gold: 500 + Math.max(1, levelRequirement) * 120, stones: 1 };
}

/** Re-roll one bonus stat: a new stat the item doesn't already have, valued for its level. */
export function rerollAffix(item: AffixItem, affixes: ItemAffix[], index: number, rand: () => number = Math.random): ItemAffix[] {
  const pool = affixPool(item).filter((s) => !affixes.some((a, i) => i !== index && a.stat === s));
  if (!pool.length || !affixes[index]) return affixes;
  const stat = pool[Math.floor(rand() * pool.length)]!;
  const next = affixes.map((a, i) => (i === index ? { stat, value: affixValue(stat, Math.max(1, item.levelRequirement), rand) } : a));
  return next.sort((a, b) => a.stat.localeCompare(b.stat));
}
