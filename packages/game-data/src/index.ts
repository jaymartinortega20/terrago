import {
  CLASS_IDS,
  buildCollisionGrid,
  validateMapDef,
  type CropDef,
  type AchievementDef,
  type AnimalDef,
  type DailyTaskDef,
  type FishDef,
  type MonsterDef,
  type QuestDef,
  type SkillDef,
  type BaseStats,
  type NodeDef,
  type RecipeDef,
  type StationType,
  type TimeOfDay,
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
  type JobId,
  type JobPassive,
  type ResourceKind,
} from '@terrago/shared';
import balanceJson from '../data/balance.json';
import classesJson from '../data/classes.json';
import itemsJson from '../data/items.json';
import cropsJson from '../data/crops.json';
import fishJson from '../data/fish.json';
import monstersJson from '../data/monsters.json';
import skillsJson from '../data/skills.json';
import questsJson from '../data/quests.json';
import nodesJson from '../data/nodes.json';
import recipesJson from '../data/recipes.json';
import crystalLakeJson from '../data/maps/crystal_lake.json';
import irondeepEntranceJson from '../data/maps/irondeep_entrance.json';
import whisperwoodJson from '../data/maps/whisperwood.json';
import frostpineJson from '../data/maps/frostpine_peaks.json';
import mirefenJson from '../data/maps/mirefen_swamp.json';
import dusthavenJson from '../data/maps/dusthaven_desert.json';
import emberRidgeJson from '../data/maps/ember_ridge.json';
import ruinsJson from '../data/maps/ancient_ruins.json';
import dragonspireJson from '../data/maps/dragonspire.json';
import dungeonsJson from '../data/dungeons.json';
import achievementsJson from '../data/achievements.json';
import animalsJson from '../data/animals.json';
import dailiesJson from '../data/dailies.json';
import { DUNGEON_PREFIX, MINE_FLOORS, generateDungeon, generateMineFloor, mineFloorNumber, type DungeonDef } from './mapgen';

export * from './mapgen';
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
  /** Stats gained per level (zero now: players spend stat points instead). */
  growth: BaseStats;
  starterWeapon: string;
  resource: ResourceKind;
  /** Second jobs available at level 40. */
  jobs: JobDef[];
}

export interface JobDef {
  id: JobId;
  name: string;
  summary: string;
  passive: JobPassive;
  /** A companion that comes with the job (Beastmaster's hawk). */
  companion?: string;
}

/** The job definition (and its class) for a job id. */
export function getJob(id: string | null | undefined): (JobDef & { classId: ClassId }) | undefined {
  if (!id) return undefined;
  for (const c of CLASSES) {
    const j = c.jobs.find((x) => x.id === id);
    if (j) return { ...j, classId: c.id };
  }
  return undefined;
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
  /** Marketplace economics: fees and tax are gold sinks. */
  market: { listingFeeRate: number; listingFeeMin: number; taxRate: number; durationHours: number; maxListings: number; maxPrice: number };
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
export const NODES: readonly NodeDef[] = nodesJson as NodeDef[];
export const FISH: readonly FishDef[] = fishJson as FishDef[];
export const RECIPES: readonly RecipeDef[] = recipesJson as RecipeDef[];
export const MONSTERS: readonly MonsterDef[] = monstersJson as MonsterDef[];
export const SKILLS: readonly SkillDef[] = skillsJson as SkillDef[];
export const QUESTS: readonly QuestDef[] = questsJson as QuestDef[];

export const ANIMALS: readonly AnimalDef[] = animalsJson as AnimalDef[];
export const getAnimal = (id: string) => ANIMALS.find((a) => a.id === id);
export const animalForItem = (itemId: string) => ANIMALS.find((a) => a.item === itemId);
export const ACHIEVEMENTS: readonly AchievementDef[] = achievementsJson as AchievementDef[];
export const DAILY_TASKS: readonly DailyTaskDef[] = dailiesJson as DailyTaskDef[];

export const DUNGEONS: readonly DungeonDef[] = dungeonsJson as DungeonDef[];

export function getDungeon(id: string): DungeonDef | undefined {
  return DUNGEONS.find((d) => d.id === id);
}

export function getQuest(id: string): QuestDef | undefined {
  return QUESTS.find((q) => q.id === id);
}
/** Hand-laid maps (JSON). Procedural maps (mine floors) are generated by getMap(). */
export const MAPS: Readonly<Record<string, MapDef>> = {
  greenhaven: greenhavenJson as MapDef,
  sunfield_plains: sunfieldJson as MapDef,
  homestead: homesteadJson as MapDef,
  whisperwood: whisperwoodJson as MapDef,
  crystal_lake: crystalLakeJson as MapDef,
  irondeep_entrance: irondeepEntranceJson as MapDef,
  frostpine_peaks: frostpineJson as MapDef,
  mirefen_swamp: mirefenJson as MapDef,
  dusthaven_desert: dusthavenJson as MapDef,
  ember_ridge: emberRidgeJson as MapDef,
  ancient_ruins: ruinsJson as MapDef,
  dragonspire: dragonspireJson as MapDef,
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

const generated = new Map<string, MapDef>();

export function getMap(id: string): MapDef | undefined {
  const fixed = MAPS[id];
  if (fixed) return fixed;
  let g = generated.get(id);
  if (!g) {
    if (id.startsWith(DUNGEON_PREFIX)) {
      const d = getDungeon(id.slice(DUNGEON_PREFIX.length));
      if (!d) return undefined;
      g = generateDungeon(d);
    } else {
      const floor = mineFloorNumber(id);
      if (floor === null) return undefined;
      g = generateMineFloor(floor);
    }
    generated.set(id, g);
  }
  return g;
}

/** Every map id in the world, including procedural ones. */
export function allMapIds(): string[] {
  return [...Object.keys(MAPS), ...Array.from({ length: MINE_FLOORS }, (_, i) => `irondeep_${i + 1}`), ...DUNGEONS.map((d) => DUNGEON_PREFIX + d.id)];
}

const nodeIndex = new Map(NODES.map((n) => [n.id, n]));
const monsterIndex = new Map(MONSTERS.map((m) => [m.id, m]));
const skillIndex = new Map(SKILLS.map((k) => [k.id, k]));

export function getMonster(id: string): MonsterDef | undefined {
  return monsterIndex.get(id);
}

export function getSkillDef(id: string): SkillDef | undefined {
  return skillIndex.get(id);
}

export function skillsForClass(classId: ClassId): SkillDef[] {
  return SKILLS.filter((k) => k.classId === classId && !k.job).sort((a, b) => a.level - b.level);
}

/** Skills on a character's bar: the class skills, then their second job's skills. */
export function skillsFor(classId: ClassId, job?: string | null): SkillDef[] {
  return [...skillsForClass(classId), ...SKILLS.filter((k) => k.classId === classId && k.job && k.job === job).sort((a, b) => a.level - b.level)];
}

/** Every job skill for a job (for the job trainer's preview). */
export function skillsForJob(job: string): SkillDef[] {
  return SKILLS.filter((k) => k.job === job).sort((a, b) => a.level - b.level);
}

/** Keyboard keys for skill slots. */
export const SKILL_KEYS = ['Q', 'R', 'T', 'X', 'V', 'H'];

export function equipDef(itemId: string) {
  return itemIndex.get(itemId)?.equip;
}
const recipeIndex = new Map(RECIPES.map((r) => [r.id, r]));

export function getNode(id: string): NodeDef | undefined {
  return nodeIndex.get(id);
}

export function getRecipe(id: string): RecipeDef | undefined {
  return recipeIndex.get(id);
}

export function recipesFor(station: StationType): RecipeDef[] {
  return RECIPES.filter((r) => r.station === station);
}

/** Fish that can bite here, now, for this angler. */
export function fishFor(table: string, time: TimeOfDay): FishDef[] {
  return FISH.filter((f) => f.tables.includes(table) && (!f.time || f.time.includes(time)));
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
  for (const q of QUESTS) {
    if (q.requires && !QUESTS.some((x) => x.id === q.requires)) errors.push(`quest ${q.id} requires unknown ${q.requires}`);
    for (const n of [q.giver, q.turnIn]) if (!NPCS.some((x) => x.id === n)) errors.push(`quest ${q.id} uses unknown npc ${n}`);
    for (const st of q.steps) if (st.where && !getMap(st.where.map)) errors.push(`quest ${q.id} points to unknown map ${st.where.map}`);
    for (const st of q.steps) {
      if (st.type === 'talk' && !NPCS.some((n) => n.id === st.target)) errors.push(`quest ${q.id} talks to unknown ${st.target}`);
      if (st.type === 'kill' && !monsterIndex.has(st.target ?? '')) errors.push(`quest ${q.id} kills unknown ${st.target}`);
      if (['gather', 'craft', 'buy', 'harvest'].includes(st.type) && st.target && !itemIndex.has(st.target)) errors.push(`quest ${q.id} needs unknown item ${st.target}`);
      if (st.type === 'visit' && !getMap(st.target ?? '')) errors.push(`quest ${q.id} visits unknown map ${st.target}`);
    }
    for (const it of [...(q.rewards.items ?? []), ...Object.values(q.stepRewards ?? {}).flat()]) if (!itemIndex.has(it.itemId)) errors.push(`quest ${q.id} rewards unknown ${it.itemId}`);
  }
  for (const m of MONSTERS) for (const d of m.drops) if (!itemIndex.has(d.itemId)) errors.push(`monster ${m.id} drops unknown ${d.itemId}`);
  for (const c of CLASSES) if (itemIndex.get(c.starterWeapon)?.equip?.slot !== 'mainhand') errors.push(`class ${c.id} starter weapon ${c.starterWeapon} is not a weapon`);
  for (const i of ITEMS) if (i.equip && i.stackSize !== 1) errors.push(`equipment ${i.id} must not stack`);
  for (const id of allMapIds()) for (const sp of getMap(id)!.spawns ?? []) if (!monsterIndex.has(sp.monster)) errors.push(`${id} spawns unknown monster ${sp.monster}`);
  for (const n of NODES) {
    for (const d of n.drops) if (!itemIndex.has(d.itemId)) errors.push(`node ${n.id} drops unknown ${d.itemId}`);
  }
  for (const f of FISH) if (!itemIndex.has(f.itemId)) errors.push(`fish ${f.itemId} has no item`);
  for (const r of RECIPES) {
    for (const i of r.inputs) if (!itemIndex.has(i.itemId)) errors.push(`recipe ${r.id} needs unknown ${i.itemId}`);
    if (!itemIndex.has(r.output.itemId)) errors.push(`recipe ${r.id} makes unknown ${r.output.itemId}`);
    // Crafting must never create gold from nothing via NPC resale.
    const inValue = r.inputs.reduce((n, i) => n + (itemIndex.get(i.itemId)?.vendorValue ?? 0) * i.quantity, 0);
    const outValue = (itemIndex.get(r.output.itemId)?.vendorValue ?? 0) * r.output.quantity;
    if (outValue > inValue * 3 + r.fee + 30) errors.push(`recipe ${r.id} output is worth far more than its inputs (${outValue} vs ${inValue})`);
  }
  for (const id of allMapIds()) {
    const map = getMap(id)!;
    const grid = buildCollisionGrid(map);
    for (const n of map.nodes ?? []) if (!nodeIndex.has(n.type)) errors.push(`${id} has unknown node ${n.type}`);
    for (const p of map.portals) {
      const target = getMap(p.to);
      if (!target) {
        errors.push(`portal ${id}/${p.id} targets unknown map ${p.to}`);
        continue;
      }
      const tgrid = buildCollisionGrid(target);
      if (tgrid.isSolidTile(p.toX, p.toY)) errors.push(`portal ${id}/${p.id} lands on a solid tile in ${p.to} (${p.toX},${p.toY})`);
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (grid.isSolidTile(x, y)) errors.push(`portal ${id}/${p.id} tile ${x},${y} is solid`);
    }
    if (grid.isSolidTile(map.spawn.x, map.spawn.y)) errors.push(`${id} spawn is solid`);
    // Every portal must be reachable on foot from the spawn point.
    const seen = new Uint8Array(map.width * map.height);
    const queue: [number, number][] = [[map.spawn.x, map.spawn.y]];
    while (queue.length) {
      const [x, y] = queue.pop()!;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height || seen[y * map.width + x] || grid.isSolidTile(x, y)) continue;
      seen[y * map.width + x] = 1;
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (const p of map.portals) {
      let ok = false;
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (seen[y * map.width + x]) ok = true;
      if (!ok) errors.push(`portal ${id}/${p.id} cannot be reached from the spawn`);
    }
  }
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

// ---------------------------------------------------------------------------
// Waystones (teleport pads) — found from the maps themselves
// ---------------------------------------------------------------------------

export interface Waystone {
  mapId: string;
  name: string;
  /** Arrival tile (centre of the pad). */
  x: number;
  y: number;
  fee: number;
}

const WAYSTONE_FEES: Record<string, number> = {
  greenhaven: 20,
  sunfield_plains: 15,
  crystal_lake: 30,
  whisperwood: 45,
  irondeep_entrance: 45,
  frostpine_peaks: 120,
  mirefen_swamp: 160,
  dusthaven_desert: 220,
  ember_ridge: 300,
  ancient_ruins: 400,
  dragonspire: 500,
};

let waystoneCache: Waystone[] | null = null;
export function waystones(): Waystone[] {
  if (waystoneCache) return waystoneCache;
  waystoneCache = [];
  for (const m of Object.values(MAPS)) {
    const pad = m.objects.find((o) => o.kind === 'prop' && o.type === 'teleport_pad');
    if (pad) waystoneCache.push({ mapId: m.id, name: m.name, x: pad.x + 1, y: pad.y + 1, fee: WAYSTONE_FEES[m.id] ?? 50 });
  }
  return waystoneCache;
}
