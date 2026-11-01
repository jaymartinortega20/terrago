export type StatName = 'STR' | 'AGI' | 'VIT' | 'LUK' | 'INT' | 'DEX';

export interface Stats {
  STR: number;
  AGI: number;
  VIT: number;
  LUK: number;
  INT: number;
  DEX: number;
}

export type EquipmentSlot = 'weapon' | 'helmet' | 'chest' | 'boots' | 'wings';

export type Facing = 'down' | 'up' | 'left' | 'right';

export type ResourceKind = 'stamina' | 'momentum' | 'mana' | 'focus';

export type AttackOutcome =
  | { kind: 'perfectDodge' }
  | { kind: 'miss' }
  | { kind: 'hit'; crit: boolean; damage: number };

export interface AttackerCombatInput {
  /** Melee/Ranged ATK or MATK, whichever applies to this attack. */
  atk: number;
  /** 1.0 for a plain basic attack; a skill's own multiplier otherwise. */
  skillMultiplier: number;
  critChance: number;
  hit: number;
}

export interface DefenderCombatInput {
  /** DEF or MDEF, whichever applies to this attack. */
  def: number;
  flee: number;
  perfectDodgeChance: number;
}

export interface TileCoord {
  x: number;
  y: number;
}
