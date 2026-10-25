'use client';

import { NPCS, getItem, getQuest } from '@terrago/game-data';
import { CharacterPreview } from '@/components/CharacterPreview';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { Window } from './Window';

/** Always-on tracker: what to do next. */
export function QuestTracker({ client, compact }: { client: GameClient; compact?: boolean }) {
  const quests = useStore(client.ui, (s) => s.quests);
  const active = quests.filter((q) => !q.done);
  if (!active.length) {
    // A brand-new player gets one clear first goal.
    const first = !quests.length;
    return (
      <div
        className={`hud-pill pointer-events-auto ${compact ? 'w-48' : 'w-60'} px-2.5 py-1.5 text-xs`}
        style={first ? { boxShadow: '0 0 0 2px #e8c060, 0 0 14px rgba(232,192,96,0.5)' } : undefined}
        data-testid="quest-tracker"
      >
        <p className="font-bold text-gold">{first ? '★ Your first goal' : '! New quest available'}</p>
        <p className="text-parchment">
          {first ? 'Talk to Mayor Lina by the fountain — follow the gold arrow. She has a horse waiting for you.' : "Follow the arrow to the yellow ! over someone's head."}
        </p>
      </div>
    );
  }
  return (
    <div className={`hud-pill pointer-events-auto ${compact ? 'w-48' : 'w-64'} px-2.5 py-1.5`} data-testid="quest-tracker">
      {active.slice(0, 2).map((q) => {
        const def = getQuest(q.id);
        if (!def) return null;
        const st = def.steps[q.step];
        if (!st) {
          return (
            <button key={q.id} className="block text-left text-xs" onClick={() => client.ui.set({ panel: 'quests' })}>
              <p className="font-bold text-gold">? {def.name}</p>
              <p className="leading-snug text-leaf">Done! Return to {NPCS.find((n) => n.id === def.turnIn)?.name}.</p>
            </button>
          );
        }
        return (
          <button key={q.id} className="block text-left text-xs" onClick={() => client.ui.set({ panel: 'quests' })}>
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
          </button>
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
      <p className="mt-2 text-[11px] text-wood-dark/80">Daily tasks, achievements and leaderboards are in your Journal (L).</p>
    </Window>
  );
}

/** "New quest" window: the NPC's story, objectives and rewards, Accept / Later. */
export function QuestOfferWindow({ client }: { client: GameClient }) {
  const offer = useStore(client.ui, (s) => s.questOffer);
  if (!offer) return null;
  const def = getQuest(offer.questId);
  const npc = NPCS.find((n) => n.id === offer.npcId);
  if (!def) return null;
  const r = def.rewards;
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-night/60 p-3" data-testid="quest-offer">
      <section className="px-panel quest-pop w-[min(94vw,480px)] p-4">
        <p className="text-xs font-bold tracking-widest text-gold-dark uppercase">New quest</p>
        <h2 className="text-xl font-bold text-wood-dark">{def.name}</h2>
        <div className="mt-2 flex gap-3">
          {npc && (
            <div className="hidden h-24 w-16 shrink-0 items-end justify-center border-2 border-ink bg-[#67a84a] sm:flex">
              <CharacterPreview appearance={npc.appearance} accessory={npc.accessory} scale={4} />
            </div>
          )}
          <div className="space-y-1.5 text-sm leading-snug">
            {def.intro.map((l, i) => (
              <p key={i}>{i === 0 && npc ? <b>{npc.name}: </b> : null}&ldquo;{l}&rdquo;</p>
            ))}
          </div>
        </div>
        <h3 className="mt-3 text-sm font-bold">Objectives</h3>
        <ol className="list-decimal pl-5 text-sm">
          {def.steps.map((st, i) => (
            <li key={i}>
              {st.text}
              {st.count > 1 ? ` (0/${st.count})` : ''}
            </li>
          ))}
          <li>Return to {NPCS.find((n) => n.id === def.turnIn)?.name}</li>
        </ol>
        <h3 className="mt-3 text-sm font-bold">Rewards</h3>
        <RewardRow gold={r.gold ?? 0} xp={r.xp ?? 0} items={[...Object.values(def.stepRewards ?? {}).flat(), ...(r.items ?? [])]} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-btn ghost small" onClick={() => client.ui.set({ questOffer: null })}>
            Later
          </button>
          <button className="px-btn gold-btn" onClick={() => client.acceptQuest(offer.npcId, offer.questId)} data-testid="quest-accept">
            Accept quest
          </button>
        </div>
      </section>
    </div>
  );
}

function RewardRow({ gold, xp, items }: { gold: number; xp: number; items: { itemId: string; quantity: number }[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-bold">
      {gold > 0 && <span className="border-2 border-ink bg-parchment-2 px-2 py-0.5 text-gold-dark">◉ {gold} Gold</span>}
      {xp > 0 && <span className="border-2 border-ink bg-parchment-2 px-2 py-0.5 text-[#7a3aa8]">✦ {xp} XP</span>}
      {items.map((it) => {
        const d = getItem(it.itemId);
        return (
          <span key={it.itemId} className="flex items-center gap-1 border-2 border-ink bg-parchment-2 px-1.5 py-0.5">
            {d && <PixelIcon icon={d.icon} size={22} />} {d?.name} ×{it.quantity}
          </span>
        );
      })}
    </div>
  );
}

/** "Quest complete!" reward window. */
export function QuestRewardWindow({ client }: { client: GameClient }) {
  const reward = useStore(client.ui, (s) => s.questReward);
  if (!reward) return null;
  const def = getQuest(reward.questId);
  const npc = def ? NPCS.find((n) => n.id === def.turnIn) : undefined;
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-night/60 p-3" data-testid="quest-reward">
      <section className="px-panel quest-pop w-[min(94vw,440px)] p-4 text-center">
        <p className="shine text-3xl">🏆</p>
        <h2 className="text-xl font-bold text-gold-dark">Quest complete!</h2>
        <p className="font-bold">{def?.name}</p>
        <div className="mt-2 space-y-1 text-left text-sm">
          {def?.outro.map((l, i) => (
            <p key={i}>
              {i === 0 && npc ? <b>{npc.name}: </b> : null}&ldquo;{l}&rdquo;
            </p>
          ))}
        </div>
        <div className="mt-3 flex justify-center">
          <RewardRow gold={reward.gold} xp={reward.xp} items={reward.items} />
        </div>
        <button className="px-btn green mt-4" onClick={() => client.ui.set({ questReward: null })} data-testid="quest-reward-ok">
          Continue
        </button>
      </section>
    </div>
  );
}
