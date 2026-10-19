/**
 * In-memory rate limiting. Fine for a single authoritative server process;
 * when the game scales to several processes this moves to Redis.
 */

/** Token bucket for per-connection limits (chat, socket events). */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  take(n = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.refillPerMs);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Fixed-window counter keyed by string (IP, email...). */
export class WindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private sweepAt = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns seconds to wait if limited, or 0 if the action is allowed (and counted). */
  hit(key: string, now = Date.now()): number {
    if (now > this.sweepAt) this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    if (entry.count >= this.limit) return Math.ceil((entry.resetAt - now) / 1000);
    entry.count++;
    return 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    this.sweepAt = now + this.windowMs;
  }
}
