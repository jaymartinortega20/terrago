import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { DEFAULT_APPEARANCE, PLAYER_SPEED, SIM, TILE_SIZE, emptySkills, tileCenter, type InventoryState, type ServerToClientEvents } from '@terrago/shared';
import { createLogger } from '../../src/logger';
import type { CharacterRecord, PositionSave } from '../../src/world/characterState';
import type { Connection } from '../../src/world/connection';
import { World } from '../../src/world/world';

type Sent = { event: keyof ServerToClientEvents; args: unknown[] };

class FakeConn implements Connection {
  static n = 0;
  readonly id = `conn-${++FakeConn.n}`;
  sent: Sent[] = [];
  closed = false;
  send(event: keyof ServerToClientEvents, ...args: unknown[]) {
    this.sent.push({ event, args });
  }
  sendVolatile(event: keyof ServerToClientEvents, ...args: unknown[]) {
    this.sent.push({ event, args });
  }
  close() {
    this.closed = true;
  }
  of(event: keyof ServerToClientEvents) {
    return this.sent.filter((s) => s.event === event).map((s) => s.args[0] as any);
  }
  last(event: keyof ServerToClientEvents) {
    return this.of(event).at(-1);
  }
  clear() {
    this.sent = [];
  }
}

const inv: InventoryState = { capacity: 20, gold: 0, slots: [] };
let seqUser = 0;

function record(over: Partial<CharacterRecord> = {}): CharacterRecord {
  const spawn = tileCenter(31, 26);
  seqUser++;
  return {
    id: `00000000-0000-4000-8000-${String(seqUser).padStart(12, '0')}`,
    userId: `user-${seqUser}`,
    name: `Hero${seqUser}`,
    classId: 'warrior',
    level: 1,
    xp: 0,
    gold: 25,
    appearance: DEFAULT_APPEARANCE,
    mapId: 'greenhaven',
    x: spawn.x,
    y: spawn.y,
    dir: 'down',
    stats: { strength: 9, agility: 5, intelligence: 2, vitality: 9, luck: 3 },
    hp: 100,
    mp: 10,
    energy: 60,
    energyUpdatedAt: Date.now(),
    skills: emptySkills({ baseXp: 40, exponent: 1.9, maxLevel: 100 }),
    ...over,
  };
}

let saved: PositionSave[][];
let world: World;

beforeEach(() => {
  saved = [];
  world = new World({
    log: createLogger('error'),
    savePositions: async (s) => {
      saved.push(s);
    },
  });
});

const meta = { sessionId: 's', ip: '127.0.0.1' };
const ticks = (n: number) => {
  for (let i = 0; i < n; i++) world.tick(SIM.stepMs);
};

describe('joining and visibility', () => {
  test('two players on the same map see each other', async () => {
    const a = new FakeConn();
    const b = new FakeConn();
    await world.join(record(), a, inv, meta);
    await world.join(record({ x: tileCenter(33, 26).x }), b, inv, meta);
    ticks(2);
    assert.equal(a.of('entity:add').flat().length, 1);
    assert.equal(b.of('entity:add').flat().length, 1);
    assert.equal(a.last('snap').e.length, 1);
    assert.equal(a.of('world:enter')[0].map.id, 'greenhaven');
    assert.ok(a.of('world:enter')[0].npcs.some((n: any) => n.id === 'mayor_lina'));
  });

  test('area of interest: far players are not sent, and enter/leave as they move', async () => {
    const a = new FakeConn();
    const b = new FakeConn();
    const pa = await world.join(record(), a, inv, meta);
    // B starts far east on the east road.
    const pb = await world.join(record({ ...tileCenter(58, 22) }), b, inv, meta);
    ticks(2);
    assert.equal(a.of('entity:add').length, 0, 'B is outside A\'s view');
    // Teleport B next to A (test-only), then back out.
    pb.x = pa.x + 64;
    pb.y = pa.y;
    (world as any).maps.get('greenhaven').spatial.update(pb);
    ticks(2);
    assert.equal(a.of('entity:add').flat()[0].id, pb.id);
    pb.x = pa.x + 40 * TILE_SIZE;
    (world as any).maps.get('greenhaven').spatial.update(pb);
    ticks(2);
    assert.deepEqual(a.last('entity:remove'), [pb.id]);
  });
});

describe('authoritative movement', () => {
  test('moves exactly one step per accepted command and acknowledges the sequence', async () => {
    const a = new FakeConn();
    const p = await world.join(record(), a, inv, meta);
    const x0 = p.x;
    for (let s = 1; s <= 6; s++) world.enqueueMove(p, [s, 0, 1]);
    ticks(10);
    const step = (PLAYER_SPEED * SIM.stepMs) / 1000;
    assert.ok(Math.abs(p.y - (record().y + 6 * step)) < 0.05);
    assert.equal(p.x, x0);
    assert.equal(p.lastSeq, 6);
    assert.equal(a.last('snap').ack, 6);
    assert.equal(p.dir, 'down');
  });

  test('speed hack: flooding commands cannot move faster than real time', async () => {
    const a = new FakeConn();
    const p = await world.join(record(), a, inv, meta);
    for (let s = 1; s <= 200; s++) world.enqueueMove(p, [s, 0, 1]);
    assert.ok(p.inputs.length <= 20, 'queue is capped');
    ticks(4); // 200ms of real time
    assert.ok(p.lastSeq <= 4 + 1, `processed ${p.lastSeq} commands in 4 ticks`);
  });

  test('rejects malformed and replayed commands, and position payloads', async () => {
    const a = new FakeConn();
    const p = await world.join(record(), a, inv, meta);
    world.enqueueMove(p, [1, 0, 1]);
    world.enqueueMove(p, [1, 0, 1]); // replay
    world.enqueueMove(p, [2, 5, 0]); // impossible axis
    world.enqueueMove(p, { x: 9999, y: 9999 }); // teleport attempt
    world.enqueueMove(p, [3.5, 1, 0]); // non-integer seq
    assert.equal(p.inputs.length, 1);
  });

  test('cannot walk through buildings', async () => {
    const a = new FakeConn();
    // In front of the General Store door (building spans x 8..15, y 14..19).
    const start = tileCenter(12, 20);
    const p = await world.join(record({ ...start }), a, inv, meta);
    for (let s = 1; s <= 40; s++) world.enqueueMove(p, [s, 0, -1]);
    ticks(60);
    assert.ok(p.y >= 20 * TILE_SIZE + 10 - 0.01, `stayed outside the wall (y=${p.y})`);
  });

  test('walking through the south gate changes map to Sunfield Plains', async () => {
    const a = new FakeConn();
    const p = await world.join(record({ ...tileCenter(31, 45) }), a, inv, meta);
    for (let s = 1; s <= 30; s++) world.enqueueMove(p, [s, 0, 1]);
    ticks(40);
    assert.equal(p.mapId, 'sunfield_plains');
    assert.equal(a.last('world:enter').map.id, 'sunfield_plains');
    assert.ok(saved.flat().some((s) => s.mapId === 'sunfield_plains'), 'position saved on map change');
  });
});

describe('chat', () => {
  test('local chat reaches nearby players only, masks profanity, and rate limits', async () => {
    const a = new FakeConn();
    const b = new FakeConn();
    const far = new FakeConn();
    const pa = await world.join(record(), a, inv, meta);
    await world.join(record({ x: pa.x + 64 }), b, inv, meta);
    await world.join(record({ ...tileCenter(58, 22) }), far, inv, meta);
    assert.deepEqual(world.chat(pa, '  Hello   there  '), { ok: true, id: b.last('chat')?.id ?? a.last('chat').id });
    assert.equal(b.last('chat').text, 'Hello there');
    assert.equal(far.of('chat').length, 0);
    world.chat(pa, 'you ass');
    assert.equal(b.last('chat').text, 'you ***');
    for (let i = 0; i < 10; i++) world.chat(pa, `spam ${i}`);
    assert.equal(world.chat(pa, 'one more').ok, false);
  });

  test('empty and non-string messages are rejected', async () => {
    const a = new FakeConn();
    const pa = await world.join(record(), a, inv, meta);
    assert.equal(world.chat(pa, '   ').ok, false);
    assert.equal(world.chat(pa, { evil: true }).ok, false);
  });
});

describe('sessions and reconnects', () => {
  afterEach(() => mock.timers.reset());

  test('refresh within the grace period re-attaches without a duplicate', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const a1 = new FakeConn();
    const b = new FakeConn();
    const rec = record();
    const p1 = await world.join(rec, a1, inv, meta);
    await world.join(record({ x: rec.x + 64 }), b, inv, meta);
    p1.x += 10;
    world.detach(p1.id, a1);
    const a2 = new FakeConn();
    const p2 = await world.join(rec, a2, inv, meta);
    assert.equal(p1, p2, 'same in-memory character');
    assert.equal(world.players.size, 2);
    assert.equal(a2.last('world:enter').position.x, p1.x, 'resumes from in-memory position');
    mock.timers.tick(20_000);
    assert.equal(world.players.size, 2, 'grace timer was cancelled');
  });

  test('disconnect without return removes the player after the grace period and saves', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const a = new FakeConn();
    const p = await world.join(record(), a, inv, meta);
    world.detach(p.id, a);
    assert.equal(world.players.size, 1);
    mock.timers.tick(20_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(world.players.size, 0);
    assert.ok(saved.length >= 1);
  });

  test('logging in from a second window ends the first session', async () => {
    const a1 = new FakeConn();
    const a2 = new FakeConn();
    const rec = record();
    await world.join(rec, a1, inv, meta);
    await world.join(rec, a2, inv, meta);
    assert.ok(a1.of('session:end').length === 1 && a1.closed);
    assert.equal(world.players.size, 1);
  });

  test('a stale disconnect from an old window does not detach the new one', async () => {
    const a1 = new FakeConn();
    const a2 = new FakeConn();
    const rec = record();
    const p = await world.join(rec, a1, inv, meta);
    await world.join(rec, a2, inv, meta);
    world.detach(p.id, a1);
    assert.equal(p.conn, a2);
  });

  test('only one character per account is in the world', async () => {
    const a = new FakeConn();
    const b = new FakeConn();
    const first = record();
    await world.join(first, a, inv, meta);
    await world.join(record({ userId: first.userId }), b, inv, meta);
    assert.equal(world.players.size, 1);
    assert.equal(a.of('session:end').length, 1);
  });

  test('shutdown notifies and saves everyone', async () => {
    const a = new FakeConn();
    await world.join(record(), a, inv, meta);
    await world.shutdown();
    assert.equal(a.of('session:end').length, 1);
    assert.equal(saved.at(-1)?.length, 1);
  });
});
