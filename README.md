# TERAGO ONLINE

A real-time multiplayer 2D fantasy MMORPG that runs in a desktop web browser. Full design: [`SPEC.md`](./SPEC.md). Current build status: [`docs/PROGRESS.md`](./docs/PROGRESS.md). Build log/decisions: [`docs/DECISIONS.md`](./docs/DECISIONS.md). Module layout and protocol: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Setup

```
npm install
```

> **Note for this dev sandbox:** if `npm install` fails with `ENOTFOUND registry.npmjs.org`, the environment's proxy config is excluding the registry from the proxy it actually needs. Run instead:
> ```
> npm_config_noproxy="" NO_PROXY="" no_proxy="" npm install
> ```

## Running

```
npm run dev
```

Starts the game server (WebSocket, fixed 20 Hz tick) and the client (Vite + Phaser) together. The client opens on `http://localhost:5173`; the server listens on `ws://localhost:8080`.

## Dev commands

- `npm test` — Vitest unit tests (shared formulas, server systems)
- `npm run test:e2e` — Playwright smoke test (two browser contexts)
- `npm run typecheck` — TypeScript, no emit, across all three workspaces
- `npm run build` — production build of server + client

In dev mode, chat commands like `/level 50`, `/give potion_hp 10`, `/tp 5`, `/spawn slime`, `/boss gatekeeper` are available for testing (see `SPEC.md` §2, `server/src/devtools/commands.ts`).

## Replacing placeholder art

No final art exists yet. Every sprite, tile, and sound is generated procedurally and referenced through `client/src/assets/manifest.json`. To swap in real art: drop the file in `client/src/assets/`, point the matching manifest entry at it, and the generator is skipped for that key automatically. No code changes needed.

## Project structure

```
shared/   Types, zod schemas, formulas, data config — consumed as TS source by both apps
server/   Node + ws game server, SQLite persistence, server-authoritative simulation
client/   Vite + Phaser game client, DOM overlay UI
docs/     Architecture, progress, decisions
```
