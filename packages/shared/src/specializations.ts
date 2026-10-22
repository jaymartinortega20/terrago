/**
 * Profession specializations. At level 40 in a profession you pick one of two
 * paths. A character can specialize in at most two professions, so nobody
 * masters everything — top-tier gear needs the right specialist.
 */
export const SPEC_LEVEL = 40;
export const SPEC_MAX = 2;
export const SPEC_CHANGE_COST = 5000;

export interface SpecDef {
  id: string;
  skill: string;
  name: string;
  description: string;
}

export const SPECIALIZATIONS: SpecDef[] = [
  { id: 'crop_master', skill: 'farming', name: 'Crop Master', description: '30% chance of an extra crop per harvest and better quality rolls.' },
  { id: 'animal_keeper', skill: 'farming', name: 'Animal Keeper', description: 'Your animals give twice the eggs, milk and wool.' },
  { id: 'weapon_smith', skill: 'smithing', name: 'Weapon Smith', description: 'Only Weapon Smiths can forge Obsidian and Star Metal weapons. +50% XP on weapons.' },
  { id: 'armor_smith', skill: 'smithing', name: 'Armor Smith', description: 'Only Armor Smiths can forge Obsidian and Star Metal armor and shields. +50% XP on armor.' },
  { id: 'deep_sea_fisher', skill: 'fishing', name: 'Deep Sea Fisher', description: 'A 25% wider catch zone when reeling — big fish get away less.' },
  { id: 'rare_fish_hunter', skill: 'fishing', name: 'Rare Fish Hunter', description: 'High-level and rare fish bite two and a half times as often.' },
  { id: 'potion_master', skill: 'alchemy', name: 'Potion Master', description: 'Potions and elixirs come out doubled.' },
  { id: 'enhancement_alchemist', skill: 'alchemy', name: 'Enhancement Alchemist', description: 'Enhancement Stones come out doubled, and +5% enhancement success.' },
  { id: 'bowyer', skill: 'crafting', name: 'Bowyer', description: 'Only Bowyers can make Obsidian and Star Metal bows and staves. +50% XP on them.' },
  { id: 'artificer', skill: 'crafting', name: 'Artificer', description: 'Planks, rope and rods come out doubled.' },
  { id: 'chef', skill: 'cooking', name: 'Chef', description: 'Cooked meals come out doubled.' },
  { id: 'brewer', skill: 'cooking', name: 'Cheesemaker', description: 'Dairy and baked goods come out doubled, and cost no fee.' },
];

export function specsFor(skill: string): SpecDef[] {
  return SPECIALIZATIONS.filter((s) => s.skill === skill);
}

export function getSpec(id: string): SpecDef | undefined {
  return SPECIALIZATIONS.find((s) => s.id === id);
}
