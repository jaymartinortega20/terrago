import { createHmac, timingSafeEqual } from 'node:crypto';
import { GEM_PACKS, OUTFITS, PREMIUM_COSMETICS, getCosmetic, getGemPack, type GemShopState } from '@terrago/shared';
import type { Config } from '../config';
import { GameError, withTransaction, type Pool, type Tx } from '../db';

/**
 * Gems: an account-wide premium balance. Every change goes through
 * changeGems (row lock + ledger entry), so the balance can never go negative
 * and every Gem is accounted for. Gems are bought through PayMongo's hosted
 * checkout and credited only by a signed webhook — never by the browser.
 */

export type GemReason = 'purchase' | 'cosmetic' | 'market_sale' | 'market_purchase' | 'admin' | 'refund';
export type Payments = Config['payments'];

export async function changeGems(tx: Tx, userId: string, amount: number, reason: GemReason, ref: string | null, characterId: string | null = null): Promise<number> {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error(`Invalid gem amount ${amount}`);
  await tx.query(`INSERT INTO gem_wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  const { rows } = await tx.query<{ balance: string }>(`SELECT balance FROM gem_wallets WHERE user_id = $1 FOR UPDATE`, [userId]);
  const after = Number(rows[0]!.balance) + amount;
  if (after < 0) throw new GameError('Not enough Gems.');
  await tx.query(`UPDATE gem_wallets SET balance = $2, updated_at = now() WHERE user_id = $1`, [userId, after]);
  await tx.query(`INSERT INTO gem_transactions (user_id, character_id, amount, balance_after, reason, ref) VALUES ($1, $2, $3, $4, $5, $6)`, [userId, characterId, amount, after, reason, ref]);
  return after;
}

export async function gemBalance(pool: Pool | Tx, userId: string): Promise<number> {
  const { rows } = await pool.query<{ balance: string }>(`SELECT balance FROM gem_wallets WHERE user_id = $1`, [userId]);
  return Number(rows[0]?.balance ?? 0);
}

export async function ownedCosmetics(pool: Pool | Tx, userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ cosmetic_id: string }>(`SELECT cosmetic_id FROM account_cosmetics WHERE user_id = $1`, [userId]);
  return rows.map((r) => r.cosmetic_id);
}

/** Outfit indexes unlocked for the whole account through the Gem Shop. */
export async function premiumOutfits(pool: Pool | Tx, userId: string): Promise<number[]> {
  const owned = new Set(await ownedCosmetics(pool, userId));
  return PREMIUM_COSMETICS.filter((c) => c.kind === 'outfit' && owned.has(c.id))
    .map((c) => OUTFITS.findIndex((o) => o.name === c.ref))
    .filter((i) => i >= 0);
}

/** Mount gear unlocked for the whole account. */
export async function premiumMountStyles(pool: Pool | Tx, userId: string): Promise<string[]> {
  const owned = new Set(await ownedCosmetics(pool, userId));
  return PREMIUM_COSMETICS.filter((c) => c.kind === 'mount_style' && owned.has(c.id)).map((c) => c.ref);
}

export async function shopState(pool: Pool, userId: string, payments: Payments): Promise<GemShopState> {
  const [balance, owned, hist] = await Promise.all([
    gemBalance(pool, userId),
    ownedCosmetics(pool, userId),
    pool.query(`SELECT amount, balance_after, reason, created_at FROM gem_transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 15`, [userId]),
  ]);
  return {
    balance,
    payments: payments.mode,
    owned,
    history: hist.rows.map((r) => ({ amount: Number(r.amount), balance: Number(r.balance_after), reason: r.reason, at: new Date(r.created_at).getTime() })),
  };
}

/** Spend Gems on a cosmetic (account-wide, once). */
export async function buyCosmetic(pool: Pool, userId: string, characterId: string, id: unknown): Promise<{ name: string; balance: number }> {
  const c = getCosmetic(id);
  if (!c) throw new GameError('That is not in the Gem Shop.');
  return withTransaction(pool, async (tx) => {
    const ins = await tx.query(`INSERT INTO account_cosmetics (user_id, cosmetic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, c.id]);
    if (!ins.rowCount) throw new GameError(`You already own ${c.name}.`);
    const balance = await changeGems(tx, userId, -c.gems, 'cosmetic', c.id, characterId);
    return { name: c.name, balance };
  });
}

// ---------------------------------------------------------------------------
// Buying Gems
// ---------------------------------------------------------------------------

/** Start a checkout for a Gem pack. Returns the page to send the player to. */
export async function createCheckout(
  pool: Pool,
  payments: Payments,
  user: { id: string; email?: string | null },
  packId: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; orderId: string }> {
  const pack = getGemPack(packId);
  if (!pack) throw new GameError('Unknown Gem pack.');
  if (payments.mode === 'off') throw new GameError('Gem purchases are not open yet. Check back soon!');
  // A little brake on spam checkouts.
  const recent = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM gem_orders WHERE user_id = $1 AND created_at > now() - interval '10 minutes'`, [user.id]);
  if ((recent.rows[0]?.n ?? 0) >= 10) throw new GameError('Too many checkouts. Wait a few minutes.');
  const gems = pack.gems + pack.bonus;
  const centavos = pack.php * 100;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO gem_orders (user_id, pack_id, gems, amount_centavos, provider, livemode) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [user.id, pack.id, gems, centavos, payments.mode === 'fake' ? 'fake' : 'paymongo', payments.mode === 'live'],
  );
  const orderId = rows[0]!.id;
  const back = `${payments.webUrl}/gems?order=${orderId}`;
  if (payments.mode === 'fake') return { url: `${back}&fake=1`, orderId };

  const res = await fetchImpl(`${payments.apiUrl}/checkout_sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${payments.secretKey}:`).toString('base64')}` },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [{ name: `${gems.toLocaleString()} TerraGo Gems`, amount: centavos, currency: 'PHP', quantity: 1, description: pack.bonus ? `${pack.gems} + ${pack.bonus} bonus Gems` : `${pack.gems} Gems` }],
          payment_method_types: payments.methods,
          success_url: `${back}&status=success`,
          cancel_url: `${back}&status=cancelled`,
          reference_number: orderId,
          description: 'TerraGo Gems (in-game cosmetic currency, non-refundable, no cash value)',
          send_email_receipt: true,
          metadata: { order_id: orderId, user_id: user.id },
        },
      },
    }),
  });
  const body = (await res.json().catch(() => null)) as { data?: { id?: string; attributes?: { checkout_url?: string } }; errors?: { detail?: string }[] } | null;
  const sessionId = body?.data?.id;
  const url = body?.data?.attributes?.checkout_url;
  if (!res.ok || !sessionId || !url) {
    await pool.query(`UPDATE gem_orders SET status = 'failed' WHERE id = $1`, [orderId]);
    throw new GameError(`Checkout could not start${body?.errors?.[0]?.detail ? `: ${body.errors[0].detail}` : '.'} Please try again later.`);
  }
  await pool.query(`UPDATE gem_orders SET provider_ref = $2 WHERE id = $1`, [orderId, sessionId]);
  return { url, orderId };
}

/** Credit a paid order exactly once. Returns who got how many (null if already done / unknown). */
export async function markPaid(pool: Pool, orderId: string, check: { sessionId?: string; amountCentavos?: number } = {}): Promise<{ userId: string; gems: number; balance: number } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query(`SELECT user_id, gems, amount_centavos, provider_ref, status FROM gem_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const o = rows[0];
    if (!o || o.status !== 'pending') return null;
    if (check.sessionId && o.provider_ref && o.provider_ref !== check.sessionId) throw new Error('checkout session does not match the order');
    if (check.amountCentavos !== undefined && check.amountCentavos < o.amount_centavos) throw new Error('paid amount is less than the order');
    await tx.query(`UPDATE gem_orders SET status = 'paid', paid_at = now() WHERE id = $1`, [orderId]);
    const balance = await changeGems(tx, o.user_id, o.gems, 'purchase', orderId);
    return { userId: o.user_id as string, gems: o.gems as number, balance };
  });
}

/**
 * Check a PayMongo webhook signature: header "t=<ts>,te=<test sig>,li=<live sig>",
 * signature = HMAC-SHA256(secret, `${t}.${rawBody}`). Rejects anything older than 10 minutes.
 */
export function verifyPaymongoSignature(header: string | undefined, raw: string, secret: string, live: boolean, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.trim().split('=') as [string, string]));
  const t = parts.t;
  const sig = live ? parts.li : parts.te;
  if (!t || !sig) return false;
  if (Math.abs(now / 1000 - Number(t)) > 600) return false;
  const want = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const a = Buffer.from(want);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Handle a verified PayMongo event. Returns the credit, if it paid for an order. */
export async function handlePaymongoEvent(pool: Pool, event: unknown): Promise<{ userId: string; gems: number; balance: number } | null> {
  const ev = event as { data?: { attributes?: { type?: string; data?: { id?: string; attributes?: Record<string, any> } } } };
  const type = ev?.data?.attributes?.type;
  if (type !== 'checkout_session.payment.paid') return null;
  const session = ev.data!.attributes!.data;
  const a = session?.attributes ?? {};
  const orderId = String(a.reference_number ?? a.metadata?.order_id ?? '');
  const payments = (a.payments ?? []) as { attributes?: { amount?: number; status?: string } }[];
  const paid = payments.filter((p) => p.attributes?.status === 'paid').reduce((s, p) => s + (p.attributes?.amount ?? 0), 0);
  return markPaid(pool, orderId, { sessionId: session?.id, ...(payments.length ? { amountCentavos: paid } : {}) });
}

/** The packs as the shop shows them. */
export const packs = GEM_PACKS;
