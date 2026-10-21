import { createCharacterSchema, firstIssue, loginSchema, registerSchema } from '@terrago/shared';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from '../auth/passwords';
import {
  SESSION_COOKIE,
  accountBlockReason,
  clearSessionCookie,
  createSession,
  getSession,
  revokeSession,
  sessionCookie,
  type SessionUser,
} from '../auth/sessions';
import type { TicketStore } from '../auth/tickets';
import type { Config } from '../config';
import { GameError, isUniqueViolation, type Pool } from '../db';
import type { Logger } from '../logger';
import type { Metrics } from '../metrics';
import type { SecurityEvents } from '../security/events';
import { WindowLimiter } from '../security/rateLimit';
import { createCharacter, listCharacters } from '../services/characters';
import { grantKillRewards } from '../services/equipment';
import { getItem } from '@terrago/game-data';
import type { World } from '../world/world';
import { HttpError, Router, type Ctx } from './router';

interface Deps {
  config: Config;
  pool: Pool;
  log: Logger;
  security: SecurityEvents;
  world: World;
  metrics: Metrics;
  tickets: TicketStore;
}

export function buildRouter(deps: Deps): Router {
  const { config, pool, log, security, world, metrics, tickets } = deps;
  const router = new Router({ allowedOrigins: config.webOrigins, trustProxy: config.trustProxy, log });

  const limits = {
    registerIp: new WindowLimiter(5, 60 * 60 * 1000),
    loginIp: new WindowLimiter(20, 5 * 60 * 1000),
    loginEmail: new WindowLimiter(8, 15 * 60 * 1000),
    createCharacter: new WindowLimiter(10, 60 * 60 * 1000),
  };
  const limit = (limiter: WindowLimiter, key: string) => {
    if (!config.rateLimitsEnabled) return;
    const wait = limiter.hit(key);
    if (wait > 0) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, { 'Retry-After': String(wait) });
  };

  const cookieOpts = { secure: config.cookieSecure, domain: config.cookieDomain };

  async function requireUser(ctx: Ctx): Promise<SessionUser> {
    const user = await getSession(pool, ctx.cookies[SESSION_COOKIE], config.sessionTtlMs);
    if (!user) throw new HttpError(401, 'Please log in.');
    const blocked = accountBlockReason(user);
    if (blocked) throw new HttpError(403, blocked);
    return user;
  }

  async function startSession(ctx: Ctx, userId: string) {
    const { token } = await createSession(pool, userId, config.sessionTtlMs, {
      ip: ctx.ip,
      userAgent: (ctx.req.headers['user-agent'] as string | undefined) ?? null,
    });
    ctx.setCookie(sessionCookie(token, { maxAgeMs: config.sessionTtlMs, ...cookieOpts }));
  }

  router.get('/healthz', async () => {
    await pool.query('SELECT 1');
    return { status: 'healthy', players: world.players.size };
  });

  router.get('/metrics', (ctx) => {
    const token = ctx.req.headers['x-metrics-token'];
    const local = ctx.ip === '127.0.0.1' || ctx.ip === '::1';
    if (config.metricsToken ? token !== config.metricsToken : !local) throw new HttpError(403, 'Forbidden.');
    return { metrics: metrics.snapshot() };
  });

  router.post('/api/auth/register', async (ctx) => {
    limit(limits.registerIp, ctx.ip ?? 'unknown');
    const parsed = registerSchema.safeParse(ctx.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error));
    const { email, password } = parsed.data;
    const hash = await hashPassword(password);
    let userId: string;
    try {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, last_login_at) VALUES ($1, $2, now()) RETURNING id`,
        [email, hash],
      );
      userId = rows[0]!.id;
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_key')) throw new HttpError(409, 'An account with this email already exists.');
      throw err;
    }
    await startSession(ctx, userId);
    log.info('account_registered', { userId });
    return { user: { id: userId, email } };
  });

  router.post('/api/auth/login', async (ctx) => {
    const parsed = loginSchema.safeParse(ctx.body);
    if (!parsed.success) throw new HttpError(400, 'Enter your email and password.');
    const { email, password } = parsed.data;
    limit(limits.loginIp, ctx.ip ?? 'unknown');
    limit(limits.loginEmail, email);

    const { rows } = await pool.query(
      'SELECT id, email, password_hash, status, banned_until FROM users WHERE lower(email) = $1',
      [email],
    );
    const user = rows[0];
    // Always run a hash comparison so response time doesn't reveal which emails exist.
    const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
    if (!user || !ok) {
      security.record('login_failed', { userId: user?.id ?? null, ip: ctx.ip, details: { reason: user ? 'bad_password' : 'unknown_email' } });
      throw new HttpError(401, 'Incorrect email or password.');
    }
    const blocked = accountBlockReason({ status: user.status, bannedUntil: user.banned_until });
    if (blocked) {
      security.record('login_blocked', { userId: user.id, ip: ctx.ip });
      throw new HttpError(403, blocked);
    }
    if (needsRehash(user.password_hash)) {
      await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(password)]);
    }
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    limits.loginEmail.reset(email);
    await startSession(ctx, user.id);
    return { user: { id: user.id, email: user.email } };
  });

  router.post('/api/auth/logout', async (ctx) => {
    await revokeSession(pool, ctx.cookies[SESSION_COOKIE]);
    ctx.setCookie(clearSessionCookie(cookieOpts));
    return {};
  });

  const isAdmin = (u: SessionUser) => u.roles.includes('admin') || config.adminEmails.includes(u.email.toLowerCase());

  router.get('/api/auth/me', async (ctx) => {
    const user = await requireUser(ctx);
    return { user: { id: user.userId, email: user.email, roles: isAdmin(user) ? [...new Set([...user.roles, 'admin'])] : user.roles } };
  });

  router.get('/api/characters', async (ctx) => {
    const user = await requireUser(ctx);
    return { characters: await listCharacters(pool, user.userId) };
  });

  router.post('/api/characters', async (ctx) => {
    const user = await requireUser(ctx);
    limit(limits.createCharacter, user.userId);
    const parsed = createCharacterSchema.safeParse(ctx.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error));
    try {
      const character = await createCharacter(pool, user.userId, parsed.data);
      log.info('character_created', { userId: user.userId, characterId: character.id, name: character.name });
      return { character };
    } catch (err) {
      if (err instanceof GameError) throw new HttpError(err.status, err.message);
      throw err;
    }
  });

  /** One-time pass for the game connection (works even when web and game server are on different sites). */
  router.post('/api/game/ticket', async (ctx) => {
    const user = await requireUser(ctx);
    const characterId = (ctx.body as { characterId?: unknown })?.characterId;
    if (typeof characterId !== 'string' || !/^[0-9a-f-]{36}$/i.test(characterId)) throw new HttpError(400, 'Choose a character.');
    return tickets.issue({ userId: user.userId, sessionId: user.sessionId, characterId });
  });

  // ---------------------------------------------------------------------------
  // Admin panel API (accounts with the admin role or listed in ADMIN_EMAILS)
  // ---------------------------------------------------------------------------

  async function requireAdmin(ctx: Ctx): Promise<SessionUser> {
    const user = await requireUser(ctx);
    if (!isAdmin(user)) throw new HttpError(403, 'Admins only.');
    return user;
  }
  const audit = (admin: SessionUser, action: string, target: string | null, details: object = {}) =>
    pool.query(`INSERT INTO admin_actions (admin_id, action, target, details) VALUES ($1, $2, $3, $4)`, [admin.userId, action, target, JSON.stringify(details)]);
  const body = (ctx: Ctx) => (ctx.body ?? {}) as Record<string, unknown>;
  const uuid = (v: unknown, what: string) => {
    if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw new HttpError(400, `Missing ${what}.`);
    return v;
  };

  router.get('/api/admin/overview', async (ctx) => {
    await requireAdmin(ctx);
    const { rows } = await pool.query(`SELECT
        (SELECT count(*) FROM users)::int AS accounts,
        (SELECT count(*) FROM characters WHERE deleted_at IS NULL)::int AS characters,
        (SELECT count(*) FROM player_reports WHERE status = 'open')::int AS open_reports,
        (SELECT count(*) FROM users WHERE status <> 'active')::int AS banned,
        (SELECT count(*) FROM security_events WHERE created_at > now() - interval '24 hours')::int AS security_24h,
        (SELECT count(*) FROM marketplace_listings WHERE status = 'active')::int AS listings,
        (SELECT coalesce(sum(gold), 0)::bigint FROM characters WHERE deleted_at IS NULL) AS gold_total`);
    const online = [...world.players.values()].map((p) => ({ id: p.id, name: p.name, level: p.rec.level, mapId: p.mapId, connected: !!p.conn }));
    return { stats: { ...rows[0], gold_total: Number(rows[0].gold_total), online: online.length }, online };
  });

  router.get('/api/admin/reports', async (ctx) => {
    await requireAdmin(ctx);
    const status = ctx.url.searchParams.get('status') === 'all' ? null : 'open';
    const { rows } = await pool.query(
      `SELECT r.id, r.reason, r.context, r.status, r.created_at, r.target_id, t.name AS target_name, t.user_id AS target_user, rc.name AS reporter_name,
              t.chat_muted_until, u.status AS user_status
         FROM player_reports r JOIN characters t ON t.id = r.target_id JOIN characters rc ON rc.id = r.reporter_id JOIN users u ON u.id = t.user_id
        WHERE $1::text IS NULL OR r.status = $1 ORDER BY r.created_at DESC LIMIT 100`,
      [status],
    );
    return { reports: rows };
  });

  router.post('/api/admin/report', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const status = b.status === 'reviewed' || b.status === 'dismissed' ? b.status : null;
    if (!status || !Number.isInteger(b.id)) throw new HttpError(400, 'Bad request.');
    await pool.query(`UPDATE player_reports SET status = $2 WHERE id = $1`, [b.id, status]);
    await audit(admin, 'report_' + status, String(b.id));
    return {};
  });

  router.get('/api/admin/players', async (ctx) => {
    await requireAdmin(ctx);
    const q = (ctx.url.searchParams.get('q') ?? '').trim().slice(0, 40);
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.level, c.class_id, c.gold, c.map_id, c.created_at, c.last_played_at, c.chat_muted_until,
              u.id AS user_id, u.email, u.status, u.banned_until, u.ban_reason
         FROM characters c JOIN users u ON u.id = c.user_id
        WHERE c.deleted_at IS NULL AND ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
        ORDER BY c.last_played_at DESC NULLS LAST LIMIT 50`,
      [q],
    );
    return { players: rows.map((r) => ({ ...r, gold: Number(r.gold), online: !!world.players.get(r.id)?.conn })) };
  });

  router.post('/api/admin/ban', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const userId = uuid(b.userId, 'account');
    if (userId === admin.userId) throw new HttpError(400, "You can't ban yourself.");
    const days = b.days === null || b.days === undefined ? null : Number(b.days);
    if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 3650)) throw new HttpError(400, 'Days must be 1–3650 (or empty for permanent).');
    const reason = String(b.reason ?? '').slice(0, 200) || 'Rule violation';
    // Timed bans are suspensions that lift themselves; permanent ones are bans.
    await pool.query(`UPDATE users SET status = $4, banned_until = $2, ban_reason = $3 WHERE id = $1`, [userId, days ? new Date(Date.now() + days * 86_400_000) : null, reason, days ? 'suspended' : 'banned']);
    await pool.query(`UPDATE player_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    for (const p of [...world.players.values()]) if (p.userId === userId) await world.leave(p, `Your account was banned: ${reason}`);
    await audit(admin, 'ban', userId, { days, reason });
    return {};
  });

  router.post('/api/admin/unban', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const userId = uuid(body(ctx).userId, 'account');
    await pool.query(`UPDATE users SET status = 'active', banned_until = NULL, ban_reason = NULL WHERE id = $1`, [userId]);
    await audit(admin, 'unban', userId);
    return {};
  });

  router.post('/api/admin/mute', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const id = uuid(b.characterId, 'character');
    const minutes = Number(b.minutes ?? 0);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60 * 24 * 30) throw new HttpError(400, 'Minutes must be 0–43200.');
    const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
    await pool.query(`UPDATE characters SET chat_muted_until = $2 WHERE id = $1`, [id, until]);
    const p = world.players.get(id);
    if (p) {
      p.mutedUntil = until?.getTime() ?? 0;
      world.system(p, until ? `A moderator muted your chat for ${minutes} minute(s).` : 'Your chat mute was lifted.');
    }
    await audit(admin, minutes > 0 ? 'mute' : 'unmute', id, { minutes });
    return {};
  });

  router.post('/api/admin/kick', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const id = uuid(body(ctx).characterId, 'character');
    const p = world.players.get(id);
    if (!p) throw new HttpError(404, "They're not online.");
    await world.leave(p, 'You were disconnected by a moderator.');
    await audit(admin, 'kick', id);
    return {};
  });

  router.post('/api/admin/give', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const id = uuid(b.characterId, 'character');
    const gold = Math.floor(Number(b.gold ?? 0));
    const itemId = typeof b.itemId === 'string' && b.itemId ? b.itemId : null;
    const quantity = Math.floor(Number(b.quantity ?? 1));
    if (!Number.isSafeInteger(gold) || gold < 0 || gold > 10_000_000) throw new HttpError(400, 'Gold must be 0–10,000,000.');
    if (itemId && (!getItem(itemId) || quantity < 1 || quantity > 999)) throw new HttpError(400, 'Unknown item or bad quantity.');
    if (!gold && !itemId) throw new HttpError(400, 'Nothing to give.');
    const res = await grantKillRewards(pool, id, { xp: 0, gold, items: itemId ? [{ itemId, quantity }] : [], monster: `admin:${admin.userId}` }, 'admin');
    const p = world.players.get(id);
    if (p && res.inventory) {
      const prev = world.inventoryCache.get(id);
      const inv = { ...res.inventory, equipment: res.inventory.equipment ?? prev?.equipment ?? [] };
      world.inventoryCache.set(id, inv);
      p.rec.gold = inv.gold;
      p.conn?.send('inventory:update', inv);
      world.system(p, `A game master sent you ${[gold ? `${gold} Gold` : '', itemId ? `${quantity}× ${getItem(itemId)!.name}` : ''].filter(Boolean).join(' and ')}.`);
    }
    await audit(admin, 'give', id, { gold, itemId, quantity });
    return { overflow: res.overflow };
  });

  router.post('/api/admin/announce', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const text = String(body(ctx).text ?? '').trim().slice(0, 200);
    if (!text) throw new HttpError(400, 'Write a message.');
    world.announce(text);
    await audit(admin, 'announce', null, { text });
    return { delivered: world.players.size };
  });

  router.get('/api/admin/log', async (ctx) => {
    await requireAdmin(ctx);
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.target, a.details, a.created_at, u.email FROM admin_actions a JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 100`,
    );
    return { log: rows };
  });

  return router;
}
