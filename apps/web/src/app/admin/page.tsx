'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { adminApi, api, ApiError } from '@/lib/api';
import { EconomyTab, FlagsTab, PlayerDetail, ServerSettings } from './panels';
import { GmPanel, MyCharacters } from './gm';
import { Logo } from '@/components/Logo';

type Tab = 'overview' | 'economy' | 'reports' | 'flags' | 'players' | 'tools' | 'log';
interface Overview {
  stats: Record<string, number>;
  online: { id: string; name: string; level: number; mapId: string; connected: boolean }[];
}
interface Report {
  id: number;
  reason: string;
  context: { ch: string; text: string; ts: number }[];
  status: string;
  created_at: string;
  target_id: string;
  target_name: string;
  target_user: string;
  reporter_name: string;
  user_status: string;
}
interface PlayerRow {
  id: string;
  name: string;
  level: number;
  class_id: string;
  gold: number;
  map_id: string;
  last_played_at: string | null;
  chat_muted_until: string | null;
  user_id: string;
  email: string;
  status: string;
  banned_until: string | null;
  online: boolean;
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

export default function AdminPage() {
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const openPlayer = useCallback((id: string) => {
    setDetail(id);
    setTab('players');
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => setOk(!!r.user.roles?.includes('admin')))
      .catch((e) => (e instanceof ApiError && e.status === 401 ? router.replace('/login') : setOk(false)));
  }, [router]);

  const act = useCallback(async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setMsg({ kind: 'ok', text: done });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    }
  }, []);

  if (ok === null) return <p className="mt-16 text-center text-xl">Checking access…</p>;
  if (!ok)
    return (
      <main className="mx-auto max-w-xl p-8">
        <p className="px-panel p-4 font-bold">Admins only. Ask the server owner to add your email to ADMIN_EMAILS.</p>
        <Link href="/characters" className="px-btn mt-4 inline-block">
          Back
        </Link>
      </main>
    );

  return (
    <main className="min-h-dvh lg:flex" data-testid="admin">
      <aside className="sticky top-0 z-20 border-b border-white/10 bg-night-2/80 backdrop-blur-xl lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 p-4">
          <Link href="/characters" aria-label="Back to characters">
            <Logo size="sm" />
          </Link>
          <span className="ml-auto rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold tracking-widest text-gold uppercase lg:ml-2">Admin</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {(['overview', 'economy', 'reports', 'flags', 'players', 'tools', 'log'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold transition ${tab === t ? 'bg-gradient-to-r from-gold/25 to-gold/5 text-gold shadow-[inset_2px_0_0_#ffcb52]' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
              onClick={() => setTab(t)}
              data-testid={`admin-tab-${t}`}
            >
              <span className="text-base">{TAB_ICON[t]}</span>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <Link href="/characters" className="mx-3 hidden rounded-xl px-3 py-2 text-sm text-white/60 hover:text-white lg:block">
          ← Back to game
        </Link>
      </aside>
      <div className="min-w-0 flex-1 px-4 py-6 lg:px-8">
      <h1 className="mb-4 text-3xl font-bold text-white">{TAB_ICON[tab]} {tab[0]!.toUpperCase() + tab.slice(1)}</h1>
      {msg && (
        <p className={`px-panel mt-3 p-2 text-sm font-bold ${msg.kind === 'ok' ? 'text-leaf-dark' : 'text-berry'}`} onClick={() => setMsg(null)} role="status">
          {msg.text}
        </p>
      )}
      <section>
        {tab === 'overview' && <OverviewTab act={act} />}
        {tab === 'reports' && <ReportsTab act={act} />}
        {tab === 'economy' && <EconomyTab onPlayer={openPlayer} />}
        {tab === 'flags' && <FlagsTab act={act} onPlayer={openPlayer} />}
        {tab === 'players' && <PlayersTab act={act} detail={detail} setDetail={setDetail} />}
        {tab === 'tools' && <ToolsTab act={act} />}
        {tab === 'log' && <LogTab />}
      </section>
      </div>
    </main>
  );
}

const TAB_ICON: Record<Tab, string> = { overview: '📊', economy: '💰', reports: '🚩', flags: '⚑', players: '👥', tools: '🛠️', log: '📜' };

type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

function OverviewTab({ act }: { act: Act }) {
  const [o, setO] = useState<Overview | null>(null);
  const load = useCallback(() => void adminApi.get<Overview>('overview').then(setO), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);
  if (!o) return <p>Loading…</p>;
  const cards: [string, number][] = [
    ['Online now', o.stats.online ?? 0],
    ['Accounts', o.stats.accounts ?? 0],
    ['Characters', o.stats.characters ?? 0],
    ['Open reports', o.stats.open_reports ?? 0],
    ['Banned / suspended', o.stats.banned ?? 0],
    ['Security events (24h)', o.stats.security_24h ?? 0],
    ['Market listings', o.stats.listings ?? 0],
    ['Gold in economy', o.stats.gold_total ?? 0],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="admin-stats">
        {cards.map(([k, v]) => (
          <div key={k} className="px-panel p-4">
            <div className="text-xs font-bold tracking-wide text-white/60 uppercase">{k}</div>
            <div className="mt-1 font-display text-3xl font-bold text-white">{v.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <h2 className="text-outline mt-6 text-xl font-bold">Online players</h2>
      <div className="px-panel mt-2 overflow-x-auto p-2">
        <table className="w-full text-sm">
          <tbody>
            {o.online.length === 0 && (
              <tr>
                <td>Nobody online.</td>
              </tr>
            )}
            {o.online.map((p) => (
              <tr key={p.id} className="border-b border-ink/20">
                <td className="py-1 font-bold">{p.name}</td>
                <td>Lv {p.level}</td>
                <td>{p.mapId}</td>
                <td>{p.connected ? 'connected' : 'reconnecting'}</td>
                <td className="text-right">
                  <button className="px-btn ghost small" onClick={() => act(() => adminApi.post('kick', { characterId: p.id }).then(load), `Kicked ${p.name}.`)}>
                    Kick
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReportsTab({ act }: { act: Act }) {
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<Report[] | null>(null);
  const load = useCallback(() => void adminApi.get<{ reports: Report[] }>(`reports${all ? '?status=all' : ''}`).then((r) => setRows(r.reports)), [all]);
  useEffect(load, [load]);
  if (!rows) return <p>Loading…</p>;
  return (
    <>
      <label className="text-sm">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show reviewed and dismissed too
      </label>
      {rows.length === 0 && <p className="px-panel mt-2 p-3">No reports. 🎉</p>}
      <div className="mt-2 space-y-2" data-testid="admin-reports">
        {rows.map((r) => (
          <article key={r.id} className="px-panel p-3 text-sm">
            <p>
              <b>{r.reporter_name}</b> reported <b>{r.target_name}</b> · {when(r.created_at)} · <i>{r.status}</i> · account {r.user_status}
            </p>
            <p className="mt-1 italic">“{r.reason}”</p>
            {r.context?.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs">Their recent messages ({r.context.length})</summary>
                <ul className="mt-1 max-h-40 overflow-y-auto bg-night/10 p-1 text-xs">
                  {r.context.map((c, i) => (
                    <li key={i}>
                      [{c.ch}] {c.text}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              <button className="px-btn small" onClick={() => act(() => adminApi.post('mute', { characterId: r.target_id, minutes: 60 }), `Muted ${r.target_name} for 1 hour.`)}>
                Mute 1h
              </button>
              <button className="px-btn small" onClick={() => act(() => adminApi.post('mute', { characterId: r.target_id, minutes: 1440 }), `Muted ${r.target_name} for 1 day.`)}>
                Mute 1d
              </button>
              <button className="px-btn small" onClick={() => act(() => adminApi.post('ban', { userId: r.target_user, days: 3, reason: r.reason }), `Suspended ${r.target_name}'s account for 3 days.`)}>
                Suspend 3d
              </button>
              {r.status === 'open' && (
                <>
                  <button className="px-btn green small" onClick={() => act(() => adminApi.post('report', { id: r.id, status: 'reviewed' }).then(load), 'Marked as reviewed.')}>
                    Done
                  </button>
                  <button className="px-btn ghost small" onClick={() => act(() => adminApi.post('report', { id: r.id, status: 'dismissed' }).then(load), 'Dismissed.')}>
                    Dismiss
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function PlayersTab({ act, detail, setDetail }: { act: Act; detail: string | null; setDetail: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PlayerRow[] | null>(null);
  const [give, setGive] = useState<{ id: string; name: string } | null>(null);
  const load = useCallback(() => void adminApi.get<{ players: PlayerRow[] }>(`players?q=${encodeURIComponent(q)}`).then((r) => setRows(r.players)), [q]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="w-full max-w-sm border-4 border-ink bg-parchment px-2 py-1 text-ink" data-testid="admin-search" />
      {detail && <PlayerDetail id={detail} onClose={() => setDetail(null)} onPlayer={setDetail} />}
      <MyCharacters onPick={(c) => setGive(c)} />
      {give && <GmPanel target={give} act={act} onClose={() => setGive(null)} />}
      <div className="px-panel mt-2 overflow-x-auto p-2">
        <table className="w-full text-sm" data-testid="admin-players">
          <thead>
            <tr className="text-left text-xs">
              <th>Name</th>
              <th>Lv</th>
              <th>Gold</th>
              <th>Account</th>
              <th>Status</th>
              <th>Last played</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows?.map((p) => {
              const muted = p.chat_muted_until && new Date(p.chat_muted_until).getTime() > Date.now();
              return (
                <tr key={p.id} className="border-b border-ink/20 align-top">
                  <td className="py-1 font-bold">
                    {p.online ? '🟢 ' : ''}
                    {p.name}
                  </td>
                  <td>{p.level}</td>
                  <td>{p.gold.toLocaleString()}</td>
                  <td className="max-w-[180px] truncate">{p.email}</td>
                  <td>
                    {p.status}
                    {p.banned_until ? ` until ${when(p.banned_until)}` : ''}
                    {muted ? ' · muted' : ''}
                  </td>
                  <td>{when(p.last_played_at)}</td>
                  <td className="flex flex-wrap justify-end gap-1 py-1">
                    <button className="px-btn small" onClick={() => setDetail(p.id)} data-testid="admin-player-open">
                      Details
                    </button>
                    <button className="px-btn ghost small" onClick={() => setGive({ id: p.id, name: p.name })} data-testid="admin-gm-open">
                      GM tools
                    </button>
                    <button className="px-btn ghost small" onClick={() => act(() => adminApi.post('mute', { characterId: p.id, minutes: muted ? 0 : 60 }).then(load), muted ? 'Unmuted.' : 'Muted for 1 hour.')}>
                      {muted ? 'Unmute' : 'Mute 1h'}
                    </button>
                    {p.status === 'active' ? (
                      <button
                        className="px-btn ghost small"
                        onClick={() => {
                          const days = prompt(`Ban ${p.email}? Days (leave empty for permanent):`, '7');
                          if (days === null) return;
                          const reason = prompt('Reason:', 'Rule violation') ?? 'Rule violation';
                          void act(() => adminApi.post('ban', { userId: p.user_id, days: days.trim() ? Number(days) : null, reason }).then(load), 'Account banned.');
                        }}
                      >
                        Ban
                      </button>
                    ) : (
                      <button className="px-btn ghost small" onClick={() => act(() => adminApi.post('unban', { userId: p.user_id }).then(load), 'Account restored.')}>
                        Unban
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ToolsTab({ act }: { act: Act }) {
  const [text, setText] = useState('');
  return (
    <>
    <div className="px-panel max-w-xl p-3">
      <h2 className="font-bold">Server announcement</h2>
      <p className="text-xs text-wood-dark/80">Shows to everyone online as a banner and in chat.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={200} rows={3} className="mt-2 w-full border-2 border-ink bg-parchment px-1" data-testid="admin-announce" />
      <button
        className="px-btn green small mt-1"
        disabled={!text.trim()}
        onClick={() => act(() => adminApi.post<{ delivered: number }>('announce', { text }).then(() => setText('')), 'Announcement sent.')}
        data-testid="admin-announce-send"
      >
        Send to everyone
      </button>
    </div>
    <ServerSettings act={act} />
    </>
  );
}

function LogTab() {
  const [rows, setRows] = useState<{ id: number; action: string; target: string | null; details: object; created_at: string; email: string }[] | null>(null);
  useEffect(() => void adminApi.get<{ log: NonNullable<typeof rows> }>('log').then((r) => setRows(r.log)), []);
  return (
    <div className="px-panel overflow-x-auto p-2">
      <table className="w-full text-xs">
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className="border-b border-ink/20">
              <td className="py-1">{when(r.created_at)}</td>
              <td>{r.email}</td>
              <td className="font-bold">{r.action}</td>
              <td>{r.target}</td>
              <td className="max-w-xs truncate">{JSON.stringify(r.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
