import { setManualEvent, WORLD_EVENTS, type ManualEvent } from '@terrago/shared';
import type { Pool } from '../db';

/** Settings admins can change while the server runs. Stored in server_config. */
export interface ServerSettings {
  /** Message of the day, shown in chat when a player enters the world. */
  motd: string;
  /** New accounts allowed. */
  registrationOpen: boolean;
  /** Monster XP multiplier (1–3), on top of any world event. */
  xpRate: number;
  /** A world event an admin started by hand. */
  manualEvent: ManualEvent | null;
}

const DEFAULTS: ServerSettings = { motd: '', registrationOpen: true, xpRate: 1, manualEvent: null };
let current: ServerSettings = { ...DEFAULTS };

export function settings(): ServerSettings {
  return current;
}

/** Check and clean a partial update; throws a readable message on bad input. */
export function validateSettings(patch: Record<string, unknown>): Partial<ServerSettings> {
  const out: Partial<ServerSettings> = {};
  if ('motd' in patch) {
    if (typeof patch.motd !== 'string') throw new Error('Message of the day must be text.');
    out.motd = patch.motd.trim().slice(0, 300);
  }
  if ('registrationOpen' in patch) {
    if (typeof patch.registrationOpen !== 'boolean') throw new Error('Registration must be on or off.');
    out.registrationOpen = patch.registrationOpen;
  }
  if ('xpRate' in patch) {
    const v = Number(patch.xpRate);
    if (!Number.isFinite(v) || v < 1 || v > 3) throw new Error('XP rate must be between 1 and 3.');
    out.xpRate = Math.round(v * 100) / 100;
  }
  if ('manualEvent' in patch) {
    const m = patch.manualEvent as ManualEvent | null;
    if (m !== null && (!m || !WORLD_EVENTS.some((e) => e.id === m.id) || !(m.end > m.start))) throw new Error('Unknown event.');
    out.manualEvent = m;
  }
  return out;
}

export async function loadSettings(pool: Pool): Promise<ServerSettings> {
  const { rows } = await pool.query<{ key: keyof ServerSettings; value: unknown }>(`SELECT key, value FROM server_config`);
  const next: ServerSettings = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) (next as unknown as Record<string, unknown>)[r.key] = r.value;
  if (next.manualEvent && next.manualEvent.end <= Date.now()) next.manualEvent = null;
  current = next;
  setManualEvent(current.manualEvent);
  return current;
}

export async function saveSettings(pool: Pool, patch: Partial<ServerSettings>): Promise<ServerSettings> {
  for (const [key, value] of Object.entries(patch)) {
    await pool.query(
      `INSERT INTO server_config (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
  current = { ...current, ...patch };
  if ('manualEvent' in patch) setManualEvent(current.manualEvent);
  return current;
}
