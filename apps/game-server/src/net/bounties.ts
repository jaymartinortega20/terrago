import { createHash } from 'node:crypto';
import { MAPS, getMonster } from '@terrago/game-data';
import type { BountyBoard, BountyTier, BountyView } from '@terrago/shared';
import { GameError, withTransaction } from '../db';
import { grantKillRewards } from '../services/equipment';
import type { Player } from '../world/player';
import { applyDelta, npcService, pushInventory, type GameplayDeps } from './gameplay';

/**
 * Bounty board: three hunting contracts a day (Easy / Normal / Hard), picked
 * for your level from monsters that live on the open maps. Accept them at a
 * board (Guildmaster Kael, Ranger Wren, the map scouts), hunt, and hand them
 * in at any board. Progress only counts after you accept.
 */

const today = () => new Date().toISOString().slice(0, 10);

interface Candidate {
  monsterId: string;
  map: string;
  x: number;
  y: number;
  lo: number;
  hi: number;
}

/** Every regular (non-boss) monster spawn on the open maps. */
const CANDIDATES: Candidate[] = (() => {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const m of Object.values(MAPS)) {
    if (m.id.startsWith('dg_') || m.instanced) continue;
    for (const s of m.spawns ?? []) {
      const def = getMonster(s.monster);
      if (!def || def.boss || seen.has(s.monster)) continue;
      seen.add(s.monster);
      out.push({ monsterId: s.monster, map: m.id, x: s.area.x + Math.floor(s.area.w / 2), y: s.area.y + Math.floor(s.area.h / 2), lo: s.level[0], hi: s.level[1] });
    }
  }
  return out;
})();

const TIERS: { tier: BountyTier; count: number; mult: number }[] = [
  { tier: 'Easy', count: 10, mult: 1 },
  { tier: 'Normal', count: 15, mult: 1.6 },
  { tier: 'Hard', count: 20, mult: 2.5 },
];

function hash(s: string): number {
  return createHash('sha1').update(s).digest().readUInt32BE(0);
}

export function bountyReward(level: number, idx: number): BountyView['reward'] {
  const t = TIERS[idx]!;
  const tens = t.count / 10;
  const gold = Math.round(level * 14 * tens * t.mult);
  const xp = Math.round((level * level * 1.6 + 60) * tens * t.mult);
  const items = idx === 2 ? [{ itemId: 'enhancement_stone', quantity: 1 + Math.floor(level / 35) }] : idx === 1 && level >= 10 ? [{ itemId: 'minor_health_potion', quantity: 2 }] : [];
  return { gold, xp, items };
}

/** Today's three offers for a character of this level (stable for the day). */
export function bountyOffers(characterId: string, level: number, day = today()): { idx: number; c: Candidate }[] {
  // Monsters around your level; Hard ones lean a little higher.
  const fit = (c: Candidate, lo: number, hi: number) => c.lo <= level + hi && c.hi >= level - lo;
  let pool = CANDIDATES.filter((c) => fit(c, 8, 3));
  if (pool.length < 3) pool = [...CANDIDATES].sort((a, b) => Math.abs((a.lo + a.hi) / 2 - level) - Math.abs((b.lo + b.hi) / 2 - level)).slice(0, 4);
  // Easy from the weaker half, Hard from the stronger half, Normal from anywhere.
  const byLevel = [...pool].sort((a, b) => a.lo + a.hi - (b.lo + b.hi));
  const half = Math.ceil(byLevel.length / 2);
  const pools = [byLevel.slice(0, half), byLevel, byLevel.slice(byLevel.length - half)];
  const used = new Set<string>();
  const out: { idx: number; c: Candidate }[] = [];
  for (let idx = 0; idx < 3; idx++) {
    const fresh = pools[idx]!.filter((c) => !used.has(c.monsterId));
    const from = fresh.length ? fresh : pools[idx]!;
    const c = from.map((x) => ({ x, h: hash(`${characterId}:${day}:${idx}:${x.monsterId}`) })).sort((a, b) => a.h - b.h)[0]!.x;
    used.add(c.monsterId);
    out.push({ idx, c });
  }
  return out;
}

function view(idx: number, c: Candidate, row: { count: number; progress: number; claimed: boolean } | undefined): BountyView {
  const t = TIERS[idx]!;
  const level = Math.round((c.lo + c.hi) / 2);
  return {
    idx,
    tier: t.tier,
    monsterId: c.monsterId,
    monsterName: getMonster(c.monsterId)?.name ?? c.monsterId,
    where: { map: c.map, x: c.x, y: c.y },
    level,
    count: row?.count ?? t.count,
    progress: row?.progress ?? 0,
    accepted: !!row,
    claimed: !!row?.claimed,
    reward: bountyReward(level, idx),
  };
}

const byMonster = new Map(CANDIDATES.map((c) => [c.monsterId, c]));

/** Accepted bounties keep the monster they were accepted with, even if you level up. */
export async function board(deps: GameplayDeps, p: Player): Promise<BountyBoard> {
  const day = today();
  const { rows } = await deps.pool.query(`SELECT idx, monster_id, count, progress, claimed FROM bounties WHERE character_id = $1 AND day = $2`, [p.id, day]);
  const mine = new Map(rows.map((r) => [r.idx as number, r]));
  const offers = bountyOffers(p.id, p.rec.level, day);
  const bounties = offers.map(({ idx, c }) => {
    const r = mine.get(idx);
    const cc = (r && byMonster.get(r.monster_id)) || c;
    return view(idx, cc, r ? { count: r.count, progress: r.progress, claimed: r.claimed } : undefined);
  });
  p.bountyTargets = { day, ids: new Set(rows.filter((r) => !r.claimed).map((r) => r.monster_id as string)) };
  return { bounties, resetsAt: new Date(`${day}T00:00:00Z`).getTime() + 86_400_000 };
}

export const bounties = {
  async get(deps: GameplayDeps, p: Player, npcId: unknown): Promise<BountyBoard> {
    npcService(deps.world, p, npcId, 'bounty');
    return board(deps, p);
  },

  async accept(deps: GameplayDeps, p: Player, req: unknown): Promise<BountyBoard> {
    const r = (req ?? {}) as { npcId?: unknown; idx?: unknown };
    npcService(deps.world, p, r.npcId, 'bounty');
    const idx = r.idx;
    if (!Number.isInteger(idx) || (idx as number) < 0 || (idx as number) > 2) throw new GameError('Unknown bounty.');
    const offer = bountyOffers(p.id, p.rec.level).find((o) => o.idx === idx)!;
    const ins = await deps.pool.query(
      `INSERT INTO bounties (character_id, day, idx, monster_id, count) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [p.id, today(), idx, offer.c.monsterId, TIERS[idx as number]!.count],
    );
    if (!ins.rowCount) throw new GameError('You already took that bounty.');
    return board(deps, p);
  },

  async claim(deps: GameplayDeps, p: Player, req: unknown): Promise<{ board: BountyBoard; message: string }> {
    const r = (req ?? {}) as { npcId?: unknown; idx?: unknown };
    npcService(deps.world, p, r.npcId, 'bounty');
    if (!Number.isInteger(r.idx)) throw new GameError('Unknown bounty.');
    const won = await withTransaction(deps.pool, async (tx) => {
      const { rows } = await tx.query(
        `UPDATE bounties SET claimed = true WHERE character_id = $1 AND day = $2 AND idx = $3 AND progress >= count AND NOT claimed RETURNING monster_id`,
        [p.id, today(), r.idx],
      );
      return rows[0]?.monster_id as string | undefined;
    });
    if (!won) throw new GameError('Finish the hunt first (or you already handed it in).');
    const c = byMonster.get(won)!;
    const reward = bountyReward(Math.round((c.lo + c.hi) / 2), r.idx as number);
    const res = await grantKillRewards(deps.pool, p.id, { xp: reward.xp, gold: reward.gold, items: reward.items, monster: `bounty:${won}` }, 'daily_reward');
    pushInventory(deps.world, p, res.inventory);
    applyDelta(deps.world, p, res.delta);
    const rt = deps.world.runtimeOf(p);
    for (const o of res.overflow) deps.world.addDrop(rt, p.x, p.y, o.itemId, o.quantity, p.id);
    return { board: await board(deps, p), message: `Bounty complete: +${reward.gold.toLocaleString()} Gold, +${reward.xp.toLocaleString()} XP` };
  },
};

/** A kill: advance any accepted bounty for that monster. */
export function bountyKill(deps: GameplayDeps, p: Player, monsterId: string): void {
  const day = today();
  if (!p.bountyTargets || p.bountyTargets.day !== day) {
    // First kill of the day (or since login): load what's active.
    p.bountyTargets = { day, ids: new Set() };
    void deps.pool
      .query(`SELECT monster_id FROM bounties WHERE character_id = $1 AND day = $2 AND NOT claimed`, [p.id, day])
      .then(({ rows }) => {
        for (const r of rows) p.bountyTargets!.ids.add(r.monster_id);
        if (p.bountyTargets!.ids.has(monsterId)) bountyKill(deps, p, monsterId);
      })
      .catch((err) => deps.log.error('bounty_load_failed', { err }));
    return;
  }
  if (!p.bountyTargets.ids.has(monsterId)) return;
  void deps.pool
    .query(
      `UPDATE bounties SET progress = LEAST(progress + 1, count) WHERE character_id = $1 AND day = $2 AND monster_id = $3 AND NOT claimed AND progress < count RETURNING progress, count`,
      [p.id, day, monsterId],
    )
    .then(({ rows }) => {
      for (const r of rows) {
        const name = getMonster(monsterId)?.name ?? monsterId;
        if (r.progress >= r.count) p.conn?.send('notice', { kind: 'success', text: `📜 Bounty done: ${r.count} ${name}! Hand it in at a bounty board.` });
        else if (r.progress % 5 === 0) p.conn?.send('notice', { kind: 'info', text: `Bounty: ${name} ${r.progress}/${r.count}` });
      }
    })
    .catch((err) => deps.log.error('bounty_progress_failed', { err }));
}
