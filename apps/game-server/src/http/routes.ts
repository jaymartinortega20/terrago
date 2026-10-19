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
import type { Config } from '../config';
import { GameError, isUniqueViolation, type Pool } from '../db';
import type { Logger } from '../logger';
import type { Metrics } from '../metrics';
import type { SecurityEvents } from '../security/events';
import { WindowLimiter } from '../security/rateLimit';
import { createCharacter, listCharacters } from '../services/characters';
import type { World } from '../world/world';
import { HttpError, Router, type Ctx } from './router';

interface Deps {
  config: Config;
  pool: Pool;
  log: Logger;
  security: SecurityEvents;
  world: World;
  metrics: Metrics;
}

export function buildRouter(deps: Deps): Router {
  const { config, pool, log, security, world, metrics } = deps;
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

  router.get('/api/auth/me', async (ctx) => {
    const user = await requireUser(ctx);
    return { user: { id: user.userId, email: user.email, roles: user.roles } };
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

  return router;
}
