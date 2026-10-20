import { BALANCE, equipDef, getClass, getMap } from '@terrago/game-data';
import {
  combatProfile,
  settleEnergy,
  tileCenter,
  xpToNext,
  type Appearance,
  type BaseStats,
  type ClassId,
  type Direction,
  type CombatProfile,
  type InventorySlot,
  type SelfState,
  type SkillSet,
} from '@terrago/shared';
import { collisionGridFor } from './grids';

/** In-memory view of a character, loaded from the database when entering the world. */
export interface CharacterRecord {
  id: string;
  userId: string;
  name: string;
  classId: ClassId;
  level: number;
  xp: number;
  gold: number;
  appearance: Appearance;
  mapId: string;
  x: number;
  y: number;
  dir: Direction;
  stats: BaseStats;
  hp: number;
  mp: number;
  energy: number;
  energyUpdatedAt: number;
  skills: SkillSet;
  /** Worn items (slot = EQUIP_SLOTS index). */
  equipment: InventorySlot[];
}

export interface PositionSave {
  id: string;
  mapId: string;
  x: number;
  y: number;
  dir: Direction;
  hp?: number;
  mp?: number;
}

export function profileFor(rec: CharacterRecord): CombatProfile {
  const cls = getClass(rec.classId);
  return combatProfile(rec.level, rec.stats, cls.growth, { base: cls.hpBase, perLevel: cls.hpPerLevel, mpBase: cls.mpBase, mpPerLevel: cls.mpPerLevel }, rec.equipment ?? [], equipDef);
}

/**
 * Saved positions are re-validated on load: if the map no longer exists or the
 * spot became solid (map edits, old data), the character is moved to spawn.
 */
export function sanitizePosition(rec: CharacterRecord): CharacterRecord {
  let map = getMap(rec.mapId);
  if (!map) {
    map = getMap(BALANCE.character.startingMap)!;
    rec.mapId = map.id;
  }
  const grid = collisionGridFor(map);
  if (!Number.isFinite(rec.x) || !Number.isFinite(rec.y) || grid.bodyBlocked(rec.x, rec.y)) {
    const spawn = tileCenter(map.spawn.x, map.spawn.y);
    rec.x = spawn.x;
    rec.y = spawn.y;
    rec.dir = map.spawn.dir;
  }
  return rec;
}

export function buildSelfState(rec: CharacterRecord, now = Date.now(), profile = profileFor(rec)): SelfState {
  const energy = settleEnergy(rec.energy, rec.energyUpdatedAt, now, BALANCE.energy);
  return {
    characterId: rec.id,
    name: rec.name,
    classId: rec.classId,
    level: rec.level,
    xp: rec.xp,
    xpToNext: xpToNext(rec.level, BALANCE.xpCurve),
    gold: rec.gold,
    hp: Math.min(rec.hp, profile.maxHp),
    maxHp: profile.maxHp,
    mp: Math.min(rec.mp, profile.maxMp),
    maxMp: profile.maxMp,
    energy: energy.energy,
    maxEnergy: BALANCE.energy.max,
    stats: profile.stats,
    derived: profile.derived,
    appearance: rec.appearance,
    skills: rec.skills,
  };
}
