import { BALANCE, getClass, getItem, getMap } from '@terrago/game-data';
import {
  addItem,
  createCharacterSchema,
  emptySlots,
  firstIssue,
  maxHp,
  maxMp,
  tileCenter,
  toInventorySlots,
  type CharacterSummary,
  type CreateCharacterInput,
  type InventorySlot,
} from '@terrago/shared';
import type { CharacterRecord } from '../../game-server/src/world/characterState';

/**
 * Offline preview save, kept in this browser only (localStorage). The real
 * game stores all of this in PostgreSQL on the server.
 */
export interface SaveData {
  version: 1;
  character: CharacterRecord;
  inventory: { capacity: number; slots: InventorySlot[] };
  flags: string[];
  createdAt: string;
}

const KEY = 'terrago:preview:v1';
let memory: SaveData | null = null;

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = JSON.parse(raw) as SaveData;
  } catch {
    // Storage unavailable (private window, blocked site data): keep the in-memory copy.
  }
  return memory?.version === 1 ? memory : null;
}

export function writeSave(data: SaveData): void {
  memory = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Progress then lasts for this visit only.
  }
}

export function clearSave(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function summaryOf(save: SaveData): CharacterSummary {
  const c = save.character;
  return {
    id: c.id,
    name: c.name,
    classId: c.classId,
    level: c.level,
    mapId: c.mapId,
    appearance: c.appearance,
    createdAt: save.createdAt,
    lastPlayedAt: null,
  };
}

/** Mirrors the server's createCharacter: same stats, starter kit, Gold and spawn. */
export function createLocalCharacter(input: CreateCharacterInput): SaveData {
  const parsed = createCharacterSchema.safeParse(input);
  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  const { name, classId, appearance } = parsed.data;
  const cls = getClass(classId);
  const map = getMap(BALANCE.character.startingMap)!;
  const spawn = tileCenter(map.spawn.x, map.spawn.y);

  let slots = emptySlots(BALANCE.character.inventoryCapacity);
  for (const s of BALANCE.character.starterItems) {
    const def = getItem(s.itemId)!;
    const r = addItem(slots, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: def.bind === 'pickup' }, s.quantity, def.stackSize);
    if (r.ok) slots = r.slots;
  }

  const save: SaveData = {
    version: 1,
    character: {
      id: crypto.randomUUID(),
      userId: 'preview-player',
      name,
      classId,
      level: 1,
      xp: 0,
      gold: BALANCE.character.startingGold,
      appearance,
      mapId: map.id,
      x: spawn.x,
      y: spawn.y,
      dir: map.spawn.dir,
      stats: { ...cls.baseStats },
      hp: maxHp(1, cls.baseStats, cls),
      mp: maxMp(1, cls.baseStats, cls),
      energy: BALANCE.energy.startingEnergy,
      energyUpdatedAt: Date.now(),
    },
    inventory: { capacity: BALANCE.character.inventoryCapacity, slots: toInventorySlots(slots) },
    flags: [],
    createdAt: new Date().toISOString(),
  };
  writeSave(save);
  return save;
}
