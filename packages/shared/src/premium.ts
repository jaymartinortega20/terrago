/**
 * Gems: the premium currency. Bought with real money (PayMongo: GCash, Maya,
 * cards), spent on cosmetics in the Gem Shop, and earned by selling items to
 * other players on the marketplace. Gems never turn back into real money.
 */

export interface GemPack {
  id: string;
  gems: number;
  /** Extra gems on top (shown as a bonus). */
  bonus: number;
  /** Price in Philippine pesos. */
  php: number;
  tag?: string;
}

export const GEM_PACKS: readonly GemPack[] = [
  { id: 'gems_100', gems: 100, bonus: 0, php: 49 },
  { id: 'gems_550', gems: 500, bonus: 50, php: 249 },
  { id: 'gems_1200', gems: 1000, bonus: 200, php: 499, tag: 'Popular' },
  { id: 'gems_2600', gems: 2000, bonus: 600, php: 999 },
  { id: 'gems_7000', gems: 5000, bonus: 2000, php: 2399, tag: 'Best value' },
];

export const getGemPack = (id: unknown) => GEM_PACKS.find((p) => p.id === id);

export type CosmeticKind = 'outfit' | 'mount_style';

export interface PremiumCosmetic {
  id: string;
  kind: CosmeticKind;
  /** Outfit name (OUTFITS) or mount style id (MOUNT_STYLES). */
  ref: string;
  name: string;
  gems: number;
  text: string;
  /** Shown as the swatch colour. */
  color: string;
}

export const PREMIUM_COSMETICS: readonly PremiumCosmetic[] = [
  { id: 'skin_celestial_regalia', kind: 'outfit', ref: 'Celestial Regalia', name: 'Celestial Regalia', gems: 1200, text: 'Starlit robes, a silver crown and a flowing cape.', color: '#9ab8ff' },
  { id: 'skin_dragon_emperor', kind: 'outfit', ref: 'Dragon Emperor', name: 'Dragon Emperor', gems: 1200, text: 'Crimson and gold imperial robes with a crown.', color: '#ffd34a' },
  { id: 'skin_frost_monarch', kind: 'outfit', ref: 'Frost Monarch', name: 'Frost Monarch', gems: 900, text: 'Ice-blue armour fit for the Glacial throne.', color: '#bfeaff' },
  { id: 'skin_golden_paladin', kind: 'outfit', ref: 'Golden Paladin', name: 'Golden Paladin', gems: 900, text: 'Shining gold plate, helmet and cape.', color: '#ffd34a' },
  { id: 'skin_shadow_ronin', kind: 'outfit', ref: 'Shadow Ronin', name: 'Shadow Ronin', gems: 700, text: 'A hooded wanderer in black and violet.', color: '#c04aff' },
  { id: 'skin_sakura_blossom', kind: 'outfit', ref: 'Sakura Blossom', name: 'Sakura Blossom', gems: 700, text: 'Cherry-pink robes and a festival hat.', color: '#ff9ac8' },
  { id: 'mount_barding_dragonscale', kind: 'mount_style', ref: 'barding_dragonscale', name: 'Dragonscale Barding', gems: 500, text: 'Red scale armour for any mount.', color: '#c0302a' },
  { id: 'mount_barding_gilded', kind: 'mount_style', ref: 'barding_gilded', name: 'Gilded Barding', gems: 600, text: 'Gold plate armour for any mount.', color: '#ffd34a' },
  { id: 'mount_saddle_starlight', kind: 'mount_style', ref: 'saddle_starlight', name: 'Starlight Saddle', gems: 300, text: 'A shimmering blue saddle.', color: '#9ab8ff' },
  { id: 'mount_trail_starfall', kind: 'mount_style', ref: 'trail_starfall', name: 'Starfall Trail', gems: 450, text: 'Falling stars behind your mount.', color: '#fff0ff' },
  { id: 'mount_trail_sakura', kind: 'mount_style', ref: 'trail_sakura', name: 'Sakura Trail', gems: 450, text: 'Cherry petals behind your mount.', color: '#ff9ad0' },
];

export const getCosmetic = (id: unknown) => PREMIUM_COSMETICS.find((c) => c.id === id);

/** Marketplace sales for Gems: the game keeps this share (it disappears — keeps Gems valuable). */
export const GEM_MARKET_TAX = 0.1;
export const GEM_MAX_PRICE = 1_000_000;

export interface GemHistoryEntry {
  amount: number;
  balance: number;
  reason: string;
  at: number;
}

export interface GemShopState {
  balance: number;
  /** 'live' (real PayMongo), 'test' (fake checkout for development) or 'off'. */
  payments: 'live' | 'test' | 'off';
  owned: string[];
  history: GemHistoryEntry[];
}
