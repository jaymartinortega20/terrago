import type { CharacterSummary, CreateCharacterInput } from '@terrago/shared';

/** Where the authoritative game server lives (REST API + Socket.IO). */
export const GAME_SERVER_URL = (process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GAME_SERVER_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError("Can't reach the TerraGo server. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!res.ok || data.ok === false) throw new ApiError(data.error ?? `Request failed (${res.status}).`, res.status);
  return data;
}

export interface User {
  id: string;
  email: string;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<object>('/api/auth/logout', { method: 'POST', body: '{}' }),
  me: () => request<{ user: User }>('/api/auth/me'),
  characters: () => request<{ characters: CharacterSummary[] }>('/api/characters'),
  createCharacter: (input: CreateCharacterInput) =>
    request<{ character: CharacterSummary }>('/api/characters', { method: 'POST', body: JSON.stringify(input) }),
};
