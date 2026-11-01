/**
 * Encode/decode + schema validation at the WS boundary (docs/ARCHITECTURE.md).
 * Nothing downstream of `parseClientMessage` ever sees a raw string or an
 * un-validated shape: every inbound message is checked against the zod
 * schemas in shared/src/schemas.ts before any game logic touches it.
 */
import { ClientMessageSchema, type ClientMessage, type ServerMessage } from '@terago/shared';

/** A single oversized frame (e.g. a malformed or hostile client) is rejected
 * before JSON.parse ever runs on it. SPEC.md's tech-stack table calls for
 * "per-message-type rate limits" but gives no byte figure, so this is a
 * decided default (docs/DECISIONS.md): generous enough for the biggest
 * legitimate M1 payload (chat:send, capped at 200 chars by its own schema)
 * with headroom, stingy enough to be a cheap DoS guard. */
export const MAX_MESSAGE_BYTES = 8 * 1024;

export type ParsedClientMessage = { ok: true; message: ClientMessage } | { ok: false; error: string };

export function parseClientMessage(raw: string): ParsedClientMessage {
  if (raw.length > MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'message_too_large' };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  const result = ClientMessageSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: 'invalid_message' };
  }
  return { ok: true, message: result.data };
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

// Per-message-type limits (SPEC.md tech-stack table asks for these but
// leaves the numbers open — see docs/DECISIONS.md for the reasoning).
// Movement/targeting/hotbar intents are generous since legitimate input can
// burst (e.g. mashing a hotbar key); auth and chat are tight since those are
// the classic abuse/spam vectors.
const RATE_LIMITS: Partial<Record<ClientMessage['t'], RateLimitRule>> = {
  'auth:login': { windowMs: 60_000, max: 5 },
  'auth:register': { windowMs: 60_000, max: 3 },
  'move:to': { windowMs: 1000, max: 10 },
  'move:dir': { windowMs: 1000, max: 20 },
  'target:set': { windowMs: 1000, max: 10 },
  'hotbar:use': { windowMs: 1000, max: 10 },
  'hotbar:assign': { windowMs: 1000, max: 5 },
  'equip:item': { windowMs: 1000, max: 5 },
  'unequip:slot': { windowMs: 1000, max: 5 },
  'stat:allocate': { windowMs: 1000, max: 5 },
  'chat:send': { windowMs: 2000, max: 3 },
  'mount:toggle': { windowMs: 1000, max: 2 },
  'auto:toggle': { windowMs: 1000, max: 2 },
  'auto:configure': { windowMs: 1000, max: 2 },
  'dev:command': { windowMs: 1000, max: 5 },
};

const DEFAULT_RATE_LIMIT: RateLimitRule = { windowMs: 1000, max: 10 };

/** Sliding-window-log limiter, one instance per connection. Pure and
 * synchronous (an injectable `now` makes it deterministic to test) so it
 * carries no dependency on the `ws` socket it ends up guarding. */
export class ConnectionRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Returns true if this message is allowed to proceed, false if the
   * connection has exceeded its budget for this message type and the
   * message should be silently dropped. */
  check(type: string, now: number = Date.now()): boolean {
    const rule = RATE_LIMITS[type as ClientMessage['t']] ?? DEFAULT_RATE_LIMIT;
    const cutoff = now - rule.windowMs;
    const recent = (this.hits.get(type) ?? []).filter((t) => t > cutoff);
    if (recent.length >= rule.max) {
      this.hits.set(type, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(type, recent);
    return true;
  }
}
