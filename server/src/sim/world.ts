/**
 * Owns every Room (one per map in shared/config/maps.ts) and everything
 * that crosses between them: which room each connected character is
 * currently in, portal/waystone/`/tp` transitions, chat fan-out (map vs.
 * global), dev-command gating and execution, and the 60s autosave sweep
 * (SPEC.md: "save on key events and every 60s" - key events save
 * themselves immediately inside sim/room.ts; this is just the sweep).
 *
 * This is the top-level entry point net/socket.ts's Connection handlers
 * delegate to (via a thin adapter in server/src/index.ts) - a World never
 * touches a raw WebSocket itself, just like a Room doesn't.
 */
import { BALANCE, MAPS, type ClientMessage, type ServerMessage } from '@terago/shared';
import type { Repository } from '../db/repository.js';
import { parseDevCommand } from '../devtools/commands.js';
import { Room, type PlayerEntity, type PortalTransition } from './room.js';

export interface WorldOptions {
  /** SPEC.md section 2: dev chat commands are "development mode only". */
  devToolsEnabled?: boolean;
  roll01?: () => number;
  now?: () => number;
}

export class World {
  private readonly repo: Repository;
  private readonly rooms = new Map<string, Room>();
  private readonly characterRoom = new Map<string, string>();
  private readonly devToolsEnabled: boolean;
  private autosaveAccumulatorMs = 0;

  constructor(repo: Repository, options: WorldOptions = {}) {
    this.repo = repo;
    this.devToolsEnabled = options.devToolsEnabled ?? false;
    for (const map of Object.values(MAPS)) {
      this.rooms.set(map.id, new Room(map, repo, { roll01: options.roll01, now: options.now }));
    }
  }

  getRoom(mapId: string): Room | undefined {
    return this.rooms.get(mapId);
  }

  getCharacterMapId(characterId: string): string | undefined {
    return this.characterRoom.get(characterId);
  }

  /** Places a freshly-authenticated character into whichever room their
   * persisted `mapId` names. */
  join(characterId: string, send: (message: ServerMessage) => void): void {
    const row = this.repo.getCharacterById(characterId);
    if (!row) throw new Error(`World.join: unknown character ${characterId}`);
    const room = this.rooms.get(row.mapId);
    if (!room) throw new Error(`World.join: character ${characterId}'s mapId "${row.mapId}" has no matching room`);
    room.join(characterId, send);
    this.characterRoom.set(characterId, room.mapId);
  }

  leave(characterId: string): void {
    const mapId = this.characterRoom.get(characterId);
    if (!mapId) return;
    this.rooms.get(mapId)?.leave(characterId);
    this.characterRoom.delete(characterId);
  }

  handleMessage(characterId: string, message: ClientMessage): void {
    const mapId = this.characterRoom.get(characterId);
    const room = mapId ? this.rooms.get(mapId) : undefined;
    const player = room?.players.get(characterId);
    if (!room || !player) return; // message arrived after leave(), or before join() - just drop it

    switch (message.t) {
      case 'move:to':
        room.handleMoveTo(player, message.target);
        break;
      case 'move:dir':
        room.handleMoveDir(player, message.dx, message.dy);
        break;
      case 'target:set':
        room.handleTargetSet(player, message.entityId);
        break;
      case 'hotbar:use':
        room.handleHotbarUse(player, message.slot);
        break;
      case 'hotbar:assign':
        room.handleHotbarAssign(player, message.slot, message.binding);
        break;
      case 'equip:item':
        room.handleEquip(player, message.itemInstanceId);
        break;
      case 'unequip:slot':
        room.handleUnequip(player, message.slot);
        break;
      case 'stat:allocate':
        room.handleStatAllocate(player, message.stat, message.points);
        break;
      case 'mount:toggle':
        room.handleMountToggle(player);
        break;
      case 'auto:toggle':
        room.handleAutoToggle(player, message.on);
        break;
      case 'auto:configure':
        room.handleAutoConfigure(player, {
          autoTargetMobs: message.autoTargetMobs,
          autoUsePotionsHpPct: message.autoUsePotionsHpPct,
          autoUsePotionsResourcePct: message.autoUsePotionsResourcePct,
          autoCastLowTierSkills: message.autoCastLowTierSkills,
        });
        break;
      case 'chat:send':
        this.handleChat(room, player, message.channel, message.text);
        break;
      case 'dev:command':
        this.handleDevCommand(room, player, message.line);
        break;
      case 'intro:seen':
        room.handleIntroSeen(player);
        break;
      case 'auth:login':
      case 'auth:register':
        // Never reach here: net/socket.ts's Connection only forwards a
        // message to its onMessage handler (which calls this) once a
        // session already exists, and auth:* is exactly what creates one.
        break;
    }
  }

  tick(dtSeconds: number): void {
    for (const room of this.rooms.values()) {
      const transitions = room.tick(dtSeconds);
      for (const transition of transitions) this.applyPortalTransition(room, transition);
    }

    this.autosaveAccumulatorMs += dtSeconds * 1000;
    if (this.autosaveAccumulatorMs >= BALANCE.autosaveIntervalMs) {
      this.autosaveAccumulatorMs = 0;
      for (const room of this.rooms.values()) room.autosaveDirtyPlayers();
    }
  }

  private applyPortalTransition(fromRoom: Room, transition: PortalTransition): void {
    this.moveCharacterToMap(fromRoom, transition.characterId, transition.toMapId, transition.x, transition.y);
  }

  /** Removes a character from their current room, repositions their
   * persisted row, and joins them into the destination room - the one
   * sequence shared by portals, Waystone travel (M2+) and `/tp`. */
  private moveCharacterToMap(fromRoom: Room, characterId: string, toMapId: string, x: number, y: number): void {
    const player = fromRoom.players.get(characterId);
    if (!player) return;
    const toRoom = this.rooms.get(toMapId);
    if (!toRoom) return; // bad map id - nothing sane to do but leave them where they are

    const send = player.send;
    fromRoom.leave(characterId); // persists the old position, harmlessly - overwritten next line
    this.repo.saveCharacter(characterId, { mapId: toRoom.mapId, x, y });
    toRoom.join(characterId, send);
    this.characterRoom.set(characterId, toRoom.mapId);
  }

  private handleChat(room: Room, player: PlayerEntity, channel: 'global' | 'map' | 'system', text: string): void {
    // dev:command is the only entry point for dev commands (docs/DECISIONS.md)
    // - chat:send text is always real chat, even if it happens to start with
    // "/"; routing slash-prefixed chat-box input into dev:command instead is
    // the client's job.
    const message: ServerMessage = { t: 'chat:message', channel, speaker: player.name, text };
    if (channel === 'global') {
      for (const r of this.rooms.values()) r.broadcastToRoom(message, null, true);
    } else {
      room.broadcastToRoom(message, null, true);
    }
  }

  private handleDevCommand(room: Room, player: PlayerEntity, line: string): void {
    if (!this.devToolsEnabled) {
      player.send({ t: 'system:announce', text: 'Dev commands are disabled on this server.' });
      return;
    }

    const cmd = parseDevCommand(line);
    switch (cmd.kind) {
      case 'level':
        room.devSetBaseLevel(player, cmd.n);
        player.send({ t: 'system:announce', text: `Base Level set to ${player.baseLevel}.` });
        break;
      case 'joblevel':
        room.devSetJobLevel(player, cmd.n);
        player.send({ t: 'system:announce', text: `Job Level set to ${player.jobLevel}.` });
        break;
      case 'give': {
        const ok = room.devGiveItem(player, cmd.itemId, cmd.qty);
        player.send({
          t: 'system:announce',
          text: ok ? `Gave ${cmd.qty}x ${cmd.itemId}.` : `Unknown item: ${cmd.itemId}`,
        });
        break;
      }
      case 'tp': {
        const toRoom = this.rooms.get(cmd.mapId);
        if (!toRoom) {
          player.send({ t: 'system:announce', text: `Unknown map: ${cmd.mapId}` });
          break;
        }
        const spawn = toRoom.getMapDef().spawnPoint;
        this.moveCharacterToMap(room, player.characterId, toRoom.mapId, spawn.x, spawn.y);
        break;
      }
      case 'spawn': {
        const ok = room.devSpawnMonsterAt(cmd.monsterId, Math.round(player.x), Math.round(player.y));
        player.send({
          t: 'system:announce',
          text: ok ? `Spawned ${cmd.monsterId}.` : `Unknown monster: ${cmd.monsterId}`,
        });
        break;
      }
      case 'boss':
        player.send({ t: 'system:announce', text: 'Bosses are not implemented yet.' });
        break;
      case 'unknown':
        player.send({ t: 'system:announce', text: `Unknown dev command: ${cmd.raw}` });
        break;
    }
  }
}
