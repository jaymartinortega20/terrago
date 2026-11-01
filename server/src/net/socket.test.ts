import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database.js';
import { createSqliteRepository, type Repository } from '../db/repository.js';
import { registerAccount } from '../auth/auth.js';
import { Connection, type AuthenticatedSession, type ConnectionHandlers } from './socket.js';
import type { ServerMessage } from '@terago/shared';

/** Minimal stand-in for a `ws` WebSocket: just enough of the EventEmitter +
 * send/close/readyState surface that Connection actually touches. Using the
 * real `ws` package here would mean standing up an HTTP server per test. */
class FakeWebSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  get OPEN() {
    return FakeWebSocket.OPEN;
  }

  receive(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }
}

function freshRepo(): Repository {
  return createSqliteRepository(openDatabase(':memory:'));
}

function lastSent(ws: FakeWebSocket): ServerMessage {
  const raw = ws.sent[ws.sent.length - 1];
  if (!raw) throw new Error('nothing was sent');
  return JSON.parse(raw);
}

function makeHandlers(): ConnectionHandlers & {
  authenticated: AuthenticatedSession[];
  messages: unknown[];
  closes: number;
} {
  const authenticated: AuthenticatedSession[] = [];
  const messages: unknown[] = [];
  let closes = 0;
  return {
    authenticated,
    messages,
    get closes() {
      return closes;
    },
    onAuthenticated(_conn, session) {
      authenticated.push(session);
    },
    onMessage(_conn, _session, message) {
      messages.push(message);
    },
    onClose() {
      closes++;
    },
  };
}

describe('Connection auth handshake', () => {
  it('rejects any message before auth other than auth:login/auth:register', async () => {
    const ws = new FakeWebSocket();
    const repo = freshRepo();
    const handlers = makeHandlers();
    new Connection(ws as any, repo, handlers);

    ws.receive({ t: 'chat:send', channel: 'global', text: 'hi' });
    await vi.waitFor(() => {});
    expect(handlers.messages).toHaveLength(0);
    expect(handlers.authenticated).toHaveLength(0);
  });

  it('registers a new account, replies auth:result ok, and fires onAuthenticated', async () => {
    const ws = new FakeWebSocket();
    const repo = freshRepo();
    const handlers = makeHandlers();
    const conn = new Connection(ws as any, repo, handlers);

    ws.receive({ t: 'auth:register', username: 'newplayer', password: 'correct-horse' });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const reply = lastSent(ws);
    expect(reply).toMatchObject({ t: 'auth:result', ok: true });
    expect(handlers.authenticated).toHaveLength(1);
    expect(handlers.authenticated[0]?.character.name).toBe('newplayer');
    expect(conn.session?.character.name).toBe('newplayer');
  });

  it('rejects a duplicate username at registration', async () => {
    const repo = freshRepo();
    await registerAccount(repo, 'taken', 'correct-horse');

    const ws = new FakeWebSocket();
    const handlers = makeHandlers();
    new Connection(ws as any, repo, handlers);
    ws.receive({ t: 'auth:register', username: 'taken', password: 'correct-horse' });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    expect(lastSent(ws)).toEqual({ t: 'auth:result', ok: false, error: 'username_taken' });
    expect(handlers.authenticated).toHaveLength(0);
  });

  it('logs in an existing account and dispatches later messages via onMessage', async () => {
    const repo = freshRepo();
    await registerAccount(repo, 'player1', 'correct-horse');

    const ws = new FakeWebSocket();
    const handlers = makeHandlers();
    new Connection(ws as any, repo, handlers);

    ws.receive({ t: 'auth:login', username: 'player1', password: 'correct-horse' });
    await vi.waitFor(() => expect(handlers.authenticated).toHaveLength(1));

    ws.receive({ t: 'move:dir', dx: 1, dy: 0 });
    await vi.waitFor(() => expect(handlers.messages).toHaveLength(1));
    expect(handlers.messages[0]).toEqual({ t: 'move:dir', dx: 1, dy: 0 });
  });

  it('drops malformed JSON instead of crashing the connection', async () => {
    const ws = new FakeWebSocket();
    const repo = freshRepo();
    const handlers = makeHandlers();
    new Connection(ws as any, repo, handlers);

    ws.emit('message', Buffer.from('{not json'), false);
    await vi.waitFor(() => {});
    expect(handlers.messages).toHaveLength(0);
    expect(handlers.authenticated).toHaveLength(0);
  });
});

describe('Connection rate limiting', () => {
  it('silently drops messages once a type exceeds its budget', async () => {
    const repo = freshRepo();
    await registerAccount(repo, 'player1', 'correct-horse');
    const ws = new FakeWebSocket();
    const handlers = makeHandlers();
    new Connection(ws as any, repo, handlers);
    ws.receive({ t: 'auth:login', username: 'player1', password: 'correct-horse' });
    await vi.waitFor(() => expect(handlers.authenticated).toHaveLength(1));

    // move:dir allows 20/second; send 25 in a burst.
    for (let i = 0; i < 25; i++) {
      ws.receive({ t: 'move:dir', dx: 1, dy: 0 });
    }
    await vi.waitFor(() => expect(handlers.messages.length).toBeGreaterThan(0));
    expect(handlers.messages).toHaveLength(20);
  });
});

describe('Connection close', () => {
  it('fires onClose and revokes the session token', async () => {
    const repo = freshRepo();
    await registerAccount(repo, 'player1', 'correct-horse');
    const ws = new FakeWebSocket();
    const handlers = makeHandlers();
    new Connection(ws as any, repo, handlers);
    ws.receive({ t: 'auth:login', username: 'player1', password: 'correct-horse' });
    await vi.waitFor(() => expect(handlers.authenticated).toHaveLength(1));

    ws.close();
    expect(handlers.closes).toBe(1);
  });
});
