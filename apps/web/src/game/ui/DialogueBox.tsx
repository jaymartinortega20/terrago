'use client';

import { useEffect, useState } from 'react';
import { getItem, NPCS } from '@terrago/game-data';
import { CharacterPreview } from '@/components/CharacterPreview';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

/** NPC conversation: one line at a time with a typewriter effect. */
export function DialogueBox({ client }: { client: GameClient }) {
  const dialogue = useStore(client.ui, (s) => s.dialogue);
  const [line, setLine] = useState(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setLine(0);
    setShown(0);
  }, [dialogue]);

  const text = dialogue?.lines[line] ?? '';
  useEffect(() => {
    if (!dialogue || shown >= text.length) return;
    const t = setTimeout(() => setShown((n) => Math.min(text.length, n + 2)), 16);
    return () => clearTimeout(t);
  }, [dialogue, shown, text]);

  const last = dialogue ? line >= dialogue.lines.length - 1 : true;
  const advance = () => {
    if (!dialogue) return;
    if (shown < text.length) return setShown(text.length);
    if (last) client.ui.set({ dialogue: null });
    else {
      setLine((l) => l + 1);
      setShown(0);
    }
  };

  useEffect(() => {
    if (!dialogue) return;
    const onKey = (e: KeyboardEvent) => {
      if (['e', 'E', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        advance();
      } else if (e.key === 'Escape') client.ui.set({ dialogue: null });
    };
    // Defer so the key that opened the dialogue doesn't also advance it.
    const id = setTimeout(() => window.addEventListener('keydown', onKey), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  });

  if (!dialogue) return null;
  const npc = NPCS.find((n) => n.id === dialogue.npcId);
  return (
    <div className="px-panel pointer-events-auto flex w-[min(94vw,640px)] gap-3 p-3" role="dialog" aria-label={`Talking to ${dialogue.name}`} data-testid="dialogue">
      {npc && (
        <div className="hidden h-24 w-16 shrink-0 items-end justify-center border-2 border-ink bg-[#67a84a] sm:flex">
          <CharacterPreview appearance={npc.appearance} accessory={npc.accessory} scale={4} />
        </div>
      )}
      <div className="flex min-h-24 flex-1 flex-col">
        <p className="font-bold text-wood-dark">
          {dialogue.name} <span className="text-xs font-normal">— {dialogue.title}</span>
        </p>
        <p className="mt-1 flex-1 leading-snug" data-testid="dialogue-text">
          {text.slice(0, shown)}
        </p>
        {last && shown >= text.length && dialogue.rewards && dialogue.rewards.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-bold text-leaf-dark" data-testid="dialogue-rewards">
            Received:
            {dialogue.rewards.map((r) => {
              const def = getItem(r.itemId);
              return (
                <span key={r.itemId} className="flex items-center gap-1 border-2 border-ink bg-parchment-2 px-1.5">
                  {def && <PixelIcon icon={def.icon} size={20} />} {def?.name ?? r.itemId} ×{r.quantity}
                </span>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {last &&
            shown >= text.length &&
            dialogue.actions?.map((a) => (
              <button
                key={a.id}
                className={`px-btn small ${a.id === 'quest_offer' || a.id === 'quest_complete' ? 'gold-btn' : 'green'}`}
                data-testid={`dialogue-action-${a.id}`}
                onClick={() => {
                  const npcId = dialogue.npcId;
                  client.ui.set({ dialogue: null });
                  if (a.id === 'quest_offer' && a.questId) client.ui.set({ questOffer: { questId: a.questId, npcId } });
                  else if (a.id === 'quest_complete' && a.questId) void client.completeQuest(npcId, a.questId);
                  else if (a.id === 'shop') void client.openShop(npcId);
                  else client.ui.set({ serviceNpc: npcId, panel: a.id === 'farm_upgrade' ? 'farm' : a.id === 'lift' ? 'lift' : a.id === 'bank' ? 'bank' : a.id === 'job' ? 'job' : a.id === 'enhance' ? 'enhance' : 'repair' });
                }}
              >
                {a.label}
              </button>
            ))}
          <button className="px-btn small" onClick={advance} data-testid="dialogue-next">
            {shown < text.length ? '…' : last ? 'Farewell' : 'Next ▶'}
          </button>
        </div>
      </div>
    </div>
  );
}
