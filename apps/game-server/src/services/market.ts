import { BALANCE, getItem } from '@terrago/game-data';
import { addItem, removeFromSlot, type SlotItem, type MarketListing, type MarketQuery, type TradeOfferItem } from '@terrago/shared';
import { GameError, withTransaction, type Pool, type Tx } from '../db';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { changeGold, logItemMovement } from './ledger';

/**
 * Player marketplace and direct trades.
 *
 * Listing puts the item in escrow (it leaves the seller's bag and lives on
 * the listing row). A purchase runs in one transaction:
 *   lock listing → check it's still for sale → lock both characters (in id
 *   order, so concurrent trades can't deadlock) → debit buyer → credit seller
 *   minus tax → give the item → mark sold → write the logs → commit.
 * If anything fails, nothing happens. A listing can only be sold once.
 */

type Inv = ReturnType<typeof toState>;
const M = () => BALANCE.market;

function rowToListing(r: Record<string, any>, me?: string): MarketListing {
  return {
    id: Number(r.id),
    sellerName: r.seller_name,
    itemId: r.item_id,
    quantity: r.quantity,
    quality: r.quality,
    enhance: r.enhance,
    durability: r.durability,
    ...(r.affixes?.length ? { affixes: r.affixes } : {}),
    unitPrice: Number(r.unit_price),
    category: r.category,
    rarity: r.rarity,
    createdAt: new Date(r.created_at).getTime(),
    expiresAt: new Date(r.expires_at).getTime(),
    status: r.status,
    ...(me && r.seller_id === me ? { mine: true } : {}),
  };
}

export function listingFee(total: number): number {
  return Math.max(M().listingFeeMin, Math.ceil(total * M().listingFeeRate));
}

export function marketTax(total: number): number {
  return Math.ceil(total * M().taxRate);
}

export async function searchMarket(pool: Pool, q: MarketQuery, me: string): Promise<{ listings: MarketListing[]; total: number }> {
  const where = ["l.status = 'active'", 'l.expires_at > now()'];
  const args: unknown[] = [];
  if (typeof q.search === 'string' && q.search.trim()) {
    args.push(`%${q.search.trim().toLowerCase().replace(/[%_\\]/g, '').slice(0, 40)}%`);
    where.push(`lower(l.item_name) LIKE $${args.length}`);
  }
  if (typeof q.category === 'string' && q.category) {
    args.push(q.category.slice(0, 20));
    where.push(`l.category = $${args.length}`);
  }
  if (typeof q.rarity === 'string' && q.rarity) {
    args.push(q.rarity.slice(0, 20));
    where.push(`l.rarity = $${args.length}`);
  }
  const order = q.sort === 'price_desc' ? 'l.unit_price DESC' : q.sort === 'newest' ? 'l.created_at DESC' : 'l.unit_price ASC';
  const page = Number.isInteger(q.page) && (q.page as number) >= 0 ? Math.min(q.page as number, 200) : 0;
  const sql = `SELECT l.*, c.name AS seller_name, count(*) OVER () AS total
                 FROM marketplace_listings l JOIN characters c ON c.id = l.seller_id
                WHERE ${where.join(' AND ')} ORDER BY ${order}, l.id LIMIT 40 OFFSET ${page * 40}`;
  const { rows } = await pool.query(sql, args);
  return { listings: rows.map((r) => rowToListing(r, me)), total: Number(rows[0]?.total ?? 0) };
}

export async function myListings(pool: Pool, me: string): Promise<MarketListing[]> {
  const { rows } = await pool.query(
    `SELECT l.*, c.name AS seller_name FROM marketplace_listings l JOIN characters c ON c.id = l.seller_id
      WHERE l.seller_id = $1 AND (l.status = 'active' OR l.closed_at > now() - interval '7 days')
      ORDER BY l.status = 'active' DESC, l.created_at DESC LIMIT 60`,
    [me],
  );
  return rows.map((r) => rowToListing(r, me));
}

export async function createListing(pool: Pool, sellerId: string, slot: unknown, quantity: unknown, unitPrice: unknown): Promise<{ message: string; inventory: Inv }> {
  if (!Number.isInteger(slot) || !Number.isInteger(quantity) || (quantity as number) < 1) throw new GameError('Invalid amount.');
  if (!Number.isInteger(unitPrice) || (unitPrice as number) < 1 || (unitPrice as number) > M().maxPrice) throw new GameError('Set a price between 1 and 100,000,000 Gold.');
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, sellerId);
    const active = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM marketplace_listings WHERE seller_id = $1 AND status = 'active'`, [sellerId]);
    if ((active.rows[0]?.n ?? 0) >= M().maxListings) throw new GameError(`You can have at most ${M().maxListings} listings.`);
    const { capacity, slots } = await loadSlots(tx, sellerId);
    const s = slots[slot as number];
    if (!s) throw new GameError('That slot is empty.');
    const def = getItem(s.itemId)!;
    if (!def.tradable || s.bound) throw new GameError(`${def.name} is bound to you and can't be sold to players.`);
    const qty = quantity as number;
    if (qty > s.quantity) throw new GameError('You don\'t have that many.');
    const total = qty * (unitPrice as number);
    const fee = listingFee(total);
    const { after } = await changeGold(tx, sellerId, -fee, 'marketplace_fee');
    const res = removeFromSlot(slots, slot as number, qty);
    if (!res.ok) throw new GameError(res.error);
    await writeSlots(tx, sellerId, res.slots, [slot as number]);
    const ins = await tx.query<{ id: number }>(
      `INSERT INTO marketplace_listings (seller_id, item_id, quantity, quality, durability, enhance, unit_price, category, rarity, item_name, expires_at, affixes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(hours => $11), $12) RETURNING id`,
      [sellerId, s.itemId, qty, s.quality, s.durability, s.enhance ?? 0, unitPrice, def.category, def.rarity, def.name, M().durationHours, s.affixes?.length ? JSON.stringify(s.affixes) : null],
    );
    await logItemMovement(tx, { itemId: s.itemId, quantity: qty, quality: s.quality, from: sellerId, reason: 'marketplace', ref: { type: 'listing', id: String(ins.rows[0]!.id) } });
    return { message: `Listed ${qty}× ${def.name} for ${total.toLocaleString()} Gold (fee ${fee}).`, inventory: toState(capacity, after, res.slots) };
  });
}

/** Lock two characters in a fixed order so concurrent trades can't deadlock. */
async function lockPair(tx: Tx, a: string, b: string): Promise<void> {
  for (const id of [a, b].sort()) await lockCharacter(tx, id);
}

export async function buyListing(pool: Pool, buyerId: string, listingId: unknown): Promise<{ message: string; inventory: Inv; sellerId: string; sellerGold: number; net: number; itemName: string; qty: number }> {
  if (!Number.isInteger(listingId)) throw new GameError('Unknown listing.');
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM marketplace_listings WHERE id = $1 FOR UPDATE', [listingId]);
    const l = rows[0];
    if (!l || l.status !== 'active' || new Date(l.expires_at).getTime() <= Date.now()) throw new GameError('That listing is no longer available.');
    if (l.seller_id === buyerId) throw new GameError("That's your own listing.");
    await lockPair(tx, buyerId, l.seller_id);
    const total = Number(l.unit_price) * l.quantity;
    const tax = marketTax(total);
    const def = getItem(l.item_id)!;
    const { capacity, slots } = await loadSlots(tx, buyerId);
    const res = addItem(slots, { itemId: l.item_id, quality: l.quality, durability: l.durability, bound: false, enhance: l.enhance, ...(l.affixes?.length ? { affixes: l.affixes } : {}) }, l.quantity, def.stackSize);
    if (!res.ok) throw new GameError('Your bag is full.');
    const ref = { type: 'listing', id: String(l.id) };
    const buyerGold = (await changeGold(tx, buyerId, -total, 'marketplace_purchase', ref)).after;
    const sellerGold = (await changeGold(tx, l.seller_id, total - tax, 'marketplace_sale', ref)).after;
    await writeSlots(tx, buyerId, res.slots, res.changed);
    await tx.query(`UPDATE marketplace_listings SET status = 'sold', buyer_id = $2, closed_at = now() WHERE id = $1`, [l.id, buyerId]);
    await tx.query(
      `INSERT INTO marketplace_transactions (listing_id, seller_id, buyer_id, item_id, quantity, total, tax) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [l.id, l.seller_id, buyerId, l.item_id, l.quantity, total, tax],
    );
    await logItemMovement(tx, { itemId: l.item_id, quantity: l.quantity, quality: l.quality, from: l.seller_id, to: buyerId, reason: 'marketplace', ref });
    return {
      message: `Bought ${l.quantity}× ${def.name} for ${total.toLocaleString()} Gold.`,
      inventory: toState(capacity, buyerGold, res.slots),
      sellerId: l.seller_id,
      sellerGold,
      net: total - tax,
      itemName: def.name,
      qty: l.quantity,
    };
  });
}

/** Take back an unsold listing (active or expired). The listing fee is not refunded. */
export async function cancelListing(pool: Pool, sellerId: string, listingId: unknown): Promise<{ message: string; inventory: Inv }> {
  if (!Number.isInteger(listingId)) throw new GameError('Unknown listing.');
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM marketplace_listings WHERE id = $1 FOR UPDATE', [listingId]);
    const l = rows[0];
    if (!l || l.seller_id !== sellerId) throw new GameError('Unknown listing.');
    if (l.status !== 'active') throw new GameError('That listing is already closed.');
    const { gold } = await lockCharacter(tx, sellerId);
    const def = getItem(l.item_id)!;
    const { capacity, slots } = await loadSlots(tx, sellerId);
    const res = addItem(slots, { itemId: l.item_id, quality: l.quality, durability: l.durability, bound: false, enhance: l.enhance, ...(l.affixes?.length ? { affixes: l.affixes } : {}) }, l.quantity, def.stackSize);
    if (!res.ok) throw new GameError('Make room in your bag first.');
    await writeSlots(tx, sellerId, res.slots, res.changed);
    const expired = new Date(l.expires_at).getTime() <= Date.now();
    await tx.query(`UPDATE marketplace_listings SET status = $2, closed_at = now() WHERE id = $1`, [l.id, expired ? 'returned' : 'cancelled']);
    await logItemMovement(tx, { itemId: l.item_id, quantity: l.quantity, quality: l.quality, to: sellerId, reason: 'marketplace', ref: { type: 'listing', id: String(l.id) } });
    return { message: `${def.name} returned to your bag.`, inventory: toState(capacity, gold, res.slots) };
  });
}

// ---------------------------------------------------------------------------
// Direct trade
// ---------------------------------------------------------------------------

export interface TradeOffer {
  characterId: string;
  items: TradeOfferItem[];
  gold: number;
}

/**
 * Execute a confirmed trade atomically. Every offered item is re-checked
 * against the database (same item, enough quantity, not bound) — what the
 * players saw in the window doesn't matter, only what is really there.
 */
export async function executeTrade(pool: Pool, a: TradeOffer, b: TradeOffer): Promise<{ a: Inv; b: Inv }> {
  return withTransaction(pool, async (tx) => {
    await lockPair(tx, a.characterId, b.characterId);
    const bagA = await loadSlots(tx, a.characterId);
    const bagB = await loadSlots(tx, b.characterId);
    let slotsA = bagA.slots;
    let slotsB = bagB.slots;
    const changedA = new Set<number>();
    const changedB = new Set<number>();
    const take = (from: typeof slotsA, offer: TradeOffer, changed: Set<number>) => {
      let cur = from;
      const taken: { itemId: string; quantity: number; quality: number; durability: number | null; enhance: number; affixes?: SlotItem['affixes'] }[] = [];
      for (const it of offer.items) {
        const s = cur[it.slot];
        if (!s || s.itemId !== it.itemId || s.quantity < it.quantity) throw new GameError('The trade changed — an item is no longer there.');
        const def = getItem(s.itemId)!;
        if (!def.tradable || s.bound) throw new GameError(`${def.name} can't be traded.`);
        const res = removeFromSlot(cur, it.slot, it.quantity);
        if (!res.ok) throw new GameError(res.error);
        cur = res.slots;
        changed.add(it.slot);
        taken.push({ itemId: s.itemId, quantity: it.quantity, quality: s.quality, durability: s.durability, enhance: s.enhance ?? 0, affixes: s.affixes });
      }
      return { slots: cur, taken };
    };
    const give = (to: typeof slotsA, items: ReturnType<typeof take>['taken'], changed: Set<number>) => {
      let cur = to;
      for (const it of items) {
        const def = getItem(it.itemId)!;
        const res = addItem(cur, { itemId: it.itemId, quality: it.quality, durability: it.durability, bound: false, enhance: it.enhance, ...(it.affixes?.length ? { affixes: it.affixes } : {}) }, it.quantity, def.stackSize);
        if (!res.ok) throw new GameError('Someone\'s bag is too full for this trade.');
        cur = res.slots;
        res.changed.forEach((i) => changed.add(i));
      }
      return cur;
    };
    const fromA = take(slotsA, a, changedA);
    slotsA = fromA.slots;
    const fromB = take(slotsB, b, changedB);
    slotsB = fromB.slots;
    slotsA = give(slotsA, fromB.taken, changedA);
    slotsB = give(slotsB, fromA.taken, changedB);
    await writeSlots(tx, a.characterId, slotsA, [...changedA]);
    await writeSlots(tx, b.characterId, slotsB, [...changedB]);
    let goldA = (await lockCharacter(tx, a.characterId)).gold;
    let goldB = (await lockCharacter(tx, b.characterId)).gold;
    const ref = { type: 'trade', id: `${a.characterId}:${b.characterId}` };
    if (a.gold > 0) {
      goldA = (await changeGold(tx, a.characterId, -a.gold, 'trade', ref)).after;
      goldB = (await changeGold(tx, b.characterId, a.gold, 'trade', ref)).after;
    }
    if (b.gold > 0) {
      goldB = (await changeGold(tx, b.characterId, -b.gold, 'trade', ref)).after;
      goldA = (await changeGold(tx, a.characterId, b.gold, 'trade', ref)).after;
    }
    for (const it of fromA.taken) await logItemMovement(tx, { itemId: it.itemId, quantity: it.quantity, quality: it.quality, from: a.characterId, to: b.characterId, reason: 'trade' });
    for (const it of fromB.taken) await logItemMovement(tx, { itemId: it.itemId, quantity: it.quantity, quality: it.quality, from: b.characterId, to: a.characterId, reason: 'trade' });
    await tx.query('INSERT INTO direct_trade_logs (a_id, b_id, a_gold, b_gold, a_items, b_items) VALUES ($1, $2, $3, $4, $5, $6)', [
      a.characterId,
      b.characterId,
      a.gold,
      b.gold,
      JSON.stringify(fromA.taken),
      JSON.stringify(fromB.taken),
    ]);
    return { a: toState(bagA.capacity, goldA, slotsA), b: toState(bagB.capacity, goldB, slotsB) };
  });
}

/** Buy from a player's stall: the item comes straight out of the seller's bag. 3% tax. */
export async function buyFromStall(
  pool: Pool,
  buyerId: string,
  sellerId: string,
  slot: number,
  expect: { itemId: string; unitPrice: number },
): Promise<{ buyer: Inv; seller: Inv; total: number; qty: number; itemName: string }> {
  if (buyerId === sellerId) throw new GameError("That's your own shop.");
  return withTransaction(pool, async (tx) => {
    await lockPair(tx, buyerId, sellerId);
    const sb = await loadSlots(tx, sellerId);
    const item = sb.slots[slot];
    if (!item || item.itemId !== expect.itemId || item.bound) throw new GameError('That item is no longer for sale.');
    const def = getItem(item.itemId)!;
    const qty = item.quantity;
    const total = expect.unitPrice * qty;
    const tax = Math.max(1, Math.floor(total * 0.03));
    const bb = await loadSlots(tx, buyerId);
    const added = addItem(bb.slots, { ...item }, qty, def.stackSize);
    if (!added.ok) throw new GameError('Your bag is full.');
    const taken = removeFromSlot(sb.slots, slot, qty);
    if (!taken.ok) throw new GameError(taken.error);
    const ref = { type: 'stall', id: sellerId };
    const buyerGold = (await changeGold(tx, buyerId, -total, 'marketplace_purchase', ref)).after;
    const sellerGold = (await changeGold(tx, sellerId, total - tax, 'marketplace_sale', ref)).after;
    await writeSlots(tx, sellerId, taken.slots, [slot]);
    await writeSlots(tx, buyerId, added.slots, added.changed);
    await logItemMovement(tx, { itemId: item.itemId, quantity: qty, quality: item.quality, from: sellerId, to: buyerId, reason: 'marketplace', ref });
    return { buyer: toState(bb.capacity, buyerGold, added.slots), seller: toState(sb.capacity, sellerGold, taken.slots), total, qty, itemName: def.name };
  });
}
