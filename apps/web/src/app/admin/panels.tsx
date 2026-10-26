'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';

type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

/** Gold created (faucets) and removed (sinks). Validated pair on parchment. */
const IN_COLOR = '#1f8a70';
const OUT_COLOR = '#c9772e';

const n = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString();
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');
const label = (reason: string) => reason.replace(/_/g, ' ');

interface Economy {
  days: number;
  totals: { created: number; removed: number; net: number; supply: number; playerGold: number; guildGold: number; holders: number; gems?: number; gemsBought30d?: number };
  sources: { reason: string; amount: number }[];
  sinks: { reason: string; amount: number }[];
  daily: { day: string; created: number; removed: number }[];
  market: { trades: number; volume: number; tax: number; stallTrades: number; stallVolume: number; directTrades: number; directTradeGold: number };
  topItems: { item_id: string; name: string; rarity: string; trades: number; quantity: number; volume: number; avg_price: number; min_price: number; max_price: number }[];
  rare: { item_id: string; name: string; rarity: string; reason: string; quantity: number }[];
  suspicious: {
    bigMoves: { id: number; character_id: string; name: string; amount: number; reason: string; created_at: string }[];
    giftTrades: { id: number; created_at: string; a_name: string; b_name: string; a_gold: number; b_gold: number }[];
    overpriced: { id: number; name: string; total: number; quantity: number; unit: number; median: number; seller: string; buyer: string; created_at: string }[];
    openFlags: number;
  };
}

function Tile({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="px-panel p-3">
      <div className="text-xs text-wood-dark/80">{k}</div>
      <div className="text-2xl font-bold tabular-nums">{v}</div>
      {note && <div className="text-xs text-wood-dark/70">{note}</div>}
    </div>
  );
}

/** Horizontal bars: one row per reason, value written beside the bar. */
function BarList({ rows, color, testId }: { rows: { reason: string; amount: number }[]; color: string; testId: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  if (!rows.length) return <p className="text-sm text-wood-dark/70">Nothing in this period.</p>;
  return (
    <ul className="space-y-1" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.reason} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2 text-sm" title={`${label(r.reason)}: ${n(r.amount)} Gold`}>
          <span className="truncate capitalize">{label(r.reason)}</span>
          <span className="h-3 bg-ink/10">
            <span className="block h-3 rounded-r-[4px]" style={{ width: `${Math.max(2, (r.amount / max) * 100)}%`, background: color }} />
          </span>
          <span className="tabular-nums">{n(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Created vs removed per day: paired bars, hover for exact numbers. */
function DailyChart({ rows }: { rows: Economy['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <p className="text-sm text-wood-dark/70">No gold movement in this period.</p>;
  const W = 640;
  const H = 160;
  const pad = 24;
  const max = Math.max(1, ...rows.flatMap((r) => [r.created, r.removed]));
  const slot = (W - pad) / rows.length;
  const bw = Math.max(3, Math.min(18, slot / 2 - 3));
  const y = (v: number) => H - pad - (v / max) * (H - pad - 8);
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="relative">
      <div className="mb-1 flex gap-4 text-xs">
        <span className="flex items-center gap-1">
          <i className="inline-block h-3 w-3 rounded-sm" style={{ background: IN_COLOR }} /> Created
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-3 w-3 rounded-sm" style={{ background: OUT_COLOR }} /> Removed
        </span>
        <span className="ml-auto tabular-nums">{h ? `${h.day}: +${n(h.created)} / −${n(h.removed)}` : 'Hover a day for numbers'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gold created and removed per day" data-testid="economy-daily">
        <line x1={pad} x2={W} y1={H - pad} y2={H - pad} stroke="#2a2030" strokeOpacity={0.35} />
        <line x1={pad} x2={W} y1={8} y2={8} stroke="#2a2030" strokeOpacity={0.12} strokeDasharray="3 3" />
        <text x={pad + 2} y={6} fontSize={9} fill="#4a321e">
          max {n(max)} Gold/day
        </text>
        {rows.map((r, i) => {
          const cx = pad + slot * i + slot / 2;
          return (
            <g key={r.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H - pad} fill={hover === i ? '#2a2030' : 'transparent'} fillOpacity={0.06} />
              <rect x={cx - bw - 1} y={y(r.created)} width={bw} height={H - pad - y(r.created)} rx={2} fill={IN_COLOR} />
              <rect x={cx + 1} y={y(r.removed)} width={bw} height={H - pad - y(r.removed)} rx={2} fill={OUT_COLOR} />
              {(rows.length <= 10 || i % Math.ceil(rows.length / 10) === 0) && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={9} fill="#4a321e">
                  {r.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function EconomyTab({ onPlayer }: { onPlayer: (id: string) => void }) {
  const [days, setDays] = useState(7);
  const [e, setE] = useState<Economy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    adminApi
      .get<Economy>(`economy?days=${days}`)
      .then(setE)
      .catch((x) => setErr((x as Error).message));
  }, [days]);
  if (err) return <p className="px-panel p-3 text-berry">{err}</p>;
  if (!e) return <p>Loading…</p>;
  const t = e.totals;
  const s = e.suspicious;
  return (
    <div data-testid="admin-economy">
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <span className="text-sm font-bold">Period:</span>
        {[1, 7, 30, 90].map((d) => (
          <button key={d} className={`px-btn small ${days === d ? 'green' : 'ghost'}`} onClick={() => setDays(d)}>
            {d === 1 ? '24 hours' : `${d} days`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile k="Gold created" v={n(t.created)} note="quests, loot, NPC sales…" />
        <Tile k="Gold removed" v={n(t.removed)} note="repairs, fees, taxes…" />
        <Tile k="Net change" v={`${t.net >= 0 ? '+' : '−'}${n(Math.abs(t.net))}`} note={t.net > 0 ? 'inflation: more in than out' : 'deflation: more out than in'} />
        <Tile k="Gold in circulation" v={n(t.supply)} note={`${n(t.playerGold)} players · ${n(t.guildGold)} guilds`} />
        <Tile k="Gems held" v={n(t.gems ?? 0)} note={`${n(t.gemsBought30d ?? 0)} bought in 30 days`} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="px-panel p-3">
          <h3 className="font-bold">Gold by source</h3>
          <BarList rows={e.sources} color={IN_COLOR} testId="economy-sources" />
        </div>
        <div className="px-panel p-3">
          <h3 className="font-bold">Gold by sink</h3>
          <BarList rows={e.sinks} color={OUT_COLOR} testId="economy-sinks" />
        </div>
      </div>

      <div className="px-panel mt-3 p-3">
        <h3 className="font-bold">Per day</h3>
        <DailyChart rows={e.daily} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile k="Marketplace sales" v={n(e.market.trades)} note={`${n(e.market.volume)} Gold · ${n(e.market.tax)} tax`} />
        <Tile k="Stall sales" v={n(e.market.stallTrades)} note={`${n(e.market.stallVolume)} Gold`} />
        <Tile k="Direct trades" v={n(e.market.directTrades)} note={`${n(e.market.directTradeGold)} Gold moved`} />
        <Tile k="Open anti-bot flags" v={n(s.openFlags)} note="see the Flags tab" />
      </div>

      <div className="px-panel mt-3 overflow-x-auto p-3">
        <h3 className="font-bold">Most traded items (marketplace)</h3>
        <table className="w-full text-sm" data-testid="economy-items">
          <thead>
            <tr className="text-left text-xs">
              <th>Item</th>
              <th className="text-right">Sales</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Volume</th>
              <th className="text-right">Avg price</th>
              <th className="text-right">Low – high</th>
            </tr>
          </thead>
          <tbody>
            {e.topItems.length === 0 && (
              <tr>
                <td colSpan={6}>No marketplace sales yet.</td>
              </tr>
            )}
            {e.topItems.map((r) => (
              <tr key={r.item_id} className="border-b border-ink/20">
                <td className="py-1">
                  {r.name} <span className="text-xs capitalize text-wood-dark/70">{r.rarity}</span>
                </td>
                <td className="text-right tabular-nums">{n(r.trades)}</td>
                <td className="text-right tabular-nums">{n(r.quantity)}</td>
                <td className="text-right tabular-nums">{n(r.volume)}</td>
                <td className="text-right tabular-nums">{n(r.avg_price)}</td>
                <td className="text-right tabular-nums">
                  {n(Math.round(r.min_price))} – {n(Math.round(r.max_price))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-panel mt-3 overflow-x-auto p-3">
        <h3 className="font-bold">Rare items created</h3>
        <table className="w-full text-sm">
          <tbody>
            {e.rare.length === 0 && (
              <tr>
                <td>None in this period.</td>
              </tr>
            )}
            {e.rare.map((r) => (
              <tr key={`${r.item_id}-${r.reason}`} className="border-b border-ink/20">
                <td className="py-1">{r.name}</td>
                <td className="capitalize">{r.rarity}</td>
                <td className="capitalize">{label(r.reason)}</td>
                <td className="text-right tabular-nums">×{n(r.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-panel mt-3 p-3" data-testid="economy-suspicious">
        <h3 className="font-bold">⚠ Suspicious transactions</h3>
        <p className="text-xs text-wood-dark/70">Patterns worth a look, not proof. Click a name to open their history.</p>
        <h4 className="mt-2 text-sm font-bold">Gold given away in trades (nothing back)</h4>
        {s.giftTrades.length === 0 ? (
          <p className="text-sm">None.</p>
        ) : (
          <ul className="text-sm">
            {s.giftTrades.map((g) => (
              <li key={g.id}>
                {when(g.created_at)} · <b>{g.a_gold ? g.a_name : g.b_name}</b> gave <b>{n(g.a_gold || g.b_gold)}</b> Gold to <b>{g.a_gold ? g.b_name : g.a_name}</b>
              </li>
            ))}
          </ul>
        )}
        <h4 className="mt-2 text-sm font-bold">Marketplace sales over 5× the usual price</h4>
        {s.overpriced.length === 0 ? (
          <p className="text-sm">None.</p>
        ) : (
          <ul className="text-sm">
            {s.overpriced.map((o) => (
              <li key={o.id}>
                {when(o.created_at)} · {o.seller} → {o.buyer}: {o.quantity}× {o.name} for {n(o.total)} ({n(Math.round(o.unit))} each, usual {n(Math.round(o.median))})
              </li>
            ))}
          </ul>
        )}
        <h4 className="mt-2 text-sm font-bold">Large gold movements (50,000+)</h4>
        {s.bigMoves.length === 0 ? (
          <p className="text-sm">None.</p>
        ) : (
          <ul className="text-sm">
            {s.bigMoves.map((m) => (
              <li key={m.id}>
                {when(m.created_at)} ·{' '}
                <button className="font-bold underline" onClick={() => onPlayer(m.character_id)}>
                  {m.name}
                </button>{' '}
                {m.amount > 0 ? '+' : '−'}
                {n(Math.abs(m.amount))} ({label(m.reason)})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anti-bot flags
// ---------------------------------------------------------------------------

interface Flag {
  id: number;
  kind: string;
  details: Record<string, unknown>;
  created_at: string;
  ip: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  character_id: string | null;
  character_name: string | null;
  user_id: string | null;
  email: string | null;
  user_status: string | null;
  reviewed_by: string | null;
}

const FLAG_HELP: Record<string, string> = {
  bot_timing: 'Actions at near-perfect regular intervals',
  bot_loop: 'Hundreds of actions on very few tiles',
  bot_marathon: 'Active for many hours without a break',
  trade_ring: 'Lots of trades with the same partner',
  multi_account: 'Many new accounts from one address',
  movement_flood: 'Sent movement faster than possible',
  socket_flood: 'Flooded the server with messages',
  duplicate_login: 'Same character logged in twice',
};

export function FlagsTab({ act, onPlayer }: { act: Act; onPlayer: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<Flag[] | null>(null);
  const load = useCallback(() => void adminApi.get<{ flags: Flag[] }>(`flags${all ? '?status=all' : ''}`).then((r) => setRows(r.flags)), [all]);
  useEffect(load, [load]);
  if (!rows) return <p>Loading…</p>;
  const review = (f: Flag, verdict: 'cleared' | 'actioned') => {
    const note = prompt(verdict === 'cleared' ? 'Why is this fine? (optional)' : 'What did you do? (optional)', '') ?? '';
    void act(() => adminApi.post('flag', { id: f.id, verdict, note }).then(load), verdict === 'cleared' ? 'Flag cleared.' : 'Flag marked as handled.');
  };
  return (
    <>
      <p className="text-sm">Anti-bot signals are only recorded, never acted on automatically. Review them here and ban from the player view if needed.</p>
      <label className="text-sm">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show reviewed too
      </label>
      {rows.length === 0 && <p className="px-panel mt-2 p-3">No open flags. 🎉</p>}
      <div className="mt-2 space-y-2" data-testid="admin-flags">
        {rows.map((f) => (
          <article key={f.id} className="px-panel p-3 text-sm">
            <p>
              <b>{f.kind.replace(/_/g, ' ')}</b> · {FLAG_HELP[f.kind] ?? ''} · {when(f.created_at)}
            </p>
            <p className="mt-1">
              {f.character_id ? (
                <button className="font-bold underline" onClick={() => onPlayer(f.character_id!)}>
                  {f.character_name}
                </button>
              ) : (
                <b>{f.email ?? 'unknown account'}</b>
              )}
              {f.email && f.character_id ? ` · ${f.email}` : ''}
              {f.ip ? ` · IP ${f.ip}` : ''}
              {f.user_status && f.user_status !== 'active' ? ` · account ${f.user_status}` : ''}
            </p>
            <p className="mt-1 font-mono text-xs">{JSON.stringify(f.details)}</p>
            {f.reviewed_at ? (
              <p className="mt-1 text-xs italic">
                Reviewed {when(f.reviewed_at)} by {f.reviewed_by ?? '—'}: {f.review_note}
              </p>
            ) : (
              <div className="mt-2 flex gap-1">
                <button className="px-btn green small" onClick={() => review(f, 'cleared')}>
                  It&apos;s fine
                </button>
                <button className="px-btn small" onClick={() => review(f, 'actioned')}>
                  Handled
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// One player in detail
// ---------------------------------------------------------------------------

interface Detail {
  character: Record<string, unknown> & { id: string; name: string; level: number; gold: number; email: string; status: string; online: boolean; map_id: string; class_id: string };
  items: { container: string; slot: number; item_id: string; name: string; rarity: string; quantity: number; durability: number | null }[];
  gold: { id: number; amount: number; balance_after: number; reason: string; ref_type: string | null; created_at: string }[];
  itemLog: { id: number; name: string; quantity: number; reason: string; created_at: string; outgoing: boolean; from_name: string; to_name: string }[];
  trades: { id: number; created_at: string; a_name: string; b_name: string; a_gold: number; b_gold: number; a_items: { itemId: string; quantity: number }[]; b_items: { itemId: string; quantity: number }[] }[];
  market: { id: number; created_at: string; name: string; quantity: number; total: number; seller: string; buyer: string }[];
  flags: { id: number; kind: string; created_at: string; review_note: string | null }[];
  reports: { id: number; reason: string; status: string; created_at: string; reporter: string }[];
  alts: { id: string; name: string; level: number }[];
}

export function PlayerDetail({ id, onClose, onPlayer }: { id: string; onClose: () => void; onPlayer: (id: string) => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<'items' | 'gold' | 'itemlog' | 'trades' | 'flags'>('items');
  useEffect(() => {
    setD(null);
    void adminApi.get<Detail>(`player?id=${id}`).then(setD);
  }, [id]);
  if (!d) return <p className="px-panel mt-2 p-3">Loading player…</p>;
  const c = d.character;
  const tabs: [typeof tab, string][] = [
    ['items', `Inventory (${d.items.length})`],
    ['gold', `Gold history (${d.gold.length})`],
    ['itemlog', `Item history (${d.itemLog.length})`],
    ['trades', `Trades (${d.trades.length + d.market.length})`],
    ['flags', `Flags & reports (${d.flags.length + d.reports.length})`],
  ];
  return (
    <div className="px-panel mt-2 p-3 text-sm" data-testid="admin-player-detail">
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <h3 className="text-lg font-bold">
            {c.online ? '🟢 ' : ''}
            {c.name} <span className="text-sm font-normal">Lv {c.level} {c.class_id}</span>
          </h3>
          <p>
            {c.email} · account {c.status} · {n(c.gold)} Gold · on {c.map_id} · last played {when(c.last_played_at as string)}
          </p>
          {d.alts.length > 0 && (
            <p>
              Same account:{' '}
              {d.alts.map((a) => (
                <button key={a.id} className="mr-2 underline" onClick={() => onPlayer(a.id)}>
                  {a.name} (Lv {a.level})
                </button>
              ))}
            </p>
          )}
        </div>
        <button className="px-btn ghost small ml-auto" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {tabs.map(([k, t]) => (
          <button key={k} className={`px-btn small ${tab === k ? 'green' : 'ghost'}`} onClick={() => setTab(k)}>
            {t}
          </button>
        ))}
      </div>
      <div className="mt-2 max-h-96 overflow-auto">
        {tab === 'items' && (
          <table className="w-full">
            <tbody>
              {d.items.map((i) => (
                <tr key={`${i.container}-${i.slot}`} className="border-b border-ink/20">
                  <td className="py-0.5 capitalize">{i.container}</td>
                  <td>#{i.slot}</td>
                  <td>{i.name}</td>
                  <td className="capitalize text-wood-dark/70">{i.rarity}</td>
                  <td className="text-right tabular-nums">×{i.quantity}</td>
                  <td className="text-right tabular-nums">{i.durability ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'gold' && (
          <table className="w-full">
            <tbody>
              {d.gold.map((g) => (
                <tr key={g.id} className="border-b border-ink/20">
                  <td className="py-0.5">{when(g.created_at)}</td>
                  <td className="capitalize">{label(g.reason)}</td>
                  <td className={`text-right tabular-nums ${g.amount < 0 ? 'text-berry' : 'text-leaf-dark'}`}>
                    {g.amount > 0 ? '+' : '−'}
                    {n(Math.abs(g.amount))}
                  </td>
                  <td className="text-right tabular-nums">{n(g.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'itemlog' && (
          <table className="w-full">
            <tbody>
              {d.itemLog.map((t) => (
                <tr key={t.id} className="border-b border-ink/20">
                  <td className="py-0.5">{when(t.created_at)}</td>
                  <td>{t.outgoing ? '→ out' : '← in'}</td>
                  <td>
                    {t.quantity}× {t.name}
                  </td>
                  <td className="capitalize">{label(t.reason)}</td>
                  <td>{t.outgoing ? t.to_name : t.from_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'trades' && (
          <ul className="space-y-1">
            {d.trades.map((t) => (
              <li key={`t${t.id}`}>
                {when(t.created_at)} · trade <b>{t.a_name}</b> ({n(t.a_gold)} Gold, {t.a_items.length} items) ⇄ <b>{t.b_name}</b> ({n(t.b_gold)} Gold, {t.b_items.length} items)
              </li>
            ))}
            {d.market.map((m) => (
              <li key={`m${m.id}`}>
                {when(m.created_at)} · market {m.seller} → {m.buyer}: {m.quantity}× {m.name} for {n(m.total)}
              </li>
            ))}
            {d.trades.length + d.market.length === 0 && <li>No trades.</li>}
          </ul>
        )}
        {tab === 'flags' && (
          <ul className="space-y-1">
            {d.flags.map((f) => (
              <li key={`f${f.id}`}>
                {when(f.created_at)} · <b>{f.kind.replace(/_/g, ' ')}</b> {f.review_note ? `· ${f.review_note}` : '· open'}
              </li>
            ))}
            {d.reports.map((r) => (
              <li key={`r${r.id}`}>
                {when(r.created_at)} · reported by {r.reporter}: “{r.reason}” ({r.status})
              </li>
            ))}
            {d.flags.length + d.reports.length === 0 && <li>Nothing.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Server settings and events
// ---------------------------------------------------------------------------

interface Settings {
  motd: string;
  registrationOpen: boolean;
  xpRate: number;
  manualEvent: { id: string; start: number; end: number } | null;
}
interface SettingsView {
  settings: Settings;
  events: { id: string; name: string; description: string }[];
  current: { def: { id: string; name: string }; start: number; end: number } | null;
}

export function ServerSettings({ act }: { act: Act }) {
  const [v, setV] = useState<SettingsView | null>(null);
  const [motd, setMotd] = useState('');
  const [xp, setXp] = useState(1);
  const [ev, setEv] = useState('double_xp');
  const [mins, setMins] = useState(40);
  const load = useCallback(
    () =>
      void adminApi.get<SettingsView>('settings').then((r) => {
        setV(r);
        setMotd(r.settings.motd);
        setXp(r.settings.xpRate);
      }),
    [],
  );
  useEffect(load, [load]);
  if (!v) return <p>Loading…</p>;
  const s = v.settings;
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2" data-testid="admin-settings">
      <div className="px-panel p-3 text-sm">
        <h2 className="font-bold">World events</h2>
        <p>
          Running now: <b>{v.current ? `${v.current.def.name} (until ${new Date(v.current.end).toLocaleTimeString()})` : 'nothing'}</b>
          {s.manualEvent ? ' · started by an admin' : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select value={ev} onChange={(e) => setEv(e.target.value)} className="border-2 border-ink bg-parchment" data-testid="admin-event-pick">
            {v.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <label>
            Minutes <input type="number" min={5} max={1440} value={mins} onChange={(e) => setMins(Number(e.target.value))} className="w-20 border-2 border-ink bg-parchment px-1" />
          </label>
          <button className="px-btn green small" onClick={() => act(() => adminApi.post('event', { id: ev, minutes: mins }).then(load), 'Event started for everyone.')} data-testid="admin-event-start">
            Start now
          </button>
          {s.manualEvent && (
            <button className="px-btn ghost small" onClick={() => act(() => adminApi.post('event', { id: null }).then(load), 'Event stopped; the normal schedule continues.')}>
              Stop
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-wood-dark/70">{v.events.find((e) => e.id === ev)?.description}</p>
      </div>

      <div className="px-panel p-3 text-sm">
        <h2 className="font-bold">Server settings</h2>
        <label className="mt-2 block">
          Message of the day (shown in chat when players join)
          <textarea value={motd} onChange={(e) => setMotd(e.target.value)} maxLength={300} rows={2} className="mt-1 w-full border-2 border-ink bg-parchment px-1" data-testid="admin-motd" />
        </label>
        <label className="mt-2 flex items-center gap-2">
          XP rate
          <input type="range" min={1} max={3} step={0.25} value={xp} onChange={(e) => setXp(Number(e.target.value))} className="flex-1 accent-[#5fa04a]" />
          <b className="w-10 tabular-nums">×{xp}</b>
        </label>
        <button className="px-btn green small mt-2" onClick={() => act(() => adminApi.post('settings', { motd, xpRate: xp }).then(load), 'Settings saved.')} data-testid="admin-settings-save">
          Save
        </button>
        <hr className="my-3 border-ink/20" />
        <p>
          New accounts: <b>{s.registrationOpen ? 'open' : 'closed'}</b>
        </p>
        <button
          className="px-btn small mt-1"
          onClick={() => act(() => adminApi.post('settings', { registrationOpen: !s.registrationOpen }).then(load), s.registrationOpen ? 'Registration closed.' : 'Registration open.')}
        >
          {s.registrationOpen ? 'Close registration' : 'Open registration'}
        </button>
      </div>
    </div>
  );
}
