'use client';

import { useEffect, useState } from 'react';
import { BALANCE, getCrop, getItem } from '@terrago/game-data';
import { QUALITIES, SKILL_IDS, SKILL_NAMES, SPEC_CHANGE_COST, SPEC_LEVEL, SPEC_MAX, getSpec, specsFor, cropStatus, formatDuration, type FarmUpgradeView, type InventorySlot } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { ItemSlot, RARITY_COLOR } from './ItemSlot';
import { Window } from './Window';

/** What an NPC pays per unit (mirrors the server's sellPrice). */
function sellPrice(s: InventorySlot): number {
  const def = getItem(s.itemId);
  if (!def) return 0;
  let price = def.vendorValue * (BALANCE.farming.qualityValue[s.quality] ?? 1);
  if (s.durability !== null && def.maxDurability) price *= Math.max(0.1, s.durability / def.maxDurability);
  return Math.floor(price);
}

export function ShopPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const shop = useStore(client.ui, (s) => s.shop);
  const inv = useStore(client.ui, (s) => s.inventory);
  const skills = useStore(client.ui, (s) => s.self?.skills);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [junk, setJunk] = useState<{ items: { slot: number; itemId: string; quantity: number; value: number }[]; total: number } | null>(null);
  if (!shop || !inv) return null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const sellable = inv.slots.filter((s) => {
    const d = getItem(s.itemId);
    return d && shop.buys.includes(d.category) && sellPrice(s) > 0;
  });

  return (
    <Window title={shop.name} onClose={onClose} testId="shop-panel" wide>
      <div className="mb-2 flex items-center gap-2">
        <button className={`px-btn small ${tab === 'buy' ? 'green' : 'ghost'}`} onClick={() => setTab('buy')} data-testid="shop-tab-buy">
          Buy
        </button>
        <button className={`px-btn small ${tab === 'sell' ? 'green' : 'ghost'}`} onClick={() => setTab('sell')} data-testid="shop-tab-sell">
          Sell
        </button>
        {shop.buys.some((c) => ['material', 'fish', 'crop'].includes(c)) && (
          <button className="px-btn small ghost" onClick={() => void client.junkQuote().then(setJunk)} title="Sell common loot (materials, fish, crops) not on your hotbar" data-testid="sell-junk">
            🧺 Sell junk
          </button>
        )}
        <span className="ml-auto text-sm font-bold text-gold-dark">◉ {inv.gold.toLocaleString()}</span>
      </div>
      {junk && (
        <div className="mb-2 border-2 border-wood-dark/40 bg-parchment-2 p-2 text-sm" data-testid="junk-confirm">
          {junk.items.length === 0 ? (
            <p>No junk to sell — common loot on your hotbar (slots 1–9) is kept.</p>
          ) : (
            <>
              <p className="font-bold">
                Sell {junk.items.reduce((n, i) => n + i.quantity, 0)} items for {junk.total.toLocaleString()} Gold?
              </p>
              <p className="text-xs text-wood-dark/80">{junk.items.map((i) => `${i.quantity}× ${getItem(i.itemId)?.name}`).join(', ')}</p>
            </>
          )}
          <div className="mt-2 flex gap-2">
            {junk.items.length > 0 && (
              <button
                className="px-btn green small"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await client.sellJunk();
                    setJunk(null);
                  })
                }
                data-testid="sell-junk-yes"
              >
                Sell all
              </button>
            )}
            <button className="px-btn ghost small" onClick={() => setJunk(null)}>
              {junk.items.length ? 'Cancel' : 'OK'}
            </button>
          </div>
        </div>
      )}
      {tab === 'buy' && (
        <ul className="space-y-1">
          {shop.sells.map((e) => {
            const def = getItem(e.itemId);
            if (!def) return null;
            const req = e.requires;
            const lvl = req ? (skills?.[req.skill as keyof typeof skills]?.level ?? 1) : 99;
            const locked = !!req && lvl < req.level;
            const n = qty[e.itemId] ?? 1;
            return (
              <li key={e.itemId} className={`flex items-center gap-2 border-2 border-parchment-3 bg-parchment-2 p-1 ${locked ? 'opacity-55' : ''}`}>
                <PixelIcon icon={def.icon} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" style={{ color: RARITY_COLOR[def.rarity] }}>
                    {def.name}
                  </p>
                  <p className="text-[11px] text-wood-dark">
                    {e.price} Gold{locked && req ? ` · needs ${req.skill} ${req.level}` : ''}
                  </p>
                </div>
                {def.stackSize > 1 && (
                  <select className="border-2 border-ink bg-parchment px-1 text-xs" value={n} onChange={(ev) => setQty({ ...qty, [e.itemId]: Number(ev.target.value) })} aria-label="Quantity">
                    {[1, 5, 10, 20].map((q) => (
                      <option key={q} value={q}>
                        ×{q}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="px-btn green small"
                  disabled={busy || locked || inv.gold < e.price * n}
                  onClick={() => act(() => client.buy(e.itemId, n))}
                  data-testid={`buy-${e.itemId}`}
                >
                  {e.price * n}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {tab === 'sell' && (
        <>
          {sellable.length === 0 && <p className="text-sm">Nothing in your bag that {shop.name} buys.</p>}
          <ul className="space-y-1">
            {sellable.map((s) => {
              const def = getItem(s.itemId)!;
              const unit = sellPrice(s);
              return (
                <li key={s.slot} className="flex items-center gap-2 border-2 border-parchment-3 bg-parchment-2 p-1">
                  <ItemSlot slot={s.slot} item={s} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold" style={{ color: RARITY_COLOR[def.rarity] }}>
                      {s.quality > 0 ? `${QUALITIES[s.quality]![0]!.toUpperCase()}${QUALITIES[s.quality]!.slice(1)} ` : ''}
                      {def.name}
                    </p>
                    <p className="text-[11px] text-wood-dark">{unit} Gold each</p>
                  </div>
                  <button className="px-btn small" disabled={busy} onClick={() => act(() => client.sell(s.slot, 1))} data-testid={`sell-${s.slot}`}>
                    Sell 1
                  </button>
                  {s.quantity > 1 && (
                    <button className="px-btn small" disabled={busy} onClick={() => act(() => client.sell(s.slot, s.quantity))}>
                      All ({unit * s.quantity})
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-wood-dark/80">Shops pay less than other players will. Try the marketplace for better prices.</p>
        </>
      )}
    </Window>
  );
}

export function FarmPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const npc = useStore(client.ui, (s) => s.serviceNpc);
  const inv = useStore(client.ui, (s) => s.inventory);
  const farming = useStore(client.ui, (s) => s.self?.skills.farming.level ?? 1);
  const [view, setView] = useState<FarmUpgradeView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (npc) client.farmInfo(npc).then(setView, (e: Error) => setErr(e.message));
  }, [client, npc, inv?.gold]);
  if (!npc) return null;
  const count = (id: string) => inv?.slots.filter((s) => s.itemId === id).reduce((n, s) => n + s.quantity, 0) ?? 0;
  return (
    <Window title="Expand your homestead" onClose={onClose} testId="farm-panel">
      {err && <p className="text-sm text-[#a33]">{err}</p>}
      {view && (
        <>
          <p className="text-sm">
            Your farm: <b>tier {view.tier}</b> · {view.plots} plots
          </p>
          {view.next ? (
            <div className="mt-2 border-2 border-parchment-3 bg-parchment-2 p-2 text-sm">
              <p className="font-bold">
                Tier {view.next.tier}: {view.next.plots} plots
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                <li className={farming >= view.next.farmingLevel ? 'text-leaf-dark' : 'text-[#a33]'}>
                  Farming level {view.next.farmingLevel} (you: {farming})
                </li>
                <li className={(inv?.gold ?? 0) >= view.next.gold ? 'text-leaf-dark' : 'text-[#a33]'}>{view.next.gold.toLocaleString()} Gold</li>
                {view.next.materials.map((m) => (
                  <li key={m.itemId} className={count(m.itemId) >= m.quantity ? 'text-leaf-dark' : 'text-[#a33]'}>
                    {m.quantity}× {getItem(m.itemId)?.name} (you have {count(m.itemId)})
                  </li>
                ))}
              </ul>
              <button className="px-btn green small mt-2" onClick={() => client.farmUpgrade(npc).then(() => client.farmInfo(npc).then(setView))} data-testid="farm-upgrade">
                Expand farm
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm">Your homestead is as large as it gets. Impressive.</p>
          )}
        </>
      )}
    </Window>
  );
}

export function RepairPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const npc = useStore(client.ui, (s) => s.serviceNpc);
  const inv = useStore(client.ui, (s) => s.inventory);
  const [quote, setQuote] = useState<{ cost: number; items: number } | null>(null);
  useEffect(() => {
    if (npc) client.repairQuote(npc).then(setQuote, () => setQuote(null));
  }, [client, npc, inv]);
  if (!npc) return null;
  return (
    <Window title="Repairs" onClose={onClose} testId="repair-panel">
      {!quote || quote.items === 0 ? (
        <p className="text-sm">&quot;Nothing in that bag needs my hammer. Come back when you&apos;ve broken something.&quot;</p>
      ) : (
        <>
          <p className="text-sm">
            Repair {quote.items} item{quote.items === 1 ? '' : 's'} for <b>{quote.cost} Gold</b>?
          </p>
          <button className="px-btn green small mt-2" disabled={(inv?.gold ?? 0) < quote.cost} onClick={() => client.repairAll(npc)} data-testid="repair-all">
            Repair all
          </button>
        </>
      )}
    </Window>
  );
}

export function SkillsPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const skills = useStore(client.ui, (s) => s.self?.skills);
  const specs = useStore(client.ui, (s) => s.self?.specs ?? {});
  const [open, setOpen] = useState<string | null>(null);
  if (!skills) return null;
  const used = Object.keys(specs).length;
  return (
    <Window title="Skills" onClose={onClose} testId="skills-panel">
      <h3 className="text-sm font-bold text-wood-dark">Professions</h3>
      <ul className="mt-1 space-y-1">
        {SKILL_IDS.map((id) => {
          const s = skills[id];
          const pct = s.next ? Math.min(100, (s.xp / s.next) * 100) : 100;
          return (
            <li key={id} className="text-xs" data-testid={`skill-${id}`}>
              <div className="flex">
                <span className="font-bold">{SKILL_NAMES[id]}</span>
                <span className="ml-auto">Lv {s.level}</span>
              </div>
              <div className="px-bar mt-0.5">
                <span style={{ width: `${pct}%`, background: '#5fa04a' }} />
              </div>
              {specsFor(id).length > 0 && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                  {specs[id] ? (
                    <span className="font-bold text-gold-dark">★ {getSpec(specs[id]!)?.name}</span>
                  ) : (
                    <span className="text-wood-dark/70">{s.level >= SPEC_LEVEL ? 'Ready to specialize' : `Specialize at Lv ${SPEC_LEVEL}`}</span>
                  )}
                  {s.level >= SPEC_LEVEL && (
                    <button className="ml-auto underline" onClick={() => setOpen(open === id ? null : id)} data-testid={`spec-open-${id}`}>
                      {specs[id] ? 'change' : 'choose'}
                    </button>
                  )}
                </div>
              )}
              {open === id && (
                <div className="mt-1 space-y-1 border-2 border-ink/30 bg-parchment-2/50 p-1">
                  {specsFor(id).map((sp) => (
                    <div key={sp.id} className="flex items-start gap-1">
                      <span className="flex-1">
                        <b>{sp.name}</b> — {sp.description}
                      </span>
                      <button
                        className="px-btn green small"
                        disabled={specs[id] === sp.id || (!specs[id] && used >= SPEC_MAX)}
                        onClick={async () => {
                          if (specs[id] && !confirm(`Retrain as ${sp.name} for ${SPEC_CHANGE_COST.toLocaleString()} Gold?`)) return;
                          await client.chooseSpec(id, sp.id);
                          setOpen(null);
                        }}
                        data-testid={`spec-${sp.id}`}
                      >
                        {specs[id] === sp.id ? 'Yours' : specs[id] ? `◉${SPEC_CHANGE_COST}` : 'Pick'}
                      </button>
                    </div>
                  ))}
                  {!specs[id] && used >= SPEC_MAX && <p className="text-[#a33]">You already have {SPEC_MAX} specializations.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-wood-dark/80">
        Professions level up to 100. Each level is slower than the last. At level {SPEC_LEVEL} you can specialize — at most {SPEC_MAX} professions, so trade with other specialists for the rest.
      </p>
    </Window>
  );
}

/** Small menu for a growing crop: status, fertilize, remove. */
export function PlotMenu({ client }: { client: GameClient }) {
  const id = useStore(client.ui, (s) => s.plotMenu);
  const [, force] = useState(0);
  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    const close = setTimeout(() => client.ui.set({ plotMenu: null }), 12000);
    return () => {
      clearInterval(t);
      clearTimeout(close);
    };
  }, [client, id]);
  const o = id ? client.objects.get(id) : undefined;
  if (!o || o.kind !== 'plot' || !o.crop) return null;
  const def = getCrop(o.crop.cropId);
  if (!def) return null;
  const st = cropStatus(o.crop, def, client.serverNow());
  const close = () => client.ui.set({ plotMenu: null });
  return (
    <div className="px-panel pointer-events-auto w-[min(92vw,300px)] p-2 text-sm" data-testid="plot-menu">
      <div className="flex items-center">
        <b>{def.name}</b>
        <button className="px-btn ghost small ml-auto" onClick={close} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="px-bar mt-1">
        <span style={{ width: `${Math.floor(st.progress * 100)}%`, background: '#5fa04a' }} />
      </div>
      <p className="mt-1 text-xs">
        {st.ready ? 'Ready to harvest!' : st.watered ? `Ready in ${formatDuration(st.remainingMs ?? 0)}` : 'Dry soil — water it to keep it growing.'}
        {o.crop.fertilizer && ` · ${getItem(o.crop.fertilizer)?.name}`}
      </p>
      <div className="mt-2 flex gap-2">
        {!o.crop.fertilizer && !st.ready && (
          <button
            className="px-btn green small"
            onClick={() => {
              client.act(o.x, o.y, 'fertilize');
              close();
            }}
          >
            Fertilize
          </button>
        )}
        <button
          className="px-btn small"
          onClick={() => {
            if (window.confirm(`Remove this ${def.name.toLowerCase()}? You won't get anything back.`)) client.act(o.x, o.y, 'clear');
            close();
          }}
        >
          Remove crop
        </button>
      </div>
    </div>
  );
}
