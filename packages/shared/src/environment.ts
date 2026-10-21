import { SEASONS, type Season } from './farming';
import { dayFraction } from './gathering';

/**
 * Time of day, seasons and weather — all pure functions of the clock, so the
 * server and every client agree without sending anything.
 */

/** Each season lasts one real week; a year is four weeks. */
export const SEASON_MS = 7 * 24 * 60 * 60_000;
/** Spring began on Monday 5 October 2026 (UTC), so the season changes every Monday. */
const SEASON_ANCHOR = Date.UTC(2026, 9, 5);

export function seasonAt(now: number): Season {
  const i = Math.floor((now - SEASON_ANCHOR) / SEASON_MS);
  return SEASONS[((i % 4) + 4) % 4]!;
}

/** When the current season ends (ms since epoch). */
export function seasonEndsAt(now: number): number {
  const i = Math.floor((now - SEASON_ANCHOR) / SEASON_MS);
  return SEASON_ANCHOR + (i + 1) * SEASON_MS;
}

/** In-season crops grow this much faster. */
export const IN_SEASON_SPEED = 1.25;

export function seasonSpeed(seasons: readonly Season[], now: number): number {
  return seasons.includes(seasonAt(now)) ? IN_SEASON_SPEED : 1;
}

export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'] as const;
export type Weather = (typeof WEATHERS)[number];

/** Weather changes every 12 real minutes. */
export const WEATHER_BLOCK_MS = 12 * 60_000;

type Region = 'valley' | 'peaks' | 'mire';

/** Which weather region a map theme belongs to; indoor maps have none. */
export function weatherRegion(theme: string | undefined): Region | null {
  if (!theme || theme === 'cave' || theme === 'ruins' || theme === 'volcano') return null;
  if (theme === 'snow' || theme === 'peak') return 'peaks';
  if (theme === 'swamp') return 'mire';
  return 'valley';
}

const TABLES: Record<Region, Record<Season, Partial<Record<Weather, number>>>> = {
  valley: {
    spring: { clear: 4, cloudy: 2, rain: 3, fog: 1 },
    summer: { clear: 6, cloudy: 2, rain: 1, storm: 1 },
    autumn: { clear: 3, cloudy: 3, rain: 3, fog: 2, storm: 1 },
    winter: { clear: 3, cloudy: 3, snow: 4, fog: 1 },
  },
  peaks: {
    spring: { clear: 3, cloudy: 3, snow: 3, fog: 1 },
    summer: { clear: 5, cloudy: 3, snow: 1, fog: 1 },
    autumn: { clear: 2, cloudy: 3, snow: 4, fog: 2 },
    winter: { clear: 1, cloudy: 2, snow: 6, fog: 2 },
  },
  mire: {
    spring: { cloudy: 3, rain: 4, fog: 4, storm: 1 },
    summer: { clear: 2, cloudy: 2, rain: 3, fog: 3, storm: 2 },
    autumn: { cloudy: 3, rain: 4, fog: 4, storm: 1 },
    winter: { cloudy: 3, fog: 5, rain: 2, snow: 1 },
  },
};

function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function weatherAt(theme: string | undefined, now: number): Weather {
  const region = weatherRegion(theme);
  if (!region) return 'clear';
  const block = Math.floor(now / WEATHER_BLOCK_MS);
  const table = TABLES[region][seasonAt(now)];
  const total = Object.values(table).reduce((n, w) => n + (w ?? 0), 0);
  let pick = hash(block, region.length * 7919 + region.charCodeAt(0)) * total;
  for (const [w, weight] of Object.entries(table)) if ((pick -= weight ?? 0) < 0) return w as Weather;
  return 'clear';
}

export const isWet = (w: Weather) => w === 'rain' || w === 'storm';

/** How dark it is outdoors (0 = bright day, ~0.6 = deep night). */
export function darknessAt(now: number): number {
  const f = dayFraction(now);
  if (f < 0.12) return 0.32 * (1 - f / 0.12); // dawn brightening
  if (f < 0.55) return 0;
  if (f < 0.7) return ((f - 0.55) / 0.15) * 0.5; // dusk
  if (f < 0.94) return 0.58;
  return 0.58 - ((f - 0.94) / 0.06) * 0.26; // before dawn
}

export const WEATHER_LABEL: Record<Weather, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow' };
export const WEATHER_ICON: Record<Weather, string> = { clear: '☀', cloudy: '☁', rain: '🌧', storm: '⛈', fog: '🌫', snow: '❄' };
