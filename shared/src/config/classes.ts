import type { ResourceKind } from '../types.js';

export type JobId = 'recruit' | 'vanguard' | 'elementalist' | 'wayfinder' | 'channeler' | 'specter';

export interface ClassDef {
  id: JobId;
  name: string;
  resource: ResourceKind;
  hpModifier: number;
  weaponTypes: string[];
  maxJobLevel: number;
}

// Only Recruit is playable in M1; the five 1st jobs arrive in M2 (SPEC.md section 10),
// but their defs live here now since skill-tree/UI work can reference them early.
export const CLASSES: Record<JobId, ClassDef> = {
  recruit: {
    id: 'recruit',
    name: 'Recruit',
    resource: 'stamina',
    hpModifier: 1.0,
    weaponTypes: ['basic'],
    maxJobLevel: 10,
  },
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    resource: 'momentum',
    hpModifier: 1.25,
    weaponTypes: ['sword', 'mace'],
    maxJobLevel: 50,
  },
  elementalist: {
    id: 'elementalist',
    name: 'Elementalist',
    resource: 'mana',
    hpModifier: 0.85,
    weaponTypes: ['staff'],
    maxJobLevel: 50,
  },
  wayfinder: {
    id: 'wayfinder',
    name: 'Wayfinder',
    resource: 'focus',
    hpModifier: 1.0,
    weaponTypes: ['bow'],
    maxJobLevel: 50,
  },
  channeler: {
    id: 'channeler',
    name: 'Channeler',
    resource: 'mana',
    hpModifier: 0.9,
    weaponTypes: ['staff'],
    maxJobLevel: 50,
  },
  specter: {
    id: 'specter',
    name: 'Specter',
    resource: 'stamina',
    hpModifier: 1.0,
    weaponTypes: ['dagger'],
    maxJobLevel: 50,
  },
};
