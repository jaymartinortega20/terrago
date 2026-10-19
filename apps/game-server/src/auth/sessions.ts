import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from '../db';

export const SESSION_COOKIE = 'tg_session';

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  roles: string[];
  status: 'active' | 'suspended' | 'banned';
  bannedUntil: Date | null;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Create a session and return the raw token (only ever sent to the client in a cookie). */
export async function createSession(
  pool: Pool,
  userId: string,
  ttlMs: number,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query(
    `INSERT INTO player_sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), expiresAt, meta.ip, meta.userAgent?.slice(0, 300) ?? null],
  );
  return { token, expiresAt };
}

/**
 * Resolve a session token. Sliding expiry: the session is extended at most
 * once per hour of activity, so normal requests don't write to the database.
 */
export async function getSession(pool: Pool, token: string | undefined, ttlMs: number): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.user_id, s.last_seen_at, u.email, u.roles, u.status, u.banned_until
       FROM player_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60 * 60 * 1000) {
    await pool.query('UPDATE player_sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1', [
      row.id,
      new Date(Date.now() + ttlMs),
    ]);
  }
  return {
    sessionId: row.id,
    userId: row.user_id,
    email: row.email,
    roles: row.roles,
    status: row.status,
    bannedUntil: row.banned_until,
  };
}

export async function revokeSession(pool: Pool, token: string | undefined): Promise<void> {
  if (!token) return;
  await pool.query('UPDATE player_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
}

/** Is the account currently allowed to play? */
export function accountBlockReason(u: Pick<SessionUser, 'status' | 'bannedUntil'>): string | null {
  if (u.status === 'banned') return 'This account has been banned.';
  if (u.status === 'suspended' && (!u.bannedUntil || u.bannedUntil.getTime() > Date.now())) {
    return u.bannedUntil ? `This account is suspended until ${u.bannedUntil.toISOString()}.` : 'This account is suspended.';
  }
  return null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionCookie(token: string, opts: { maxAgeMs: number; secure: boolean; domain?: string }): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`,
  ];
  if (opts.secure) parts.push('Secure');
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}

export function clearSessionCookie(opts: { secure: boolean; domain?: string }): string {
  return sessionCookie('', { maxAgeMs: 0, ...opts });
}
