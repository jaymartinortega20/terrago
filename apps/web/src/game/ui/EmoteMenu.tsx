'use client';

import { useMemo } from 'react';
import { EMOTES } from '@terrago/shared';
import { emoteIcon } from '../art/emotes';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

const LABEL: Record<string, string> = { wave: 'Wave', laugh: 'Laugh', heart: 'Love', cheer: 'Cheer', angry: 'Angry', cry: 'Cry', dance: 'Dance', bow: 'Bow', zzz: 'Sleepy', sit: 'Sit' };

/** Emote picker (Y key or the ☺ button by the chat). Everyone nearby sees your emote. */
export function EmoteMenu({ client }: { client: GameClient }) {
  const open = useStore(client.ui, (s) => s.emoteMenu);
  const icons = useMemo(() => (typeof document === 'undefined' ? {} : Object.fromEntries(EMOTES.map((e) => [e, emoteIcon(e)?.toDataURL() ?? '']))), []);
  if (!open) return null;
  return (
    <div className="pointer-events-auto fixed bottom-40 left-2 z-40 grid w-[232px] grid-cols-5 gap-1 border-4 border-ink bg-parchment p-1 text-ink shadow-lg" role="menu" aria-label="Emotes" data-testid="emote-menu">
      {EMOTES.map((e) => (
        <button
          key={e}
          role="menuitem"
          className="flex flex-col items-center rounded px-0.5 py-1 text-[10px] hover:bg-gold/40 focus:bg-gold/40"
          onClick={() => {
            client.emote(e);
            client.ui.set({ emoteMenu: false });
          }}
          data-testid={`emote-${e}`}
        >
          {icons[e] ? <img src={icons[e]} alt="" width={24} height={24} style={{ imageRendering: 'pixelated' }} /> : <span className="text-lg leading-6">🪑</span>}
          {LABEL[e]}
        </button>
      ))}
    </div>
  );
}
