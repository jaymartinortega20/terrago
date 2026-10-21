import type { ClassId, FriendEntry, GuildRank, GuildView, PlayerProfile } from '@terrago/shared';
import { GameError, isUniqueViolation, withTransaction, type Pool, type Tx } from '../db';
import { lockCharacter } from './inventory';
import { changeGold } from './ledger';

/**
 * Persistent social data: friends, mutes/blocks, guilds, reports.
 * Parties are temporary and live only in memory (net/social.ts).
 */

export const GUILD_COST = 500;
export const GUILD_MAX = 50;
export const FRIENDS_MAX = 100;

export interface GuildMembership {
  id: number;
  name: string;
  tag: string;
  rank: GuildRank;
}

export interface SocialState {
  blocked: Map<string, 'mute' | 'block'>;
  guild: GuildMembership | null;
}

export async function loadSocial(pool: Pool, id: string): Promise<SocialState> {
  const [b, g] = await Promise.all([
    pool.query(`SELECT target_id, kind FROM character_blocks WHERE character_id = $1`, [id]),
    pool.query(
      `SELECT g.id, g.name, g.tag, m.rank FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.character_id = $1`,
      [id],
    ),
  ]);
  const r = g.rows[0];
  return {
    blocked: new Map(b.rows.map((x) => [x.target_id, x.kind])),
    guild: r ? { id: Number(r.id), name: r.name, tag: r.tag, rank: r.rank } : null,
  };
}

export async function findCharacter(pool: Pool | Tx, nameOrId: string): Promise<{ id: string; name: string } | null> {
  const isId = /^[0-9a-f-]{36}$/i.test(nameOrId);
  const { rows } = await pool.query(
    `SELECT id, name FROM characters WHERE deleted_at IS NULL AND ${isId ? 'id = $1' : 'lower(name) = lower($1)'}`,
    [nameOrId.trim()],
  );
  return rows[0] ?? null;
}

// --- Friends -----------------------------------------------------------------

export async function friendRows(pool: Pool, id: string): Promise<Omit<FriendEntry, 'online' | 'mapId'>[]> {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.level, c.class_id FROM friendships f JOIN characters c ON c.id = f.friend_id
      WHERE f.character_id = $1 AND c.deleted_at IS NULL ORDER BY lower(c.name)`,
    [id],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, level: r.level, classId: r.class_id as ClassId }));
}

export async function friendIds(pool: Pool, id: string): Promise<string[]> {
  const { rows } = await pool.query(`SELECT friend_id FROM friendships WHERE character_id = $1`, [id]);
  return rows.map((r) => r.friend_id);
}

export async function areFriends(pool: Pool, a: string, b: string): Promise<boolean> {
  const { rowCount } = await pool.query(`SELECT 1 FROM friendships WHERE character_id = $1 AND friend_id = $2`, [a, b]);
  return !!rowCount;
}

export async function addFriendship(pool: Pool, a: string, b: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    for (const id of [a, b]) {
      const { rows } = await tx.query(`SELECT count(*)::int AS n FROM friendships WHERE character_id = $1`, [id]);
      if (rows[0].n >= FRIENDS_MAX) throw new GameError(`Friend lists hold up to ${FRIENDS_MAX} people.`);
    }
    await tx.query(
      `INSERT INTO friendships (character_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
      [a, b],
    );
  });
}

export async function removeFriendship(pool: Pool, a: string, b: string): Promise<void> {
  await pool.query(
    `DELETE FROM friendships WHERE (character_id = $1 AND friend_id = $2) OR (character_id = $2 AND friend_id = $1)`,
    [a, b],
  );
}

export async function blockedRows(pool: Pool, id: string): Promise<{ id: string; name: string; kind: 'mute' | 'block' }[]> {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, b.kind FROM character_blocks b JOIN characters c ON c.id = b.target_id WHERE b.character_id = $1 ORDER BY lower(c.name)`,
    [id],
  );
  return rows;
}

export async function setBlock(pool: Pool, id: string, target: string, kind: 'mute' | 'block' | null): Promise<void> {
  if (id === target) throw new GameError("You can't block yourself.");
  if (!kind) {
    await pool.query(`DELETE FROM character_blocks WHERE character_id = $1 AND target_id = $2`, [id, target]);
    return;
  }
  await pool.query(
    `INSERT INTO character_blocks (character_id, target_id, kind) VALUES ($1, $2, $3)
     ON CONFLICT (character_id, target_id) DO UPDATE SET kind = EXCLUDED.kind`,
    [id, target, kind],
  );
  // Blocking also ends a friendship.
  if (kind === 'block') await removeFriendship(pool, id, target);
}

export async function fileReport(pool: Pool, reporter: string, target: string, reason: string, context: unknown[]): Promise<void> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM player_reports WHERE reporter_id = $1 AND created_at > now() - interval '1 hour'`,
    [reporter],
  );
  if (rows[0].n >= 10) throw new GameError("You've sent a lot of reports. Please wait a while.");
  await pool.query(`INSERT INTO player_reports (reporter_id, target_id, reason, context) VALUES ($1, $2, $3, $4)`, [
    reporter,
    target,
    reason.slice(0, 300),
    JSON.stringify(context.slice(-20)),
  ]);
}

export async function profileRow(pool: Pool, id: string): Promise<Omit<PlayerProfile, 'online' | 'mapId' | 'friend' | 'blocked'> | null> {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.level, c.class_id, c.created_at, g.name AS guild,
            coalesce((SELECT array_agg(item_id ORDER BY slot) FROM inventory_items WHERE character_id = c.id AND container = 'equip'), '{}') AS equipment
       FROM characters c
       LEFT JOIN guild_members m ON m.character_id = c.id
       LEFT JOIN guilds g ON g.id = m.guild_id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, level: r.level, classId: r.class_id, guild: r.guild, createdAt: new Date(r.created_at).getTime(), equipment: r.equipment };
}

// --- Guilds ------------------------------------------------------------------

const NAME_RE = /^[A-Za-z][A-Za-z0-9 ']{2,19}$/;
const TAG_RE = /^[A-Za-z0-9]{2,4}$/;

export async function createGuild(pool: Pool, leaderId: string, name: string, tag: string): Promise<GuildMembership & { gold: number }> {
  name = String(name ?? '').trim().replace(/\s+/g, ' ');
  tag = String(tag ?? '').trim().toUpperCase();
  if (!NAME_RE.test(name)) throw new GameError('Guild names are 3–20 letters, numbers or spaces, starting with a letter.');
  if (!TAG_RE.test(tag)) throw new GameError('Guild tags are 2–4 letters or numbers.');
  try {
    return await withTransaction(pool, async (tx) => {
      await lockCharacter(tx, leaderId);
      const { rowCount } = await tx.query(`SELECT 1 FROM guild_members WHERE character_id = $1`, [leaderId]);
      if (rowCount) throw new GameError("You're already in a guild.");
      const { after } = await changeGold(tx, leaderId, -GUILD_COST, 'guild', { type: 'guild_create', id: name });
      const g = await tx.query(`INSERT INTO guilds (name, tag, leader_id) VALUES ($1, $2, $3) RETURNING id`, [name, tag, leaderId]);
      const id = Number(g.rows[0].id);
      await tx.query(`INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, 'leader')`, [id, leaderId]);
      return { id, name, tag, rank: 'leader' as const, gold: after };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new GameError('That guild name or tag is taken.');
    throw err;
  }
}

export async function guildView(pool: Pool, guildId: number, me: string): Promise<Omit<GuildView, 'members'> & { members: Omit<GuildView['members'][number], 'online'>[] }> {
  const [g, m] = await Promise.all([
    pool.query(`SELECT id, name, tag, motd, treasury FROM guilds WHERE id = $1`, [guildId]),
    pool.query(
      `SELECT c.id, c.name, c.level, c.class_id, m.rank FROM guild_members m JOIN characters c ON c.id = m.character_id
        WHERE m.guild_id = $1 ORDER BY CASE m.rank WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, lower(c.name)`,
      [guildId],
    ),
  ]);
  const r = g.rows[0];
  if (!r) throw new GameError('That guild no longer exists.');
  const members = m.rows.map((x) => ({ id: x.id, name: x.name, level: x.level, classId: x.class_id as ClassId, rank: x.rank as GuildRank }));
  return { id: Number(r.id), name: r.name, tag: r.tag, motd: r.motd, treasury: Number(r.treasury), myRank: members.find((x) => x.id === me)?.rank ?? 'member', members };
}

async function rankOf(tx: Tx, guildId: number, id: string): Promise<GuildRank | null> {
  const { rows } = await tx.query(`SELECT rank FROM guild_members WHERE guild_id = $1 AND character_id = $2 FOR UPDATE`, [guildId, id]);
  return rows[0]?.rank ?? null;
}

export async function joinGuild(pool: Pool, guildId: number, id: string): Promise<GuildMembership> {
  return withTransaction(pool, async (tx) => {
    const g = await tx.query(`SELECT id, name, tag FROM guilds WHERE id = $1 FOR UPDATE`, [guildId]);
    if (!g.rows[0]) throw new GameError('That guild no longer exists.');
    const { rows } = await tx.query(`SELECT count(*)::int AS n FROM guild_members WHERE guild_id = $1`, [guildId]);
    if (rows[0].n >= GUILD_MAX) throw new GameError(`That guild is full (${GUILD_MAX} members).`);
    try {
      await tx.query(`INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, 'member')`, [guildId, id]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new GameError("You're already in a guild.");
      throw err;
    }
    return { id: guildId, name: g.rows[0].name, tag: g.rows[0].tag, rank: 'member' as const };
  });
}

/** Leave a guild. A leader hands over to the senior officer (or member); the last one out disbands it. */
export async function leaveGuild(pool: Pool, guildId: number, id: string): Promise<{ disbanded: boolean; newLeader: string | null }> {
  return withTransaction(pool, async (tx) => {
    await tx.query(`SELECT 1 FROM guilds WHERE id = $1 FOR UPDATE`, [guildId]);
    const rank = await rankOf(tx, guildId, id);
    if (!rank) throw new GameError("You're not in that guild.");
    await tx.query(`DELETE FROM guild_members WHERE guild_id = $1 AND character_id = $2`, [guildId, id]);
    const { rows } = await tx.query(
      `SELECT character_id FROM guild_members WHERE guild_id = $1
        ORDER BY CASE rank WHEN 'officer' THEN 0 ELSE 1 END, joined_at LIMIT 1`,
      [guildId],
    );
    if (!rows[0]) {
      await tx.query(`DELETE FROM guilds WHERE id = $1`, [guildId]);
      return { disbanded: true, newLeader: null };
    }
    if (rank !== 'leader') return { disbanded: false, newLeader: null };
    const heir = rows[0].character_id as string;
    await tx.query(`UPDATE guild_members SET rank = 'leader' WHERE guild_id = $1 AND character_id = $2`, [guildId, heir]);
    await tx.query(`UPDATE guilds SET leader_id = $2 WHERE id = $1`, [guildId, heir]);
    return { disbanded: false, newLeader: heir };
  });
}

const POWER: Record<GuildRank, number> = { leader: 3, officer: 2, member: 1 };

export async function kickMember(pool: Pool, guildId: number, by: string, target: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const [a, b] = [await rankOf(tx, guildId, by), await rankOf(tx, guildId, target)];
    if (!a || !b) throw new GameError("They're not in your guild.");
    if (a === 'member' || POWER[a] <= POWER[b]) throw new GameError("You can't remove that member.");
    await tx.query(`DELETE FROM guild_members WHERE guild_id = $1 AND character_id = $2`, [guildId, target]);
  });
}

/** Promote/demote. Making someone leader hands over leadership (you become an officer). */
export async function setRank(pool: Pool, guildId: number, by: string, target: string, rank: GuildRank): Promise<void> {
  if (!(rank in POWER)) throw new GameError('Unknown rank.');
  await withTransaction(pool, async (tx) => {
    const [a, b] = [await rankOf(tx, guildId, by), await rankOf(tx, guildId, target)];
    if (!a || !b || by === target) throw new GameError("They're not in your guild.");
    if (a !== 'leader') throw new GameError('Only the guild leader can change ranks.');
    if (rank === 'leader') {
      await tx.query(`UPDATE guild_members SET rank = 'officer' WHERE guild_id = $1 AND character_id = $2`, [guildId, by]);
      await tx.query(`UPDATE guilds SET leader_id = $2 WHERE id = $1`, [guildId, target]);
    }
    await tx.query(`UPDATE guild_members SET rank = $3 WHERE guild_id = $1 AND character_id = $2`, [guildId, target, rank]);
  });
}

/** Positive amount: deposit (any member). Negative: withdraw (leader only). */
export async function treasury(pool: Pool, guildId: number, id: string, amount: number): Promise<{ gold: number; treasury: number }> {
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1e9) throw new GameError('Invalid amount.');
  return withTransaction(pool, async (tx) => {
    const g = await tx.query(`SELECT treasury FROM guilds WHERE id = $1 FOR UPDATE`, [guildId]);
    if (!g.rows[0]) throw new GameError('That guild no longer exists.');
    const rank = await rankOf(tx, guildId, id);
    if (!rank) throw new GameError("You're not in that guild.");
    if (amount < 0 && rank !== 'leader') throw new GameError('Only the guild leader can withdraw.');
    const t = Number(g.rows[0].treasury) + amount;
    if (t < 0) throw new GameError('The treasury does not have that much.');
    const { after } = await changeGold(tx, id, -amount, 'guild', { type: 'guild_treasury', id: String(guildId) });
    await tx.query(`UPDATE guilds SET treasury = $2 WHERE id = $1`, [guildId, t]);
    await tx.query(`INSERT INTO guild_treasury_logs (guild_id, character_id, amount) VALUES ($1, $2, $3)`, [guildId, id, amount]);
    return { gold: after, treasury: t };
  });
}

export async function setMotd(pool: Pool, guildId: number, id: string, text: string): Promise<void> {
  const { rows } = await pool.query(`SELECT rank FROM guild_members WHERE guild_id = $1 AND character_id = $2`, [guildId, id]);
  if (!rows[0] || rows[0].rank === 'member') throw new GameError('Only officers can change the message of the day.');
  await pool.query(`UPDATE guilds SET motd = $2 WHERE id = $1`, [guildId, String(text ?? '').slice(0, 200)]);
}
