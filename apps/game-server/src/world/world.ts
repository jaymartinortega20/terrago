import { BALANCE, getMap, getNode, npcsForMap, toNpcPublic, type NpcDef } from '@terrago/game-data';
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
  type NodeObject,
  type PortalDef,
  type InventorySlot,
  type PublicMonster,
  type PublicPlayer,
  type SnapshotEntity,
  type WorldObject,
} from '@terrago/shared';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger';
import type { SecurityEvents } from '../security/events';
import { buildSelfState, profileFor, type CharacterRecord, type PositionSave } from './characterState';
import { Combat, type CombatHooks, type Monster } from './combat';
import type { Connection } from './connection';
import { collisionGridFor } from './grids';
import { Player } from './player';
import { SpatialGrid } from './spatialGrid';

export interface MapRuntime {
  /** `mapId` for shared maps, `mapId:ownerId` for instances (homesteads). */
  key: string;
  def: MapDef;
  owner: { id: string; name: string } | null;
  grid: CollisionGrid;
  players: Set<Player>;
  spatial: SpatialGrid<Player>;
  npcs: NpcDef[];
  recentChat: { msg: ChatMessage; x: number; y: number }[];
  objects: Map<string, WorldObject>;
  /** Successful gathers left per node before it depletes. */
  nodeYields: Map<string, number>;
  monsters: Map<string, Monster>;
  /** Objects are loaded asynchronously for instanced maps. */
  loaded: boolean;
  loading: Promise<void> | null;
  emptySince: number | null;
}

export interface WorldDeps {
  log: Logger;
  savePositions: (saves: PositionSave[]) => Promise<void>;
  onChat?: (entry: { mapId: string; senderId: string; body: string }) => void;
  security?: Pick<SecurityEvents, 'record'>;
  /** Called when a player leaves the world for good (after grace, logout or kick). */
  onLeave?: (player: Player) => void;
  /** Called after a player arrives in a new map. */
  onMapEnter?: (player: Player) => void;
  /** Async side effects of combat (rewards, death penalty, durability). */
  combat?: CombatHooks;
  rand?: () => number;
  /** Load runtime objects for a map instance (e.g. a homestead's farm plots). */
  loadObjects?: (def: MapDef, owner: { id: string; name: string } | null) => Promise<WorldObject[]>;
  now?: () => number;
}

export interface WorldStats {
  players: number;
  connected: number;
  maps: Record<string, number>;
  tick: number;
}

/** Instanced runtimes with nobody inside are dropped after this long. */
const INSTANCE_IDLE_MS = 60_000;

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

  readonly combat: Combat;

  constructor(private readonly deps: WorldDeps) {
    this.now = deps.now ?? Date.now;
    this.combat = new Combat(
      {
        ...deps.combat,
        onDuelEnd: (w, l) => this.duelWon(w, l),
        dismount: (p) => this.setMount(p, null, 1),
        respawn: (p) => {
          const pt = Combat.respawnPoint(this.runtimeOf(p));
          void this.moveTo(p, pt.mapId, null, pt.x, pt.y, 'down');
        },
      },
      this.now,
      deps.rand,
    );
  }

  /** Tell every player who can see `p` about a look change. */
  broadcastLook(p: Player, patch: { mount?: string | null; weapon?: string | null }): void {
    for (const q of this.runtimeOf(p).players) if (q !== p && q.known.has(p.id)) q.conn?.send('entity:update', p.id, patch);
  }

  /** Get on (item id + speed) or off (null) a mount. */
  setMount(p: Player, mount: string | null, speed: number, notify = true): void {
    if (p.mount === mount) return;
    p.mount = mount;
    p.speed = mount ? speed : 1;
    p.conn?.send('self:update', { mount: p.mount, speed: p.speed });
    if (notify) this.broadcastLook(p, { mount: p.mount });
  }

  // --- Duels -------------------------------------------------------------------

  private endDuel(a: Player, b: Player, text: string): void {
    a.duel = null;
    b.duel = null;
    for (const q of [a, b]) {
      q.conn?.send('duel', { with: null });
      this.system(q, text);
    }
  }

  duelCommand(p: Player, cmd: string, arg: string): string {
    const now = this.now();
    if (cmd === 'duel') {
      const q = [...this.players.values()].find((x) => x.name.toLowerCase() === arg.toLowerCase());
      if (!q || q === p) return 'Who? Type /duel followed by a player name.';
      if (q.mapId !== p.mapId || Math.hypot(q.x - p.x, q.y - p.y) > 12 * TILE_SIZE) return `${q.name} needs to be nearby.`;
      if (p.duel || q.duel) return 'Someone is already in a duel.';
      q.duelInvite = { from: p, until: now + 30_000 };
      this.system(q, `${p.name} challenges you to a duel! Type /accept to fight (nobody dies — first to 1 HP loses).`);
      return `Duel challenge sent to ${q.name}.`;
    }
    if (cmd === 'accept') {
      const inv = p.duelInvite;
      p.duelInvite = null;
      if (!inv || inv.until < now || !this.players.has(inv.from.id) || inv.from.duel || p.duel) return 'No duel challenge to accept.';
      const q = inv.from;
      const until = now + 180_000;
      p.duel = { with: q, until };
      q.duel = { with: p, until };
      p.conn?.send('duel', { with: { id: q.id, name: q.name }, until });
      q.conn?.send('duel', { with: { id: p.id, name: p.name }, until });
      this.system(q, `${p.name} accepted your duel. Fight!`);
      return `Duel with ${q.name} — fight! (F to attack; click them to target)`;
    }
    if (cmd === 'forfeit') {
      if (!p.duel) return "You're not in a duel.";
      const q = p.duel.with;
      this.endDuel(p, q, `${p.name} forfeits. ${q.name} wins the duel!`);
      return '';
    }
    return '';
  }

  duelWon(winner: Player, loser: Player): void {
    if (winner.duel?.with !== loser) return;
    this.endDuel(winner, loser, `${winner.name} wins the duel against ${loser.name}!`);
  }

  private expireDuels(now: number): void {
    for (const p of this.players.values()) if (p.duel && p.duel.until < now) this.endDuel(p, p.duel.with, 'The duel ended in a draw (time).');
  }

  /** Worn equipment changed: recompute stats and tell the client. */
  setEquipment(p: Player, equipment: InventorySlot[]): void {
    const before = p.rec.equipment?.find((e) => e.slot === 0)?.itemId ?? null;
    p.rec.equipment = equipment;
    this.refreshProfile(p);
    const after = equipment.find((e) => e.slot === 0)?.itemId ?? null;
    if (before !== after) this.broadcastLook(p, { weapon: after });
  }

  refreshProfile(p: Player): void {
    p.profile = profileFor(p.rec);
    p.rec.hp = Math.min(p.rec.hp, p.profile.maxHp);
    p.rec.mp = Math.min(p.rec.mp, p.profile.maxMp);
    p.conn?.send('self:update', { stats: p.profile.stats, derived: p.profile.derived, maxHp: p.profile.maxHp, maxMp: p.profile.maxMp, hp: p.rec.hp, mp: p.rec.mp });
  }

  // ---------------------------------------------------------------------------
  // Maps and instances
  // ---------------------------------------------------------------------------

  static runtimeKey(mapId: string, ownerId: string | null): string {
    return ownerId ? `${mapId}:${ownerId}` : mapId;
  }

  private runtime(mapId: string, owner: { id: string; name: string } | null): MapRuntime {
    const def = getMap(mapId);
    if (!def) throw new Error(`Unknown map ${mapId}`);
    const own = def.instanced ? owner : null;
    if (def.instanced && !own) throw new Error(`Map ${mapId} needs an instance owner`);
    const key = World.runtimeKey(mapId, own?.id ?? null);
    let rt = this.maps.get(key);
    if (!rt) {
      rt = {
        key,
        def,
        owner: own,
        grid: collisionGridFor(def),
        players: new Set(),
        spatial: new SpatialGrid<Player>(512),
        npcs: npcsForMap(mapId),
        recentChat: [],
        objects: new Map(),
        nodeYields: new Map(),
        monsters: new Map(),
        loaded: !this.deps.loadObjects,
        loading: null,
        emptySince: null,
      };
      this.maps.set(key, rt);
      this.spawnNodes(rt);
      if (!own) this.combat.spawnMonsters(rt);
      if (this.deps.loadObjects) {
        const target = rt;
        target.loading = this.deps
          .loadObjects(def, own)
          .then((objs) => {
            for (const o of objs) target.objects.set(o.id, o);
          })
          .catch((err) => this.deps.log.error('objects_load_failed', { err, map: key }))
          .finally(() => {
            target.loaded = true;
            target.loading = null;
          });
      }
    }
    return rt;
  }

  /** The runtime a player is currently in. */
  runtimeOf(p: Player): MapRuntime {
    return this.runtime(p.mapId, p.instanceOwner);
  }

  getRuntime(key: string): MapRuntime | undefined {
    return this.maps.get(key);
  }

  /** Resource nodes come from the map definition; their depletion lives only in memory. */
  private spawnNodes(rt: MapRuntime): void {
    for (const n of rt.def.nodes ?? []) {
      const def = getNode(n.type);
      if (!def) continue;
      const obj: NodeObject = { kind: 'node', id: `node:${n.id}`, x: n.x, y: n.y, type: n.type, depletedUntil: 0 };
      rt.objects.set(obj.id, obj);
      rt.nodeYields.set(obj.id, def.yields);
    }
  }

  /**
   * Reserve one gather from a node. Returns false if it is depleted. The caller
   * must call `nodeGathered` on success or `nodeRelease` if nothing was taken.
   */
  nodeReserve(rt: MapRuntime, id: string): boolean {
    const o = rt.objects.get(id);
    if (!o || o.kind !== 'node' || o.depletedUntil > this.now()) return false;
    const left = rt.nodeYields.get(id) ?? 0;
    if (left <= 0) return false;
    rt.nodeYields.set(id, left - 1);
    return true;
  }

  nodeRelease(rt: MapRuntime, id: string): void {
    const def = this.nodeDefOf(rt, id);
    if (def) rt.nodeYields.set(id, Math.min(def.yields, (rt.nodeYields.get(id) ?? 0) + 1));
  }

  /** After a successful gather: deplete the node if that was its last yield. */
  nodeGathered(rt: MapRuntime, id: string): void {
    const o = rt.objects.get(id);
    const def = this.nodeDefOf(rt, id);
    if (!o || o.kind !== 'node' || !def) return;
    if ((rt.nodeYields.get(id) ?? 0) <= 0) {
      const depleted: NodeObject = { ...o, depletedUntil: this.now() + def.respawnMs };
      this.setObjects(rt.key, [depleted]);
    }
  }

  private nodeDefOf(rt: MapRuntime, id: string) {
    const o = rt.objects.get(id);
    return o?.kind === 'node' ? getNode(o.type) : undefined;
  }

  private dropSeq = 0;

  /** Loot that didn't fit in a bag: a pile only its owner can pick up for 2 minutes. */
  addDrop(rt: MapRuntime, x: number, y: number, itemId: string, quantity: number, ownerId: string): void {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor((y - 4) / TILE_SIZE);
    const drop = { kind: 'drop' as const, id: `drop:${++this.dropSeq}`, x: tx, y: ty, itemId, quantity, quality: 0, ownerId, until: this.now() + 120_000 };
    this.setObjects(rt.key, [drop]);
  }

  removeObject(rt: MapRuntime, id: string): void {
    if (!rt.objects.delete(id)) return;
    for (const p of rt.players) p.conn?.send('objects:remove', [id]);
  }

  /** Bring depleted nodes back once their respawn time has passed (and clear expired loot). */
  private respawnNodes(now: number): void {
    for (const rt of this.maps.values()) {
      for (const o of [...rt.objects.values()]) if (o.kind === 'drop' && o.until <= now) this.removeObject(rt, o.id);
      const back: NodeObject[] = [];
      for (const o of rt.objects.values()) {
        if (o.kind === 'node' && o.depletedUntil > 0 && o.depletedUntil <= now) {
          back.push({ ...o, depletedUntil: 0 });
          rt.nodeYields.set(o.id, getNode(o.type)?.yields ?? 1);
        }
      }
      if (back.length) this.setObjects(rt.key, back);
    }
  }

  private addToMap(p: Player): MapRuntime {
    const rt = this.runtimeOf(p);
    // Re-read an idle instance from the database when someone walks back in,
    // so it never serves stale state (the DB is always the source of truth).
    if (rt.owner && rt.players.size === 0 && rt.loaded && !rt.loading && this.deps.loadObjects) {
      rt.loaded = false;
      rt.loading = this.deps
        .loadObjects(rt.def, rt.owner)
        .then((objs) => {
          for (const [id, o] of rt.objects) if (o.kind !== 'node') rt.objects.delete(id);
          for (const o of objs) rt.objects.set(o.id, o);
        })
        .catch((err) => this.deps.log.error('objects_load_failed', { err, map: rt.key }))
        .finally(() => {
          rt.loaded = true;
          rt.loading = null;
        });
    }
    rt.players.add(p);
    rt.spatial.insert(p);
    rt.emptySince = null;
    return rt;
  }

  private removeFromMap(p: Player): void {
    const rt = this.maps.get(World.runtimeKey(p.mapId, p.instanceOwner?.id ?? null));
    if (!rt) return;
    rt.players.delete(p);
    rt.spatial.remove(p);
    if (rt.players.size === 0) rt.emptySince = this.now();
  }

  /** Owner info for a saved map: instanced maps (homesteads) always load as your own. */
  private ownerFor(rec: CharacterRecord, mapId: string): { id: string; name: string } | null {
    return getMap(mapId)?.instanced ? { id: rec.id, name: rec.name } : null;
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
      p.profile = profileFor(rec);
      if (p.rec.hp <= 0) p.rec.hp = Math.round(p.profile.maxHp * 0.5);
      p.instanceOwner = this.ownerFor(rec, rec.mapId);
      this.players.set(p.id, p);
      this.addToMap(p);
    }
    p.conn = conn;
    this.inventoryCache.set(p.id, inventory);
    p.sessionId = meta.sessionId;
    p.ip = meta.ip;
    p.lastEnergySent = -1;
    await this.whenLoaded(this.runtimeOf(p));
    if (p.conn === conn) this.sendEnter(p, inventory);
    this.deps.log.info('player_joined', { characterId: p.id, name: p.name, map: p.mapId, online: this.players.size });
    return p;
  }

  private async whenLoaded(rt: MapRuntime): Promise<void> {
    if (!rt.loaded && rt.loading) await rt.loading;
  }

  private sendEnter(p: Player, inventory: InventoryState): void {
    const rt = this.runtimeOf(p);
    p.known = new Set();
    p.inputs = [];
    p.budgetMs = 0;
    const now = this.now();
    const recentChat = rt.recentChat
      .filter((c) => now - c.msg.ts < 5 * 60_000 && Math.hypot(c.x - p.x, c.y - p.y) <= CHAT.localRadius)
      .map((c) => c.msg);
    // Mounts can't squeeze into mine tunnels.
    if (p.mount && rt.def.theme === 'cave') this.setMount(p, null, 1, false);
    const self = { ...buildSelfState(p.rec, now, p.profile), mount: p.mount, speed: p.speed };
    p.lastEnergySent = self.energy;
    p.conn?.send('world:enter', {
      protocol: PROTOCOL_VERSION,
      serverTime: now,
      tickRate: SIM.tickRate,
      snapshotRate: SIM.tickRate / SIM.snapshotEveryTicks,
      self,
      map: { id: rt.def.id, name: rt.owner ? `${rt.owner.name}'s ${rt.def.name}` : rt.def.name, safeZone: rt.def.safeZone, owner: rt.owner },
      position: { x: p.x, y: p.y, dir: p.dir },
      npcs: rt.npcs.map(toNpcPublic),
      inventory,
      ack: p.lastSeq,
      recentChat,
      objects: [...rt.objects.values()],
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
    if (p.duel) this.endDuel(p, p.duel.with, `${p.name} left. The duel is over.`);
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

  badPacket(p: Player, what: string): void {
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
      if (rt.monsters.size || rt.players.size) this.combat.tick(rt, dtMs);
    }
    if (this.tickCount % SIM.snapshotEveryTicks === 0) {
      for (const rt of this.maps.values()) this.broadcast(rt, now);
    }
    if (this.tickCount % 100 === 0) this.dropIdleInstances(now);
    if (this.tickCount % 20 === 0) {
      this.respawnNodes(now);
      this.expireDuels(now);
    }
  }

  private dropIdleInstances(now: number): void {
    for (const [key, rt] of this.maps) {
      if (rt.owner && rt.players.size === 0 && rt.emptySince !== null && now - rt.emptySince > INSTANCE_IDLE_MS && rt.loaded) {
        this.maps.delete(key);
      }
    }
  }

  private simulate(p: Player, rt: MapRuntime, dtMs: number, now: number): void {
    // Real time grants movement budget; each command spends one step.
    // A client sending commands faster than real time just fills its queue.
    p.budgetMs = Math.min(p.budgetMs + dtMs, MOVEMENT_GUARD.maxBudgetMs);
    if (p.changingMap || p.dead) {
      if (p.inputs.length) p.lastSeq = p.inputs[p.inputs.length - 1]![0];
      p.inputs = [];
      return;
    }
    while (p.inputs.length > 0 && p.budgetMs >= SIM.stepMs) {
      const [seq, dx, dy] = p.inputs.shift()!;
      p.budgetMs -= SIM.stepMs;
      p.lastSeq = seq;
      const next = stepMovement({ x: p.x, y: p.y }, { dx, dy }, rt.grid, PLAYER_SPEED * p.speed, SIM.stepMs);
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
    const owner = target.instanced ? { id: p.id, name: p.name } : null;
    await this.moveTo(p, target.id, owner, portal.toX, portal.toY, portal.toDir);
  }

  /** Move a player to a map (or instance) and tile. Used by portals and respawns. */
  async moveTo(p: Player, mapId: string, owner: { id: string; name: string } | null, tx: number, ty: number, dir: PortalDef['toDir']): Promise<void> {
    const dest = tileCenter(tx, ty);
    this.removeFromMap(p);
    p.mapId = mapId;
    p.instanceOwner = owner;
    p.x = dest.x;
    p.y = dest.y;
    p.dir = dir;
    p.dirty = true;
    const rt = this.addToMap(p);
    this.deps.log.info('map_change', { characterId: p.id, to: rt.key });
    this.deps.onMapEnter?.(p);
    void this.saveNow([p]);
    if (!rt.loaded) {
      p.changingMap = true;
      await this.whenLoaded(rt);
      p.changingMap = false;
      if (this.runtimeOf(p) !== rt) return; // moved again meanwhile
    }
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
      if (!conn || p.changingMap) continue;
      near.length = 0;
      rt.spatial.query(p.x - AOI.leaveHalfWidth, p.y - AOI.leaveHalfHeight, p.x + AOI.leaveHalfWidth, p.y + AOI.leaveHalfHeight, near);
      const nextKnown = new Set<string>();
      const added: (PublicPlayer | PublicMonster)[] = [];
      const rows: SnapshotEntity[] = [];
      const consider = (q: Player | Monster, hpPct: number) => {
        const dx = Math.abs(q.x - p.x);
        const dy = Math.abs(q.y - p.y);
        const knew = p.known.has(q.id);
        const inside = knew ? dx <= AOI.leaveHalfWidth && dy <= AOI.leaveHalfHeight : dx <= AOI.enterHalfWidth && dy <= AOI.enterHalfHeight;
        if (!inside) return;
        nextKnown.add(q.id);
        if (!knew) added.push(q.toPublic());
        rows.push([q.id, q.x, q.y, DIR_CODE[q.dir], q.isMoving(now) ? 1 : 0, hpPct]);
      };
      for (const q of near) {
        if (q === p || q.dead) continue;
        consider(q, Math.round((q.rec.hp / Math.max(1, q.profile.maxHp)) * 100));
      }
      for (const m of rt.monsters.values()) {
        if (!m.alive) continue;
        consider(m, Math.round((m.hp / m.stats.maxHp) * 100));
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
  // Objects (farm plots, ...)
  // ---------------------------------------------------------------------------

  /** Objects at a tile in the player's current map. */
  objectsAt(p: Player, tx: number, ty: number): WorldObject[] {
    const out: WorldObject[] = [];
    for (const o of this.runtimeOf(p).objects.values()) if (o.x === tx && o.y === ty) out.push(o);
    return out;
  }

  /** Upsert objects in a runtime and tell everyone inside. */
  setObjects(key: string, objs: WorldObject[]): void {
    const rt = this.maps.get(key);
    if (!rt || objs.length === 0) return;
    for (const o of objs) rt.objects.set(o.id, o);
    for (const p of rt.players) if (!p.changingMap) p.conn?.send('objects:set', objs);
  }

  /** Replace all objects of a runtime (e.g. after a farm upgrade). */
  replaceObjects(key: string, objs: WorldObject[]): void {
    const rt = this.maps.get(key);
    if (!rt) return;
    const removed = [...rt.objects.entries()].filter(([id, o]) => o.kind !== 'node' && !objs.some((n) => n.id === id)).map(([id]) => id);
    for (const id of removed) rt.objects.delete(id);
    for (const o of objs) rt.objects.set(o.id, o);
    for (const p of rt.players) {
      if (removed.length) p.conn?.send('objects:remove', removed);
      p.conn?.send('objects:set', objs);
    }
  }

  /** Is the tile within reach of the player (used for every tile action)? */
  tileInReach(p: Player, tx: number, ty: number, tiles = 1.75): boolean {
    const c = { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
    // The player's position is their feet; measure from the body centre.
    return Math.hypot(c.x - p.x, c.y - (p.y - 8)) <= tiles * TILE_SIZE;
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
    const rt = this.runtimeOf(p);
    const r = CHAT.localRadius;
    for (const q of rt.spatial.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
      if (q.conn && Math.hypot(q.x - p.x, q.y - p.y) <= r) q.conn.send('chat', msg);
    }
    rt.recentChat.push({ msg, x: p.x, y: p.y });
    if (rt.recentChat.length > 30) rt.recentChat.splice(0, rt.recentChat.length - 30);
    this.deps.onChat?.({ mapId: p.mapId, senderId: p.id, body: msg.text });
    return { ok: true, id: msg.id };
  }

  /** Send a system line to one player's chat. */
  system(p: Player, text: string): void {
    p.conn?.send('chat', { id: randomUUID(), channel: 'system', fromId: null, fromName: 'System', text, ts: this.now() });
  }

  private command(p: Player, text: string): { ok: true; id: string } | { ok: false; error: string } {
    const [cmd] = text.slice(1).split(' ');
    const reply = (t: string) => {
      this.system(p, t);
      return { ok: true as const, id: 'system' };
    };
    switch ((cmd ?? '').toLowerCase()) {
      case 'who':
        return reply(`${this.players.size} adventurer${this.players.size === 1 ? '' : 's'} online.`);
      case 'where':
        return reply(`${this.runtimeOf(p).def.name} (${Math.floor(p.x / TILE_SIZE)}, ${Math.floor(p.y / TILE_SIZE)})`);
      case 'help':
        return reply('Commands: /who, /where, /duel <name>, /accept, /forfeit.');
      case 'duel':
      case 'accept':
      case 'forfeit': {
        const out = this.duelCommand(p, cmd!.toLowerCase(), text.slice(1 + cmd!.length).trim());
        return out ? reply(out) : { ok: true as const, id: 'system' };
      }
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
    const saves = players.map((p) => ({ id: p.id, mapId: p.mapId, x: p.x, y: p.y, dir: p.dir, hp: p.rec.hp, mp: p.rec.mp }));
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
