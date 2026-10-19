import { CHAT, type Direction, type MoveCommand, type PublicPlayer } from '@terrago/shared';
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
      id: this.id,
      name: this.rec.name,
      level: this.rec.level,
      classId: this.rec.classId,
      appearance: this.rec.appearance,
      x: this.x,
      y: this.y,
      dir: this.dir,
    };
  }

  /** Queue a DB-backed action so a player's actions never interleave. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }
}
