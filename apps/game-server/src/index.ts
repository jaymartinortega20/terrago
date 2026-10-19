import { startGameServer } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

const config = loadConfig();
const log = createLogger(config.logLevel, { service: 'terrago-game-server' });

const server = await startGameServer(config, log).catch((err) => {
  log.error('startup_failed', { err });
  process.exit(1);
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutdown_requested', { signal });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.stop().then(
      () => process.exit(0),
      (err) => {
        log.error('shutdown_failed', { err });
        process.exit(1);
      },
    );
  });
}

process.on('unhandledRejection', (err) => log.error('unhandled_rejection', { err }));
