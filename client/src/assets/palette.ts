/**
 * Every color constant the procedural generators and the HUD draw from.
 * Centralized so "richly saturated... vibrant chibi" (SPEC.md section 6)
 * stays consistent across every generator instead of each one picking its
 * own hex values.
 */
import type { ItemRarity } from '@terago/shared';
import type { ResourceKind } from '@terago/shared';

export const SKIN_TONE = '#f4c9a0';
export const SKIN_SHADOW = '#d9a876';
export const HAIR_COLOR = '#4a3326';
export const HAIR_SHADOW = '#2f1f17';
export const BODY_COLOR = '#5b7fd1'; // Recruit's plain field tunic
export const BODY_SHADOW = '#3f5aa0';
export const OUTLINE = '#2a2030';
export const EYE_COLOR = '#2a2030';
export const BLUSH = '#f49a9a';

export const WEAPON_METAL = '#c9ccd4';
export const WEAPON_METAL_SHADOW = '#8d9099';
export const WEAPON_HILT = '#6b4a2f';

export const HELMET_COLOR = '#8a6a4a';
export const CHEST_COLOR = '#7a5a9a';
export const BOOTS_COLOR = '#5a4433';
export const WINGS_COLOR = 'rgba(230, 220, 255, 0.55)';
export const WINGS_EDGE = 'rgba(180, 160, 230, 0.8)';

/** SPEC.md section 9/10: "class resource bar in the class color". Every
 * class in M1 (just Recruit) uses `stamina`; the other resource kinds are
 * colored now so M2's job HUD work needs no new palette entries. */
export const RESOURCE_COLORS: Record<ResourceKind, string> = {
  stamina: '#e8a23c',
  momentum: '#e2543c',
  mana: '#3c8ee2',
  focus: '#3ce2c4',
};

export const HP_BAR_COLOR = '#e34a4a';
export const HP_BAR_BG = '#3a1515';
export const BASE_EXP_COLOR = '#f0d33c';
export const JOB_EXP_COLOR = '#4ad66d';

/** SPEC.md section 11: item border glow by quality. */
export const RARITY_COLORS: Record<ItemRarity, string> = {
  common: '#9aa0ab',
  rare: '#3c8ee2',
  epic: '#a23ce2',
  mythic: '#f0c23c',
};

/** The Slime's body colors (matches `slime_gel`'s loot-icon green,
 * ui.ts's `drawMaterialBlobIcon(ctx, '#7fd94a', 1)`, so the creature and
 * what it drops read as the same substance). */
export const SLIME_BASE = '#7fd94a';
export const SLIME_SHADOW = '#4e9e28';
export const SLIME_HIGHLIGHT = 'rgba(255, 255, 255, 0.55)';
export const SLIME_EYE = '#1f3a12';

/** Stationary world NPCs (generators/npc.ts) - each gets its own skin/hair/
 * outfit so Elder Fin, the Blacksmith and the shopkeeper read as distinct
 * characters at a glance, not re-tinted copies of each other. Found during
 * a visual pass that NPCs were rendering as a flat colored circle marker
 * with no character art at all (WorldScene.ts's renderNpcMarkers never
 * drew a sprite) - a real gap against SPEC.md section 6's "chibi style...
 * good enough to judge game feel, not grey boxes" bar. */
export const NPC_PALETTES = {
  elder_fin: {
    skin: '#e8c9a0',
    skinShadow: '#cda876',
    hair: '#e8e4de', // white/grey - elderly
    hairShadow: '#c7c2b8',
    robe: '#5a8a6e', // sage green, "wise elder" coding
    robeShadow: '#3d6b50',
    accent: '#d8c488', // gold trim
  },
  blacksmith: {
    skin: '#d9a876',
    skinShadow: '#b8835a',
    hair: '#2a211c',
    hairShadow: '#15100d',
    robe: '#8a5a3c', // leather apron
    robeShadow: '#6b4228',
    accent: '#4a4a52', // steel-grey buckle
  },
  shopkeeper: {
    skin: '#f4c9a0',
    skinShadow: '#d9a876',
    hair: '#6b4428',
    hairShadow: '#4a2f1c',
    robe: '#7a3c5a', // merchant burgundy vest
    robeShadow: '#5a2a40',
    accent: '#d4af37', // coin-gold buttons
  },
} as const;
export type NpcId = keyof typeof NPC_PALETTES;

/** SPEC.md section 11: talking world entities' chat colors. */
export const CHAT_SPEAKER_COLORS = {
  monster: '#c23c3c',
  pet: '#2ecc71',
  npc: '#3cb4e2',
  system: '#f0c23c',
  player: '#e8e8f0',
} as const;

// -------------------------------------------------------------- tile biomes

export const OAKHAVEN_PALETTE = {
  floorBase: '#d8b888',
  floorShadow: '#bfa06c',
  floorHighlight: '#e8cda0',
  pathStone: '#a8988a',
  pathStoneShadow: '#8a7a6c',
  grassAccent: '#7fae4a',
};

export const WHISPERING_FIELDS_PALETTE = {
  grassBase: '#6fae4a',
  grassShadow: '#5a9238',
  grassHighlight: '#8ec765',
  dirtPatch: '#a07848',
  flowerPink: '#e87ab0',
  flowerWhite: '#f5f0e0',
};

export const OBSTACLE_PALETTE = {
  rockBase: '#8a8a92',
  rockShadow: '#64646c',
  rockHighlight: '#aaaab2',
  bushBase: '#4a7a3a',
  bushShadow: '#345a28',
};

export const WAYSTONE_PALETTE = {
  stone: '#6a6a82',
  stoneShadow: '#48485a',
  glow: '#8ad4f0',
};
