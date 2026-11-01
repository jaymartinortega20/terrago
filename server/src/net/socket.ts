/**
 * Per-connection wrapper: auth handshake, message dispatch, rate limiting
 * (docs/ARCHITECTURE.md). This is the only module that touches a raw `ws`
 * WebSocket; everything above it (sim/room.ts, once built) deals only in
 * typed ClientMessage/ServerMessage values.
 */
import type WebSocket from 'ws';
import type { RawData } from 'ws';
import { nanoid } from 'nanoid';
import type { ClientMessage, ServerMessage } from '@terago/shared';
import type { CharacterRow, Repository } from '../db/repository.js';
import { loginAccount, registerAccount, revokeSession } from '../auth/auth.js';
import { ConnectionRateLimiter, encodeServerMessage, parseClientMessage } from './protocol.js';

export interface AuthenticatedSession {
  accountId: string;
  character: CharacterRow;
  sessionToken: string;
}

export interface ConnectionHandlers {
  /** Fired exactly once per connection, right after auth:login/auth:register
   * succeeds. This is the sim layer's cue to put the character into a room. */
  onAuthenticated(conn: Connection, session: AuthenticatedSession): void;
  /** Fired for every message that arrives after authentication and passes
   * schema validation + rate limiting. */
  onMessage(conn: Connection, session: AuthenticatedSession, message: ClientMessage): void;
  /** Fired when the underlying socket closes, whether or not it ever
   * authenticated. */
  onClose(conn: Connection, session: AuthenticatedSession | null): void;
}

/** True for the only two message types a not-yet-authenticated connection is
 * allowed to send. Anything else arriving before auth is silently dropped
 * rather than acted on, since the server must never trust an
 * unauthenticated client. A plain `===` narrows better than a Set.has()
 * lookup would, which is why this is a function and not a Set. */
function isPreAuthMessage(
  message: ClientMessage
): message is ClientMessage & { t: 'auth:login' | 'auth:register' } {
  return message.t === 'auth:login' || message.t === 'auth:register';
}

export class Connection {
  readonly id = nanoid();
  session: AuthenticatedSession | null = null;

  private readonly rateLimiter = new ConnectionRateLimiter();
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly repo: Repository,
    private readonly handlers: ConnectionHandlers
  ) {
    this.ws.on('message', (data: RawData) => {
      void this.handleRaw(data);
    });
    this.ws.on('close', () => this.handleClose());
    this.ws.on('error', () => {
      // 'close' always follows 'error' for ws connections; nothing extra to
      // do here beyond not crashing the process on an unhandled event.
    });
  }

  send(message: ServerMessage): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(encodeServerMessage(message));
  }

  /** Server-initiated disconnect (e.g. kicked, server shutting down). */
  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.ws.close(code, reason);
  }

  private async handleRaw(data: RawData): Promise<void> {
    if (this.closed) return;
    // RawData is Buffer | ArrayBuffer | Buffer[] (the last only when a
    // client disables permessage-deflate fragmentation reassembly); this
    // protocol is JSON-over-text, so every case just needs to end up as a
    // UTF-8 string before parseClientMessage sees it.
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    const raw = buf.toString('utf8');

    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      if (!this.session) {
        this.send({ t: 'auth:result', ok: false, error: parsed.error });
      }
      return;
    }
    const message = parsed.message;

    if (!this.rateLimiter.check(message.t)) {
      return;
    }

    if (!this.session) {
      if (isPreAuthMessage(message)) {
        await this.handleAuth(message);
      }
      // Any other message type pre-auth is just dropped, no error reply:
      // telling an unauthenticated sender *why* its message was ignored is
      // free information to a client that hasn't proven it's a real player.
      return;
    }

    this.handlers.onMessage(this, this.session, message);
  }

  private async handleAuth(message: ClientMessage & { t: 'auth:login' | 'auth:register' }): Promise<void> {
    const result =
      message.t === 'auth:register'
        ? await registerAccount(this.repo, message.username, message.password)
        : await loginAccount(this.repo, message.username, message.password);

    if (this.closed) return; // connection dropped while the (async) hash/verify was in flight

    if (!result.ok) {
      this.send({ t: 'auth:result', ok: false, error: result.reason });
      return;
    }

    this.session = {
      accountId: result.account.id,
      character: result.character,
      sessionToken: result.sessionToken,
    };
    this.send({ t: 'auth:result', ok: true, sessionToken: result.sessionToken });
    this.handlers.onAuthenticated(this, this.session);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.session) {
      revokeSession(this.session.sessionToken);
    }
    this.handlers.onClose(this, this.session);
  }
}
