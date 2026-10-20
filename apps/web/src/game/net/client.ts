import { io, type Socket } from 'socket.io-client';
import { NPCS, QUESTS, getCrop, getItem, getMap, getNode, getQuest, skillsForClass } from '@terrago/game-data';
import {
  CHAT,
  CODE_DIR,
  INTERACT_RANGE,
  PLAYER_SPEED,
  PROTOCOL_VERSION,
  SIM,
  TILE_SIZE,
  buildCollisionGrid,
  facingFor,
  stepMovement,
  tileCenter,
  cropStatus,
  questsAvailable,
  FISHABLE_TILES,
  PROP_TYPES,
  STATION_PROPS,
  type ActRequest,
  type FishingRound,
  type CombatEvent,
  type PublicMonster,
  type ChatMessage,
  type FarmUpgradeView,
  type ClientToServerEvents,
  type CollisionGrid,
  type Direction,
  type EnterWorldPayload,
  type MapDef,
  type MoveCommand,
  type MoveInput,
  type NpcPublic,
  type PublicPlayer,
  type ServerToClientEvents,
  type Snapshot,
  type WorldObject,
} from '@terrago/shared';
import { api, GAME_SERVER_URL } from '@/lib/api';
import { initialUi, pushNotice, Store, type UiState } from '../store';

interface Sample {
  t: number;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

export interface RemotePlayer {
  info: PublicPlayer;
  samples: Sample[];
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  hp: number;
}

export interface RemoteMonster {
  info: PublicMonster;
  samples: Sample[];
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  /** HP percent (0-100). */
  hp: number;
}

export interface ActionTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  hint: string;
  run: () => void;
}

const STATION_NAMES: Record<string, string> = {
  furnace: 'Furnace',
  anvil: 'Anvil',
  workbench: 'Workbench',
  cooking_pot: 'Cooking Pot',
  alchemy_table: 'Alchemy Table',
  mill: 'Mill',
  loom: 'Loom',
  enhance_altar: 'Enhancement Altar',
};

type ClientEvents = {
  enter: [EnterWorldPayload];
  add: [RemotePlayer];
  remove: [string];
  monsterAdd: [RemoteMonster];
  look: [string];
  monsterRemove: [string];
  combat: [CombatEvent[]];
  chat: [ChatMessage];
  /** Objects added/changed (ids) or removed. */
  objects: [WorldObject[], string[]];
  /** A tile action happened (for effects): tile + kind. */
  acted: [{ tx: number; ty: number; message: string | null }];
};

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Network side of the game client.
 *
 * - Local player: client-side prediction with the same deterministic movement
 *   code the server runs, reconciled against authoritative snapshots.
 * - Remote players: rendered slightly in the past, interpolated between
 *   snapshots, so motion is smooth at any frame rate.
 */
export class GameClient {
  readonly ui = new Store<UiState>({ ...initialUi });
  socket: GameSocket | null = null;

  map: MapDef | null = null;
  grid: CollisionGrid | null = null;
  npcs: NpcPublic[] = [];

  /** Predicted position after the latest input step, and the one before (for render interpolation). */
  pos = { x: 0, y: 0 };
  prevPos = { x: 0, y: 0 };
  dir: Direction = 'down';
  moving = false;
  lastMoveAt = 0;
  /** Visual-only offset that smooths out reconciliation corrections. */
  correction = { x: 0, y: 0 };

  private seq = 0;
  private pending: MoveCommand[] = [];
  private serverOffset: number | null = null;
  readonly remotes = new Map<string, RemotePlayer>();
  readonly monsters = new Map<string, RemoteMonster>();
  private nextAttackAt = 0;
  private attackInFlight = false;
  readonly objects = new Map<string, WorldObject>();
  /** Tile index for quick "what's here?" lookups. */
  private objectsByTile = new Map<string, WorldObject>();
  private listeners = new Map<keyof ClientEvents, Set<(...a: unknown[]) => void>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private ended = false;

  constructor(
    private readonly characterId: string,
    /** Lets the offline preview plug in an in-browser server instead of Socket.IO. */
    private readonly opts: { socketFactory?: () => GameSocket } = {},
  ) {}

  on<K extends keyof ClientEvents>(event: K, fn: (...a: ClientEvents[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    const f = fn as (...a: unknown[]) => void;
    set.add(f);
    return () => set.delete(f);
  }

  private emit<K extends keyof ClientEvents>(event: K, ...args: ClientEvents[K]): void {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }

  connect(): void {
    const socket: GameSocket =
      this.opts.socketFactory?.() ??
      io(GAME_SERVER_URL, {
        path: '/socket.io',
        withCredentials: true,
        transports: ['websocket', 'polling'],
        // Called on every (re)connect: fetch a fresh one-time ticket. Falls back to the
        // session cookie when the game server shares the website's site.
        auth: (cb) => {
          const base = { characterId: this.characterId, protocol: PROTOCOL_VERSION };
          api.gameTicket(this.characterId).then(
            ({ ticket }) => cb({ ...base, ticket }),
            () => cb(base),
          );
        },
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
      });
    this.socket = socket;

    socket.on('connect', () => {
      if (this.ui.get().status !== 'online') this.ui.set({ status: 'connecting', statusMessage: null });
    });
    socket.on('connect_error', (err) => {
      if (this.ended) return;
      // Auth errors from the server middleware are final; network errors retry automatically.
      const msg = err.message;
      const fatal = /log in|not found|banned|suspended|out of date/i.test(msg);
      this.ui.set({ status: fatal ? 'error' : 'reconnecting', statusMessage: fatal ? msg : 'Connection lost. Reconnecting…' });
      if (fatal) socket.disconnect();
    });
    socket.on('disconnect', (reason) => {
      if (this.ended || reason === 'io client disconnect') return;
      this.ui.set({ status: 'reconnecting', statusMessage: 'Connection lost. Reconnecting…' });
    });

    socket.on('world:enter', (p) => this.onEnter(p));
    socket.on('snap', (s) => this.onSnapshot(s));
    socket.on('entity:add', (list) => {
      for (const info of list) {
        if (info.kind === 'monster') {
          const m: RemoteMonster = { info, samples: [], x: info.x, y: info.y, dir: info.dir, moving: false, hp: Math.round((info.hp / info.maxHp) * 100) };
          this.monsters.set(info.id, m);
          this.emit('monsterAdd', m);
          continue;
        }
        const r: RemotePlayer = { info, samples: [], x: info.x, y: info.y, dir: info.dir, moving: false, hp: 100 };
        this.remotes.set(info.id, r);
        this.emit('add', r);
      }
      this.ui.set({ nearby: this.remotes.size });
    });
    socket.on('entity:remove', (ids) => {
      for (const id of ids) {
        if (this.monsters.delete(id)) {
          this.emit('monsterRemove', id);
          if (this.ui.get().targetId === id) this.ui.set({ targetId: null, autoAttack: false });
          continue;
        }
        this.remotes.delete(id);
        this.emit('remove', id);
      }
      this.ui.set({ nearby: this.remotes.size });
    });
    socket.on('combat', (events) => {
      for (const e of events) if (e.k === 'death' && e.t === this.ui.get().targetId) this.ui.set({ targetId: null, autoAttack: false });
      this.emit('combat', events);
    });
    socket.on('effects', ({ effects, cooldowns }) => this.ui.set({ effects, cooldowns }));
    socket.on('quests', (quests) => this.ui.set({ quests }));
    socket.on('duel', (d) => {
      this.ui.set({ duel: d.with ? { ...d.with, until: d.until ?? 0 } : null });
      if (!d.with && this.remotes.has(this.ui.get().targetId ?? '')) this.setTarget(null);
    });
    socket.on('entity:update', (id, patch) => {
      const r = this.remotes.get(id);
      if (!r) return;
      r.info = { ...r.info, ...patch };
      this.emit('look', id);
    });
    socket.on('chat', (m) => {
      this.ui.set((s) => ({ chat: [...s.chat.slice(-79), m] }));
      this.emit('chat', m);
    });
    socket.on('self:update', (patch) => this.ui.set((s) => ({ self: s.self ? { ...s.self, ...patch } : s.self })));
    socket.on('inventory:update', (inventory) => this.ui.set((s) => ({ inventory: { ...inventory, equipment: inventory.equipment ?? s.inventory?.equipment ?? [] } })));
    socket.on('notice', (n) => pushNotice(this.ui, n.kind, n.text));
    socket.on('fish:bite', ({ id }) => {
      const f = this.ui.get().fishing;
      if (f?.id === id && f.phase === 'waiting') this.ui.set({ fishing: { ...f, phase: 'bite' } });
    });
    socket.on('objects:set', (list) => {
      for (const o of list) this.putObject(o);
      this.emit('objects', list, []);
    });
    socket.on('objects:remove', (ids) => {
      for (const id of ids) {
        const o = this.objects.get(id);
        if (o) this.objectsByTile.delete(`${o.x},${o.y}`);
        this.objects.delete(id);
      }
      this.emit('objects', [], ids);
    });
    socket.on('session:end', ({ reason }) => {
      this.ended = true;
      this.ui.set({ status: 'ended', statusMessage: reason });
      socket.disconnect();
    });

    this.pingTimer = setInterval(() => {
      if (!socket.connected) return;
      const sent = performance.now();
      socket.emit('ping:check', Date.now(), () => this.ui.set({ ping: Math.round(performance.now() - sent) }));
    }, 4000);
  }

  disconnect(): void {
    this.ended = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.disconnect();
    this.socket = null;
  }

  // ---------------------------------------------------------------------------

  private onEnter(p: EnterWorldPayload): void {
    const map = getMap(p.map.id);
    if (!map) {
      this.ui.set({ status: 'error', statusMessage: `Unknown map ${p.map.id}. Please refresh.` });
      return;
    }
    this.map = map;
    this.npcs = p.npcs;
    this.grid = buildCollisionGrid(map, p.npcs.map((n) => ({ x: n.x, y: n.y })));
    this.pos = { x: p.position.x, y: p.position.y };
    this.prevPos = { ...this.pos };
    this.dir = p.position.dir;
    this.correction = { x: 0, y: 0 };
    this.pending = [];
    this.seq = Math.max(this.seq, p.ack);
    this.serverOffset = p.serverTime - Date.now();
    this.remotes.clear();
    this.monsters.clear();
    this.objects.clear();
    this.objectsByTile.clear();
    for (const o of p.objects) this.putObject(o);
    const prevMap = this.ui.get().mapId;
    this.ui.set((s) => ({
      status: 'online',
      statusMessage: null,
      self: p.self,
      inventory: p.inventory,
      mapId: map.id,
      mapName: p.map.name,
      mapOwnerId: p.map.owner?.id ?? null,
      plotMenu: null,
      nearby: 0,
      chat: prevMap === null && s.chat.length === 0 ? p.recentChat : s.chat,
    }));
    if (prevMap && prevMap !== map.id) pushNotice(this.ui, 'info', `Entering ${p.map.name}`);
    this.emit('enter', p);
  }

  private onSnapshot(s: Snapshot): void {
    if (!this.grid) return;
    const sample = s.t - Date.now();
    this.serverOffset = this.serverOffset === null ? sample : this.serverOffset + (sample - this.serverOffset) * 0.08;

    // Reconcile: start from the authoritative position, replay unacknowledged inputs.
    this.pending = this.pending.filter((c) => c[0] > s.ack);
    let p = { x: s.x, y: s.y };
    for (const [, dx, dy] of this.pending) p = stepMovement(p, { dx, dy }, this.grid, PLAYER_SPEED * this.speed(), SIM.stepMs);
    const ex = this.pos.x - p.x;
    const ey = this.pos.y - p.y;
    if (ex !== 0 || ey !== 0) {
      if (Math.hypot(ex, ey) < 48) {
        this.correction.x += ex;
        this.correction.y += ey;
      }
      this.pos = p;
      this.prevPos = { ...p };
    }
    if (this.pending.length === 0) this.dir = CODE_DIR[s.dir] ?? this.dir;

    for (const [id, x, y, d, moving, hp] of s.e) {
      const r = this.remotes.get(id) ?? this.monsters.get(id);
      if (!r) continue;
      r.hp = hp ?? r.hp;
      r.samples.push({ t: s.t, x, y, dir: CODE_DIR[d] ?? 'down', moving: moving === 1 });
      if (r.samples.length > 30) r.samples.splice(0, r.samples.length - 30);
    }
  }

  /** Advance the local player by one fixed simulation step. */
  step(input: MoveInput): void {
    this.prevPos = { ...this.pos };
    const s = this.socket;
    if (!this.grid || !s?.connected || this.ui.get().status !== 'online') return;
    this.combatStep();
    if ((this.ui.get().self?.hp ?? 1) <= 0) return; // defeated: wait for respawn
    if (input.dx === 0 && input.dy === 0) {
      if (performance.now() - this.lastMoveAt > 120) this.moving = false;
      return;
    }
    if (this.pending.length > 40) return; // server isn't acknowledging; don't run ahead
    if (this.ui.get().fishing) this.cancelFishing();
    const cmd: MoveCommand = [++this.seq, input.dx, input.dy];
    this.pending.push(cmd);
    s.emit('move', cmd);
    const next = stepMovement(this.pos, input, this.grid, PLAYER_SPEED * this.speed(), SIM.stepMs);
    this.dir = facingFor(input, this.dir);
    this.moving = true;
    this.lastMoveAt = performance.now();
    this.pos = next;
  }

  /** Move remote players to where they were `interpolationDelayMs` ago. */
  interpolateRemotes(): void {
    const renderT = Date.now() + (this.serverOffset ?? 0) - SIM.interpolationDelayMs;
    for (const r of [...this.remotes.values(), ...this.monsters.values()]) {
      const s = r.samples;
      if (s.length === 0) continue;
      let i = s.length - 1;
      while (i > 0 && s[i - 1]!.t > renderT) i--;
      const b = s[i]!;
      const a = i > 0 ? s[i - 1]! : b;
      if (renderT >= b.t || a === b) {
        r.x = b.x;
        r.y = b.y;
        r.dir = b.dir;
        r.moving = b.moving && renderT - b.t < 200;
      } else {
        const k = Math.max(0, Math.min(1, (renderT - a.t) / (b.t - a.t)));
        r.x = a.x + (b.x - a.x) * k;
        r.y = a.y + (b.y - a.y) * k;
        r.dir = k < 0.5 ? a.dir : b.dir;
        r.moving = a.moving || b.moving || a.x !== b.x || a.y !== b.y;
      }
    }
  }

  private putObject(o: WorldObject): void {
    const old = this.objects.get(o.id);
    if (old) this.objectsByTile.delete(`${old.x},${old.y}`);
    this.objects.set(o.id, o);
    this.objectsByTile.set(`${o.x},${o.y}`, o);
  }

  objectAt(tx: number, ty: number): WorldObject | undefined {
    return this.objectsByTile.get(`${tx},${ty}`);
  }

  /** Current server time estimate (crop growth is computed from server timestamps). */
  serverNow(): number {
    return Date.now() + (this.serverOffset ?? 0);
  }

  /** The tile in front of the player's feet. */
  targetTile(): { x: number; y: number } {
    const fx = Math.floor(this.pos.x / TILE_SIZE);
    const fy = Math.floor((this.pos.y - 4) / TILE_SIZE);
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.dir] as [number, number];
    return { x: fx + dx, y: fy + dy };
  }

  private bestTool(kind: string): number {
    let tier = -1;
    for (const s of this.ui.get().inventory?.slots ?? []) {
      const t = getItem(s.itemId)?.tool;
      if (t?.kind === kind && (s.durability === null || s.durability > 0)) tier = Math.max(tier, t.tier);
    }
    return tier;
  }

  /** What the action key would do at a tile (object, crafting station or water), if anything. */
  targetAt(tx: number, ty: number): ActionTarget | null {
    const o = this.objectAt(tx, ty);
    if (o) {
      const hint = this.describeAction(o);
      return hint ? { x: o.x, y: o.y, w: 1, h: 1, hint, run: () => this.act(o.x, o.y) } : null;
    }
    const map = this.map;
    if (!map) return null;
    for (const p of map.objects) {
      if (p.kind !== 'prop' || !(STATION_PROPS as readonly string[]).includes(p.type)) continue;
      const d = PROP_TYPES[p.type];
      if (tx >= p.x && tx < p.x + d.w && ty >= p.y && ty < p.y + d.h) {
        const name = STATION_NAMES[p.type] ?? p.type;
        return { x: p.x, y: p.y, w: d.w, h: d.h, hint: `Use ${name}`, run: () => this.ui.set(p.type === 'enhance_altar' ? { panel: 'enhance' } : { panel: 'craft', station: p.type }) };
      }
    }
    const tile = map.tiles[ty]?.[tx];
    if (tile && FISHABLE_TILES.has(tile) && map.fishing) {
      if (this.bestTool('rod') < 0) return null;
      const f = this.ui.get().fishing;
      return { x: tx, y: ty, w: 1, h: 1, hint: f ? 'Reel in!' : 'Fish', run: () => this.fishAction(tx, ty) };
    }
    return null;
  }

  /** The target in front of the player, else the one underfoot. */
  actionTarget(): ActionTarget | null {
    const t = this.targetTile();
    return this.targetAt(t.x, t.y) ?? this.targetAt(Math.floor(this.pos.x / TILE_SIZE), Math.floor((this.pos.y - 4) / TILE_SIZE));
  }

  /** Describe what pressing the action key on an object will do. */
  describeAction(o: WorldObject): string | null {
    if (o.kind === 'drop') return o.ownerId === this.ui.get().self?.characterId ? `Pick up ${getItem(o.itemId)?.name ?? 'loot'}` : null;
    if (o.kind === 'node') {
      const def = getNode(o.type);
      if (!def) return null;
      if (o.depletedUntil > this.serverNow()) return `${def.name} (used up)`;
      const verb = def.tool === 'pickaxe' ? 'Mine' : def.tool === 'axe' ? 'Chop' : 'Gather';
      const lvl = this.ui.get().self?.skills[def.skill]?.level ?? 1;
      if (lvl < def.level) return `${def.name} — needs ${def.skill} ${def.level}`;
      if (def.tool && this.bestTool(def.tool) < 0) return `${def.name} — needs ${def.tool === 'axe' ? 'an axe' : 'a pickaxe'}`;
      return `${verb} ${def.name}`;
    }
    if (o.kind !== 'plot') return null;
    const self = this.ui.get().self;
    const owner = this.ui.get().mapOwnerId;
    if (!self || owner !== self.characterId) return null;
    if (o.locked) return 'Locked plot';
    const now = this.serverNow();
    if (o.crop) {
      const def = getCrop(o.crop.cropId);
      if (!def) return null;
      const st = cropStatus(o.crop, def, now);
      if (st.ready) return `Harvest ${def.name}`;
      if (!st.watered) return `Water ${def.name}`;
      return `${def.name} ${Math.floor(st.progress * 100)}%`;
    }
    if (!o.tilled) return 'Till soil';
    const inv = this.ui.get().inventory;
    const sel = inv?.slots.find((s) => s.slot === this.ui.get().selectedSlot);
    const selDef = sel ? getItem(sel.itemId) : undefined;
    if (selDef?.tool?.kind === 'can') return 'Water';
    const seed = selDef?.category === 'seed' ? selDef : inv?.slots.map((s) => getItem(s.itemId)).find((d) => d?.category === 'seed');
    if (seed) return `Plant ${seed.name.replace(/ Seed$/, '')}`;
    return o.wetUntil > now ? 'No seeds' : 'Water';
  }

  nearestNpc(): NpcPublic | null {
    let best: NpcPublic | null = null;
    let bestD = INTERACT_RANGE - 4;
    for (const n of this.npcs) {
      const c = tileCenter(n.x, n.y);
      const d = Math.hypot(c.x - this.pos.x, c.y - this.pos.y);
      if (d <= bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  // --- Actions ---------------------------------------------------------------

  interact(): void {
    const npc = this.nearestNpc();
    if (!npc || !this.socket) return;
    this.socket.emit('npc:interact', npc.id, (res) => {
      if (res.ok) this.ui.set({ dialogue: res.data });
      else pushNotice(this.ui, 'error', res.error);
    });
  }

  speed(): number {
    return this.ui.get().self?.speed ?? 1;
  }

  async acceptQuest(npcId: string, questId: string): Promise<void> {
    try {
      await this.request('quest:accept', { npcId, questId });
      this.ui.set({ questOffer: null });
      pushNotice(this.ui, 'success', 'Quest accepted!');
    } catch (e) {
      pushNotice(this.ui, 'error', (e as Error).message);
    }
  }

  async completeQuest(npcId: string, questId: string): Promise<void> {
    try {
      const r = await this.request<{ gold: number; xp: number; items: { itemId: string; quantity: number }[] }>('quest:complete', { npcId, questId });
      this.ui.set({ questReward: { questId, ...r } });
    } catch (e) {
      pushNotice(this.ui, 'error', (e as Error).message);
    }
  }

  /** Where the tracked quest wants you to go next: { map, x, y } in tiles, or null. */
  questTarget(): { map: string; x: number; y: number; label: string } | null {
    const quests = this.ui.get().quests.filter((q) => !q.done);
    const q = quests[0];
    if (!q) {
      // Nothing active: point at whoever offers the next quest.
      const offer = questsAvailable(QUESTS, this.ui.get().quests)[0];
      const npc = offer ? NPCS.find((n) => n.id === offer.giver) : undefined;
      return npc ? { map: npc.mapId, x: npc.x, y: npc.y, label: npc.name } : null;
    }
    const def = getQuest(q.id);
    if (!def) return null;
    if (q.step >= def.steps.length) {
      const npc = NPCS.find((n) => n.id === def.turnIn);
      return npc ? { map: npc.mapId, x: npc.x, y: npc.y, label: npc.name } : null;
    }
    const st = def.steps[q.step]!;
    if (st.type === 'talk') {
      const npc = NPCS.find((n) => n.id === st.target);
      if (npc) return { map: npc.mapId, x: npc.x, y: npc.y, label: npc.name };
    }
    return st.where ? { ...st.where, label: '' } : null;
  }

  toggleMount(): void {
    this.socket?.emit('mount:toggle', (res) => {
      if (!res.ok) pushNotice(this.ui, 'error', res.error, 2500);
    });
  }

  // --- Combat ------------------------------------------------------------------

  /** Pixel distance from the player to a monster (as the server measures it). */
  private reach(m: RemoteMonster): number {
    return Math.hypot(this.pos.x - m.x, this.pos.y - 5 - (m.y - 6));
  }

  /** Nearest living monster within `tiles`. */
  nearestMonster(tiles = 9): RemoteMonster | null {
    let best: RemoteMonster | null = null;
    let bestD = tiles * TILE_SIZE;
    for (const m of this.monsters.values()) {
      const d = this.reach(m);
      if (m.hp > 0 && d < bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  setTarget(id: string | null, engage = false): void {
    this.ui.set({ targetId: id, autoAttack: engage && !!id });
  }

  /** Attack key: engage the current target, or the nearest monster. */
  attackKey(): void {
    const ui = this.ui.get();
    let id = ui.targetId && (this.monsters.has(ui.targetId) || ui.duel?.id === ui.targetId) ? ui.targetId : null;
    if (!id && ui.duel && this.remotes.has(ui.duel.id)) id = ui.duel.id;
    if (!id) id = this.nearestMonster()?.info.id ?? null;
    if (!id) return pushNotice(this.ui, 'info', 'No monster nearby.', 1500);
    this.setTarget(id, true);
    this.nextAttackAt = 0;
  }

  /** Auto-attack while engaged and in range (the server checks everything again). */
  private combatStep(): void {
    const ui = this.ui.get();
    if (!ui.autoAttack || !ui.targetId || this.attackInFlight) return;
    const m = this.monsters.get(ui.targetId) ?? (ui.duel?.id === ui.targetId ? this.remotes.get(ui.targetId) : undefined);
    if (!m) return this.setTarget(null);
    const range = this.weaponRange();
    if (Math.hypot(this.pos.x - m.x, this.pos.y - 5 - (m.y - 6)) > (range + 0.4) * TILE_SIZE || performance.now() < this.nextAttackAt) return;
    this.attackInFlight = true;
    this.socket?.emit('attack', m.info.id, (res) => {
      this.attackInFlight = false;
      if (res.ok) this.nextAttackAt = performance.now() + res.data.cooldownMs;
      else if (res.error === 'cooldown') this.nextAttackAt = performance.now() + 150;
      else {
        this.nextAttackAt = performance.now() + 500;
        if (!/far/i.test(res.error)) pushNotice(this.ui, 'error', res.error, 1500);
        if (/line of sight/i.test(res.error)) this.nextAttackAt = performance.now() + 900;
        if (/No target|No fighting/.test(res.error)) this.setTarget(null);
      }
    });
  }

  weaponRange(): number {
    const eq = this.ui.get().inventory?.equipment?.find((e) => e.slot === 0);
    return (eq && getItem(eq.itemId)?.equip?.range) || 1.4;
  }

  /** Use class skill number `n` (0-based) on the current target. */
  useSkill(n: number): void {
    const self = this.ui.get().self;
    if (!self) return;
    const sk = skillsForClass(self.classId)[n];
    if (!sk) return;
    if (self.level < sk.level) return pushNotice(this.ui, 'info', `${sk.name} unlocks at level ${sk.level}.`, 2000);
    let target = this.ui.get().targetId;
    const duelFoe = this.ui.get().duel?.id;
    if ((sk.kind === 'attack' || sk.kind === 'debuff' || (sk.kind === 'aoe' && sk.range > 0)) && !(target && (this.monsters.has(target) || target === duelFoe))) {
      target = this.nearestMonster()?.info.id ?? null;
      if (target) this.setTarget(target, true);
    }
    this.socket?.emit('skill', { skillId: sk.id, targetId: target }, (res) => {
      if (!res.ok && res.error !== 'cooldown') pushNotice(this.ui, 'error', res.error, 1800);
    });
  }

  /** The action key / button: talk to a nearby NPC, else use the tile in front. */
  primaryAction(): void {
    const f = this.ui.get().fishing;
    if (f) return f.phase === 'reeling' ? undefined : this.fishAction(f.x, f.y);
    if (this.ui.get().dialogue) return;
    if (this.nearestNpc()) return this.interact();
    this.actionTarget()?.run();
  }

  /** Cast, or hook a biting fish. */
  fishAction(tx: number, ty: number): void {
    const f = this.ui.get().fishing;
    const s = this.socket;
    if (!s?.connected) return;
    if (!f) return this.act(tx, ty);
    if (f.phase === 'reeling') return;
    s.emit('fish:hook', f.id, (res) => {
      if (!res.ok) {
        this.ui.set({ fishing: null });
        pushNotice(this.ui, 'error', res.error, 2500);
        return;
      }
      this.ui.set({ fishing: { ...f, phase: 'reeling', round: res.data } });
    });
  }

  /** Send a finished reeling round; the server replays it and decides. */
  reel(round: FishingRound, toggles: number[], steps: number): void {
    this.socket?.emit('fish:reel', { id: round.id, toggles, steps }, (res) => {
      this.ui.set({ fishing: null });
      if (!res.ok) pushNotice(this.ui, 'error', res.error);
      else pushNotice(this.ui, res.data.caught ? 'success' : 'error', res.data.message, 4000);
    });
  }

  cancelFishing(): void {
    if (!this.ui.get().fishing) return;
    this.socket?.emit('fish:cancel');
    this.ui.set({ fishing: null });
  }

  craft(recipeId: string, times: number) {
    return this.run('craft', { recipeId, times });
  }

  liftFloors(npcId: string): Promise<{ floors: number[] }> {
    return this.request('lift:floors', npcId);
  }

  liftGo(npcId: string, floor: number) {
    return this.run('lift:go', { npcId, floor });
  }

  /** Use the action key on a tile (server decides: till, plant, water, harvest...). */
  act(tx: number, ty: number, mode?: ActRequest['mode']): void {
    const s = this.socket;
    if (!s?.connected) return;
    const req: ActRequest = { tx, ty, slot: this.ui.get().selectedSlot, ...(mode ? { mode } : {}) };
    s.emit('act', req, (res) => {
      if (!res.ok) {
        if (!/slow down/i.test(res.error)) pushNotice(this.ui, 'error', res.error, 2500);
        return;
      }
      this.emit('acted', { tx, ty, message: res.data.message });
      if (res.data.fishing) {
        this.ui.set({ fishing: { id: res.data.fishing.id, x: tx, y: ty, phase: 'waiting', round: null } });
        return;
      }
      const o = this.objectAt(tx, ty);
      const info = res.data.message && /% grown/.test(res.data.message);
      if (info && o) this.ui.set({ plotMenu: o.id });
      else if (res.data.message) pushNotice(this.ui, 'success', res.data.message, 2500);
    });
  }

  private request<T>(event: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const s = this.socket as unknown as { connected: boolean; timeout: (ms: number) => { emit: (...a: unknown[]) => void } } | null;
      if (!s?.connected) return reject(new Error('Not connected.'));
      s.timeout(8000).emit(event, ...args, (err: unknown, res: { ok: boolean; data?: T; error?: string }) => {
        if (err) return reject(new Error('The server did not answer. Try again.'));
        if (!res.ok) return reject(new Error(res.error ?? 'Failed.'));
        resolve(res.data as T);
      });
    });
  }

  /** Run a request; show its message (or error) as a notice. */
  private async run<T extends { message?: string }>(event: string, ...args: unknown[]): Promise<T | null> {
    try {
      const data = await this.request<T>(event, ...args);
      if (data?.message) pushNotice(this.ui, 'success', data.message);
      return data;
    } catch (e) {
      pushNotice(this.ui, 'error', (e as Error).message);
      return null;
    }
  }

  async openShop(npcId: string): Promise<void> {
    try {
      const shop = await this.request<import('@terrago/shared').ShopView>('shop:get', npcId);
      this.ui.set({ shop, serviceNpc: npcId, panel: 'shop' });
    } catch (e) {
      pushNotice(this.ui, 'error', (e as Error).message);
    }
  }

  buy(itemId: string, quantity: number) {
    return this.run('shop:buy', { npcId: this.ui.get().serviceNpc, itemId, quantity });
  }

  sell(slot: number, quantity: number) {
    return this.run('shop:sell', { npcId: this.ui.get().serviceNpc, slot, quantity });
  }

  farmInfo(npcId: string): Promise<FarmUpgradeView> {
    return this.request<FarmUpgradeView>('farm:info', npcId);
  }

  farmUpgrade(npcId: string) {
    return this.run('farm:upgrade', npcId);
  }

  repairQuote(npcId: string): Promise<{ cost: number; items: number }> {
    return this.request('repair:quote', npcId);
  }

  repairAll(npcId: string) {
    return this.run('repair:all', npcId);
  }

  sendChat(text: string): Promise<boolean> {
    return new Promise((resolve) => {
      const t = text.trim().slice(0, CHAT.maxLength);
      if (!t || !this.socket) return resolve(false);
      this.socket.timeout(5000).emit('chat:send', t, (err, res) => {
        if (err) {
          pushNotice(this.ui, 'error', 'Message not sent (timeout).');
          return resolve(false);
        }
        if (!res.ok) pushNotice(this.ui, 'error', res.error);
        resolve(res.ok);
      });
    });
  }

  moveItem(from: number, to: number): void {
    this.socket?.emit('inventory:move', { from, to }, (res) => {
      if (res.ok) this.ui.set({ inventory: res.data });
      else pushNotice(this.ui, 'error', res.error);
    });
  }

  equip(from: number) {
    return this.run('equip', { from });
  }

  unequip(slot: number) {
    return this.run('unequip', { slot });
  }

  async enhance(equipSlot: number): Promise<void> {
    try {
      const r = await this.request<{ success: boolean; message: string }>('enhance', { equipSlot });
      pushNotice(this.ui, r.success ? 'success' : 'error', r.message, 4000);
    } catch (e) {
      pushNotice(this.ui, 'error', (e as Error).message);
    }
  }

  selectSlot(slot: number): void {
    this.ui.set({ selectedSlot: slot });
  }

  useItem(slot: number): void {
    this.socket?.emit('inventory:use', { slot }, (res) => {
      if (res.ok) {
        this.ui.set({ inventory: res.data.inventory });
        pushNotice(this.ui, 'success', res.data.message);
      } else pushNotice(this.ui, 'error', res.error);
    });
  }

  logout(): Promise<void> {
    return new Promise((resolve) => {
      const s = this.socket;
      if (!s?.connected) {
        this.disconnect();
        return resolve();
      }
      this.ended = true;
      s.timeout(3000).emit('logout', () => {
        this.disconnect();
        resolve();
      });
    });
  }

  /** Current tile, for the HUD/map. */
  tile(): { x: number; y: number } {
    return { x: Math.floor(this.pos.x / TILE_SIZE), y: Math.floor(this.pos.y / TILE_SIZE) };
  }
}
