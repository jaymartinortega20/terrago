'use client';

import { useEffect, useState } from 'react';
import { ARENA_MIN_LEVEL, ARENA_TIERS, arenaTier, formatDuration, type ArenaView } from '@terrago/shared';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { ExchangeShop } from './ExchangeUi';
import { Window } from './Window';

const CLASS: Record<string, string> = { warrior: 'Warrior', mage: 'Mage', archer: 'Archer', acolyte: 'Acolyte' };

function TierBadge({ rating }: { rating: number }) {
  const t = arenaTier(rating);
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: `${t.color}33`, color: t.color, boxShadow: `inset 0 0 0 1px ${t.color}` }}>
      {t.name}
    </span>
  );
}

/** Ranked arena: queue for a 1v1, your rating and the season's top ten. */
export function ArenaPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const level = useStore(client.ui, (s) => s.self?.level ?? 1);
  const [v, setV] = useState<ArenaView | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const load = () => client.arenaGet().then(setV, () => {});
    void load();
    const t = setInterval(() => {
      tick((n) => n + 1);
      void load();
    }, 3000);
    return () => clearInterval(t);
  }, [client]);
  const next = v ? ARENA_TIERS.find((t) => t.min > v.rating) : undefined;
  return (
    <Window title="Ranked Arena" onClose={onClose} testId="arena-panel">
      {!v ? (
        <p className="text-sm">Loading…</p>
      ) : (
        <>
          <div className="flex items-center gap-3 border-2 border-ink/30 bg-parchment-2/50 p-2">
            <div className="text-center">
              <p className="text-2xl font-bold" data-testid="arena-rating">
                {v.rating}
              </p>
              <TierBadge rating={v.rating} />
            </div>
            <div className="flex-1 text-sm">
              <p>
                Season {v.season} · {v.wins}W / {v.losses}L
              </p>
              <p className="text-xs text-wood-dark/70">{next ? `${next.min - v.rating} to ${next.name}` : 'Top tier!'}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-wood-dark/80">
            1v1 against someone near your rating and level. First to 1 HP loses (nobody dies), 3 minutes. You return to where you were afterwards. Wins pay Gold.
          </p>
          <div className="mt-2">
            {v.inMatch ? (
              <p className="font-bold text-berry">You're in a match!</p>
            ) : v.queued ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">⏳ Searching… {formatDuration(Date.now() - (v.queuedSince ?? Date.now()))}</span>
                <button className="px-btn ghost small" onClick={async () => setV((await client.arenaQueue(false)) ?? v)} data-testid="arena-leave">
                  Cancel
                </button>
              </div>
            ) : (
              <button className="px-btn green" disabled={level < ARENA_MIN_LEVEL} onClick={async () => setV((await client.arenaQueue(true)) ?? v)} data-testid="arena-queue">
                {level < ARENA_MIN_LEVEL ? `Opens at level ${ARENA_MIN_LEVEL}` : '⚔ Find a match'}
              </button>
            )}
          </div>
          <ExchangeShop client={client} which="arena" />
          <h3 className="mt-3 font-bold">Season top 10</h3>
          <ol className="mt-1 space-y-0.5 text-sm" data-testid="arena-top">
            {!v.top.length && <li className="text-wood-dark/70">No ranked matches yet this season. Be the first!</li>}
            {v.top.map((r, i) => (
              <li key={r.name} className="flex items-center gap-2">
                <span className="w-5 text-right font-bold">{i + 1}.</span>
                <span className="flex-1 truncate">
                  {r.name} <span className="text-xs text-wood-dark/70">Lv{r.level} {CLASS[r.classId] ?? ''}</span>
                </span>
                <span className="text-xs">
                  {r.wins}-{r.losses}
                </span>
                <span className="w-12 text-right font-bold">{r.rating}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Window>
  );
}

/** "VS" countdown when a match is found, and the result afterwards. */
export function ArenaBanner({ client }: { client: GameClient }) {
  const ev = useStore(client.ui, (s) => s.arena);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ev) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [ev]);
  if (!ev) return null;
  if (ev.kind === 'found') {
    const left = Math.ceil((ev.startsAt - now) / 1000);
    if (left <= -2) return null;
    return (
      <div className="pointer-events-none fixed inset-x-0 top-[22%] z-40 flex justify-center" data-testid="arena-banner">
        <div className="glass-dark px-6 py-3 text-center">
          <p className="text-xs font-bold tracking-widest text-parchment/70 uppercase">Ranked match</p>
          <p className="text-xl font-bold text-gold">
            VS {ev.foe.name} <span className="text-sm text-parchment/80">Lv{ev.foe.level} · {ev.foe.rating}</span>
          </p>
          <p className="text-3xl font-bold text-white">{left > 0 ? left : 'FIGHT!'}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[22%] z-40 flex justify-center" data-testid="arena-result">
      <div className="glass-dark px-6 py-3 text-center">
        <p className="text-3xl font-bold" style={{ color: ev.won ? '#f2c14e' : ev.won === null ? '#c0c8d8' : '#ff6a5a' }}>
          {ev.won ? 'VICTORY' : ev.won === null ? 'DRAW' : 'DEFEAT'}
        </p>
        <p className="text-sm text-parchment">
          {ev.delta >= 0 ? '+' : ''}
          {ev.delta} rating → {ev.rating} · {arenaTier(ev.rating).name}
          {ev.gold ? ` · +${ev.gold} Gold` : ''}
        </p>
      </div>
    </div>
  );
}
