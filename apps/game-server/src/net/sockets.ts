import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  PROTOCOL_VERSION,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@terrago/shared';
import { SESSION_COOKIE, accountBlockReason, getSession, parseCookies, type SessionUser } from '../auth/sessions';
import type { TicketStore } from '../auth/tickets';
import type { Config } from '../config';
import { GameError, type Pool } from '../db';
import { clientIp } from '../http/router';
import type { Logger } from '../logger';
import type { Metrics } from '../metrics';
import type { SecurityEvents } from '../security/events';
import { TokenBucket } from '../security/rateLimit';
import { loadCharacter, useItem } from '../services/characters';
import { getInventory, moveInventoryItem } from '../services/inventory';
import { getItem } from '@terrago/game-data';
import { getNpc, talkToNpc } from '../services/npcs';
import type { CharacterRecord } from '../world/characterState';
import type { Connection } from '../world/connection';
import type { Player } from '../world/player';
import type { World } from '../world/world';
import { act, chooseSpecialization, craftAt, gear, market, npcServices, questDialogueActions, questEvent, questServices, startQuests, toggleMount } from './gameplay';
import * as social from './social';
import * as journal from './journal';
import * as eco from './economy';
import { antibot } from '../security/antibot';
import { cancelTrade, confirmTrade, lockTrade, requestTrade, respondTrade, setOffer } from './trade';
import { grantStarterWeapon } from '../services/equipment';
import { cancelFishing, hook, reel } from './fishing';

interface SocketData {
  userId: string;
  sessionId: string;
  ip: string | null;
  character: CharacterRecord;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export type GameIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface Deps {
  config: Config;
  pool: Pool;
  world: World;
  log: Logger;
  security: SecurityEvents;
  metrics: Metrics;
  tickets: TicketStore;
}

type UntypedEmitter = { emit: (event: string, ...args: unknown[]) => boolean };

/** Above this backlog a client is congested: skip snapshots (newer ones supersede them). */
const MAX_PENDING_PACKETS = 12;
const MAX_BUFFERED_BYTES = 256 * 1024;

function toConnection(socket: GameSocket, metrics: Metrics): Connection {
  const s = socket as unknown as UntypedEmitter;
  const engine = socket.conn as unknown as { writeBuffer?: unknown[]; transport?: { socket?: { bufferedAmount?: number } } };
  return {
    id: socket.id,
    // Call through the socket object so `this` stays bound.
    send: (event, ...args) => void s.emit(event, ...args),
    // Socket.IO's own `volatile` flag drops a packet whenever any other packet was
    // sent earlier in the same tick (the transport is briefly "not writable"),
    // which loses snapshots for no reason. Drop only when the client is truly behind.
    sendVolatile: (event, ...args) => {
      const pending = engine.writeBuffer?.length ?? 0;
      const buffered = engine.transport?.socket?.bufferedAmount ?? 0;
      if (pending > MAX_PENDING_PACKETS || buffered > MAX_BUFFERED_BYTES) {
        metrics.snapshotsDropped++;
        return;
      }
      metrics.snapshotsSent++;
      s.emit(event, ...args);
    },
    close: () => {
      socket.disconnect(true);
    },
  };
}

export function attachSockets(httpServer: HttpServer, deps: Deps): GameIo {
  const { config, pool, world, log, security, metrics, tickets } = deps;

  /** Resolve the player from a one-time ticket (cross-site deployments) or the session cookie. */
  async function authenticate(auth: { ticket?: unknown; characterId?: unknown }, cookieHeader: string | undefined): Promise<SessionUser | null> {
    if (auth.ticket !== undefined) {
      const t = tickets.consume(auth.ticket);
      if (!t || t.characterId !== auth.characterId) return null;
      const { rows } = await pool.query(
        `SELECT u.email, u.roles, u.status, u.banned_until
           FROM player_sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
        [t.sessionId, t.userId],
      );
      const r = rows[0];
      return r ? { sessionId: t.sessionId, userId: t.userId, email: r.email, roles: r.roles, status: r.status, bannedUntil: r.banned_until } : null;
    }
    return getSession(pool, parseCookies(cookieHeader)[SESSION_COOKIE], config.sessionTtlMs);
  }

  const io: GameIo = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: config.webOrigins, credentials: true },
    // Browsers always send Origin on WebSocket handshakes; reject other sites
    // (cross-site WebSocket hijacking protection — CORS alone doesn't cover WS).
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !!origin && config.webOrigins.includes(origin));
    },
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    perMessageDeflate: false,
    httpCompression: false,
  });

  // --- Authentication: session cookie + owned character -----------------------
  io.use(async (socket, next) => {
    const ip = clientIp(socket.request, config.trustProxy);
    try {
      const auth = socket.handshake.auth as { characterId?: unknown; protocol?: unknown; ticket?: unknown };
      if (auth.protocol !== PROTOCOL_VERSION) return next(new Error('Game client is out of date. Please refresh the page.'));
      const user = await authenticate(auth, socket.request.headers.cookie);
      if (!user) {
        security.record('socket_auth_failed', { ip, details: { reason: 'no_session' } }, 10_000);
        return next(new Error('Please log in again.'));
      }
      const blocked = accountBlockReason(user);
      if (blocked) return next(new Error(blocked));
      const character = typeof auth.characterId === 'string' ? await loadCharacter(pool, user.userId, auth.characterId) : null;
      if (!character) {
        security.record('socket_auth_failed', { userId: user.userId, ip, details: { reason: 'character_not_owned' } }, 10_000);
        return next(new Error('Character not found.'));
      }
      socket.data = { userId: user.userId, sessionId: user.sessionId, ip, character };
      next();
    } catch (err) {
      log.error('socket_auth_error', { err });
      next(new Error('Could not connect. Please try again.'));
    }
  });

  io.on('connection', (socket: GameSocket) => {
    metrics.sockets++;
    const conn = toConnection(socket, metrics);
    const { character, userId, sessionId, ip } = socket.data;
    let player: Player | null = null;
    let closed = false;

    // Flood guard: legitimate clients send ~20 movement packets/s plus the odd action.
    const bucket = new TokenBucket(60, 40 / 1000);
    socket.use((_packet, next) => {
      metrics.eventsIn++;
      if (bucket.take()) return next();
      security.record('socket_flood', { userId, characterId: character.id, ip }, 30_000);
      socket.disconnect(true);
    });

    socket.on('disconnect', (reason) => {
      closed = true;
      metrics.sockets--;
      if (player) {
        cancelTrade(player, 'Trade cancelled — your partner left.');
        world.detach(player.id, conn);
      }
      log.debug('socket_disconnect', { characterId: character.id, reason });
    });

    void (async () => {
      try {
        // In-world characters keep their live state; only load from the DB when entering fresh.
        const live = world.players.get(character.id);
        if (!live) await grantStarterWeapon(pool, character.id, character.classId);
        const inventory = live ? (world.inventoryCache.get(character.id) ?? (await getInventory(pool, character.id))) : await getInventory(pool, character.id);
        if (!live) character.equipment = inventory.equipment ?? [];
        if (closed) return;
        player = await world.join(live ? live.rec : character, conn, inventory, { sessionId, ip });
        if (closed) world.detach(player.id, conn);
        else {
          registerHandlers(socket, player);
          if (live) player.conn?.send('quests', player.quests);
          else await startQuests({ pool, world, log }, player);
          await social.onJoin({ pool, world, log }, player, !live);
          if (!live) journal.track({ pool, world, log }, player, 'level', player.rec.level, 'max');
          if (player.mount) player.conn?.send('self:update', { mount: player.mount, speed: player.speed });
          if (player.duel) player.conn?.send('duel', { with: { id: player.duel.with.id, name: player.duel.with.name }, until: player.duel.until });
        }
      } catch (err) {
        log.error('join_failed', { err, characterId: character.id });
        socket.emit('session:end', { reason: 'Could not enter the world. Please try again.' });
        socket.disconnect(true);
      }
    })();
  });

  function respond<T>(ack: unknown, work: () => Promise<T> | T): void {
    if (typeof ack !== 'function') return;
    const reply = ack as Ack<T>;
    Promise.resolve()
      .then(work)
      .then(
        (data) => reply({ ok: true, data }),
        (err) => {
          if (err instanceof GameError) return reply({ ok: false, error: err.message });
          log.error('socket_handler_error', { err });
          reply({ ok: false, error: 'Something went wrong.' });
        },
      );
  }

  function registerHandlers(socket: GameSocket, p: Player): void {
    socket.on('move', (cmd) => {
      if (p.stall && Array.isArray(cmd) && (cmd[1] || cmd[2])) eco.closeStall({ pool, world, log }, p);
      world.enqueueMove(p, cmd);
    });

    socket.on('chat:send', (text, ack) =>
      respond(ack, () => {
        const res = world.chat(p, text);
        if (!res.ok) throw new GameError(res.error);
        return { id: res.id };
      }),
    );

    socket.on('npc:interact', (npcId, ack) =>
      respond(ack, () =>
        p.serial(async () => {
          const npc = getNpc(npcId);
          if (!npc) throw new GameError('Nobody is there.');
          if (!world.npcInRange(p, npc)) throw new GameError("You're too far away to talk.");
          const { dialogue, inventory } = await talkToNpc(pool, p.id, npc);
          questEvent({ pool, world, log }, p, 'talk', npc.id);
          const qa = questDialogueActions(p, npc.id);
          if (qa.length) dialogue.actions = [...qa, ...(dialogue.actions ?? [])];
          if (inventory) {
            world.inventoryCache.set(p.id, inventory);
            p.conn?.send('inventory:update', inventory);
          }
          return dialogue;
        }),
      ),
    );

    socket.on('inventory:get', (ack) =>
      respond(ack, () =>
        p.serial(async () => {
          const inv = await getInventory(pool, p.id);
          world.inventoryCache.set(p.id, inv);
          return inv;
        }),
      ),
    );

    socket.on('inventory:move', (req, ack) =>
      respond(ack, () =>
        p.serial(async () => {
          const from = (req as { from?: unknown })?.from;
          const to = (req as { to?: unknown })?.to;
          if (!Number.isInteger(from) || !Number.isInteger(to)) throw new GameError('Invalid slot.');
          const inv = await moveInventoryItem(pool, p.id, from as number, to as number);
          world.inventoryCache.set(p.id, inv);
          return inv;
        }),
      ),
    );

    socket.on('inventory:use', (req, ack) =>
      respond(ack, () =>
        p.serial(async () => {
          const slot = (req as { slot?: unknown })?.slot;
          if (!Number.isInteger(slot)) throw new GameError('Invalid slot.');
          const inv = world.inventoryCache.get(p.id)?.slots.find((x) => x.slot === slot);
          const cons = inv ? getItem(inv.itemId)?.consumable : undefined;
          if (cons && !cons.energy && ((cons.hp && !cons.mp && p.rec.hp >= p.profile.maxHp) || (cons.mp && !cons.hp && p.rec.mp >= p.profile.maxMp))) {
            throw new GameError(cons.hp ? "You're already at full health." : 'Your MP is already full.');
          }
          if (p.dead) throw new GameError("You can't do that right now.");
          const petDef = inv ? getItem(inv.itemId)?.pet : undefined;
          if (inv && petDef) {
            // Pets aren't used up: using one calls it to your side (or sends it home).
            const next = p.pet === inv.itemId ? null : inv.itemId;
            await pool.query('UPDATE characters SET pet = $2 WHERE id = $1', [p.id, next]);
            p.pet = next;
            world.broadcastLook(p, { pet: next });
            const name = getItem(inv.itemId)!.name;
            return { inventory: world.inventoryCache.get(p.id)!, message: next ? `${name} is following you.` : `${name} went home.` };
          }
          const res = await useItem(pool, p.id, slot as number);
          p.rec.hp = Math.min(p.profile.maxHp, p.rec.hp + res.hp);
          p.rec.mp = Math.min(p.profile.maxMp, p.rec.mp + res.mp);
          p.conn?.send('self:update', { hp: p.rec.hp, mp: p.rec.mp });
          p.rec.energy = res.energy;
          p.rec.energyUpdatedAt = res.energyUpdatedAt;
          p.lastEnergySent = res.energy;
          world.inventoryCache.set(p.id, res.inventory);
          p.conn?.send('self:update', { energy: res.energy });
          return { inventory: res.inventory, message: res.message };
        }),
      ),
    );

    const g = { pool, world, log };
    const serial = <T>(ack: unknown, fn: () => Promise<T> | T) => respond(ack, () => p.serial(async () => fn()));

    socket.on('act', (req, ack) => {
      antibot?.action(p);
      serial(ack, () => act(g, p, req));
    });
    socket.on('shop:get', (npcId, ack) => serial(ack, () => npcServices.shopGet(g, p, npcId)));
    socket.on('shop:buy', (req, ack) => serial(ack, () => npcServices.shopBuy(g, p, req)));
    socket.on('shop:sell', (req, ack) => serial(ack, () => npcServices.shopSell(g, p, req)));
    socket.on('farm:info', (npcId, ack) => serial(ack, () => npcServices.farmInfo(g, p, npcId)));
    socket.on('farm:upgrade', (npcId, ack) => serial(ack, () => npcServices.farmUpgrade(g, p, npcId)));
    socket.on('repair:quote', (npcId, ack) => serial(ack, () => npcServices.repairQuote(g, p, npcId)));
    socket.on('repair:all', (npcId, ack) => serial(ack, () => npcServices.repair(g, p, npcId)));
    socket.on('fish:hook', (id, ack) => respond(ack, () => hook(p, id)));
    socket.on('fish:reel', (req, ack) => serial(ack, () => reel(g, p, req)));
    socket.on('fish:cancel', () => cancelFishing(p));
    socket.on('craft', (req, ack) => serial(ack, () => craftAt(g, p, req)));
    socket.on('equip', (req, ack) => serial(ack, () => gear.equip(g, p, req)));
    socket.on('mount:toggle', (ack) => respond(ack, () => toggleMount(g, p)));
    socket.on('market:search', (q, ack) => respond(ack, () => market.search(g, p, q)));
    socket.on('market:mine', (ack) => respond(ack, () => market.mine(g, p)));
    socket.on('market:list', (req, ack) => serial(ack, () => market.list(g, p, req)));
    socket.on('market:buy', (id, ack) => serial(ack, () => market.buy(g, p, id)));
    socket.on('market:cancel', (id, ack) => serial(ack, () => market.cancel(g, p, id)));
    socket.on('trade:request', (id, ack) => respond(ack, () => requestTrade(g, p, id)));
    socket.on('trade:respond', (req, ack) => respond(ack, () => respondTrade(g, p, req)));
    socket.on('trade:offer', (req, ack) => respond(ack, () => setOffer(g, p, req)));
    socket.on('trade:lock', (ack) => respond(ack, () => lockTrade(p)));
    socket.on('trade:confirm', (ack) => serial(ack, () => confirmTrade(g, p)));
    socket.on('trade:cancel', () => cancelTrade(p));
    socket.on('bank:get', (npcId, ack) => serial(ack, () => eco.bank.get(g, p, npcId)));
    socket.on('bank:move', (req, ack) => serial(ack, () => eco.bank.move(g, p, req)));
    socket.on('bank:upgrade', (npcId, ack) => serial(ack, () => eco.bank.upgrade(g, p, npcId)));
    socket.on('travel:list', (ack) => respond(ack, () => eco.travelList(g, p)));
    socket.on('travel:go', (mapId, ack) => serial(ack, () => eco.travelGo(g, p, mapId)));
    socket.on('stall:open', (req, ack) => respond(ack, () => eco.openStall(g, p, req)));
    socket.on('stall:close', (ack) => respond(ack, () => eco.closeStall(g, p)));
    socket.on('stall:view', (id, ack) => respond(ack, () => eco.viewStall(g, p, id)));
    socket.on('stall:buy', (req, ack) => serial(ack, () => eco.buyStall(g, p, req)));
    socket.on('animals:get', (ack) => respond(ack, () => eco.animals.get(g, p)));
    socket.on('animals:add', (slot, ack) => serial(ack, () => eco.animals.add(g, p, slot)));
    socket.on('animals:feed', (ack) => serial(ack, () => eco.animals.feed(g, p)));
    socket.on('animals:collect', (ack) => serial(ack, () => eco.animals.collect(g, p)));
    socket.on('dungeon:enter', (req, ack) => serial(ack, () => eco.enterDungeon(g, p, req)));
    socket.on('spec:choose', (req, ack) => serial(ack, () => chooseSpecialization(g, p, req)));
    socket.on('journal:get', (ack) => respond(ack, () => journal.journal(g, p)));
    socket.on('daily:login', (ack) => serial(ack, () => journal.claimLogin(g, p)));
    socket.on('daily:task', (id, ack) => serial(ack, () => journal.claimTask(g, p, id)));
    socket.on('leaderboard:get', (id, ack) => respond(ack, () => journal.leaderboard(g, p, id)));
    socket.on('party:invite', (id, ack) => respond(ack, () => social.partyInvite(g, p, id)));
    socket.on('party:leave', (ack) => respond(ack, () => social.partyLeave(p)));
    socket.on('party:kick', (id, ack) => respond(ack, () => social.partyKick(g, p, id)));
    socket.on('invite:respond', (req, ack) => serial(ack, () => social.respondInvite(g, p, req)));
    socket.on('friends:get', (ack) => respond(ack, () => social.friendsView(g, p)));
    socket.on('friends:add', (name, ack) => respond(ack, () => social.friendAdd(g, p, name)));
    socket.on('friends:remove', (id, ack) => serial(ack, () => social.friendRemove(g, p, id)));
    socket.on('block:set', (req, ack) => serial(ack, () => social.blockSet(g, p, req)));
    socket.on('report', (req, ack) => respond(ack, () => social.report(g, p, req)));
    socket.on('profile:get', (id, ack) => respond(ack, () => social.profile(g, p, id)));
    socket.on('guild:get', (ack) => respond(ack, () => social.guild.get(g, p)));
    socket.on('guild:create', (req, ack) => serial(ack, () => social.guild.create(g, p, req)));
    socket.on('guild:invite', (name, ack) => respond(ack, () => social.guild.invite(g, p, name)));
    socket.on('guild:leave', (ack) => serial(ack, () => social.guild.leave(g, p)));
    socket.on('guild:kick', (id, ack) => serial(ack, () => social.guild.kick(g, p, id)));
    socket.on('guild:rank', (req, ack) => serial(ack, () => social.guild.rank(g, p, req)));
    socket.on('guild:treasury', (req, ack) => serial(ack, () => social.guild.treasury(g, p, req)));
    socket.on('guild:motd', (text, ack) => serial(ack, () => social.guild.motd(g, p, text)));
    socket.on('quest:accept', (req, ack) => serial(ack, () => questServices.accept(g, p, req)));
    socket.on('quest:complete', (req, ack) => serial(ack, () => questServices.complete(g, p, req)));
    socket.on('unequip', (req, ack) => serial(ack, () => gear.unequip(g, p, req)));
    socket.on('enhance', (req, ack) => serial(ack, () => gear.enhance(g, p, req)));
    socket.on('attack', (targetId, ack) => {
      antibot?.action(p);
      respond(ack, () => {
        const res = world.combat.attack(world.runtimeOf(p), p, targetId);
        if (typeof res === 'string') throw new GameError(res);
        return res;
      });
    });
    socket.on('skill', (req, ack) =>
      respond(ack, () => {
        const r = (req ?? {}) as { skillId?: unknown; targetId?: unknown };
        const res = world.combat.useSkill(world.runtimeOf(p), p, r.skillId, r.targetId, (id) => world.players.get(id));
        if (typeof res === 'string') throw new GameError(res);
        return res;
      }),
    );
    socket.on('lift:floors', (npcId, ack) => serial(ack, () => npcServices.liftFloors(g, p, npcId)));
    socket.on('lift:go', (req, ack) => serial(ack, () => npcServices.liftGo(g, p, req)));

    socket.on('ping:check', (_t, ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('logout', (ack) =>
      respond(ack, async () => {
        await world.leave(p);
        return null;
      }),
    );
  }

  return io;
}
