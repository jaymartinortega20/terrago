import type { Appearance } from './types';

/** Character customisation palettes. Indexes are stored in the database. */
export const SKIN_TONES = ['#fbe0cd', '#f1c6a5', '#dfa77d', '#c08155', '#94603d', '#6b432a', '#4a2e1e'] as const;

export const HAIR_STYLES = ['Short Crop', 'Spiky', 'Long Flow', 'Ponytail', 'Bob', 'Buzz', 'Braided'] as const;

export const HAIR_COLORS = [
  '#2a1c15',
  '#5b3a26',
  '#9b5530',
  '#d9b35f',
  '#ebe3cf',
  '#b5392f',
  '#3d6fb8',
  '#4f9a55',
  '#8d58b8',
  '#e48aa9',
] as const;

export const EYE_COLORS = ['#2f2119', '#3b6fb6', '#3f8a4a', '#8b6a2e', '#7c4fb3', '#5c6670'] as const;

export interface OutfitPalette {
  name: string;
  shirt: string;
  shirtShade: string;
  pants: string;
  shoes: string;
  accent: string;
  robe: boolean;
}

export const OUTFITS: readonly OutfitPalette[] = [
  { name: 'Farmhand Tunic', shirt: '#5f9443', shirtShade: '#467031', pants: '#6d4c30', shoes: '#3a2a1e', accent: '#d8b45a', robe: false },
  { name: 'Traveler Vest', shirt: '#3f6a9e', shirtShade: '#2f507a', pants: '#4a4a58', shoes: '#2a2a33', accent: '#c9c2a6', robe: false },
  { name: 'Apprentice Robe', shirt: '#6b4fa3', shirtShade: '#523b80', pants: '#523b80', shoes: '#33284a', accent: '#e2c86b', robe: true },
  { name: 'Woodland Jerkin', shirt: '#7a5a34', shirtShade: '#5d4426', pants: '#4b5e35', shoes: '#33291c', accent: '#a7c46a', robe: false },
  { name: 'Market Blouse', shirt: '#c45b4a', shirtShade: '#9c4538', pants: '#3d3b52', shoes: '#2b2233', accent: '#f0d9a8', robe: false },
  { name: 'Pilgrim Cloak', shirt: '#d9d2bf', shirtShade: '#b3ab95', pants: '#b3ab95', shoes: '#5a4a3a', accent: '#6d9fc4', robe: true },
] as const;

export const BODY_TYPES = ['a', 'b'] as const;

export const DEFAULT_APPEARANCE: Appearance = {
  bodyType: 'a',
  skinTone: 1,
  hairStyle: 0,
  hairColor: 1,
  eyeColor: 0,
  outfit: 0,
};

export function isValidAppearance(a: Appearance): boolean {
  const inRange = (v: number, len: number) => Number.isInteger(v) && v >= 0 && v < len;
  return (
    BODY_TYPES.includes(a.bodyType) &&
    inRange(a.skinTone, SKIN_TONES.length) &&
    inRange(a.hairStyle, HAIR_STYLES.length) &&
    inRange(a.hairColor, HAIR_COLORS.length) &&
    inRange(a.eyeColor, EYE_COLORS.length) &&
    inRange(a.outfit, OUTFITS.length)
  );
}
