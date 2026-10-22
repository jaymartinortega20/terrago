import { getClass, getJob } from '@terrago/game-data';
import { JOB_LEVEL, type BaseStats, type JobId } from '@terrago/shared';
import { GameError } from '../db';
import { unspentStatPoints } from '../world/characterState';
import type { Player } from '../world/player';
import type { GameplayDeps } from './gameplay';
import { npcService } from './gameplay';

const STAT_COLUMNS: Record<keyof BaseStats, string> = {
  strength: 'strength',
  agility: 'agility',
  intelligence: 'intelligence',
  vitality: 'vitality',
  luck: 'luck',
};

/** Spend stat points (RO-style): every level gives points to put where you like. */
export async function addStatPoints(deps: GameplayDeps, p: Player, req: unknown): Promise<{ stats: BaseStats; statPoints: number }> {
  const r = (req ?? {}) as { stat?: unknown; amount?: unknown };
  const stat = String(r.stat ?? '') as keyof BaseStats;
  const amount = Math.floor(Number(r.amount ?? 1));
  if (!(stat in STAT_COLUMNS)) throw new GameError('Unknown stat.');
  if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw new GameError('Bad amount.');
  const left = unspentStatPoints(p.rec);
  if (amount > left) throw new GameError(left ? `You only have ${left} stat point${left === 1 ? '' : 's'}.` : 'No stat points left. You get 5 every level.');
  const col = STAT_COLUMNS[stat];
  await deps.pool.query(`UPDATE character_stats SET ${col} = ${col} + $2 WHERE character_id = $1`, [p.id, amount]);
  p.rec.stats = { ...p.rec.stats, [stat]: p.rec.stats[stat] + amount };
  deps.world.refreshProfile(p);
  const statPoints = unspentStatPoints(p.rec);
  p.conn?.send('self:update', { statPoints });
  return { stats: p.rec.stats, statPoints };
}

/** Become a second job at the Job Trainer (level 40, once, one of your class's two paths). */
export async function advanceJob(deps: GameplayDeps, p: Player, req: unknown): Promise<{ job: JobId; message: string }> {
  const r = (req ?? {}) as { npcId?: unknown; job?: unknown };
  npcService(deps.world, p, r.npcId, 'job');
  if (p.rec.job) throw new GameError(`You are already a ${getJob(p.rec.job)?.name}.`);
  if (p.rec.level < JOB_LEVEL) throw new GameError(`Come back at level ${JOB_LEVEL}.`);
  const cls = getClass(p.rec.classId);
  const job = cls.jobs.find((j) => j.id === r.job);
  if (!job) throw new GameError(`A ${cls.name} can become a ${cls.jobs.map((j) => j.name).join(' or ')}.`);
  await deps.pool.query(`UPDATE characters SET job = $2 WHERE id = $1 AND job IS NULL`, [p.id, job.id]);
  p.rec.job = job.id;
  deps.world.refreshProfile(p);
  p.rec.hp = p.profile.maxHp;
  p.conn?.send('self:update', { job: job.id, hp: p.rec.hp });
  deps.world.broadcastLook(p, { job: job.id });
  deps.world.announce(`${p.name} has become a ${job.name}!`);
  return { job: job.id, message: `You are now a ${job.name}! New skills are waiting in your Skills window (K).` };
}
