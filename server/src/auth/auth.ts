/**
 * Registration, login, and session tokens (SPEC.md tech-stack table:
 * "Username + password hashed with argon2 or bcrypt, session token; one
 * character per account in v1").
 *
 * v1 has no separate character-creation step: a new account gets exactly
 * one Recruit character immediately, named after the username (the
 * auth:register message carries no separate character name — see
 * docs/DECISIONS.md).
 */
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { CLASSES, MAPS, maxHp, maxMana, type Stats } from '@terago/shared';
import type { Account, CharacterRow, Repository } from '../db/repository.js';

export type AuthFailureReason = 'username_taken' | 'invalid_credentials' | 'internal_error';

export interface AuthSuccess {
  ok: true;
  account: Account;
  character: CharacterRow;
  sessionToken: string;
}

export interface AuthFailure {
  ok: false;
  reason: AuthFailureReason;
}

export type AuthResult = AuthSuccess | AuthFailure;

const STARTING_MAP_ID = 'map1'; // Oakhaven Sanctuary
const STARTING_STATS: Stats = { STR: 1, AGI: 1, VIT: 1, INT: 1, DEX: 1, LUK: 1 };

/** In-memory session-token -> account/character lookup for connected sockets.
 * Tokens are per-process and not persisted: a server restart simply requires
 * clients to log in again, which is acceptable for v1 (no "remember me"
 * reconnect-without-password promised anywhere in SPEC.md). */
const sessions = new Map<string, { accountId: string; characterId: string }>();

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password).catch(() => false);
}

function startingHpAndResource(): { hp: number; resource: number } {
  const recruit = CLASSES.recruit;
  const hp = maxHp(1, STARTING_STATS.VIT, recruit.hpModifier);
  const resource = maxMana(1, STARTING_STATS.INT);
  return { hp, resource };
}

function spawnPoint(): { mapId: string; x: number; y: number } {
  const map = MAPS[STARTING_MAP_ID];
  if (!map) throw new Error(`starting map ${STARTING_MAP_ID} is not registered in shared/config/maps.ts`);
  return { mapId: map.id, x: map.spawnPoint.x, y: map.spawnPoint.y };
}

function issueSession(accountId: string, characterId: string): string {
  const token = nanoid(32);
  sessions.set(token, { accountId, characterId });
  return token;
}

export function getSession(token: string): { accountId: string; characterId: string } | undefined {
  return sessions.get(token);
}

export function revokeSession(token: string): void {
  sessions.delete(token);
}

export async function registerAccount(repo: Repository, username: string, password: string): Promise<AuthResult> {
  try {
    if (repo.getAccountByUsername(username)) {
      return { ok: false, reason: 'username_taken' };
    }
    const passwordHash = await hashPassword(password);
    const account = repo.createAccount(username, passwordHash);
    const { hp, resource } = startingHpAndResource();
    const character = repo.createCharacter(account.id, username, spawnPoint(), STARTING_STATS, hp, resource);
    const sessionToken = issueSession(account.id, character.id);
    return { ok: true, account, character, sessionToken };
  } catch {
    return { ok: false, reason: 'internal_error' };
  }
}

export async function loginAccount(repo: Repository, username: string, password: string): Promise<AuthResult> {
  try {
    const account = repo.getAccountByUsername(username);
    if (!account) {
      return { ok: false, reason: 'invalid_credentials' };
    }
    const valid = await verifyPassword(account.passwordHash, password);
    if (!valid) {
      return { ok: false, reason: 'invalid_credentials' };
    }
    const character = repo.getCharacterByAccountId(account.id);
    if (!character) {
      // Shouldn't happen (every account gets a character at registration),
      // but don't crash the connection over a data inconsistency.
      return { ok: false, reason: 'internal_error' };
    }
    const sessionToken = issueSession(account.id, character.id);
    return { ok: true, account, character, sessionToken };
  } catch {
    return { ok: false, reason: 'internal_error' };
  }
}
