/** Personal combat-effect settings (this browser only; other players never see your choice). */

export type FxLevel = 'full' | 'light' | 'off';
export type FxStyle = 'weapon' | 'fire' | 'ice' | 'lightning' | 'shadow' | 'holy' | 'nature' | 'rainbow';

export interface FxSettings {
  /** How much is drawn: full (trails, sparks, skills), light (weapon + simple slash), off. */
  level: FxLevel;
  /** Colour of YOUR slashes, arrows and spells. 'weapon' follows the weapon's metal. */
  style: FxStyle;
  /** Draw the equipped weapon in characters' hands. */
  handWeapon: boolean;
  /** Small screen shake on your critical hits. */
  shake: boolean;
  /** Floating damage numbers. */
  numbers: boolean;
}

export const FX_STYLES: { id: FxStyle; label: string }[] = [
  { id: 'weapon', label: 'Match weapon' },
  { id: 'fire', label: 'Fire' },
  { id: 'ice', label: 'Ice' },
  { id: 'lightning', label: 'Lightning' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'holy', label: 'Holy' },
  { id: 'nature', label: 'Nature' },
  { id: 'rainbow', label: 'Rainbow' },
];

const KEY = 'terrago.fx';
const DEFAULTS: FxSettings = { level: 'full', style: 'weapon', handWeapon: true, shake: true, numbers: true };

let current: FxSettings = { ...DEFAULTS };
let loaded = false;
const listeners = new Set<(s: FxSettings) => void>();

export function fxSettings(): FxSettings {
  if (!loaded) {
    loaded = true;
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      if (raw) current = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<FxSettings>) };
    } catch {
      /* storage unavailable: keep defaults */
    }
  }
  return current;
}

export function setFxSettings(patch: Partial<FxSettings>): FxSettings {
  current = { ...fxSettings(), ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l(current);
  return current;
}

export function onFxSettings(fn: (s: FxSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
