'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { audio, type Sfx } from '@/game/audio';

/**
 * Sound for the home page: the game's own town theme and UI blips.
 * Browsers only allow audio after a click, so it starts off and the player
 * turns it on (remembered in this browser).
 */
const KEY = 'terrago:homeSound';
type Ctx = { on: boolean; toggle: () => void; blip: (s?: Sfx) => void };
const SoundCtx = createContext<Ctx>({ on: false, toggle: () => {}, blip: () => {} });

let inited = false;

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!inited) {
      audio.init();
      inited = true;
    }
    try {
      if (localStorage.getItem(KEY) === '1') {
        setOn(true);
        // Starts on the first click anywhere (browser rule).
        audio.playMusic('town');
      }
    } catch {
      // storage blocked: sound stays off
    }
    return () => audio.playMusic(null);
  }, []);
  const toggle = useCallback(() => {
    setOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      audio.playMusic(next ? 'town' : null);
      if (next) setTimeout(() => audio.sfx('levelup'), 120);
      return next;
    });
  }, []);
  const blip = useCallback((s: Sfx = 'click') => on && audio.sfx(s), [on]);
  const value = useMemo(() => ({ on, toggle, blip }), [on, toggle, blip]);
  return <SoundCtx.Provider value={value}>{children}</SoundCtx.Provider>;
}

export const useSound = () => useContext(SoundCtx);

/** Floating speaker button with a little equalizer while music plays. */
export function SoundToggle() {
  const { on, toggle } = useSound();
  return (
    <button
      onClick={toggle}
      className={`fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border-2 border-ink px-4 py-2 font-bold shadow-xl transition ${on ? 'bg-leaf text-ink' : 'animate-[nudge_2.4s_ease-in-out_infinite] bg-gold text-ink'}`}
      aria-pressed={on}
      aria-label={on ? 'Turn sound off' : 'Turn sound on'}
      data-testid="home-sound"
    >
      {on ? (
        <span className="flex h-4 items-end gap-0.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="w-1 rounded-sm bg-ink" style={{ animation: `eq 0.${6 + i}s ease-in-out ${i * 0.1}s infinite alternate` }} />
          ))}
        </span>
      ) : (
        <span aria-hidden>🔇</span>
      )}
      {on ? 'Music on' : 'Turn on music'}
    </button>
  );
}

/** A wrapper that blips when hovered (for server-rendered cards). */
export function Blip({ s = 'click', className, children }: { s?: Sfx; className?: string; children: React.ReactNode }) {
  const { blip } = useSound();
  return (
    <div className={className} onMouseEnter={() => blip(s)}>
      {children}
    </div>
  );
}
