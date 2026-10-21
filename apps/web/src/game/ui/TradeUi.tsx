'use client';

import { useCallback, useEffect, useState } from 'react';
import { BALANCE, getItem } from '@terrago/game-data';
import { QUALITIES, type InventorySlot, type MarketListing, type MarketQuery, type TradeOfferItem } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { ItemSlot, RARITY_COLOR } from './ItemSlot';
import { Window } from './Window';

const CATEGORIES = ['', 'material', 'crop', 'seed', 'fish', 'consumable', 'weapon', 'armor', 'tool', 'mount'];
const fmt = (n: number) => n.toLocaleString();
const qualityTag = (q: number) => (q > 0 ? ` (${QUALITIES[q]})` : '');

function ItemName({ itemId, quality = 0, enhance = 0 }: { itemId: string; quality?: number; enhance?: number }) {
  const def = getItem(itemId);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {def && <PixelIcon icon={def.icon} size={22} />}
      <span className="truncate font-bold" style={{ color: def && def.rarity !== 'common' ? RARITY_COLOR[def.rarity] : undefined }}>
        {def?.name ?? itemId}
        {enhance > 0 ? ` +${enhance}` : ''}
        {qualityTag(quality)}
      </span>
    </span>
  );
}

/** Player marketplace: browse/buy, sell from your bag, manage your listings. */
export function MarketPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const inv = useStore(client.ui, (s) => s.inventory);
  const [tab, setTab] = useState<'browse' | 'sell' | 'mine'>('browse');
  const [q, setQ] = useState<MarketQuery>({ search: '', category: '', sort: 'price_asc', page: 0 });
  const [rows, setRows] = useState<MarketListing[]>([]);
  const [total, setTotal] = useState(0);
  const [mine, setMine] = useState<MarketListing[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sellSlot, setSellSlot] = useState<number | null>(null);
  const [sellQty, setSellQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(10);

  const load = useCallback(async () => {
    setErr(null);
    try {
      if (tab === 'browse') {
        const r = await client.marketSearch(q);
        setRows(r.listings);
        setTotal(r.total);
      } else if (tab === 'mine') setMine((await client.marketMine()).listings);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [client, q, tab]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
    void load();
  };

  if (!inv) return null;
  const m = BALANCE.market;
  const sellable = inv.slots.filter((s) => {
    const d = getItem(s.itemId);
    return d?.tradable && !s.bound;
  });
  const chosen: InventorySlot | undefined = inv.slots.find((s) => s.slot === sellSlot);
  const listTotal = sellQty * sellPrice;
  const fee = Math.max(m.listingFeeMin, Math.floor(listTotal * m.listingFeeRate));
  const net = listTotal - Math.floor(listTotal * m.taxRate);
  const pages = Math.max(1, Math.ceil(total / 40));

  return (
    <Window title="Marketplace" onClose={onClose} testId="market-panel" wide>
      <div className="mb-2 flex items-center gap-1">
        {(['browse', 'sell', 'mine'] as const).map((t) => (
          <button key={t} className={`px-btn small ${tab === t ? 'green' : 'ghost'}`} onClick={() => setTab(t)} data-testid={`market-tab-${t}`}>
            {t === 'browse' ? 'Browse' : t === 'sell' ? 'Sell' : 'My listings'}
          </button>
        ))}
        <span className="ml-auto text-sm font-bold text-gold-dark">◉ {fmt(inv.gold)}</span>
      </div>
      {err && <p className="mb-2 text-sm text-[#b8402f]">{err}</p>}

      {tab === 'browse' && (
        <>
          <div className="mb-2 flex flex-wrap gap-1 text-sm">
            <input
              className="min-w-0 flex-1 border-2 border-ink bg-parchment px-1"
              placeholder="Search items…"
              value={q.search}
              onChange={(e) => setQ({ ...q, search: e.target.value, page: 0 })}
              data-testid="market-search"
            />
            <select className="border-2 border-ink bg-parchment" value={q.category} onChange={(e) => setQ({ ...q, category: e.target.value, page: 0 })} aria-label="Category">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c ? c[0]!.toUpperCase() + c.slice(1) : 'All'}
                </option>
              ))}
            </select>
            <select className="border-2 border-ink bg-parchment" value={q.sort} onChange={(e) => setQ({ ...q, sort: e.target.value as MarketQuery['sort'] })} aria-label="Sort">
              <option value="price_asc">Cheapest</option>
              <option value="price_desc">Priciest</option>
              <option value="newest">Newest</option>
            </select>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-wood-dark/70">Nothing listed yet. Be the first to sell!</p>
          ) : (
            <ul className="space-y-1" data-testid="market-rows">
              {rows.map((l) => (
                <li key={l.id} className="flex items-center gap-2 border-2 border-ink/30 bg-parchment-2/50 px-1.5 py-1 text-sm">
                  <ItemName itemId={l.itemId} quality={l.quality} enhance={l.enhance} />
                  <span className="text-xs text-wood-dark/70">×{l.quantity}</span>
                  <span className="ml-auto text-right text-xs">
                    <span className="block font-bold text-gold-dark">◉ {fmt(l.unitPrice * l.quantity)}</span>
                    <span className="text-wood-dark/70">{l.sellerName}</span>
                  </span>
                  {l.mine ? (
                    <span className="px-1 text-xs text-wood-dark/60">yours</span>
                  ) : (
                    <button
                      className="px-btn green small"
                      disabled={busy || inv.gold < l.unitPrice * l.quantity}
                      onClick={() => act(() => client.marketBuy(l.id))}
                      data-testid={`market-buy-${l.id}`}
                    >
                      Buy
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-center gap-2 text-sm">
              <button className="px-btn ghost small" disabled={!q.page} onClick={() => setQ({ ...q, page: (q.page ?? 0) - 1 })}>
                ‹
              </button>
              {(q.page ?? 0) + 1} / {pages}
              <button className="px-btn ghost small" disabled={(q.page ?? 0) + 1 >= pages} onClick={() => setQ({ ...q, page: (q.page ?? 0) + 1 })}>
                ›
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'sell' && (
        <>
          <p className="mb-1 text-xs text-wood-dark/80">Pick an item from your bag. Listings last {m.durationHours}h; claim unsold items back from My listings.</p>
          <div className="mb-2 flex flex-wrap gap-1" data-testid="market-sell-grid">
            {sellable.length === 0 && <p className="text-sm">Nothing tradable in your bag.</p>}
            {sellable.map((s) => (
              <ItemSlot
                key={s.slot}
                slot={s.slot}
                item={s}
                size={38}
                selected={sellSlot === s.slot}
                onClick={() => {
                  setSellSlot(s.slot);
                  setSellQty(s.quantity);
                  setSellPrice(Math.max(1, (getItem(s.itemId)?.vendorValue ?? 1) * 2));
                }}
              />
            ))}
          </div>
          {chosen && (
            <div className="space-y-1 border-2 border-ink/40 p-2 text-sm">
              <ItemName itemId={chosen.itemId} quality={chosen.quality} enhance={chosen.enhance} />
              <label className="flex items-center gap-2">
                Quantity
                <input
                  type="number"
                  min={1}
                  max={chosen.quantity}
                  value={sellQty}
                  onChange={(e) => setSellQty(Math.max(1, Math.min(chosen.quantity, Number(e.target.value) || 1)))}
                  className="w-20 border-2 border-ink bg-parchment px-1"
                  data-testid="market-sell-qty"
                />
              </label>
              <label className="flex items-center gap-2">
                Price each
                <input
                  type="number"
                  min={1}
                  value={sellPrice}
                  onChange={(e) => setSellPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="w-24 border-2 border-ink bg-parchment px-1"
                  data-testid="market-sell-price"
                />
                <span className="text-xs text-wood-dark/70">shop pays {getItem(chosen.itemId)?.vendorValue ?? 0}</span>
              </label>
              <p className="text-xs">
                Total ◉ {fmt(listTotal)} · listing fee ◉ {fmt(fee)} · you get ◉ {fmt(net)} after {Math.round(m.taxRate * 100)}% tax
              </p>
              <button
                className="px-btn green small"
                disabled={busy || inv.gold < fee}
                onClick={() =>
                  act(async () => {
                    const ok = await client.marketList(chosen.slot, sellQty, sellPrice);
                    if (ok) setSellSlot(null);
                  })
                }
                data-testid="market-list"
              >
                List for sale
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'mine' && (
        <ul className="space-y-1">
          {mine.length === 0 && <p className="text-sm text-wood-dark/70">You have no listings.</p>}
          {mine.map((l) => (
            <li key={l.id} className="flex items-center gap-2 border-2 border-ink/30 px-1.5 py-1 text-sm">
              <ItemName itemId={l.itemId} quality={l.quality} enhance={l.enhance} />
              <span className="text-xs">×{l.quantity}</span>
              <span className="ml-auto text-xs font-bold text-gold-dark">◉ {fmt(l.unitPrice * l.quantity)}</span>
              {l.status === 'active' ? (
                <button className="px-btn ghost small" disabled={busy} onClick={() => act(() => client.marketCancel(l.id))} data-testid={`market-cancel-${l.id}`}>
                  {l.expiresAt <= Date.now() ? 'Claim' : 'Cancel'}
                </button>
              ) : (
                <span className={`text-xs font-bold ${l.status === 'sold' ? 'text-leaf-dark' : 'text-wood-dark/60'}`}>{l.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Window>
  );
}

function OfferList({ items, gold }: { items: TradeOfferItem[]; gold: number }) {
  return (
    <div className="min-h-[90px] space-y-0.5 border-2 border-ink/40 bg-parchment-2/40 p-1 text-xs">
      {items.map((i) => (
        <div key={i.slot} className="flex items-center gap-1">
          <ItemName itemId={i.itemId} quality={i.quality} enhance={i.enhance} />
          <span className="ml-auto">×{i.quantity}</span>
        </div>
      ))}
      {gold > 0 && <div className="font-bold text-gold-dark">◉ {fmt(gold)} Gold</div>}
      {!items.length && !gold && <div className="text-wood-dark/50">Nothing yet</div>}
    </div>
  );
}

/** Face-to-face trade: both sides offer, lock, then confirm. */
export function TradeWindow({ client }: { client: GameClient }) {
  const trade = useStore(client.ui, (s) => s.trade);
  const inv = useStore(client.ui, (s) => s.inventory);
  const [gold, setGold] = useState(0);
  useEffect(() => setGold(trade?.mine.gold ?? 0), [trade?.mine.gold]);
  if (!trade || !inv) return null;
  const offered = new Map(trade.mine.items.map((i) => [i.slot, i.quantity]));
  const send = (next: Map<number, number>, g = gold) =>
    void client.tradeOffer(
      [...next].map(([slot, quantity]) => ({ slot, quantity })),
      g,
    );
  const toggle = (s: InventorySlot) => {
    const next = new Map(offered);
    if (next.has(s.slot)) next.delete(s.slot);
    else next.set(s.slot, s.quantity);
    send(next);
  };
  const tradable = inv.slots.filter((s) => getItem(s.itemId)?.tradable && !s.bound);
  const status = (x: typeof trade.mine) => (x.confirmed ? '✔ Confirmed' : x.locked ? '🔒 Locked' : 'Choosing…');

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-night/40 p-2">
      <Window title={`Trade with ${trade.partner.name}`} onClose={() => client.tradeCancel()} testId="trade-window" wide>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="font-bold">You give · <span className="text-xs font-normal">{status(trade.mine)}</span></p>
            <OfferList items={trade.mine.items} gold={trade.mine.gold} />
          </div>
          <div>
            <p className="font-bold">
              {trade.partner.name} gives · <span className="text-xs font-normal">{status(trade.theirs)}</span>
            </p>
            <OfferList items={trade.theirs.items} gold={trade.theirs.gold} />
          </div>
        </div>
        <p className="mt-2 text-xs text-wood-dark/80">Click items in your bag to add or remove them. Any change unlocks both sides.</p>
        <div className="mt-1 flex flex-wrap gap-1" data-testid="trade-bag">
          {tradable.map((s) => (
            <ItemSlot key={s.slot} slot={s.slot} item={s} size={34} selected={offered.has(s.slot)} onClick={() => toggle(s)} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            Gold
            <input
              type="number"
              min={0}
              max={inv.gold}
              value={gold}
              onChange={(e) => setGold(Math.max(0, Math.min(inv.gold, Math.floor(Number(e.target.value) || 0))))}
              onBlur={() => gold !== trade.mine.gold && send(offered)}
              className="w-24 border-2 border-ink bg-parchment px-1"
              data-testid="trade-gold"
            />
          </label>
          <div className="ml-auto flex gap-1">
            {!trade.mine.locked ? (
              <button
                className="px-btn small"
                onClick={async () => {
                  if (gold !== trade.mine.gold) await client.tradeOffer([...offered].map(([slot, quantity]) => ({ slot, quantity })), gold);
                  void client.tradeLock();
                }}
                data-testid="trade-lock"
              >
                Lock offer
              </button>
            ) : (
              <button
                className="px-btn green small"
                disabled={!trade.theirs.locked || trade.mine.confirmed}
                onClick={() => void client.tradeConfirm()}
                data-testid="trade-confirm"
              >
                {trade.theirs.locked ? 'Confirm trade' : 'Waiting…'}
              </button>
            )}
            <button className="px-btn ghost small" onClick={() => client.tradeCancel()}>
              Cancel
            </button>
          </div>
        </div>
      </Window>
    </div>
  );
}

/** Incoming trade request + the menu shown when you click another player. */
export function SocialPopups({ client }: { client: GameClient }) {
  const invite = useStore(client.ui, (s) => s.tradeInvite);
  const menu = useStore(client.ui, (s) => s.playerMenu);
  useEffect(() => {
    if (!invite) return;
    const t = setTimeout(() => client.ui.set({ tradeInvite: null }), 30_000);
    return () => clearTimeout(t);
  }, [invite, client]);
  return (
    <div className="pointer-events-auto absolute top-28 left-1/2 flex -translate-x-1/2 flex-col gap-2">
      {invite && (
        <div className="px-panel p-2 text-sm" data-testid="trade-invite">
          <p>
            <b>{invite.name}</b> wants to trade with you.
          </p>
          <div className="mt-1 flex gap-1">
            <button className="px-btn green small" onClick={() => client.tradeRespond(true)} data-testid="trade-accept">
              Accept
            </button>
            <button className="px-btn ghost small" onClick={() => client.tradeRespond(false)}>
              Decline
            </button>
          </div>
        </div>
      )}
      {menu && (
        <div className="px-panel p-2 text-sm" data-testid="player-menu">
          <p className="font-bold text-wood-dark">{menu.name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <button className="px-btn small" onClick={() => void client.tradeRequest(menu.id)} data-testid="player-trade">
              Trade
            </button>
            <button className="px-btn small" onClick={() => void client.duelRequest(menu.name)} data-testid="player-duel">
              Duel
            </button>
            <button className="px-btn ghost small" onClick={() => client.ui.set({ playerMenu: null })}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
