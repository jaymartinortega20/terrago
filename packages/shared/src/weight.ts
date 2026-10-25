/**
 * Carry weight: everything in your bag weighs something; STR raises how much
 * you can carry. Over the limit you slow down (never stuck).
 */

const BY_CATEGORY: Record<string, number> = {
  weapon: 3,
  armor: 4,
  tool: 2,
  mount: 0,
  cosmetic: 0.1,
  quest: 0,
  material: 0.05,
  crop: 0.05,
  seed: 0.02,
  fish: 0.2,
  consumable: 0.1,
  animal: 5,
};

export function itemWeight(def: { category: string; weight?: number } | undefined): number {
  if (!def) return 0;
  return def.weight ?? BY_CATEGORY[def.category] ?? 0.1;
}

/** How much a character can carry. */
export function carryLimit(strength: number): number {
  return Math.round(200 + strength * 8);
}

/** Movement multiplier for a load: full speed up to the limit, slower beyond. */
export function weightSpeed(load: number, limit: number): number {
  if (load <= limit) return 1;
  return load <= limit * 1.5 ? 0.8 : 0.6;
}

export function bagWeight(slots: { itemId: string; quantity: number }[], lookup: (id: string) => { category: string; weight?: number } | undefined): number {
  let w = 0;
  for (const s of slots) w += itemWeight(lookup(s.itemId)) * s.quantity;
  return Math.round(w * 10) / 10;
}
