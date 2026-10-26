import type { Pool } from '../db';
import type { Logger } from '../logger';

export type SecurityEventKind =
  | 'login_failed'
  | 'login_blocked'
  | 'register_rate_limited'
  | 'login_rate_limited'
  | 'socket_auth_failed'
  | 'socket_flood'
  | 'movement_flood'
  | 'invalid_packet'
  | 'chat_rate_limited'
  | 'duplicate_login'
  | 'account_registered'
  | 'bot_timing'
  | 'bot_loop'
  | 'bot_marathon'
  | 'trade_ring'
  | 'multi_account'
  | 'bad_webhook_signature';

/**
 * Records security-relevant events in the database (for moderation and the
 * future admin panel) and in the structured log. Never blocks gameplay.
 */
export class SecurityEvents {
  /** Per (kind, subject) throttle so a flood doesn't flood the table too. */
  private readonly lastWrite = new Map<string, number>();

  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
  ) {}

  record(
    kind: SecurityEventKind,
    data: { userId?: string | null; characterId?: string | null; ip?: string | null; details?: Record<string, unknown> },
    throttleMs = 0,
  ): void {
    const key = `${kind}:${data.characterId ?? data.userId ?? data.ip ?? ''}`;
    const now = Date.now();
    if (throttleMs > 0 && now - (this.lastWrite.get(key) ?? 0) < throttleMs) return;
    this.lastWrite.set(key, now);
    if (this.lastWrite.size > 50_000) this.lastWrite.clear();

    this.log.warn('security_event', { kind, ...data });
    this.pool
      .query('INSERT INTO security_events (kind, user_id, character_id, ip, details) VALUES ($1, $2, $3, $4, $5)', [
        kind,
        data.userId ?? null,
        data.characterId ?? null,
        isIp(data.ip) ? data.ip : null,
        JSON.stringify(data.details ?? {}),
      ])
      .catch((err) => this.log.error('security_event_write_failed', { err }));
  }
}

function isIp(ip: string | null | undefined): ip is string {
  return !!ip && /^[0-9a-fA-F:.]+$/.test(ip) && ip.length <= 45;
}
