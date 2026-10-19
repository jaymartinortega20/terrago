# Testing TerraGo

| Suite | Command | What it covers | Result (v0.1) |
| --- | --- | --- | --- |
| Unit | `npm run test:unit` | Movement determinism, wall collision, corner assist, diagonal speed, map bounds; inventory stacking/move/remove and item conservation; names and profanity; XP curve; timestamp Energy; password hashing; cookies; rate limiters; config; world runtime (visibility, area of interest, speed-hack and malformed-packet rejection, portals, chat radius and rate limit, reconnect grace, duplicate login, one character per account, shutdown save); game-data integrity (every spawn, NPC and portal reachable) | **62 / 62 pass** |
| Integration | `npm run test:integration` | Real PostgreSQL + Socket.IO clients against the real server: registration/login/logout, generic login errors + security log, CSRF/Origin checks, character creation through the Gold/item ledgers, name uniqueness and slot limit, the v0.1 flow at protocol level, foreign-character and anonymous socket rejection, cross-site WebSocket refusal, teleport/garbage packets ignored, flood disconnect, NPC range check, **welcome gift granted exactly once under 5 concurrent requests**, inventory move/use persisted, **40 concurrent inventory moves conserve every item**, positions and inventory survive a **server restart**, one-time game tickets (connect without cookies, single use, bound to character, revoked by logout) | **17 / 17 pass** |
| End-to-end | `npm run test:e2e` | The v0.1 success test in two real Chromium browsers with separate sessions (below) | **12 / 12 checks pass** |
| Load | `npm run loadtest -- --bots 100 --duration 120` | Bots connect, walk, change maps, chat, request inventory; server metrics sampled every 5 s | See below |

Integration tests use the `terrago_test` database (created by `docker compose up -d db`; override with `TEST_DATABASE_URL`).

## Version 0.1 success test (two real browsers)

`scripts/e2e-two-players.mjs` drives the production build of the website and the game server:

| Check | Result |
| --- | --- |
| Browser A registers, creates a character, enters Greenhaven | ✅ |
| Browser B does the same | ✅ |
| Player A sees Player B / Player B sees Player A | ✅ / ✅ |
| Player A walks (keyboard) | ✅ moved 151 px |
| Player B sees the movement | ✅ first visible ~430 ms after the key press* |
| B's view of A ends exactly where A is | ✅ identical to 0.01 px |
| A says "Hello"; B sees "A_…: Hello" in chat (and as a speech bubble) | ✅ |
| Browser A refreshes and reconnects as the same character | ✅ |
| …at the saved position, with the same inventory | ✅ exact |
| A still sees B; B sees exactly one A (no ghost) | ✅ |
| Bonus: B walks to Mayor Lina, talks, receives Charter + 2 Honey Buns, opens the bag | ✅ |

\* The ~430 ms is measured from Playwright's key press in one headless browser to a position change observed by polling another headless browser, on a 2-vCPU machine that is also running the server, database and website with software-rendered WebGL (~25 FPS). It includes up to 50 ms input sampling, up to 50 ms server tick, up to 100 ms until the next snapshot, and the **deliberate 160 ms interpolation buffer** that keeps remote movement smooth. On real hardware the browser-side overhead mostly disappears; internet latency is added on top.

The same 12 checks also pass in the **cross-site production shape** used for free hosting: website on `localhost:3000`, game server on `127.0.0.1:4000` (browsers treat these as different sites, like `*.vercel.app` and `*.onrender.com`), server in `NODE_ENV=production`, REST through the website's `/api` proxy and the game connection authenticated by one-time tickets.

The offline preview page (`npm run build:preview -w @terrago/web`) was tested in Chromium: character creation, three labelled bots visible and moving, walking, chat, Mayor Lina's gift, and reload-and-continue at the same position with the same bag, with no page errors.

Mobile (iPhone 13 landscape emulation): the virtual joystick moves the character, chat can be opened and sent from the Chat button, and the Menu → Inventory sheet opens and scrolls.

## Load test results

Environment: one 2-vCPU / 8 GB container running the **production server bundle**, PostgreSQL 16, and the bot process together. Traffic goes over localhost, so the latency numbers exclude internet latency. **Re-run on the real VPS before promising capacity** (see `docs/deployment.md`).

| Metric | 100 bots, 120 s | 200 bots, 60 s |
| --- | --- | --- |
| Errors / unexpected disconnects | 0 / 0 | 0 / 0 |
| Snapshots received per bot per second (target 10) | 9.9 | 9.7 |
| Snapshots dropped for congestion | 0 | 0 |
| Socket round-trip p50 / p95 / p99 | 0.4 / 2.3 / 4.6 ms | 0.4 / 13.8 / 19.6 ms |
| Server tick time p99 (budget 50 ms) | 7.2 ms (max 12.5) | 23.8 ms (max 40.6) |
| Event-loop delay p99 | 13.9 ms | 27.3 ms |
| Server CPU (average at full load) | 16.5 % | 34.4 % |
| Server memory (RSS) | ≈ 240 MB | ≈ 250 MB |
| DB pool in use / waiting | 6 / 0 | 10 / 0 |
| Map changes, chats sent → delivered, inventory requests | 34, 371 → 8,934, 934 | 123, 317 → 20,186, 902 |

The 200-bot run puts nearly everyone in the same town square (worst case for interest management: every snapshot carries ~170 neighbours). Tick time grows with players-in-view squared, which is the expected scaling limit of a single process; zones/processes and Redis are the next step (see `docs/architecture.md`).

CPU briefly spikes when many bots log in at once (password hashing is intentionally expensive).

### Bugs found and fixed by testing

* **Snapshot loss under load.** Socket.IO's `volatile` flag drops a packet whenever another packet was written in the same tick, so ~55% of snapshots were silently lost at 100 players. Replaced with congestion-based dropping (only when a client's send buffer is actually backed up) — now 0 dropped, full 10 Hz delivery.
* **Slow-device walking speed.** Phaser smooths its frame delta toward 60 FPS, so at 20 FPS the fixed-step input loop ran at a third of real time. The input loop now uses real elapsed time.
* Port `0` for tests, a detached `socket.emit` losing `this`, a React StrictMode double-mount that could start two Phaser games, label overlaps and the mobile layout.

## Running everything locally

```bash
docker compose up -d db
npm install
npm run test:unit
npm run test:integration

# end-to-end (needs the stack running)
npm run dev            # or: build both apps and start them
npm run test:e2e       # screenshots in test-results/e2e

# load test (server must allow bot registrations)
DISABLE_RATE_LIMITS=true npm run dev:server
npm run loadtest -- --bots 100 --duration 120
```
