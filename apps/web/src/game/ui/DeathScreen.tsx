'use client';

import { useEffect, useState } from 'react';
import { getMap } from '@terrago/game-data';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

/** "Defeated by X": what happened, what it costs, and when you're back. */
export function DeathScreen({ client }: { client: GameClient }) {
  const death = useStore(client.ui, (s) => s.death);
  const hp = useStore(client.ui, (s) => s.self?.hp ?? 1);
  const mapId = useStore(client.ui, (s) => s.mapId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!death) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [death]);
  useEffect(() => {
    // Back on your feet: keep the card a moment longer, then hide it.
    if (death && hp > 0 && Date.now() - death.at > 2500) {
      const t = setTimeout(() => client.ui.get().death === death && client.ui.set({ death: null }), 1500);
      return () => clearTimeout(t);
    }
  }, [client, death, hp]);
  if (!death) return null;
  const left = Math.max(0, Math.ceil((death.at + 3000 - now) / 1000));
  const respawn = mapId ? (getMap(mapId)?.respawn?.mapId ?? mapId) : null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[45] flex items-center justify-center bg-[radial-gradient(circle,transparent_30%,rgba(60,0,0,0.55))]" data-testid="death-screen">
      <div className="pointer-events-auto rounded-2xl border border-[#ff6a5a]/40 bg-[#1a1018]/90 px-6 py-4 text-center text-parchment shadow-2xl">
        <p className="text-2xl font-bold text-[#ff6a5a]">Defeated</p>
        <p className="text-sm">by {death.by}</p>
        <ul className="mt-2 space-y-0.5 text-left text-xs text-parchment/80">
          <li>• Weakness for 2 minutes: −25% damage, +15% damage taken</li>
          <li>• Your gear lost some durability (repair at Blacksmith Toren)</li>
          <li>• Food buffs wore off; your pet lost a little loyalty</li>
        </ul>
        <p className="mt-2 text-sm font-bold">{hp > 0 ? 'Back on your feet!' : left > 0 ? `Getting up in ${left}…` : 'Getting up…'}</p>
        {respawn && hp <= 0 && <p className="text-[11px] text-parchment/60">You&apos;ll wake up at the safe spot of {getMap(respawn)?.name}.</p>}
        <p className="mt-1 text-[11px] text-parchment/60">Tip: eat cooked food before big fights and keep potions on your hotbar.</p>
        {hp > 0 && (
          <button className="mt-2 rounded-full bg-white/10 px-3 py-1 text-xs" onClick={() => client.ui.set({ death: null })}>
            OK
          </button>
        )}
      </div>
    </div>
  );
}
