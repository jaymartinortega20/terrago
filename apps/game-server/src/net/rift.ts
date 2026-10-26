import { getMap, getMonster } from '@terrago/game-data';
import { GameError, withTransaction } from '../db';
import { grantKillRewards } from '../services/equipment';
import { changeGold } from '../services/ledger';
import type { MapRuntime } from '../world/world';
import type { Player } from '../world/player';
import { CANDIDATES } from './bounties';
import { applyDelta, npcService, pushInventory, type GameplayDeps } from './gameplay';

/**
 * The Endless Rift: floor after floor of monsters in a private ring. Every floor
 * is a little stronger; every 5th has a boss and is a checkpoint you can start
 * from next time. Floors pay EXP, Gold and Rift Shards. Entry costs Gold (a sink).
 * Dying or leaving ends the run.
 */

export const RIFT_MIN_LEVEL = 10;
const AREA = { x: 3, y: 3, w: 24, h: 15 };
const NEXT_FLOOR_MS = 5000;
const BOSSES = ['king_slime', 'goblin_warchief', 'crypt_lord', 'magma_tyrant', 'sanctum_lich'];

interface Run {
  ownerId: string;
  floor: number;
  level: number;
  tag: string;
  clearedAt: number | null;
}

const runs = new Map<string, Run>();

export function riftFee(level: number, floor: number): number {
  return 100 + level * 20 + (floor - 1) * 40;
}

/** Monster level for a floor: your level, +1 per floor (capped at 120). */
export function floorLevel(level: number, floor: number): number {
  return Math.min(120, Math.max(1, level + floor - 1));
}

async function bestFloor(deps: GameplayDeps, id: string): Promise<number> {
  const { rows } = await deps.pool.query<{ best: number | null }>(`SELECT max(floor) AS best FROM rift_runs WHERE character_id = $1`, [id]);
  return rows[0]?.best ?? 0;
}

export interface RiftView {
  best: number;
  checkpoints: number[];
  fee: (floor: number) => number;
  inRun: { floor: number } | null;
}

function spawnFloor(deps: GameplayDeps, rt: MapRuntime, run: Run): void {
  const lvl = floorLevel(run.level, run.floor);
  run.tag = `rift:${run.ownerId}:${run.floor}`;
  run.clearedAt = null;
  // Monsters from the open world around this level (any map), more as you go deeper.
  const pool = [...CANDIDATES].sort((a, b) => Math.abs((a.lo + a.hi) / 2 - Math.min(100, lvl)) - Math.abs((b.lo + b.hi) / 2 - Math.min(100, lvl))).slice(0, 5);
  const players = rt.players.size;
  const count = Math.min(14, 4 + Math.floor(run.floor / 2) + players);
  for (let i = 0; i < count; i++) deps.world.combat.spawnEvent(rt, run.tag, pool[i % pool.length]!.monsterId, [lvl, lvl], 1, AREA);
  if (run.floor % 5 === 0) deps.world.combat.spawnEvent(rt, run.tag, BOSSES[(run.floor / 5 - 1) % BOSSES.length]!, [lvl, lvl], 1, AREA);
  // Deeper floors bring Elites; everyone comes for you at once.
  const eliteChance = Math.min(0.5, run.floor * 0.03);
  const targets = [...rt.players];
  let k = 0;
  for (const m of rt.monsters.values()) {
    if (m.eventTag !== run.tag) continue;
    if (!m.def.boss && Math.random() < eliteChance) deps.world.combat.makeElite(m);
    m.state = 'chase';
    m.targetId = targets[k++ % Math.max(1, targets.length)]?.id ?? null;
  }
  for (const p of rt.players) p.conn?.send('notice', { kind: 'info', text: `🌀 Rift floor ${run.floor} — ${count + (run.floor % 5 === 0 ? 1 : 0)} monsters, level ${lvl}${run.floor % 5 === 0 ? ', and a boss!' : ''}` });
}

export const rift = {
  async get(deps: GameplayDeps, p: Player, npcId: unknown): Promise<{ best: number; checkpoints: { floor: number; fee: number }[]; level: number }> {
    if (npcId !== undefined) npcService(deps.world, p, npcId, 'rift');
    const best = await bestFloor(deps, p.id);
    const checkpoints = [1, ...Array.from({ length: Math.floor(best / 5) }, (_, i) => (i + 1) * 5 + 1)].map((floor) => ({ floor, fee: riftFee(p.rec.level, floor) }));
    return { best, checkpoints, level: p.rec.level };
  },

  async enter(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
    const r = (req ?? {}) as { npcId?: unknown; floor?: unknown };
    npcService(deps.world, p, r.npcId, 'rift');
    if (p.rec.level < RIFT_MIN_LEVEL) throw new GameError(`The Rift opens at level ${RIFT_MIN_LEVEL}.`);
    if (p.arena) throw new GameError('Finish your arena match first.');
    const best = await bestFloor(deps, p.id);
    const floor = Number(r.floor ?? 1);
    if (!Number.isInteger(floor) || floor < 1 || (floor !== 1 && ((floor - 1) % 5 !== 0 || floor - 1 > best))) throw new GameError('You can start at floor 1 or a checkpoint you reached (6, 11, 16…).');
    // Party members standing with you come along.
    const group = (p.party?.members ?? [p]).filter((m) => m === p || (m.conn && m.mapId === p.mapId && Math.hypot(m.x - p.x, m.y - p.y) < 8 * 32 && !m.dead && !m.arena));
    const fee = riftFee(p.rec.level, floor);
    const gold = await withTransaction(deps.pool, async (tx) => (await changeGold(tx, p.id, -fee, 'teleport', { type: 'rift', id: String(floor) })).after);
    const inv = deps.world.inventoryCache.get(p.id);
    if (inv) pushInventory(deps.world, p, { ...inv, gold });
    const owner = { id: `rift~${p.id}~${Date.now()}`, name: p.name };
    const run: Run = { ownerId: owner.id, floor, level: Math.round(group.reduce((s, m) => s + m.rec.level, 0) / group.length), tag: '', clearedAt: null };
    runs.set(owner.id, run);
    const map = getMap('rift')!;
    for (const m of group) {
      if (m.mount) deps.world.setMount(m, null, 1);
      await deps.world.moveTo(m, map.id, owner, map.spawn.x + (m === p ? 0 : 1), map.spawn.y, 'up');
    }
    const rt = deps.world.runtimeOf(p);
    spawnFloor(deps, rt, run);
    deps.log.info('rift_enter', { characterId: p.id, floor, players: group.length });
    return { message: `Entered the Endless Rift at floor ${floor}. Good luck!` };
  },

  async leave(deps: GameplayDeps, p: Player): Promise<null> {
    const rt = deps.world.runtimeOf(p);
    if (!rt.def.rift) throw new GameError("You're not in the Rift.");
    await deps.world.moveTo(p, 'greenhaven', null, 38, 13, 'down');
    return null;
  },
};

/** A monster died somewhere: if it finished a Rift floor, pay out and open the next one. */
export function riftOnKill(deps: GameplayDeps, rt: MapRuntime): void {
  if (!rt.def.rift || !rt.owner) return;
  const run = runs.get(rt.owner.id);
  if (!run || run.clearedAt) return;
  for (const m of rt.monsters.values()) if (m.eventTag === run.tag && m.alive) return;
  run.clearedAt = Date.now();
  const floor = run.floor;
  const lvl = floorLevel(run.level, floor);
  for (const p of [...rt.players]) {
    const shards = 1 + Math.floor(floor / 5);
    const items = [{ itemId: 'rift_shard', quantity: shards }, ...(floor % 5 === 0 ? [{ itemId: 'enhancement_stone', quantity: 1 + Math.floor(floor / 10) }] : [])];
    const xp = Math.round((lvl * lvl * 0.8 + 40) * (1 + floor * 0.05));
    const gold = Math.round(lvl * 12 * (1 + floor * 0.08));
    void p
      .serial(async () => {
        const res = await grantKillRewards(deps.pool, p.id, { xp, gold, items, monster: `rift:${floor}` }, 'achievement');
        pushInventory(deps.world, p, res.inventory);
        applyDelta(deps.world, p, res.delta);
        await deps.pool.query(`INSERT INTO rift_runs (character_id, floor) VALUES ($1, $2)`, [p.id, floor]);
        p.conn?.send('notice', { kind: 'success', text: `🌀 Floor ${floor} cleared! +${xp.toLocaleString()} XP, +${gold.toLocaleString()} Gold, +${shards} Rift Shard${shards > 1 ? 's' : ''}. Floor ${floor + 1} in 5 seconds…` });
        p.conn?.send('rift', { floor: floor + 1, startsAt: Date.now() + NEXT_FLOOR_MS });
      })
      .catch((err) => deps.log.error('rift_reward_failed', { err }));
    // A breather: a third of your health back.
    p.rec.hp = Math.min(p.profile.maxHp, p.rec.hp + Math.round(p.profile.maxHp / 3));
  }
  setTimeout(() => {
    if (runs.get(run.ownerId) !== run || !rt.players.size) return;
    run.floor++;
    spawnFloor(deps, rt, run);
  }, NEXT_FLOOR_MS).unref();
}

/** Drop finished runs (everyone left or died). */
export function startRiftJanitor(deps: GameplayDeps): () => void {
  const t = setInterval(() => {
    for (const [id, run] of runs) {
      const rt = [...deps.world.runtimes()].find((r) => r.owner?.id === id);
      if (!rt || !rt.players.size) {
        if (rt) for (const m of [...rt.monsters.values()]) if (m.eventTag?.startsWith(`rift:${id}`)) deps.world.combat.despawnEvent(rt, m.eventTag);
        runs.delete(id);
        void run;
      }
    }
  }, 10_000);
  t.unref();
  return () => clearInterval(t);
}

export const riftMonsterName = (id: string) => getMonster(id)?.name ?? id;
