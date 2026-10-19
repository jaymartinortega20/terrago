import {
  CLASS_IDS,
  validateMapDef,
  type Appearance,
  type ClassId,
  type ClassProfile,
  type Direction,
  type EnergyConfig,
  type ItemDef,
  type MapDef,
  type NpcAccessory,
  type NpcPublic,
  type XpCurve,
} from '@terrago/shared';
import balanceJson from '../data/balance.json';
import classesJson from '../data/classes.json';
import itemsJson from '../data/items.json';
import greenhavenJson from '../data/maps/greenhaven.json';
import sunfieldJson from '../data/maps/sunfield_plains.json';
import npcsJson from '../data/npcs.json';

/**
 * Structured game data. Everything balance-related is loaded from JSON in
 * ../data so designers can tune values without touching game logic.
 */

export interface ClassDef extends ClassProfile {
  id: ClassId;
  name: string;
  summary: string;
  weapons: string[];
}

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  mapId: string;
  x: number;
  y: number;
  dir: Direction;
  appearance: Appearance;
  accessory?: NpcAccessory;
  firstMeeting?: { lines: string[]; rewards?: { itemId: string; quantity: number }[] };
  greetings: string[][];
}

export interface Balance {
  xpCurve: XpCurve;
  energy: EnergyConfig & { startingEnergy: number };
  character: {
    startingGold: number;
    startingMap: string;
    inventoryCapacity: number;
    starterItems: { itemId: string; quantity: number }[];
  };
  persistence: { positionSaveIntervalMs: number };
}

export const ITEMS: readonly ItemDef[] = itemsJson as ItemDef[];
export const CLASSES: readonly ClassDef[] = classesJson as ClassDef[];
export const NPCS: readonly NpcDef[] = npcsJson as NpcDef[];
export const BALANCE: Balance = balanceJson as Balance;
export const MAPS: Readonly<Record<string, MapDef>> = {
  greenhaven: greenhavenJson as MapDef,
  sunfield_plains: sunfieldJson as MapDef,
};

const itemIndex = new Map(ITEMS.map((i) => [i.id, i]));
const classIndex = new Map(CLASSES.map((c) => [c.id, c]));

export function getItem(id: string): ItemDef | undefined {
  return itemIndex.get(id);
}

export function getClass(id: ClassId): ClassDef {
  const c = classIndex.get(id);
  if (!c) throw new Error(`Unknown class ${id}`);
  return c;
}

export function getMap(id: string): MapDef | undefined {
  return MAPS[id];
}

export function npcsForMap(mapId: string): NpcDef[] {
  return NPCS.filter((n) => n.mapId === mapId);
}

export function toNpcPublic(n: NpcDef): NpcPublic {
  return {
    id: n.id,
    name: n.name,
    title: n.title,
    x: n.x,
    y: n.y,
    dir: n.dir,
    appearance: n.appearance,
    ...(n.accessory ? { accessory: n.accessory } : {}),
  };
}

/** Cross-checks references between data files. Run in tests and at server start. */
export function validateGameData(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const i of ITEMS) {
    if (seen.has(i.id)) errors.push(`duplicate item ${i.id}`);
    seen.add(i.id);
    if (i.maxDurability !== null && i.stackSize !== 1) errors.push(`item ${i.id} has durability but stacks`);
    if (i.stackSize < 1) errors.push(`item ${i.id} has invalid stack size`);
  }
  for (const id of CLASS_IDS) if (!classIndex.has(id)) errors.push(`missing class ${id}`);
  for (const s of BALANCE.character.starterItems) if (!itemIndex.has(s.itemId)) errors.push(`starter item ${s.itemId} unknown`);
  if (!MAPS[BALANCE.character.startingMap]) errors.push(`starting map ${BALANCE.character.startingMap} unknown`);
  for (const map of Object.values(MAPS)) {
    errors.push(...validateMapDef(map));
    for (const p of map.portals) if (!MAPS[p.to]) errors.push(`portal ${p.id} targets unknown map ${p.to}`);
  }
  for (const n of NPCS) {
    const map = MAPS[n.mapId];
    if (!map) errors.push(`npc ${n.id} on unknown map ${n.mapId}`);
    for (const r of n.firstMeeting?.rewards ?? []) if (!itemIndex.has(r.itemId)) errors.push(`npc ${n.id} reward ${r.itemId} unknown`);
    if (n.greetings.length === 0) errors.push(`npc ${n.id} has no greetings`);
  }
  return errors;
}
