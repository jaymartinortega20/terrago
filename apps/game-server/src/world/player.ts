import { CHAT, type ActiveEffect, type CombatProfile, type Direction, type MoveCommand, type PublicPlayer } from '@terrago/shared';
import { TokenBucket } from '../security/rateLimit';
import type { CharacterRecord } from './characterState';
import type { Connection } from './connection';

/** A character that is currently in the world (connected or briefly link-dead). */
export class Player {
  readonly id: string;
  readonly userId: string;
  readonly rec: CharacterRecord;

  mapId: string;
  /** Owner of the instance the player is in (homesteads); null on shared maps. */
  instanceOwner: { id: string; name: string } | null = null;
  /** True while the destination of a map change is still loading. */
  changingMap = false;
  /** Earliest time the next tile action (till, mine...) is accepted. */
  nextActAt = 0;

  // --- Combat ---------------------------------------------------------------
  /** Stats with equipment; recomputed when level or equipment changes. */
  profile!: CombatProfile;
  effects: ActiveEffect[] = [];
  cooldowns = new Map<string, number>();
  nextAttackAt = 0;
  lastCombatAt = 0;
  dead = false;
  respawnAt = 0;
  /** Hits dealt/taken since the last durability wear. */
  hitsDealt = 0;
  hitsTaken = 0;
  /** Last HP/MP pushed to the client. */
  sentHp = -1;
  sentMp = -1;
  regenCarry = 0;
  mpCarry = 0;
  /** Duel in progress. */
  duel: { with: Player; until: number } | null = null;
  duelInvite: { from: Player; until: number } | null = null;
  /** Mount being ridden (item id) and speed multiplier. */
  mount: string | null = null;
  speed = 1;
  // --- Social ---------------------------------------------------------------
  party: import('../net/social').Party | null = null;
  /** People this player muted (chat hidden) or blocked (also no whispers/trades/invites). */
  blocked = new Map<string, 'mute' | 'block'>();
  guild: import('../services/social').GuildMembership | null = null;
  friendIds = new Set<string>();
  /** Pending invites to this player, keyed "kind:fromId". */
  invites = new Map<string, { kind: import('@terrago/shared').InviteKind; from: string; until: number; guildId?: number }>();
  /** Last whisper partner, for /r. */
  replyTo: string | null = null;
  nextGlobalAt = 0;
  /** Open market stall: its name and the bag slots on sale with unit prices. */
  stall: { name: string; prices: Map<number, { itemId: string; price: number }> } | null = null;
  /** Active pet item id. */
  pet: string | null = null;
  /** Dungeon difficulty this player (as party leader) picks. */
  dungeonDifficulty: import('@terrago/shared').DifficultyId = 'normal';
  /** Chat mute set by a moderator (ms since epoch). */
  mutedUntil = 0;
  /** Sitting down (cleared when they move). */
  pose: 'sit' | null = null;
  lastEmoteAt = 0;
  /** Message of the day already shown this session. */
  motdShown = false;
  /** Recent lines this player said (any channel), attached to reports. */
  said: { ch: string; text: string; ts: number }[] = [];
  /** Starter quest chain progress (loaded at join). */
  quests: import('@terrago/shared').QuestState[] = [];
  lastVitalsAt = 0;
  x: number;
  y: number;
  dir: Direction;

  conn: Connection | null = null;
  sessionId: string | null = null;
  ip: string | null = null;

  /** Movement commands waiting to be simulated. */
  inputs: MoveCommand[] = [];
  /** Highest sequence number accepted into the queue. */
  lastQueuedSeq = 0;
  /** Highest sequence number simulated (acknowledged in snapshots). */
  lastSeq = 0;
  /** Simulation time the player may still spend moving (anti speed-hack). */
  budgetMs = 0;
  lastMovedAt = 0;
  droppedInputs = 0;

  /** Entity ids this client currently knows about (interest management). */
  known = new Set<string>();
  chatBucket = new TokenBucket(CHAT.burst, 1 / CHAT.refillMs);
  /** Position changed since the last save. */
  dirty = false;
  graceTimer: NodeJS.Timeout | null = null;
  lastEnergySent = -1;
  /** Serializes database actions (inventory, NPC talk) per player. */
  busy: Promise<unknown> = Promise.resolve();

  constructor(rec: CharacterRecord) {
    this.rec = rec;
    this.id = rec.id;
    this.userId = rec.userId;
    this.mapId = rec.mapId;
    this.x = rec.x;
    this.y = rec.y;
    this.dir = rec.dir;
  }

  get name(): string {
    return this.rec.name;
  }

  isMoving(now: number): boolean {
    return now - this.lastMovedAt < 150;
  }

  toPublic(): PublicPlayer {
    return {
      kind: 'player',
      id: this.id,
      name: this.rec.name,
      level: this.rec.level,
      classId: this.rec.classId,
      appearance: this.rec.appearance,
      x: this.x,
      y: this.y,
      dir: this.dir,
      mount: this.mount,
      weapon: this.rec.equipment?.find((e) => e.slot === 0)?.itemId ?? null,
      guild: this.guild?.tag ?? null,
      shop: this.stall?.name ?? null,
      pet: this.pet,
      pose: this.pose,
      job: this.rec.job ?? null,
    };
  }

  /** Remember a line for moderation reports. */
  remember(ch: string, text: string): void {
    this.said.push({ ch, text, ts: Date.now() });
    if (this.said.length > 20) this.said.shift();
  }

  /** Does this player ignore `other` (muted or blocked)? */
  ignores(other: Player): boolean {
    return this.blocked.has(other.id);
  }

  /** Queue a DB-backed action so a player's actions never interleave. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }
}
