import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { createSqliteRepository } from '../db/repository.js';
import { getSession, loginAccount, registerAccount, revokeSession } from './auth.js';

function freshRepo() {
  return createSqliteRepository(openDatabase(':memory:'));
}

describe('registerAccount', () => {
  it('creates an account and a starting Recruit character in Oakhaven', async () => {
    const repo = freshRepo();
    const result = await registerAccount(repo, 'newplayer', 'correct-horse');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.username).toBe('newplayer');
    expect(result.character.jobId).toBe('recruit');
    expect(result.character.baseLevel).toBe(1);
    expect(result.character.mapId).toBe('map1');
    expect(result.character.stats).toEqual({ STR: 1, AGI: 1, VIT: 1, INT: 1, DEX: 1, LUK: 1 });
    expect(result.character.hp).toBeGreaterThan(0);
    expect(result.character.resource).toBeGreaterThanOrEqual(0);
    expect(typeof result.sessionToken).toBe('string');
    expect(getSession(result.sessionToken)).toEqual({
      accountId: result.account.id,
      characterId: result.character.id,
    });
  });

  it('grants and equips a starting weapon plus a few potions', async () => {
    const repo = freshRepo();
    const result = await registerAccount(repo, 'newplayer', 'correct-horse');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const weapon = repo.getEquippedInSlot(result.character.id, 'weapon');
    expect(weapon?.itemId).toBe('recruit_training_sword');

    const items = repo.listItems(result.character.id);
    const potions = items.find((i) => i.itemId === 'potion_hp_small');
    expect(potions?.qty).toBe(3);
  });

  it('never stores the plaintext password', async () => {
    const repo = freshRepo();
    const result = await registerAccount(repo, 'newplayer', 'correct-horse');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.passwordHash).not.toBe('correct-horse');
    expect(result.account.passwordHash.length).toBeGreaterThan(20);
  });

  it('rejects a duplicate username without touching the existing account', async () => {
    const repo = freshRepo();
    await registerAccount(repo, 'newplayer', 'correct-horse');
    const dupe = await registerAccount(repo, 'newplayer', 'different-password');
    expect(dupe).toEqual({ ok: false, reason: 'username_taken' });
  });
});

describe('loginAccount', () => {
  it('logs in with the right password and issues a usable session', async () => {
    const repo = freshRepo();
    await registerAccount(repo, 'player1', 'correct-horse');
    const result = await loginAccount(repo, 'player1', 'correct-horse');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.username).toBe('player1');
    expect(getSession(result.sessionToken)?.accountId).toBe(result.account.id);
  });

  it('rejects a wrong password without revealing whether the username exists', async () => {
    const repo = freshRepo();
    await registerAccount(repo, 'player1', 'correct-horse');
    const wrongPassword = await loginAccount(repo, 'player1', 'totally-wrong');
    const noSuchUser = await loginAccount(repo, 'nobody', 'totally-wrong');
    expect(wrongPassword).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(noSuchUser).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('issues a fresh session token on every login', async () => {
    const repo = freshRepo();
    await registerAccount(repo, 'player1', 'correct-horse');
    const first = await loginAccount(repo, 'player1', 'correct-horse');
    const second = await loginAccount(repo, 'player1', 'correct-horse');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.sessionToken).not.toBe(second.sessionToken);
    expect(getSession(first.sessionToken)).toBeDefined();
    expect(getSession(second.sessionToken)).toBeDefined();
  });
});

describe('revokeSession', () => {
  it('makes a token unresolvable', async () => {
    const repo = freshRepo();
    const result = await registerAccount(repo, 'player1', 'correct-horse');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getSession(result.sessionToken)).toBeDefined();
    revokeSession(result.sessionToken);
    expect(getSession(result.sessionToken)).toBeUndefined();
  });
});
