import { createHash } from 'node:crypto';
import { ACHIEVEMENTS, DAILY_TASKS, getItem } from '@terrago/game-data';
import {
  LEADERBOARDS,
  LOGIN_REWARDS,
  dailyTaskReward,
  type JournalView,
  type LeaderboardId,
  type LeaderboardRow,
  type QuestStepType,
} from '@terrago/shared';
import { GameError, withTransaction } from '../db';
import { grantKillRewards } from '../services/equipment';
import { guildQuestEvent } from './guildQuests';
import type { Player } from '../world/player';
import { applyDelta, pushInventory, type GameplayDeps } from './gameplay';

/**
 * Long-term progress: counters (kills, harvests...), achievements, daily
 * login rewards, three daily tasks, and leaderboards.
 */

const today = () => new Date().toISOString().slice(0, 10);
const chains = new WeakMap<Player, Promise<unknown>>();

/** Run per-player progress work in order, off the hot path. */
export function queue(deps: GameplayDeps, p: Player, work: () => Promise<void>): void {
  const next = (chains.get(p) ?? Promise.resolve()).then(work, work).catch((err) => deps.log.error('progress_failed', { err }));
  chains.set(p, next);
}

async function give(deps: GameplayDeps, p: Player, r: { gold: number; xp?: number; items?: { itemId: string; quantity: number }[] }, reason: 'daily_reward' | 'achievement', ref: string) {
  const res = await grantKillRewards(deps.pool, p.id, { xp: r.xp ?? 0, gold: r.gold, items: r.items ?? [], monster: ref }, reason);
  pushInventory(deps.world, p, res.inventory);
  applyDelta(deps.world, p, res.delta);
  const rt = deps.world.runtimeOf(p);
  for (const o of res.overflow) deps.world.addDrop(rt, p.x, p.y, o.itemId, o.quantity, p.id);
}

/** Add to a counter (or raise it to `value` with mode 'max') and unlock any achievements it completes. */
export function track(deps: GameplayDeps, p: Player, key: string, n = 1, mode: 'add' | 'max' = 'add'): void {
  queue(deps, p, async () => {
    const { rows } = await deps.pool.query(
      mode === 'add'
        ? `INSERT INTO character_counters (character_id, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (character_id, key) DO UPDATE SET value = character_counters.value + EXCLUDED.value RETURNING value`
        : `INSERT INTO character_counters (character_id, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (character_id, key) DO UPDATE SET value = GREATEST(character_counters.value, EXCLUDED.value) RETURNING value`,
      [p.id, key, n],
    );
    const value = Number(rows[0].value);
    for (const a of ACHIEVEMENTS) {
      if (a.stat !== key || value < a.goal) continue;
      const ins = await deps.pool.query(`INSERT INTO character_achievements (character_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [p.id, a.id]);
      if (!ins.rowCount) continue;
      await give(deps, p, { gold: a.reward.gold }, 'achievement', a.id);
      p.conn?.send('achievement', { id: a.id, name: a.name, icon: a.icon, gold: a.reward.gold });
      deps.log.info('achievement_unlocked', { characterId: p.id, achievement: a.id });
    }
  });
}

/** The three daily tasks for a character today (stable for the whole day). */
export function tasksFor(characterId: string, level: number, day = today()) {
  const pool = DAILY_TASKS.filter((t) => t.minLevel <= level);
  const ranked = pool
    .map((t) => ({ t, h: createHash('sha1').update(`${characterId}:${day}:${t.id}`).digest().readUInt32BE(0) }))
    .sort((a, b) => a.h - b.h);
  // At most one task per event type, so the three feel different.
  const out: typeof pool = [];
  for (const { t } of ranked) if (out.length < 3 && !out.some((x) => x.event === t.event)) out.push(t);
  return out;
}

/** Feed a game event (kill, harvest, fish...) into counters and daily tasks. */
export function progressEvent(deps: GameplayDeps, p: Player, type: QuestStepType | 'boss', target: string | null, n = 1): void {
  const counter: Partial<Record<string, string>> = { kill: 'kills', harvest: 'harvests', fish: 'fish', gather: 'gathered', craft: 'crafted', boss: 'boss_kills' };
  const key = counter[type];
  if (key) track(deps, p, key, n);
  if (type === 'visit' && target?.startsWith('dg_')) track(deps, p, 'dungeon_runs');
  if (p.guild && (type === 'kill' || type === 'gather' || type === 'fish' || type === 'harvest' || type === 'craft' || type === 'boss')) queue(deps, p, () => guildQuestEvent(deps, p, type, n));
  const tasks = tasksFor(p.id, p.rec.level).filter((t) => t.event === type && (!t.target || t.target === target));
  if (!tasks.length) return;
  queue(deps, p, async () => {
    const day = today();
    for (const t of tasks) {
      const { rows } = await deps.pool.query(
        `INSERT INTO daily_tasks (character_id, day, task_id, progress) VALUES ($1, $2, $3, LEAST($4::int, $5::int))
         ON CONFLICT (character_id, day, task_id) DO UPDATE SET progress = LEAST(daily_tasks.progress + $4::int, $5::int)
         RETURNING progress`,
        [p.id, day, t.id, n, t.count],
      );
      const prog = rows[0].progress as number;
      if (prog >= t.count && prog - n < t.count) p.conn?.send('notice', { kind: 'success', text: `📅 Daily task done: ${t.text}! Claim it in your Journal (L).` });
    }
  });
}

export async function journal(deps: GameplayDeps, p: Player): Promise<JournalView> {
  const day = today();
  const [login, tasks, ach, counters] = await Promise.all([
    deps.pool.query(`SELECT last_day::text AS last_day, streak FROM daily_rewards WHERE character_id = $1`, [p.id]),
    deps.pool.query(`SELECT task_id, progress, claimed FROM daily_tasks WHERE character_id = $1 AND day = $2`, [p.id, day]),
    deps.pool.query(`SELECT achievement_id, unlocked_at FROM character_achievements WHERE character_id = $1`, [p.id]),
    deps.pool.query(`SELECT key, value FROM character_counters WHERE character_id = $1`, [p.id]),
  ]);
  const l = login.rows[0];
  const claimedToday = l?.last_day === day;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const streak = l ? (claimedToday ? l.streak : l.last_day === yesterday ? l.streak + 1 : 1) : 1;
  const prog = new Map(tasks.rows.map((r) => [r.task_id, r]));
  const unlocked = new Map(ach.rows.map((r) => [r.achievement_id, new Date(r.unlocked_at).getTime()]));
  const count = new Map(counters.rows.map((r) => [r.key, Number(r.value)]));
  count.set('level', Math.max(count.get('level') ?? 0, p.rec.level));
  const midnight = new Date(`${day}T00:00:00Z`).getTime() + 86_400_000;
  return {
    login: { streak, claimedToday, day: ((streak - 1) % LOGIN_REWARDS.length) + 1 },
    tasks: tasksFor(p.id, p.rec.level, day).map((t) => ({ id: t.id, text: t.text, count: t.count, progress: prog.get(t.id)?.progress ?? 0, claimed: !!prog.get(t.id)?.claimed })),
    achievements: ACHIEVEMENTS.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      goal: a.goal,
      progress: Math.min(a.goal, count.get(a.stat) ?? 0),
      unlockedAt: unlocked.get(a.id) ?? null,
      gold: a.reward.gold,
    })),
    resetsAt: midnight,
  };
}

/** Claim today's login reward; the streak grows on consecutive days. */
export async function claimLogin(deps: GameplayDeps, p: Player): Promise<{ message: string }> {
  const day = today();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const streak = await withTransaction(deps.pool, async (tx) => {
    const { rows } = await tx.query(`SELECT last_day::text AS last_day, streak FROM daily_rewards WHERE character_id = $1 FOR UPDATE`, [p.id]);
    const l = rows[0];
    if (l?.last_day === day) throw new GameError("You've already claimed today's reward. Come back tomorrow!");
    const s = l && l.last_day === yesterday ? l.streak + 1 : 1;
    await tx.query(
      `INSERT INTO daily_rewards (character_id, last_day, streak) VALUES ($1, $2, $3)
       ON CONFLICT (character_id) DO UPDATE SET last_day = EXCLUDED.last_day, streak = EXCLUDED.streak`,
      [p.id, day, s],
    );
    return s as number;
  });
  const reward = LOGIN_REWARDS[(streak - 1) % LOGIN_REWARDS.length]!;
  await give(deps, p, reward, 'daily_reward', `login:${streak}`);
  const items = (reward.items ?? []).map((i) => `${i.quantity}× ${getItem(i.itemId)?.name}`);
  return { message: `Day ${streak} reward: ${[`${reward.gold} Gold`, ...items].join(', ')}!` };
}

export async function claimTask(deps: GameplayDeps, p: Player, taskId: unknown): Promise<{ message: string }> {
  const t = tasksFor(p.id, p.rec.level).find((x) => x.id === taskId);
  if (!t) throw new GameError("That isn't one of today's tasks.");
  const { rowCount } = await deps.pool.query(
    `UPDATE daily_tasks SET claimed = true WHERE character_id = $1 AND day = $2 AND task_id = $3 AND progress >= $4 AND NOT claimed`,
    [p.id, today(), t.id, t.count],
  );
  if (!rowCount) throw new GameError('Finish the task first (or you already claimed it).');
  const r = dailyTaskReward(p.rec.level);
  await give(deps, p, r, 'daily_reward', t.id);
  track(deps, p, 'dailies');
  return { message: `${t.text}: +${r.gold} Gold, +${r.xp} XP` };
}

// --- Leaderboards (cached for a minute) --------------------------------------

const cache = new Map<LeaderboardId, { at: number; rows: LeaderboardRow[] }>();

const QUERIES: Record<LeaderboardId, string> = {
  level: `SELECT c.id, c.name, c.class_id, c.level, c.xp AS value FROM characters c WHERE c.deleted_at IS NULL ORDER BY c.level DESC, c.xp DESC LIMIT 50`,
  arena: `SELECT c.id, c.name, c.class_id, c.level, r.rating AS value FROM characters c JOIN arena_ratings r ON r.character_id = c.id
          WHERE c.deleted_at IS NULL AND r.season = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM') AND r.wins + r.losses > 0 ORDER BY r.rating DESC, r.wins DESC LIMIT 50`,
  rift: `SELECT c.id, c.name, c.class_id, c.level, max(r.floor) AS value FROM characters c JOIN rift_runs r ON r.character_id = c.id
          WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY value DESC, min(r.created_at) LIMIT 50`,
  wealth: `SELECT c.id, c.name, c.class_id, c.level, c.gold AS value FROM characters c WHERE c.deleted_at IS NULL ORDER BY c.gold DESC LIMIT 50`,
  achievements: `SELECT c.id, c.name, c.class_id, c.level, count(a.*) AS value FROM characters c JOIN character_achievements a ON a.character_id = c.id
                 WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY value DESC, min(a.unlocked_at) LIMIT 50`,
  boss_kills: `SELECT c.id, c.name, c.class_id, c.level, k.value FROM characters c JOIN character_counters k ON k.character_id = c.id AND k.key = 'boss_kills'
               WHERE c.deleted_at IS NULL ORDER BY k.value DESC LIMIT 50`,
  farming: skill('farming'),
  fishing: skill('fishing'),
  mining: skill('mining'),
  woodcutting: skill('woodcutting'),
};

function skill(id: string): string {
  return `SELECT c.id, c.name, c.class_id, c.level, s.level * 1000000000 + s.xp AS value FROM characters c
            JOIN character_skills s ON s.character_id = c.id AND s.skill = '${id}'
           WHERE c.deleted_at IS NULL ORDER BY s.level DESC, s.xp DESC LIMIT 50`;
}

export async function leaderboard(deps: GameplayDeps, p: Player, id: unknown): Promise<{ rows: LeaderboardRow[]; me: LeaderboardRow | null }> {
  const board = LEADERBOARDS.find((b) => b === id);
  if (!board) throw new GameError('Unknown leaderboard.');
  let c = cache.get(board);
  if (!c || Date.now() - c.at > 60_000) {
    const { rows } = await deps.pool.query(QUERIES[board]);
    const ids = rows.map((r) => r.id);
    const g = ids.length
      ? await deps.pool.query(`SELECT m.character_id, g.tag FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.character_id = ANY($1)`, [ids])
      : { rows: [] };
    const tags = new Map(g.rows.map((r) => [r.character_id, r.tag]));
    const isSkill = board === 'farming' || board === 'fishing' || board === 'mining' || board === 'woodcutting';
    c = {
      at: Date.now(),
      rows: rows.map((r, i) => ({
        rank: i + 1,
        id: r.id,
        name: r.name,
        classId: r.class_id,
        level: r.level,
        value: isSkill ? Math.floor(Number(r.value) / 1_000_000_000) : Number(r.value),
        guild: tags.get(r.id) ?? null,
      })),
    };
    cache.set(board, c);
  }
  return { rows: c.rows.slice(0, 20), me: c.rows.find((r) => r.id === p.id) ?? null };
}
