import pg from 'pg';
import { io as ioClient, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, type ClientToServerEvents, type EnterWorldPayload, type ServerToClientEvents } from '@terrago/shared';
import { startGameServer, type GameServer } from '../../src/app';
import { loadConfig } from '../../src/config';
import { createLogger } from '../../src/logger';

export const ORIGIN = 'http://localhost:3000';
export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@127.0.0.1:5432/terrago_test';

export async function resetDatabase(): Promise<void> {
  const pool = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.end();
}

export async function startTestServer(extraEnv: Record<string, string> = {}): Promise<GameServer> {
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    HOST: '127.0.0.1',
    DATABASE_URL: TEST_DB,
    WEB_ORIGINS: ORIGIN,
    DISABLE_RATE_LIMITS: 'true',
    LOG_LEVEL: 'error',
    ...extraEnv,
  });
  return startGameServer(config, createLogger('error'));
}

/** A tiny HTTP client with a cookie jar, acting like a browser on the web origin. */
export class Browser {
  cookie = '';
  constructor(
    readonly base: string,
    readonly origin: string | null = ORIGIN,
  ) {}

  async req(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: any; setCookie: string | null }> {
    const headers: Record<string, string> = {};
    if (this.origin) headers.origin = this.origin;
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const [pair] = setCookie.split(';');
      const value = pair!.split('=').slice(1).join('=');
      this.cookie = value ? pair! : '';
    }
    return { status: res.status, data: await res.json().catch(() => null), setCookie };
  }

  post(path: string, body: unknown = {}) {
    return this.req('POST', path, body);
  }

  get(path: string) {
    return this.req('GET', path);
  }
}

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectSocket(base: string, cookie: string, characterId: string, origin = ORIGIN): TestSocket {
  return ioClient(base, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { cookie, origin },
    auth: { characterId, protocol: PROTOCOL_VERSION },
  });
}

export function once<T = any>(socket: TestSocket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    (socket as unknown as { once: (e: string, fn: (v: T) => void) => void }).once(event, (v: T) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}

export function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 4000, intervalMs = 20): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const v = fn();
      if (v) return resolve(v);
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

let n = 0;
export async function newPlayer(base: string, opts: { name?: string; classId?: string } = {}) {
  const b = new Browser(base);
  const id = `${Date.now().toString(36)}${(n++).toString(36)}`;
  const email = `p${id}@example.com`;
  const reg = await b.post('/api/auth/register', { email, password: 'correct horse battery staple' });
  if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.data)}`);
  const name = opts.name ?? `T${id.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]!)}`.slice(0, 16);
  const created = await b.post('/api/characters', {
    name,
    classId: opts.classId ?? 'warrior',
    appearance: { bodyType: 'a', skinTone: 1, hairStyle: 0, hairColor: 1, eyeColor: 0, outfit: 0 },
  });
  if (created.status !== 200) throw new Error(`create failed: ${JSON.stringify(created.data)}`);
  return { browser: b, email, character: created.data.character as { id: string; name: string } };
}

/** Connect and wait for the world:enter payload. */
export async function enterWorld(base: string, cookie: string, characterId: string): Promise<{ socket: TestSocket; enter: EnterWorldPayload }> {
  const socket = connectSocket(base, cookie, characterId);
  const enter = await once<EnterWorldPayload>(socket, 'world:enter');
  return { socket, enter };
}

/** Send N movement commands in real time (one per 50ms step), like a real client. */
export async function walk(socket: TestSocket, startSeq: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1, steps: number): Promise<number> {
  let seq = startSeq;
  for (let i = 0; i < steps; i++) {
    socket.emit('move', [++seq, dx, dy]);
    await new Promise((r) => setTimeout(r, 50));
  }
  return seq;
}

export function ack<T = any>(socket: TestSocket, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 5000);
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: T) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

/** Log out of the world (the server closes the socket right away) and wait until it's gone. */
export function leaveWorld(socket: TestSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('disconnect', () => resolve());
    socket.emit('logout', () => {});
  });
}
