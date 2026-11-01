export interface DropEntry {
  itemId: string;
  chance: number; // 0..1
  minQty: number;
  maxQty: number;
}

export type AiBehavior = 'passive' | 'aggressive' | 'ranged' | 'fleeing';

export interface MonsterDef {
  id: string;
  name: string;
  levelBand: [number, number];
  maxHp: number;
  atk: number;
  def: number;
  flee: number;
  hit: number;
  critChance: number;
  moveSpeedTilesPerSec: number;
  attackIntervalMs: number;
  attackRangeTiles: number;
  aiBehavior: AiBehavior;
  aggroBarks: string[];
  baseExpReward: number;
  baseGoldMin: number;
  baseGoldMax: number;
  drops: DropEntry[];
}

// M1 needs only the Slime (Whispering Fields, SPEC.md section 6: "gentle field creatures" ->
// passive AI, it doesn't initiate). 3-4 monster types per combat map arrive with that map's milestone.
export const MONSTERS: Record<string, MonsterDef> = {
  slime: {
    id: 'slime',
    name: 'Slime',
    levelBand: [1, 10],
    maxHp: 45,
    atk: 6,
    def: 1,
    flee: 5,
    hit: 5,
    critChance: 1,
    moveSpeedTilesPerSec: 1.2,
    attackIntervalMs: 1400,
    attackRangeTiles: 1,
    aiBehavior: 'passive',
    aggroBarks: ['*splorch*', 'blub?', 'gloop!'],
    baseExpReward: 8,
    baseGoldMin: 1,
    baseGoldMax: 4,
    drops: [
      { itemId: 'slime_gel', chance: 0.7, minQty: 1, maxQty: 2 },
      { itemId: 'potion_hp_small', chance: 0.05, minQty: 1, maxQty: 1 },
    ],
  },
};
