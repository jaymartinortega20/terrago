/**
 * The only module allowed to issue SQL. Everything else in server/ talks to
 * this interface, so PostgreSQL (or anything else) can replace SQLite later
 * by implementing `Repository` again, per docs/ARCHITECTURE.md.
 */
import type { Database } from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { EquipmentSlot, Stats } from '@terago/shared';

export interface Account {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
}

export type ItemSlotLocation = 'bag' | EquipmentSlot;

export interface ItemRow {
  id: string;
  characterId: string;
  itemId: string;
  slot: ItemSlotLocation;
  qty: number;
  refineLevel: number;
}

export interface HotbarBinding {
  type: 'skill' | 'item';
  id: string;
}

export interface HotbarSlot {
  slotIndex: number;
  binding: HotbarBinding | null;
}

export interface QuestStateRow {
  questId: string;
  state: 'active' | 'readyToTurnIn' | 'complete';
  progress: Record<string, number>;
}

export interface CharacterRow {
  id: string;
  accountId: string;
  name: string;
  mapId: string;
  x: number;
  y: number;
  baseLevel: number;
  jobId: string;
  jobLevel: number;
  baseExp: number;
  jobExp: number;
  stats: Stats;
  unallocatedStatPoints: number;
  hp: number;
  resource: number;
  gold: number;
  settings: Record<string, unknown>;
  introSeen: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterPatch {
  mapId: string;
  x: number;
  y: number;
  baseLevel: number;
  jobId: string;
  jobLevel: number;
  baseExp: number;
  jobExp: number;
  stats: Stats;
  unallocatedStatPoints: number;
  hp: number;
  resource: number;
  gold: number;
  settings: Record<string, unknown>;
  introSeen: boolean;
}

export interface Repository {
  createAccount(username: string, passwordHash: string): Account;
  getAccountByUsername(username: string): Account | null;
  getAccountById(id: string): Account | null;

  createCharacter(accountId: string, name: string, spawn: { mapId: string; x: number; y: number }, stats: Stats, hp: number, resource: number): CharacterRow;
  getCharacterByAccountId(accountId: string): CharacterRow | null;
  getCharacterById(id: string): CharacterRow | null;
  saveCharacter(id: string, patch: Partial<CharacterPatch>): void;

  listItems(characterId: string): ItemRow[];
  getItem(itemRowId: string): ItemRow | null;
  addItem(characterId: string, itemId: string, qty: number, stackable: boolean, maxStack: number): ItemRow;
  setItemQty(itemRowId: string, qty: number): void;
  deleteItem(itemRowId: string): void;
  setItemSlot(itemRowId: string, slot: ItemSlotLocation): void;
  getEquippedInSlot(characterId: string, slot: EquipmentSlot): ItemRow | null;

  getHotbar(characterId: string): HotbarSlot[];
  setHotbarSlot(characterId: string, slotIndex: number, binding: HotbarBinding | null): void;

  getQuestStates(characterId: string): QuestStateRow[];
  upsertQuestState(characterId: string, questId: string, state: QuestStateRow['state'], progress: Record<string, number>): void;

  isUnlocked(characterId: string, kind: 'waystone' | 'skill', refId: string): boolean;
  grantUnlock(characterId: string, kind: 'waystone' | 'skill', refId: string): void;
  listUnlocks(characterId: string, kind: 'waystone' | 'skill'): string[];
}

export function createSqliteRepository(db: Database): Repository {
  const now = () => Date.now();

  function rowToCharacter(row: any): CharacterRow {
    return {
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      mapId: row.map_id,
      x: row.x,
      y: row.y,
      baseLevel: row.base_level,
      jobId: row.job_id,
      jobLevel: row.job_level,
      baseExp: row.base_exp,
      jobExp: row.job_exp,
      stats: JSON.parse(row.stats_json),
      unallocatedStatPoints: row.unallocated_stat_points,
      hp: row.hp,
      resource: row.resource,
      gold: row.gold,
      settings: JSON.parse(row.settings_json),
      introSeen: !!row.intro_seen,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToItem(row: any): ItemRow {
    return {
      id: row.id,
      characterId: row.character_id,
      itemId: row.item_id,
      slot: row.slot,
      qty: row.qty,
      refineLevel: row.refine_level,
    };
  }

  return {
    createAccount(username, passwordHash) {
      const id = nanoid();
      const createdAt = now();
      db.prepare(
        'INSERT INTO accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
      ).run(id, username, passwordHash, createdAt);
      return { id, username, passwordHash, createdAt };
    },

    getAccountByUsername(username) {
      const row = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as any;
      if (!row) return null;
      return { id: row.id, username: row.username, passwordHash: row.password_hash, createdAt: row.created_at };
    },

    getAccountById(id) {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as any;
      if (!row) return null;
      return { id: row.id, username: row.username, passwordHash: row.password_hash, createdAt: row.created_at };
    },

    createCharacter(accountId, name, spawn, stats, hp, resource) {
      const id = nanoid();
      const t = now();
      db.prepare(
        `INSERT INTO characters
          (id, account_id, name, map_id, x, y, base_level, job_id, job_level, base_exp, job_exp,
           stats_json, unallocated_stat_points, hp, resource, gold, settings_json, intro_seen, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'recruit', 1, 0, 0, ?, 10, ?, ?, 0, '{}', 0, ?, ?)`
      ).run(id, accountId, name, spawn.mapId, spawn.x, spawn.y, JSON.stringify(stats), hp, resource, t, t);
      const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
      return rowToCharacter(row);
    },

    getCharacterByAccountId(accountId) {
      const row = db.prepare('SELECT * FROM characters WHERE account_id = ?').get(accountId);
      return row ? rowToCharacter(row) : null;
    },

    getCharacterById(id) {
      const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
      return row ? rowToCharacter(row) : null;
    },

    saveCharacter(id, patch) {
      const fields: string[] = [];
      const values: unknown[] = [];
      const map: Record<string, unknown> = {
        map_id: patch.mapId,
        x: patch.x,
        y: patch.y,
        base_level: patch.baseLevel,
        job_id: patch.jobId,
        job_level: patch.jobLevel,
        base_exp: patch.baseExp,
        job_exp: patch.jobExp,
        stats_json: patch.stats !== undefined ? JSON.stringify(patch.stats) : undefined,
        unallocated_stat_points: patch.unallocatedStatPoints,
        hp: patch.hp,
        resource: patch.resource,
        gold: patch.gold,
        settings_json: patch.settings !== undefined ? JSON.stringify(patch.settings) : undefined,
        intro_seen: patch.introSeen !== undefined ? (patch.introSeen ? 1 : 0) : undefined,
      };
      for (const [col, val] of Object.entries(map)) {
        if (val !== undefined) {
          fields.push(`${col} = ?`);
          values.push(val);
        }
      }
      if (fields.length === 0) return;
      fields.push('updated_at = ?');
      values.push(now());
      values.push(id);
      db.prepare(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    },

    listItems(characterId) {
      const rows = db.prepare('SELECT * FROM character_items WHERE character_id = ?').all(characterId);
      return rows.map(rowToItem);
    },

    getItem(itemRowId) {
      const row = db.prepare('SELECT * FROM character_items WHERE id = ?').get(itemRowId);
      return row ? rowToItem(row) : null;
    },

    addItem(characterId, itemId, qty, stackable, maxStack) {
      let remaining = qty;
      let lastRow: ItemRow | null = null;

      if (stackable) {
        const existing = db
          .prepare("SELECT * FROM character_items WHERE character_id = ? AND item_id = ? AND slot = 'bag' AND qty < ?")
          .get(characterId, itemId, maxStack);
        if (existing) {
          const row = rowToItem(existing);
          const space = maxStack - row.qty;
          const added = Math.min(space, remaining);
          const newQty = row.qty + added;
          db.prepare('UPDATE character_items SET qty = ? WHERE id = ?').run(newQty, row.id);
          lastRow = { ...row, qty: newQty };
          remaining -= added;
        }
      }

      // Overflow (or a non-stackable item, or no existing stack) spills into new
      // row(s), each capped at maxStack, so quantity is never silently dropped.
      while (remaining > 0) {
        const id = nanoid();
        const rowQty = stackable ? Math.min(maxStack, remaining) : 1;
        db.prepare(
          "INSERT INTO character_items (id, character_id, item_id, slot, qty, refine_level) VALUES (?, ?, ?, 'bag', ?, 0)"
        ).run(id, characterId, itemId, rowQty);
        lastRow = { id, characterId, itemId, slot: 'bag', qty: rowQty, refineLevel: 0 };
        remaining -= rowQty;
      }

      // addItem always has at least one row to return: either the stack we just
      // topped up, or the loop above (qty > 0 is enforced by callers).
      return lastRow!;
    },

    setItemQty(itemRowId, qty) {
      db.prepare('UPDATE character_items SET qty = ? WHERE id = ?').run(qty, itemRowId);
    },

    deleteItem(itemRowId) {
      db.prepare('DELETE FROM character_items WHERE id = ?').run(itemRowId);
    },

    setItemSlot(itemRowId, slot) {
      db.prepare('UPDATE character_items SET slot = ? WHERE id = ?').run(slot, itemRowId);
    },

    getEquippedInSlot(characterId, slot) {
      const row = db
        .prepare('SELECT * FROM character_items WHERE character_id = ? AND slot = ?')
        .get(characterId, slot);
      return row ? rowToItem(row) : null;
    },

    getHotbar(characterId) {
      const rows = db
        .prepare('SELECT * FROM character_hotbar WHERE character_id = ? ORDER BY slot_index')
        .all(characterId) as any[];
      const bySlot = new Map(rows.map((r) => [r.slot_index, r]));
      const result: HotbarSlot[] = [];
      for (let i = 1; i <= 8; i++) {
        const r = bySlot.get(i);
        result.push({
          slotIndex: i,
          binding: r && r.binding_type ? { type: r.binding_type, id: r.binding_id } : null,
        });
      }
      return result;
    },

    setHotbarSlot(characterId, slotIndex, binding) {
      db.prepare(
        `INSERT INTO character_hotbar (character_id, slot_index, binding_type, binding_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(character_id, slot_index) DO UPDATE SET binding_type = excluded.binding_type, binding_id = excluded.binding_id`
      ).run(characterId, slotIndex, binding?.type ?? null, binding?.id ?? null);
    },

    getQuestStates(characterId) {
      const rows = db.prepare('SELECT * FROM character_quests WHERE character_id = ?').all(characterId) as any[];
      return rows.map((r) => ({ questId: r.quest_id, state: r.state, progress: JSON.parse(r.progress_json) }));
    },

    upsertQuestState(characterId, questId, state, progress) {
      db.prepare(
        `INSERT INTO character_quests (character_id, quest_id, state, progress_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(character_id, quest_id) DO UPDATE SET state = excluded.state, progress_json = excluded.progress_json`
      ).run(characterId, questId, state, JSON.stringify(progress));
    },

    isUnlocked(characterId, kind, refId) {
      const row = db
        .prepare('SELECT 1 FROM character_unlocks WHERE character_id = ? AND kind = ? AND ref_id = ?')
        .get(characterId, kind, refId);
      return !!row;
    },

    grantUnlock(characterId, kind, refId) {
      db.prepare(
        'INSERT OR IGNORE INTO character_unlocks (character_id, kind, ref_id) VALUES (?, ?, ?)'
      ).run(characterId, kind, refId);
    },

    listUnlocks(characterId, kind) {
      const rows = db
        .prepare('SELECT ref_id FROM character_unlocks WHERE character_id = ? AND kind = ?')
        .all(characterId, kind) as any[];
      return rows.map((r) => r.ref_id);
    },
  };
}
