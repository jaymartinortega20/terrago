import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseCookies } from '../auth/sessions';
import { GameError } from '../db';
import type { Logger } from '../logger';

/**
 * A deliberately small HTTP layer for the game API: routing, JSON bodies,
 * CORS for the web origin, CSRF protection and security headers. The API is a
 * handful of endpoints; the real-time game runs over Socket.IO.
 */

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  ip: string | null;
  cookies: Record<string, string>;
  body: unknown;
  /** The exact request body (for webhook signatures). */
  rawBody: string;
  setCookie(cookie: string): void;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

export interface RouterOptions {
  allowedOrigins: string[];
  trustProxy: boolean;
  log: Logger;
  maxBodyBytes?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string | null {
  let ip: string | undefined;
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) ip = first;
  }
  ip ??= req.socket.remoteAddress ?? undefined;
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export class Router {
  private readonly routes: { method: string; path: string; handler: Handler }[] = [];

  constructor(private readonly opts: RouterOptions) {}

  get(path: string, handler: Handler): this {
    this.routes.push({ method: 'GET', path, handler });
    return this;
  }

  post(path: string, handler: Handler): this {
    this.routes.push({ method: 'POST', path, handler });
    return this;
  }

  /** Returns false if no route matched (so other listeners, e.g. Socket.IO, can handle it). */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname.startsWith('/socket.io/')) return false;

    const origin = req.headers.origin;
    const originAllowed = !!origin && this.opts.allowedOrigins.includes(origin);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin!);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      if (originAllowed) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.writeHead(originAllowed ? 204 : 403).end();
      return true;
    }

    const route = this.routes.find((r) => r.method === req.method && r.path === url.pathname);
    if (!route) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return true;
    }

    const cookiesToSet: string[] = [];
    try {
      if (req.method === 'POST') {
        // CSRF: browsers always send Origin on POST, so a present Origin must be ours,
        // and a browser-flagged cross-site request is refused. Requests without either
        // header are non-browser clients (or a same-origin proxy hop), which CSRF can't
        // abuse. JSON-only bodies plus SameSite=Lax cookies close the remaining gaps.
        if (origin ? !originAllowed : req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Origin not allowed.');
        const ct = req.headers['content-type'] ?? '';
        if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Expected application/json.');
      }
      const read = req.method === 'POST' ? await readJson(req, this.opts.maxBodyBytes ?? 64 * 1024) : { json: undefined, raw: '' };
      const body = read.json;
      const ctx: Ctx = {
        req,
        res,
        url,
        ip: clientIp(req, this.opts.trustProxy),
        cookies: parseCookies(req.headers.cookie),
        body,
        rawBody: read.raw,
        setCookie: (c) => cookiesToSet.push(c),
      };
      const result = await route.handler(ctx);
      if (cookiesToSet.length) res.setHeader('Set-Cookie', cookiesToSet);
      if (!res.writableEnded) sendJson(res, 200, { ok: true, ...(result as object) });
    } catch (err) {
      if (cookiesToSet.length) res.setHeader('Set-Cookie', cookiesToSet);
      if (err instanceof HttpError) {
        for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
        sendJson(res, err.status, { ok: false, error: err.message });
      } else if (err instanceof GameError) {
        sendJson(res, err.status, { ok: false, error: err.message });
      } else {
        this.opts.log.error('http_error', { err, path: url.pathname });
        sendJson(res, 500, { ok: false, error: 'Something went wrong. Please try again.' });
      }
    }
    return true;
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req: IncomingMessage, limit: number): Promise<{ json: unknown; raw: string }> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size === 0) return resolve({ json: {}, raw: '' });
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ json: JSON.parse(raw), raw });
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}
