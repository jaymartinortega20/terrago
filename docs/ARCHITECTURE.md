# Architecture

See `SPEC.md` for the full design. This file is the map of how it's actually built: module layout, the client–server protocol, and the data model. Update it whenever a structural decision changes.

## Monorepo layout

```
terrago/
  shared/     TypeScript consumed as source (no build step) by both client and server
    src/
      types.ts          Core domain types: Stats, CharacterSnapshot, EntitySnapshot, ItemDef, etc.
      schemas.ts         zod schemas for every client<->server message, derived types via z.infer
      formulas.ts        Pure functions: combat resolution, stat derivation, EXP curves, cast time
      pathfinding.ts      A* over a tile collision grid (TileGrid interface), used by client (preview) and server (authority)
      config/
        balance.ts        Every tunable constant (stat point grants, EXP curves, AUTO scan radius, etc.)
        maps.ts            Per-map metadata: id, name, level band, act, biome
        classes.ts         Job defs: resource type, HP modifier, weapon restriction, skill ids
        skills.ts          Skill defs: cost, cooldown, cast time, range, scaling, autoCastEligible
        items.ts           Item defs: slot, stats, weight, stack size, rarity
        monsters.ts        Monster defs: stats, AI behavior, barks, drop table
        quests.ts          Quest defs: objectives, rewards, prerequisites
  server/
    src/
      index.ts            Process entry point: HTTP+WS server, loads rooms, starts the tick loop
      net/
        socket.ts          Per-connection wrapper: auth handshake, message dispatch, rate limiting
        protocol.ts        Encode/decode + schema validation at the WS boundary
      db/
        database.ts        better-sqlite3 connection + migrations
        repository.ts      Repository interface (AccountRepo, CharacterRepo, ...) — the only thing
                            game logic is allowed to call; swapping SQLite for Postgres means
                            implementing this interface again, not touching callers
      auth/
        auth.ts             Register/login, argon2 hashing, session tokens
      sim/
        room.ts            One instance of one map: entities, tick, area-of-interest snapshotting
        tick.ts             Fixed 20 Hz loop driving all rooms
        movement.ts         Validates move intents against the tile grid using shared/pathfinding
        combat.ts           Applies shared/formulas to resolve attacks server-side
        quests.ts           Quest state machine per character
      devtools/
        commands.ts         /level, /give, /tp, etc. — dev-mode only, gated by an env flag
  client/
    src/
      main.ts             Boot: Phaser game config, scene list
      net/
        connection.ts       WS client: connect, send typed intents, receive typed snapshots
        prediction.ts       Client-side prediction + server reconciliation for the local player
      scenes/
        BootScene.ts, LoginScene.ts, IntroScene.ts, WorldScene.ts, ...
      entities/
        PlayerSprite.ts     Paper-doll rendering: layered sprites by equipment slot, 4-facing anim
        MonsterSprite.ts
      ui/                  DOM overlay (not Phaser) for every panel: HUD, hotbar, inventory,
                            skill tree, chat, minimap, trade, boss board, settings
      assets/
        manifest.json       Every asset referenced by key; placeholder generator fills this at
                            build/load time (procedural chibi sprites, tiles, SFX) until real art
                            exists
  docs/
    ARCHITECTURE.md (this file), PROGRESS.md, DECISIONS.md
  SPEC.md               The build prompt, verbatim
```

## Client–server protocol

JSON over one WebSocket per connection. Every message shape is a zod schema in `shared/src/schemas.ts`; the server validates every inbound message against its schema before touching game state, and rejects (with a typed error message, no stack traces) anything that fails.

**Envelope.** Every message is `{ t: string, ...payload }`, where `t` is a literal message-type tag the schemas are keyed on.

**Client → server intents** (the client never sends outcomes, only intent):
- `auth:login`, `auth:register`
- `move:to` (target tile, for click-to-move path requests), `move:dir` (WASD direct vector)
- `target:set` (entity id to attack/talk/inspect)
- `hotbar:use` (slot 1-8), `hotbar:assign` (slot, skillId|itemId)
- `equip:item`, `unequip:slot`
- `stat:allocate` (stat, points)
- `chat:send` (channel, text)
- `trade:request/offer/lock/accept/cancel`
- `mount:toggle`, `auto:toggle`, `auto:configure`
- `intro:seen` (sent once after the client finishes the story intro, so a later login skips it)
- `mine:start`
- `refine:item`
- `waystone:travel`
- `dev:command` (dev-mode only)

**Server → client snapshots and events:**
- `world:snapshot` (delta: entities that entered/left/changed in this client's area of interest, at tick rate)
- `self:state` (full authoritative state for the local player's own HUD-relevant fields: stats, inventory, equipment, hotbar, quests — sent on change, not every tick)
- `combat:result` (attacker, defender, roll outcome, damage, floater style)
- `chat:message`, `system:announce` (boss warnings, etc.)
- `quest:update`
- `boss:schedule`

Area-of-interest: each room tracks, per connection, the entities inside that player's viewport plus a margin, and only includes those in `world:snapshot` deltas — not the whole room.

## Data model (persistence)

Behind the `Repository` interface (`server/src/db/repository.ts`), so the underlying store is swappable:

- `accounts` (id, username, password_hash, created_at)
- `characters` (id, account_id, name, map_id, x, y, base_level, job_id, job_level, base_exp, job_exp, stats_json, unallocated_stat_points, hp, resource, gold, settings_json, intro_seen, created_at, updated_at) — position is `map_id`/`x`/`y` columns rather than a `position_json` blob, so movement/room queries don't need to parse JSON on every tick
- `character_items` (id, character_id, item_id, slot ["bag"|equip slot name], qty, refine_level)
- `character_hotbar` (character_id, slot_index 1-8, binding_type ["skill"|"item"], binding_id)
- `character_quests` (character_id, quest_id, state, progress_json)
- `character_unlocks` (character_id, kind ["waystone"|"skill"], ref_id)
- `trade_log` (id, character_a, character_b, items_json, gold_a, gold_b, created_at) — arrives with M3 (Economy); not needed for M1/M2

Saved on key events (level up, equip change, quest update, trade complete) and on a 60 s interval per connected character. A repository method exists for every read/write game logic needs; nothing issues raw SQL outside `db/`.

## Decisions pending confirmation

See `docs/DECISIONS.md` for the running log. Nothing here is final until a milestone actually ships it.
