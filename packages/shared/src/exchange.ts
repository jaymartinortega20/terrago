/**
 * Activity currencies and what they buy. Each activity pays its own currency,
 * so there's a reason to do each one: arena matches pay Arena Tokens (cosmetics
 * to show off), bounties pay Bounty Seals (progression items), and the Endless
 * Rift pays Rift Shards (its own look). They're bound to the character.
 */

export type ExchangeId = 'arena' | 'bounty' | 'rift';

export interface ExchangeOffer {
  id: string;
  label: string;
  text: string;
  cost: number;
  give: { kind: 'item'; itemId: string; quantity: number } | { kind: 'mount_style'; ref: string } | { kind: 'outfit'; ref: string };
}

export interface ExchangeDef {
  id: ExchangeId;
  name: string;
  currency: string;
  currencyName: string;
  offers: ExchangeOffer[];
}

export const EXCHANGES: Record<ExchangeId, ExchangeDef> = {
  arena: {
    id: 'arena',
    name: 'Arena Quartermaster',
    currency: 'arena_token',
    currencyName: 'Arena Tokens',
    offers: [
      { id: 'ar_outfit', label: 'Arena Champion outfit', text: 'Crimson plate and a gold-trimmed cape.', cost: 60, give: { kind: 'outfit', ref: 'Arena Champion' } },
      { id: 'ar_barding', label: "Champion's Barding", text: 'Mount armour in arena colours.', cost: 40, give: { kind: 'mount_style', ref: 'barding_champion' } },
      { id: 'ar_trail', label: 'Victory Trail', text: 'Golden sparks behind your mount.', cost: 30, give: { kind: 'mount_style', ref: 'trail_victory' } },
      { id: 'ar_food', label: "3× Hunter's Feast", text: 'Food for long fights.', cost: 6, give: { kind: 'item', itemId: 'hunters_feast', quantity: 3 } },
      { id: 'ar_potions', label: '5× Greater Health Potion', text: 'Top-ups between rounds.', cost: 5, give: { kind: 'item', itemId: 'greater_health_potion', quantity: 5 } },
    ],
  },
  bounty: {
    id: 'bounty',
    name: 'Seal Exchange',
    currency: 'bounty_seal',
    currencyName: 'Bounty Seals',
    offers: [
      { id: 'bs_stone', label: 'Enhancement Stone', text: 'For upgrades and stat re-rolls.', cost: 3, give: { kind: 'item', itemId: 'enhancement_stone', quantity: 1 } },
      { id: 'bs_evo', label: 'Evolution Stone', text: 'Evolves a pet at level 30 and 60.', cost: 25, give: { kind: 'item', itemId: 'evolution_stone', quantity: 1 } },
      { id: 'bs_bag', label: 'Bag Expansion', text: '+10 bag slots.', cost: 12, give: { kind: 'item', itemId: 'bag_expansion', quantity: 1 } },
      { id: 'bs_treat', label: '3× Premium Pet Treat', text: 'Lots of Pet EXP and loyalty.', cost: 4, give: { kind: 'item', itemId: 'premium_pet_treat', quantity: 3 } },
    ],
  },
  rift: {
    id: 'rift',
    name: 'Rift Keeper',
    currency: 'rift_shard',
    currencyName: 'Rift Shards',
    offers: [
      { id: 'rf_outfit', label: 'Rift Walker outfit', text: 'Hooded robes that shimmer with rift light.', cost: 80, give: { kind: 'outfit', ref: 'Rift Walker' } },
      { id: 'rf_saddle', label: 'Riftbound Saddle', text: 'A saddle stitched from the void.', cost: 40, give: { kind: 'mount_style', ref: 'saddle_rift' } },
      { id: 'rf_stone', label: '2× Enhancement Stone', text: 'For upgrades and re-rolls.', cost: 5, give: { kind: 'item', itemId: 'enhancement_stone', quantity: 2 } },
      { id: 'rf_evo', label: 'Evolution Stone', text: 'Evolves a pet.', cost: 30, give: { kind: 'item', itemId: 'evolution_stone', quantity: 1 } },
    ],
  },
};

export interface ExchangeView {
  def: ExchangeDef;
  balance: number;
  /** Offers already owned (cosmetics can only be bought once). */
  owned: string[];
}
