import { beforeEach, describe, expect, it } from 'vitest';
import { MAP_OAKHAVEN, MAP_WHISPERING_FIELDS, type ServerMessage } from '@terago/shared';
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

    // Immediately using again should be blocked by the 1s potion cooldown.
    room.handleHotbarUse(player, 1);
    expect(player.items.find((i) => i.itemId === 'potion_hp_small')?.qty).toBe(potionsAfterOne);

    clock.advance(1100);
    room.handleHotbarUse(player, 1);
    expect(player.items.find((i) => i.itemId === 'potion_hp_small')?.qty).toBe((potionsAfterOne ?? 0) - 1);
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
});
