/** Rebindable action keys (this browser only). Movement stays on WASD / arrows. */

export const ACTIONS = [
  { id: 'inventory', label: 'Inventory', key: 'i' },
  { id: 'character', label: 'Character', key: 'c' },
  { id: 'skills', label: 'Skills', key: 'k' },
  { id: 'quests', label: 'Quests', key: 'j' },
  { id: 'map', label: 'Map', key: 'm' },
  { id: 'journal', label: 'Journal', key: 'l' },
  { id: 'crafting', label: 'Crafting', key: 'n' },
  { id: 'market', label: 'Market', key: 'p' },
  { id: 'guild', label: 'Guild', key: 'g' },
  { id: 'friends', label: 'Friends', key: 'o' },
  { id: 'pets', label: 'Pets', key: 'u' },
  { id: 'attack', label: 'Attack', key: 'f' },
  { id: 'mount', label: 'Mount / dismount', key: 'z' },
  { id: 'emotes', label: 'Emotes', key: 'y' },
  { id: 'skill1', label: 'Skill 1', key: 'q' },
  { id: 'skill2', label: 'Skill 2', key: 'r' },
  { id: 'skill3', label: 'Skill 3', key: 't' },
  { id: 'skill4', label: 'Skill 4', key: 'x' },
  { id: 'skill5', label: 'Skill 5', key: 'v' },
  { id: 'skill6', label: 'Skill 6', key: 'h' },
] as const;

export type ActionId = (typeof ACTIONS)[number]['id'];

/** Keys the game already uses for movement and fixed actions. */
export const RESERVED = new Set(['w', 'a', 's', 'd', 'e', ' ', 'enter', 'escape', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

const KEY = 'terrago.keys';
let binds: Record<string, string> | null = null;
const listeners = new Set<() => void>();

function load(): Record<string, string> {
  if (binds) return binds;
  binds = Object.fromEntries(ACTIONS.map((a) => [a.id, a.key]));
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) Object.assign(binds, JSON.parse(raw));
  } catch {
    /* defaults */
  }
  return binds;
}

export function keyFor(id: ActionId): string {
  return load()[id] ?? '';
}

export function actionForKey(key: string): ActionId | null {
  const b = load();
  const k = key.toLowerCase();
  return (Object.keys(b).find((id) => b[id] === k) as ActionId | undefined) ?? null;
}

/** Bind a key; if another action had it, they swap. */
export function setKey(id: ActionId, key: string): void {
  const b = load();
  const k = key.toLowerCase();
  const other = Object.keys(b).find((x) => b[x] === k);
  if (other && other !== id) b[other] = b[id]!;
  b[id] = k;
  save();
}

export function resetKeys(): void {
  binds = Object.fromEntries(ACTIONS.map((a) => [a.id, a.key]));
  save();
}

function save(): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(binds));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function onKeysChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const keyLabel = (k: string) => (k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1));
