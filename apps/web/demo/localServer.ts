import { BALANCE, NPCS, getItem } from '@terrago/game-data';
import {
  DEFAULT_APPEARANCE,
  SIM,
  addItem,
  fromInventorySlots,
  moveItem,
  removeFromSlot,
  settleEnergy,
  tileCenter,
  toInventorySlots,
  type AckResult,
  type DialogueResult,
  type InventoryState,
  type MoveCommand,
} from '@terrago/shared';
import type { CharacterRecord } from '../../game-server/src/world/characterState';
import type { Connection } from '../../game-server/src/world/connection';
import type { Player } from '../../game-server/src/world/player';
import { World } from '../../game-server/src/world/world';
import type { GameSocket } from '../src/game/net/client';
import { loadSave, writeSave, type SaveData } from './localSave';

/**
 * Offline preview: runs TerraGo's real authoritative World (movement rules,
 * collision, interest management, chat, portals) inside the browser, behind an
 * object that looks like a Socket.IO client to the game. Inventory and NPC
 * rules mirror the server and save to this browser instead of PostgreSQL.
 */

const noop = () => {};
const log = { debug: noop, info: noop, warn: noop, error: (m: string, f?: unknown) => console.error(m, f), child: () => log };

type Handler = (...args: unknown[]) => void;

class LocalSocket {
  connected = false;
  private handlers = new Map<string, Set<Handler>>();
  /** Server-side handlers for client events. */
  onClientEvent: (event: string, args: unknown[]) => void = noop;
  onClose: () => void = noop;
  readonly id = `local-${Math.random().toString(36).slice(2)}`;

  on(event: string, fn: Handler) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }

  /** Server → client (asynchronous, in order, like a network). */
  deliver(event: string, ...args: unknown[]) {
    setTimeout(() => this.handlers.get(event)?.forEach((fn) => fn(...args)), 0);
  }

  /** Client → server. */
  emit(event: string, ...args: unknown[]) {
    if (!this.connected) return this;
    setTimeout(() => this.onClientEvent(event, args), 0);
    return this;
  }

  timeout(_ms: number) {
    return {
      emit: (event: string, ...args: unknown[]) => {
        const cb = args.pop() as (err: Error | null, res?: unknown) => void;
        this.emit(event, ...args, (res: unknown) => cb(null, res));
      },
    };
  }

  disconnect() {
    if (!this.connected) return this;
    this.connected = false;
    this.onClose();
    this.deliver('disconnect', 'io client disconnect');
    return this;
  }
}

const BOT_LINES = [
  'Anyone know when the Sunfield homesteads open?',
  'Mayor Lina gave me honey buns!',
  'Heading to the fountain, meet me there.',
  'Selling nothing yet... the market opens soon.',
  'Bram says the mine road is still blocked.',
  'Has anyone been to Whisperwood?',
  'Nice hat!',
];

interface Bot {
  player: Player;
  seq: number;
  dir: [-1 | 0 | 1, -1 | 0 | 1];
  changeAt: number;
  chatAt: number;
}

export class LocalServer {
  readonly world: World;
  private bots: Bot[] = [];
  private save: SaveData | null = loadSave();
  private last = performance.now();

  constructor() {
    this.world = new World({
      log,
      savePositions: async (saves) => {
        const save = this.save;
        if (!save) return;
        for (const s of saves) {
          if (s.id !== save.character.id) continue;
          Object.assign(save.character, { mapId: s.mapId, x: s.x, y: s.y, dir: s.dir });
          writeSave(save);
        }
      },
    });
    setInterval(() => this.tick(), SIM.stepMs);
    setInterval(() => void this.world.saveDirty(), 5000);
    setInterval(() => this.world.pushEnergy(), 5000);
    const flush = () => void this.world.saveDirty();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    this.spawnBots();
  }

  private tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    this.driveBots(Date.now());
    this.world.tick(dt);
  }

  // --- Demo bots (clearly labelled) so you can see how other players move -----

  private spawnBots() {
    const looks = [
      { ...DEFAULT_APPEARANCE, bodyType: 'b' as const, skinTone: 3, hairStyle: 4, hairColor: 8, outfit: 4 },
      { ...DEFAULT_APPEARANCE, skinTone: 5, hairStyle: 1, hairColor: 3, eyeColor: 2, outfit: 1 },
      { ...DEFAULT_APPEARANCE, bodyType: 'b' as const, skinTone: 0, hairStyle: 6, hairColor: 5, eyeColor: 1, outfit: 2 },
    ];
    const names = ['Wren (bot)', 'Pip (bot)', 'Tamsin (bot)'];
    const spots: [number, number][] = [[26, 24], [36, 23], [31, 28]];
    looks.forEach((appearance, i) => {
      const pos = tileCenter(spots[i]![0], spots[i]![1]);
      const rec: CharacterRecord = {
        id: `00000000-0000-4000-8000-00000000b0${i}0`,
        userId: `bot-${i}`,
        name: names[i]!,
        classId: (['archer', 'mage', 'acolyte'] as const)[i]!,
        level: 2 + i * 3,
        xp: 0,
        gold: 0,
        appearance,
        mapId: 'greenhaven',
        x: pos.x,
        y: pos.y,
        dir: 'down',
        stats: { strength: 5, agility: 5, intelligence: 5, vitality: 5, luck: 5 },
        hp: 50,
        mp: 20,
        energy: 100,
        energyUpdatedAt: Date.now(),
      };
      const conn: Connection = { id: `bot-conn-${i}`, send: noop, sendVolatile: noop, close: noop };
      void this.world.join(rec, conn, { capacity: 0, gold: 0, slots: [] }, { sessionId: 'bot', ip: null }).then((player) => {
        this.bots.push({ player, seq: 0, dir: [0, 0], changeAt: 0, chatAt: Date.now() + 8000 + i * 9000 });
      });
    });
  }

  private driveBots(now: number) {
    for (const b of this.bots) {
      if (now > b.changeAt) {
        const options: [-1 | 0 | 1, -1 | 0 | 1][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0], [0, 0], [1, 1], [-1, -1]];
        b.dir = options[Math.floor(Math.random() * options.length)]!;
        b.changeAt = now + 800 + Math.random() * 2200;
        // Stay near the plaza.
        const home = tileCenter(31, 25);
        if (Math.hypot(b.player.x - home.x, b.player.y - home.y) > 9 * 32) {
          b.dir = [Math.sign(home.x - b.player.x) as -1 | 0 | 1, Math.sign(home.y - b.player.y) as -1 | 0 | 1];
        }
      }
      if (b.dir[0] !== 0 || b.dir[1] !== 0) this.world.enqueueMove(b.player, [++b.seq, b.dir[0], b.dir[1]]);
      if (now > b.chatAt) {
        this.world.chat(b.player, BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]!);
        b.chatAt = now + 25_000 + Math.random() * 25_000;
      }
    }
  }

  // --- Connections ---------------------------------------------------------------

  connect(characterId: string): GameSocket {
    const socket = new LocalSocket();
    socket.connected = true;
    let player: Player | null = null;
    const conn: Connection = {
      id: socket.id,
      send: (event, ...args) => socket.deliver(event, ...args),
      sendVolatile: (event, ...args) => socket.deliver(event, ...args),
      close: () => {
        socket.connected = false;
        socket.deliver('disconnect', 'io server disconnect');
      },
    };
    socket.onClose = () => {
      if (player) this.world.detach(player.id, conn);
    };

    setTimeout(async () => {
      socket.deliver('connect');
      this.save = loadSave() ?? this.save;
      const save = this.save;
      if (!save || save.character.id !== characterId) {
        socket.deliver('connect_error', new Error('Character not found.'));
        return;
      }
      const live = this.world.players.get(characterId);
      player = await this.world.join(live ? live.rec : save.character, conn, this.inventoryState(save), { sessionId: 'preview', ip: null });
    }, 30);

    socket.onClientEvent = (event, args) => {
      const p = player;
      if (!p) return;
      const ack = typeof args.at(-1) === 'function' ? (args.pop() as (r: unknown) => void) : noop;
      const reply = <T,>(fn: () => T) => {
        try {
          ack({ ok: true, data: fn() } satisfies AckResult<T>);
        } catch (err) {
          ack({ ok: false, error: (err as Error).message } satisfies AckResult<T>);
        }
      };
      switch (event) {
        case 'move':
          this.world.enqueueMove(p, args[0] as MoveCommand);
          break;
        case 'chat:send':
          reply(() => {
            const r = this.world.chat(p, args[0]);
            if (!r.ok) throw new Error(r.error);
            return { id: r.id };
          });
          break;
        case 'npc:interact':
          reply(() => this.talk(p, String(args[0])));
          break;
        case 'inventory:get':
          reply(() => this.inventoryState(this.save!));
          break;
        case 'inventory:move':
          reply(() => this.moveSlot(p, args[0] as { from: number; to: number }));
          break;
        case 'inventory:use':
          reply(() => this.useSlot(p, (args[0] as { slot: number }).slot));
          break;
        case 'ping:check':
          ack(Date.now());
          break;
        case 'logout':
          void this.world.leave(p).then(() => ack({ ok: true, data: null }));
          break;
      }
    };
    return socket as unknown as GameSocket;
  }

  // --- Inventory and NPC rules (same rules as the server, saved locally) ------

  private inventoryState(save: SaveData): InventoryState {
    return { capacity: save.inventory.capacity, gold: save.character.gold, slots: save.inventory.slots };
  }

  private commitInventory(p: Player, slots: ReturnType<typeof fromInventorySlots>): InventoryState {
    const save = this.save!;
    save.inventory.slots = toInventorySlots(slots);
    writeSave(save);
    const inv = this.inventoryState(save);
    this.world.inventoryCache.set(p.id, inv);
    return inv;
  }

  private moveSlot(p: Player, req: { from: number; to: number }): InventoryState {
    const save = this.save!;
    const slots = fromInventorySlots(save.inventory.slots, save.inventory.capacity);
    const r = moveItem(slots, req?.from, req?.to, (id) => getItem(id));
    if (!r.ok) throw new Error(r.error);
    return this.commitInventory(p, r.slots);
  }

  private useSlot(p: Player, slot: number): { inventory: InventoryState; message: string } {
    const save = this.save!;
    const slots = fromInventorySlots(save.inventory.slots, save.inventory.capacity);
    const s = slots[slot];
    if (!s) throw new Error('That slot is empty.');
    const def = getItem(s.itemId);
    if (!def?.consumable) throw new Error(`${def?.name ?? 'That item'} can't be used right now.`);
    const now = Date.now();
    const settled = settleEnergy(p.rec.energy, p.rec.energyUpdatedAt, now, BALANCE.energy);
    if (settled.energy >= BALANCE.energy.max) throw new Error("You're full of energy already.");
    const r = removeFromSlot(slots, slot, 1);
    if (!r.ok) throw new Error(r.error);
    const energy = Math.min(BALANCE.energy.max, settled.energy + (def.consumable.energy ?? 0));
    p.rec.energy = energy;
    p.rec.energyUpdatedAt = energy >= BALANCE.energy.max ? now : settled.updatedAtMs;
    p.lastEnergySent = energy;
    Object.assign(save.character, { energy: p.rec.energy, energyUpdatedAt: p.rec.energyUpdatedAt });
    const inventory = this.commitInventory(p, r.slots);
    p.conn?.send('self:update', { energy });
    return { inventory, message: `You eat the ${def.name}. Energy +${energy - settled.energy}.` };
  }

  private talk(p: Player, npcId: string): DialogueResult {
    const npc = NPCS.find((n) => n.id === npcId);
    if (!npc) throw new Error('Nobody is there.');
    if (!this.world.npcInRange(p, npc)) throw new Error("You're too far away to talk.");
    const base = { npcId: npc.id, name: npc.name, title: npc.title };
    const save = this.save!;
    const flag = `met:${npc.id}`;
    if (!save.flags.includes(flag) && npc.firstMeeting) {
      const rewards = npc.firstMeeting.rewards ?? [];
      let slots = fromInventorySlots(save.inventory.slots, save.inventory.capacity);
      for (const g of rewards) {
        const def = getItem(g.itemId)!;
        const r = addItem(slots, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: def.bind === 'pickup' }, g.quantity, def.stackSize);
        if (!r.ok) return { ...base, lines: ['Oh! Your bag is completely full. Make a little room and come back — I have something for you.'] };
        slots = r.slots;
      }
      save.flags.push(flag);
      const inv = this.commitInventory(p, slots);
      if (rewards.length) p.conn?.send('inventory:update', inv);
      return { ...base, lines: npc.firstMeeting.lines, rewards };
    }
    if (!save.flags.includes(flag)) {
      save.flags.push(flag);
      writeSave(save);
    }
    return { ...base, lines: npc.greetings[Math.floor(Math.random() * npc.greetings.length)] ?? ['...'] };
  }
}
