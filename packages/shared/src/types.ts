import type { DIRECTIONS } from './constants';
import type { CropState } from './farming';
import type { SkillSet } from './skills';
import type { NodeObject } from './gathering';

export type Direction = (typeof DIRECTIONS)[number];

export const CLASS_IDS = ['warrior', 'ranger', 'mage', 'priest', 'rogue'] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Crop / item quality. Stored as a small integer index into this list. */
export const QUALITIES = ['normal', 'silver', 'gold', 'diamond', 'legendary'] as const;
export type Quality = (typeof QUALITIES)[number];

export interface Appearance {
  bodyType: 'a' | 'b';
  skinTone: number;
  hairStyle: number;
  hairColor: number;
  eyeColor: number;
  outfit: number;
}

export interface BaseStats {
  strength: number;
  agility: number;
  intelligence: number;
  vitality: number;
  luck: number;
}

export interface DerivedStats {
  physicalAttack: number;
  magicAttack: number;
  physicalDefense: number;
  magicDefense: number;
  accuracy: number;
  evasion: number;
  criticalChance: number;
  criticalDamage: number;
  movementSpeed: number;
  attackSpeed: number;
  gatheringEfficiency: number;
}

export interface CharacterSummary {
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  mapId: string;
  appearance: Appearance;
  createdAt: string;
  lastPlayedAt: string | null;
}

/** Everything the owning player sees about their own character. */
export interface SelfState {
  characterId: string;
  name: string;
  classId: ClassId;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  energy: number;
  maxEnergy: number;
  stats: BaseStats;
  derived: DerivedStats;
  appearance: Appearance;
  skills: SkillSet;
}

/** A farm plot in a homestead. Crop growth is computed from timestamps on both sides. */
export interface PlotObject {
  kind: 'plot';
  id: string;
  /** Tile position. */
  x: number;
  y: number;
  index: number;
  locked: boolean;
  tilled: boolean;
  wetUntil: number;
  crop: CropState | null;
}

/** Interactive things placed in a map at runtime: farm plots, resource nodes (and later drops). */
export type WorldObject = PlotObject | NodeObject;

/** What other players can see about a player entity. */
export interface PublicPlayer {
  id: string;
  name: string;
  level: number;
  classId: ClassId;
  appearance: Appearance;
  x: number;
  y: number;
  dir: Direction;
}

export type ItemCategory =
  | 'tool'
  | 'weapon'
  | 'armor'
  | 'material'
  | 'crop'
  | 'seed'
  | 'fish'
  | 'consumable'
  | 'quest'
  | 'cosmetic';

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  /** Key into the client icon atlas. */
  icon: string;
  category: ItemCategory;
  rarity: Rarity;
  stackSize: number;
  vendorValue: number;
  levelRequirement: number;
  tradable: boolean;
  bind: 'none' | 'pickup' | 'equip';
  /** Max durability for tools/equipment; null for items without durability. */
  maxDurability: number | null;
  consumable?: { energy?: number; hp?: number; mp?: number };
  /** Gathering/farming tools. Higher tiers cost less Energy and reach harder nodes. */
  tool?: { kind: ToolKind; tier: number };
  /** Mixed into a planted plot: quality bonus and growth speed multiplier. */
  fertilizer?: { quality: number; speed: number };
}

export type ToolKind = 'hoe' | 'can' | 'pickaxe' | 'axe' | 'rod' | 'sickle';

export interface InventorySlot {
  slot: number;
  itemId: string;
  quantity: number;
  /** Index into QUALITIES. */
  quality: number;
  durability: number | null;
  bound: boolean;
}

export interface InventoryState {
  capacity: number;
  gold: number;
  slots: InventorySlot[];
}

export interface NpcPublic {
  id: string;
  name: string;
  title: string;
  x: number;
  y: number;
  dir: Direction;
  appearance: Appearance;
  accessory?: NpcAccessory;
}

export type NpcAccessory = 'apron' | 'hat' | 'crown' | 'hood' | 'helmet' | 'bandana' | 'cape';

export type ChatChannel = 'local' | 'system';

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  fromId: string | null;
  fromName: string;
  text: string;
  ts: number;
}

export interface DialogueResult {
  npcId: string;
  name: string;
  title: string;
  lines: string[];
  /** Items or gold granted by this conversation (already applied server-side). */
  rewards?: { itemId: string; quantity: number }[];
  /** Services this NPC offers (shop, farm upgrades...). */
  actions?: DialogueAction[];
}

export type DialogueActionId = 'shop' | 'farm_upgrade' | 'repair' | 'lift';

export interface DialogueAction {
  id: DialogueActionId;
  label: string;
}

export interface ShopEntry {
  itemId: string;
  price: number;
  /** Farming/other level needed to buy (e.g. advanced seeds). */
  requires?: { skill: string; level: number };
}

export interface ShopView {
  npcId: string;
  name: string;
  sells: ShopEntry[];
  /** Item categories this shop buys from players. */
  buys: ItemCategory[];
}

export interface FarmUpgradeView {
  tier: number;
  plots: number;
  next: null | {
    tier: number;
    plots: number;
    gold: number;
    farmingLevel: number;
    materials: { itemId: string; quantity: number }[];
  };
}
