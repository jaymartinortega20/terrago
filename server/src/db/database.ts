import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  map_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  base_level INTEGER NOT NULL DEFAULT 1,
  job_id TEXT NOT NULL DEFAULT 'recruit',
  job_level INTEGER NOT NULL DEFAULT 1,
  base_exp INTEGER NOT NULL DEFAULT 0,
  job_exp INTEGER NOT NULL DEFAULT 0,
  stats_json TEXT NOT NULL,
  unallocated_stat_points INTEGER NOT NULL DEFAULT 10,
  hp INTEGER NOT NULL,
  resource INTEGER NOT NULL,
  gold INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  intro_seen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_items (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id),
  item_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  refine_level INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_character_items_char ON character_items(character_id);

CREATE TABLE IF NOT EXISTS character_hotbar (
  character_id TEXT NOT NULL REFERENCES characters(id),
  slot_index INTEGER NOT NULL,
  binding_type TEXT,
  binding_id TEXT,
  PRIMARY KEY (character_id, slot_index)
);

CREATE TABLE IF NOT EXISTS character_quests (
  character_id TEXT NOT NULL REFERENCES characters(id),
  quest_id TEXT NOT NULL,
  state TEXT NOT NULL,
  progress_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (character_id, quest_id)
);

CREATE TABLE IF NOT EXISTS character_unlocks (
  character_id TEXT NOT NULL REFERENCES characters(id),
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  PRIMARY KEY (character_id, kind, ref_id)
);
`;

export function openDatabase(path: string): Database.Database {
  const dir = dirname(path);
  if (path !== ':memory:' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
