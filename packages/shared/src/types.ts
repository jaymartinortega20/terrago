import type { DIRECTIONS } from './constants';
import type { CropState } from './farming';
import type { SkillSet } from './skills';
import type { NodeObject } from './gathering';
import type { EquipDef } from './combat';

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
  /** Item id of the mount being ridden, and its speed multiplier (1 = on foot). */
  mount: string | null;
  speed: number;
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

/** Loot that didn't fit in a bag: only its owner can pick it up, and it fades after a while. */
export interface DropObject {
  kind: 'drop';
  id: string;
  x: number;
  y: number;
  itemId: string;
  quantity: number;
  quality: number;
  ownerId: string;
  until: number;
}

/** Interactive things placed in a map at runtime: farm plots, resource nodes, loot drops. */
export type WorldObject = PlotObject | NodeObject | DropObject;

/** What players see about a monster. */
export interface PublicMonster {
  kind: 'monster';
  id: string;
  monsterId: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  dir: Direction;
  boss?: boolean;
}

/** What other players can see about a player entity. */
export interface PublicPlayer {
  kind?: 'player';
  id: string;
  name: string;
  level: number;
  classId: ClassId;
  appearance: Appearance;
  x: number;
  y: number;
  dir: Direction;
  mount?: string | null;
  weapon?: string | null;
  /** Guild tag shown under the name. */
  guild?: string | null;
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
  | 'cosmetic'
  | 'mount';

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
  /** Wearable: slot and stat bonuses. */
  equip?: EquipDef;
  /** Rideable: speed multiplier and look. */
  mount?: { speed: number; color: string; kind: 'horse' | 'stag' | 'wolf' };
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
  /** Enhancement level (+0..+10) for equipment. */
  enhance?: number;
}

export interface InventoryState {
  capacity: number;
  gold: number;
  slots: InventorySlot[];
  /** Worn items; `slot` is an index into EQUIP_SLOTS. Omitted in updates that don't change them. */
  equipment?: InventorySlot[];
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

export type ChatChannel = 'local' | 'system' | 'global' | 'party' | 'guild' | 'whisper';

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  fromId: string | null;
  fromName: string;
  text: string;
  ts: number;
  /** Whispers: who it was sent to (shown as "To X"). */
  toName?: string;
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

export type DialogueActionId = 'shop' | 'farm_upgrade' | 'repair' | 'lift' | 'quest_offer' | 'quest_complete';

export interface DialogueAction {
  id: DialogueActionId;
  label: string;
  questId?: string;
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

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export type QuestStepType = 'talk' | 'kill' | 'gather' | 'harvest' | 'craft' | 'fish' | 'visit' | 'buy' | 'mount';

export interface QuestStep {
  text: string;
  type: QuestStepType;
  target?: string;
  count: number;
  /** Where to go: shown by the guide arrow. */
  where?: { map: string; x: number; y: number };
}

export interface QuestDef {
  id: string;
  name: string;
  description: string;
  /** Who offers the quest, and who you report back to. */
  giver: string;
  turnIn: string;
  /** Quest that must be finished first. */
  requires?: string;
  intro: string[];
  outro: string[];
  steps: QuestStep[];
  rewards: { gold?: number; xp?: number; items?: { itemId: string; quantity: number }[] };
  /** Extra items handed out when a step completes (e.g. the pony). */
  stepRewards?: Record<string, { itemId: string; quantity: number }[]>;
}

export interface QuestState {
  id: string;
  step: number;
  count: number;
  done: boolean;
}

/** All steps finished, waiting to be turned in. */
export function questReady(q: QuestState, def: QuestDef): boolean {
  return !q.done && q.step >= def.steps.length;
}

/** Quests the character can pick up now (prerequisites done, not started). */
export function questsAvailable(all: readonly QuestDef[], states: QuestState[]): QuestDef[] {
  const done = new Set(states.filter((s) => s.done).map((s) => s.id));
  const started = new Set(states.map((s) => s.id));
  return all.filter((q) => !started.has(q.id) && (!q.requires || done.has(q.requires)));
}

// ---------------------------------------------------------------------------
// Marketplace and trading
// ---------------------------------------------------------------------------

export interface MarketListing {
  id: number;
  sellerName: string;
  itemId: string;
  quantity: number;
  quality: number;
  enhance: number;
  durability: number | null;
  unitPrice: number;
  category: string;
  rarity: string;
  createdAt: number;
  expiresAt: number;
  /** For "my listings": active, sold, cancelled, returned. */
  status?: string;
  mine?: boolean;
}

export interface MarketQuery {
  search?: string;
  category?: string;
  rarity?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest';
  page?: number;
}

export interface TradeOfferItem {
  slot: number;
  itemId: string;
  quantity: number;
  quality: number;
  enhance: number;
}

export interface TradeSide {
  items: TradeOfferItem[];
  gold: number;
  locked: boolean;
  confirmed: boolean;
}

export interface TradeView {
  partner: { id: string; name: string };
  mine: TradeSide;
  theirs: TradeSide;
}

// ---------------------------------------------------------------------------
// Social: party, friends, guilds, profiles
// ---------------------------------------------------------------------------

export const PARTY_MAX = 5;

export interface PartyMember {
  id: string;
  name: string;
  level: number;
  classId: ClassId;
  hp: number;
  maxHp: number;
  mapId: string;
  online: boolean;
}

export interface PartyView {
  leaderId: string;
  members: PartyMember[];
}

export interface FriendEntry {
  id: string;
  name: string;
  level: number;
  classId: ClassId;
  online: boolean;
  mapId: string | null;
}

export interface FriendsView {
  friends: FriendEntry[];
  /** Players you muted or blocked. */
  blocked: { id: string; name: string; kind: 'mute' | 'block' }[];
}

export type GuildRank = 'leader' | 'officer' | 'member';

export interface GuildMemberView {
  id: string;
  name: string;
  level: number;
  classId: ClassId;
  rank: GuildRank;
  online: boolean;
}

export interface GuildView {
  id: number;
  name: string;
  tag: string;
  motd: string;
  treasury: number;
  myRank: GuildRank;
  members: GuildMemberView[];
}

export interface PlayerProfile {
  id: string;
  name: string;
  level: number;
  classId: ClassId;
  guild: string | null;
  online: boolean;
  mapId: string | null;
  createdAt: number;
  equipment: string[];
  friend: boolean;
  blocked: 'mute' | 'block' | null;
}

export type InviteKind = 'party' | 'friend' | 'guild';

export interface InvitePayload {
  kind: InviteKind;
  fromId: string;
  fromName: string;
  /** Guild name for guild invites. */
  detail?: string;
}
