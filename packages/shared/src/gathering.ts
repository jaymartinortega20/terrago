import type { SkillId } from './skills';
import type { ToolKind } from './types';
import type { StationType } from './map';

/**
 * Gathering, fishing and crafting rules shared by client and server.
 */

export interface DropDef {
  itemId: string;
  chance: number;
  min: number;
  max: number;
}

export interface NodeDef {
  id: string;
  name: string;
  skill: SkillId;
  /** null = gathered by hand. */
  tool: ToolKind | null;
  toolTier: number;
  level: number;
  /** Successful gathers before the node is depleted. */
  yields: number;
  respawnMs: number;
  xp: number;
  energy: number;
  drops: DropDef[];
  art: { kind: 'rock' | 'crystal' | 'tree' | 'grass' | 'herb' | 'bush' | 'mushroom'; color: string };
  solid: boolean;
}

export interface FishDef {
  itemId: string;
  level: number;
  /** 1..100: how hard the fish fights in the reeling minigame. */
  difficulty: number;
  xp: number;
  tables: string[];
  time?: TimeOfDay[];
  weight: number;
}

export interface RecipeDef {
  id: string;
  station: StationType;
  skill: SkillId;
  level: number;
  xp: number;
  /** Gold fee per craft (a gold sink). */
  fee: number;
  inputs: { itemId: string; quantity: number }[];
  output: { itemId: string; quantity: number };
}

/** Node state as a world object: depleted until a timestamp. */
export interface NodeObject {
  kind: 'node';
  id: string;
  x: number;
  y: number;
  type: string;
  depletedUntil: number;
}

/**
 * Chance that one swing / pull succeeds. Higher skill and better tools help;
 * nodes far above your level are refused before this is used.
 */
export function gatherChance(level: number, reqLevel: number, toolTier: number, reqTier: number): number {
  const c = 0.42 + (level - reqLevel) * 0.025 + (toolTier - reqTier) * 0.12;
  return Math.max(0.25, Math.min(0.95, c));
}

// ---------------------------------------------------------------------------
// Game clock (time of day)
// ---------------------------------------------------------------------------

export const TIMES_OF_DAY = ['morning', 'day', 'evening', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** One in-game day lasts this long in real time. */
export const GAME_DAY_MS = 40 * 60_000;

/** 0..1 through the in-game day (0 = 6:00 morning). */
export function dayFraction(now: number): number {
  return (((now % GAME_DAY_MS) + GAME_DAY_MS) % GAME_DAY_MS) / GAME_DAY_MS;
}

export function timeOfDay(now: number): TimeOfDay {
  const f = dayFraction(now);
  if (f < 0.2) return 'morning';
  if (f < 0.55) return 'day';
  if (f < 0.7) return 'evening';
  return 'night';
}

/** Clock text like "14:20" (day starts at 6:00). */
export function clockText(now: number): string {
  const mins = Math.floor((dayFraction(now) * 24 * 60 + 6 * 60) % (24 * 60));
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Fishing minigame (deterministic, so the server can verify the client's play)
// ---------------------------------------------------------------------------

export interface FishingParams {
  seed: number;
  /** 1..100 */
  difficulty: number;
  /** Catch zone height as a fraction of the bar (rod tier and Fishing level). */
  zone: number;
  /** Hard time limit in 50 ms steps. */
  maxSteps: number;
}

export interface FishingState {
  step: number;
  /** Bottom of the catch zone, 0..1 */
  zonePos: number;
  zoneVel: number;
  /** Fish position, 0..1 */
  fishPos: number;
  fishTarget: number;
  /** 0..1 — caught at 1, escaped at 0. */
  progress: number;
  /** How hard the line is pulling (0..1), for display. */
  tension: number;
  done: null | 'caught' | 'escaped';
  rng: number;
}

export const FISHING_STEP_MS = 50;

function nextRand(s: FishingState): number {
  // Park–Miller LCG: deterministic and identical in every JS engine.
  s.rng = (s.rng * 48271) % 2147483647;
  return (s.rng - 1) / 2147483646;
}

export function fishingStart(p: FishingParams): FishingState {
  const s: FishingState = { step: 0, zonePos: 0, zoneVel: 0, fishPos: 0.3, fishTarget: 0.5, progress: 0.3, tension: 0, done: null, rng: (p.seed % 2147483646) + 1 };
  s.fishTarget = 0.2 + nextRand(s) * 0.6;
  return s;
}

/** Advance one 50 ms step. `holding` = the player is holding the reel button. */
export function fishingStep(p: FishingParams, s: FishingState, holding: boolean): void {
  if (s.done) return;
  const d = p.difficulty / 100;
  // Player's zone: holding accelerates it up, letting go lets it sink.
  s.zoneVel += holding ? 0.0042 : -0.0036;
  s.zoneVel = Math.max(-0.05, Math.min(0.05, s.zoneVel * 0.93));
  s.zonePos += s.zoneVel;
  const top = 1 - p.zone;
  if (s.zonePos < 0) {
    s.zonePos = 0;
    s.zoneVel = Math.max(0, s.zoneVel) * 0.3;
  } else if (s.zonePos > top) {
    s.zonePos = top;
    s.zoneVel = Math.min(0, s.zoneVel) * 0.3;
  }
  // The fish darts between targets; harder fish change their mind more often and move faster.
  if (nextRand(s) < 0.02 + d * 0.035 || Math.abs(s.fishTarget - s.fishPos) < 0.01) s.fishTarget = nextRand(s);
  const speed = 0.004 + d * 0.012;
  const delta = s.fishTarget - s.fishPos;
  s.fishPos += Math.sign(delta) * Math.min(Math.abs(delta), speed * (0.6 + nextRand(s) * 0.8));
  s.fishPos = Math.max(0, Math.min(1, s.fishPos));

  const inZone = s.fishPos >= s.zonePos && s.fishPos <= s.zonePos + p.zone;
  s.progress += inZone ? 0.011 : -(0.004 + d * 0.006);
  const dist = inZone ? 0 : Math.min(Math.abs(s.fishPos - s.zonePos), Math.abs(s.fishPos - (s.zonePos + p.zone)));
  s.tension = Math.min(1, s.tension * 0.85 + dist * 0.6);
  s.step++;
  if (s.progress >= 1) {
    s.progress = 1;
    s.done = 'caught';
  } else if (s.progress <= 0 || s.step >= p.maxSteps) {
    s.progress = Math.max(0, s.progress);
    s.done = 'escaped';
  }
}

/**
 * Replay a whole round from the player's input timeline. `toggles` are the
 * step numbers at which the reel button flipped (starting released).
 */
export function simulateFishing(p: FishingParams, toggles: number[], untilStep = p.maxSteps): FishingState {
  const s = fishingStart(p);
  let holding = false;
  let t = 0;
  while (!s.done && s.step < untilStep) {
    while (t < toggles.length && toggles[t]! <= s.step) {
      holding = !holding;
      t++;
    }
    fishingStep(p, s, holding);
  }
  return s;
}

/** Catch-zone size for a rod tier and Fishing level. */
export function fishingZone(rodTier: number, fishingLevel: number): number {
  return Math.min(0.42, 0.2 + rodTier * 0.035 + fishingLevel * 0.0015);
}
