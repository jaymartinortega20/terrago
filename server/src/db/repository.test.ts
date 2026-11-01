import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { createSqliteRepository } from './repository.js';
import type { Stats } from '@terago/shared';

function freshRepo() {
  const db = openDatabase(':memory:');
  return createSqliteRepository(db);
}

const STATS: Stats = { STR: 1, AGI: 1, VIT: 1, INT: 1, DEX: 1, LUK: 1 };

describe('database schema', () => {
  it('creates every table on open', () => {
    const db = openDatabase(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual([
      'accounts',
      'character_hotbar',
      'character_items',
      'character_quests',
      'character_unlocks',
      'characters',
    ]);
  });

  it('enables foreign key enforcement', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('accounts', () => {
  it('round-trips an account by username and id', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash123');
    expect(repo.getAccountByUsername('tester')?.id).toBe(acct.id);
    expect(repo.getAccountById(acct.id)?.username).toBe('tester');
    expect(repo.getAccountByUsername('nope')).toBeNull();
  });
});

describe('characters', () => {
  it('creates a character with starting values and fetches it by account or id', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    expect(char.name).toBe('Hero');
    expect(char.mapId).toBe('map1');
    expect(char.baseLevel).toBe(1);
    expect(char.jobId).toBe('recruit');
    expect(char.unallocatedStatPoints).toBe(10);
    expect(repo.getCharacterByAccountId(acct.id)?.id).toBe(char.id);
    expect(repo.getCharacterById(char.id)?.stats).toEqual(STATS);
  });

  it('patches only the given fields and bumps updatedAt', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    repo.saveCharacter(char.id, { x: 11, y: 8, gold: 50 });
    const updated = repo.getCharacterById(char.id)!;
    expect(updated.x).toBe(11);
    expect(updated.y).toBe(8);
    expect(updated.gold).toBe(50);
    expect(updated.name).toBe('Hero');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(char.updatedAt);
  });
});

describe('items', () => {
  it('stacks a stackable item up to maxStack instead of creating a new row', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    repo.addItem(char.id, 'potion_hp_small', 5, true, 20);
    const second = repo.addItem(char.id, 'potion_hp_small', 10, true, 20);
    expect(second.qty).toBe(15);
    expect(repo.listItems(char.id)).toHaveLength(1);
  });

  it('caps a stack at maxStack and starts a new row for the overflow', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    repo.addItem(char.id, 'potion_hp_small', 18, true, 20);
    // 18 already in the stack + 10 more = 28, which is over maxStack (20): 2
    // tops that stack off and the remaining 8 spill into a second row rather
    // than being silently dropped.
    const second = repo.addItem(char.id, 'potion_hp_small', 10, true, 20);
    expect(second.qty).toBe(8);
    const rows = repo.listItems(char.id);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, r) => sum + r.qty, 0)).toBe(28);
    expect(rows.map((r) => r.qty).sort((a, b) => a - b)).toEqual([8, 20]);
  });

  it('splits a single huge addItem call across multiple capped rows', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    repo.addItem(char.id, 'slime_gel', 45, true, 20);
    const rows = repo.listItems(char.id);
    expect(rows.reduce((sum, r) => sum + r.qty, 0)).toBe(45);
    expect(rows.every((r) => r.qty <= 20)).toBe(true);
  });

  it('does not stack non-stackable items', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    repo.addItem(char.id, 'recruit_training_sword', 1, false, 1);
    repo.addItem(char.id, 'recruit_training_sword', 1, false, 1);
    expect(repo.listItems(char.id)).toHaveLength(2);
  });

  it('equips an item into a slot and finds it by slot', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    const weapon = repo.addItem(char.id, 'recruit_training_sword', 1, false, 1);
    expect(repo.getEquippedInSlot(char.id, 'weapon')).toBeNull();
    repo.setItemSlot(weapon.id, 'weapon');
    expect(repo.getEquippedInSlot(char.id, 'weapon')?.id).toBe(weapon.id);
  });

  it('deletes and re-quantities items', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    const item = repo.addItem(char.id, 'slime_gel', 3, true, 999);
    repo.setItemQty(item.id, 1);
    expect(repo.getItem(item.id)?.qty).toBe(1);
    repo.deleteItem(item.id);
    expect(repo.getItem(item.id)).toBeNull();
  });
});

describe('hotbar', () => {
  it('always returns 8 slots, bound or empty', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    const hotbar = repo.getHotbar(char.id);
    expect(hotbar).toHaveLength(8);
    expect(hotbar.every((s) => s.binding === null)).toBe(true);
  });

  it('upserts a binding on repeated writes to the same slot', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    repo.setHotbarSlot(char.id, 1, { type: 'item', id: 'potion_hp_small' });
    repo.setHotbarSlot(char.id, 1, { type: 'skill', id: 'fireball' });
    const hotbar = repo.getHotbar(char.id);
    expect(hotbar[0]?.binding).toEqual({ type: 'skill', id: 'fireball' });
  });

  it('clears a slot by setting a null binding', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    repo.setHotbarSlot(char.id, 2, { type: 'item', id: 'potion_hp_small' });
    repo.setHotbarSlot(char.id, 2, null);
    expect(repo.getHotbar(char.id)[1]?.binding).toBeNull();
  });
});

describe('quests', () => {
  it('upserts quest state and progress idempotently', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    repo.upsertQuestState(char.id, 'first_steps', 'active', { talk: 0 });
    repo.upsertQuestState(char.id, 'first_steps', 'readyToTurnIn', { talk: 1 });
    const quests = repo.getQuestStates(char.id);
    expect(quests).toHaveLength(1);
    expect(quests[0]).toEqual({ questId: 'first_steps', state: 'readyToTurnIn', progress: { talk: 1 } });
  });
});

describe('unlocks', () => {
  it('grants and checks unlocks idempotently', () => {
    const repo = freshRepo();
    const acct = repo.createAccount('tester', 'hash');
    const char = repo.createCharacter(acct.id, 'Hero', { mapId: 'map1', x: 10, y: 7 }, STATS, 50, 20);
    expect(repo.isUnlocked(char.id, 'waystone', 'map1')).toBe(false);
    repo.grantUnlock(char.id, 'waystone', 'map1');
    repo.grantUnlock(char.id, 'waystone', 'map1');
    expect(repo.isUnlocked(char.id, 'waystone', 'map1')).toBe(true);
    expect(repo.listUnlocks(char.id, 'waystone')).toEqual(['map1']);
  });
});
