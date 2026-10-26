'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { currentEvent, currentWorldBoss, nextEvent, nextWorldBoss } from '@terrago/shared';
import { CountUp } from './reveal';

interface Stats {
  online: number;
  heroes: number;
  monstersDefeated: number;
  topLevel: { name: string; level: number; classId: string }[];
  rift: { name: string; floor: number } | null;
  arena: { name: string; rating: number } | null;
}

export function useNow(ms = 1000): number {
  // 0 until mounted, so the server render and the first client render match.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Live numbers from the game server (refreshes every 30 s). */
export function useStats(): Stats | null {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/public/stats')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setS(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return s;
}

const StatsCtx = createContext<Stats | null>(null);
export function StatsProvider({ children }: { children: React.ReactNode }) {
  return <StatsCtx.Provider value={useStats()}>{children}</StatsCtx.Provider>;
}

/** A scrolling strip of what is happening in the world right now. */
export function LiveTicker() {
  const stats = useContext(StatsCtx);
  const now = useNow();
  if (!now) return <div className="h-9 border-y-4 border-ink bg-night-2" data-testid="live-ticker" />;
  const boss = currentWorldBoss(now);
  const nb = nextWorldBoss(now);
  const ev = currentEvent(now);
  const ne = nextEvent(now);
  const items: React.ReactNode[] = [
    boss ? (
      <span key="b" className="text-red-300">
        🐉 <b>{boss.def.name}</b> is attacking NOW — {fmtLeft(boss.end - now)} left!
      </span>
    ) : (
      <span key="b">
        🐉 World boss <b className="text-gold">{nb.def.name}</b> in {fmtLeft(nb.start - now)}
      </span>
    ),
    ev ? (
      <span key="e" className="text-leaf">
        ✨ <b>{ev.def.name}</b> is live — {fmtLeft(ev.end - now)} left
      </span>
    ) : (
      <span key="e">
        ✨ Next event: <b className="text-gold">{ne.def.name}</b> in {fmtLeft(ne.start - now)}
      </span>
    ),
  ];
  if (stats?.arena) items.push(<span key="a">⚔ Arena champion: <b className="text-gold">{stats.arena.name}</b> ({stats.arena.rating})</span>);
  if (stats?.rift) items.push(<span key="r">🌀 Deepest Rift: <b className="text-gold">{stats.rift.name}</b> reached floor {stats.rift.floor}</span>);
  if (stats?.topLevel[0]) items.push(<span key="t">👑 Top hero: <b className="text-gold">{stats.topLevel[0].name}</b>, level {stats.topLevel[0].level}</span>);
  items.push(<span key="f">🎁 Free to play · No pay-to-win · Plays in your browser</span>);
  return (
    <div className="relative overflow-hidden border-y-4 border-ink bg-night-2 py-2 text-sm text-parchment" data-testid="live-ticker">
      <div className="flex w-max animate-[marquee_40s_linear_infinite] gap-12 whitespace-nowrap hover:[animation-play-state:paused] motion-reduce:animate-none">
        {[0, 1].map((k) => (
          <div key={k} className="flex gap-12" aria-hidden={k === 1}>
            {items}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Three big live counters. */
export function LiveCounters() {
  const stats = useContext(StatsCtx);
  const cells: [string, React.ReactNode, string][] = [
    [
      'online',
      <span key="o" className="flex items-center justify-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-leaf" />
        </span>
        {stats ? <CountUp to={stats.online} ms={800} /> : '—'}
      </span>,
      stats && stats.online === 0 ? 'online — be the first in!' : 'playing right now',
    ],
    ['heroes', stats ? <CountUp to={stats.heroes} /> : '—', 'heroes created'],
    ['kills', stats ? <CountUp to={stats.monstersDefeated} ms={2200} /> : '—', 'monsters defeated'],
  ];
  return (
    <div className="mx-auto mt-8 grid max-w-2xl grid-cols-3 gap-2 sm:gap-4" data-testid="live-counters">
      {cells.map(([k, v, label]) => (
        <div key={k} className="rounded border-2 border-ink bg-night/70 px-2 py-3 text-center backdrop-blur-sm">
          <div className="text-outline text-2xl font-bold text-gold sm:text-4xl">{v}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-parchment/80 sm:text-xs">{label}</div>
        </div>
      ))}
    </div>
  );
}

export type { Stats };
