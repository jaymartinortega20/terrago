import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE, MAP_OAKHAVEN, MAP_WHISPERING_FIELDS, type ServerMessage } from '@terago/shared';
import { openDatabase } from '../db/database.js';
import { createSqliteRepository, type Repository } from '../db/repository.js';
import { registerAccount } from '../auth/auth.js';
import { Room, type PlayerEntity } from './room.js';

function makeClock(startMs = 0) {
  let ms = startMs;
  return { now: () => ms, advance: (deltaMs: number) => (ms += deltaMs) };
}

/** Constant 0.5 clears every dodge/crit check for a Lv1 Recruit (starting
 * stats, all 1) vs. the Slime and lands a guaranteed plain hit each time
 * (see combat.test.ts for the full trace) - good enough determinism for
 * orchestration tests, which care about *flow*, not damage-roll variety. */
const ROLL_HALF = () => 0.5;

function sentOf(player: PlayerEntity): ServerMessage[] {
  return (player as unknown as { __sent: ServerMessage[] }).__sent;
}

function withCollector(room: Room, characterId: string): PlayerEntity {
  const sent: ServerMessage[] = [];
  const player = room.join(characterId, (m) => sent.push(m));
  (player as unknown as { __sent: ServerMessage[] }).__sent = sent;
  return player;
}

async function freshCharacter(repo: Repository, username: string) {
  const result = await registerAccount(repo, username, 'correct-horse');
  if (!result.ok) throw new Error('registration failed in test setup');
  return result.character;
}

function advance(room: Room, clock: ReturnType<typeof makeClock>, ticks: number, dtSeconds = 0.05) {
  for (let i = 0; i < ticks; i++) {
    clock.advance(dtSeconds * 1000);
    room.tick(dtSeconds);
  }
}

describe('Room: join/leave persistence', () => {
  it('hydrates a character and sends an initial self:state', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    expect(player.name).toBe('alice');
    expect(player.x).toBe(MAP_OAKHAVEN.spawnPoint.x);
    const selfState = sentOf(player).find((m) => m.t === 'self:state');
    expect(selfState).toBeDefined();
    expect(selfState).toMatchObject({ mapId: MAP_OAKHAVEN.id });
  });

  it('self:state carries the bag (not equipped items) for the HUD inventory panel', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    // registerAccount grants a starting sword (equipped) + 3 HP potions (bag).
    const selfState = sentOf(player).find((m) => m.t === 'self:state' as const) as Extract<
      ServerMessage,
      { t: 'self:state' }
    >;
    expect(selfState).toMatchObject({
      inventory: [{ itemId: 'potion_hp_small', qty: 3 }],
    });
    expect(selfState.inventory.some((i) => i.itemId === 'recruit_training_sword')).toBe(false);
  });

  it('persists position on leave', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    player.x = 15;
    player.y = 9;
    room.leave(char.id);

    const row = repo.getCharacterById(char.id);
    expect(row?.x).toBe(15);
    expect(row?.y).toBe(9);
  });

  it('autosaveDirtyPlayers only writes players flagged dirty', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    player.gold = 999;
    player.rowDirty = true;

    room.autosaveDirtyPlayers();
    expect(repo.getCharacterById(char.id)?.gold).toBe(999);
    expect(player.rowDirty).toBe(false);
  });

  it('a fresh character has not seen the intro, and self:state reports it', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    expect(player.introSeen).toBe(false);
    const selfState = sentOf(player).find((m) => m.t === 'self:state');
    expect(selfState).toMatchObject({ introSeen: false });
  });

  it('handleIntroSeen flips the flag, persists it, and survives a logout/login cycle', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    room.handleIntroSeen(player);
    expect(player.introSeen).toBe(true);
    expect(player.rowDirty).toBe(true);

    room.leave(char.id); // persists rowDirty fields, including introSeen
    expect(repo.getCharacterById(char.id)?.introSeen).toBe(true);

    const reloaded = withCollector(room, char.id);
    expect(reloaded.introSeen).toBe(true);
  });

  it('handleIntroSeen is a no-op (doesn\'t re-dirty the row) once already seen', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    room.handleIntroSeen(player);
    player.rowDirty = false;

    room.handleIntroSeen(player);
    expect(player.rowDirty).toBe(false);
  });
});

describe('Room: movement + portals', () => {
  it('walks toward a clicked tile over several ticks', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const clock = makeClock();
    const player = withCollector(room, char.id);
    const startX = player.x;

    room.handleMoveTo(player, { x: startX - 2, y: player.y });
    advance(room, clock, 40); // 2s of simulated time, plenty at 4 tiles/s over a 2-tile hop

    expect(player.x).toBeCloseTo(startX - 2, 1);
    expect(player.path).toBeNull();
  });

  it('detects a portal crossing once the player reaches the portal tile', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const clock = makeClock();
    const player = withCollector(room, char.id);
    const portal = MAP_OAKHAVEN.portals[0]!;
    player.x = portal.at.x;
    player.y = portal.at.y;

    clock.advance(50);
    const transitions = room.tick(0.05);
    expect(transitions).toEqual([{ characterId: char.id, toMapId: portal.toMapId, x: portal.targetSpawn.x, y: portal.targetSpawn.y }]);
  });
});

describe('Room: combat against a monster', () => {
  it('chases, auto-attacks, kills the monster, and grants exp/gold/loot', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });

    const clock = makeClock();
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: ROLL_HALF, now: clock.now });
    const player = withCollector(room, char.id);
    const [monster] = [...room.monsters.values()];
    expect(monster).toBeDefined();
    // Start right on top of the monster so this test is about combat
    // resolution, not the chase pathfinding already covered by movement.test.ts.
    player.x = monster!.x;
    player.y = monster!.y;

    room.handleTargetSet(player, monster!.instanceId);

    const startingGold = player.gold;
    const startingExp = player.baseExp;
    // Slime has 45 HP; a Lv1 Recruit with the starting weapon deals 10 per
    // hit at this roll (see combat.test.ts), so 5 hits kill it. Attack
    // interval is ~896ms, so give this plenty of ticks (8s simulated).
    advance(room, clock, 160);

    expect(room.monsters.has(monster!.instanceId)).toBe(false);
    expect(player.gold).toBeGreaterThan(startingGold);
    // EXP was granted (base level may have risen past the first curve step,
    // in which case baseExp wraps back toward 0 - check level-or-exp advanced).
    expect(player.baseLevel > 1 || player.baseExp > startingExp).toBe(true);

    const combatResults = sentOf(player).filter((m) => m.t === 'combat:result');
    expect(combatResults.length).toBeGreaterThanOrEqual(5);
    expect(player.targetId).toBeNull();
  });

  it('progresses an active killCount quest objective on monster death', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });
    repo.upsertQuestState(char.id, 'cleaning_the_horizon', 'active', { kill_slimes: 4 });

    const clock = makeClock();
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: ROLL_HALF, now: clock.now });
    const player = withCollector(room, char.id);
    const [monster] = [...room.monsters.values()];
    player.x = monster!.x;
    player.y = monster!.y;
    room.handleTargetSet(player, monster!.instanceId);

    advance(room, clock, 160);

    const quest = player.quests.find((q) => q.questId === 'cleaning_the_horizon');
    expect(quest?.state).toBe('readyToTurnIn');
    expect(quest?.progress.kill_slimes).toBe(5);
    const stored = repo.getQuestStates(char.id).find((q) => q.questId === 'cleaning_the_horizon');
    expect(stored?.state).toBe('readyToTurnIn');
  });

  it('the monster retaliates and can damage the attacking player', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });

    const clock = makeClock();
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: ROLL_HALF, now: clock.now });
    const player = withCollector(room, char.id);
    const [monster] = [...room.monsters.values()];
    player.x = monster!.x;
    player.y = monster!.y;
    const startingHp = player.hp;

    room.handleTargetSet(player, monster!.instanceId);
    // One attack interval's worth of time, not enough to kill the slime
    // (45 HP, 10 dmg/hit) but enough for it to swing back at least once
    // (its own interval is 1400ms).
    advance(room, clock, 40); // 2s

    expect(player.hp).toBeLessThan(startingHp);
  });

  it('respawns a defeated player at Oakhaven, fully healed and out of combat', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });

    const clock = makeClock();
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: ROLL_HALF, now: clock.now });
    const player = withCollector(room, char.id);
    const [monster] = [...room.monsters.values()];
    player.x = monster!.x;
    player.y = monster!.y;
    player.hp = 5; // deliberately low, so the Slime's very first retaliation (6 dmg) kills before the player's own 5 hits can kill it back
    player.mounted = true;

    room.handleTargetSet(player, monster!.instanceId);
    let transitions: ReturnType<typeof room.tick> = [];
    for (let i = 0; i < 40 && transitions.length === 0; i++) {
      // 2s max, well inside the Slime's first 1400ms attack interval
      clock.advance(50);
      transitions = room.tick(0.05);
    }

    expect(transitions).toEqual([{ characterId: char.id, toMapId: MAP_OAKHAVEN.id, x: MAP_OAKHAVEN.spawnPoint.x, y: MAP_OAKHAVEN.spawnPoint.y }]);
    expect(player.hp).toBeGreaterThan(5); // restored to max, not left at the lethal blow's clamped-at-0 value
    expect(player.mounted).toBe(false);
    expect(player.targetId).toBeNull();
    expect(sentOf(player).some((m) => m.t === 'system:announce' && /defeated/i.test(m.text))).toBe(true);
  });

  it('clears target and does not throw when the target has already died', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: ROLL_HALF });
    const player = withCollector(room, char.id);

    room.handleTargetSet(player, 'no-such-monster-id');
    expect(() => room.tick(0.05)).not.toThrow();
    expect(player.targetId).toBeNull();
  });
});

describe('Room: combat anim state (EntitySnapshot.anim via animFor, task #82)', () => {
  /** Finds the most recent world:snapshot entry (entered or updated) for
   * `entityId` and returns its anim - i.e. what the client would actually
   * be rendering right now, not just the raw lastAttackAt/lastHurtAt
   * fields (which have their own more direct assertions alongside this). */
  function latestAnimFor(player: PlayerEntity, entityId: string): string | undefined {
    const snapshots = sentOf(player).filter(
      (m): m is Extract<ServerMessage, { t: 'world:snapshot' }> => m.t === 'world:snapshot'
    );
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const found = [...snapshots[i]!.entered, ...snapshots[i]!.updated].find((e) => e.id === entityId);
      if (found) return found.anim;
    }
    return undefined;
  }

  it("a landed hit reports 'hurt' immediately, taking priority over a simultaneous 'attack'", async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });

    const clock = makeClock();
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: ROLL_HALF, now: clock.now });
    const player = withCollector(room, char.id);
    const [monster] = [...room.monsters.values()];
    player.x = monster!.x;
    player.y = monster!.y;

    room.handleTargetSet(player, monster!.instanceId);
    clock.advance(50);
    // First tick: both lastAttackAt fields start null, so the player's
    // swing and the now-aggroed Slime's retaliation both fire (and land,
    // under ROLL_HALF) this same tick.
    room.tick(0.05);

    expect(monster!.lastHurtAt).toBe(50);
    expect(latestAnimFor(player, monster!.instanceId)).toBe('hurt');
  });

  it("falls back to 'attack' once the hurt window elapses but the attack window hasn't", async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });

    const clock = makeClock();
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: ROLL_HALF, now: clock.now });
    const player = withCollector(room, char.id);
    const [monster] = [...room.monsters.values()];
    player.x = monster!.x;
    player.y = monster!.y;

    room.handleTargetSet(player, monster!.instanceId);
    clock.advance(50);
    room.tick(0.05); // hit lands + monster swings back, both at t=50ms

    // hurtAnimWindowMs (250ms) has elapsed since t=50 but attackAnimWindowMs
    // (400ms) hasn't; neither the player's next swing (~896ms interval) nor
    // the Slime's (1400ms) is due yet, so nothing re-touches either timestamp.
    clock.advance(BALANCE.hurtAnimWindowMs + 20);
    room.tick(0.05);

    expect(latestAnimFor(player, monster!.instanceId)).toBe('attack');
  });

  it("falls back to 'idle' once both the hurt and attack windows have elapsed", async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });

    const clock = makeClock();
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: ROLL_HALF, now: clock.now });
    const player = withCollector(room, char.id);
    const [monster] = [...room.monsters.values()];
    player.x = monster!.x;
    player.y = monster!.y;

    room.handleTargetSet(player, monster!.instanceId);
    clock.advance(50);
    room.tick(0.05);

    // Both windows have elapsed since t=50, well before either combatant's
    // next swing - and Slimes never chase (passive AI, docs/DECISIONS.md),
    // so with no path/heldDirection either, animFor has nothing left but idle.
    clock.advance(BALANCE.attackAnimWindowMs + 50);
    room.tick(0.05);

    expect(latestAnimFor(player, monster!.instanceId)).toBe('idle');
  });

  it('a missed swing never reports a false \'hurt\' anim, though \'attack\' still plays', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'hunter');
    repo.saveCharacter(char.id, { mapId: MAP_WHISPERING_FIELDS.id, x: MAP_WHISPERING_FIELDS.spawnPoint.x, y: MAP_WHISPERING_FIELDS.spawnPoint.y });

    const clock = makeClock();
    // A constant roll of 0.9 clears dodge/crit and guarantees a miss in
    // both directions here (same trace as combat.test.ts's own miss case):
    // player-on-Slime hitChancePct=77, Slime-on-player hitChancePct=83,
    // both comfortably below 90.
    const room = new Room(MAP_WHISPERING_FIELDS, repo, { roll01: () => 0.9, now: clock.now });
    const player = withCollector(room, char.id);
    const [monster] = [...room.monsters.values()];
    player.x = monster!.x;
    player.y = monster!.y;

    room.handleTargetSet(player, monster!.instanceId);
    clock.advance(50);
    room.tick(0.05);

    expect(monster!.lastHurtAt).toBeNull();
    expect(player.lastHurtAt).toBeNull();
    // The swing was still attempted (and should still visibly animate) -
    // it just didn't land.
    expect(latestAnimFor(player, monster!.instanceId)).toBe('attack');

    const snapshots = sentOf(player).filter(
      (m): m is Extract<ServerMessage, { t: 'world:snapshot' }> => m.t === 'world:snapshot'
    );
    const everHurt = snapshots.some((s) =>
      [...s.entered, ...s.updated].some((e) => e.id === monster!.instanceId && e.anim === 'hurt')
    );
    expect(everHurt).toBe(false);
  });
});

describe('Room: NPC talk and quest chaining', () => {
  it('starts, completes, and chains quests in one visit to Elder Fin', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    const elderFin = MAP_OAKHAVEN.npcs.find((n) => n.id === 'elder_fin')!;
    player.x = elderFin.x;
    player.y = elderFin.y;

    room.handleTargetSet(player, 'elder_fin');
    room.tick(0.05);

    const questUpdates = sentOf(player).filter((m) => m.t === 'quest:update');
    expect(questUpdates.map((m: any) => [m.questId, m.state])).toEqual([
      ['first_steps', 'readyToTurnIn'],
      ['first_steps', 'complete'],
      ['cleaning_the_horizon', 'active'],
    ]);

    expect(player.quests.find((q) => q.questId === 'first_steps')?.state).toBe('complete');
    expect(player.quests.find((q) => q.questId === 'cleaning_the_horizon')?.state).toBe('active');
    expect(repo.getQuestStates(char.id).find((q) => q.questId === 'first_steps')?.state).toBe('complete');

    // First Steps' reward is 10 exp / 5 gold (shared/config/quests.ts).
    expect(player.gold).toBeGreaterThanOrEqual(5);
    expect(player.targetId).toBeNull(); // one-shot interaction
  });

  it('does nothing a second time once already complete', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    const elderFin = MAP_OAKHAVEN.npcs.find((n) => n.id === 'elder_fin')!;
    player.x = elderFin.x;
    player.y = elderFin.y;

    room.handleTargetSet(player, 'elder_fin');
    room.tick(0.05);
    const goldAfterFirstTalk = player.gold;

    room.handleTargetSet(player, 'elder_fin');
    room.tick(0.05);
    const questUpdatesSecondTalk = sentOf(player)
      .filter((m) => m.t === 'quest:update')
      .slice(3); // after the 3 events from the first talk
    expect(questUpdatesSecondTalk).toEqual([]);
    expect(player.gold).toBe(goldAfterFirstTalk);
  });

  it('re-hydrates an already-active quest with quest:update on a fresh join (SPEC.md M1: "restores... quest state")', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    const elderFin = MAP_OAKHAVEN.npcs.find((n) => n.id === 'elder_fin')!;
    player.x = elderFin.x;
    player.y = elderFin.y;

    // Start "Cleaning the Horizon" (active, not yet ready to turn in) and
    // leave - simulating the player disconnecting mid-quest.
    room.handleTargetSet(player, 'elder_fin');
    room.tick(0.05);
    room.leave(char.id);

    // A plain re-join, with no further interaction, used to never tell the
    // newly-connected client about quests that were already active before
    // this session existed - join() only ever called sendSelfState, and
    // every quest:update send site is event-driven (start/progress/turn-in).
    const rejoined = withCollector(room, char.id);
    const questUpdatesOnRejoin = sentOf(rejoined).filter((m) => m.t === 'quest:update');
    expect(questUpdatesOnRejoin).toEqual([
      { t: 'quest:update', questId: 'cleaning_the_horizon', state: 'active', objectiveProgress: { kill_slimes: 0 } },
    ]);
    // 'complete' quests (first_steps, from the same first talk) have nothing
    // for the tracker to hydrate - QuestTracker only ever renders active/
    // readyToTurnIn - so they're correctly left out.
    expect(questUpdatesOnRejoin.some((m: any) => m.questId === 'first_steps')).toBe(false);
  });
});

describe('Room: equipment and inventory', () => {
  it('equips a weapon from the bag, swapping out anything already equipped', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    // registerAccount already equips the starting sword directly (not via
    // Room), so exercise unequip -> re-equip through the Room API.
    const equipped = player.equipment.weapon!;
    expect(room.handleUnequip(player, 'weapon')).toBe(true);
    expect(player.equipment.weapon).toBeUndefined();
    expect(player.items.some((i) => i.id === equipped.id)).toBe(true);

    expect(room.handleEquip(player, equipped.id)).toBe(true);
    expect(player.equipment.weapon?.id).toBe(equipped.id);
    expect(player.items.some((i) => i.id === equipped.id)).toBe(false);

    const stored = repo.listItems(char.id).find((i) => i.id === equipped.id);
    expect(stored?.slot).toBe('weapon');
  });

  it('rejects equipping a non-equipment item', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    const potion = player.items.find((i) => i.itemId === 'potion_hp_small')!;

    expect(room.handleEquip(player, potion.id)).toBe(false);
  });

  it('rejects equipping an unowned item id', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    expect(room.handleEquip(player, 'not-a-real-row-id')).toBe(false);
  });
});

describe('Room: hotbar', () => {
  it('assigns an owned item to a slot and rejects an unowned one', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    expect(room.handleHotbarAssign(player, 1, { type: 'item', id: 'potion_hp_small' })).toBe(true);
    expect(room.handleHotbarAssign(player, 2, { type: 'item', id: 'slime_gel' })).toBe(false);
    expect(room.handleHotbarAssign(player, 3, { type: 'skill', id: 'bravado_slap' })).toBe(false);
  });

  it('using a potion slot heals HP, decrements the stack, and respects the cooldown', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const clock = makeClock();
    const room = new Room(MAP_OAKHAVEN, repo, { now: clock.now });
    const player = withCollector(room, char.id);
    room.handleHotbarAssign(player, 1, { type: 'item', id: 'potion_hp_small' });
    player.hp = 1;
    const potionsBefore = player.items.find((i) => i.itemId === 'potion_hp_small')!.qty;

    room.handleHotbarUse(player, 1);
    expect(player.hp).toBe(41); // healHp: 40, from 1 -> 41
    const potionsAfterOne = player.items.find((i) => i.itemId === 'potion_hp_small')?.qty;
    expect(potionsAfterOne).toBe(potionsBefore - 1);
    // A damage-feedback floater (SPEC.md section 11: "Healing: green
    // numbers") needs to know a heal happened and by how much - self:state
    // only carries the resulting hp, silently, so this is a dedicated
    // broadcast rather than the client diffing two self:states.
    expect(sentOf(player)).toContainEqual({ t: 'combat:heal', characterId: char.id, amount: 40 });

    // Immediately using again should be blocked by the 1s potion cooldown.
    room.handleHotbarUse(player, 1);
    expect(player.items.find((i) => i.itemId === 'potion_hp_small')?.qty).toBe(potionsAfterOne);

    clock.advance(1100);
    room.handleHotbarUse(player, 1);
    expect(player.items.find((i) => i.itemId === 'potion_hp_small')?.qty).toBe((potionsAfterOne ?? 0) - 1);
  });

  it('does not send a combat:heal floater when a potion is used at full HP', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    room.handleHotbarAssign(player, 1, { type: 'item', id: 'potion_hp_small' });
    // Fresh character is already at full HP.

    room.handleHotbarUse(player, 1);

    expect(sentOf(player).some((m) => m.t === 'combat:heal')).toBe(false);
  });
});

describe('Room: stat allocation', () => {
  it('spends unallocated points into a stat', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    const startingPoints = player.unallocatedStatPoints;

    expect(room.handleStatAllocate(player, 'VIT', 3)).toBe(true);
    expect(player.stats.VIT).toBe(4); // started at 1
    expect(player.unallocatedStatPoints).toBe(startingPoints - 3);
  });

  it('rejects spending more points than are available', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    expect(room.handleStatAllocate(player, 'VIT', player.unallocatedStatPoints + 1)).toBe(false);
  });

  it('rejects pushing a stat past the manual cap of 100', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);
    player.stats = { ...player.stats, VIT: 99 };
    player.unallocatedStatPoints = 50;
    expect(room.handleStatAllocate(player, 'VIT', 2)).toBe(false);
    expect(room.handleStatAllocate(player, 'VIT', 1)).toBe(true);
  });
});

describe('Room: mount toggle', () => {
  it('allows mounting out of combat and blocks it in combat', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    expect(room.handleMountToggle(player)).toBe(true);
    expect(player.mounted).toBe(true);
    expect(room.handleMountToggle(player)).toBe(true); // unmount always allowed
    expect(player.mounted).toBe(false);
  });

  it('blocks mounting while in combat', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const clock = makeClock(10_000);
    const room = new Room(MAP_OAKHAVEN, repo, { now: clock.now });
    const player = withCollector(room, char.id);

    player.lastCombatActionAt = clock.now();
    expect(room.handleMountToggle(player)).toBe(false);
    expect(player.mounted).toBe(false);
  });
});

describe('Room: AUTO mode settings persist across self:state (SPEC.md M1: "restores... settings")', () => {
  it('a fresh character defaults to AUTO off with Auto-Target Mobs on and potions/casting off', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    const selfState = sentOf(player).find((m) => m.t === 'self:state') as Extract<ServerMessage, { t: 'self:state' }>;
    expect(selfState.autoOn).toBe(false);
    expect(selfState.autoConfig).toEqual({
      autoTargetMobs: true,
      autoUsePotionsHpPct: null,
      autoUsePotionsResourcePct: null,
      autoCastLowTierSkills: false,
    });
  });

  it('toggling AUTO and saving a config is echoed back in the next self:state', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    room.handleAutoToggle(player, true);
    room.handleAutoConfigure(player, {
      autoTargetMobs: false,
      autoUsePotionsHpPct: 50,
      autoUsePotionsResourcePct: 30,
      autoCastLowTierSkills: true,
    });
    room.tick(0.05); // selfStateDirty is only flushed to a self:state send on the next tick

    const latest = sentOf(player)
      .filter((m) => m.t === 'self:state')
      .at(-1) as Extract<ServerMessage, { t: 'self:state' }>;
    expect(latest.autoOn).toBe(true);
    expect(latest.autoConfig).toEqual({
      autoTargetMobs: false,
      autoUsePotionsHpPct: 50,
      autoUsePotionsResourcePct: 30,
      autoCastLowTierSkills: true,
    });
  });

  it('AUTO settings survive a leave + rejoin (persisted on the character row)', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_OAKHAVEN, repo);
    const player = withCollector(room, char.id);

    room.handleAutoToggle(player, true);
    room.handleAutoConfigure(player, {
      autoTargetMobs: true,
      autoUsePotionsHpPct: 40,
      autoUsePotionsResourcePct: null,
      autoCastLowTierSkills: false,
    });
    room.leave(char.id);

    const rejoined = withCollector(room, char.id);
    const selfState = sentOf(rejoined).find((m) => m.t === 'self:state') as Extract<ServerMessage, { t: 'self:state' }>;
    expect(selfState.autoOn).toBe(true);
    expect(selfState.autoConfig.autoUsePotionsHpPct).toBe(40);
  });
});

describe('Room: chat broadcast', () => {
  it('delivers a room broadcast to other players but not back to the sender when excluded', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const alice = await freshCharacter(repo, 'alice');
    const bob = await freshCharacter(repo, 'bob');
    const room = new Room(MAP_OAKHAVEN, repo);
    const playerA = withCollector(room, alice.id);
    const playerB = withCollector(room, bob.id);

    room.broadcastToRoom({ t: 'chat:message', channel: 'map', speaker: 'alice', text: 'hi' }, alice.id, false);

    expect(sentOf(playerB).some((m) => m.t === 'chat:message')).toBe(true);
    expect(sentOf(playerA).some((m) => m.t === 'chat:message')).toBe(false);
  });
});

describe('Room: area-of-interest snapshotting', () => {
  it('reports entered then left as a second player moves into and out of range', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const alice = await freshCharacter(repo, 'alice');
    const bob = await freshCharacter(repo, 'bob');
    const room = new Room(MAP_OAKHAVEN, repo);
    const clock = makeClock();
    const playerA = withCollector(room, alice.id);
    const playerB = withCollector(room, bob.id);
    playerA.x = 2;
    playerA.y = 2;
    playerB.x = 200; // far outside AOI radius, even accounting for map bounds clamping elsewhere
    playerB.y = 200;

    advance(room, clock, 1);
    const firstSnapshot = sentOf(playerA).filter((m) => m.t === 'world:snapshot').pop() as any;
    expect(firstSnapshot?.entered.some((e: any) => e.id === bob.id)).toBe(false);

    playerB.x = 3;
    playerB.y = 2;
    advance(room, clock, 1);
    const secondSnapshot = sentOf(playerA).filter((m) => m.t === 'world:snapshot').pop() as any;
    expect(secondSnapshot.entered.some((e: any) => e.id === bob.id)).toBe(true);

    playerB.x = 200;
    playerB.y = 200;
    advance(room, clock, 1);
    const thirdSnapshot = sentOf(playerA).filter((m) => m.t === 'world:snapshot').pop() as any;
    expect(thirdSnapshot.left).toContain(bob.id);
  });

  it("includes a monster's stable monsterId alongside its display name, so the client can pick its sprite without matching on name", async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const alice = await freshCharacter(repo, 'alice');
    const room = new Room(MAP_WHISPERING_FIELDS, repo);
    const clock = makeClock();
    const player = withCollector(room, alice.id);
    const [monster] = [...room.monsters.values()];
    player.x = monster!.x;
    player.y = monster!.y;

    advance(room, clock, 1);

    const snapshot = sentOf(player).filter((m) => m.t === 'world:snapshot').pop() as any;
    const monsterEntity = snapshot.entered.find((e: any) => e.kind === 'monster');
    expect(monsterEntity).toMatchObject({ name: 'Slime', monsterId: 'slime' });
  });
});
