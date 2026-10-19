/**
 * Farming rules shared by client (display) and server (authority).
 *
 * Crops never run timers. A plot stores how much growth it had at
 * `progressAt` and until when its soil is wet (`waterUntil`). Growth only
 * advances while the soil is wet, so the current state is a pure function of
 * the stored numbers and the current time — correct after logouts, server
 * restarts and days offline.
 */

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export interface CropDef {
  id: string;
  name: string;
  seedItem: string;
  produceItem: string;
  /** Watered time needed from planting to harvest (ms). */
  growthMs: number;
  /** After harvest, regrowing crops go back this many ms (null = plot is cleared). */
  regrowMs: number | null;
  /** Regrowing crops are spent after this many harvests. */
  harvestsMax: number | null;
  levelRequired: number;
  /** Farming XP per harvest. */
  xp: number;
  /** Produce per harvest: [min, max]. */
  yield: [number, number];
  /** Base probabilities for normal / silver / gold / diamond / legendary. */
  quality: [number, number, number, number, number];
  seasons: Season[];
  /** Art colours for the client. */
  art: { leaf: string; fruit: string; shape: 'root' | 'bush' | 'stalk' | 'vine' | 'flower' | 'grain' };
}

export interface CropState {
  cropId: string;
  /** Growth already accumulated at `progressAt` (ms of watered time × speed). */
  growthDone: number;
  progressAt: number;
  /** Soil stays wet until this time (ms since epoch). */
  waterUntil: number;
  /** Growth speed multiplier (fertiliser). */
  speed: number;
  fertilizer: string | null;
  harvests: number;
}

export interface PlotState {
  index: number;
  tilled: boolean;
  /** Soil is wet until this time (also mirrored in crop.waterUntil while a crop grows). */
  wetUntil: number;
  crop: CropState | null;
}

export const CROP_STAGES = 4;

/** Growth accumulated by `now`. Only wet time counts. */
export function cropGrowth(c: CropState, def: CropDef, now: number): number {
  const wetEnd = Math.min(now, c.waterUntil);
  const wet = Math.max(0, wetEnd - c.progressAt);
  return Math.min(def.growthMs, c.growthDone + wet * c.speed);
}

export interface CropStatus {
  /** 0 .. CROP_STAGES-1 (last stage = ready). */
  stage: number;
  ready: boolean;
  watered: boolean;
  /** 0..1 */
  progress: number;
  /** Time until ready if the soil stays wet; null when ready. */
  remainingMs: number | null;
  /** True if the soil will dry out before the crop is ready. */
  needsWaterSoon: boolean;
}

export function cropStatus(c: CropState, def: CropDef, now: number): CropStatus {
  const g = cropGrowth(c, def, now);
  const progress = def.growthMs > 0 ? g / def.growthMs : 1;
  const ready = g >= def.growthMs;
  const watered = c.waterUntil > now;
  const stage = ready ? CROP_STAGES - 1 : Math.min(CROP_STAGES - 2, Math.floor(progress * (CROP_STAGES - 1)));
  const remainingMs = ready ? null : Math.ceil((def.growthMs - g) / c.speed);
  const needsWaterSoon = !ready && (!watered || c.waterUntil - now < (remainingMs ?? 0));
  return { stage, ready, watered, progress, remainingMs, needsWaterSoon };
}

/** Settle growth to `now` and wet the soil for `waterMs`. */
export function waterCrop(c: CropState, def: CropDef, now: number, waterMs: number): CropState {
  return { ...c, growthDone: cropGrowth(c, def, now), progressAt: now, waterUntil: Math.max(c.waterUntil, now + waterMs) };
}

/** After a harvest: regrowing crops roll back to an earlier stage, others are removed. */
export function afterHarvest(c: CropState, def: CropDef, now: number): CropState | null {
  if (def.regrowMs === null) return null;
  if (def.harvestsMax !== null && c.harvests + 1 >= def.harvestsMax) return null;
  return {
    ...c,
    growthDone: Math.max(0, def.growthMs - def.regrowMs),
    progressAt: now,
    harvests: c.harvests + 1,
  };
}

/**
 * Roll a quality index. Each Farming level above the crop's requirement shifts
 * 1.5% of probability up a tier (capped); quality fertiliser adds a flat bonus.
 */
export function rollQuality(
  base: readonly number[],
  skillLevel: number,
  levelRequired: number,
  bonus: number,
  rand: () => number,
): number {
  const p = [...base];
  const shift = Math.min(0.45, Math.max(0, skillLevel - levelRequired) * 0.015 + bonus);
  // Move probability mass from "normal" upwards, weighted towards the next tier.
  const moved = Math.min(p[0]!, shift);
  p[0] = p[0]! - moved;
  p[1] = p[1]! + moved * 0.62;
  p[2] = p[2]! + moved * 0.28;
  p[3] = p[3]! + moved * 0.08;
  p[4] = p[4]! + moved * 0.02;
  const total = p.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < p.length; i++) {
    r -= p[i]!;
    if (r < 0) return i;
  }
  return 0;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60 ? `${s % 60}s` : ''}`.trim();
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
}
