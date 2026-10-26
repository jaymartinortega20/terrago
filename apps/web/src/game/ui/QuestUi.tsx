'use client';

import { useEffect, useState } from 'react';
import { NPCS, getItem, getMap, getQuest } from '@terrago/game-data';
import type { BountyBoard } from '@terrago/shared';
import { CharacterPreview } from '@/components/CharacterPreview';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { ExchangeShop } from './ExchangeUi';
import { Window } from './Window';

/** Always-on tracker: what to do next. */
export function QuestTracker({ client, compact }: { client: GameClient; compact?: boolean }) {
  const quests = useStore(client.ui, (s) => s.quests);
  const tracked = useStore(client.ui, (s) => s.trackedQuest);
  const walking = useStore(client.ui, (s) => s.autoWalk);
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
  // Tracked quest first, then the main story, then side stories.
  const order = [...active].sort((a, b) => rank(a.id) - rank(b.id));
  function rank(id: string) {
    if (id === tracked) return 0;
    return getQuest(id)?.chain ? 2 : 1;
  }
  return (
    <div className={`hud-pill pointer-events-auto ${compact ? 'w-48' : 'w-64'} px-2.5 py-1.5`} data-testid="quest-tracker">
      {order.slice(0, 2).map((q) => {
        const def = getQuest(q.id);
        if (!def) return null;
        const st = def.steps[q.step];
        const place = client.questPlace(q.id);
        const going = !!walking && !!place && walking.map === place.map && walking.x === place.x && walking.y === place.y;
        return (
          <div key={q.id} className="flex items-start gap-1.5">
            <button className="block min-w-0 flex-1 text-left text-xs" onClick={() => client.ui.set({ panel: 'quests' })}>
              <p className="truncate font-bold text-gold">
                {st ? '!' : '?'} {def.name}
              </p>
              {st ? (
                <p className="leading-snug text-parchment">
                  {st.text}
                  {st.count > 1 && (
                    <span className="text-leaf">
                      {' '}
                      ({q.count}/{st.count})
                    </span>
                  )}
                </p>
              ) : (
                <p className="leading-snug text-leaf">Done! Return to {NPCS.find((n) => n.id === def.turnIn)?.name}.</p>
              )}
            </button>
            {place && (
              <button
                className="mt-0.5 shrink-0 rounded border border-gold/60 px-1 text-[10px] font-bold text-gold"
                onClick={() => (going ? client.stopAutoWalk('Stopped.') : client.autoWalkTo(place))}
                title={going ? 'Stop walking' : 'Walk there by yourself'}
                data-testid={`quest-go-${q.id}`}
              >
                {going ? '■' : 'Go ▶'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function QuestsPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const quests = useStore(client.ui, (s) => s.quests);
  const tracked = useStore(client.ui, (s) => s.trackedQuest);
  return (
    <Window title="Quests" onClose={onClose} testId="quests-panel">
      <ul className="space-y-2">
        {[...quests].reverse().map((q) => {
          const def = getQuest(q.id);
          if (!def) return null;
          const r = def.rewards;
          return (
            <li key={q.id} className={`border-2 border-parchment-3 bg-parchment-2 p-2 text-sm ${q.done ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2">
                <p className="flex-1 font-bold">
                  {q.done ? '✓ ' : ''}
                  {def.name}
                  {def.chain && <span className="ml-1 text-[10px] font-normal text-wood-dark/80">· {def.chain}</span>}
                </p>
                {!q.done && (
                  <button className="px-btn ghost small" onClick={() => client.ui.set({ trackedQuest: q.id })} disabled={tracked === q.id} data-testid={`quest-track-${q.id}`}>
                    {tracked === q.id ? 'Tracked' : 'Track'}
                  </button>
                )}
                {!q.done && client.questPlace(q.id) && (
                  <button
                    className="px-btn green small"
                    onClick={() => {
                      client.ui.set({ trackedQuest: q.id, panel: null });
                      client.autoWalkTo(client.questPlace(q.id)!);
                    }}
                  >
                    Go ▶
                  </button>
                )}
              </div>
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

const TIER_COLOR: Record<string, string> = { Easy: '#5fa04a', Normal: '#4a7fd6', Hard: '#c0402a' };

/** Bounty board: three daily hunts. Accept, hunt, hand in at any board. */
export function BountyPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const npcId = useStore(client.ui, (s) => s.serviceNpc);
  const [board, setBoard] = useState<BountyBoard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!npcId) return;
    client.bountyBoard(npcId).then(setBoard, (e: Error) => setErr(e.message));
  }, [client, npcId]);
  const hours = board ? Math.max(0, Math.ceil((board.resetsAt - Date.now()) / 3_600_000)) : 0;
  return (
    <Window title="Bounty Board" onClose={onClose} testId="bounty-panel">
      {err && <p className="text-sm text-berry">{err}</p>}
      {!board && !err && <p className="text-sm">Reading the notices…</p>}
      {board && (
        <>
          <p className="mb-2 text-xs text-wood-dark">Three hunts a day, picked for your level. New notices in about {hours}h. Hand them in at any bounty board.</p>
          <ul className="space-y-2">
            {board.bounties.map((b) => {
              const done = b.progress >= b.count;
              return (
                <li key={b.idx} className={`border-2 border-parchment-3 bg-parchment-2 p-2 text-sm ${b.claimed ? 'opacity-60' : ''}`} data-testid={`bounty-${b.idx}`}>
                  <div className="flex items-center gap-2">
                    <span className="rounded px-1.5 text-[10px] font-bold text-white" style={{ background: TIER_COLOR[b.tier] }}>
                      {b.tier}
                    </span>
                    <p className="flex-1 font-bold">
                      Defeat {b.count} {b.monsterName}
                      <span className="ml-1 text-[11px] font-normal text-wood-dark">
                        Lv {b.level} · {getMap(b.where.map)?.name}
                      </span>
                    </p>
                  </div>
                  <p className="mt-0.5 text-[11px] text-wood-dark">
                    Reward: {b.reward.gold.toLocaleString()} Gold, {b.reward.xp.toLocaleString()} XP
                    {b.reward.items.map((i) => `, ${i.quantity}× ${getItem(i.itemId)?.name}`).join('')}
                  </p>
                  {b.accepted && !b.claimed && (
                    <div className="mt-1 h-2 overflow-hidden rounded bg-parchment-3">
                      <div className="h-full bg-leaf" style={{ width: `${(100 * b.progress) / b.count}%` }} />
                    </div>
                  )}
                  <div className="mt-1.5 flex justify-end gap-2">
                    {b.claimed ? (
                      <span className="text-xs font-bold text-leaf-dark">✓ Handed in</span>
                    ) : !b.accepted ? (
                      <button className="px-btn green small" onClick={async () => npcId && setBoard((await client.acceptBounty(npcId, b.idx)) ?? board)} data-testid={`bounty-accept-${b.idx}`}>
                        Accept
                      </button>
                    ) : done ? (
                      <button className="px-btn gold-btn small" onClick={async () => npcId && setBoard((await client.claimBounty(npcId, b.idx)) ?? board)} data-testid={`bounty-claim-${b.idx}`}>
                        Hand in
                      </button>
                    ) : (
                      <>
                        <span className="self-center text-xs">
                          {b.progress}/{b.count}
                        </span>
                        <button
                          className="px-btn ghost small"
                          onClick={() => {
                            onClose();
                            client.autoWalkTo({ ...b.where, label: `${b.monsterName} hunting grounds` });
                          }}
                        >
                          Go ▶
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <ExchangeShop client={client} which="bounty" npcId={npcId} />
        </>
      )}
    </Window>
  );
}
