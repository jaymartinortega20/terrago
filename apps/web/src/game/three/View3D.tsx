'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameClient } from '../net/client';
import { fxSettings, onFxSettings, setFxSettings } from '../fx/settings';
import type { World3D } from './World3D';

/**
 * Mounts the 3D view over the game while "3D (beta)" is on, with small
 * camera buttons (rotate, zoom, back to 2D). three.js loads only when needed.
 */
export function View3D({ client }: { client: GameClient }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<World3D | null>(null);
  const [on, setOn] = useState(() => fxSettings().view3d);
  useEffect(() => onFxSettings((s) => setOn(s.view3d)), []);
  useEffect(() => {
    if (!on || !host.current) return;
    let cancelled = false;
    void import('./World3D')
      .then(({ World3D }) => {
        if (cancelled || !host.current) return;
        try {
          world.current = new World3D(host.current, client);
          // Debug handle for automated checks.
          if (window.__terrago) Object.assign(window.__terrago, { world3d: world.current });
        } catch (err) {
          // No WebGL: fall back to 2D.
          console.warn('[3d] unavailable', err);
          setFxSettings({ view3d: false });
        }
      })
      .catch(() => setFxSettings({ view3d: false }));
    return () => {
      cancelled = true;
      world.current?.dispose();
      world.current = null;
    };
  }, [on, client]);
  if (!on) return null;
  const btn = 'pointer-events-auto flex h-9 w-9 items-center justify-center rounded border-2 border-ink bg-night-2/85 text-lg text-parchment hover:bg-night-3 active:scale-95';
  return (
    <>
      <div ref={host} className="absolute inset-0" />
      <div className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 flex-col gap-1" data-testid="cam3d">
        <button className={btn} title="Rotate left ( [ )" onClick={() => world.current?.rotateView(-1)}>
          ⟲
        </button>
        <button className={btn} title="Rotate right ( ] )" onClick={() => world.current?.rotateView(1)}>
          ⟳
        </button>
        <button className={btn} title="Zoom in" onClick={() => world.current?.zoom(1 / 1.15)}>
          +
        </button>
        <button className={btn} title="Zoom out" onClick={() => world.current?.zoom(1.15)}>
          −
        </button>
        <button className={`${btn} text-xs font-bold`} title="Back to the 2D view" onClick={() => setFxSettings({ view3d: false })} data-testid="cam3d-2d">
          2D
        </button>
      </div>
    </>
  );
}
