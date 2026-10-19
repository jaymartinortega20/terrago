import { BALANCE, getMap, npcsForMap, toNpcPublic, type NpcDef } from '@terrago/game-data';
import {
  AOI,
  CHAT,
  DIR_CODE,
  INTERACT_RANGE,
  MOVEMENT_GUARD,
  PLAYER_SPEED,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  SIM,
  TILE_SIZE,
  facingFor,
  isAxis,
  maskProfanity,
  sanitizeChatText,
  settleEnergy,
  stepMovement,
  tileCenter,
  type ChatMessage,
  type CollisionGrid,
  type InventoryState,
  type MapDef,
  type PortalDef,
  type PublicPlayer,
  type SnapshotEntity,
} from '@terrago/shared';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger';
import type { SecurityEvents } from '../security/events';
import { buildSelfState, type CharacterRecord, type PositionSave } from './characterState';
import type { Connection } from './connection';
import { collisionGridFor } from './grids';
import { Player } from './player';
import { SpatialGrid } from './spatialGrid';

interface MapRuntime {
  def: MapDef;
  grid: CollisionGrid;
  players: Set<Player>;
  spatial: SpatialGrid<Player>;
  npcs: NpcDef[];
  recentChat: { msg: ChatMessage; x: number; y: number }[];
}

export interface WorldDeps {
  log: Logger;
  savePositions: (saves: PositionSave[]) => Promise<void>;
  onChat?: (entry: { mapId: string; senderId: string; body: string }) => void;
  security?: Pick<SecurityEvents, 'record'>;
  /** Called when a player leaves the world for good (after grace, logout or kick). */
  onLeave?: (player: Player) => void;
  now?: () => number;
}

export interface WorldStats {
  players: number;
  connected: number;
  maps: Record<string, number>;
  tick: number;
}

/**
 * The authoritative game world. Owns every in-world player's runtime state,
 * simulates movement at a fixed tick, and streams interest-managed snapshots.
 * It never touches the database directly except through injected callbacks.
 */
export class World {
  readonly players = new Map<string, Player>();
  private readonly maps = new Map<string, MapRuntime>();
  private tickCount = 0;
  private readonly now: () => number;

  constructor(private readonly deps: WorldDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ---------------------------------------------------------------------------
  // Maps
  // ---------------------------------------------------------------------------

  private runtime(mapId: string): MapRuntime {
    let rt = this.maps.get(mapId);
    if (!rt) {
      const def = getMap(mapId);
      if (!def) throw new Error(`Unknown map ${mapId}`);
      rt = {
        def,
        grid: collisionGridFor(def),
        players: new Set(),
        spatial: new SpatialGrid<Player>(512),
        npcs: npcsForMap(mapId),
        recentChat: [],
      };
      this.maps.set(mapId, rt);
    }
    return rt;
  }

  private addToMap(p: Player): void {
    const rt = this.runtime(p.mapId);
    rt.players.add(p);
    rt.spatial.insert(p);
  }

  private removeFromMap(p: Player): void {
    const rt = this.maps.get(p.mapId);
    if (!rt) return;
    rt.players.delete(p);
    rt.spatial.remove(p);
  }

  // ---------------------------------------------------------------------------
  // Joining, reconnecting, leaving
  // ---------------------------------------------------------------------------

  /**
   * Put a character into the world (or re-attach a new connection to a
   * character that is already in it — e.g. after a page refresh). There is
   * never more than one live copy of a character, and at most one character
   * per account, so refreshes can't create ghosts or duplicate sessions.
   */
  async join(
    rec: CharacterRecord,
    conn: Connection,
    inventory: InventoryState,
    meta: { sessionId: string; ip: string | null },
  ): Promise<Player> {
    for (const other of [...this.players.values()]) {
      if (other.userId === rec.userId && other.id !== rec.id) {
        await this.leave(other, 'Another character on your account entered the world.');
      }
    }

    let p = this.players.get(rec.id);
    if (p) {
      if (p.graceTimer) {
        clearTimeout(p.graceTimer);
        p.graceTimer = null;
      }
      if (p.conn && p.conn.id !== conn.id) {
        this.deps.security?.record('duplicate_login', { userId: p.userId, characterId: p.id, ip: meta.ip }, 10_000);
        const old = p.conn;
        p.conn = null;
        old.send('session:end', { reason: 'You logged in from another window.' });
        old.close();
      }
      // Keep the in-memory state (it is fresher than the database).
    } else {
      p = new Player(rec);
      this.players.set(p.id, p);
      this.addToMap(p);
    }
    p.conn = conn;
    this.inventoryCache.set(p.id, inventory);
    p.sessionId = meta.sessionId;
    p.ip = meta.ip;
    p.lastEnergySent = -1;
    this.sendEnter(p, inventory);
    this.deps.log.info('player_joined', { characterId: p.id, name: p.name, map: p.mapId, online: this.players.size });
    return p;
  }

  private sendEnter(p: Player, inventory: InventoryState): void {
    const rt = this.runtime(p.mapId);
    p.known = new Set();
    p.inputs = [];
    p.budgetMs = 0;
    const now = this.now();
    const recentChat = rt.recentChat
      .filter((c) => now - c.msg.ts < 5 * 60_000 && Math.hypot(c.x - p.x, c.y - p.y) <= CHAT.localRadius)
      .map((c) => c.msg);
    const self = buildSelfState(p.rec, now);
    p.lastEnergySent = self.energy;
    p.conn?.send('world:enter', {
      protocol: PROTOCOL_VERSION,
      serverTime: now,
      tickRate: SIM.tickRate,
      snapshotRate: SIM.tickRate / SIM.snapshotEveryTicks,
      self,
      map: { id: rt.def.id, name: rt.def.name, safeZone: rt.def.safeZone },
      position: { x: p.x, y: p.y, dir: p.dir },
      npcs: rt.npcs.map(toNpcPublic),
      inventory,
      ack: p.lastSeq,
      recentChat,
    });
  }

  /**
   * The connection dropped. The character lingers briefly so a refresh can
   * re-attach; otherwise it is removed and saved.
   */
  detach(playerId: string, conn: Connection): void {
    const p = this.players.get(playerId);
    if (!p || p.conn?.id !== conn.id) return;
    p.conn = null;
    p.inputs = [];
    void this.saveNow([p]);
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = setTimeout(() => {
      p.graceTimer = null;
      if (!p.conn) void this.leave(p);
    }, RECONNECT_GRACE_MS);
    p.graceTimer.unref?.();
  }

  /** Remove a character from the world immediately (logout, kick, grace expiry). */
  async leave(p: Player, reason?: string): Promise<void> {
    if (this.players.get(p.id) !== p) return;
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = null;
    this.players.delete(p.id);
    this.inventoryCache.delete(p.id);
    this.removeFromMap(p);
    const conn = p.conn;
    p.conn = null;
    if (conn) {
      if (reason) conn.send('session:end', { reason });
      conn.close();
    }
    await this.saveNow([p]);
    this.deps.onLeave?.(p);
    this.deps.log.info('player_left', { characterId: p.id, name: p.name, reason: reason ?? 'disconnect', online: this.players.size });
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  /** Validate and queue a movement command. Clients only ever send intent, never positions. */
  enqueueMove(p: Player, cmd: unknown): void {
    if (!Array.isArray(cmd) || cmd.length !== 3) return this.badPacket(p, 'move_shape');
    const [seq, dx, dy] = cmd as unknown[];
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= p.lastQueuedSeq || !isAxis(dx) || !isAxis(dy)) {
      return this.badPacket(p, 'move_values');
    }
    if (p.inputs.length >= MOVEMENT_GUARD.maxQueuedInputs) {
      p.droppedInputs++;
      if (p.droppedInputs % 50 === 0) {
        this.deps.security?.record('movement_flood', { userId: p.userId, characterId: p.id, ip: p.ip, details: { dropped: p.droppedInputs } }, 60_000);
      }
      return;
    }
    p.lastQueuedSeq = seq;
    p.inputs.push([seq, dx, dy]);
  }

  private badPacket(p: Player, what: string): void {
    this.deps.security?.record('invalid_packet', { userId: p.userId, characterId: p.id, ip: p.ip, details: { what } }, 60_000);
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  tick(dtMs: number): void {
    this.tickCount++;
    const now = this.now();
    for (const rt of [...this.maps.values()]) {
      for (const p of [...rt.players]) this.simulate(p, rt, dtMs, now);
    }
    if (this.tickCount % SIM.snapshotEveryTicks === 0) {
      for (const rt of this.maps.values()) this.broadcast(rt, now);
    }
  }

  private simulate(p: Player, rt: MapRuntime, dtMs: number, now: number): void {
    // Real time grants movement budget; each command spends one step.
    // A client sending commands faster than real time just fills its queue.
    p.budgetMs = Math.min(p.budgetMs + dtMs, MOVEMENT_GUARD.maxBudgetMs);
    while (p.inputs.length > 0 && p.budgetMs >= SIM.stepMs) {
      const [seq, dx, dy] = p.inputs.shift()!;
      p.budgetMs -= SIM.stepMs;
      p.lastSeq = seq;
      const next = stepMovement({ x: p.x, y: p.y }, { dx, dy }, rt.grid, PLAYER_SPEED, SIM.stepMs);
      p.dir = facingFor({ dx, dy }, p.dir);
      if (next.x !== p.x || next.y !== p.y) {
        p.x = next.x;
        p.y = next.y;
        p.dirty = true;
        p.lastMovedAt = now;
        rt.spatial.update(p);
        const portal = this.portalAt(rt.def, p.x, p.y);
        if (portal) {
          void this.usePortal(p, portal);
          return;
        }
      } else if (dx !== 0 || dy !== 0) {
        p.lastMovedAt = Math.max(p.lastMovedAt, now - 100);
      }
    }
  }

  private portalAt(map: MapDef, x: number, y: number): PortalDef | undefined {
    const tx = x / TILE_SIZE;
    const ty = y / TILE_SIZE;
    return map.portals.find((pt) => tx >= pt.x && tx < pt.x + pt.w && ty >= pt.y && ty < pt.y + pt.h);
  }

  private async usePortal(p: Player, portal: PortalDef): Promise<void> {
    const target = getMap(portal.to);
    if (!target) return;
    const dest = tileCenter(portal.toX, portal.toY);
    this.removeFromMap(p);
    p.mapId = target.id;
    p.x = dest.x;
    p.y = dest.y;
    p.dir = portal.toDir;
    p.dirty = true;
    this.addToMap(p);
    this.deps.log.info('map_change', { characterId: p.id, to: target.id });
    void this.saveNow([p]);
    const inv = this.inventoryCache.get(p.id);
    if (p.conn && inv) this.sendEnter(p, inv);
    else if (p.conn) this.deps.log.warn('map_change_without_inventory', { characterId: p.id });
  }

  /** Last known inventory per player, so map changes don't need a DB round-trip. */
  readonly inventoryCache = new Map<string, InventoryState>();

  private broadcast(rt: MapRuntime, now: number): void {
    const near: Player[] = [];
    for (const p of rt.players) {
      const conn = p.conn;
      if (!conn) continue;
      near.length = 0;
      rt.spatial.query(p.x - AOI.leaveHalfWidth, p.y - AOI.leaveHalfHeight, p.x + AOI.leaveHalfWidth, p.y + AOI.leaveHalfHeight, near);
      const nextKnown = new Set<string>();
      const added: PublicPlayer[] = [];
      const rows: SnapshotEntity[] = [];
      for (const q of near) {
        if (q === p) continue;
        const dx = Math.abs(q.x - p.x);
        const dy = Math.abs(q.y - p.y);
        const knew = p.known.has(q.id);
        const inside = knew ? dx <= AOI.leaveHalfWidth && dy <= AOI.leaveHalfHeight : dx <= AOI.enterHalfWidth && dy <= AOI.enterHalfHeight;
        if (!inside) continue;
        nextKnown.add(q.id);
        if (!knew) added.push(q.toPublic());
        rows.push([q.id, q.x, q.y, DIR_CODE[q.dir], q.isMoving(now) ? 1 : 0]);
      }
      const removed: string[] = [];
      for (const id of p.known) if (!nextKnown.has(id)) removed.push(id);
      p.known = nextKnown;
      if (removed.length) conn.send('entity:remove', removed);
      if (added.length) conn.send('entity:add', added);
      conn.sendVolatile('snap', { t: now, ack: p.lastSeq, x: p.x, y: p.y, dir: DIR_CODE[p.dir], e: rows });
    }
  }

  // ---------------------------------------------------------------------------
  // Chat and interaction
  // ---------------------------------------------------------------------------

  chat(p: Player, raw: unknown): { ok: true; id: string } | { ok: false; error: string } {
    const text = sanitizeChatText(raw, CHAT.maxLength);
    if (!text) return { ok: false, error: 'Message is empty.' };
    if (!p.chatBucket.take()) {
      this.deps.security?.record('chat_rate_limited', { userId: p.userId, characterId: p.id, ip: p.ip }, 60_000);
      return { ok: false, error: "You're sending messages too fast." };
    }
    if (text.startsWith('/')) return this.command(p, text);

    const msg: ChatMessage = {
      id: randomUUID(),
      channel: 'local',
      fromId: p.id,
      fromName: p.name,
      text: maskProfanity(text),
      ts: this.now(),
    };
    const rt = this.runtime(p.mapId);
    const r = CHAT.localRadius;
    for (const q of rt.spatial.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
      if (q.conn && Math.hypot(q.x - p.x, q.y - p.y) <= r) q.conn.send('chat', msg);
    }
    rt.recentChat.push({ msg, x: p.x, y: p.y });
    if (rt.recentChat.length > 30) rt.recentChat.splice(0, rt.recentChat.length - 30);
    this.deps.onChat?.({ mapId: p.mapId, senderId: p.id, body: msg.text });
    return { ok: true, id: msg.id };
  }

  private command(p: Player, text: string): { ok: true; id: string } | { ok: false; error: string } {
    const [cmd] = text.slice(1).split(' ');
    const reply = (t: string) => {
      p.conn?.send('chat', { id: randomUUID(), channel: 'system', fromId: null, fromName: 'System', text: t, ts: this.now() });
      return { ok: true as const, id: 'system' };
    };
    switch ((cmd ?? '').toLowerCase()) {
      case 'who':
        return reply(`${this.players.size} adventurer${this.players.size === 1 ? '' : 's'} online.`);
      case 'where':
        return reply(`${this.runtime(p.mapId).def.name} (${Math.floor(p.x / TILE_SIZE)}, ${Math.floor(p.y / TILE_SIZE)})`);
      case 'help':
        return reply('Commands: /who — players online, /where — your location.');
      default:
        return { ok: false, error: `Unknown command /${cmd}. Try /help.` };
    }
  }

  /** Server-side range check for talking to an NPC. */
  npcInRange(p: Player, npc: NpcDef): boolean {
    if (npc.mapId !== p.mapId) return false;
    const c = tileCenter(npc.x, npc.y);
    return Math.hypot(c.x - p.x, c.y - p.y) <= INTERACT_RANGE;
  }

  // ---------------------------------------------------------------------------
  // Persistence and housekeeping
  // ---------------------------------------------------------------------------

  async saveNow(players: Player[]): Promise<void> {
    const saves = players.map((p) => ({ id: p.id, mapId: p.mapId, x: p.x, y: p.y, dir: p.dir }));
    players.forEach((p) => (p.dirty = false));
    try {
      await this.deps.savePositions(saves);
      for (const p of players) {
        p.rec.mapId = p.mapId;
        p.rec.x = p.x;
        p.rec.y = p.y;
        p.rec.dir = p.dir;
      }
    } catch (err) {
      players.forEach((p) => (p.dirty = true));
      this.deps.log.error('position_save_failed', { err, count: saves.length });
    }
  }

  /** Periodic save of everyone who moved. */
  async saveDirty(): Promise<number> {
    const dirty = [...this.players.values()].filter((p) => p.dirty);
    if (dirty.length) await this.saveNow(dirty);
    return dirty.length;
  }

  /** Push Energy regeneration to clients (Energy itself is timestamp-based). */
  pushEnergy(): void {
    const now = this.now();
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      const e = settleEnergy(p.rec.energy, p.rec.energyUpdatedAt, now, BALANCE.energy).energy;
      if (e !== p.lastEnergySent) {
        p.lastEnergySent = e;
        p.conn.send('self:update', { energy: e });
      }
    }
  }

  /** Graceful shutdown: tell everyone, save everyone. */
  async shutdown(reason = 'The server is restarting. Please reconnect in a moment.'): Promise<void> {
    const all = [...this.players.values()];
    for (const p of all) {
      if (p.graceTimer) clearTimeout(p.graceTimer);
      p.conn?.send('session:end', { reason });
      p.conn?.close();
      p.conn = null;
    }
    await this.saveNow(all);
    this.players.clear();
    this.maps.clear();
  }

  stats(): WorldStats {
    const maps: Record<string, number> = {};
    for (const [id, rt] of this.maps) maps[id] = rt.players.size;
    let connected = 0;
    for (const p of this.players.values()) if (p.conn) connected++;
    return { players: this.players.size, connected, maps, tick: this.tickCount };
  }
}
