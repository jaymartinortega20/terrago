import { describe, expect, it } from 'vitest';
import type { EntitySnapshot } from '@terago/shared';
import { GameState, type SelfState } from './GameState.js';

function snapshot(id: string, overrides: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'player',
    name: id,
    x: 0,
    y: 0,
    facing: 'down',
    anim: 'idle',
    hpPct: 100,
    ...overrides,
  };
}

function selfStateMessage(overrides: Partial<SelfState> = {}): SelfState {
  return {
    t: 'self:state',
    characterId: 'char1',
    name: 'alice',
    mapId: 'map1',
    baseLevel: 1,
    jobLevel: 1,
    jobId: 'recruit',
    baseExp: 0,
    baseExpToNext: 100,
    jobExp: 0,
    jobExpToNext: 100,
    stats: { STR: 1, AGI: 1, VIT: 1, LUK: 1, INT: 1, DEX: 1 },
    unallocatedStatPoints: 0,
    introSeen: false,
    hp: 93,
    maxHp: 93,
    resource: 40,
    maxResource: 40,
    resourceKind: 'stamina',
    equipment: { weapon: null, helmet: null, chest: null, boots: null, wings: null },
    hotbar: Array(8).fill(null),
    inventory: [],
    autoOn: false,
    autoConfig: { autoTargetMobs: true, autoUsePotionsHpPct: null, autoUsePotionsResourcePct: null, autoCastLowTierSkills: false },
    ...overrides,
  };
}

describe('GameState: self:state', () => {
  it('stores the latest self state and emits onSelfState', () => {
    const state = new GameState();
    const received: unknown[] = [];
    state.onSelfState.on((s) => received.push(s));

    const msg = selfStateMessage();
    state.handleServerMessage(msg);

    expect(state.self).toEqual(msg);
    expect(received).toEqual([msg]);
  });

  it('sets mapId from the message, so a portal crossing updates it on the next self:state', () => {
    const state = new GameState();
    state.handleServerMessage(selfStateMessage({ mapId: 'map1' }));
    expect(state.mapId).toBe('map1');

    state.handleServerMessage(selfStateMessage({ mapId: 'map2' }));
    expect(state.mapId).toBe('map2');
  });

  it('clears stale entities from the old map when mapId changes - the old room never sends this client explicit left events', () => {
    const state = new GameState();
    state.handleServerMessage(selfStateMessage({ mapId: 'map1' }));
    state.handleServerMessage({
      t: 'world:snapshot',
      tick: 1,
      entered: [snapshot('ghost', { kind: 'monster', name: 'Slime' })],
      updated: [],
      left: [],
    });
    expect(state.entities.has('ghost')).toBe(true);

    state.handleServerMessage(selfStateMessage({ mapId: 'map2' }));

    expect(state.entities.has('ghost')).toBe(false);
  });

  it('does not clear entities on a self:state that repeats the same mapId', () => {
    const state = new GameState();
    state.handleServerMessage(selfStateMessage({ mapId: 'map1' }));
    state.handleServerMessage({
      t: 'world:snapshot',
      tick: 1,
      entered: [snapshot('p1', { kind: 'player', name: 'bob' })],
      updated: [],
      left: [],
    });

    state.handleServerMessage(selfStateMessage({ mapId: 'map1', hp: 50 }));

    expect(state.entities.has('p1')).toBe(true);
  });
});

describe('GameState: world:snapshot', () => {
  it('adds entered entities and emits onEntityEntered', () => {
    const state = new GameState();
    const entered: EntitySnapshot[] = [];
    state.onEntityEntered.on((e) => entered.push(e));

    state.handleServerMessage({
      t: 'world:snapshot',
      tick: 1,
      entered: [snapshot('m1', { kind: 'monster', name: 'Slime' })],
      updated: [],
      left: [],
    });

    expect(state.entities.get('m1')?.name).toBe('Slime');
    expect(entered).toHaveLength(1);
  });

  it('overwrites an existing entity on update and emits onEntityUpdated', () => {
    const state = new GameState();
    state.handleServerMessage({ t: 'world:snapshot', tick: 1, entered: [snapshot('p1', { x: 1, y: 1 })], updated: [], left: [] });
    const updated: EntitySnapshot[] = [];
    state.onEntityUpdated.on((e) => updated.push(e));

    state.handleServerMessage({ t: 'world:snapshot', tick: 2, entered: [], updated: [snapshot('p1', { x: 5, y: 5 })], left: [] });

    expect(state.entities.get('p1')?.x).toBe(5);
    expect(updated).toHaveLength(1);
  });

  it('removes a left entity and emits onEntityLeft with its id', () => {
    const state = new GameState();
    state.handleServerMessage({ t: 'world:snapshot', tick: 1, entered: [snapshot('p1')], updated: [], left: [] });
    const left: string[] = [];
    state.onEntityLeft.on((id) => left.push(id));

    state.handleServerMessage({ t: 'world:snapshot', tick: 2, entered: [], updated: [], left: ['p1'] });

    expect(state.entities.has('p1')).toBe(false);
    expect(left).toEqual(['p1']);
  });
});

describe('GameState: localEntity', () => {
  it('returns undefined before self:state has arrived', () => {
    const state = new GameState();
    expect(state.localEntity()).toBeUndefined();
  });

  it('resolves the local player\'s own entity once both self:state and its snapshot have arrived', () => {
    const state = new GameState();
    state.handleServerMessage(selfStateMessage({ characterId: 'char1' }));
    state.handleServerMessage({
      t: 'world:snapshot',
      tick: 1,
      entered: [snapshot('char1', { x: 7, y: 3 })],
      updated: [],
      left: [],
    });

    expect(state.localEntity()).toMatchObject({ id: 'char1', x: 7, y: 3 });
  });
});

describe('GameState: quests, chat, combat, system', () => {
  it('tracks the latest state per quest id', () => {
    const state = new GameState();
    state.handleServerMessage({ t: 'quest:update', questId: 'first_steps', state: 'active', objectiveProgress: { talk: 0 } });
    state.handleServerMessage({ t: 'quest:update', questId: 'first_steps', state: 'readyToTurnIn', objectiveProgress: { talk: 1 } });

    expect(state.quests.get('first_steps')).toEqual({
      questId: 'first_steps',
      state: 'readyToTurnIn',
      objectiveProgress: { talk: 1 },
    });
  });

  it('appends every chat message to the log in order', () => {
    const state = new GameState();
    state.handleServerMessage({ t: 'chat:message', channel: 'map', speaker: 'alice', text: 'hi' });
    state.handleServerMessage({ t: 'chat:message', channel: 'global', speaker: 'bob', text: 'yo' });

    expect(state.chatLog.map((m) => m.text)).toEqual(['hi', 'yo']);
  });

  it('re-emits a combat:result without storing it (transient floater trigger, not state)', () => {
    const state = new GameState();
    const results: unknown[] = [];
    state.onCombatResult.on((r) => results.push(r));

    state.handleServerMessage({ t: 'combat:result', attackerId: 'a', defenderId: 'b', outcome: 'crit', damage: 42 });

    expect(results).toHaveLength(1);
  });

  it('re-emits a combat:heal without storing it (transient floater trigger, not state)', () => {
    const state = new GameState();
    const heals: unknown[] = [];
    state.onHeal.on((h) => heals.push(h));

    state.handleServerMessage({ t: 'combat:heal', characterId: 'a', amount: 40 });

    expect(heals).toHaveLength(1);
  });

  it('re-emits system:announce', () => {
    const state = new GameState();
    const announcements: string[] = [];
    state.onSystemAnnounce.on((a) => announcements.push(a.text));

    state.handleServerMessage({ t: 'system:announce', text: 'Base Level set to 5.' });

    expect(announcements).toEqual(['Base Level set to 5.']);
  });
});

describe('GameState: reset', () => {
  it('clears everything back to its initial empty state', () => {
    const state = new GameState();
    state.handleServerMessage(selfStateMessage());
    state.handleServerMessage({ t: 'world:snapshot', tick: 1, entered: [snapshot('p1')], updated: [], left: [] });
    state.handleServerMessage({ t: 'chat:message', channel: 'map', speaker: 'alice', text: 'hi' });

    state.reset();

    expect(state.self).toBeNull();
    expect(state.entities.size).toBe(0);
    expect(state.chatLog).toHaveLength(0);
    expect(state.mapId).toBeNull();
  });
});
