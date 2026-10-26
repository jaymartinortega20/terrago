'use client';

import { useEffect, useMemo, useState } from 'react';
import { GEM_PACKS, GEM_REASON_LABEL, OUTFITS, PREMIUM_COSMETICS, getMountStyle, type GemShopState, type PremiumCosmetic } from '@terrago/shared';
import { characterPreview } from '../art/characters';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

const fmt = (n: number) => n.toLocaleString();

/** Gem Shop: buy Gems with GCash / Maya / card (PayMongo) and spend them on cosmetics. */
export function GemShopPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const self = useStore(client.ui, (s) => s.self);
  const balance = useStore(client.ui, (s) => s.gems);
  const [state, setState] = useState<GemShopState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'shop' | 'gems' | 'history'>('shop');
  const load = () => client.gemShop().then(setState, (e: Error) => setErr(e.message));
  useEffect(() => {
    void load();
    // Gems bought in another tab arrive while this is open.
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const previews = useMemo(() => {
    if (!self || typeof document === 'undefined') return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const c of PREMIUM_COSMETICS) {
      if (c.kind !== 'outfit') continue;
      const i = OUTFITS.findIndex((o) => o.name === c.ref);
      if (i >= 0) out[c.id] = characterPreview({ ...self.appearance, outfit: i }, 'down', 3).toDataURL();
    }
    return out;
  }, [self]);

  const gems = balance ?? state?.balance ?? 0;
  const off = state?.payments === 'off';

  const buyPack = async (id: string) => {
    setErr(null);
    setBusy(id);
    // Open the tab right away (browsers block pop-ups opened after a wait).
    const w = window.open('', '_blank');
    try {
      const r = await client.gemCheckout(id);
      if (w) w.location.href = r.url;
      else window.location.href = r.url;
    } catch (e) {
      w?.close();
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  const buyCosmetic = async (c: PremiumCosmetic) => {
    if (!confirm(`Buy ${c.name} for ${fmt(c.gems)} Gems?`)) return;
    setBusy(c.id);
    const r = await client.gemBuy(c.id);
    if (r) setState(r);
    setBusy(null);
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-2 backdrop-blur-[2px]" onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="gem-shop">
      <section className="relative flex max-h-[92dvh] w-[min(96vw,760px)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#151b2e]/95 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="text-2xl">💎</span>
          <h2 className="text-lg font-bold text-parchment">Gem Shop</h2>
          <span className="ml-auto rounded-full bg-[#3f7fd0]/30 px-3 py-1 font-bold text-[#bfe0ff]" data-testid="gem-balance">
            💎 {fmt(gems)}
          </span>
          <button className="ml-1 h-8 w-8 rounded-full bg-white/10 text-parchment" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <nav className="flex gap-1 px-4 pt-3">
          {(
            [
              ['shop', 'Cosmetics'],
              ['gems', 'Get Gems'],
              ['history', 'History'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`rounded-full px-3 py-1 text-sm font-bold ${tab === id ? 'bg-gold text-ink' : 'bg-white/10 text-parchment'}`} onClick={() => setTab(id)} data-testid={`gem-tab-${id}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {err && <p className="mb-2 rounded bg-[#b8402f]/30 px-2 py-1 text-sm text-[#ffc8b8]">{err}</p>}
          {!state ? (
            <p className="text-parchment/70">Loading…</p>
          ) : tab === 'shop' ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PREMIUM_COSMETICS.map((c) => {
                const owned = state.owned.includes(c.id);
                return (
                  <div key={c.id} className="flex flex-col rounded-xl bg-black/30 p-2" data-testid={`cosmetic-${c.id}`}>
                    <div className="flex h-28 items-center justify-center rounded-lg" style={{ background: `radial-gradient(circle, ${c.color}55, transparent 70%)` }}>
                      {previews[c.id] ? (
                        <img src={previews[c.id]} alt="" width={48} height={72} style={{ imageRendering: 'pixelated', width: 64, height: 96 }} />
                      ) : (
                        <span className="h-14 w-14 rounded-xl border-2 border-white/40" style={{ background: getMountStyle(c.ref)?.color ?? c.color }} />
                      )}
                    </div>
                    <p className="mt-1 text-sm font-bold text-parchment">{c.name}</p>
                    <p className="flex-1 text-[11px] text-parchment/70">
                      {c.kind === 'outfit' ? 'Outfit · all your characters' : 'Mount gear · all your characters'}. {c.text}
                    </p>
                    <button
                      className="mt-1.5 rounded-full bg-[#3f7fd0] px-3 py-1 text-sm font-bold text-white disabled:opacity-40"
                      disabled={owned || !!busy || gems < c.gems}
                      onClick={() => void buyCosmetic(c)}
                      data-testid={`buy-${c.id}`}
                    >
                      {owned ? '✓ Owned' : `💎 ${fmt(c.gems)}`}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : tab === 'gems' ? (
            <>
              {off && <p className="mb-2 rounded bg-white/10 px-2 py-1 text-sm text-parchment">Gem purchases open soon. You can already earn Gems by selling items for Gems on the Marketplace.</p>}
              {state.payments === 'test' && <p className="mb-2 rounded bg-[#e8a03a]/25 px-2 py-1 text-xs text-[#ffe0b0]">Test mode: use PayMongo test cards — no real money is charged.</p>}
              {state.payments === 'fake' && <p className="mb-2 rounded bg-[#e8a03a]/25 px-2 py-1 text-xs text-[#ffe0b0]">Development mode: a pretend checkout, no money involved.</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {GEM_PACKS.map((p) => (
                  <button
                    key={p.id}
                    className="relative flex flex-col items-center rounded-xl bg-black/30 p-3 text-parchment disabled:opacity-40"
                    disabled={off || !!busy}
                    onClick={() => void buyPack(p.id)}
                    data-testid={`pack-${p.id}`}
                  >
                    {p.tag && <span className="absolute top-1 right-1 rounded-full bg-gold px-2 text-[10px] font-bold text-ink">{p.tag}</span>}
                    <span className="text-3xl">💎</span>
                    <span className="text-lg font-bold">{fmt(p.gems + p.bonus)}</span>
                    {p.bonus > 0 && <span className="text-[11px] text-leaf">incl. +{fmt(p.bonus)} bonus</span>}
                    <span className="mt-1 rounded-full bg-gold px-3 py-0.5 text-sm font-bold text-ink">₱{fmt(p.php)}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-snug text-parchment/60">
                Pay with GCash, Maya, cards or QR Ph through PayMongo. Gems are added to your account (all characters) as soon as the payment clears. Gems are for cosmetics and trading in-game only: they have no cash value, can&apos;t be exchanged back into money, and purchases are final except where the law requires otherwise. TerraGo never sells power — everything in the Gem Shop is cosmetic.
              </p>
            </>
          ) : (
            <ul className="space-y-1 text-sm text-parchment" data-testid="gem-history">
              {state.history.length === 0 && <li className="text-parchment/60">No Gem activity yet.</li>}
              {state.history.map((h, i) => (
                <li key={i} className="flex items-center gap-2 rounded bg-black/20 px-2 py-1">
                  <span className="flex-1">{GEM_REASON_LABEL[h.reason] ?? h.reason}</span>
                  <span className={h.amount > 0 ? 'text-leaf' : 'text-[#ffb0a0]'}>
                    {h.amount > 0 ? '+' : ''}
                    {fmt(h.amount)}
                  </span>
                  <span className="w-20 text-right text-parchment/60">{fmt(h.balance)}</span>
                  <span className="w-24 text-right text-[11px] text-parchment/50">{new Date(h.at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
