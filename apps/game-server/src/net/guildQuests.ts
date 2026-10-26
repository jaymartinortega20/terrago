import { createHash, randomUUID } from 'node:crypto';
import { GUILD_QUESTS, GUILD_QUEST_TREASURY, GUILD_QUEST_XP, guildLevel, guildQuestReward, guildWeek, type GuildQuestDef, type GuildQuestEvent, type GuildQuestsView } from '@terrago/shared';
import { GameError, withTransaction } from '../db';
import { grantKillRewards } from '../services/equipment';
import type { Player } from '../world/player';
import { applyDelta, pushInventory, type GameplayDeps } from './gameplay';

/**
 * Guild quests: every Monday each guild gets three shared goals ("Defeat
 * 1,500 monsters"). Every member's play counts. When a goal is reached the
 * treasury gets a bonus and everyone who helped can collect a reward.
 */

/** This week's three quests for a guild (one per kind of activity). */
export function guildQuestsFor(guildId: number, week: string): GuildQuestDef[] {
  return [...GUILD_QUESTS]
    .map((q) => ({ q, h: createHash('sha1').update(`${guildId}:${week}:${q.id}`).digest().readUInt32BE(0) }))
    .sort((a, b) => a.h - b.h)
    .slice(0, 3)
    .map((x) => x.q);
}

const nextMonday = (week: string) => new Date(`${week}T00:00:00Z`).getTime() + 7 * 86_400_000;

/** Count some play toward the guild's quests (call from the player's progress queue). */
export async function guildQuestEvent(deps: GameplayDeps, p: Player, event: GuildQuestEvent, n: number): Promise<void> {
  const g = p.guild;
  if (!g || n <= 0) return;
  const week = guildWeek(Date.now());
  const quests = guildQuestsFor(g.id, week).filter((q) => q.event === event);
  for (const q of quests) {
    const done = await withTransaction(deps.pool, async (tx) => {
      await tx.query(`INSERT INTO guild_quests (guild_id, week, quest_id, goal) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [g.id, week, q.id, q.goal]);
      const { rows } = await tx.query(
        `UPDATE guild_quests SET progress = LEAST(goal, progress + $4) WHERE guild_id = $1 AND week = $2 AND quest_id = $3 AND completed_at IS NULL RETURNING progress, goal`,
        [g.id, week, q.id, n],
      );
      if (!rows.length) return false; // already finished: extra play doesn't count
      await tx.query(
        `INSERT INTO guild_quest_members (guild_id, week, quest_id, character_id, amount) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (guild_id, week, quest_id, character_id) DO UPDATE SET amount = guild_quest_members.amount + EXCLUDED.amount`,
        [g.id, week, q.id, p.id, n],
      );
      if (rows[0].progress < rows[0].goal) return false;
      await tx.query(`UPDATE guild_quests SET completed_at = now() WHERE guild_id = $1 AND week = $2 AND quest_id = $3`, [g.id, week, q.id]);
      await tx.query(`UPDATE guilds SET treasury = treasury + $2, xp = xp + $3 WHERE id = $1`, [g.id, GUILD_QUEST_TREASURY, GUILD_QUEST_XP]);
      levelCache.delete(g.id);
      return true;
    });
    if (done) {
      for (const m of deps.world.players.values()) {
        if (m.guild?.id !== g.id) continue;
        m.conn?.send('chat', {
          id: randomUUID(),
          channel: 'guild',
          fromId: null,
          fromName: g.tag,
          text: `🏆 Guild quest complete: ${q.text}! +${GUILD_QUEST_TREASURY.toLocaleString()} Gold to the treasury and +${GUILD_QUEST_XP} guild XP. Everyone who helped: collect your reward in the Guild window.`,
          ts: Date.now(),
        });
      }
      deps.log.info('guild_quest_done', { guild: g.id, quest: q.id });
    }
  }
}

export async function guildQuestsView(deps: GameplayDeps, p: Player): Promise<GuildQuestsView> {
  const g = p.guild;
  if (!g) throw new GameError("You're not in a guild.");
  const week = guildWeek(Date.now());
  const defs = guildQuestsFor(g.id, week);
  const [qs, mine] = await Promise.all([
    deps.pool.query(`SELECT quest_id, goal, progress, completed_at FROM guild_quests WHERE guild_id = $1 AND week = $2`, [g.id, week]),
    deps.pool.query(`SELECT quest_id, amount, claimed FROM guild_quest_members WHERE guild_id = $1 AND week = $2 AND character_id = $3`, [g.id, week, p.id]),
  ]);
  const row = new Map(qs.rows.map((r) => [r.quest_id, r]));
  const my = new Map(mine.rows.map((r) => [r.quest_id, r]));
  return {
    week,
    resetsAt: nextMonday(week),
    quests: defs.map((d) => ({
      id: d.id,
      text: d.text,
      goal: row.get(d.id)?.goal ?? d.goal,
      progress: row.get(d.id)?.progress ?? 0,
      completed: !!row.get(d.id)?.completed_at,
      mine: my.get(d.id)?.amount ?? 0,
      claimed: !!my.get(d.id)?.claimed,
      reward: guildQuestReward(p.rec.level),
    })),
  };
}

export async function claimGuildQuest(deps: GameplayDeps, p: Player, questId: unknown): Promise<{ view: GuildQuestsView; message: string }> {
  const g = p.guild;
  if (!g) throw new GameError("You're not in a guild.");
  const week = guildWeek(Date.now());
  if (typeof questId !== 'string' || !guildQuestsFor(g.id, week).some((q) => q.id === questId)) throw new GameError('Unknown guild quest.');
  const { rowCount } = await deps.pool.query(
    `UPDATE guild_quest_members m SET claimed = true
       FROM guild_quests q
      WHERE m.guild_id = $1 AND m.week = $2 AND m.quest_id = $3 AND m.character_id = $4 AND NOT m.claimed AND m.amount > 0
        AND q.guild_id = m.guild_id AND q.week = m.week AND q.quest_id = m.quest_id AND q.completed_at IS NOT NULL`,
    [g.id, week, questId, p.id],
  );
  if (!rowCount) throw new GameError('Help finish it first (or you already collected).');
  const r = guildQuestReward(p.rec.level);
  const res = await grantKillRewards(deps.pool, p.id, { xp: r.xp, gold: r.gold, items: [], monster: `guild:${questId}` }, 'achievement');
  pushInventory(deps.world, p, res.inventory);
  applyDelta(deps.world, p, res.delta);
  return { view: await guildQuestsView(deps, p), message: `Guild reward: +${r.gold.toLocaleString()} Gold, +${r.xp.toLocaleString()} XP` };
}

// ---------------------------------------------------------------------------
// Guild level (cached; perks apply to every kill)
// ---------------------------------------------------------------------------

const levelCache = new Map<number, { level: number; at: number }>();

/** A guild's level from the cache (refreshed in the background every minute). */
export function guildLevelOf(deps: GameplayDeps, guildId: number): number {
  const c = levelCache.get(guildId);
  if (!c || Date.now() - c.at > 60_000) {
    levelCache.set(guildId, { level: c?.level ?? 1, at: Date.now() });
    void deps.pool
      .query<{ xp: string }>(`SELECT xp FROM guilds WHERE id = $1`, [guildId])
      .then(({ rows }) => levelCache.set(guildId, { level: guildLevel(Number(rows[0]?.xp ?? 0)), at: Date.now() }))
      .catch(() => levelCache.delete(guildId));
  }
  return c?.level ?? 1;
}

export function forgetGuildLevel(guildId: number): void {
  levelCache.delete(guildId);
}
