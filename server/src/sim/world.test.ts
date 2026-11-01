import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@terago/shared';
import { openDatabase } from '../db/database.js';
import { createSqliteRepository, type Repository } from '../db/repository.js';
import { registerAccount } from '../auth/auth.js';
import { World } from './world.js';

function makeClock(startMs = 0) {
  let ms = startMs;
  return { now: () => ms, advance: (deltaMs: number) => (ms += deltaMs) };
}

/** See room.test.ts: 0.5 clears every dodge/crit roll and lands a guaranteed
 * plain hit for a Lv1 Recruit vs. a Slime - good enough determinism for
 * orchestration tests that care about *flow*, not damage variety. */
const ROLL_HALF = () => 0.5;

function collector(): { send: (m: ServerMessage) => void; sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  return { send: (m) => sent.push(m), sent };
}

async function freshCharacter(repo: Repository, username: string) {
  const result = await registerAccount(repo, username, 'correct-horse');
  if (!result.ok) throw new Error('registration failed in test setup');
  return result.character;
}

function advance(world: World, clock: ReturnType<typeof makeClock>, ticks: number, dtSeconds = 0.05) {
  for (let i = 0; i < ticks; i++) {
    clock.advance(dtSeconds * 1000);
    world.tick(dtSeconds);
  }
}

describe('World: join/leave routes to the right room', () => {
  it('joins a fresh character into map1 (Oakhaven), their persisted starting map', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo);
    const c = collector();

    world.join(char.id, c.send);

    expect(world.getCharacterMapId(char.id)).toBe('map1');
    expect(world.getRoom('map1')?.players.has(char.id)).toBe(true);
    expect(c.sent.some((m) => m.t === 'self:state')).toBe(true);
  });

  it('leave() removes the character from their room and from tracking', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo);
    world.join(char.id, collector().send);

    world.leave(char.id);

    expect(world.getCharacterMapId(char.id)).toBeUndefined();
    expect(world.getRoom('map1')?.players.has(char.id)).toBe(false);
  });

  it('a second character on map2 joins a different room than one on map1', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const alice = await freshCharacter(repo, 'alice');
    const bob = await freshCharacter(repo, 'bob');
    repo.saveCharacter(bob.id, { mapId: 'map2', x: 5, y: 5 });
    const world = new World(repo);

    world.join(alice.id, collector().send);
    world.join(bob.id, collector().send);

    expect(world.getCharacterMapId(alice.id)).toBe('map1');
    expect(world.getCharacterMapId(bob.id)).toBe('map2');
    expect(world.getRoom('map1')?.players.has(bob.id)).toBe(false);
    expect(world.getRoom('map2')?.players.has(bob.id)).toBe(true);
  });
});

describe('World: message dispatch', () => {
  it('routes move:to to the character\'s own room and no other', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const alice = await freshCharacter(repo, 'alice');
    const world = new World(repo);
    world.join(alice.id, collector().send);
    const player = world.getRoom('map1')!.players.get(alice.id)!;
    const startX = player.x;

    world.handleMessage(alice.id, { t: 'move:to', target: { x: startX - 2, y: player.y } });

    expect(player.path).not.toBeNull();
  });

  it('routes intro:seen through to the room, flipping the flag', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo);
    world.join(char.id, collector().send);
    const player = world.getRoom('map1')!.players.get(char.id)!;
    expect(player.introSeen).toBe(false);

    world.handleMessage(char.id, { t: 'intro:seen' });

    expect(player.introSeen).toBe(true);
  });

  it('is a safe no-op for a character that has not joined any room', () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const world = new World(repo);

    expect(() => world.handleMessage('ghost-character-id', { t: 'move:dir', dx: 1, dy: 0 })).not.toThrow();
  });

  it('dispatches stat:allocate through to the room, spending an unallocated point', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo);
    world.join(char.id, collector().send);
    const player = world.getRoom('map1')!.players.get(char.id)!;
    player.unallocatedStatPoints = 3;
    const before = player.stats.STR;

    world.handleMessage(char.id, { t: 'stat:allocate', stat: 'STR', points: 2 });

    expect(player.stats.STR).toBe(before + 2);
    expect(player.unallocatedStatPoints).toBe(1);
  });
});

describe('World: chat scoping', () => {
  it('broadcasts a global message to every room, not just the sender\'s', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const alice = await freshCharacter(repo, 'alice');
    const bob = await freshCharacter(repo, 'bob');
    repo.saveCharacter(bob.id, { mapId: 'map2', x: 5, y: 5 });
    const world = new World(repo);
    const aliceCollector = collector();
    const bobCollector = collector();
    world.join(alice.id, aliceCollector.send);
    world.join(bob.id, bobCollector.send);

    world.handleMessage(alice.id, { t: 'chat:send', channel: 'global', text: 'hello world' });

    expect(aliceCollector.sent.some((m) => m.t === 'chat:message' && m.text === 'hello world')).toBe(true);
    expect(bobCollector.sent.some((m) => m.t === 'chat:message' && m.text === 'hello world')).toBe(true);
  });

  it('keeps a map-channel message inside the sender\'s own room', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const alice = await freshCharacter(repo, 'alice');
    const bob = await freshCharacter(repo, 'bob');
    repo.saveCharacter(bob.id, { mapId: 'map2', x: 5, y: 5 });
    const world = new World(repo);
    const aliceCollector = collector();
    const bobCollector = collector();
    world.join(alice.id, aliceCollector.send);
    world.join(bob.id, bobCollector.send);

    world.handleMessage(alice.id, { t: 'chat:send', channel: 'map', text: 'anyone nearby?' });

    expect(aliceCollector.sent.some((m) => m.t === 'chat:message' && m.text === 'anyone nearby?')).toBe(true);
    expect(bobCollector.sent.some((m) => m.t === 'chat:message' && m.text === 'anyone nearby?')).toBe(false);
  });

  it('never treats a slash-prefixed chat:send as a dev command', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo, { devToolsEnabled: true });
    const c = collector();
    world.join(char.id, c.send);
    const player = world.getRoom('map1')!.players.get(char.id)!;
    const levelBefore = player.baseLevel;

    world.handleMessage(char.id, { t: 'chat:send', channel: 'map', text: '/level 99' });

    expect(player.baseLevel).toBe(levelBefore);
    expect(c.sent.some((m) => m.t === 'chat:message' && m.text === '/level 99')).toBe(true);
  });
});

describe('World: dev commands', () => {
  it('ignores dev:command entirely when dev tools are disabled', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo); // devToolsEnabled defaults to false
    const c = collector();
    world.join(char.id, c.send);
    const player = world.getRoom('map1')!.players.get(char.id)!;
    const levelBefore = player.baseLevel;

    world.handleMessage(char.id, { t: 'dev:command', line: '/level 50' });

    expect(player.baseLevel).toBe(levelBefore);
    expect(c.sent.some((m) => m.t === 'system:announce' && /disabled/i.test(m.text))).toBe(true);
  });

  it('/level sets the base level when dev tools are enabled', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo, { devToolsEnabled: true });
    world.join(char.id, collector().send);
    const player = world.getRoom('map1')!.players.get(char.id)!;

    world.handleMessage(char.id, { t: 'dev:command', line: '/level 50' });

    expect(player.baseLevel).toBe(50);
  });

  it('/give grants an item to the player\'s bag', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo, { devToolsEnabled: true });
    world.join(char.id, collector().send);
    const player = world.getRoom('map1')!.players.get(char.id)!;
    const before = player.items.filter((i) => i.itemId === 'potion_hp_small').reduce((n, i) => n + i.qty, 0);

    world.handleMessage(char.id, { t: 'dev:command', line: '/give potion_hp_small 5' });

    const after = player.items.filter((i) => i.itemId === 'potion_hp_small').reduce((n, i) => n + i.qty, 0);
    expect(after).toBe(before + 5);
  });

  it('/tp moves the character into the destination room at its spawn point', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo, { devToolsEnabled: true });
    const c = collector();
    world.join(char.id, c.send);

    world.handleMessage(char.id, { t: 'dev:command', line: '/tp map2' });

    expect(world.getCharacterMapId(char.id)).toBe('map2');
    expect(world.getRoom('map1')?.players.has(char.id)).toBe(false);
    const player = world.getRoom('map2')!.players.get(char.id)!;
    expect(player.x).toBe(2);
    expect(player.y).toBe(8);
    // the same send callback must still be wired up post-teleport
    expect(c.sent.length).toBeGreaterThan(0);
  });

  it('/tp to an unknown map announces an error instead of throwing', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo, { devToolsEnabled: true });
    const c = collector();
    world.join(char.id, c.send);

    expect(() => world.handleMessage(char.id, { t: 'dev:command', line: '/tp nowhere' })).not.toThrow();
    expect(c.sent.some((m) => m.t === 'system:announce' && /unknown map/i.test(m.text))).toBe(true);
    expect(world.getCharacterMapId(char.id)).toBe('map1');
  });

  it('an unrecognized dev command announces itself as unknown', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo, { devToolsEnabled: true });
    const c = collector();
    world.join(char.id, c.send);

    world.handleMessage(char.id, { t: 'dev:command', line: '/nonsense' });

    expect(c.sent.some((m) => m.t === 'system:announce' && /unknown dev command/i.test(m.text))).toBe(true);
  });
});

describe('World: portal transitions picked up from tick()', () => {
  it('carries a player from map1 to map2 when they step on the Oakhaven portal tile', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo, { roll01: ROLL_HALF });
    const clock = makeClock();
    const c = collector();
    world.join(char.id, c.send);
    const player = world.getRoom('map1')!.players.get(char.id)!;
    const room1 = world.getRoom('map1')!;
    const portal = room1.getMapDef().portals[0]!;
    player.x = portal.at.x;
    player.y = portal.at.y;

    clock.advance(50);
    world.tick(0.05);

    expect(world.getCharacterMapId(char.id)).toBe(portal.toMapId);
    expect(world.getRoom('map1')?.players.has(char.id)).toBe(false);
    const movedPlayer = world.getRoom(portal.toMapId)!.players.get(char.id)!;
    expect(movedPlayer.x).toBe(portal.targetSpawn.x);
    expect(movedPlayer.y).toBe(portal.targetSpawn.y);
  });
});

describe('World: autosave sweep', () => {
  it('persists a dirty player\'s row once the autosave interval elapses', async () => {
    const repo = createSqliteRepository(openDatabase(':memory:'));
    const char = await freshCharacter(repo, 'alice');
    const world = new World(repo);
    const clock = makeClock();
    world.join(char.id, collector().send);
    const player = world.getRoom('map1')!.players.get(char.id)!;
    player.gold = 777;
    player.rowDirty = true;

    advance(world, clock, 1, 61); // one 61s tick clears the 60s autosaveIntervalMs threshold

    expect(repo.getCharacterById(char.id)?.gold).toBe(777);
    expect(player.rowDirty).toBe(false);
  });
});
