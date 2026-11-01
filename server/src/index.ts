/**
 * TERAGO ONLINE server entry point: HTTP server (for future health checks /
 * static asset serving) + WebSocket upgrade, wired to the World sim and the
 * fixed-rate tick loop. Everything here is thin glue - `net/socket.ts`
 * (`Connection`) owns the wire protocol, `sim/world.ts` (`World`) owns the
 * simulation, `sim/tick.ts` drives it at `BALANCE.tickRateHz`.
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { openDatabase } from './db/database.js';
import { createSqliteRepository } from './db/repository.js';
import { Connection } from './net/socket.js';
import { World } from './sim/world.js';
import { startTickLoop } from './sim/tick.js';

// docs/DECISIONS.md: no numbers given by SPEC.md for any of these, so
// they're plain env-configurable defaults rather than hardcoded constants.
const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = process.env.TERAGO_DB_PATH ?? './data/terago.sqlite';
// Dev chat commands (/level, /give, /tp, ...) are "development mode only"
// per SPEC.md section 2 - off unless explicitly opted into.
const DEV_TOOLS_ENABLED = process.env.TERAGO_DEV_TOOLS === '1' || process.env.TERAGO_DEV_TOOLS === 'true';

const db = openDatabase(DB_PATH);
const repo = createSqliteRepository(db);
const world = new World(repo, { devToolsEnabled: DEV_TOOLS_ENABLED });

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  // eslint-disable-next-line no-new -- Connection wires itself to `ws`'s
  // events in its constructor; it's intentionally fire-and-forget here.
  new Connection(ws, repo, {
    onAuthenticated(conn, session) {
      try {
        world.join(session.character.id, (message) => conn.send(message));
      } catch (error) {
        console.error(`World.join failed for character ${session.character.id}:`, error);
        conn.close(1011, 'join failed');
      }
    },
    onMessage(_conn, session, message) {
      try {
        world.handleMessage(session.character.id, message);
      } catch (error) {
        console.error(`World.handleMessage threw for character ${session.character.id}:`, error);
      }
    },
    onClose(_conn, session) {
      if (!session) return;
      try {
        world.leave(session.character.id);
      } catch (error) {
        console.error(`World.leave threw for character ${session.character.id}:`, error);
      }
    },
  });
});

const tickLoop = startTickLoop(world);

httpServer.listen(PORT, () => {
  console.log(
    `TERAGO ONLINE server listening on :${PORT}${DEV_TOOLS_ENABLED ? ' (dev tools enabled)' : ''} - db: ${DB_PATH}`
  );
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  tickLoop.stop();
  wss.close();
  httpServer.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
