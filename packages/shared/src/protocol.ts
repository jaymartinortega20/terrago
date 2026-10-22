import type {
  ChatMessage,
  DialogueResult,
  Direction,
  FarmUpgradeView,
  InventoryState,
  NpcPublic,
  PublicMonster,
  PublicPlayer,
  QuestState,
  MarketListing,
  MarketQuery,
  TradeView,
  InvitePayload,
  InviteKind,
  PartyView,
  FriendsView,
  GuildView,
  GuildRank,
  PlayerProfile,
  BankViewState,
  AnimalState,
  TravelOption,
  StallView,
  JournalView,
  LeaderboardId,
  LeaderboardRow,
  SelfState,
  ShopView,
  WorldObject,
} from './types';
import type { DifficultyId } from './combat';

/**
 * Socket protocol between the TerraGo client and the authoritative game server.
 * Typed for Socket.IO's `Server<ClientToServer, ServerToClient>` generics so
 * both sides fail to compile if they drift apart.
 */

/** Responses to client requests use acknowledgement callbacks. */
export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T> = (res: AckResult<T>) => void;

/** Movement command: [sequence number, dx, dy]. Each command is one SIM.stepMs step. */
export type MoveCommand = [seq: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1];

/** Direction encoded as a small int in snapshots. */
export const DIR_CODE: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
export const CODE_DIR: Direction[] = ['down', 'left', 'right', 'up'];

/** Compact entity row in a snapshot: [id, x, y, dirCode, moving(0|1), hp% (0-100)]. */
export type SnapshotEntity = [id: string, x: number, y: number, dir: number, moving: 0 | 1, hp: number];

/** One combat event, for floating numbers and effects. */
export interface CombatEvent {
  /** Source entity id. */
  s: string;
  /** Target entity id. */
  t: string;
  /** Amount (damage, or healing for kind 'heal'). */
  a: number;
  k: 'hit' | 'crit' | 'miss' | 'heal' | 'dot' | 'death';
  /** Skill id, if any. */
  sk?: string;
}

export interface Snapshot {
  /** Server time (ms since epoch) when the snapshot was taken. */
  t: number;
  /** Last movement sequence number the server applied for this player. */
  ack: number;
  /** This player's authoritative position and facing. */
  x: number;
  y: number;
  dir: number;
  /** Other visible players. */
  e: SnapshotEntity[];
}

export interface MapInfo {
  id: string;
  name: string;
  safeZone: boolean;
  /** For instanced maps (homesteads): whose instance this is. */
  owner: { id: string; name: string } | null;
}

export interface EnterWorldPayload {
  protocol: number;
  serverTime: number;
  tickRate: number;
  snapshotRate: number;
  self: SelfState;
  map: MapInfo;
  position: { x: number; y: number; dir: Direction };
  npcs: NpcPublic[];
  inventory: InventoryState;
  /** Last movement sequence the server applied (for reconnects mid-session). */
  ack: number;
  /** Recent local chat so a reconnecting player has context. */
  recentChat: ChatMessage[];
  /** Interactive objects in this map (farm plots...). */
  objects: WorldObject[];
}

/** Use whatever is at a tile: till, plant, water, harvest... The server decides. */
export interface ActRequest {
  tx: number;
  ty: number;
  /** Preferred bag slot (selected hotbar item), e.g. which seed to plant. */
  slot?: number;
  /** Explicit secondary actions from the plot menu. */
  mode?: 'clear' | 'fertilize';
}

export interface ActResult {
  message: string | null;
  /** Set when a fishing line was cast: wait for 'fish:bite'. */
  fishing?: { id: string; x: number; y: number };
  /** Node / tile action feedback for effects: 'hit' (a swing), 'gathered' (items received). */
  effect?: 'hit' | 'gathered' | 'miss';
}

export interface FishingRound {
  id: string;
  seed: number;
  difficulty: number;
  zone: number;
  maxSteps: number;
}

export interface NoticePayload {
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface ServerToClientEvents {
  /** Sent when the character enters the world or changes map. */
  'world:enter': (payload: EnterWorldPayload) => void;
  /** Players that came into view. */
  'entity:add': (entities: (PublicPlayer | PublicMonster)[]) => void;
  'combat': (events: CombatEvent[]) => void;
  /** A boss is winding up an area attack: warn players (pixels, ms until impact). */
  'telegraph': (t: { id: string; x: number; y: number; r: number; ms: number; name: string }) => void;
  /** A visible player's look changed (mount, weapon). */
  'entity:update': (id: string, patch: { mount?: string | null; weapon?: string | null; guild?: string | null; shop?: string | null }) => void;
  'quests': (quests: QuestState[]) => void;
  'trade:invite': (from: { id: string; name: string }) => void;
  'invite': (invite: InvitePayload) => void;
  /** You unlocked an achievement. */
  'achievement': (a: { id: string; name: string; icon: string; gold: number }) => void;
  /** Server-wide announcement (admins). */
  'announce': (text: string) => void;
  'party': (party: PartyView | null) => void;
  'friends': (friends: FriendsView) => void;
  'guild': (guild: GuildView | null) => void;
  'trade:update': (view: TradeView | null) => void;
  /** Duel state: opponent id/name, or null when it ends. */
  'duel': (info: { with: { id: string; name: string } | null; until?: number }) => void;
  /** Your active buffs/debuffs and skill cooldowns (ends: ms since epoch). */
  'effects': (info: { effects: { id: string; name: string; until: number }[]; cooldowns: Record<string, number> }) => void;
  /** Players that left view (or the map). */
  'entity:remove': (ids: string[]) => void;
  'snap': (snapshot: Snapshot) => void;
  'chat': (message: ChatMessage) => void;
  'self:update': (self: Partial<SelfState>) => void;
  'inventory:update': (inventory: InventoryState) => void;
  'notice': (notice: NoticePayload) => void;
  /** Objects added or changed in the current map. */
  'objects:set': (objects: WorldObject[]) => void;
  'objects:remove': (ids: string[]) => void;
  /** A fish is nibbling: hook it now! */
  'fish:bite': (info: { id: string }) => void;
  /** The server is closing this session (logged in elsewhere, banned, shutdown...). */
  'session:end': (info: { reason: string }) => void;
}

export interface ClientToServerEvents {
  'move': (cmd: MoveCommand) => void;
  'chat:send': (text: string, ack: Ack<{ id: string }>) => void;
  'npc:interact': (npcId: string, ack: Ack<DialogueResult>) => void;
  'inventory:get': (ack: Ack<InventoryState>) => void;
  'inventory:move': (req: { from: number; to: number }, ack: Ack<InventoryState>) => void;
  'inventory:use': (req: { slot: number }, ack: Ack<{ inventory: InventoryState; message: string }>) => void;
  'portal:use': (portalId: string, ack: Ack<{ mapId: string }>) => void;
  'act': (req: ActRequest, ack: Ack<ActResult>) => void;
  'shop:get': (npcId: string, ack: Ack<ShopView>) => void;
  'shop:buy': (req: { npcId: string; itemId: string; quantity: number }, ack: Ack<{ message: string }>) => void;
  'shop:sell': (req: { npcId: string; slot: number; quantity: number }, ack: Ack<{ message: string }>) => void;
  'farm:info': (npcId: string, ack: Ack<FarmUpgradeView>) => void;
  'farm:upgrade': (npcId: string, ack: Ack<{ message: string }>) => void;
  'repair:quote': (npcId: string, ack: Ack<{ cost: number; items: number }>) => void;
  'repair:all': (npcId: string, ack: Ack<{ message: string }>) => void;
  'fish:hook': (id: string, ack: Ack<FishingRound>) => void;
  'fish:reel': (req: { id: string; toggles: number[]; steps: number }, ack: Ack<{ caught: boolean; message: string }>) => void;
  'fish:cancel': () => void;
  'craft': (req: { recipeId: string; times: number }, ack: Ack<{ message: string }>) => void;
  'attack': (targetId: string, ack: Ack<{ cooldownMs: number }>) => void;
  'skill': (req: { skillId: string; targetId: string | null }, ack: Ack<{ cooldownMs: number }>) => void;
  'equip': (req: { from: number }, ack: Ack<null>) => void;
  'unequip': (req: { slot: number }, ack: Ack<null>) => void;
  'enhance': (req: { equipSlot: number }, ack: Ack<{ success: boolean; message: string }>) => void;
  'mount:toggle': (ack: Ack<{ mount: string | null }>) => void;
  'market:search': (q: MarketQuery, ack: Ack<{ listings: MarketListing[]; total: number }>) => void;
  'market:mine': (ack: Ack<{ listings: MarketListing[] }>) => void;
  'market:list': (req: { slot: number; quantity: number; unitPrice: number }, ack: Ack<{ message: string }>) => void;
  'market:buy': (listingId: number, ack: Ack<{ message: string }>) => void;
  'market:cancel': (listingId: number, ack: Ack<{ message: string }>) => void;
  'trade:request': (playerId: string, ack: Ack<{ message: string }>) => void;
  'trade:respond': (req: { fromId: string; accept: boolean }, ack: Ack<null>) => void;
  'trade:offer': (req: { items: { slot: number; quantity: number }[]; gold: number }, ack: Ack<null>) => void;
  'trade:lock': (ack: Ack<null>) => void;
  'trade:confirm': (ack: Ack<{ message: string } | null>) => void;
  'trade:cancel': () => void;
  'party:invite': (playerId: string, ack: Ack<{ message: string }>) => void;
  'party:leave': (ack: Ack<null>) => void;
  'party:kick': (playerId: string, ack: Ack<null>) => void;
  'invite:respond': (req: { kind: InviteKind; fromId: string; accept: boolean }, ack: Ack<{ message: string } | null>) => void;
  'friends:get': (ack: Ack<FriendsView>) => void;
  'friends:add': (nameOrId: string, ack: Ack<{ message: string }>) => void;
  'friends:remove': (id: string, ack: Ack<null>) => void;
  'block:set': (req: { targetId: string; kind: 'mute' | 'block' | null }, ack: Ack<{ message: string }>) => void;
  'report': (req: { targetId: string; reason: string }, ack: Ack<{ message: string }>) => void;
  'profile:get': (idOrName: string, ack: Ack<PlayerProfile>) => void;
  'guild:get': (ack: Ack<GuildView | null>) => void;
  'guild:create': (req: { name: string; tag: string }, ack: Ack<{ message: string }>) => void;
  'guild:invite': (nameOrId: string, ack: Ack<{ message: string }>) => void;
  'guild:leave': (ack: Ack<{ message: string }>) => void;
  'guild:kick': (id: string, ack: Ack<{ message: string }>) => void;
  'guild:rank': (req: { id: string; rank: GuildRank }, ack: Ack<{ message: string }>) => void;
  'guild:treasury': (req: { amount: number }, ack: Ack<{ message: string }>) => void;
  'guild:motd': (text: string, ack: Ack<null>) => void;
  'bank:get': (npcId: string, ack: Ack<BankViewState>) => void;
  'bank:move': (req: { npcId: string; dir: 'deposit' | 'withdraw'; slot: number }, ack: Ack<BankViewState>) => void;
  'bank:upgrade': (npcId: string, ack: Ack<{ message: string; bank: BankViewState }>) => void;
  'travel:list': (ack: Ack<{ atWaystone: boolean; options: TravelOption[] }>) => void;
  'travel:go': (mapId: string, ack: Ack<{ message: string }>) => void;
  'stall:open': (req: { name: string; items: { slot: number; price: number }[] }, ack: Ack<{ message: string }>) => void;
  'stall:close': (ack: Ack<null>) => void;
  'stall:view': (sellerId: string, ack: Ack<StallView>) => void;
  'stall:buy': (req: { sellerId: string; slot: number; itemId: string; price: number }, ack: Ack<{ message: string }>) => void;
  'animals:get': (ack: Ack<AnimalState[]>) => void;
  'animals:add': (slot: number, ack: Ack<AnimalState[]>) => void;
  'animals:feed': (ack: Ack<AnimalState[]>) => void;
  'animals:collect': (ack: Ack<AnimalState[]>) => void;
  'dungeon:enter': (req: { dungeonId: string; difficulty: DifficultyId }, ack: Ack<{ message: string }>) => void;
  'spec:choose': (req: { skill: string; spec: string }, ack: Ack<{ message: string }>) => void;
  'journal:get': (ack: Ack<JournalView>) => void;
  'daily:login': (ack: Ack<{ message: string }>) => void;
  'daily:task': (taskId: string, ack: Ack<{ message: string }>) => void;
  'leaderboard:get': (id: LeaderboardId, ack: Ack<{ rows: LeaderboardRow[]; me: LeaderboardRow | null }>) => void;
  'quest:accept': (req: { npcId: string; questId: string }, ack: Ack<null>) => void;
  'quest:complete': (req: { npcId: string; questId: string }, ack: Ack<{ gold: number; xp: number; items: { itemId: string; quantity: number }[] }>) => void;
  'lift:floors': (npcId: string, ack: Ack<{ floors: number[] }>) => void;
  'lift:go': (req: { npcId: string; floor: number }, ack: Ack<{ message: string }>) => void;
  'ping:check': (clientTime: number, ack: (serverTime: number) => void) => void;
  'logout': (ack: Ack<null>) => void;
}

/** Data the server attaches to an authenticated socket. */
export interface SocketAuthPayload {
  characterId: string;
  protocol: number;
}
