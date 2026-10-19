import type {
  ChatMessage,
  DialogueResult,
  Direction,
  InventoryState,
  NpcPublic,
  PublicPlayer,
  SelfState,
} from './types';

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

/** Compact entity row in a snapshot: [id, x, y, dirCode, moving(0|1)]. */
export type SnapshotEntity = [id: string, x: number, y: number, dir: number, moving: 0 | 1];

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
}

export interface NoticePayload {
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface ServerToClientEvents {
  /** Sent when the character enters the world or changes map. */
  'world:enter': (payload: EnterWorldPayload) => void;
  /** Players that came into view. */
  'entity:add': (players: PublicPlayer[]) => void;
  /** Players that left view (or the map). */
  'entity:remove': (ids: string[]) => void;
  'snap': (snapshot: Snapshot) => void;
  'chat': (message: ChatMessage) => void;
  'self:update': (self: Partial<SelfState>) => void;
  'inventory:update': (inventory: InventoryState) => void;
  'notice': (notice: NoticePayload) => void;
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
  'ping:check': (clientTime: number, ack: (serverTime: number) => void) => void;
  'logout': (ack: Ack<null>) => void;
}

/** Data the server attaches to an authenticated socket. */
export interface SocketAuthPayload {
  characterId: string;
  protocol: number;
}
