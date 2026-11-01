export type ItemSlot = 'weapon' | 'helmet' | 'chest' | 'boots' | 'wings' | 'consumable' | 'material';
export type ItemRarity = 'common' | 'rare' | 'epic' | 'mythic';

export interface ItemDef {
  id: string;
  name: string;
  slot: ItemSlot;
  rarity: ItemRarity;
  stackable: boolean;
  maxStack: number;
  weight: number;
  /** Only present for weapon-slot items; gates which classes can equip it (SPEC.md section 10). */
  weaponType?: string;
  atk?: number;
  matk?: number;
  attackIntervalMs?: number;
  def?: number;
  mdef?: number;
  /** Instant HP restored, for consumables. */
  healHp?: number;
  description: string;
}

// Minimal M1 item set: a Recruit starter weapon, one basic piece of armor per
// equipment slot (so M1's "equipping changes the sprite" acceptance criterion
// has something to equip in every slot - docs/DECISIONS.md), a potion for
// hotbar/AUTO testing, and the quest material "Cleaning the Horizon" needs.
// None of these drop or sell yet (no shop/loot table references them besides
// registration's starter weapon) - reachable via the dev `/give` command
// until a shop or drop source is built. Expands per-map in later milestones.
export const ITEMS: Record<string, ItemDef> = {
  recruit_training_sword: {
    id: 'recruit_training_sword',
    name: 'Training Sword',
    slot: 'weapon',
    rarity: 'common',
    stackable: false,
    maxStack: 1,
    weight: 20,
    weaponType: 'basic',
    atk: 8,
    matk: 0,
    attackIntervalMs: 900,
    description: 'A dull blade for a fresh Recruit. Better than fists.',
  },
  recruit_cloth_cap: {
    id: 'recruit_cloth_cap',
    name: 'Cloth Cap',
    slot: 'helmet',
    rarity: 'common',
    stackable: false,
    maxStack: 1,
    weight: 5,
    def: 1,
    description: 'Simple stitched cloth. Keeps the rain off, mostly.',
  },
  recruit_cloth_vest: {
    id: 'recruit_cloth_vest',
    name: 'Cloth Vest',
    slot: 'chest',
    rarity: 'common',
    stackable: false,
    maxStack: 1,
    weight: 15,
    def: 2,
    description: "A Recruit's basic padded vest.",
  },
  recruit_leather_boots: {
    id: 'recruit_leather_boots',
    name: 'Leather Boots',
    slot: 'boots',
    rarity: 'common',
    stackable: false,
    maxStack: 1,
    weight: 8,
    def: 1,
    description: 'Sturdy enough for a long patrol.',
  },
  tattered_wings: {
    id: 'tattered_wings',
    name: 'Tattered Wings',
    slot: 'wings',
    rarity: 'common',
    stackable: false,
    maxStack: 1,
    weight: 10,
    def: 0,
    description: 'Torn and flightless, but they still flutter proudly from the shoulders.',
  },
  potion_hp_small: {
    id: 'potion_hp_small',
    name: 'Small HP Potion',
    slot: 'consumable',
    rarity: 'common',
    stackable: true,
    maxStack: 20,
    weight: 1,
    healHp: 40,
    description: 'Restores a modest amount of HP instantly.',
  },
  slime_gel: {
    id: 'slime_gel',
    name: 'Slime Gel',
    slot: 'material',
    rarity: 'common',
    stackable: true,
    maxStack: 999,
    weight: 0.1,
    description: "Raw gel from a defeated Slime. Elder Fin wants some for 'Cleaning the Horizon'.",
  },
};
