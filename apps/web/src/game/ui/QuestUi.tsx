'use client';

import { getItem, getQuest } from '@terrago/game-data';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { Window } from './Window';

/** Always-on tracker: what to do next. */
export function QuestTracker({ client, compact }: { client: GameClient; compact?: boolean }) {
  const quests = useStore(client.ui, (s) => s.quests);
  const active = quests.filter((q) => !q.done);
  if (!active.length) return null;
  return (
    <div className={`px-panel-dark pointer-events-auto ${compact ? 'w-48' : 'w-64'} px-2 py-1.5`} data-testid="quest-tracker">
      {active.slice(0, 2).map((q) => {
        const def = getQuest(q.id);
        const st = def?.steps[q.step];
        if (!def || !st) return null;
        return (
          <div key={q.id} className="text-xs">
            <p className="font-bold text-gold">! {def.name}</p>
            <p className="leading-snug text-parchment">
              {st.text}
              {st.count > 1 && (
                <span className="text-leaf">
                  {' '}
                  ({q.count}/{st.count})
                </span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function QuestsPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const quests = useStore(client.ui, (s) => s.quests);
  return (
    <Window title="Quests" onClose={onClose} testId="quests-panel">
      <ul className="space-y-2">
        {[...quests].reverse().map((q) => {
          const def = getQuest(q.id);
          if (!def) return null;
          const r = def.rewards;
          return (
            <li key={q.id} className={`border-2 border-parchment-3 bg-parchment-2 p-2 text-sm ${q.done ? 'opacity-60' : ''}`}>
              <p className="font-bold">
                {q.done ? '✓ ' : ''}
                {def.name}
              </p>
              <p className="text-xs text-wood-dark">{def.description}</p>
              <ol className="mt-1 list-decimal pl-5 text-xs">
                {def.steps.map((st, i) => (
                  <li key={i} className={q.done || i < q.step ? 'text-leaf-dark line-through' : i === q.step ? 'font-bold' : 'opacity-60'}>
                    {st.text}
                    {i === q.step && !q.done && st.count > 1 ? ` (${q.count}/${st.count})` : ''}
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-[11px] text-wood-dark">
                Rewards: {[r.gold ? `${r.gold} Gold` : '', r.xp ? `${r.xp} XP` : '', ...(r.items ?? []).map((i) => `${i.quantity}× ${getItem(i.itemId)?.name}`)].filter(Boolean).join(', ')}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-wood-dark/80">More quests — dailies, professions, guild and boss quests — arrive in a later update.</p>
    </Window>
  );
}
