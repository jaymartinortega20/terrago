import { randomBytes } from 'node:crypto';

/**
 * One-time game tickets. The website (which holds the HttpOnly session cookie
 * on its own domain) asks the API for a ticket and passes it in the Socket.IO
 * handshake. This lets the game server live on a different site than the web
 * app (e.g. *.vercel.app + *.onrender.com) without third-party cookies.
 * Tickets are random, single-use, bound to a session and character, and expire
 * after 60 seconds.
 */
export interface Ticket {
  userId: string;
  sessionId: string;
  characterId: string;
  expiresAt: number;
}

export const TICKET_TTL_MS = 60_000;

export class TicketStore {
  private readonly tickets = new Map<string, Ticket>();
  private sweepAt = 0;

  issue(t: Omit<Ticket, 'expiresAt'>, now = Date.now()): { ticket: string; expiresInMs: number } {
    this.sweep(now);
    if (this.tickets.size > 100_000) throw new Error('Too many outstanding tickets');
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { ...t, expiresAt: now + TICKET_TTL_MS });
    return { ticket, expiresInMs: TICKET_TTL_MS };
  }

  /** Returns the ticket's data and deletes it, or null if unknown/expired/used. */
  consume(ticket: unknown, now = Date.now()): Ticket | null {
    if (typeof ticket !== 'string' || ticket.length > 64) return null;
    const t = this.tickets.get(ticket);
    if (!t) return null;
    this.tickets.delete(ticket);
    return t.expiresAt > now ? t : null;
  }

  private sweep(now: number) {
    if (now < this.sweepAt) return;
    for (const [k, v] of this.tickets) if (v.expiresAt <= now) this.tickets.delete(k);
    this.sweepAt = now + 30_000;
  }
}
