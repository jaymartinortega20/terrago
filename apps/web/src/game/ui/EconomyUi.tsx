'use client';

import { useEffect, useState } from 'react';
import { getItem } from '@terrago/game-data';
import { QUALITIES, type BankViewState, type InventorySlot, type TravelOption } from '@terrago/shared';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { ItemSlot } from './ItemSlot';
import { Window } from './Window';

function Grid({ slots, capacity, onPick, size = 34, testId }: { slots: InventorySlot[]; capacity: number; onPick: (slot: number) => void; size?: number; testId?: string }) {
  const by = new Map(slots.map((s) => [s.slot, s]));
  return (
    <div className="flex flex-wrap gap-0.5" data-testid={testId}>
      {Array.from({ length: capacity }, (_, i) => (
        <ItemSlot key={i} slot={i} item={by.get(i)} size={size} onClick={() => by.get(i) && onPick(i)} />
      ))}
    </div>
  );
}

/** Bank vault: click an item to move the whole stack across. */
export function BankPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const npc = useStore(client.ui, (s) => s.serviceNpc);
  const inv = useStore(client.ui, (s) => s.inventory);
  const [bank, setBank] = useState<BankViewState | null>(null);
  useEffect(() => {
    if (npc) client.bankGet(npc).then(setBank, () => onClose());
  }, [client, npc, onClose]);
  if (!npc || !inv) return null;
  const move = async (dir: 'deposit' | 'withdraw', slot: number) => {
    const b = await client.bankMove(npc, dir, slot);
    if (b) setBank(b);
  };
  return (
    <Window title="Greenhaven Bank" onClose={onClose} testId="bank-panel" wide>
      <p className="text-xs text-wood-dark/80">Click an item to move it between your bag and your vault.</p>
      <h3 className="mt-2 text-sm font-bold">Vault {bank ? `(${bank.slots.length}/${bank.capacity})` : ''}</h3>
      {bank ? <Grid slots={bank.slots} capacity={bank.capacity} onPick={(i) => void move('withdraw', i)} size={30} testId="bank-vault" /> : <p>Loading…</p>}
      {bank?.next && (
        <button
          className="px-btn small mt-1"
          disabled={inv.gold < bank.next.cost}
          onClick={async () => {
            const r = await client.bankUpgrade(npc);
            if (r) setBank(r.bank);
          }}
          data-testid="bank-upgrade"
        >
          Upgrade to {bank.next.capacity} slots (◉ {bank.next.cost.toLocaleString()})
        </button>
      )}
      <h3 className="mt-3 text-sm font-bold">Your bag</h3>
      <Grid slots={inv.slots} capacity={inv.capacity} onPick={(i) => void move('deposit', i)} size={30} testId="bank-bag" />
    </Window>
  );
}

/** Waystone travel. */
export function TravelPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const gold = useStore(client.ui, (s) => s.inventory?.gold ?? 0);
  const [data, setData] = useState<{ atWaystone: boolean; options: TravelOption[] } | null>(null);
  useEffect(() => {
    client.travelList().then(setData, () => onClose());
  }, [client, onClose]);
  return (
    <Window title="Waystone" onClose={onClose} testId="travel-panel">
      {!data && <p>Loading…</p>}
      {data && !data.atWaystone && <p className="text-sm">Stand on a waystone pad to travel.</p>}
      {data && (
        <ul className="space-y-1">
          {data.options.map((o) => (
            <li key={o.mapId} className={`flex items-center gap-2 border-2 border-ink/20 px-2 py-1 text-sm ${o.known ? '' : 'opacity-50'}`}>
              <span className="font-bold">{o.name}</span>
              {!o.known && <span className="text-xs">(not visited yet)</span>}
              <span className="ml-auto text-xs">◉ {o.fee}</span>
              <button
                className="px-btn green small"
                disabled={!data.atWaystone || !o.known || o.here || gold < o.fee}
                onClick={() => void client.travelGo(o.mapId)}
                data-testid={`travel-${o.mapId}`}
              >
                {o.here ? 'Here' : 'Go'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-wood-dark/80">Walk into a region once to attune its waystone.</p>
    </Window>
  );
}

/** Set up your own stall: pick items from your bag and price them. */
export function StallSetupPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const inv = useStore(client.ui, (s) => s.inventory);
  const shop = useStore(client.ui, (s) => s.stallOpenName);
  const [name, setName] = useState('');
  const [prices, setPrices] = useState<Record<number, number>>({});
  if (!inv) return null;
  const sellable = inv.slots.filter((s) => getItem(s.itemId)?.tradable && !s.bound);
  const chosen = Object.entries(prices).filter(([, p]) => p > 0);
  return (
    <Window title="My market stall" onClose={onClose} testId="stall-setup" wide>
      {shop ? (
        <>
          <p className="text-sm">
            Your stall <b>{shop}</b> is open. Players can click you to browse it. Moving closes it.
          </p>
          <button className="px-btn small mt-2" onClick={() => void client.stallClose().then(() => client.ui.set({ stallOpenName: null }))}>
            Close stall
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-wood-dark/80">Open a stall in town: shoppers see your sign and buy straight from your bag. 3% tax on sales.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} maxLength={24} placeholder='Stall name, e.g. "Cheap Iron!"' className="mt-2 w-full border-2 border-ink bg-parchment px-1 text-sm" data-testid="stall-name" />
          <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto">
            {sellable.map((s) => {
              const d = getItem(s.itemId)!;
              return (
                <li key={s.slot} className="flex items-center gap-2 text-sm">
                  <ItemSlot slot={s.slot} item={s} size={30} />
                  <span className="flex-1 truncate">
                    {d.name}
                    {s.quality ? ` (${QUALITIES[s.quality]})` : ''} ×{s.quantity}
                  </span>
                  <input
                    type="number"
                    min={0}
                    placeholder="price each"
                    value={prices[s.slot] || ''}
                    onChange={(e) => setPrices({ ...prices, [s.slot]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="w-24 border-2 border-ink bg-parchment px-1"
                    data-testid={`stall-price-${s.slot}`}
                  />
                </li>
              );
            })}
          </ul>
          <button
            className="px-btn green small mt-2"
            disabled={chosen.length === 0 || name.trim().length < 3}
            onClick={async () => {
              const r = await client.stallOpen(name.trim(), chosen.map(([slot, price]) => ({ slot: Number(slot), price })));
              if (r) client.ui.set({ stallOpenName: name.trim() });
            }}
            data-testid="stall-open"
          >
            Open stall ({chosen.length} item{chosen.length === 1 ? '' : 's'})
          </button>
        </>
      )}
    </Window>
  );
}

/** Browsing someone else's stall. */
export function StallBrowseWindow({ client }: { client: GameClient }) {
  const v = useStore(client.ui, (s) => s.stallView);
  const gold = useStore(client.ui, (s) => s.inventory?.gold ?? 0);
  if (!v) return null;
  const close = () => client.ui.set({ stallView: null });
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-night/40 p-2" onClick={(e) => e.target === e.currentTarget && close()}>
      <Window title={`${v.name} — ${v.sellerName}`} onClose={close} testId="stall-browse">
        {v.items.length === 0 && <p className="text-sm">Sold out!</p>}
        <ul className="space-y-1">
          {v.items.map((it) => {
            const d = getItem(it.itemId)!;
            const total = it.price * it.quantity;
            return (
              <li key={it.slot} className="flex items-center gap-2 text-sm">
                <ItemSlot slot={it.slot} item={{ ...it, durability: null, bound: false }} size={30} />
                <span className="flex-1 truncate">
                  {d.name}
                  {it.enhance ? ` +${it.enhance}` : ''} ×{it.quantity}
                  <span className="block text-xs text-wood-dark/70">◉ {it.price.toLocaleString()} each</span>
                </span>
                <button className="px-btn green small" disabled={gold < total} onClick={() => void client.stallBuy(v.sellerId, it.slot, it.itemId, it.price)} data-testid={`stall-buy-${it.slot}`}>
                  ◉ {total.toLocaleString()}
                </button>
              </li>
            );
          })}
        </ul>
      </Window>
    </div>
  );
}
