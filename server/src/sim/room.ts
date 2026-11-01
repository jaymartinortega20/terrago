/**
 * One instance of one map: entities, tick, area-of-interest snapshotting
 * (docs/ARCHITECTURE.md). A Room owns everything that happens *inside* one
 * map; crossing maps (portals, login placement) is sim/world.ts's job, one
 * layer up, since a Room has no idea other rooms exist.
 *
 * Players here hold a plain `send` callback rather than a net/socket.ts
 * Connection, so this whole module is testable without any networking.
 */
import { nanoid } from 'nanoid';
import {
  BALANCE,
  CLASSES,
  ITEMS,
  MAP_OAKHAVEN,
  MONSTERS,
  applyExp,
  distanceTiles,
  expToNextLevel,
  hpRegenIntervalSeconds,
  maxHp as maxHpFormula,
  maxMana as maxResourceFormula,
  setMoveDir,
  setMoveTo,
  stepMovement,
  stopMovement,
  type EntitySnapshot,
  type EquipmentSlot,
  type Facing,
  type JobId,
  type MapDef,
  type MonsterDef,
  type MovingEntity,
  type ResourceKind,
  type ServerMessage,
  type Stats,
  type TileCoord,
} from '@terago/shared';
import type { CharacterRow, HotbarSlot, ItemRow, Repository } from '../db/repository.js';
import {
  characterAttackIntervalMs,
  characterAttackerInput,
  characterDefenderInput,
  isInCombat,
  monsterAttackerInput,
  monsterDefenderInput,
  performAttack,
  pickBark,
  rollGold,
  rollLoot,
  toWireOutcome,
} from './combat.js';
import {
  progressActiveObjectives,
  resolveNpcTalk,
  type StoredQuestState,
} from './quests.js';

/** AOI radius in tiles: reuses SPEC.md's own description of
 * autoScanRadiusTiles ("about a full 1080p screen") plus the configured
 * margin, since SPEC.md defines "viewport plus a margin" for AOI but never
 * gives viewport dimensions directly (docs/DECISIONS.md). */
const AOI_RADIUS_TILES = BALANCE.autoScanRadiusTiles + BALANCE.areaOfInterestMarginTiles;

export interface PlayerEntity extends MovingEntity {
  characterId: string;
  accountId: string;
  send: (message: ServerMessage) => void;
  name: string;

  baseLevel: number;
  jobId: JobId;
  jobLevel: number;
  baseExp: number;
  jobExp: number;
  stats: Stats;
  unallocatedStatPoints: number;

  hp: number;
  resource: number;
  gold: number;

  /** Bag contents (slot === 'bag'), kept in sync with the repository. */
  items: ItemRow[];
  /** One cached row per equipped slot. */
  equipment: Partial<Record<EquipmentSlot, ItemRow>>;
  hotbar: HotbarSlot[];
  quests: StoredQuestState[];

  targetId: string | null;
  lastAttackAt: number | null;
  lastCombatActionAt: number | null;
  lastPotionUseAt: number | null;
  mounted: boolean;
  introSeen: boolean;
  settings: Record<string, unknown>;

  /** True once something HUD-relevant changed and self:state needs resending. */
  selfStateDirty: boolean;
  /** True once anything persisted on the character row changed. */
  rowDirty: boolean;
  /** AOI bookkeeping: entity ids this player's last-sent snapshot included. */
  knownEntityIds: Set<string>;
  regenAccumulatorMs: { hp: number; resource: number };
}

export interface MonsterEntity extends MovingEntity {
  instanceId: string;
  monsterId: string;
  spawnAreaIndex: number;
  hp: number;
  maxHp: number;
  aggroCharacterId: string | null;
  lastAttackAt: number | null;
}

interface PendingRespawn {
  spawnAreaIndex: number;
  monsterId: string;
  readyAtMs: number;
}

export interface PortalTransition {
  characterId: string;
  toMapId: string;
  x: number;
  y: number;
}

export interface RoomOptions {
  roll01?: () => number;
  now?: () => number;
}

function partitionItems(items: ItemRow[]): { bag: ItemRow[]; equipment: Partial<Record<EquipmentSlot, ItemRow>> } {
  const bag: ItemRow[] = [];
  const equipment: Partial<Record<EquipmentSlot, ItemRow>> = {};
  for (const item of items) {
    if (item.slot === 'bag') {
      bag.push(item);
    } else {
      equipment[item.slot] = item;
    }
  }
  return { bag, equipment };
}

function randomWalkableTile(map: MapDef, area: { x: number; y: number; w: number; h: number }, roll01: () => number): TileCoord {
  const isWalkable = (x: number, y: number) => map.collisionRows[y]?.[x] === '.';
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = area.x + Math.floor(roll01() * area.w);
    const y = area.y + Math.floor(roll01() * area.h);
    if (isWalkable(x, y)) return { x, y };
  }
  // Fallback scan - maps.test.ts guarantees every spawn area has at least
  // one walkable tile, so this always finds one.
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      if (isWalkable(x, y)) return { x, y };
    }
  }
  throw new Error(`monster spawn area at (${area.x},${area.y}) has no walkable tile - map data is invalid`);
}

function weaponOf(player: PlayerEntity) {
  const row = player.equipment.weapon;
  const def = row ? ITEMS[row.itemId] : undefined;
  return { atk: def?.atk ?? 0, attackIntervalMs: def?.attackIntervalMs ?? 900 };
}

function armorDefOf(player: PlayerEntity): number {
  let total = 0;
  for (const slot of ['helmet', 'chest', 'boots', 'wings'] as const) {
    const row = player.equipment[slot];
    const def = row ? ITEMS[row.itemId] : undefined;
    total += def?.def ?? 0;
  }
  return total;
}

export function deriveVitals(stats: Stats, baseLevel: number, jobId: JobId): { maxHp: number; maxResource: number; resourceKind: ResourceKind } {
  const cls = CLASSES[jobId];
  return {
    maxHp: maxHpFormula(baseLevel, stats.VIT, cls.hpModifier),
    // No per-resource-kind formula exists in SPEC.md beyond Mana's (INT-based);
    // M1 only plays Recruit/Stamina, so this is reused generically for every
    // resource kind until Momentum/Focus get their own bespoke mechanics in
    // M2 (docs/DECISIONS.md).
    maxResource: maxResourceFormula(baseLevel, stats.INT),
    resourceKind: cls.resource,
  };
}

export function entitySnapshotForPlayer(player: PlayerEntity): EntitySnapshot {
  const { maxHp } = deriveVitals(player.stats, player.baseLevel, player.jobId);
  const equipment: Record<string, string | null> = {};
  for (const slot of ['weapon', 'helmet', 'chest', 'boots', 'wings'] as const) {
    equipment[slot] = player.equipment[slot]?.itemId ?? null;
  }
  return {
    id: player.characterId,
    kind: 'player',
    name: player.name,
    x: player.x,
    y: player.y,
    facing: player.facing,
    anim: animFor(player),
    hpPct: maxHp > 0 ? Math.round((player.hp / maxHp) * 100) : 0,
    equipment: equipment as EntitySnapshot['equipment'],
    mounted: player.mounted,
  };
}

export function entitySnapshotForMonster(monster: MonsterEntity, def: MonsterDef): EntitySnapshot {
  return {
    id: monster.instanceId,
    kind: 'monster',
    name: def.name,
    x: monster.x,
    y: monster.y,
    facing: monster.facing,
    anim: monster.hp <= 0 ? 'death' : animFor(monster),
    hpPct: monster.maxHp > 0 ? Math.round((monster.hp / monster.maxHp) * 100) : 0,
    monsterId: monster.monsterId,
  };
}

function animFor(entity: { path: TileCoord[] | null; heldDirection: unknown; lastAttackAt?: number | null }): EntitySnapshot['anim'] {
  if (entity.path || entity.heldDirection) return 'walk';
  return 'idle';
}

export class Room {
  readonly mapId: string;
  readonly players = new Map<string, PlayerEntity>();
  readonly monsters = new Map<string, MonsterEntity>();

  private readonly map: MapDef;
  private readonly repo: Repository;
  private readonly roll01: () => number;
  private readonly now: () => number;
  private readonly pendingRespawns: PendingRespawn[] = [];
  private tickCounter = 0;

  constructor(map: MapDef, repo: Repository, options: RoomOptions = {}) {
    this.map = map;
    this.mapId = map.id;
    this.repo = repo;
    this.roll01 = options.roll01 ?? Math.random;
    this.now = options.now ?? Date.now;

    map.monsterSpawns.forEach((spawn, index) => {
      for (let i = 0; i < spawn.maxAlive; i++) {
        this.spawnMonster(index);
      }
    });
  }

  private spawnMonster(spawnAreaIndex: number): void {
    const spawn = this.map.monsterSpawns[spawnAreaIndex];
    if (!spawn) return;
    const def = MONSTERS[spawn.monsterId];
    if (!def) return;
    const pos = randomWalkableTile(this.map, spawn.area, this.roll01);
    const monster: MonsterEntity = {
      instanceId: nanoid(),
      monsterId: spawn.monsterId,
      spawnAreaIndex,
      x: pos.x,
      y: pos.y,
      facing: 'down',
      path: null,
      heldDirection: null,
      hp: def.maxHp,
      maxHp: def.maxHp,
      aggroCharacterId: null,
      lastAttackAt: null,
    };
    this.monsters.set(monster.instanceId, monster);
  }

  /** Hydrates a connected character into this room from the repository.
   * Returns the new PlayerEntity so the caller (sim/world.ts) can track
   * which room each character is currently in. */
  join(characterId: string, send: (message: ServerMessage) => void): PlayerEntity {
    const row = this.repo.getCharacterById(characterId);
    if (!row) throw new Error(`join: character ${characterId} does not exist`);
    const { bag, equipment } = partitionItems(this.repo.listItems(characterId));
    const hotbar = this.repo.getHotbar(characterId);
    const quests = this.repo.getQuestStates(characterId);

    const player: PlayerEntity = {
      characterId: row.id,
      accountId: row.accountId,
      send,
      name: row.name,
      x: row.x,
      y: row.y,
      facing: 'down',
      path: null,
      heldDirection: null,
      baseLevel: row.baseLevel,
      jobId: row.jobId as JobId,
      jobLevel: row.jobLevel,
      baseExp: row.baseExp,
      jobExp: row.jobExp,
      stats: row.stats,
      unallocatedStatPoints: row.unallocatedStatPoints,
      hp: row.hp,
      resource: row.resource,
      gold: row.gold,
      items: bag,
      equipment,
      hotbar,
      quests,
      targetId: null,
      lastAttackAt: null,
      lastCombatActionAt: null,
      lastPotionUseAt: null,
      mounted: false,
      introSeen: row.introSeen,
      settings: row.settings,
      selfStateDirty: true,
      rowDirty: false,
      knownEntityIds: new Set(),
      regenAccumulatorMs: { hp: 0, resource: 0 },
    };
    this.players.set(characterId, player);
    this.sendSelfState(player);
    return player;
  }

  /** Persists this character's row and removes them from the room. Bag/
   * equipment/hotbar/quest changes are already written through
   * immediately (see the message handlers below), so only the character
   * row itself needs a final save here. */
  leave(characterId: string): void {
    const player = this.players.get(characterId);
    if (!player) return;
    this.saveCharacterRow(player);
    this.players.delete(characterId);
  }

  private saveCharacterRow(player: PlayerEntity): void {
    this.repo.saveCharacter(player.characterId, {
      mapId: this.mapId,
      x: player.x,
      y: player.y,
      baseLevel: player.baseLevel,
      jobId: player.jobId,
      jobLevel: player.jobLevel,
      baseExp: player.baseExp,
      jobExp: player.jobExp,
      stats: player.stats,
      unallocatedStatPoints: player.unallocatedStatPoints,
      hp: player.hp,
      resource: player.resource,
      gold: player.gold,
      settings: player.settings,
      introSeen: player.introSeen,
    });
    player.rowDirty = false;
  }

  /** Autosaves every player whose character row has changed since the last
   * save, per SPEC.md's "save on key events and every 60s". Key events call
   * saveCharacterRow directly (via markRowDirty + an immediate save where it
   * matters, e.g. on death/level-up); this sweep is the 60s safety net for
   * everything else (position drift from plain movement, in particular). */
  autosaveDirtyPlayers(): void {
    for (const player of this.players.values()) {
      if (player.rowDirty) this.saveCharacterRow(player);
    }
  }

  getMapDef(): MapDef {
    return this.map;
  }

  // ---------------------------------------------------------------- intents

  handleMoveTo(player: PlayerEntity, target: TileCoord): void {
    player.targetId = null;
    setMoveTo(player, this.map, target);
  }

  handleMoveDir(player: PlayerEntity, dx: number, dy: number): void {
    player.targetId = null;
    setMoveDir(player, dx, dy);
  }

  handleTargetSet(player: PlayerEntity, entityId: string | null): void {
    if (entityId === null) {
      player.targetId = null;
      stopMovement(player);
      return;
    }
    if (this.monsters.has(entityId) || this.map.npcs.some((n) => n.id === entityId)) {
      player.targetId = entityId;
      return;
    }
    // Unknown id, or a player id (PvP inspect/attack isn't part of M1's
    // wire protocol - see docs/DECISIONS.md): no-op rather than erroring,
    // since a stale id (the target already left/died) is an ordinary race,
    // not client misbehavior.
  }

  handleEquip(player: PlayerEntity, itemInstanceId: string): boolean {
    const row = player.items.find((i) => i.id === itemInstanceId);
    if (!row) return false;
    const def = ITEMS[row.itemId];
    if (!def || def.slot === 'consumable' || def.slot === 'material') return false;
    const slot = def.slot as EquipmentSlot;
    if (slot === 'weapon' && def.weaponType && !CLASSES[player.jobId].weaponTypes.includes(def.weaponType)) {
      return false;
    }

    const previous = player.equipment[slot];
    if (previous) {
      this.repo.setItemSlot(previous.id, 'bag');
      player.items.push(previous);
    }
    this.repo.setItemSlot(row.id, slot);
    player.items = player.items.filter((i) => i.id !== row.id);
    player.equipment[slot] = { ...row, slot };
    player.selfStateDirty = true;
    return true;
  }

  handleUnequip(player: PlayerEntity, slot: EquipmentSlot): boolean {
    const row = player.equipment[slot];
    if (!row) return false;
    this.repo.setItemSlot(row.id, 'bag');
    delete player.equipment[slot];
    player.items.push({ ...row, slot: 'bag' });
    player.selfStateDirty = true;
    return true;
  }

  handleHotbarAssign(player: PlayerEntity, slot: number, binding: { type: 'skill' | 'item'; id: string } | null): boolean {
    if (binding?.type === 'skill') return false; // no skill tree until M2
    if (binding?.type === 'item' && !player.items.some((i) => i.itemId === binding.id)) return false;
    this.repo.setHotbarSlot(player.characterId, slot, binding);
    const existing = player.hotbar.find((h) => h.slotIndex === slot);
    if (existing) existing.binding = binding;
    player.selfStateDirty = true;
    return true;
  }

  handleHotbarUse(player: PlayerEntity, slot: number): void {
    const hotbarSlot = player.hotbar.find((h) => h.slotIndex === slot);
    const binding = hotbarSlot?.binding;
    if (!binding || binding.type !== 'item') return; // empty slot, or a skill (none exist in M1)

    const def = ITEMS[binding.id];
    if (!def || def.slot !== 'consumable') return;

    const nowMs = this.now();
    if (player.lastPotionUseAt !== null && nowMs - player.lastPotionUseAt < BALANCE.autoPotionCooldownMs) {
      return; // shared potion cooldown (SPEC.md section 8), enforced for manual use too
    }
    const row = player.items.find((i) => i.itemId === binding.id && i.qty > 0);
    if (!row) return;

    if (def.healHp) {
      const { maxHp } = deriveVitals(player.stats, player.baseLevel, player.jobId);
      player.hp = Math.min(maxHp, player.hp + def.healHp);
      player.selfStateDirty = true;
      player.rowDirty = true;
    }

    player.lastPotionUseAt = nowMs;
    if (row.qty <= 1) {
      this.repo.deleteItem(row.id);
      player.items = player.items.filter((i) => i.id !== row.id);
    } else {
      this.repo.setItemQty(row.id, row.qty - 1);
      row.qty -= 1;
    }
  }

  handleStatAllocate(player: PlayerEntity, stat: keyof Stats, points: number): boolean {
    if (points > player.unallocatedStatPoints) return false;
    if (player.stats[stat] + points > BALANCE.maxManualStatPoints) return false;
    player.stats = { ...player.stats, [stat]: player.stats[stat] + points };
    player.unallocatedStatPoints -= points;
    player.selfStateDirty = true;
    player.rowDirty = true;
    return true;
  }

  handleMountToggle(player: PlayerEntity): boolean {
    if (!player.mounted) {
      if (isInCombat(player.lastCombatActionAt, this.now())) return false; // SPEC.md section 7
      player.mounted = true;
    } else {
      player.mounted = false;
    }
    return true;
  }

  /** AUTO mode runs client-side and just sends ordinary intents (SPEC.md
   * section 8); the server's only job is to persist the chosen settings so
   * they survive logout/login. */
  handleAutoToggle(player: PlayerEntity, on: boolean): void {
    player.settings = { ...player.settings, autoOn: on };
    player.rowDirty = true;
  }

  handleAutoConfigure(player: PlayerEntity, config: Record<string, unknown>): void {
    player.settings = { ...player.settings, auto: config };
    player.rowDirty = true;
  }

  /** Marks the story intro as watched so the NEXT login's self:state tells
   * the client to skip it (SPEC.md M1: "On later logins the intro is
   * skipped"). Idempotent - a client that sends this twice in one session
   * (shouldn't happen, but cheap to guard) doesn't dirty anything twice. */
  handleIntroSeen(player: PlayerEntity): void {
    if (player.introSeen) return;
    player.introSeen = true;
    player.rowDirty = true;
  }

  // ------------------------------------------------------------- dev tools
  // Only reachable through dev:command, which sim/world.ts gates on the
  // TERAGO_DEV_TOOLS env flag (SPEC.md section 2: "development mode only").

  devSetBaseLevel(player: PlayerEntity, level: number): void {
    player.baseLevel = Math.max(1, Math.min(BALANCE.maxBaseLevel, Math.round(level)));
    player.baseExp = 0;
    player.selfStateDirty = true;
    player.rowDirty = true;
  }

  devSetJobLevel(player: PlayerEntity, level: number): void {
    const max = player.jobId === 'recruit' ? BALANCE.maxJobLevelRecruit : BALANCE.maxJobLevelAdvanced;
    player.jobLevel = Math.max(1, Math.min(max, Math.round(level)));
    player.jobExp = 0;
    player.selfStateDirty = true;
    player.rowDirty = true;
  }

  devGiveItem(player: PlayerEntity, itemId: string, qty: number): boolean {
    const def = ITEMS[itemId];
    if (!def) return false;
    const added = this.repo.addItem(player.characterId, itemId, qty, def.stackable, def.maxStack);
    this.mergeLocalItem(player, added);
    player.selfStateDirty = true;
    return true;
  }

  /** Spawns one extra monster at a fixed point rather than inside a
   * configured spawn area, so it isn't tracked for respawn (spawnAreaIndex
   * -1 is never looked up by tickRespawns). */
  devSpawnMonsterAt(monsterId: string, x: number, y: number): boolean {
    const def = MONSTERS[monsterId];
    if (!def) return false;
    const monster: MonsterEntity = {
      instanceId: nanoid(),
      monsterId,
      spawnAreaIndex: -1,
      x,
      y,
      facing: 'down',
      path: null,
      heldDirection: null,
      hp: def.maxHp,
      maxHp: def.maxHp,
      aggroCharacterId: null,
      lastAttackAt: null,
    };
    this.monsters.set(monster.instanceId, monster);
    return true;
  }

  /** Talks to (or attacks, for a monster) whatever `player.targetId` names,
   * once the chase in `tick()` has brought them into range. Monsters are
   * handled continuously in `tick()`; this is only reached for NPCs, which
   * resolve in a single one-shot interaction rather than every tick. */
  private resolveNpcInteraction(player: PlayerEntity, npcId: string): void {
    const events = resolveNpcTalk(player.quests, npcId, player.baseLevel);
    for (const event of events) {
      if (event.type === 'start') {
        this.repo.upsertQuestState(
          player.characterId,
          event.quest.id,
          event.readyToTurnIn ? 'readyToTurnIn' : 'active',
          event.progress
        );
        this.setQuestLocal(player, event.quest.id, event.readyToTurnIn ? 'readyToTurnIn' : 'active', event.progress);
        player.send({
          t: 'quest:update',
          questId: event.quest.id,
          state: event.readyToTurnIn ? 'readyToTurnIn' : 'active',
          objectiveProgress: event.progress,
        });
      } else {
        this.grantQuestRewards(player, event.quest);
      }
    }
  }

  private setQuestLocal(player: PlayerEntity, questId: string, state: StoredQuestState['state'], progress: Record<string, number>): void {
    const existing = player.quests.find((q) => q.questId === questId);
    if (existing) {
      existing.state = state;
      existing.progress = progress;
    } else {
      player.quests.push({ questId, state, progress });
    }
  }

  private grantQuestRewards(player: PlayerEntity, quest: { id: string; rewardExp: number; rewardGold: number; rewardItems: Array<{ itemId: string; qty: number }> }): void {
    this.repo.upsertQuestState(player.characterId, quest.id, 'complete', player.quests.find((q) => q.questId === quest.id)?.progress ?? {});
    this.setQuestLocal(player, quest.id, 'complete', player.quests.find((q) => q.questId === quest.id)?.progress ?? {});
    this.grantExp(player, quest.rewardExp, quest.rewardExp);
    player.gold += quest.rewardGold;
    for (const reward of quest.rewardItems) {
      const added = this.repo.addItem(player.characterId, reward.itemId, reward.qty, ITEMS[reward.itemId]?.stackable ?? true, ITEMS[reward.itemId]?.maxStack ?? 1);
      this.mergeLocalItem(player, added);
    }
    player.selfStateDirty = true;
    player.rowDirty = true;
    player.send({
      t: 'quest:update',
      questId: quest.id,
      state: 'complete',
      objectiveProgress: {},
    });
    this.broadcastToRoom({ t: 'chat:message', channel: 'system', speaker: 'System', text: `${player.name} completed a quest!` }, player.characterId, /* includeSelf */ false);
  }

  private mergeLocalItem(player: PlayerEntity, row: ItemRow): void {
    const idx = player.items.findIndex((i) => i.id === row.id);
    if (idx >= 0) {
      player.items[idx] = row;
    } else {
      player.items.push(row);
    }
  }

  private grantExp(player: PlayerEntity, baseExpGained: number, jobExpGained: number): void {
    const baseResult = applyExp(player.baseLevel, player.baseExp, baseExpGained, BALANCE.baseExpCurve, BALANCE.maxBaseLevel);
    if (baseResult.levelsGained > 0) {
      player.unallocatedStatPoints += baseResult.levelsGained * BALANCE.statPointsPerLevel;
      player.rowDirty = true;
    }
    player.baseLevel = baseResult.level;
    player.baseExp = baseResult.exp;

    const jobCurve = player.jobId === 'recruit' ? BALANCE.jobExpCurveRecruit : BALANCE.jobExpCurveAdvanced;
    const jobMaxLevel = player.jobId === 'recruit' ? BALANCE.maxJobLevelRecruit : BALANCE.maxJobLevelAdvanced;
    const jobResult = applyExp(player.jobLevel, player.jobExp, jobExpGained, jobCurve, jobMaxLevel);
    player.jobLevel = jobResult.level;
    player.jobExp = jobResult.exp;

    player.selfStateDirty = true;
    player.rowDirty = true;
  }

  // -------------------------------------------------------------- chat/dev

  broadcastToRoom(message: ServerMessage, fromCharacterId: string | null, includeSelf: boolean): void {
    for (const player of this.players.values()) {
      if (!includeSelf && player.characterId === fromCharacterId) continue;
      player.send(message);
    }
  }

  // -------------------------------------------------------------------- tick

  /** Advances the room by `dtSeconds`. Returns any portal crossings for
   * sim/world.ts to apply (a Room can't move a player to another Room
   * itself - it doesn't know other rooms exist). */
  tick(dtSeconds: number): PortalTransition[] {
    this.tickCounter += 1;
    const nowMs = this.now();
    const transitions: PortalTransition[] = [];

    for (const player of this.players.values()) {
      this.tickPlayerMovement(player, dtSeconds);
      this.tickPlayerCombatAndInteraction(player, nowMs);
      this.tickRegen(player, dtSeconds, nowMs);

      const portal = this.map.portals.find(
        (p) => Math.round(player.x) === p.at.x && Math.round(player.y) === p.at.y
      );
      if (portal) {
        transitions.push({ characterId: player.characterId, toMapId: portal.toMapId, x: portal.targetSpawn.x, y: portal.targetSpawn.y });
      }
    }

    transitions.push(...this.tickMonsters(nowMs));
    this.tickRespawns(nowMs);
    this.broadcastSnapshots();

    return transitions;
  }

  private tickPlayerMovement(player: PlayerEntity, dtSeconds: number): void {
    const speed = BALANCE.playerBaseMoveSpeedTilesPerSec * (player.mounted ? BALANCE.mountSpeedMultiplier : 1);
    stepMovement(player, this.map, speed, dtSeconds);
  }

  private tickPlayerCombatAndInteraction(player: PlayerEntity, nowMs: number): void {
    if (!player.targetId) return;

    const monster = this.monsters.get(player.targetId);
    if (monster) {
      if (monster.hp <= 0) {
        player.targetId = null;
        return;
      }
      const dist = distanceTiles(player, monster);
      if (dist > BALANCE.meleeAttackRangeTiles) {
        if (!player.path || player.path.length === 0) {
          setMoveTo(player, this.map, { x: Math.round(monster.x), y: Math.round(monster.y) });
        }
        return;
      }
      stopMovement(player);
      this.tryPlayerAttack(player, monster, nowMs);
      return;
    }

    const npc = this.map.npcs.find((n) => n.id === player.targetId);
    if (npc) {
      const dist = distanceTiles(player, npc);
      if (dist > BALANCE.interactRangeTiles) {
        if (!player.path || player.path.length === 0) {
          setMoveTo(player, this.map, { x: npc.x, y: npc.y });
        }
        return;
      }
      stopMovement(player);
      this.resolveNpcInteraction(player, npc.id);
      player.targetId = null; // one-shot: talking doesn't repeat every tick while standing there
      return;
    }

    player.targetId = null; // target vanished (e.g. died) since it was set
  }

  private tryPlayerAttack(player: PlayerEntity, monster: MonsterEntity, nowMs: number): void {
    const weapon = weaponOf(player);
    const intervalMs = characterAttackIntervalMs({
      baseLevel: player.baseLevel,
      stats: player.stats,
      weaponAtk: weapon.atk,
      weaponBaseAttackIntervalMs: weapon.attackIntervalMs,
      armorDef: armorDefOf(player),
    });
    if (player.lastAttackAt !== null && nowMs - player.lastAttackAt < intervalMs) return;
    player.lastAttackAt = nowMs;
    player.lastCombatActionAt = nowMs;
    player.mounted = false; // attacking dismounts (SPEC.md section 7)

    const attackerInput = characterAttackerInput({
      baseLevel: player.baseLevel,
      stats: player.stats,
      weaponAtk: weapon.atk,
      weaponBaseAttackIntervalMs: weapon.attackIntervalMs,
      armorDef: armorDefOf(player),
    });
    const monsterDef = MONSTERS[monster.monsterId];
    if (!monsterDef) return;
    const result = performAttack(attackerInput, monsterDefenderInput(monsterDef), monster.hp, this.roll01);
    monster.hp = result.newHp;
    if (result.outcome.kind !== 'perfectDodge' && monster.aggroCharacterId === null) {
      monster.aggroCharacterId = player.characterId;
      const bark = pickBark(monsterDef, this.roll01);
      if (bark) {
        this.broadcastToRoom({ t: 'chat:message', channel: 'map', speaker: monsterDef.name, text: bark }, null, true);
      }
    }

    this.broadcastToRoom(
      { t: 'combat:result', attackerId: player.characterId, defenderId: monster.instanceId, outcome: toWireOutcome(result.outcome), damage: result.outcome.kind === 'hit' ? result.outcome.damage : undefined },
      null,
      true
    );

    if (result.died) {
      this.onMonsterDeath(player, monster, monsterDef);
    }
  }

  private onMonsterDeath(killer: PlayerEntity, monster: MonsterEntity, def: MonsterDef): void {
    this.monsters.delete(monster.instanceId);
    const spawn = this.map.monsterSpawns[monster.spawnAreaIndex];
    if (spawn) {
      this.pendingRespawns.push({ spawnAreaIndex: monster.spawnAreaIndex, monsterId: spawn.monsterId, readyAtMs: this.now() + spawn.respawnMs });
    }

    this.grantExp(killer, def.baseExpReward, def.baseExpReward);
    killer.gold += rollGold(def, this.roll01);
    for (const drop of rollLoot(def.drops, this.roll01)) {
      const itemDef = ITEMS[drop.itemId];
      const added = this.repo.addItem(killer.characterId, drop.itemId, drop.qty, itemDef?.stackable ?? true, itemDef?.maxStack ?? 1);
      this.mergeLocalItem(killer, added);
    }
    killer.selfStateDirty = true;
    killer.rowDirty = true;
    killer.targetId = null;

    const questUpdates = progressActiveObjectives(killer.quests, 'killCount', monster.monsterId);
    for (const update of questUpdates) {
      const state = update.readyToTurnIn ? 'readyToTurnIn' : 'active';
      this.repo.upsertQuestState(killer.characterId, update.questId, state, update.progress);
      this.setQuestLocal(killer, update.questId, state, update.progress);
      killer.send({ t: 'quest:update', questId: update.questId, state, objectiveProgress: update.progress });
    }
  }

  private tickMonsters(nowMs: number): PortalTransition[] {
    const deaths: PortalTransition[] = [];
    for (const monster of this.monsters.values()) {
      if (!monster.aggroCharacterId) continue;
      const attacker = this.players.get(monster.aggroCharacterId);
      const def = MONSTERS[monster.monsterId];
      if (!attacker || !def) {
        monster.aggroCharacterId = null;
        continue;
      }
      if (distanceTiles(monster, attacker) > def.attackRangeTiles) {
        monster.aggroCharacterId = null; // SPEC.md: passive monsters don't chase (docs/DECISIONS.md)
        continue;
      }
      if (monster.lastAttackAt !== null && nowMs - monster.lastAttackAt < def.attackIntervalMs) continue;
      monster.lastAttackAt = nowMs;

      const result = performAttack(
        monsterAttackerInput(def),
        characterDefenderInput({
          baseLevel: attacker.baseLevel,
          stats: attacker.stats,
          weaponAtk: 0,
          weaponBaseAttackIntervalMs: 900,
          armorDef: armorDefOf(attacker),
        }),
        attacker.hp,
        this.roll01
      );
      attacker.hp = result.newHp;
      attacker.lastCombatActionAt = nowMs;
      attacker.mounted = false; // taking damage dismounts (SPEC.md section 7)
      attacker.selfStateDirty = true;
      attacker.rowDirty = true;

      this.broadcastToRoom(
        { t: 'combat:result', attackerId: monster.instanceId, defenderId: attacker.characterId, outcome: toWireOutcome(result.outcome), damage: result.outcome.kind === 'hit' ? result.outcome.damage : undefined },
        null,
        true
      );

      if (attacker.hp <= 0) {
        monster.aggroCharacterId = null;
        deaths.push(this.respawnPlayer(attacker));
      }
    }
    return deaths;
  }

  /** No death penalty in v1 (SPEC.md names none for any milestone): a
   * defeated player is simply restored to full and sent back to Oakhaven
   * Sanctuary, "the last standing safe haven" and the only monster-free
   * map, regardless of which map they died on (docs/DECISIONS.md). Mirrors
   * a portal crossing - sim/world.ts applies the returned transition the
   * same way, resetting the player's room without this Room needing to
   * know any other room exists. */
  private respawnPlayer(player: PlayerEntity): PortalTransition {
    const { maxHp, maxResource } = deriveVitals(player.stats, player.baseLevel, player.jobId);
    player.hp = maxHp;
    player.resource = maxResource;
    player.mounted = false;
    player.lastCombatActionAt = null;
    player.targetId = null;
    stopMovement(player);
    player.selfStateDirty = true;
    player.rowDirty = true;
    player.send({ t: 'system:announce', text: 'You were defeated and have returned to Oakhaven Sanctuary.' });
    return { characterId: player.characterId, toMapId: MAP_OAKHAVEN.id, x: MAP_OAKHAVEN.spawnPoint.x, y: MAP_OAKHAVEN.spawnPoint.y };
  }

  private tickRespawns(nowMs: number): void {
    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      const pending = this.pendingRespawns[i]!;
      if (nowMs < pending.readyAtMs) continue;
      this.spawnMonster(pending.spawnAreaIndex);
      this.pendingRespawns.splice(i, 1);
    }
  }

  private tickRegen(player: PlayerEntity, dtSeconds: number, nowMs: number): void {
    const { maxHp, maxResource } = deriveVitals(player.stats, player.baseLevel, player.jobId);
    const inCombat = isInCombat(player.lastCombatActionAt, nowMs);

    player.regenAccumulatorMs.hp += dtSeconds * 1000;
    const hpIntervalMs = hpRegenIntervalSeconds(player.stats.VIT, inCombat) * 1000;
    if (player.regenAccumulatorMs.hp >= hpIntervalMs) {
      player.regenAccumulatorMs.hp = 0;
      if (player.hp > 0 && player.hp < maxHp) {
        player.hp = Math.min(maxHp, player.hp + Math.round(maxHp * 0.01));
        player.selfStateDirty = true;
      }
    }

    // Resource regen mirrors HP's cadence formula with INT substituted for
    // VIT (no bespoke per-resource-kind regen is specified in SPEC.md for
    // M1 - see deriveVitals above).
    player.regenAccumulatorMs.resource += dtSeconds * 1000;
    const resourceIntervalMs = hpRegenIntervalSeconds(player.stats.INT, inCombat) * 1000;
    if (player.regenAccumulatorMs.resource >= resourceIntervalMs) {
      player.regenAccumulatorMs.resource = 0;
      if (player.resource < maxResource) {
        player.resource = Math.min(maxResource, player.resource + Math.round(maxResource * 0.01));
        player.selfStateDirty = true;
      }
    }
  }

  private broadcastSnapshots(): void {
    const allEntities: Array<{ id: string; snapshot: () => EntitySnapshot; x: number; y: number }> = [];
    for (const player of this.players.values()) {
      allEntities.push({ id: player.characterId, snapshot: () => entitySnapshotForPlayer(player), x: player.x, y: player.y });
    }
    for (const monster of this.monsters.values()) {
      const def = MONSTERS[monster.monsterId];
      if (!def) continue;
      allEntities.push({ id: monster.instanceId, snapshot: () => entitySnapshotForMonster(monster, def), x: monster.x, y: monster.y });
    }

    for (const player of this.players.values()) {
      if (player.selfStateDirty) {
        this.sendSelfState(player);
        player.selfStateDirty = false;
      }

      const visibleNow = new Set<string>();
      for (const entity of allEntities) {
        if (distanceTiles(player, entity) <= AOI_RADIUS_TILES) visibleNow.add(entity.id);
      }

      const entered: EntitySnapshot[] = [];
      const updated: EntitySnapshot[] = [];
      const left: string[] = [];
      for (const entity of allEntities) {
        if (!visibleNow.has(entity.id)) continue;
        if (player.knownEntityIds.has(entity.id)) {
          updated.push(entity.snapshot());
        } else {
          entered.push(entity.snapshot());
        }
      }
      for (const id of player.knownEntityIds) {
        if (!visibleNow.has(id)) left.push(id);
      }
      player.knownEntityIds = visibleNow;

      if (entered.length > 0 || updated.length > 0 || left.length > 0) {
        player.send({ t: 'world:snapshot', tick: this.tickCounter, entered, updated, left });
      }
    }
  }

  private sendSelfState(player: PlayerEntity): void {
    const { maxHp, maxResource, resourceKind } = deriveVitals(player.stats, player.baseLevel, player.jobId);
    const equipment: Record<string, string | null> = {};
    for (const slot of ['weapon', 'helmet', 'chest', 'boots', 'wings'] as const) {
      equipment[slot] = player.equipment[slot]?.itemId ?? null;
    }
    const hotbar = Array.from({ length: 8 }, (_, i) => {
      const slot = player.hotbar.find((h) => h.slotIndex === i + 1);
      const binding = slot?.binding;
      if (!binding) return null;
      if (binding.type === 'skill') return { type: 'skill' as const, id: binding.id };
      const qty = player.items.filter((it) => it.itemId === binding.id).reduce((sum, it) => sum + it.qty, 0);
      return { type: 'item' as const, id: binding.id, qty };
    });
    const inventory = player.items.map((it) => ({ id: it.id, itemId: it.itemId, qty: it.qty, refineLevel: it.refineLevel }));

    player.send({
      t: 'self:state',
      characterId: player.characterId,
      name: player.name,
      mapId: this.mapId,
      baseLevel: player.baseLevel,
      jobLevel: player.jobLevel,
      jobId: player.jobId,
      baseExp: player.baseExp,
      baseExpToNext: expToNextLevel(player.baseLevel, BALANCE.baseExpCurve),
      jobExp: player.jobExp,
      jobExpToNext: expToNextLevel(
        player.jobLevel,
        player.jobId === 'recruit' ? BALANCE.jobExpCurveRecruit : BALANCE.jobExpCurveAdvanced
      ),
      stats: player.stats,
      unallocatedStatPoints: player.unallocatedStatPoints,
      introSeen: player.introSeen,
      hp: player.hp,
      maxHp,
      resource: player.resource,
      maxResource,
      resourceKind,
      equipment: equipment as Record<EquipmentSlot, string | null>,
      hotbar,
      inventory,
    });
  }
}
