import {
  CLASS_IDS,
  buildCollisionGrid,
  validateMapDef,
  type CropDef,
  type DialogueActionId,
  type ItemCategory,
  type ShopEntry,
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
import cropsJson from '../data/crops.json';
import shopsJson from '../data/shops.json';
import greenhavenJson from '../data/maps/greenhaven.json';
import homesteadJson from '../data/maps/homestead.json';
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
  services?: DialogueActionId[];
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
  skillCurve: XpCurve;
  farming: {
    homesteadMap: string;
    waterMs: number;
    actionCooldownMs: number;
    /** Energy per action; arrays are indexed by tool tier. */
    energy: { till: number[]; water: number[]; plant: number; harvest: number; fertilize: number };
    characterXpShare: number;
    /** Vendor price multiplier per quality tier. */
    qualityValue: number[];
    tiers: FarmTier[];
  };
}

export interface FarmTier {
  tier: number;
  plots: number;
  gold?: number;
  farmingLevel?: number;
  materials?: { itemId: string; quantity: number }[];
}

export interface ShopDef {
  npcId: string;
  name: string;
  sells: ShopEntry[];
  buys: ItemCategory[];
}

export const ITEMS: readonly ItemDef[] = itemsJson as ItemDef[];
export const CLASSES: readonly ClassDef[] = classesJson as ClassDef[];
export const NPCS: readonly NpcDef[] = npcsJson as NpcDef[];
export const BALANCE: Balance = balanceJson as Balance;
export const CROPS: readonly CropDef[] = cropsJson as CropDef[];
export const SHOPS: readonly ShopDef[] = shopsJson as ShopDef[];
export const MAPS: Readonly<Record<string, MapDef>> = {
  greenhaven: greenhavenJson as MapDef,
  sunfield_plains: sunfieldJson as MapDef,
  homestead: homesteadJson as MapDef,
};

const itemIndex = new Map(ITEMS.map((i) => [i.id, i]));
const classIndex = new Map(CLASSES.map((c) => [c.id, c]));
const cropIndex = new Map(CROPS.map((c) => [c.id, c]));
const cropBySeed = new Map(CROPS.map((c) => [c.seedItem, c]));
const shopIndex = new Map(SHOPS.map((s) => [s.npcId, s]));

export function getCrop(id: string): CropDef | undefined {
  return cropIndex.get(id);
}

export function cropForSeed(itemId: string): CropDef | undefined {
  return cropBySeed.get(itemId);
}

export function getShop(npcId: string): ShopDef | undefined {
  return shopIndex.get(npcId);
}

/** Farm tier info (tier 1 = starter). */
export function farmTier(tier: number): FarmTier {
  const t = BALANCE.farming.tiers.find((x) => x.tier === tier);
  if (!t) throw new Error(`Unknown farm tier ${tier}`);
  return t;
}

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
  for (const c of CROPS) {
    if (!itemIndex.has(c.seedItem)) errors.push(`crop ${c.id} seed ${c.seedItem} unknown`);
    if (!itemIndex.has(c.produceItem)) errors.push(`crop ${c.id} produce ${c.produceItem} unknown`);
    if (c.quality.length !== 5 || Math.abs(c.quality.reduce((a, b) => a + b, 0) - 1) > 1e-6) errors.push(`crop ${c.id} quality must have 5 values summing to 1`);
  }
  for (const sh of SHOPS) {
    if (!NPCS.some((n) => n.id === sh.npcId)) errors.push(`shop for unknown npc ${sh.npcId}`);
    for (const e of sh.sells) {
      if (!itemIndex.has(e.itemId)) errors.push(`shop ${sh.npcId} sells unknown ${e.itemId}`);
      if (!(e.price > 0)) errors.push(`shop ${sh.npcId} price for ${e.itemId} must be positive`);
      const def = itemIndex.get(e.itemId);
      if (def && def.vendorValue >= e.price) errors.push(`shop ${sh.npcId} buys ${e.itemId} back for >= its price (gold exploit)`);
    }
  }
  for (const t of BALANCE.farming.tiers) for (const m of t.materials ?? []) if (!itemIndex.has(m.itemId)) errors.push(`farm tier ${t.tier} material ${m.itemId} unknown`);
  for (const i of ITEMS) if (i.fertilizer && !(i.fertilizer.speed >= 1)) errors.push(`fertilizer ${i.id} speed must be >= 1`);
  for (const map of Object.values(MAPS)) {
    if (!map.farmPlots) continue;
    const grid = buildCollisionGrid(map);
    const maxPlots = Math.max(...BALANCE.farming.tiers.map((t) => t.plots));
    if (map.farmPlots.length < maxPlots) errors.push(`${map.id} has ${map.farmPlots.length} plots, tiers need ${maxPlots}`);
    for (const [x, y] of map.farmPlots) if (grid.isSolidTile(x, y)) errors.push(`${map.id} plot ${x},${y} is blocked`);
  }
  for (const n of NPCS) {
    const map = MAPS[n.mapId];
    if (!map) errors.push(`npc ${n.id} on unknown map ${n.mapId}`);
    for (const r of n.firstMeeting?.rewards ?? []) if (!itemIndex.has(r.itemId)) errors.push(`npc ${n.id} reward ${r.itemId} unknown`);
    if (n.greetings.length === 0) errors.push(`npc ${n.id} has no greetings`);
  }
  return errors;
}
