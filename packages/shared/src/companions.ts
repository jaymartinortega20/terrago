/**
 * Mounts and pets: rules both the server and the client need (speeds, terrain,
 * looks, and how pets grow). The server stays authoritative; the client uses
 * these to draw the stable, the pet menu and to predict movement.
 */

// ---------------------------------------------------------------------------
// Mounts
// ---------------------------------------------------------------------------

/** How long getting on a mount takes. Moving or taking a hit cancels it. */
export const MOUNT_CHANNEL_MS = 500;
/** Knocked off your mount by a hit: you are slowed for this long. */
export const DISMOUNT_PENALTY_MS = 2000;
export const DISMOUNT_PENALTY_MULT = 0.6;

export type MountPerkId = 'ice_walker' | 'lava_strider' | 'all_terrain';

export const MOUNT_PERKS: Record<MountPerkId, { name: string; text: string }> = {
  ice_walker: { name: 'Ice Walker', text: "Ignores the slowing ice of Map 4's Glacial Depths." },
  lava_strider: { name: 'Lava Strider', text: "Ignores the scorched ground of Map 6's Infernal Caldera." },
  all_terrain: { name: 'Celestial Stride', text: 'Ignores every kind of slowing ground.' },
};

/** Ground that slows everyone (on foot or riding) unless their mount has the perk. */
export const TERRAIN_SLOW: Record<string, { mult: number; perk: MountPerkId; name: string }> = {
  glacial_depths: { mult: 0.8, perk: 'ice_walker', name: 'icy caverns' },
  infernal_caldera: { mult: 0.85, perk: 'lava_strider', name: 'scorched ground' },
};

export function terrainMult(mapId: string, perk: MountPerkId | undefined | null): number {
  const t = TERRAIN_SLOW[mapId];
  if (!t) return 1;
  if (perk === 'all_terrain' || perk === t.perk) return 1;
  return t.mult;
}

export type MountStyleSlot = 'saddle' | 'barding' | 'trail';

export interface MountStyleDef {
  id: string;
  slot: MountStyleSlot;
  name: string;
  color: string;
  /** Gold at Stablemaster Hana; 0 = everyone has it; -1 = Gem Shop only. */
  price: number;
}

/** Saddles, barding and trails you can put on any mount. */
export const MOUNT_STYLES: readonly MountStyleDef[] = [
  { id: 'saddle_leather', slot: 'saddle', name: 'Leather Saddle', color: '#7a4a2a', price: 0 },
  { id: 'saddle_royal', slot: 'saddle', name: 'Royal Saddle', color: '#b0322a', price: 4000 },
  { id: 'saddle_azure', slot: 'saddle', name: 'Azure Saddle', color: '#2f6fd0', price: 4000 },
  { id: 'saddle_gilded', slot: 'saddle', name: 'Gilded Saddle', color: '#e8b830', price: 15000 },
  { id: 'barding_iron', slot: 'barding', name: 'Iron Barding', color: '#9aa4b0', price: 8000 },
  { id: 'barding_obsidian', slot: 'barding', name: 'Obsidian Barding', color: '#3a2f4a', price: 20000 },
  { id: 'barding_celestial', slot: 'barding', name: 'Celestial Barding', color: '#e8e6ff', price: 45000 },
  { id: 'trail_sparkle', slot: 'trail', name: 'Sparkle Trail', color: '#fff2a0', price: 6000 },
  { id: 'trail_ember', slot: 'trail', name: 'Ember Trail', color: '#ff7a2a', price: 12000 },
  { id: 'trail_frost', slot: 'trail', name: 'Frost Trail', color: '#9ae0ff', price: 12000 },
  { id: 'trail_void', slot: 'trail', name: 'Void Trail', color: '#a050ff', price: 30000 },
  // Gem Shop only
  { id: 'saddle_starlight', slot: 'saddle', name: 'Starlight Saddle', color: '#9ab8ff', price: -1 },
  { id: 'barding_dragonscale', slot: 'barding', name: 'Dragonscale Barding', color: '#c0302a', price: -1 },
  { id: 'barding_gilded', slot: 'barding', name: 'Gilded Barding', color: '#ffd34a', price: -1 },
  { id: 'trail_sakura', slot: 'trail', name: 'Sakura Trail', color: '#ff9ad0', price: -1 },
  { id: 'trail_starfall', slot: 'trail', name: 'Starfall Trail', color: '#fff0ff', price: -1 },
];

export const getMountStyle = (id: string | null | undefined) => (id ? MOUNT_STYLES.find((s) => s.id === id) : undefined);

export interface MountLook {
  saddle?: string | null;
  barding?: string | null;
  trail?: string | null;
}

/** "+60%" for a 1.6× mount. */
export function speedBonusText(speed: number): string {
  return `+${Math.round((speed - 1) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------

export type PetRole = 'tank' | 'striker' | 'support' | 'skirmisher';
export type PetGrowthId = 'speed' | 'crit' | 'leech';

export const PET_GROWTH: Record<PetGrowthId, { name: string; text: (n: number) => string }> = {
  speed: { name: 'Swift Bond', text: (n) => `+${n * 2}% your movement speed` },
  crit: { name: 'Keen Eyes', text: (n) => `+${n}% your critical strike chance` },
  leech: { name: 'Blood Bite', text: (n) => `Your pet's bites heal you for ${n * 4}% of their damage` },
};
/** Most points one trait can take. */
export const PET_GROWTH_MAX = 5;

export interface PetSkillDef {
  name: string;
  text: string;
}

export interface PetArchetype {
  role: PetRole;
  /** Health, attack power and aggro draw (% of hits on you it takes instead): base + per level. */
  hp: [number, number];
  atk: [number, number];
  aggro: [number, number];
  /** Tier 1 always, tier 2 from pet level 20, tier 3 at loyalty 80+. */
  skills: [PetSkillDef, PetSkillDef, PetSkillDef];
}

/** Pets scale by what kind of animal they are. */
export const PET_ARCHETYPES: Record<string, PetArchetype> = {
  dog: {
    role: 'tank',
    hp: [80, 26],
    atk: [4, 1.0],
    aggro: [18, 0.22],
    skills: [
      { name: 'Bite', text: 'Bites the monster you are fighting.' },
      { name: 'Guard Bark', text: 'Every 4th attack taunts: it draws the next hits for 3 seconds.' },
      { name: 'Bulwark', text: 'Every 7th attack: shields you for 8% of your max HP.' },
    ],
  },
  cat: {
    role: 'skirmisher',
    hp: [50, 14],
    atk: [6, 1.4],
    aggro: [8, 0.1],
    skills: [
      { name: 'Scratch', text: 'Claws at the monster you are fighting.' },
      { name: 'Pounce', text: 'Every 4th attack hits twice as hard.' },
      { name: 'Nine Lives', text: 'Every 7th attack: heals you for 6% of your max HP.' },
    ],
  },
  fox: {
    role: 'striker',
    hp: [45, 12],
    atk: [7, 1.6],
    aggro: [6, 0.08],
    skills: [
      { name: 'Nip', text: 'Quick bites with a high critical chance.' },
      { name: 'Trickster', text: 'Every 4th attack always crits.' },
      { name: 'Foxfire', text: 'Every 7th attack: a fiery blast for triple damage.' },
    ],
  },
  slime: {
    role: 'support',
    hp: [70, 20],
    atk: [3, 0.6],
    aggro: [10, 0.12],
    skills: [
      { name: 'Ooze', text: 'Sticky hits that heal you a little each time.' },
      { name: 'Jelly Coat', text: 'Every 4th attack: shields you for 5% of your max HP.' },
      { name: 'Restoring Bloom', text: 'Every 7th attack: heals you for 12% of your max HP.' },
    ],
  },
  dragonling: {
    role: 'striker',
    hp: [70, 18],
    atk: [9, 2.0],
    aggro: [10, 0.12],
    skills: [
      { name: 'Claw', text: 'Strong claws from a little dragon.' },
      { name: 'Fire Breath', text: 'Every 4th attack breathes fire for double damage.' },
      { name: 'Inferno', text: 'Every 7th attack: a blazing burst for triple damage.' },
    ],
  },
  hawk: {
    role: 'striker',
    hp: [55, 14],
    atk: [9, 2.1],
    aggro: [6, 0.08],
    skills: [
      { name: 'Talon Dive', text: 'Dives from the sky with sharp talons.' },
      { name: 'Gale Strike', text: 'Every 4th attack always crits.' },
      { name: 'Skyfall', text: 'Every 7th attack: a dive for triple damage.' },
    ],
  },
};

export const archetypeOf = (kind: string): PetArchetype => PET_ARCHETYPES[kind] ?? PET_ARCHETYPES.dog!;

export const PET_LOYALTY_SKILL = 80;
export const PET_LOYALTY_LOW = 20;
export const PET_SKILL2_LEVEL = 20;
export const PET_MAX_LEVEL = 100;

/** Pet EXP needed for the next level (a tenth of a player's). */
export function petXpToNext(level: number): number {
  if (level >= PET_MAX_LEVEL) return 0;
  return Math.round(10 * Math.pow(level, 1.8));
}

/**
 * Pet evolution: at level 30 and 60 a loyal pet can evolve (Evolution Stones +
 * Gold). Each stage makes it stronger and bigger; stage 3 glows.
 */
export const PET_STAGES = [
  { stage: 1, title: '', mult: 1, minLevel: 1, stones: 0, gold: 0 },
  { stage: 2, title: 'Grown', mult: 1.35, minLevel: 30, stones: 1, gold: 10_000 },
  { stage: 3, title: 'Mythic', mult: 1.8, minLevel: 60, stones: 3, gold: 50_000 },
] as const;
export const PET_EVOLVE_LOYALTY = 60;

export function petStage(stage: number | undefined) {
  return PET_STAGES[Math.max(0, Math.min(PET_STAGES.length - 1, (stage ?? 1) - 1))]!;
}

export function petStats(kind: string, level: number, stage = 1): { maxHp: number; atk: number; aggro: number } {
  const a = archetypeOf(kind);
  const l = Math.max(1, level) - 1;
  const m = petStage(stage).mult;
  return {
    maxHp: Math.round((a.hp[0] + a.hp[1] * l) * m),
    atk: Math.round((a.atk[0] + a.atk[1] * l) * m * 10) / 10,
    aggro: Math.min(45, Math.round((a.aggro[0] + a.aggro[1] * l) * 10) / 10),
  };
}

export const petGrowthPoints = (level: number) => Math.floor(level / 10);

export type PetGrowth = Partial<Record<PetGrowthId, number>>;

export const spentGrowth = (g: PetGrowth) => (g.speed ?? 0) + (g.crit ?? 0) + (g.leech ?? 0);

/** What feeding something gives a pet: EXP and loyalty. Low-tier fish and pet treats. */
export function petFoodValue(item: { id: string; category: string; rarity: string; petFood?: { xp: number; loyalty: number } }): { xp: number; loyalty: number } | null {
  if (item.petFood) return item.petFood;
  if (item.category !== 'fish') return null;
  if (item.rarity === 'common') return { xp: 60, loyalty: 2 };
  if (item.rarity === 'uncommon') return { xp: 150, loyalty: 3 };
  return null;
}

/** Everything the pet menu shows about one pet. */
export interface PetView {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  level: number;
  xp: number;
  xpToNext: number;
  loyalty: number;
  growth: PetGrowth;
  points: number;
  hp: number;
  maxHp: number;
  atk: number;
  aggro: number;
  /** Knocked out until (ms since epoch). */
  koUntil: number;
  /** Evolution stage (1-3) and what the next one needs (null at the top). */
  stage: number;
  next: { stage: number; title: string; minLevel: number; stones: number; gold: number; loyalty: number } | null;
}
