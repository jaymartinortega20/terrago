'use client';

import { useEffect, useMemo, useState } from 'react';
import { ITEMS, MAPS } from '@terrago/game-data';
import { OUTFITS } from '@terrago/shared';
import { adminApi } from '@/lib/api';

type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

const RARITY_TEXT: Record<string, string> = {
  common: '#4a321e',
  uncommon: '#2f7a3a',
  rare: '#2f5fa8',
  epic: '#7a3aa8',
  legendary: '#b8701a',
  mythic: '#c0302a',
};
const CATEGORIES = ['all', ...new Set(ITEMS.map((i) => i.category))];
const RARITIES = ['any', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const SKINS = OUTFITS.map((o, i) => ({ ...o, i })).filter((o) => o.exclusive);
const PLACES = Object.values(MAPS)
  .filter((m) => !m.dungeon)
  .map((m) => ({ id: m.id, name: m.name }));

const fmt = (n: number) => n.toLocaleString();

/**
 * Game Master tools for one character: give any items and Gold, set Gold,
 * level and professions, heal, unlock waystones, teleport, and give skins.
 * Everything is logged (ledger + admin log).
 */
export function GmPanel({ target, act, onClose }: { target: { id: string; name: string }; act: Act; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [rarity, setRarity] = useState('any');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [gold, setGold] = useState(0);
  const [exactGold, setExactGold] = useState('');
  const [level, setLevel] = useState('');
  const [prof, setProf] = useState('');
  const [place, setPlace] = useState('greenhaven');
  const [tx, setTx] = useState('');
  const [ty, setTy] = useState('');
  const [skins, setSkins] = useState<number[] | null>(null);

  useEffect(() => {
    setCart(new Map());
    setGold(0);
    void adminApi.get<{ skins: number[] }>(`player?id=${target.id}`).then((d) => setSkins(d.skins ?? []));
  }, [target.id]);

  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ITEMS.filter((i) => (cat === 'all' || i.category === cat) && (rarity === 'any' || i.rarity === rarity) && (!s || i.name.toLowerCase().includes(s) || i.id.includes(s)));
  }, [q, cat, rarity]);

  const add = (id: string, n = 1) =>
    setCart((c) => {
      const next = new Map(c);
      next.set(id, Math.min(9999, (next.get(id) ?? 0) + n));
      return next;
    });
  const items = [...cart].map(([itemId, quantity]) => ({ itemId, quantity }));
  const send = () =>
    act(
      () =>
        adminApi.post<{ bag: number; bank: number; leftover: { itemId: string; quantity: number }[] }>('give', { characterId: target.id, gold, items }).then((r) => {
          setCart(new Map());
          setGold(0);
          if (r.leftover.length) alert(`Bag and bank are full: ${r.leftover.map((l) => `${l.quantity}× ${ITEMS.find((i) => i.id === l.itemId)?.name}`).join(', ')} could not be delivered.`);
        }),
      `Sent to ${target.name}.`,
    );

  return (
    <div className="px-panel mt-2 p-3 text-sm" data-testid="gm-panel">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-bold">🛠 Game Master · {target.name}</h3>
        <button className="px-btn ghost small ml-auto" onClick={onClose}>
          Close
        </button>
      </div>

      {/* --- Give items and Gold --- */}
      <h4 className="mt-2 font-bold">Give items & Gold</h4>
      <div className="mt-1 flex flex-wrap gap-1">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" className="w-44 border-2 border-ink bg-parchment px-1" data-testid="gm-search" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="border-2 border-ink bg-parchment capitalize" aria-label="Category">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)} className="border-2 border-ink bg-parchment capitalize" aria-label="Rarity">
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="px-btn ghost small" onClick={() => found.forEach((i) => add(i.id, 1))} disabled={!found.length || found.length > 200} title="Add one of every item in this list">
          Add all {found.length > 200 ? '(narrow it down)' : `(${found.length})`}
        </button>
      </div>
      <ul className="mt-1 grid max-h-48 grid-cols-1 gap-x-3 overflow-y-auto border-2 border-ink/30 bg-parchment-2/40 p-1 sm:grid-cols-2" data-testid="gm-items">
        {found.slice(0, 150).map((i) => (
          <li key={i.id} className="flex items-center gap-1 border-b border-ink/10 py-0.5">
            <span className="flex-1 truncate" style={{ color: RARITY_TEXT[i.rarity] ?? undefined }} title={`${i.id} · ${i.rarity} ${i.category}`}>
              {i.name}
            </span>
            <span className="text-[10px] capitalize text-wood-dark/60">{i.category}</span>
            {[1, 10, 99].map((n) => (
              <button key={n} className="border border-ink px-1 text-[10px] hover:bg-gold/40" onClick={() => add(i.id, n)} data-testid={n === 1 ? `gm-add-${i.id}` : undefined}>
                +{n}
              </button>
            ))}
          </li>
        ))}
        {found.length > 150 && <li className="text-xs italic">…{found.length - 150} more, search to narrow down</li>}
      </ul>
      {cart.size > 0 && (
        <div className="mt-2 border-2 border-gold/60 bg-gold/10 p-1" data-testid="gm-cart">
          <div className="flex items-center">
            <b>To send ({cart.size})</b>
            <button className="ml-auto text-xs underline" onClick={() => setCart(new Map())}>
              clear
            </button>
          </div>
          <ul className="max-h-36 overflow-y-auto">
            {items.map((it) => (
              <li key={it.itemId} className="flex items-center gap-1 py-0.5">
                <span className="flex-1 truncate">{ITEMS.find((x) => x.id === it.itemId)?.name}</span>
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={it.quantity}
                  onChange={(e) =>
                    setCart((c) => {
                      const n = new Map(c);
                      n.set(it.itemId, Math.max(1, Math.min(9999, Number(e.target.value) || 1)));
                      return n;
                    })
                  }
                  className="w-16 border border-ink bg-parchment px-1"
                />
                <button
                  className="px-1 text-berry"
                  onClick={() =>
                    setCart((c) => {
                      const n = new Map(c);
                      n.delete(it.itemId);
                      return n;
                    })
                  }
                  aria-label="Remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <label>
          Gold <input type="number" min={0} value={gold} onChange={(e) => setGold(Math.max(0, Number(e.target.value)))} className="w-32 border-2 border-ink bg-parchment px-1" data-testid="gm-gold" />
        </label>
        {[1_000, 100_000, 1_000_000, 100_000_000].map((n) => (
          <button key={n} className="border border-ink px-1 text-xs hover:bg-gold/40" onClick={() => setGold((g) => Math.min(1_000_000_000, g + n))}>
            +{n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}K`}
          </button>
        ))}
        <button className="px-btn green small ml-auto" disabled={!gold && !cart.size} onClick={send} data-testid="gm-send">
          Send{gold ? ` ${fmt(gold)} Gold` : ''}
          {cart.size ? ` + ${items.reduce((a, i) => a + i.quantity, 0)} items` : ''}
        </button>
      </div>
      <p className="text-[11px] text-wood-dark/70">Items go to the bag first, then the bank if the bag is full. Everything is recorded as an admin gift.</p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {/* --- Character --- */}
        <div>
          <h4 className="font-bold">Character</h4>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <label>
              Set Gold to <input type="number" min={0} value={exactGold} onChange={(e) => setExactGold(e.target.value)} className="w-32 border-2 border-ink bg-parchment px-1" />
            </label>
            <button className="px-btn small" disabled={exactGold === ''} onClick={() => act(() => adminApi.post('gold', { characterId: target.id, gold: Number(exactGold) }), `Gold set to ${fmt(Number(exactGold))}.`)}>
              Set
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <label>
              Level <input type="number" min={1} max={100} value={level} onChange={(e) => setLevel(e.target.value)} placeholder="1–100" className="w-16 border-2 border-ink bg-parchment px-1" data-testid="gm-level" />
            </label>
            <label>
              Professions <input type="number" min={1} max={100} value={prof} onChange={(e) => setProf(e.target.value)} placeholder="1–100" className="w-16 border-2 border-ink bg-parchment px-1" />
            </label>
            <button className="px-btn small" disabled={!level && !prof} onClick={() => act(() => adminApi.post('level', { characterId: target.id, level, professions: prof }), 'Levels set.')} data-testid="gm-level-set">
              Set
            </button>
            <button className="border border-ink px-1 text-xs hover:bg-gold/40" onClick={() => (setLevel('100'), setProf('100'))}>
              max
            </button>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <button className="px-btn small" onClick={() => act(() => adminApi.post('heal', { characterId: target.id }), 'Full HP, MP and energy.')}>
              Heal fully
            </button>
            <button className="px-btn small" onClick={() => act(() => adminApi.post('waystones', { characterId: target.id }), 'All waystones unlocked.')}>
              Unlock all waystones
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <select value={place} onChange={(e) => setPlace(e.target.value)} className="border-2 border-ink bg-parchment" aria-label="Map">
              {PLACES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input value={tx} onChange={(e) => setTx(e.target.value)} placeholder="x" className="w-10 border-2 border-ink bg-parchment px-1" />
            <input value={ty} onChange={(e) => setTy(e.target.value)} placeholder="y" className="w-10 border-2 border-ink bg-parchment px-1" />
            <button className="px-btn small" onClick={() => act(() => adminApi.post('teleport', { characterId: target.id, mapId: place, x: tx, y: ty }), 'Teleported.')}>
              Teleport
            </button>
          </div>
        </div>

        {/* --- Skins --- */}
        <div>
          <h4 className="font-bold">Exclusive skins</h4>
          <ul className="mt-1 space-y-0.5" data-testid="gm-skins">
            {SKINS.map((s) => {
              const has = skins?.includes(s.i);
              return (
                <li key={s.i} className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 border border-ink" style={{ background: s.shirt }} />
                  <span className="flex-1">
                    {s.name}
                    {has ? ' ✓' : ''}
                  </span>
                  {!has && (
                    <button className="border border-ink px-1 text-xs hover:bg-gold/40" onClick={() => act(() => adminApi.post<{ owned: number[] }>('skin', { characterId: target.id, outfit: s.i }).then((r) => setSkins(r.owned)), `${s.name} given.`)}>
                      Give
                    </button>
                  )}
                  <button
                    className="border border-ink px-1 text-xs hover:bg-gold/40"
                    onClick={() => act(() => adminApi.post<{ owned: number[] }>('skin', { characterId: target.id, outfit: s.i, wear: true }).then((r) => setSkins(r.owned)), `${s.name} given and worn.`)}
                    data-testid={`gm-skin-wear-${s.i}`}
                  >
                    {has ? 'Wear' : 'Give & wear'}
                  </button>
                  {has && (
                    <button className="px-1 text-xs text-berry" onClick={() => act(() => adminApi.post<{ owned: number[] }>('skin', { characterId: target.id, outfit: s.i, revoke: true }).then((r) => setSkins(r.owned)), `${s.name} removed.`)}>
                      remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            className="px-btn ghost small mt-1"
            onClick={() =>
              act(async () => {
                let owned: number[] = [];
                for (const s of SKINS) owned = (await adminApi.post<{ owned: number[] }>('skin', { characterId: target.id, outfit: s.i })).owned;
                setSkins(owned);
              }, 'All skins given.')
            }
          >
            Give all skins
          </button>
        </div>
      </div>
    </div>
  );
}

/** The admin's own characters, for quick "give to myself". */
export function MyCharacters({ onPick }: { onPick: (c: { id: string; name: string }) => void }) {
  const [mine, setMine] = useState<{ id: string; name: string; level: number }[]>([]);
  useEffect(() => void adminApi.get<{ characters: typeof mine }>('mine').then((r) => setMine(r.characters)), []);
  if (!mine.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-sm" data-testid="gm-mine">
      <b>⭐ Me:</b>
      {mine.map((c) => (
        <button key={c.id} className="px-btn small green" onClick={() => onPick(c)}>
          {c.name} (Lv {c.level})
        </button>
      ))}
    </div>
  );
}
