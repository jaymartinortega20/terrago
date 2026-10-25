import { markSignedIn } from './session';
import type { CharacterSummary, CreateCharacterInput } from '@terrago/shared';

/** Where the authoritative game server lives. The game connects here directly (WebSocket). */
export const GAME_SERVER_URL = (process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * REST calls go to this website's own /api path, which Next.js forwards to the
 * game server (see next.config.ts). The session cookie is therefore first-party
 * on the website's domain, even when the game server is on another site.
 */
const API_BASE = '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 90_000);
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctl.signal,
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError("Can't reach the TerraGo server. It may be waking up — try again in a moment.", 0);
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (res.status === 401) markSignedIn(false);
  if (res.status >= 502 && res.status <= 504) throw new ApiError('The TerraGo server is waking up or restarting. Try again in a moment.', res.status);
  if (!res.ok || data.ok === false) throw new ApiError(data.error ?? `Request failed (${res.status}).`, res.status);
  return data;
}

export interface User {
  id: string;
  email: string;
  roles?: string[];
}

export const api = {
  register: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => {
    markSignedIn(false);
    return request<object>('/api/auth/logout', { method: 'POST', body: '{}' });
  },
  me: async () => {
    const r = await request<{ user: User }>('/api/auth/me');
    markSignedIn(true);
    return r;
  },
  characters: () => request<{ characters: CharacterSummary[] }>('/api/characters'),
  createCharacter: (input: CreateCharacterInput) =>
    request<{ character: CharacterSummary }>('/api/characters', { method: 'POST', body: JSON.stringify(input) }),
  /** One-time pass (60 s) that lets the game connection prove who you are. */
  gameTicket: (characterId: string) =>
    request<{ ticket: string; expiresInMs: number }>('/api/game/ticket', { method: 'POST', body: JSON.stringify({ characterId }) }),
};

/** Admin panel calls (the server checks the admin role on every one). */
export const adminApi = {
  get: <T,>(path: string) => request<T>(`/api/admin/${path}`),
  post: <T,>(path: string, body: object) => request<T>(`/api/admin/${path}`, { method: 'POST', body: JSON.stringify(body) }),
};
