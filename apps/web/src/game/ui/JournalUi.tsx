'use client';

import { useEffect, useState } from 'react';
import { CLASSES } from '@terrago/game-data';
import { LEADERBOARDS, LOGIN_REWARDS, dailyTaskReward, formatDuration, type LeaderboardId, type LeaderboardRow } from '@terrago/shared';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { Window } from './Window';
import { EventBadge, WorldBossBadge } from './Atmosphere';

const BOARD_LABEL: Record<LeaderboardId, string> = {
  level: 'Level',
  wealth: 'Gold',
  achievements: 'Achievements',
  boss_kills: 'Boss kills',
  farming: 'Farming',
  fishing: 'Fishing',
  mining: 'Mining',
  woodcutting: 'Woodcutting',
};

export function JournalPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const j = useStore(client.ui, (s) => s.journal);
  const level = useStore(client.ui, (s) => s.self?.level ?? 1);
  const [tab, setTab] = useState<'daily' | 'achievements' | 'ranks'>('daily');
  useEffect(() => void client.loadJournal(), [client]);
  const done = j?.achievements.filter((a) => a.unlockedAt).length ?? 0;
  return (
    <Window title="Journal" onClose={onClose} testId="journal-panel" wide>
      <div className="mb-2 flex gap-1">
        {(['daily', 'achievements', 'ranks'] as const).map((t) => (
          <button key={t} className={`px-btn small ${tab === t ? 'green' : 'ghost'}`} onClick={() => setTab(t)} data-testid={`journal-tab-${t}`}>
            {t === 'daily' ? 'Daily' : t === 'achievements' ? `Achievements ${j ? `${done}/${j.achievements.length}` : ''}` : 'Leaderboards'}
          </button>
        ))}
      </div>
      {!j && <p>Loading…</p>}
      {j && tab === 'daily' && (
        <>
          <div className="border-2 border-ink/30 bg-parchment-2/40 p-2 text-sm">
            <p className="font-bold">Daily login · streak {j.login.streak} day{j.login.streak === 1 ? '' : 's'}</p>
            <div className="mt-1 flex gap-1">
              {LOGIN_REWARDS.map((r, i) => {
                const n = i + 1;
                const past = n < j.login.day || (n === j.login.day && j.login.claimedToday);
                const now = n === j.login.day && !j.login.claimedToday;
                return (
                  <div key={n} className={`flex-1 border-2 p-0.5 text-center text-[10px] ${now ? 'border-gold bg-gold/30' : past ? 'border-leaf/60 bg-leaf/20' : 'border-ink/30'}`}>
                    <div className="font-bold">Day {n}</div>
                    <div>◉{r.gold}</div>
                    {r.items && <div>+{r.items.reduce((a, b) => a + b.quantity, 0)} item</div>}
                  </div>
                );
              })}
            </div>
            <button className="px-btn green small mt-2" disabled={j.login.claimedToday} onClick={() => void client.claimLogin()} data-testid="claim-login">
              {j.login.claimedToday ? 'Claimed — come back tomorrow' : `Claim day ${j.login.day} reward`}
            </button>
          </div>
          <div className="mt-2">
            <EventBadge client={client} />
            <WorldBossBadge client={client} />
          </div>
          <p className="mt-3 font-bold">Today&apos;s tasks</p>
          <p className="text-xs text-wood-dark/70">
            Each pays ◉ {dailyTaskReward(level).gold} and {dailyTaskReward(level).xp} XP. New tasks in {formatDuration(j.resetsAt - client.serverNow())}.
          </p>
          <ul className="mt-1 space-y-1" data-testid="daily-tasks">
            {j.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 border-2 border-ink/20 px-2 py-1 text-sm">
                <span className={t.claimed ? 'line-through opacity-60' : ''}>{t.text}</span>
                <span className="ml-auto text-xs">
                  {t.progress}/{t.count}
                </span>
                {t.claimed ? (
                  <span className="text-xs font-bold text-leaf-dark">✔</span>
                ) : (
                  <button className="px-btn green small" disabled={t.progress < t.count} onClick={() => void client.claimTask(t.id)} data-testid={`claim-${t.id}`}>
                    Claim
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {j && tab === 'achievements' && (
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid="achievements">
          {j.achievements.map((a) => (
            <li key={a.id} className={`flex gap-2 border-2 p-1.5 text-sm ${a.unlockedAt ? 'border-gold bg-gold/15' : 'border-ink/20 opacity-80'}`}>
              <span className="text-xl">{a.unlockedAt ? a.icon : '🔒'}</span>
              <span className="min-w-0 flex-1">
                <b>{a.name}</b>
                <span className="block text-xs">{a.description}</span>
                <span className="mt-0.5 block h-1.5 bg-ink/20">
                  <span className="block h-full bg-leaf" style={{ width: `${(a.progress / a.goal) * 100}%` }} />
                </span>
                <span className="text-[10px] text-wood-dark/70">
                  {a.progress.toLocaleString()}/{a.goal.toLocaleString()} · ◉ {a.gold}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {tab === 'ranks' && <Leaderboards client={client} />}
    </Window>
  );
}

function Leaderboards({ client }: { client: GameClient }) {
  const [id, setId] = useState<LeaderboardId>('level');
  const [data, setData] = useState<{ rows: LeaderboardRow[]; me: LeaderboardRow | null } | null>(null);
  const me = useStore(client.ui, (s) => s.self?.characterId);
  useEffect(() => {
    setData(null);
    client.leaderboard(id).then(setData).catch(() => setData({ rows: [], me: null }));
  }, [client, id]);
  const fmt = (r: LeaderboardRow) => (id === 'level' ? `Lv ${r.level}` : id === 'wealth' ? `◉ ${r.value.toLocaleString()}` : ['farming', 'fishing', 'mining', 'woodcutting'].includes(id) ? `Lv ${r.value}` : r.value.toLocaleString());
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1">
        {LEADERBOARDS.map((b) => (
          <button key={b} className={`border-2 border-ink px-1.5 text-xs ${b === id ? 'bg-gold font-bold' : 'bg-parchment'}`} onClick={() => setId(b)} data-testid={`board-${b}`}>
            {BOARD_LABEL[b]}
          </button>
        ))}
      </div>
      {!data && <p>Loading…</p>}
      {data && (
        <ol className="space-y-0.5 text-sm" data-testid="leaderboard">
          {data.rows.length === 0 && <li>Nobody on this board yet — be the first!</li>}
          {data.rows.map((r) => (
            <li key={r.id} className={`flex gap-2 px-1 ${r.id === me ? 'bg-gold/30 font-bold' : ''}`}>
              <span className="w-6 text-right">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
              <span className="truncate">
                {r.guild ? `[${r.guild}] ` : ''}
                {r.name}
              </span>
              <span className="text-xs text-wood-dark/70">{CLASSES.find((c) => c.id === r.classId)?.name}</span>
              <span className="ml-auto">{fmt(r)}</span>
            </li>
          ))}
          {data.me && data.me.rank > 20 && (
            <li className="mt-1 flex gap-2 border-t-2 border-ink/30 bg-gold/30 px-1 pt-1 font-bold">
              <span className="w-6 text-right">{data.me.rank}</span>
              <span>{data.me.name}</span>
              <span className="ml-auto">{fmt(data.me)}</span>
            </li>
          )}
        </ol>
      )}
    </>
  );
}

/** Achievement unlocked, announcements, and the "daily reward ready" nudge. */
export function ProgressToasts({ client, openJournal, touch }: { client: GameClient; openJournal: () => void; touch?: boolean }) {
  const toast = useStore(client.ui, (s) => s.achievementToast);
  const ann = useStore(client.ui, (s) => s.announcement);
  const ready = useStore(client.ui, (s) => s.dailyReady);
  const panel = useStore(client.ui, (s) => s.panel);
  // New players: no daily-reward nudge until they've finished their first quest.
  const settled = useStore(client.ui, (s) => (s.self?.level ?? 1) >= 3 || s.quests.some((q) => q.done));
  return (
    <div className={`pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2 ${touch ? 'top-[30%]' : 'top-32'}`}>
      {ann && (
        <div className="px-panel max-w-[90vw] px-4 py-2 text-center font-bold text-wood-dark" role="alert" data-testid="announcement">
          📢 {ann}
        </div>
      )}
      {toast && (
        <div className="hud-pill px-3 py-1 text-center" style={{ boxShadow: '0 0 0 2px #e8c060, 0 4px 12px rgba(0,0,0,0.4)', animation: 'feed-in 0.25s ease-out' }} data-testid="achievement-toast">
          <span className="text-[10px] font-bold tracking-widest text-gold">ACHIEVEMENT </span>
          <span className="text-sm font-bold">
            {toast.icon} {toast.name}
          </span>
          <span className="ml-1 text-[11px] text-gold">+{toast.gold}g</span>
        </div>
      )}
      {ready && settled && panel !== 'journal' && (
        <button className="hud-pill pointer-events-auto px-2.5 py-0.5 text-xs font-bold text-leaf" onClick={openJournal} data-testid="daily-ready">
          🎁 Daily reward{touch ? '' : ' (L)'}
        </button>
      )}
    </div>
  );
}
