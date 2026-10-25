import type { DIRECTIONS } from './constants';
import type { CropState } from './farming';
import type { SkillSet } from './skills';
import type { NodeObject } from './gathering';
import type { EquipDef } from './combat';

export type Direction = (typeof DIRECTIONS)[number];

export const CLASS_IDS = ['warrior', 'mage', 'archer', 'acolyte'] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/** What a class spends on skills: Mana regenerates, Rage builds in combat, Energy refills fast. */
export type ResourceKind = 'mana' | 'rage' | 'energy';

/** Second jobs, chosen at level 40. */
export const JOB_IDS = ['paladin', 'berserker', 'sorcerer', 'necromancer', 'ranger', 'beastmaster', 'high_priest', 'inquisitor'] as const;
export type JobId = (typeof JOB_IDS)[number];
export const JOB_LEVEL = 40;
/** Stat points earned per level (spent by the player: RO-style). */
export const STAT_POINTS_PER_LEVEL = 5;

/** Passive bonuses a job grants (percent, or flat crit chance). */
export interface JobPassive {
  hpPct?: number;
  mpPct?: number;
  atkPct?: number;
  matkPct?: number;
  defPct?: number;
  critAdd?: number;
  regenPct?: number;
  healPct?: number;
}

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
  job?: JobId | null;
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
  /** Profession specializations: skill -> spec id. */
  specs?: Record<string, string>;
  /** Active pet item id. */
  pet?: string | null;
  /** Second job (from level 40). */
  job?: JobId | null;
  /** Unspent stat points. */
  statPoints?: number;
  /** Getting on a mount: done at this time (ms since epoch), or null. */
  mountChannelUntil?: number | null;
  /** Slowed after being knocked off a mount, until (ms since epoch). */
  slowUntil?: number;
  /** Saddle, barding and trail on your mounts. */
  mountLook?: import('./companions').MountLook;
  /** Bag weight and how much you can carry. */
  load?: number;
  carry?: number;
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
  /** Rolled gear stats (loot that didn't fit in the bag). */
  affixes?: ItemAffix[] | null;
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
  /** Rare tougher variant with better loot. */
  elite?: boolean;
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
  /** Name of the player's open stall, if any. */
  shop?: string | null;
  /** Active pet (item id). */
  pet?: string | null;
  /** Sitting down (from the sit emote). */
  pose?: 'sit' | null;
  /** Second job, shown under the name. */
  job?: JobId | null;
  /** Upgrade level of the weapon and best armor piece (for the glow), and the back item (wings). */
  weaponGlow?: number;
  armorGlow?: number;
  back?: string | null;
  /** Saddle, barding and trail on the mount. */
  mountLook?: import('./companions').MountLook | null;
}

/** Emotes players can do (chat /wave, or the emote menu). */
export const EMOTES = ['wave', 'laugh', 'heart', 'cheer', 'angry', 'cry', 'dance', 'bow', 'zzz', 'sit'] as const;
export type EmoteId = (typeof EMOTES)[number];

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
  | 'mount'
  | 'animal';

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
  /** Companion pet: look and small perk. */
  pet?: { kind: string; color: string; perk: 'gold' | 'fish' | 'xp' | 'regen' | 'dragon' };
  /** Rideable: speed multiplier and look. */
  mount?: { speed: number; color: string; kind: 'horse' | 'stag' | 'wolf' | 'wyvern' | 'boar' | 'hovergear'; perk?: import('./companions').MountPerkId; glow?: string };
  /** Carry weight per item (defaults by category). */
  weight?: number;
  /** Bag Expansion: slots it adds. */
  bagSlots?: number;
  /** Food for pets: EXP and loyalty. */
  petFood?: { xp: number; loyalty: number };
  /** Used from the bag: unlock an exclusive skin (by outfit name) or open a cache. */
  unlock?: { skin?: string; cache?: 'infernal' };
  /** Wings (back slot): their look. */
  wings?: { style: 'fairy' | 'angel' | 'demon' | 'dragon'; color: string };
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
  /** Random bonus stats rolled on drop (gear). */
  affixes?: ItemAffix[] | null;
}

/** A random bonus stat on a piece of gear ("+4% Critical"). */
export interface ItemAffix {
  stat: string;
  value: number;
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

export type DialogueActionId = 'shop' | 'farm_upgrade' | 'repair' | 'lift' | 'quest_offer' | 'quest_complete' | 'bank' | 'job' | 'enhance';

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
  affixes?: ItemAffix[] | null;
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
  affixes?: ItemAffix[] | null;
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

// ---------------------------------------------------------------------------
// Progress: achievements, dailies, leaderboards
// ---------------------------------------------------------------------------

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Counter it watches (kills, harvests, level...). */
  stat: string;
  goal: number;
  reward: { gold: number };
  icon: string;
}

export interface DailyTaskDef {
  id: string;
  text: string;
  /** Event that advances it: kill, harvest, fish, gather, craft, boss. */
  event: string;
  target?: string;
  count: number;
  minLevel: number;
}

/** Daily login rewards for streak days 1..7 (then it loops). */
export const LOGIN_REWARDS: { gold: number; items?: { itemId: string; quantity: number }[] }[] = [
  { gold: 50 },
  { gold: 80, items: [{ itemId: 'minor_health_potion', quantity: 2 }] },
  { gold: 120 },
  { gold: 150, items: [{ itemId: 'minor_health_potion', quantity: 3 }] },
  { gold: 200, items: [{ itemId: 'enhancement_stone', quantity: 1 }] },
  { gold: 250 },
  { gold: 500, items: [{ itemId: 'enhancement_stone', quantity: 2 }] },
];

/** Daily task rewards scale with level. */
export function dailyTaskReward(level: number): { gold: number; xp: number } {
  return { gold: 30 + level * 8, xp: 60 + level * 25 };
}

export interface JournalView {
  login: { streak: number; claimedToday: boolean; day: number };
  tasks: { id: string; text: string; progress: number; count: number; claimed: boolean }[];
  achievements: { id: string; name: string; description: string; icon: string; goal: number; progress: number; unlockedAt: number | null; gold: number }[];
  resetsAt: number;
}

export const LEADERBOARDS = ['level', 'wealth', 'achievements', 'boss_kills', 'farming', 'fishing', 'mining', 'woodcutting'] as const;
export type LeaderboardId = (typeof LEADERBOARDS)[number];

export interface LeaderboardRow {
  rank: number;
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  value: number;
  guild: string | null;
}

// ---------------------------------------------------------------------------
// Bank, waystones, player stalls
// ---------------------------------------------------------------------------

export interface BankViewState {
  capacity: number;
  tier: number;
  next: { capacity: number; cost: number } | null;
  slots: InventorySlot[];
}

export interface TravelOption {
  mapId: string;
  name: string;
  fee: number;
  known: boolean;
  here: boolean;
}

export interface StallItem {
  slot: number;
  itemId: string;
  quantity: number;
  quality: number;
  enhance: number;
  affixes?: ItemAffix[] | null;
  price: number;
}

export interface StallView {
  sellerId: string;
  sellerName: string;
  name: string;
  items: StallItem[];
}

// ---------------------------------------------------------------------------
// Farm animals
// ---------------------------------------------------------------------------

export interface AnimalDef {
  id: string;
  name: string;
  /** Item you buy and release into your pen. */
  item: string;
  product: string;
  /** One product per this much fed time. */
  everyMs: number;
  level: number;
}

/** Products wait in the pen up to this many per animal. */
export const ANIMAL_PRODUCT_CAP = 3;
/** One portion of feed keeps an animal fed this long. */
export const ANIMAL_FEED_MS = 24 * 60 * 60_000;

/** Animals allowed by farm tier (1..5). */
export const PEN_CAPACITY = [0, 2, 4, 6, 8, 10];

export interface AnimalState {
  id: number;
  kind: string;
  fedUntil: number;
  collectedAt: number;
  /** Products ready to collect now. */
  ready: number;
}

/** How many products an animal has made since its last collection (only fed time counts). */
export function animalReady(a: { fedUntil: number; collectedAt: number }, def: AnimalDef, now: number): number {
  const fedTime = Math.max(0, Math.min(now, a.fedUntil) - a.collectedAt);
  return Math.min(ANIMAL_PRODUCT_CAP, Math.floor(fedTime / def.everyMs));
}
