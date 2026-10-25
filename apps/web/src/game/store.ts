import { useSyncExternalStore } from 'react';
import type { ChatMessage, DialogueResult, InventoryState, SelfState, ShopView } from '@terrago/shared';

/** Minimal observable store shared by the Phaser scene and the React HUD. */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}

  get = (): T => this.state;

  set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const k in next) if (!Object.is(next[k], this.state[k])) changed = true;
    if (!changed) return;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function useStore<T extends object, S>(store: Store<T>, select: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}

export type Panel = 'inventory' | 'character' | 'skills' | 'quests' | 'map' | 'settings' | 'shop' | 'farm' | 'repair' | 'craft' | 'lift' | 'enhance' | 'market' | 'friends' | 'guild' | 'journal' | 'crafting' | 'bank' | 'travel' | 'stall' | 'animals' | 'dungeon' | 'job' | 'stable' | 'pets' | null;
export type ConnStatus = 'connecting' | 'online' | 'reconnecting' | 'ended' | 'error';

export interface Notice {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface UiState {
  status: ConnStatus;
  statusMessage: string | null;
  self: SelfState | null;
  mapId: string | null;
  mapName: string;
  /** Owner of the instanced map you're in (your homestead), else null. */
  mapOwnerId: string | null;
  inventory: InventoryState | null;
  chat: ChatMessage[];
  dialogue: DialogueResult | null;
  notices: Notice[];
  /** Small side feed for routine rewards. */
  feed: Notice[];
  panel: Panel;
  chatFocused: boolean;
  /** Emote picker open. */
  emoteMenu: boolean;
  ping: number | null;
  nearby: number;
  interactHint: string | null;
  /** What the action key would do right now (e.g. "Till", "Harvest Carrot"). */
  actionHint: string | null;
  tile: { x: number; y: number };
  /** Selected hotbar slot (0-8): which seed to plant, which food to eat... */
  selectedSlot: number;
  /** NPC whose service panel (shop, farm, repair) is open. */
  serviceNpc: string | null;
  shop: ShopView | null;
  /** Plot whose detail menu is open (fertilize / remove). */
  plotMenu: string | null;
  /** Crafting station whose recipes are open. */
  station: string | null;
  /** Selected monster (or player) and whether we're auto-attacking it. */
  targetId: string | null;
  autoAttack: boolean;
  /** Active buffs/debuffs and skill cooldown end times. */
  effects: { id: string; name: string; until: number }[];
  cooldowns: Record<string, number>;
  quests: import('@terrago/shared').QuestState[];
  duel: { id: string; name: string; until: number } | null;
  /** Quest offer / reward windows. */
  questOffer: { questId: string; npcId: string } | null;
  questReward: { questId: string; gold: number; xp: number; items: { itemId: string; quantity: number }[] } | null;
  /** Direct trade window, a pending invite, and the clicked-player menu. */
  trade: import('@terrago/shared').TradeView | null;
  tradeInvite: { id: string; name: string } | null;
  playerMenu: { id: string; name: string } | null;
  /** Social state pushed by the server. */
  party: import('@terrago/shared').PartyView | null;
  friends: import('@terrago/shared').FriendsView | null;
  guild: import('@terrago/shared').GuildView | null;
  invites: import('@terrago/shared').InvitePayload[];
  profile: import('@terrago/shared').PlayerProfile | null;
  journal: import('@terrago/shared').JournalView | null;
  /** Another player's stall being browsed. */
  stallView: import('@terrago/shared').StallView | null;
  /** Dungeon whose gate window is open. */
  dungeonGate: string | null;
  /** Bumped when the animal list changes. */
  animalsVersion: number;
  /** Name of your own open stall. */
  stallOpenName: string | null;
  /** Today's login reward is waiting. */
  dailyReady: boolean;
  achievementToast: { id: string; name: string; icon: string; gold: number } | null;
  announcement: string | null;
  /** Text to put in the chat box (e.g. "/w Name "). */
  chatDraft: string | null;
  /** Fishing in progress. */
  fishing: null | { id: string; x: number; y: number; phase: 'waiting' | 'bite' | 'reeling'; round: import('@terrago/shared').FishingRound | null };
  /** Your active companion's growth and health. */
  pet: import('@terrago/shared').PetView | null;
  /** AUTO: keep fighting whatever monster is in reach. */
  autoHunt: boolean;
}

export const initialUi: UiState = {
  status: 'connecting',
  statusMessage: null,
  self: null,
  mapId: null,
  mapName: '',
  mapOwnerId: null,
  inventory: null,
  chat: [],
  dialogue: null,
  notices: [],
  feed: [],
  panel: null,
  chatFocused: false,
  emoteMenu: false,
  ping: null,
  nearby: 0,
  interactHint: null,
  actionHint: null,
  tile: { x: 0, y: 0 },
  selectedSlot: 0,
  serviceNpc: null,
  shop: null,
  plotMenu: null,
  station: null,
  fishing: null,
  pet: null,
  autoHunt: false,
  targetId: null,
  autoAttack: false,
  effects: [],
  cooldowns: {},
  quests: [],
  duel: null,
  questOffer: null,
  questReward: null,
  trade: null,
  tradeInvite: null,
  playerMenu: null,
  party: null,
  friends: null,
  guild: null,
  invites: [],
  profile: null,
  chatDraft: null,
  journal: null,
  stallView: null,
  stallOpenName: null,
  animalsVersion: 0,
  dungeonGate: null,
  dailyReady: false,
  achievementToast: null,
  announcement: null,
};

let noticeId = 0;
/**
 * Routine rewards (kills, loot, gathering, daily-task progress) go to a small
 * feed at the side so they never cover the fight; everything else (errors,
 * level-ups, warnings) shows in the centre, at most two at a time.
 */
const FEED = /defeated:|^\+\d|bag is full|loot was left|harvested|you caught|picked up|daily task done|gathered|mined|chopped|pet exp|reached level \d+!.*growth/i;

export function pushNotice(store: Store<UiState>, kind: Notice['kind'], text: string, ms = 3500): void {
  const id = ++noticeId;
  if (kind !== 'error' && FEED.test(text)) {
    store.set((s) => ({ feed: [...s.feed.slice(-4), { id, kind, text }] }));
    setTimeout(() => store.set((s) => ({ feed: s.feed.filter((n) => n.id !== id) })), 4500);
    return;
  }
  // The same message again just restarts its timer instead of stacking.
  store.set((s) => ({ notices: [...s.notices.filter((n) => n.text !== text).slice(-1), { id, kind, text }] }));
  setTimeout(() => store.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })), Math.min(ms, 3000));
}
