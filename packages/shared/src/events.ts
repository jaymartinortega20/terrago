/**
 * World events: every two hours one event runs for 40 minutes. The schedule
 * comes from the clock (like weather), so everyone agrees without messages.
 */
export interface WorldEventDef {
  id: string;
  name: string;
  description: string;
  kind: 'xp' | 'fishing' | 'farming' | 'invasion';
  /** Multiplier for xp/fishing/farming events. */
  mult?: number;
  /** Invasions: where, what, and the boss leading them. */
  map?: string;
  monsters?: { monster: string; level: [number, number]; count: number }[];
  boss?: { monster: string; level: number };
  area?: { x: number; y: number; w: number; h: number };
}

export const EVENT_PERIOD_MS = 2 * 60 * 60_000;
export const EVENT_LENGTH_MS = 40 * 60_000;

export const WORLD_EVENTS: WorldEventDef[] = [
  { id: 'double_xp', name: 'Double XP', description: 'Monsters give twice the experience everywhere.', kind: 'xp', mult: 2 },
  { id: 'fishing_frenzy', name: 'Fishing Frenzy', description: 'Fish bite twice as fast and rare fish are hungrier.', kind: 'fishing', mult: 2 },
  { id: 'harvest_festival', name: 'Harvest Festival', description: 'Double Farming XP and a bonus crop on every harvest.', kind: 'farming', mult: 2 },
  {
    id: 'slime_rain',
    name: 'Slime Rain',
    description: 'Slimes are pouring onto Whispering Fields — and the King Slime came with them!',
    kind: 'invasion',
    map: 'sunfield_plains',
    monsters: [
      { monster: 'green_slime', level: [3, 5], count: 10 },
      { monster: 'blue_slime', level: [5, 7], count: 6 },
    ],
    boss: { monster: 'king_slime', level: 9 },
    area: { x: 34, y: 4, w: 22, h: 14 },
  },
  {
    id: 'goblin_raid',
    name: 'Goblin Raid',
    description: 'A goblin war band marches through Whispering Fields, led by their Warchief!',
    kind: 'invasion',
    map: 'sunfield_plains',
    monsters: [{ monster: 'goblin_scout', level: [14, 17], count: 12 }],
    boss: { monster: 'goblin_warchief', level: 19 },
    area: { x: 34, y: 42, w: 22, h: 12 },
  },
];

function pick(slot: number): WorldEventDef {
  let h = Math.imul(slot ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; // keep it unsigned so the index is never negative
  return WORLD_EVENTS[h % WORLD_EVENTS.length]!;
}

/** An event an admin started by hand (overrides the schedule while it runs). */
export interface ManualEvent {
  id: string;
  start: number;
  end: number;
}

let manual: ManualEvent | null = null;
export function setManualEvent(m: ManualEvent | null): void {
  manual = m;
}
export function manualEvent(): ManualEvent | null {
  return manual;
}

let forced: string | null | undefined;
/** Tests: 'off' disables events, an event id forces it, undefined = normal schedule. */
export function setEventOverride(v: string | null | undefined): void {
  forced = v;
}

/** The event running now, if any, with its start and end. */
export function currentEvent(now: number): { def: WorldEventDef; start: number; end: number } | null {
  // An event an admin started by hand beats the schedule (and test overrides).
  if (manual && now >= manual.start && now < manual.end) {
    const def = WORLD_EVENTS.find((e) => e.id === manual!.id);
    if (def) return { def, start: manual.start, end: manual.end };
  }
  if (forced === 'off') return null;
  if (forced) {
    const def = WORLD_EVENTS.find((e) => e.id === forced);
    return def ? { def, start: now - 60_000, end: now + EVENT_LENGTH_MS } : null;
  }
  const slot = Math.floor(now / EVENT_PERIOD_MS);
  const start = slot * EVENT_PERIOD_MS;
  if (now >= start + EVENT_LENGTH_MS) return null;
  return { def: pick(slot), start, end: start + EVENT_LENGTH_MS };
}

/** The next event to start. */
export function nextEvent(now: number): { def: WorldEventDef; start: number } {
  const slot = Math.floor(now / EVENT_PERIOD_MS) + 1;
  return { def: pick(slot), start: slot * EVENT_PERIOD_MS };
}

/** Multiplier from the active event of a kind (1 when none). */
export function eventMult(kind: WorldEventDef['kind'], now: number): number {
  const e = currentEvent(now);
  return e && e.def.kind === kind ? (e.def.mult ?? 1) : 1;
}
