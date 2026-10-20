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
import { getNpc, talkToNpc } from '../services/npcs';
import type { CharacterRecord } from '../world/characterState';
import type { Connection } from '../world/connection';
import type { Player } from '../world/player';
import type { World } from '../world/world';
import { act, craftAt, npcServices } from './gameplay';
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
      if (player) world.detach(player.id, conn);
      log.debug('socket_disconnect', { characterId: character.id, reason });
    });

    void (async () => {
      try {
        // In-world characters keep their live state; only load from the DB when entering fresh.
        const live = world.players.get(character.id);
        const inventory = live ? (world.inventoryCache.get(character.id) ?? (await getInventory(pool, character.id))) : await getInventory(pool, character.id);
        if (closed) return;
        player = await world.join(live ? live.rec : character, conn, inventory, { sessionId, ip });
        if (closed) world.detach(player.id, conn);
        else registerHandlers(socket, player);
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
    socket.on('move', (cmd) => world.enqueueMove(p, cmd));

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
          const res = await useItem(pool, p.id, slot as number);
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

    socket.on('act', (req, ack) => serial(ack, () => act(g, p, req)));
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
