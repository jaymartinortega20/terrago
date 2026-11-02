import { describe, expect, it } from 'vitest';
import { MAP_WHISPERING_FIELDS, type ClientMessage, type EntitySnapshot, type ServerMessage } from '@terago/shared';
import { GameState, type SelfState } from '../state/GameState.js';
import { AutoLoop } from './autoLoop.js';

const SPAWN = MAP_WHISPERING_FIELDS.spawnPoint; // (2, 8)

function fakeNet() {
  const sent: ClientMessage[] = [];
  return { send: (m: ClientMessage) => sent.push(m), sent };
}

function selfState(overrides: Partial<SelfState> = {}): SelfState {
  return {
    t: 'self:state',
    characterId: 'me',
    name: 'alice',
    mapId: MAP_WHISPERING_FIELDS.id,
    baseLevel: 1,
    jobLevel: 1,
    jobId: 'recruit',
    baseExp: 0,
    baseExpToNext: 100,
    jobExp: 0,
    jobExpToNext: 100,
    stats: { STR: 1, AGI: 1, VIT: 1, LUK: 1, INT: 1, DEX: 1 },
    unallocatedStatPoints: 0,
    introSeen: true,
    hp: 93,
    maxHp: 93,
    resource: 40,
    maxResource: 40,
    resourceKind: 'stamina',
    equipment: { weapon: null, helmet: null, chest: null, boots: null, wings: null },
    hotbar: Array(8).fill(null),
    inventory: [],
    autoOn: true,
    autoConfig: { autoTargetMobs: true, autoUsePotionsHpPct: null, autoUsePotionsResourcePct: null, autoCastLowTierSkills: false },
    ...overrides,
  };
}

function monster(id: string, x: number, y: number, overrides: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return { id, kind: 'monster', name: 'Slime', x, y, facing: 'down', anim: 'idle', hpPct: 100, monsterId: 'slime', ...overrides };
}

function player(id: string, x: number, y: number): EntitySnapshot {
  return { id, kind: 'player', name: id, x, y, facing: 'down', anim: 'idle', hpPct: 100 };
}

function worldSnapshot(entered: EntitySnapshot[], left: string[] = []): Extract<ServerMessage, { t: 'world:snapshot' }> {
  return { t: 'world:snapshot', tick: 1, entered, updated: [], left };
}

function setup(selfOverrides: Partial<SelfState> = {}) {
  const net = fakeNet();
  const gameState = new GameState();
  gameState.handleServerMessage(selfState(selfOverrides));
  gameState.handleServerMessage(worldSnapshot([player('me', SPAWN.x, SPAWN.y)]));
  const autoLoop = new AutoLoop(net, gameState, MAP_WHISPERING_FIELDS);
  return { net, gameState, autoLoop };
}

describe('AutoLoop: targeting', () => {
  it('does nothing when AUTO is off', () => {
    const { net, gameState, autoLoop } = setup({ autoOn: false });
    gameState.handleServerMessage(worldSnapshot([monster('m1', SPAWN.x + 1, SPAWN.y)]));

    autoLoop.update(1000);

    expect(net.sent).toEqual([]);
  });

  it('does nothing when autoTargetMobs is off, even with AUTO on', () => {
    const { net, gameState, autoLoop } = setup({ autoConfig: { autoTargetMobs: false, autoUsePotionsHpPct: null, autoUsePotionsResourcePct: null, autoCastLowTierSkills: false } });
    gameState.handleServerMessage(worldSnapshot([monster('m1', SPAWN.x + 1, SPAWN.y)]));

    autoLoop.update(1000);

    expect(net.sent).toEqual([]);
  });

  it('targets the nearest reachable monster within scan radius', () => {
    const { net, gameState, autoLoop } = setup();
    gameState.handleServerMessage(
      worldSnapshot([monster('far', SPAWN.x + 10, SPAWN.y), monster('near', SPAWN.x + 1, SPAWN.y)])
    );

    autoLoop.update(1000);

    expect(net.sent).toEqual([{ t: 'target:set', entityId: 'near' }]);
  });

  it('ignores a monster outside the scan radius', () => {
    const { net, gameState, autoLoop } = setup();
    // autoScanRadiusTiles is 20 - place the only monster well past that.
    gameState.handleServerMessage(worldSnapshot([monster('far', SPAWN.x + 50, SPAWN.y)]));

    autoLoop.update(1000);

    expect(net.sent).toEqual([]);
  });

  it('skips a monster sitting on an unreachable (walled-off) tile', () => {
    const { net, gameState, autoLoop } = setup();
    const [ox, oy] = [MAP_WHISPERING_FIELDS.width - 1, MAP_WHISPERING_FIELDS.height - 1]; // off the room's floor
    gameState.handleServerMessage(worldSnapshot([monster('stuck', ox, oy)]));

    autoLoop.update(1000);

    expect(net.sent).toEqual([]);
  });

  it('does not retarget while the current target is still alive and known', () => {
    const { net, gameState, autoLoop } = setup();
    gameState.handleServerMessage(worldSnapshot([monster('m1', SPAWN.x + 1, SPAWN.y)]));

    autoLoop.update(1000);
    autoLoop.update(2000); // well past the retarget scan throttle

    expect(net.sent).toEqual([{ t: 'target:set', entityId: 'm1' }]);
  });

  it('retargets once the current target leaves (dies/despawns)', () => {
    const { net, gameState, autoLoop } = setup();
    gameState.handleServerMessage(worldSnapshot([monster('m1', SPAWN.x + 1, SPAWN.y)]));
    autoLoop.update(1000);
    expect(net.sent).toEqual([{ t: 'target:set', entityId: 'm1' }]);

    gameState.handleServerMessage(worldSnapshot([monster('m2', SPAWN.x + 1, SPAWN.y)], ['m1']));
    autoLoop.update(2000);

    expect(net.sent).toEqual([{ t: 'target:set', entityId: 'm1' }, { t: 'target:set', entityId: 'm2' }]);
  });

  it('prioritizes a monster currently attacking the player over a nearer one that is not', () => {
    const { net, gameState, autoLoop } = setup();
    gameState.handleServerMessage(
      worldSnapshot([monster('near-passive', SPAWN.x + 1, SPAWN.y), monster('far-aggro', SPAWN.x + 5, SPAWN.y)])
    );
    gameState.handleServerMessage({ t: 'combat:result', attackerId: 'far-aggro', defenderId: 'me', outcome: 'hit', damage: 6 });

    autoLoop.update(1000);

    expect(net.sent).toEqual([{ t: 'target:set', entityId: 'far-aggro' }]);
  });

  it('does not count a miss as "attacking the player" for target priority', () => {
    const { net, gameState, autoLoop } = setup();
    gameState.handleServerMessage(
      worldSnapshot([monster('near', SPAWN.x + 1, SPAWN.y), monster('far', SPAWN.x + 5, SPAWN.y)])
    );
    gameState.handleServerMessage({ t: 'combat:result', attackerId: 'far', defenderId: 'me', outcome: 'miss' });

    autoLoop.update(1000);

    expect(net.sent).toEqual([{ t: 'target:set', entityId: 'near' }]);
  });

  it('skips a monster another player is already fighting', () => {
    const { net, gameState, autoLoop } = setup();
    gameState.handleServerMessage(worldSnapshot([player('bob', SPAWN.x + 1, SPAWN.y), monster('m1', SPAWN.x + 1, SPAWN.y)]));
    gameState.handleServerMessage({ t: 'combat:result', attackerId: 'bob', defenderId: 'm1', outcome: 'hit', damage: 5 });

    autoLoop.update(1000);

    expect(net.sent).toEqual([]);
  });

  it('a manually-set target is recognized as current, suppressing its own scan', () => {
    const { net, gameState, autoLoop } = setup();
    gameState.handleServerMessage(worldSnapshot([monster('m1', SPAWN.x + 1, SPAWN.y), monster('m2', SPAWN.x + 1, SPAWN.y + 1)]));

    autoLoop.setManualTarget('m1');
    autoLoop.update(1000);

    expect(net.sent).toEqual([]); // AUTO made no pick of its own - m1 (the manual one) is still alive
  });

  it('withholds retargeting for autoResumeDelayMs after manual input, then resumes', () => {
    const { net, gameState, autoLoop } = setup();
    gameState.handleServerMessage(worldSnapshot([monster('m1', SPAWN.x + 1, SPAWN.y)]));

    autoLoop.noteManualInput(0); // simulates a manual move, e.g. at t=0
    autoLoop.update(1000); // 1s later - still inside the 2s override window
    expect(net.sent).toEqual([]);

    autoLoop.update(2100); // past autoResumeDelayMs (2000ms)
    expect(net.sent).toEqual([{ t: 'target:set', entityId: 'm1' }]);
  });
});

describe('AutoLoop: potions', () => {
  function withPotionHotbar(selfOverrides: Partial<SelfState> = {}) {
    const hotbar = Array(8).fill(null);
    hotbar[0] = { type: 'item', id: 'potion_hp_small', qty: 3 };
    return setup({ hotbar, autoConfig: { autoTargetMobs: false, autoUsePotionsHpPct: 50, autoUsePotionsResourcePct: null, autoCastLowTierSkills: false }, ...selfOverrides });
  }

  it('drinks the first matching hotbar potion once below the configured HP threshold', () => {
    const { net, autoLoop } = withPotionHotbar({ hp: 10, maxHp: 93 }); // ~11%, under 50%

    autoLoop.update(1000);

    expect(net.sent).toEqual([{ t: 'hotbar:use', slot: 1 }]);
  });

  it('does not drink above the configured HP threshold', () => {
    const { net, autoLoop } = withPotionHotbar({ hp: 90, maxHp: 93 }); // ~97%, well above 50%

    autoLoop.update(1000);

    expect(net.sent).toEqual([]);
  });

  it('does nothing when no HP threshold is configured', () => {
    const { net, autoLoop } = setup({
      hp: 1,
      maxHp: 93,
      autoConfig: { autoTargetMobs: false, autoUsePotionsHpPct: null, autoUsePotionsResourcePct: null, autoCastLowTierSkills: false },
    });

    autoLoop.update(1000);

    expect(net.sent).toEqual([]);
  });

  it('respects the shared potion cooldown rather than spamming hotbar:use every frame', () => {
    const { net, autoLoop } = withPotionHotbar({ hp: 10, maxHp: 93 });

    autoLoop.update(1000);
    autoLoop.update(1050); // well inside autoPotionCooldownMs (1000ms)

    expect(net.sent).toEqual([{ t: 'hotbar:use', slot: 1 }]);
  });

  it('is not suppressed by the manual-override window (unlike targeting)', () => {
    const { net, autoLoop } = withPotionHotbar({ hp: 10, maxHp: 93 });

    autoLoop.noteManualInput(900);
    autoLoop.update(1000); // inside the targeting override window, but potions should still fire

    expect(net.sent).toEqual([{ t: 'hotbar:use', slot: 1 }]);
  });

  it('finds no slot (and sends nothing) when the only hotbar item cannot meet the need', () => {
    // Bound item has no healHp at all.
    const hotbar = Array(8).fill(null);
    hotbar[0] = { type: 'item', id: 'slime_gel', qty: 3 };
    const { net, autoLoop } = setup({
      hp: 10,
      maxHp: 93,
      hotbar,
      autoConfig: { autoTargetMobs: false, autoUsePotionsHpPct: 50, autoUsePotionsResourcePct: null, autoCastLowTierSkills: false },
    });

    autoLoop.update(1000);

    expect(net.sent).toEqual([]);
  });
});
