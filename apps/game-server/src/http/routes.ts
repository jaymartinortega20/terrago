import { OUTFITS, WORLD_EVENTS, createCharacterSchema, currentEvent, firstIssue, loginSchema, registerSchema, type ManualEvent } from '@terrago/shared';
import { changeGems, gemBalance, handlePaymongoEvent, markPaid, verifyPaymongoSignature } from '../services/gems';
import { saveSettings, settings, validateSettings } from '../services/serverConfig';
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
import { GameError, isUniqueViolation, withTransaction, type Pool } from '../db';
import type { Logger } from '../logger';
import type { Metrics } from '../metrics';
import type { SecurityEvents } from '../security/events';
import { WindowLimiter } from '../security/rateLimit';
import { createCharacter, listCharacters } from '../services/characters';
import { adminGive, adminHeal, adminSetGold, adminSetLevel, adminSetProfessions, adminTeleport, adminUnlockWaystones } from '../services/adminPowers';
import { applyAppearance, ownedSkins } from '../net/wardrobe';
import { getItem } from '@terrago/game-data';
import { antibot } from '../security/antibot';
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
    if (!settings().registrationOpen) throw new HttpError(403, 'New accounts are closed right now. Please try again later.');
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
    void antibot?.registered(userId, ctx.ip).catch(() => {});
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
  // ---------------------------------------------------------------------------
  // Gems (PayMongo)
  // ---------------------------------------------------------------------------

  /** Tell a player's online characters about new Gems. */
  const gemsArrived = (userId: string, gems: number, balance: number) => {
    for (const p of world.players.values()) {
      if (p.userId !== userId) continue;
      p.conn?.send('gems', { balance });
      p.conn?.send('notice', { kind: 'success', text: `💎 +${gems.toLocaleString()} Gems added. Thank you for supporting TerraGo!` });
    }
  };

  /** PayMongo calls this when a checkout is paid. Only signed events count. */
  router.post('/api/payments/paymongo', async (ctx) => {
    const p = config.payments;
    if (!p.webhookSecret || (p.mode !== 'live' && p.mode !== 'test')) throw new HttpError(404, 'Not found.');
    const sig = ctx.req.headers['paymongo-signature'];
    if (!verifyPaymongoSignature(Array.isArray(sig) ? sig[0] : sig, ctx.rawBody, p.webhookSecret, p.mode === 'live')) {
      security.record('bad_webhook_signature', { ip: ctx.ip });
      throw new HttpError(401, 'Bad signature.');
    }
    let credit: Awaited<ReturnType<typeof handlePaymongoEvent>> = null;
    try {
      credit = await handlePaymongoEvent(pool, ctx.body);
    } catch (err) {
      // A signed event that doesn't match its order (amount, session): never credit, flag it for a human.
      log.warn('gem_payment_mismatch', { err: String(err) });
      return {};
    }
    if (credit) {
      log.info('gems_purchased', { userId: credit.userId, gems: credit.gems });
      gemsArrived(credit.userId, credit.gems, credit.balance);
    }
    return {};
  });

  /** The return page asks how an order went. */
  router.get('/api/gems/order', async (ctx) => {
    const user = await requireUser(ctx);
    const id = ctx.url.searchParams.get('id') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown order.');
    const { rows } = await pool.query(`SELECT status, gems, pack_id FROM gem_orders WHERE id = $1 AND user_id = $2`, [id, user.userId]);
    if (!rows[0]) throw new HttpError(404, 'Unknown order.');
    return { status: rows[0].status, gems: rows[0].gems, balance: await gemBalance(pool, user.userId) };
  });

  /** Development only: complete a pretend checkout. */
  router.post('/api/gems/fake-pay', async (ctx) => {
    if (config.payments.mode !== 'fake') throw new HttpError(404, 'Not found.');
    const user = await requireUser(ctx);
    const id = String((ctx.body as { orderId?: unknown })?.orderId ?? '');
    const own = await pool.query(`SELECT 1 FROM gem_orders WHERE id = $1 AND user_id = $2 AND provider = 'fake'`, [id, user.userId]);
    if (!own.rowCount) throw new HttpError(404, 'Unknown order.');
    const credit = await markPaid(pool, id);
    if (credit) gemsArrived(credit.userId, credit.gems, credit.balance);
    return { credited: !!credit };
  });

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

  /** Run a game-master power, turning game errors into 400s. */
  const power = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GameError) throw new HttpError(400, err.message);
      throw err;
    }
  };

  /** Support: add or remove Gems on a player's account (e.g. a payment that never arrived). */
  router.post('/api/admin/gems', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const id = uuid(b.characterId, 'character');
    const amount = Math.trunc(Number(b.amount ?? 0));
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) throw new HttpError(400, 'Amount must be a whole number (±1,000,000).');
    const reason = b.refund ? 'refund' : 'admin';
    const u = await pool.query(`SELECT user_id FROM characters WHERE id = $1`, [id]);
    if (!u.rows[0]) throw new HttpError(404, 'No such character.');
    const balance = await withTransaction(pool, (tx) => changeGems(tx, u.rows[0].user_id, amount, reason, `admin:${admin.userId}`, id));
    for (const p of world.players.values()) if (p.userId === u.rows[0].user_id) p.conn?.send('gems', { balance });
    await audit(admin, 'gems', id, { amount, reason });
    return { balance };
  });

  router.post('/api/admin/give', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const id = uuid(b.characterId, 'character');
    const gold = Math.floor(Number(b.gold ?? 0));
    const list: { itemId: string; quantity: number }[] = Array.isArray(b.items)
      ? (b.items as { itemId?: unknown; quantity?: unknown }[]).map((i) => ({ itemId: String(i?.itemId ?? ''), quantity: Math.floor(Number(i?.quantity ?? 1)) }))
      : typeof b.itemId === 'string' && b.itemId
        ? [{ itemId: b.itemId, quantity: Math.floor(Number(b.quantity ?? 1)) }]
        : [];
    // Merge duplicates so one item can't be listed twice.
    const merged = new Map<string, number>();
    for (const i of list) merged.set(i.itemId, (merged.get(i.itemId) ?? 0) + i.quantity);
    const items = [...merged].map(([itemId, quantity]) => ({ itemId, quantity }));
    const res = await power(() => adminGive(pool, world, id, gold, items, admin.userId));
    await audit(admin, 'give', id, { gold, items });
    return { ...res, overflow: res.leftover };
  });

  router.post('/api/admin/gold', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const id = uuid(b.characterId, 'character');
    const gold = await power(() => adminSetGold(pool, world, id, Math.floor(Number(b.gold)), admin.userId));
    await audit(admin, 'set_gold', id, { gold });
    return { gold };
  });

  router.post('/api/admin/level', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const id = uuid(b.characterId, 'character');
    if (b.level !== undefined && b.level !== null && b.level !== '') await power(() => adminSetLevel(pool, world, id, Number(b.level)));
    if (b.professions !== undefined && b.professions !== null && b.professions !== '') await power(() => adminSetProfessions(pool, world, id, Number(b.professions)));
    await audit(admin, 'set_level', id, { level: b.level ?? null, professions: b.professions ?? null });
    return {};
  });

  router.post('/api/admin/heal', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const id = uuid(body(ctx).characterId, 'character');
    await power(() => adminHeal(pool, world, id));
    await audit(admin, 'heal', id);
    return {};
  });

  router.post('/api/admin/waystones', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const id = uuid(body(ctx).characterId, 'character');
    const n = await power(() => adminUnlockWaystones(pool, id));
    await audit(admin, 'unlock_waystones', id);
    return { unlocked: n };
  });

  router.post('/api/admin/teleport', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const id = uuid(b.characterId, 'character');
    const mapId = String(b.mapId ?? '');
    const tx = b.x === undefined || b.x === '' ? undefined : Number(b.x);
    const ty = b.y === undefined || b.y === '' ? undefined : Number(b.y);
    await power(() => adminTeleport(pool, world, id, mapId, tx, ty));
    await audit(admin, 'teleport', id, { mapId, x: tx ?? null, y: ty ?? null });
    return {};
  });

  router.post('/api/admin/skin', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    const id = uuid(b.characterId, 'character');
    const outfit = Number(b.outfit);
    if (!Number.isInteger(outfit) || !OUTFITS[outfit]?.exclusive) throw new HttpError(400, 'Pick one of the exclusive skins.');
    if (b.revoke) {
      await pool.query(`DELETE FROM character_skins WHERE character_id = $1 AND outfit = $2`, [id, outfit]);
      const { rows } = await pool.query(`SELECT appearance->>'outfit' AS o FROM characters WHERE id = $1`, [id]);
      if (Number(rows[0]?.o) === outfit) await applyAppearance(pool, world, id, { outfit: 0 });
      await audit(admin, 'skin_revoke', id, { outfit });
      return { owned: await ownedSkins(pool, id) };
    }
    await pool.query(`INSERT INTO character_skins (character_id, outfit, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, outfit, admin.userId]);
    if (b.wear) await applyAppearance(pool, world, id, { outfit });
    const p = world.players.get(id);
    if (p) world.system(p, `👑 You received the ${OUTFITS[outfit]!.name} skin! Wear it from Character → Wardrobe.`);
    await audit(admin, 'skin_give', id, { outfit, wear: !!b.wear });
    return { owned: await ownedSkins(pool, id) };
  });

  /** The admin's own characters (for "send to me"). */
  router.get('/api/admin/mine', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const { rows } = await pool.query(`SELECT id, name, level FROM characters WHERE user_id = $1 AND deleted_at IS NULL ORDER BY last_played_at DESC NULLS LAST`, [admin.userId]);
    return { characters: rows };
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

  // --- Economy dashboard ------------------------------------------------------

  /** Gold that only changes hands between players (not created or destroyed). */
  const TRANSFERS = ['trade', 'marketplace_sale', 'marketplace_purchase'];
  const BOT_KINDS = ['bot_timing', 'bot_loop', 'bot_marathon', 'trade_ring', 'multi_account', 'movement_flood', 'socket_flood', 'duplicate_login'];
  const windowDays = (ctx: Ctx) => {
    const d = Number(ctx.url.searchParams.get('days') ?? 7);
    return Number.isFinite(d) ? Math.max(1, Math.min(90, Math.round(d))) : 7;
  };

  router.get('/api/admin/economy', async (ctx) => {
    await requireAdmin(ctx);
    const days = windowDays(ctx);
    const since = `now() - make_interval(days => $1::int)`;
    const [byReason, daily, supply, market, stall, trades, topItems, rare, bigMoves, giftTrades, overpriced, flags] = await Promise.all([
      pool.query(
        `SELECT reason, coalesce(sum(amount) FILTER (WHERE amount > 0), 0)::bigint AS gained, coalesce(-sum(amount) FILTER (WHERE amount < 0), 0)::bigint AS spent, count(*)::int AS n
           FROM currency_transactions WHERE created_at > ${since} GROUP BY reason`,
        [days],
      ),
      pool.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                coalesce(sum(amount) FILTER (WHERE amount > 0 AND reason <> ALL($2)), 0)::bigint AS created,
                coalesce(-sum(amount) FILTER (WHERE amount < 0 AND reason <> ALL($2)), 0)::bigint - coalesce(sum(amount) FILTER (WHERE reason = ANY($2)), 0)::bigint AS removed
           FROM currency_transactions WHERE created_at > ${since} GROUP BY 1 ORDER BY 1`,
        [days, TRANSFERS],
      ),
      pool.query(
        `SELECT (SELECT coalesce(sum(gold), 0) FROM characters WHERE deleted_at IS NULL)::bigint AS players,
                (SELECT coalesce(sum(treasury), 0) FROM guilds)::bigint AS guilds,
                (SELECT count(*) FROM characters WHERE deleted_at IS NULL AND gold > 0)::int AS holders`,
      ),
      pool.query(`SELECT count(*)::int AS trades, coalesce(sum(total), 0)::bigint AS volume, coalesce(sum(tax), 0)::bigint AS tax FROM marketplace_transactions WHERE created_at > ${since}`, [days]),
      pool.query(`SELECT count(*)::int AS trades, coalesce(-sum(amount), 0)::bigint AS volume FROM currency_transactions WHERE ref_type = 'stall' AND reason = 'marketplace_purchase' AND created_at > ${since}`, [days]),
      pool.query(`SELECT count(*)::int AS trades, coalesce(sum(a_gold + b_gold), 0)::bigint AS gold FROM direct_trade_logs WHERE created_at > ${since}`, [days]),
      pool.query(
        `SELECT t.item_id, i.name, i.rarity, count(*)::int AS trades, sum(t.quantity)::int AS quantity, sum(t.total)::bigint AS volume,
                round(sum(t.total)::numeric / sum(t.quantity), 1)::float AS avg_price,
                min(t.total::numeric / t.quantity)::float AS min_price, max(t.total::numeric / t.quantity)::float AS max_price
           FROM marketplace_transactions t JOIN items i ON i.id = t.item_id
          WHERE t.created_at > ${since} GROUP BY 1, 2, 3 ORDER BY volume DESC LIMIT 15`,
        [days],
      ),
      pool.query(
        `SELECT i.id AS item_id, i.name, i.rarity, t.reason, sum(t.quantity)::int AS quantity
           FROM item_transactions t JOIN items i ON i.id = t.item_id
          WHERE t.created_at > ${since} AND t.from_character_id IS NULL AND i.rarity IN ('rare', 'epic', 'legendary', 'mythic')
          GROUP BY 1, 2, 3, 4
          ORDER BY array_position(ARRAY['mythic', 'legendary', 'epic', 'rare'], i.rarity), quantity DESC LIMIT 30`,
        [days],
      ),
      pool.query(
        `SELECT t.id, t.character_id, c.name, t.amount, t.reason, t.ref_type, t.ref_id, t.created_at
           FROM currency_transactions t JOIN characters c ON c.id = t.character_id
          WHERE t.created_at > ${since} AND t.reason IN ('trade', 'admin', 'marketplace_sale') AND abs(t.amount) >= 50000
          ORDER BY abs(t.amount) DESC LIMIT 20`,
        [days],
      ),
      pool.query(
        `SELECT d.id, d.created_at, a.name AS a_name, b.name AS b_name, d.a_id, d.b_id, d.a_gold, d.b_gold, d.a_items, d.b_items
           FROM direct_trade_logs d JOIN characters a ON a.id = d.a_id JOIN characters b ON b.id = d.b_id
          WHERE d.created_at > ${since}
            AND ((d.a_gold >= 10000 AND d.b_gold = 0 AND jsonb_array_length(d.b_items) = 0) OR (d.b_gold >= 10000 AND d.a_gold = 0 AND jsonb_array_length(d.a_items) = 0))
          ORDER BY greatest(d.a_gold, d.b_gold) DESC LIMIT 20`,
        [days],
      ),
      pool.query(
        `WITH u AS (SELECT id, item_id, seller_id, buyer_id, total, quantity, created_at, total::numeric / quantity AS unit
                      FROM marketplace_transactions WHERE created_at > now() - interval '30 days'),
              med AS (SELECT item_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY unit) AS m, count(*) AS n FROM u GROUP BY item_id)
         SELECT u.id, u.item_id, i.name, u.total, u.quantity, u.unit::float AS unit, med.m::float AS median, u.created_at, s.name AS seller, b.name AS buyer
           FROM u JOIN med USING (item_id) JOIN items i ON i.id = u.item_id JOIN characters s ON s.id = u.seller_id JOIN characters b ON b.id = u.buyer_id
          WHERE med.n >= 3 AND u.unit > 5 * med.m AND u.total >= 5000 AND u.created_at > ${since}
          ORDER BY u.total DESC LIMIT 20`,
        [days],
      ),
      pool.query(`SELECT count(*)::int AS n FROM security_events WHERE kind = ANY($1) AND reviewed_at IS NULL`, [BOT_KINDS]),
    ]);
    const sources = byReason.rows.filter((r) => !TRANSFERS.includes(r.reason) && Number(r.gained) > 0).map((r) => ({ reason: r.reason, amount: Number(r.gained) }));
    const sinks = byReason.rows.filter((r) => !TRANSFERS.includes(r.reason) && Number(r.spent) > 0).map((r) => ({ reason: r.reason, amount: Number(r.spent) }));
    // Gold that vanished inside transfers (sales tax: buyer pays more than the seller gets).
    const transferNet = byReason.rows.filter((r) => TRANSFERS.includes(r.reason)).reduce((a, r) => a + Number(r.gained) - Number(r.spent), 0);
    if (transferNet < 0) sinks.push({ reason: 'sales_tax', amount: -transferNet });
    sources.sort((a, b) => b.amount - a.amount);
    sinks.sort((a, b) => b.amount - a.amount);
    const created = sources.reduce((a, r) => a + r.amount, 0);
    const removed = sinks.reduce((a, r) => a + r.amount, 0);
    const num = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v]));
    return {
      days,
      totals: { created, removed, net: created - removed, supply: Number(supply.rows[0].players) + Number(supply.rows[0].guilds), playerGold: Number(supply.rows[0].players), guildGold: Number(supply.rows[0].guilds), holders: supply.rows[0].holders },
      sources,
      sinks,
      daily: daily.rows.map(num),
      market: { ...num(market.rows[0]), stallTrades: stall.rows[0].trades, stallVolume: Number(stall.rows[0].volume), directTrades: trades.rows[0].trades, directTradeGold: Number(trades.rows[0].gold) },
      topItems: topItems.rows.map(num),
      rare: rare.rows,
      suspicious: { bigMoves: bigMoves.rows.map(num), giftTrades: giftTrades.rows.map(num), overpriced: overpriced.rows.map(num), openFlags: flags.rows[0].n },
    };
  });

  // --- Anti-bot and security flags -----------------------------------------------

  router.get('/api/admin/flags', async (ctx) => {
    await requireAdmin(ctx);
    const all = ctx.url.searchParams.get('status') === 'all';
    const { rows } = await pool.query(
      `SELECT e.id, e.kind, e.details, e.created_at, host(e.ip) AS ip, e.reviewed_at, e.review_note, e.character_id,
              c.name AS character_name, coalesce(e.user_id, c.user_id) AS user_id, u.email, u.status AS user_status, r.email AS reviewed_by
         FROM security_events e
         LEFT JOIN characters c ON c.id = e.character_id
         LEFT JOIN users u ON u.id = coalesce(e.user_id, c.user_id)
         LEFT JOIN users r ON r.id = e.reviewed_by
        WHERE e.kind = ANY($1) AND ($2 OR e.reviewed_at IS NULL)
        ORDER BY e.created_at DESC LIMIT 200`,
      [BOT_KINDS, all],
    );
    return { flags: rows };
  });

  router.post('/api/admin/flag', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    if (!Number.isInteger(b.id)) throw new HttpError(400, 'Bad request.');
    const verdict = b.verdict === 'actioned' ? 'actioned' : 'cleared';
    const note = `${verdict}${b.note ? `: ${String(b.note).slice(0, 200)}` : ''}`;
    const { rowCount } = await pool.query(`UPDATE security_events SET reviewed_at = now(), reviewed_by = $2, review_note = $3 WHERE id = $1 AND reviewed_at IS NULL`, [b.id, admin.userId, note]);
    if (!rowCount) throw new HttpError(404, 'Already reviewed or not found.');
    await audit(admin, 'flag_' + verdict, String(b.id), { note: b.note ?? null });
    return {};
  });

  // --- One player in detail ------------------------------------------------------

  router.get('/api/admin/player', async (ctx) => {
    await requireAdmin(ctx);
    const id = uuid(ctx.url.searchParams.get('id'), 'character');
    const ch = await pool.query(
      `SELECT c.id, c.name, c.level, c.class_id, c.gold, c.map_id, c.created_at, c.last_played_at, c.chat_muted_until, c.xp,
              u.id AS user_id, u.email, u.status, u.banned_until, u.ban_reason, u.created_at AS account_created
         FROM characters c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
      [id],
    );
    if (!ch.rows[0]) throw new HttpError(404, 'No such character.');
    const userId = ch.rows[0].user_id;
    const [items, gold, itemLog, trades, market, flags, reports, alts] = await Promise.all([
      pool.query(`SELECT ii.container, ii.slot, ii.item_id, ii.quantity, ii.quality, ii.durability, i.name, i.rarity FROM inventory_items ii JOIN items i ON i.id = ii.item_id WHERE ii.character_id = $1 ORDER BY ii.container, ii.slot`, [id]),
      pool.query(`SELECT id, amount, balance_after, reason, ref_type, ref_id, created_at FROM currency_transactions WHERE character_id = $1 ORDER BY id DESC LIMIT 100`, [id]),
      pool.query(
        `SELECT t.id, t.item_id, i.name, t.quantity, t.reason, t.created_at, t.from_character_id = $1 AS outgoing, coalesce(f.name, '') AS from_name, coalesce(o.name, '') AS to_name
           FROM item_transactions t JOIN items i ON i.id = t.item_id
           LEFT JOIN characters f ON f.id = t.from_character_id LEFT JOIN characters o ON o.id = t.to_character_id
          WHERE t.from_character_id = $1 OR t.to_character_id = $1 ORDER BY t.id DESC LIMIT 100`,
        [id],
      ),
      pool.query(
        `SELECT d.id, d.created_at, a.name AS a_name, b.name AS b_name, d.a_gold, d.b_gold, d.a_items, d.b_items
           FROM direct_trade_logs d JOIN characters a ON a.id = d.a_id JOIN characters b ON b.id = d.b_id
          WHERE d.a_id = $1 OR d.b_id = $1 ORDER BY d.id DESC LIMIT 50`,
        [id],
      ),
      pool.query(
        `SELECT t.id, t.created_at, i.name, t.quantity, t.total, t.tax, s.name AS seller, b.name AS buyer
           FROM marketplace_transactions t JOIN items i ON i.id = t.item_id JOIN characters s ON s.id = t.seller_id JOIN characters b ON b.id = t.buyer_id
          WHERE t.seller_id = $1 OR t.buyer_id = $1 ORDER BY t.id DESC LIMIT 50`,
        [id],
      ),
      pool.query(`SELECT id, kind, details, created_at, review_note FROM security_events WHERE character_id = $1 OR user_id = $2 ORDER BY id DESC LIMIT 50`, [id, userId]),
      pool.query(`SELECT r.id, r.reason, r.status, r.created_at, rc.name AS reporter FROM player_reports r JOIN characters rc ON rc.id = r.reporter_id WHERE r.target_id = $1 ORDER BY r.id DESC LIMIT 30`, [id]),
      pool.query(`SELECT id, name, level FROM characters WHERE user_id = $1 AND id <> $2 AND deleted_at IS NULL`, [userId, id]),
    ]);
    const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+$/.test(v) && k !== 'ref_id' ? Number(v) : v]));
    return {
      character: { ...num(ch.rows[0]), online: !!world.players.get(id)?.conn },
      items: items.rows,
      gold: gold.rows.map(num),
      itemLog: itemLog.rows,
      skins: await ownedSkins(pool, id),
      trades: trades.rows.map(num),
      market: market.rows.map(num),
      flags: flags.rows,
      reports: reports.rows,
      alts: alts.rows,
    };
  });

  // --- Live server settings and events ----------------------------------------------

  router.get('/api/admin/settings', async (ctx) => {
    await requireAdmin(ctx);
    return { settings: settings(), events: WORLD_EVENTS.map((e) => ({ id: e.id, name: e.name, description: e.description })), current: currentEvent(Date.now()) };
  });

  router.post('/api/admin/settings', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    let patch;
    try {
      const { manualEvent: _ignored, ...rest } = b;
      patch = validateSettings(rest);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    delete patch.manualEvent;
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to change.');
    const next = await saveSettings(pool, patch);
    await audit(admin, 'settings', null, patch);
    return { settings: next };
  });

  router.post('/api/admin/event', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = body(ctx);
    let ev: ManualEvent | null = null;
    if (b.id) {
      const minutes = Math.round(Number(b.minutes ?? 40));
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 24 * 60) throw new HttpError(400, 'Length must be 5–1440 minutes.');
      const now = Date.now();
      ev = { id: String(b.id), start: now, end: now + minutes * 60_000 };
    }
    try {
      validateSettings({ manualEvent: ev });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    await saveSettings(pool, { manualEvent: ev });
    for (const p of world.players.values()) p.conn?.send('event:manual', ev);
    await audit(admin, ev ? 'event_start' : 'event_stop', ev?.id ?? null, ev ? { minutes: (ev.end - ev.start) / 60_000 } : {});
    return { current: currentEvent(Date.now()) };
  });

  return router;
}
