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
- [x] EXP/level-up, stat point allocation (`stat:allocate`/`handleStatAllocate`)
- [x] Inventory + equipment (weapon/helmet/chest/boots/wings), broadcast equipment changes
- [x] 8-slot hotbar (skills + stackable items), persisted per character
- [x] AUTO mode: settings relay + server-side validation (the scan/target/move/attack loop itself runs client-side per SPEC.md §8 — that's task #75/client)
- [x] Elder Fin NPC + "First Steps" and "Cleaning the Horizon" quests (state machine + HUD tracker)
- [x] Save on key events + 60s interval; full state restore on login
- [x] Multi-map orchestration (`sim/world.ts`): per-character room routing, portal transitions between rooms, global-vs-map chat scoping, gated dev commands (`/level`, `/joblevel`, `/give`, `/tp`, `/spawn`, `/boss`)
- [x] Fixed 20 Hz tick loop driver (`sim/tick.ts`) + real HTTP/WS server entry point (`server/src/index.ts`) — task #74 complete; verified live with an end-to-end WebSocket smoke test (register → self:state/world:snapshot → move:to walks → chat:send echoes → dev:command applies and persists)

Client:
- [x] Boot/loading scene with progress bar driving the asset manifest + placeholder-art generator — `BootScene` generates all ~650 textures in batches of 24/tick, registers paper-doll animations, then starts Login
- [x] Story intro (3 scrolls, typewriter, Ken Burns placeholder art, click/space/Esc) — `IntroScene`; verified live (Playwright), zero console errors, chime synthesized via Web Audio API, sends `intro:seen` on completion
- [x] Login/register screen — `LoginScene`, glassmorphism DOM form (`client/src/ui/styles.css`); verified live: register → Intro → World, and a second login for the same account correctly skips straight to World via `self:state.introSeen`
- [x] WorldScene: tile rendering (theme-per-map via `world/tilemap.ts`), y-sorting (container depth = pixel y, matching obstacle/Waystone "tall tile" depth), camera `setBounds`+`startFollow` with lerp, clamped to map edges — task #80; verified live via Playwright across both M1 maps (Oakhaven town + Whispering Fields), zero console errors
- [x] Paper-doll player sprite (layered, 4-facing, idle/walk/attack/cast/hurt/death/wake-up/mounted) — generated procedurally and confirmed rendering correctly through real Phaser (not just the preview page) in the live WorldScene smoke test
- [x] Monster sprite rendering (`MonsterView`, single-sprite Slime) — confirmed live: Slimes render with name tag + idle animation on Whispering Fields after a portal crossing
- [x] Click-to-move with destination marker, WASD 8-way (cancels any in-flight path), client prediction + server reconciliation — `world/localPrediction.ts` + `world/remoteInterpolation.ts` (~100ms behind for remote entities); verified live: A* routes around obstacles and arrives cleanly, WASD changes facing/direction immediately, a portal crossing (`self:state.mapId` change → `scene.restart()`) re-renders the new map with no ghost entities from the old one (`GameState.entities` clear fix)
- [x] HUD: status block (live paper-doll portrait, Base/Job level+title, HP/resource/EXP bars), 8-slot hotbar (drag-assign, key-use, qty/depleted state), quest tracker (hidden when nothing active), chat (All/Map/System tabs, Enter to focus/send), minimap (Waystone/portals/player+other-player dots) — task #81, `ui/hud/Hud.ts` + one module per panel; verified live via Playwright: toggled AUTO, used the cog settings panel, opened inventory with "I", drag-dropped a potion onto hotbar slot 1 then pressed "1" to consume it (qty 3→2), equipped/unequipped the starting sword, sent a chat message, and talked to Elder Fin to watch the quest tracker populate with "Cleaning the Horizon / Defeat Slime 0/5" - zero console errors throughout
- [x] Inventory + equipment UI (glassmorphism panels, rarity-colored borders) — `ui/hud/inventoryPanel.ts`, part of the same task #81 verification pass above
- [x] AUTO button + settings panel (cog) — `ui/hud/autoPanel.ts`; toggle, Auto-Target Mobs, Auto-Use Potions (independent HP%/Resource% sliders), Auto-Cast Low-Tier Skills, all persisted via `auto:toggle`/`auto:configure` and restored from `self:state.autoOn`/`autoConfig` on relogin. AUTO's own scan/target/attack/potion/cast *loop* is task #82, not this.
- [x] Damage floaters: normal/crit/miss/lucky/heal styles, screen shake + hit-flash on crit — `world/damageFloaters.ts`, wired into `WorldScene` via `gameState.onCombatResult`/`onHeal` (task #82, part 1 of 2); verified live via Playwright: white "10" on a normal hit, large gold "8" on a crit, italic "Miss" on a miss, and (after pre-assigning a potion to the hotbar mid-fight) a green "+22" on a heal, all rendering over the correct entity with zero console errors across several runs. Also closed a real protocol gap found along the way: potion heals never told the client anything happened (self:state only silently reflects the new hp) - added a dedicated `combat:heal` message for this.
- [x] Client-side AUTO loop: scan/target/retarget + auto-potion-use — `world/autoLoop.ts` (task #82, part 2 of 2); the actual move/attack once targeted is already server-authoritative (`Room.tickPlayerCombatAndInteraction`), so this is scoped to target selection (nearest reachable, prioritizing a monster currently attacking the player, skipping one another player just fought) and HP%-threshold potion use, both inferred client-side from existing broadcasts with no new protocol surface. 18 new unit tests (`autoLoop.test.ts`, 339/339 passing overall) plus live Playwright verification: AUTO autonomously sent `target:set` and fought a Slime with zero manual input, auto-potion-use fired `hotbar:use` twice over 7s (cooldown-respecting) after a drag-assigned potion, and a manual click on a different Slime correctly overrode AUTO's own target — zero console errors.
- [x] Stat-point allocation UI (`ui/hud/statusBlock.ts`): six compact "STR 1 [+]" rows, shown only while `unallocatedStatPoints > 0` — found missing entirely during task #76's acceptance pass (the protocol/server side existed and was tested since early on; nothing client-side ever sent `stat:allocate`); verified live, STR 1→4 across three clicks, zero console errors
- [ ] Settings: rebindable keys, volume sliders — genuinely out of M1 scope (SPEC.md section 3's own acceptance checklist never names these; they're part of the fuller section 7/11 feature description that matures over later milestones). "Replayed from Settings" (the one Settings-related item section 3 *does* name) is covered by the system menu below.
- [x] Minimal system menu (Esc, when nothing else is open) with a "Replay Intro" action — closes the M1 acceptance bullet "...the intro is skipped and can be replayed from Settings," found missing during task #76's acceptance pass (the Esc handler already had a comment anticipating this: "No system menu exists yet"); reuses the existing `Intro` → `World` scene flow. Live verification caught three real bugs before this could be checked off (see docs/DECISIONS.md for the full account): the `[hidden]` attribute was silently overridden by the panel's own `display: flex` CSS and never actually hid it; "Replay Intro" called the global `SceneManager.start()` instead of an in-scene `this.scene.start()`, so WorldScene never actually stopped underneath Intro; and `IntroScene` never hid the gameplay HUD (fine on a first playthrough, broken on a replay). All three fixed. Re-verified live end to end: Esc opens the menu (confirmed actually invisible beforehand, not just `hidden=true`), clicking "Replay Intro" via a real Playwright click correctly hides the HUD and shows the intro scrolls, and skipping it a second time returns cleanly to World with the HUD and character state intact — zero console errors.

Tests & acceptance:
- [x] Full workspace typecheck + `npm test` clean (340/340, `e2e/` excluded via `vitest.config.ts` - it's a Playwright suite, not Vitest) — task #76/#83
- [x] Single-session Playwright smoke test driving the real `npm run dev` server+client end to end: register → skip intro → World (Oakhaven) → talk to Elder Fin (quest tracker populates "Cleaning the Horizon") → open inventory (starting potions present) → send a chat message → cross the portal to Whispering Fields → fight a Slime manually → toggle AUTO on and let it fight autonomously → toggle AUTO off → cross the portal back to Oakhaven (no ghost entities) — zero console errors throughout, and the quest objective correctly advanced 0/5 → 1/5 from the AUTO-mode kill, confirming client/server state stayed consistent across the whole session — task #83
- [x] Committed Playwright two-player smoke test (`e2e/two-player.spec.ts`, run via `npm run test:e2e`, `playwright.config.ts` at the repo root): two browser contexts register, confirm each sees the other (via the real `world:snapshot` wire data, not pixels - canvas-rendered name tags aren't DOM-visible to Playwright locators), A click-to-moves and B is confirmed to see the exact new tile, B moves diagonally via WASD and A is confirmed to see it, then A unequips/re-equips its starting sword and B is confirmed to see the sprite change both ways live. Passing (verified against this sandbox's pre-installed Chromium build, since `@playwright/test`'s own pinned browser revision isn't downloadable here - see docs/DECISIONS.md) — task #76
- [x] Committed Playwright system-menu/replay-intro test (`e2e/system-menu.spec.ts`): registers, skips the intro, confirms the system menu is genuinely not rendered (not just `hidden=true`) before Esc, opens it with Esc, clicks "Replay Intro" via a real unscripted Playwright click, confirms the HUD actually hides and a World-only keystroke (`i`) is correctly inert while the intro replays, then skips it again and confirms a clean return to World with the HUD and session state intact. Written specifically to pin down the three bugs task #76's live pass found in this feature (see docs/DECISIONS.md) so they can't silently regress. Passing — task #76
- [x] Full quest-completion + logout/login persistence pass, live: ground up "Cleaning the Horizon" from 0/5 to 5/5 via AUTO mode (surviving an in-session death/respawn to Oakhaven along the way - no penalty, as designed), turned it in to Elder Fin, confirmed the reward applied (3 more potions), confirmed Base/Job level-up (Lv1→2→3) from kill+quest EXP, confirmed a loot drop (Slime Gel) reached inventory, then closed the page and logged back in: level, inventory, equipment, AUTO settings and quest state (then empty, post-completion) all correctly restored. **Found and fixed a real bug along the way**: an in-progress (not-yet-complete) quest's state was NOT restored on relogin - `Room.join()` only ever called `sendSelfState`, and every `quest:update` send site is event-driven, so a freshly reconnected client never learned about quests active before that connection existed. Fixed in `room.ts` (`join()` now re-sends `quest:update` for every already-active/readyToTurnIn quest), with a new `room.test.ts` regression case — task #76
- [x] Every M1 acceptance criterion in `SPEC.md` §3 checked against a running build — task #76 (see the two items above, plus the AUTO-mode and damage-floater/combat passes already verified under task #82/#83). `README.md`'s dev-commands section was also found to overstate what works (claimed `/level 50`-style chat commands were usable; the client never actually sniffs chat for a leading `/` - a pre-existing, already-documented gap) and corrected to say so plainly.

## M2 — Jobs and Act II: Maps 3–4
- [ ] Not started.

## M3 — Economy and Act III: Maps 5–8
- [ ] Not started.

## M4 — Endgame and Act IV: Maps 9–12
- [ ] Not started.

## M5 — Polish and balance
- [ ] Not started.
