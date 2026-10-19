# TerraGo architecture (v0.1)

```
 Browser (Vercel-hosted Next.js page)                 VPS (Singapore)
 ┌───────────────────────────────────┐   HTTPS    ┌────────────────────────────────────────┐
 │ Next.js pages (landing, auth,     │──REST────▶ │ Caddy (TLS, WSS)                       │
 │ character select)                 │            │   └─▶ game-server (Node.js, 1 process) │
 │                                   │   WSS      │        ├─ HTTP API (auth, characters)  │
 │ Phaser world view + React HUD     │◀─Socket.IO▶│        ├─ Socket.IO gateway            │
 │  └─ GameClient: prediction,       │            │        ├─ World (20 Hz simulation)     │
 │     reconciliation, interpolation │            │        └─ services (inventory, NPCs…)  │
 └───────────────────────────────────┘            │ PostgreSQL 16 (persistent state)      │
                                                  └────────────────────────────────────────┘
```

## Monorepo

| Path | What lives there |
| --- | --- |
| `apps/web` | Next.js (App Router) + React + Tailwind site and the Phaser game client. Deployed to Vercel. |
| `apps/game-server` | The authoritative server: REST API, Socket.IO gateway, world simulation, persistence. Deployed to the VPS. |
| `packages/shared` | Code both sides must agree on: protocol types, movement/collision (deterministic), validation, inventory rules, XP curve, profanity filter. |
| `packages/game-data` | JSON data: items, classes, NPCs and dialogue, balance values, maps (+ the map generator). |
| `packages/database` | SQL migrations and the migration runner. |
| `scripts` | Dev runner, two-browser end-to-end test, 100-bot load test. |
| `deploy` | Dockerfile, production compose, Caddyfile, backup script. |

## The server is authoritative

The browser is untrusted. Clients send **intent**, never results:

| Client sends | Server decides |
| --- | --- |
| `move [seq, dx, dy]` (dx, dy ∈ {-1, 0, 1}) | Where the player actually is (speed, walls, map bounds, portals) |
| `chat:send text` | Sanitised, profanity-masked text and who hears it |
| `npc:interact npcId` | Whether you're close enough, what is said, what rewards are granted |
| `inventory:move {from, to}` / `inventory:use {slot}` | Whether the item exists, stacking, the new bag, Energy |

Gold, inventory, XP, drops and damage are never accepted from the client.

### Movement and anti-cheat

* Each `move` command represents exactly one 50 ms simulation step. The server applies it with the same pure `stepMovement()` the client uses for prediction (`packages/shared/src/movement.ts`).
* **Speed hacks:** real time grants a movement budget (capped at 300 ms); each command spends 50 ms. Sending 200 commands at once moves you no faster than walking. The input queue is capped (20) and floods are logged as security events.
* **Teleports / impossible coordinates:** positions are never accepted. Saved positions are re-validated on load (moved to spawn if inside something solid or on a missing map).
* **Walls:** tile collision with a feet hitbox, resolved in ≤1 px increments so nobody tunnels through corners. A small "corner assist" makes doorways forgiving.
* Malformed packets are ignored and logged (rate-limited) in `security_events`; a per-socket token bucket disconnects event floods.

### Simulation and networking

* **Tick:** 20 Hz fixed-step loop (self-correcting timer, tick cost recorded in `/metrics`).
* **Snapshots:** 10 Hz, per player, containing only entities in that player's **area of interest** (a rectangle around them with enter/leave hysteresis). Entities entering/leaving view are sent as `entity:add` / `entity:remove`; snapshots carry compact `[id, x, y, dir, moving]` rows and are sent *volatile* (dropped rather than queued if a client is congested).
* **Rooms:** each map is its own runtime with a spatial hash; nothing is broadcast world-wide. Local chat reaches players within 22 tiles on the same map.
* **Client prediction & reconciliation:** the local player moves immediately; each snapshot acknowledges the last applied input sequence, the client rewinds to the server position and replays unacknowledged inputs. Any small correction is blended out visually over ~100 ms.
* **Interpolation:** remote players are drawn ~160 ms in the past between snapshots, so they move smoothly at 60 FPS while the network runs at 10 Hz.
* **Rendering:** 60 FPS Phaser with fixed-step input; the camera zoom keeps the visible world ≤ 1280×800 px so resizing the window never reveals more of the map.

### Sessions, reconnects and ghosts

* One live copy of a character, and one character per account in the world.
* On disconnect the character lingers for 8 s (position saved immediately). A refresh within that window re-attaches to the same in-memory character — no ghost, no duplicate, no reload from stale data. After the grace period the character is removed and saved.
* Logging in from a second window ends the first session (`session:end`).
* Graceful shutdown (SIGTERM) notifies everyone and saves everyone.

## Persistence

| Data | When it is written |
| --- | --- |
| Item and Gold changes, NPC rewards, consumables, character creation | Immediately, in a single transaction with the ledger rows |
| Position / map | On map change, on disconnect, on logout, every 30 s for players who moved, on shutdown |
| Energy | Timestamp-based (`energy`, `energy_updated_at`) — regenerates correctly while offline or across restarts, no timers |
| Chat | Batched every 2 s into `messages` (moderation log) |

Every inventory or Gold mutation: **lock the character row → load → apply a pure rule from `@terrago/shared` → write changed slots + ledger → commit**, or roll back entirely. One-off rewards use a `character_flags` primary key inside the same transaction, so a reward cannot be claimed twice even by concurrent requests (tested with 5 parallel requests).

`currency_transactions` stores amount, balance before/after (with a CHECK that they add up) and a reason. `item_transactions` stores item, quantity, from/to character and reason.

### Tables (v0.1)

`users`, `player_sessions`, `items` (synced from game data for FK integrity), `characters`, `character_stats`, `character_flags`, `inventories`, `inventory_items`, `currency_transactions`, `item_transactions`, `messages`, `security_events`. Later versions add their own migrations (farms and crop instances in v0.2, recipes and professions in v0.3, marketplace and trade logs in v0.4, etc.) rather than creating empty tables now.

## Security

* Passwords: Node's built-in scrypt (N=2^14, r=8, p=5, per-user salt, versioned hash format with rehash-on-login). Login runs a dummy hash for unknown emails so timing doesn't reveal accounts.
* Sessions: 256-bit random tokens; only SHA-256 hashes are stored. Cookie is `HttpOnly; SameSite=Lax; Secure` (production), sliding 30-day expiry, revoked on logout.
* CSRF: POSTs require an allowed `Origin` and `application/json`. WebSocket upgrades are refused from any origin not in `WEB_ORIGINS` (cross-site WebSocket hijacking).
* Rate limits on register/login (per IP and per email) and character creation; chat token bucket; socket event flood guard.
* Input validation with zod on every API body; all SQL is parameterised.
* XSS: chat and names are rendered as text (React/Phaser), never HTML; invisible/bidi control characters are stripped. CSP and security headers on the site.
* Logs are structured JSON; keys that look like secrets are redacted.

## Scaling path

v0.1 runs one authoritative process, which is the right shape for ~100 concurrent players (see `docs/testing.md` for measured numbers). Beyond that:

1. Run map groups (zones) in separate processes; the map-runtime boundary already isolates them.
2. Add Redis for cross-process presence, session cache, rate limits and chat fan-out (global/guild channels).
3. Put PostgreSQL on a managed instance with PITR backups.
