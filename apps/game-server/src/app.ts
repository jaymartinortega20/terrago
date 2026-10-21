import { createServer, type Server as HttpServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { runMigrations } from '@terrago/database';
import { BALANCE, validateGameData } from '@terrago/game-data';
import { SIM } from '@terrago/shared';
import { TicketStore } from './auth/tickets';
import type { Config } from './config';
import { createPool, type Pool } from './db';
import { buildRouter } from './http/routes';
import { sendJson } from './http/router';
import type { Logger } from './logger';
import { Metrics } from './metrics';
import { attachSockets, type GameIo } from './net/sockets';
import { SecurityEvents } from './security/events';
import { savePositions } from './services/characters';
import { chatCommand, onLeave as socialLeave } from './net/social';
import { ChatLog } from './services/chatLog';
import { syncItemDefinitions } from './services/itemsSync';
import { World } from './world/world';
import { combatHooks, loadMapObjects, onMapEntered, type GameplayDeps } from './net/gameplay';

export interface GameServer {
  config: Config;
  http: HttpServer;
  io: GameIo;
  world: World;
  pool: Pool;
  metrics: Metrics;
  /** Actual bound port (useful when PORT=0 in tests). */
  port(): number;
  stop(): Promise<void>;
}

/** Build and start the authoritative game server: HTTP API + Socket.IO + world loop. */
export async function startGameServer(config: Config, log: Logger): Promise<GameServer> {
  const dataErrors = validateGameData();
  if (dataErrors.length) throw new Error(`Game data is invalid:\n${dataErrors.join('\n')}`);

  const pool = createPool(config.databaseUrl, config.dbPoolMax);
  pool.on('error', (err) => log.error('db_pool_error', { err }));
  if (config.migrateOnStart) {
    const res = await runMigrations(pool, (m) => log.info(m));
    if (res.applied.length) log.info('migrations_applied', { applied: res.applied });
  }
  await syncItemDefinitions(pool);

  const security = new SecurityEvents(pool, log);
  const chatLog = new ChatLog(pool, log);
  const world: World = new World({
    log,
    savePositions: (s) => savePositions(pool, s),
    onChat: (e) => chatLog.add(e),
    onCommand: (p, cmd, rest) => chatCommand({ pool, world, log }, p, cmd, rest),
    onLeave: (p) => socialLeave({ pool, world, log }, p),
    security,
    loadObjects: (def, owner) => loadMapObjects(pool, def, owner),
    onMapEnter: (p) => void onMapEntered({ pool, world, log }, p).catch((err) => log.error('map_enter_hook_failed', { err })),
    combat: combatHooks((): GameplayDeps => ({ pool, world, log })),
  });
  const metrics = new Metrics(world, pool);
  const tickets = new TicketStore();
  const router = buildRouter({ config, pool, log, security, world, metrics, tickets });

  const http = createServer((req, res) => {
    router.handle(req, res).catch((err) => {
      log.error('http_unhandled', { err });
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal error.' });
    });
  });
  http.headersTimeout = 15_000;
  http.requestTimeout = 20_000;
  const io = attachSockets(http, { config, pool, world, log, security, metrics, tickets });

  // --- Fixed-rate simulation loop (self-correcting, no drift) -------------------
  let running = true;
  let last = performance.now();
  let next = last + SIM.stepMs;
  let loopTimer: NodeJS.Timeout | null = null;
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    const t0 = performance.now();
    try {
      world.tick(dt);
    } catch (err) {
      log.error('tick_error', { err });
    }
    metrics.recordTick(performance.now() - t0);
    next += SIM.stepMs;
    if (now - next > 1000) next = now + SIM.stepMs; // fell far behind (e.g. debugger): don't spiral
    loopTimer = setTimeout(loop, Math.max(0, next - performance.now()));
  };
  loopTimer = setTimeout(loop, SIM.stepMs);

  const saveTimer = setInterval(() => void world.saveDirty(), BALANCE.persistence.positionSaveIntervalMs);
  const energyTimer = setInterval(() => world.pushEnergy(), 5_000);

  await new Promise<void>((resolve) => http.listen(config.port, config.host, resolve));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  log.info('server_started', { port, env: config.env, origins: config.webOrigins });

  let stopping: Promise<void> | null = null;
  return {
    config,
    http,
    io,
    world,
    pool,
    metrics,
    port: () => port,
    stop: () =>
      (stopping ??= (async () => {
        running = false;
        if (loopTimer) clearTimeout(loopTimer);
        clearInterval(saveTimer);
        clearInterval(energyTimer);
        await world.shutdown();
        io.close();
        await chatLog.close();
        await new Promise<void>((resolve) => http.close(() => resolve()));
        await pool.end();
        log.info('server_stopped');
      })()),
  };
}
