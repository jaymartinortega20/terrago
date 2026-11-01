# TERAGO ONLINE — Build Prompt

## 1. Your role, the goal, and how to work

You are a senior game engineer building TERAGO ONLINE, a real-time multiplayer 2D fantasy MMORPG that runs in a desktop web browser. Players log in, watch a short story intro, and explore a 12-zone world in a cute chibi art style, leveling a character from 1 to 100 through a story-driven quest line alongside other players.

This is a large project that will span several working sessions. Build it as a series of milestones (section 3), where every milestone leaves the game runnable and playable. Prefer a smaller amount of polished, working gameplay over many half-wired features: at any point, someone should be able to start the server, open the game, and play everything built so far.

**How to work:**

- **Plan first.** Read this whole spec before writing code. Then write `docs/ARCHITECTURE.md` (module layout, client–server protocol, data model) and `docs/PROGRESS.md` (a checklist of every milestone and its acceptance criteria).
- **Build milestone by milestone, in order.** Finish and verify one milestone before starting the next. At the end of each: run the tests, start the server and client, check every acceptance criterion (in a real browser if you have one), update `PROGRESS.md`, and make a git commit.
- **Resume from your notes.** At the start of a new session, or if you run low on context, read `PROGRESS.md`, `docs/DECISIONS.md` and the git log before continuing.
- **Decide instead of stopping.** Where this spec is silent or ambiguous, choose what best fits a classic 2D MMORPG (think Ragnarok Online or MapleStory), record it in `docs/DECISIONS.md` with one line of reasoning, and keep going. Ask only about choices that would be expensive to reverse, such as the networking model.
- **Keep content data-driven.** Classes, skills, items, monsters, maps, quests, NPC dialogue, drop tables, boss schedules and every balance number live in typed data and config files in `shared/`, never in game logic. Adding a monster or item should mean editing data, not code.
- **The server is the authority.** The client sends intents (move here, use slot 3, attack target X). The server validates them and decides every outcome: movement, damage, EXP, loot, inventory, quests and trades. Never trust a value the client computed.
- **Go beyond the minimum on game feel.** Animation, transitions, hit feedback, sound and UI polish matter in a game. Add juice — hit flashes, small screen shake on crits, eased UI motion — wherever it makes the world feel alive.

## 2. Technology and architecture

Use this stack unless you hit a hard blocker; if you must change something, log why in `docs/DECISIONS.md`.

| Area | Choice |
|---|---|
| Language | TypeScript (strict) everywhere, in one npm-workspaces monorepo: `client/`, `server/`, `shared/` |
| Rendering | Phaser (current stable release on npm) with Vite; WebGL renderer, Canvas fallback |
| UI layer | HTML/CSS DOM overlay above the game canvas for every menu, HUD panel and the chat (needed for `backdrop-filter` and drag-and-drop) |
| Server | Node.js (current LTS) with the `ws` WebSocket library; fixed 20 Hz simulation tick |
| Protocol | JSON messages with schemas defined once in `shared/`, validated on the server with zod; per-message-type rate limits |
| Persistence | SQLite (`better-sqlite3`) behind a repository interface so PostgreSQL can replace it later; save on key events and every 60 s |
| Accounts | Username + password hashed with argon2 or bcrypt, session token; one character per account in v1 |
| Tests | Vitest for shared logic and server systems; Playwright smoke test with two browser contexts |

**Architecture requirements:**

- **View.** Fixed top-down 3/4 perspective on an orthogonal grid of 48×48 px tiles, with y-sorting so characters pass in front of and behind objects. The camera follows the local player with smooth lerp and stays clamped to the map edges.
- **Zones.** Each of the 12 maps runs as its own server room. Portals and Waystones hand a player off from one room to another.
- **Netcode.** Client-side prediction with server reconciliation for the local player's movement. Other entities are interpolated about 100 ms behind. Each client receives only entities inside its area of interest (viewport plus a margin), as delta snapshots.
- **Pathfinding.** A* on the tile collision grid, living in `shared/` so the client (path preview) and server (authority) run identical code.
- **Performance targets.** 60 FPS on a mid-range laptop with 50 players and 100 monsters on screen; 200 concurrent players per server process.
- **Dev tools (development mode only).** Chat commands such as `/level <n>`, `/joblevel <n>`, `/give <itemId> [qty]`, `/tp <mapId>`, `/spawn <monsterId>` and `/boss <bossId>`, plus a flag that speeds up boss timers, so late-game content can be tested in minutes. Also a headless bot script that connects N fake players for load testing.
- **One command.** `npm run dev` starts server and client together; `npm test` runs all tests.

## 3. Milestones

Build in this order. Sections 4–11 describe the full game; each milestone below says which parts of it to build.

**M1 — Vertical slice: Maps 1–2, Recruit, start of Act I.** This milestone proves the whole stack end to end. It is done when:

- A player can register and log in; the loading bar fills to 100% and the story intro (section 4) plays. On later logins the intro is skipped and can be replayed from Settings.
- Two players in separate browser windows see each other move smoothly around Oakhaven Sanctuary, using both click-to-move and WASD (including diagonals).
- The Recruit can fight Slimes in the Whispering Fields with server-calculated damage, every damage-floater style, monster barks in chat, and loot drops.
- Base and Job EXP bars fill, levels rise, and stat points can be allocated with all six stat formulas live.
- Inventory and equipment work. Equipping a weapon, helmet, chest piece, boots or wings changes the character sprite immediately, on the wearer's screen and on other players' screens.
- The 8-slot hotbar holds both skills and potions; keys 1–8 trigger them and stacks count down.
- AUTO mode and its settings panel work as described in section 8.
- Elder Fin's "First Steps" and "Cleaning the Horizon" quests can be completed and are tracked in the HUD.
- Logging out and back in restores level, stats, inventory, equipment, hotbar, settings, quest state and position.

**M2 — Jobs and Act II: Maps 3–4.** "Ascension Trial" and all five 1st jobs with their resources and skills; skill tree UI; Fast Casting; mount (R); the Waystone network with fast travel; Echoing Canopy and Sunken Catacombs; the Level 40 Gatekeeper and "Breaking the Seal".

**M3 — Economy and Act III: Maps 5–8.** Mining nodes; the Blacksmith refinery (+1 to +10) with weapon glow trails; secure player-to-player trading; the Act III quests.

**M4 — Endgame and Act IV: Maps 9–12.** 2nd-job branches, including the Skywarden's Gale Falcon pet; field bosses and the Global Boss Schedule Board; the Infernal Caldera world boss and "Mending the Core"; Mythic drops and endgame Wings.

**M5 — Polish and balance.** Spatial audio pass; profiling against the performance targets; a balancing pass on EXP curves and drop rates; a load test with the bot script.

## 4. Story intro (after the loading screen)

When the loading bar reaches 100%, fade to black instead of dropping the player straight into the world. Play three text scrolls with a typewriter effect, each over its own dark, painterly illustration that cross-fades in and slowly pans (Ken Burns style). Use this text exactly as written:

> **Scroll 1:** "For a thousand generations, the core of Terago hummed in absolute balance, suspended in a sea of clouds. Its lifeblood—Aetherite Crystals—was protected by the floating island temples."
>
> **Scroll 2:** "Then came the Fracture. A violent, unknown surge tore through the lower strata, shattering the crystals and pulling the World Bosses from their dormant slumbers. Darkness spilled into the fields, and the world began to bleed."
>
> **Scroll 3:** "You awake as a newly arrived Recruit in Oakhaven Sanctuary, the last standing safe haven. Your memory is fractured, but the call in your veins is clear: mend the crystal core, or watch Terago fall into the endless abyss."

Then a soft chime plays, the text fades, and the camera glides down from the sky into the fixed view of Map 1. The player's chibi character plays a short wake-up animation beside the town's central Waystone.

Details:

- Click or Space shows the rest of the current scroll at once, then advances; Esc skips the whole intro.
- No final artwork exists yet. Generate atmospheric placeholder illustrations in code (layered gradients, silhouettes of floating islands and cracked crystals, drifting particles) and load them through the asset manifest (section 6), so painted art can replace them later without code changes.

## 5. Main quest line

Quests are a per-player server-side state machine (not started → active → ready to turn in → complete), defined in data. The active quest and its objective progress (for example "Slimes defeated 3/5") show in the quest tracker on the right side of the HUD.

| Act | Levels | Maps | Story beats and quests |
|---|---|---|---|
| I — The Safe Haven | 1–10 | 1–2 | Wake in Oakhaven Sanctuary. Talk to Elder Fin to learn survival basics ("First Steps"). Hunt 5 Slimes in the Whispering Fields for raw gel ("Cleaning the Horizon"). At Base Lv 10, Elder Fin grants "Ascension Trial", unlocking the 1st job change. |
| II — Shards of the Deep | 11–40 | 3–4 | Track corrupt crystal remnants into the Echoing Canopy and cleanse infected woodland creatures. The trail leads into the Sunken Catacombs and the Level 40 Gatekeeper mini-boss ("Breaking the Seal"). Defeating it opens the way out of the starter regions. |
| III — The Core Scramble | 41–75 | 5–8 | Gather Copper, Iron and Upgrade Gems in the Desolate Crags and Glacial Depths to reinforce the town's failing shields ("Fortifying the Foundries"). Discover that elemental anomalies in the Scorched Badlands are collapsing the ecosystem, and that their corruption has reached the Sunlit Shoreline. |
| IV — Ascent of the Dragonkin | 76–100 | 9–12 | Climb the Skyward Ridge and brave the toxic sludge of the Shadowfen Swamp ("The Corrupted Bog"). At Dragon's Peak, find the final anchor point holding Terago together. A global call to arms leads to the ultimate World Boss in the Infernal Caldera ("Mending the Core"), which drops Mythic items and the flight-capable endgame Wings. |

Write 2–4 additional side quests per act (kill, collect, deliver, talk) to fill the level ranges between main beats, so a player never grinds more than about 20 minutes without an objective. Target pacing: Base Lv 10 in about 30 minutes of play.

## 6. World, graphics, and characters

**Art style.** Vibrant 2D chibi / cute anime: oversized heads (about half the body height), expressive hand-drawn-looking animation, clean readable silhouettes, richly saturated tile maps.

**Placeholder art.** No final art exists. Generate every sprite and tile programmatically (at build time or on load) in the chibi style — good enough to judge game feel, not grey boxes. Reference every asset through `client/assets/manifest.json` so any file can later be swapped for hand-drawn art with no code changes.

**Paper-doll character sprites.** A character is a stack of separate layers that share one frame grid:

- Frames are 64×64 px. Four facings: down, up, left, and right (mirrored left). Animations: idle (4 frames), walk (6), attack (4), cast (4), hurt (2), death (4), wake-up (4), plus a mounted pose.
- Layers: wings, body, boots, chest piece, head, hair, helmet, weapon. Draw order is defined per facing (for example, the weapon renders behind the body when facing up, and wings always render behind the body).
- Equipping or removing a weapon, helmet, chest piece, boots or wings swaps that layer in the same frame. Equipment changes are broadcast so other players see them instantly too.
- Wings add an animated flutter layer behind the character that loops independently of the body animation.
- Weapons refined to +4 or higher draw a glowing trail during attack frames (section 11).

**Maps.** 12 sequential tile-mapped zones, stored as Tiled-compatible JSON. Generate first layouts procedurally per biome from a fixed seed, then save them as Tiled JSON so they can be hand-edited in the Tiled editor later. Every map has a collision layer, monster spawn areas, portals to its neighbors, its listed NPCs, and one Waystone.

| # | Zone | Levels | Act | Notes |
|---|---|---|---|---|
| 1 | Oakhaven Sanctuary | Town | I | Safe hub with no combat: Elder Fin, Blacksmith, potion and gear shop, central Waystone, spawn point |
| 2 | Whispering Fields | 1–10 | I | Slimes and other gentle field creatures |
| 3 | Echoing Canopy | 11–25 | II | Crystal-infected woodland creatures |
| 4 | Sunken Catacombs | 26–40 | II | Dungeon; the Gatekeeper's chamber at its deepest point |
| 5 | Desolate Crags (mining field) | 41–50 | III | Copper and Iron nodes; rare Upgrade Gems |
| 6 | Scorched Badlands | 51–58 | III | Fire-elemental anomalies |
| 7 | Sunlit Shoreline | 59–66 | III | Coast poisoned by the spreading anomalies |
| 8 | Glacial Depths (mining field) | 67–75 | III | Iron nodes; higher-tier Upgrade Gems |
| 9 | Skyward Ridge | 76–85 | IV | High cliffs, wind and storm creatures |
| 10 | Shadowfen Swamp | 86–92 | IV | Toxic sludge tiles that damage over time |
| 11 | Dragon's Peak | 93–97 | IV | Dragonkin; the final anchor point |
| 12 | The Infernal Caldera | 98–100 | IV | Arena of the ultimate World Boss |

Design 3–4 monster types per combat map that fit its biome. Give each one stats, an AI behavior (passive, aggressive, ranged or fleeing), a small pool of aggro barks, and a drop table that includes gold.

**Waystones.** Touching a map's Waystone unlocks it permanently for that character. From any unlocked Waystone, a player who is out of combat can fast-travel to any other unlocked Waystone for a gold cost that scales with the destination's level band, provided they meet the destination's minimum level. Walking portals enforce the same minimum level and show a message when the player is below it.

## 7. Controls and HUD

Every key is rebindable in Settings. Game keys are ignored while the chat box has focus.

| Input | Action |
|---|---|
| Left-click ground | Path there with A* and show a destination marker |
| Left-click monster / NPC / player | Attack / talk / inspect |
| W A S D | Direct 8-way movement; cancels any click-to-move path |
| 1–8 | Use that hotbar slot |
| R | Toggle mount (out of combat only) |
| Caps Lock | Toggle AUTO mode |
| I / K / C / Q / B | Inventory / skill tree / character stats / quest log / boss schedule board |
| Enter | Focus the chat box |
| Esc | Close the top-most window, or open the system menu |

**Combat state.** A character is in combat for 6 seconds after dealing or taking damage. Mounting and Waystone travel require being out of combat. The mount gives +50% movement speed; attacking, casting or taking damage dismounts.

**Top-left status block.** A chibi portrait rendered live from the character's paper-doll layers; Base Level; Job Level; job class title; red HP bar; class resource bar in the class color (section 10); a yellow Base EXP bar and a green Job EXP bar. Each bar shows exact numbers on hover.

**Hotbar (bottom center, keys 1–8).** One unified 8-slot bar:

- Drag unlocked skills from the skill tree, or stackable consumables (HP/MP potions, speed elixirs, pet food) from the inventory, onto any slot. Drag a slot off the bar to clear it.
- Each slot shows its icon, key number and a cooldown sweep; item slots also show the remaining stack. At 0 the slot greys out but keeps its binding, so restocking re-enables it.
- Pressing the key sends a use intent; the server validates it and the stack count updates. The layout is saved per character.

**Other HUD elements.** Quest tracker (right edge), chat log (bottom left, tabs: All, Map, System), minimap (top right) showing Waystones and portals, and the AUTO button with its settings cog beside the hotbar.

## 8. Auto-attack (AUTO mode)

AUTO is toggled by the on-screen AUTO button or Caps Lock; the button glows while it's on. AUTO logic runs in the client and sends the same intents a player would, and the server validates them exactly like manual input.

- **Scan radius:** 20 tiles by default (about a full 1080p screen), set in config, so targets are found before they close distance.
- **Target priority:** monsters currently attacking the player first, then the nearest reachable monster by path distance. Skip monsters another player is already fighting.
- **Manual override:** any manual move or target command takes over immediately; AUTO resumes 2 seconds after the last manual input.

The settings panel (cog icon) has these options, each persisted per character:

- **Auto-Target Mobs** — path to the target, face it, and use basic weapon attacks at the character's attack interval (from AGI, section 9).
- **Auto-Use Potions** — below X% HP and/or below Y% class resource (sliders, 10–90%), use the first matching consumable on the hotbar. Potions share a 1-second cooldown.
- **Auto-Cast Low-Tier Skills** — weave in skills flagged `autoCastEligible` in data whenever they're off cooldown and affordable, without dropping the current target lock.

## 9. Stats, levels, and combat formulas

All numbers below are starting values. Put every constant in `shared/config/balance.ts` so balancing never touches logic, and implement every formula once in `shared/formulas.ts`.

**Progression.**

- Base Level runs 1–100 and grants stat points. Job Level grants skill points: the Recruit's Job Level caps at 10; every later job's Job Level caps at 50 and resets to 1 on job change.
- New characters start with every stat at 1 and 10 unallocated points. Each Base Level gained grants 5 more (505 by Lv 100, so no build can max all six stats).
- Each stat accepts at most 100 manually allocated points. Equipment bonuses may push the effective value above 100.
- Each Job Level gained grants 1 skill point.
- EXP-to-next-level curves for Base and Job Level are formulas in config, tuned to the pacing in section 5.

**Attributes.**

| Stat | Effects | Starting formulas |
|---|---|---|
| STR | Melee physical damage, carry weight | Melee ATK = weapon ATK + STR × 2 + Base Lv ÷ 4. Weight limit = 2000 + STR × 30 |
| AGI | Attack speed (ASPD), evasion | Attack interval = weapon base interval × (1 − AGI × 0.004), minimum 300 ms; attack animation speeds up to match. FLEE = Base Lv + AGI |
| VIT | Max HP, HP regen, physical defense | Max HP = (80 + Base Lv × 12) × (1 + VIT × 0.01) × class modifier. Regen 1% max HP every max(2, 8 − VIT × 0.06) s, tripled out of combat. DEF = armor DEF + VIT ÷ 2 |
| LUK | Critical hits, trait procs, perfect dodge | Crit % = 1 + LUK × 0.3. Perfect dodge % = 1 + LUK × 0.1. Item trait proc chance × (1 + LUK × 0.005) |
| INT | Magic attack, max mana, mana regen, magic defense | MATK = weapon MATK + INT × 2 + (INT ÷ 7)². Max Mana = (40 + Base Lv × 4) × (1 + INT × 0.01). Mana regen scales with INT. MDEF = armor MDEF + INT ÷ 2 |
| DEX | Accuracy, ranged damage, cast speed | HIT = Base Lv + DEX. Ranged ATK = weapon ATK + DEX × 2 + Base Lv ÷ 4. Reduces variable cast time (below) |

**Resolving an attack, in order:**

1. Perfect dodge roll (LUK) — on success show "Lucky!" and stop.
2. Crit roll — a crit always hits and deals 1.4× damage.
3. Otherwise a hit roll: chance = clamp(80 + HIT − FLEE, 5, 95)%. On failure show "Miss".
4. Damage = ATK × skill multiplier × random(0.95–1.05) × 100 ÷ (100 + DEF), minimum 1. Magic uses MATK and MDEF instead.

**Fast Casting.** Every cast time is 20% fixed and 80% variable; DEX reduces only the variable part, linearly:

```
cast time = base × (0.2 + 0.8 × (1 − min(DEX, 100) ÷ 100))
```

At 100 DEX the variable part is zero and only the fixed 20% remains. Whenever the variable part is cut by 50% or more (DEX ≥ 50), show a rapid "FAST CAST!" floater over the caster and speed up the cast animation by base ÷ actual cast time.

## 10. Classes and skills

**Job path.**

- Every character starts as a Recruit on Map 1 (Base Lv 1–9), using Stamina.
- At Base Lv 10, after completing "Ascension Trial", the player permanently picks one of five 1st jobs.
- At Base Lv 40 and Job Lv 40, after completing "Breaking the Seal", the player picks one of that job's two 2nd-job branches.

**Class resources and bar colors.**

| Resource | Bar color | Behavior | Used by |
|---|---|---|---|
| Stamina | Amber | Regenerates steadily | Recruit, Specter |
| Momentum | Crimson | Starts at 0, builds when dealing or taking melee hits, decays out of combat | Vanguard |
| Mana | Azure | Regenerates with INT | Elementalist, Channeler |
| Focus | Teal | Regenerates fast while standing still, slowly while moving | Wayfinder |

**Skills.** The one-line effects below are design intent; turn each into data with a max skill level of 10, per-level scaling, resource cost, cooldown, cast time, range and skill-tree prerequisites. Skills marked (auto) are `autoCastEligible`.

| Job | Role | Skills |
|---|---|---|
| Recruit | Starter | First Aid: heal 15% max HP over 3 s, long cooldown. Bravado Slap (auto): melee strike at 150% ATK with a short knockback |
| Vanguard | Melee | Impact Rush: dash up to 5 tiles to the target, dealing damage and a 1 s stun. Iron Bastion: 6 s self-buff, 30% damage reduction, spends Momentum. Shockwave Slam (auto): hits all enemies within 2 tiles and slows them |
| Elementalist | Magic | Pyre Shot (auto): fire bolt that leaves a burn over time. Frost Nova: freezes nearby enemies in place for 2 s. Static Rift: lightning field at a target spot, damaging enemies inside for 4 s |
| Wayfinder | Ranged | Steady Shot (auto): short cast, high-damage aimed shot. Concussive Trap: placed trap that stuns the first enemy to step on it. Nimble Vault: leap 4 tiles backward and gain a brief evasion boost |
| Channeler | Support | Restorative Beacon: placed beacon that heals allies in range over 8 s. Purifying Ward: shields an ally and removes one debuff. Sol Strike (auto): holy damage, bonus against corrupted and undead monsters |
| Specter | Stealth | Kinetic Edge (auto): rapid double strike. Razor Flechette: fan of thrown blades in a cone. Phantom Veil: stealth for up to 8 s; the first attack from stealth is a guaranteed crit |

Class HP modifiers live in data (Vanguard highest, Elementalist lowest). Weapon types are class-restricted: swords and maces for Vanguard, staves for Elementalist and Channeler, bows for Wayfinder, daggers for Specter, and basic light weapons for Recruit.

The skill tree window shows locked and unlocked skills, lets players spend skill points, and lets them drag unlocked skills onto the hotbar.

**2nd-job branches (M4).** Design three skills per branch in the same style:

- Vanguard → Juggernaut or Bulwark
- Elementalist → Chrono-Mage or Pyromancer
- Wayfinder → Sharpshooter or Skywarden
- Channeler → Hierophant or Arbiter
- Specter → Void Blade or Trickster

The Skywarden gets the Gale Falcon combat pet. It follows the player, attacks the player's target, has its own stats, levels from 1 to 100 on a share of kill EXP, and posts emerald chat lines on crit streaks and when it or its owner is at low health.

## 11. Interface, feedback, and world systems

**Glassmorphism UI.** Every window and HUD panel is frosted glass: a semi-transparent dark fill, `backdrop-filter: blur(12px)`, a thin light border and a soft shadow. Windows are draggable and remember their position. Item borders glow by quality: Common = steel grey, Rare = blue, Epic = purple, Mythic = animated glowing gold. Blur only panels, never full-screen layers, to protect frame rate.

**Damage feedback.**

- Normal hits: white numbers that pop and float upward.
- Criticals: large gold numbers inside a jagged starburst, with a scale-pop, a small screen shake and a hit flash on the target.
- Miss and Lucky (perfect dodge): italic cursive text.
- Healing: green numbers. FAST CAST!: a quick cyan floater above the caster.

**Audio.** All sound goes through the Web Audio API. World sounds pass through a `PannerNode` positioned relative to the camera, so volume and stereo position follow 2D distance; sounds beyond about 25 tiles are silent. Generate placeholder sound effects procedurally (or use CC0 sounds) through the asset manifest. Settings has master, music and effects volume sliders.

**Talking world entities.**

| Speaker | Chat color | When |
|---|---|---|
| Monsters | Dark red | An aggressive bark (plus a small speech bubble) when they first aggro a player |
| Pets | Emerald green | Celebrating crit streaks, or warning when the pet or its owner is at low health |
| Town NPCs | Sky blue | Proximity barks when a player comes within 4 tiles, with a per-player cooldown |
| System | Gold | Boss warnings, level-ups, job changes, rare drops |

Quest NPCs open a full-screen cinematic dialogue: letterbox bars, character portrait, typewriter text and response choices. Player chat has Global, Map and System channels, with rate and length limits.

**Global Boss Schedule Board (B).** A HUD panel listing every boss with its name, map, level and live status (Alive / Respawns in mm:ss / Spawning in mm:ss), synced from the server. Bosses: the Gatekeeper (Map 4), one field boss on each of Maps 3 and 5–11, and the ultimate World Boss (Map 12). Respawn timers and fixed spawn times live in data. Exactly 5 minutes before any boss spawns, the server broadcasts a gold system warning to every player's chat, such as "⚠ The Molten Tyrant awakens in The Infernal Caldera in 5 minutes!". Every player who dealt at least 1% of a boss's HP receives loot and EXP; normal monsters reward whoever dealt the most damage.

**Mining (M3).** Ore nodes in Maps 5 and 8. Clicking a node starts a 3-second channel (interrupted by damage) that yields Copper or Iron, with a chance of Upgrade Gems. Nodes deplete and respawn on a timer.

**Refinery (M3).** The Blacksmith in Oakhaven refines weapons from +1 to +10 for Upgrade Gems and gold. Each level adds a percentage of weapon ATK, and the name shows the level (for example "+7 Oak Staff").

| Refine level | +1–+4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|
| Success chance | 100% | 80% | 65% | 50% | 35% | 20% | 10% |

On failure the materials are used up and the weapon drops one refine level; it is never destroyed. Attack frames gain a glowing trail visible to everyone: soft white at +4 to +6, blue-violet at +7 to +9, and gold with sparkles at +10.

**Player-to-player trading (M3).**

- A player requests a trade with another player within 5 tiles; both must be out of combat.
- Each side places items and gold in the trade window. Offered items can't be used or dropped while the trade is open.
- Each side clicks [Lock Offer]. Any change to either offer unlocks both sides.
- Once both are locked, [Accept Trade] becomes available. When both accept, the server re-checks both inventories, weight limits and gold, then swaps everything in one atomic database transaction and logs the trade.
- Moving out of range, entering combat or disconnecting cancels the trade and returns everything.

**Endgame Wings (M4).** Beyond the flutter layer, endgame Wings grant bonus movement speed and let the wearer fly across water and chasm tiles that block walking, with a hover animation.

## 12. Definition of done (every milestone)

A milestone is finished only when all of these hold:

- `npm run dev` starts everything, `npm test` passes, the TypeScript build has no errors, and normal play produces no console errors.
- Unit tests cover every stat and combat formula, cast-time math, EXP and level-up, refine outcomes, and trade atomicity, including the case where an offer changes after both sides locked.
- The Playwright smoke test logs in two players and confirms each sees the other move.
- Every acceptance criterion for the milestone has been checked in a running build.
- `README.md` explains setup, running, dev commands and how to replace placeholder art; `PROGRESS.md` and `docs/DECISIONS.md` are up to date; the work is committed.

When a milestone is done, summarize what was built, what was decided, and anything that's stubbed or known to be rough, then continue with the next milestone.
