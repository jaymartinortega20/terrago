import { BALANCE, getClass, getMap } from '@terrago/game-data';
import {
  derivedStats,
  maxHp,
  maxMp,
  settleEnergy,
  tileCenter,
  xpToNext,
  type Appearance,
  type BaseStats,
  type ClassId,
  type Direction,
  type SelfState,
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
}

export interface PositionSave {
  id: string;
  mapId: string;
  x: number;
  y: number;
  dir: Direction;
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

export function buildSelfState(rec: CharacterRecord, now = Date.now()): SelfState {
  const cls = getClass(rec.classId);
  const energy = settleEnergy(rec.energy, rec.energyUpdatedAt, now, BALANCE.energy);
  return {
    characterId: rec.id,
    name: rec.name,
    classId: rec.classId,
    level: rec.level,
    xp: rec.xp,
    xpToNext: xpToNext(rec.level, BALANCE.xpCurve),
    gold: rec.gold,
    hp: rec.hp,
    maxHp: maxHp(rec.level, rec.stats, cls),
    mp: rec.mp,
    maxMp: maxMp(rec.level, rec.stats, cls),
    energy: energy.energy,
    maxEnergy: BALANCE.energy.max,
    stats: rec.stats,
    derived: derivedStats(rec.level, rec.stats),
    appearance: rec.appearance,
  };
}
