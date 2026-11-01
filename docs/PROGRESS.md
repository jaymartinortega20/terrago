# Progress

Checklist of every milestone and its acceptance criteria, per `SPEC.md` section 3. Check items off as they're verified in a real running build, not just written. Update this at the end of every milestone and commit it.

## M1 — Vertical slice: Maps 1–2, Recruit, start of Act I

Setup:
- [x] Monorepo scaffolded (npm workspaces: `shared`, `server`, `client`)
- [x] `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md` written

Shared:
- [x] zod schemas for every M1 message type (`shared/src/schemas.ts`)
- [x] `formulas.ts`: stat derivation (STR/AGI/VIT/LUK/INT/DEX), attack resolution, EXP curves, fast-cast time
- [x] `config/balance.ts` with every M1 constant (+ refine table, ready for M3)
- [x] A* pathfinding over a tile grid (`shared/src/pathfinding.ts`), no corner-cutting
- [x] Unit tests for every formula (Vitest) — 46 tests passing (`npm test`)

Server:
- [x] better-sqlite3 database + migrations + repository interface
- [x] Register/login with argon2 password hashing + session tokens
- [x] WS connection handling, message validation, rate limiting (`net/`)
- [x] Room for Map 1 (Oakhaven Sanctuary) and Map 2 (Whispering Fields) (`sim/room.ts`, one per `shared/config/maps.ts` entry)
- [x] Server-authoritative movement (click-to-move via A*, WASD direct) with area-of-interest snapshots
- [x] Slime monster: AI, server-calculated combat via `shared/formulas`, aggro barks, loot drops
- [x] EXP/level-up, stat point allocation
- [x] Inventory + equipment (weapon/helmet/chest/boots/wings), broadcast equipment changes
- [x] 8-slot hotbar (skills + stackable items), persisted per character
- [x] AUTO mode: settings relay + server-side validation (the scan/target/move/attack loop itself runs client-side per SPEC.md §8 — that's task #75/client)
- [x] Elder Fin NPC + "First Steps" and "Cleaning the Horizon" quests (state machine + HUD tracker)
- [x] Save on key events + 60s interval; full state restore on login
- [x] Multi-map orchestration (`sim/world.ts`): per-character room routing, portal transitions between rooms, global-vs-map chat scoping, gated dev commands (`/level`, `/joblevel`, `/give`, `/tp`, `/spawn`, `/boss`)
- [x] Fixed 20 Hz tick loop driver (`sim/tick.ts`) + real HTTP/WS server entry point (`server/src/index.ts`) — task #74 complete; verified live with an end-to-end WebSocket smoke test (register → self:state/world:snapshot → move:to walks → chat:send echoes → dev:command applies and persists)

Client:
- [ ] Boot/loading scene with progress bar driving the asset manifest + placeholder-art generator
- [ ] Story intro (3 scrolls, typewriter, Ken Burns placeholder art, click/space/Esc)
- [ ] Login/register screen
- [ ] WorldScene: tile rendering, y-sorting, camera lerp+clamp
- [ ] Paper-doll player sprite (layered, 4-facing, idle/walk/attack/cast/hurt/death/wake-up/mounted)
- [ ] Click-to-move with path preview, WASD 8-way, client prediction + reconciliation
- [ ] HUD: status block (portrait, Base/Job level+EXP, HP, resource bar), hotbar, quest tracker, chat (All/Map/System), minimap
- [ ] Damage floaters: normal/crit/miss/lucky/heal styles, screen shake on crit
- [ ] Inventory + equipment UI (glassmorphism panels, rarity-colored borders)
- [ ] AUTO button + settings panel (cog)
- [ ] Settings: rebindable keys, volume sliders, replay intro

Tests & acceptance:
- [ ] Playwright smoke test: two browser contexts log in and see each other move
- [ ] Every M1 acceptance criterion in `SPEC.md` §3 checked against a running build
- [ ] `npm run dev` / `npm test` both clean, no console errors during normal play

## M2 — Jobs and Act II: Maps 3–4
- [ ] Not started.

## M3 — Economy and Act III: Maps 5–8
- [ ] Not started.

## M4 — Endgame and Act IV: Maps 9–12
- [ ] Not started.

## M5 — Polish and balance
- [ ] Not started.
