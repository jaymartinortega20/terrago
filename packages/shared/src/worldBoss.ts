/**
 * World bosses: every three hours (on the half hour after an event slot) one
 * huge boss appears somewhere in the open world and stays for 30 minutes.
 * The schedule comes from the clock, so the client and server agree without
 * messages. Everyone who hits it gets their own loot; the top three are
 * announced to the whole server.
 */

export interface WorldBossDef {
  monster: string;
  name: string;
  map: string;
  level: number;
  area: { x: number; y: number; w: number; h: number };
}

export const WORLD_BOSS_PERIOD_MS = 3 * 60 * 60_000;
/** Offset into the period so world bosses don't clash with world events. */
export const WORLD_BOSS_OFFSET_MS = 60 * 60_000 + 30 * 60_000;
export const WORLD_BOSS_WINDOW_MS = 30 * 60_000;

export const WORLD_BOSSES: WorldBossDef[] = [
  { monster: 'wb_elder_treant', name: 'Elder Treant', map: 'sunfield_plains', level: 35, area: { x: 7, y: 46, w: 12, h: 8 } },
  { monster: 'wb_storm_roc', name: 'Storm Roc', map: 'desolate_crags', level: 65, area: { x: 36, y: 34, w: 14, h: 8 } },
  { monster: 'wb_glacial_behemoth', name: 'Glacial Behemoth', map: 'glacial_depths', level: 92, area: { x: 37, y: 38, w: 14, h: 5 } },
  { monster: 'wb_elder_dragon', name: 'Vyrnax the Elder Dragon', map: 'dragonspire', level: 100, area: { x: 38, y: 10, w: 14, h: 3 } },
];

let forced: { idx: number; start: number } | null | 'off' = null;
/** Tests and admins: force a world boss now (index into WORLD_BOSSES), 'off', or null for the schedule. */
export function setWorldBossOverride(v: number | 'off' | null, now = Date.now()): void {
  forced = v === null ? null : v === 'off' ? 'off' : { idx: v, start: now };
}

function slotStart(slot: number): number {
  return slot * WORLD_BOSS_PERIOD_MS + WORLD_BOSS_OFFSET_MS;
}

/** The world boss window open right now, if any. */
export function currentWorldBoss(now: number): { def: WorldBossDef; start: number; end: number } | null {
  if (forced === 'off') return null;
  if (forced) {
    const end = forced.start + WORLD_BOSS_WINDOW_MS;
    return now < end ? { def: WORLD_BOSSES[forced.idx % WORLD_BOSSES.length]!, start: forced.start, end } : null;
  }
  const slot = Math.floor((now - WORLD_BOSS_OFFSET_MS) / WORLD_BOSS_PERIOD_MS);
  const start = slotStart(slot);
  if (now < start || now >= start + WORLD_BOSS_WINDOW_MS) return null;
  return { def: WORLD_BOSSES[((slot % WORLD_BOSSES.length) + WORLD_BOSSES.length) % WORLD_BOSSES.length]!, start, end: start + WORLD_BOSS_WINDOW_MS };
}

/** The next world boss to appear. */
export function nextWorldBoss(now: number): { def: WorldBossDef; start: number } {
  const slot = Math.floor((now - WORLD_BOSS_OFFSET_MS) / WORLD_BOSS_PERIOD_MS) + 1;
  return { def: WORLD_BOSSES[((slot % WORLD_BOSSES.length) + WORLD_BOSSES.length) % WORLD_BOSSES.length]!, start: slotStart(slot) };
}

/** Bonus for placing in the damage ranking (1st, 2nd, 3rd), on top of normal boss loot. */
export function worldBossBonus(rank: number, level: number): { gold: number; items: { itemId: string; quantity: number }[] } {
  const stones = rank === 1 ? 6 : rank === 2 ? 4 : rank === 3 ? 3 : 1;
  const gold = Math.round(level * (rank === 1 ? 300 : rank === 2 ? 200 : rank === 3 ? 150 : 40));
  return { gold, items: [{ itemId: 'enhancement_stone', quantity: stones }] };
}
