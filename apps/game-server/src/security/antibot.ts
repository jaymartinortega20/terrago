import type { Pool } from '../db';
import type { Player } from '../world/player';
import type { World } from '../world/world';
import type { SecurityEvents } from './events';

/**
 * Bot and abuse signals. These only RECORD suspicious patterns as security
 * events for a human to review — nobody is punished or captcha'd automatically.
 *
 *  - bot_timing:   hundreds of actions with machine-perfect spacing
 *  - bot_loop:     lots of actions while standing on the same few tiles for 30+ min
 *  - bot_marathon: active with no real break for 10+ hours
 *  - trade_ring:   the same two characters trading over and over in a day
 *  - multi_account: many new accounts from one address in a day
 */

interface Track {
  acts: number[];
  tiles: { t: number; tile: string; acts: number }[];
  activeSince: number;
  lastActive: number;
}

const tracks = new WeakMap<Player, Track>();
const HOUR = 3_600_000;

function track(p: Player): Track {
  let t = tracks.get(p);
  if (!t) tracks.set(p, (t = { acts: [], tiles: [], activeSince: Date.now(), lastActive: Date.now() }));
  return t;
}

export class AntiBot {
  private timer: NodeJS.Timeout;

  constructor(
    private readonly world: World,
    private readonly pool: Pool,
    private readonly security: Pick<SecurityEvents, 'record'>,
  ) {
    this.timer = setInterval(() => this.sample(), 10_000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Call on every gameplay action (farm, gather, attack, skill...). */
  action(p: Player): void {
    const t = track(p);
    const now = Date.now();
    if (now - t.lastActive > 5 * 60_000) t.activeSince = now; // a real break resets the marathon clock
    t.lastActive = now;
    t.acts.push(now);
    if (t.acts.length > 300) t.acts.splice(0, t.acts.length - 300);
    if (t.acts.length >= 300 && t.acts.length % 50 === 0) this.checkTiming(p, t);
  }

  private checkTiming(p: Player, t: Track): void {
    const gaps: number[] = [];
    for (let i = 1; i < t.acts.length; i++) gaps.push(t.acts[i]! - t.acts[i - 1]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    if (mean < 5000 && sd < 15) {
      this.security.record('bot_timing', { userId: p.userId, characterId: p.id, ip: p.ip, details: { meanMs: Math.round(mean), sdMs: Math.round(sd), actions: t.acts.length } }, HOUR);
    }
  }

  private sample(): void {
    const now = Date.now();
    for (const p of this.world.players.values()) {
      if (!p.conn) continue;
      const t = track(p);
      t.tiles.push({ t: now, tile: `${p.mapId}:${Math.floor(p.x / 32)},${Math.floor(p.y / 32)}`, acts: t.acts.filter((a) => a > now - 10_000).length });
      t.tiles = t.tiles.filter((x) => x.t > now - 30 * 60_000);
      const acts = t.tiles.reduce((n, x) => n + x.acts, 0);
      const unique = new Set(t.tiles.map((x) => x.tile)).size;
      if (t.tiles.length >= 170 && acts >= 300 && unique <= 4) {
        this.security.record('bot_loop', { userId: p.userId, characterId: p.id, ip: p.ip, details: { actions30m: acts, tiles: unique } }, HOUR);
      }
      if (now - t.lastActive < 5 * 60_000 && now - t.activeSince > 10 * HOUR) {
        this.security.record('bot_marathon', { userId: p.userId, characterId: p.id, ip: p.ip, details: { hours: Math.round((now - t.activeSince) / HOUR) } }, 6 * HOUR);
      }
    }
  }

  /** After any trade or market sale between two characters. */
  async trade(a: string, b: string): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT (SELECT count(*) FROM marketplace_transactions WHERE created_at > now() - interval '24 hours'
                AND ((seller_id = $1 AND buyer_id = $2) OR (seller_id = $2 AND buyer_id = $1)))
            + (SELECT count(*) FROM direct_trade_logs WHERE created_at > now() - interval '24 hours'
                AND ((a_id = $1 AND b_id = $2) OR (a_id = $2 AND b_id = $1))) AS n`,
      [a, b],
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n > 12) this.security.record('trade_ring', { characterId: a, details: { with: b, trades24h: n } }, 6 * HOUR);
  }

  /** After a new account is created. */
  async registered(userId: string, ip: string | null): Promise<void> {
    if (!ip) return;
    this.security.record('account_registered', { userId, ip });
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM security_events WHERE kind = 'account_registered' AND ip = $1 AND created_at > now() - interval '24 hours'`,
      [ip],
    );
    if (rows[0].n > 5) this.security.record('multi_account', { userId, ip, details: { accounts24h: rows[0].n } }, 6 * HOUR);
  }
}

/** The running instance (set up by app.ts). */
export let antibot: AntiBot | null = null;
export function setAntiBot(a: AntiBot | null): void {
  antibot = a;
}
