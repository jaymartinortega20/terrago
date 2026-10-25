'use client';

import { useEffect, useRef, useState } from 'react';
import { touchInput } from '../input';
import type { GameClient } from '../net/client';
import { useStore, type Panel } from '../store';
import { SkillBar } from './CombatUi';
import { getItem } from '@terrago/game-data';
import { MOUNT_CHANNEL_MS } from '@terrago/shared';
import { RARITY_COLOR } from './ItemSlot';

/** Horseshoe glyph for the mount button. */
function Horseshoe({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path d="M6 3c-2 3-3 6-3 9 0 5 4 9 9 9s9-4 9-9c0-3-1-6-3-9h-3c2 3 2.6 6 2.6 9 0 3.4-2.6 6-5.6 6s-5.6-2.6-5.6-6c0-3 .6-6 2.6-9z" fill={color} />
      {[
        [5.2, 9],
        [4.8, 13],
        [18.8, 9],
        [19.2, 13],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill="#0b0d15" />
      ))}
    </svg>
  );
}

/**
 * The quick-mount button, just above the joystick's top-right corner so the left
 * thumb can hop on while steering. Glass when walking; a glowing border in the
 * mount's rarity colour (and a pulsing MOUNTED tag) while riding.
 */
function MountButton({ client }: { client: GameClient }) {
  const mount = useStore(client.ui, (s) => s.self?.mount ?? null);
  const until = useStore(client.ui, (s) => s.self?.mountChannelUntil ?? null);
  const [, tick] = useState(0);
  const def = mount ? getItem(mount) : undefined;
  const tier = def ? RARITY_COLOR[def.rarity]! : '#f4f1e6';
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick((n) => n + 1), 40);
    return () => clearInterval(t);
  }, [until]);
  const left = until ? until - client.serverNow() : 0;
  const k = until ? Math.max(0, Math.min(1, 1 - left / MOUNT_CHANNEL_MS)) : 0;
  return (
    <div className="absolute bottom-[136px] left-[100px] flex flex-col items-center" style={{ width: 52 }}>
      <button
        className="glass pointer-events-auto relative flex h-[52px] w-[52px] items-center justify-center !rounded-full active:scale-95"
        style={
          mount
            ? { borderColor: tier, borderWidth: 2, boxShadow: `0 0 14px ${tier}, inset 0 0 10px ${tier}66` }
            : undefined
        }
        onClick={() => client.toggleMount()}
        aria-label={mount ? 'Get off your mount' : 'Ride your mount'}
        aria-pressed={!!mount}
        data-testid="mount-button"
      >
        <Horseshoe color={mount ? tier : '#f4f1e6'} />
        {until && k < 1 && (
          <svg className="absolute inset-0" viewBox="0 0 52 52" aria-hidden>
            <circle cx="26" cy="26" r="23" fill="none" stroke="#f2c14e" strokeWidth="3" strokeDasharray={`${k * 144.5} 144.5`} transform="rotate(-90 26 26)" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {mount && (
        <span className="mounted-pulse text-outline mt-0.5 text-[9px] font-bold tracking-widest" style={{ color: tier }} data-testid="mounted-tag">
          MOUNTED
        </span>
      )}
    </div>
  );
}

/**
 * Touch controls: a virtual joystick on the left and a compact action cluster
 * on the right, kept to the screen edges so they don't hide the action.
 */
export function MobileControls({ client, openPanel }: { client: GameClient; openPanel: (p: Panel) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pointer = useRef<number | null>(null);
  const hint = useStore(client.ui, (s) => s.interactHint);
  const action = useStore(client.ui, (s) => s.actionHint);
  const R = 42;

  const update = (e: React.PointerEvent) => {
    const el = base.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = e.clientX - (rect.left + rect.width / 2);
    let y = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(x, y);
    if (len > R) {
      x = (x / len) * R;
      y = (y / len) * R;
    }
    setKnob({ x, y });
    touchInput.joyX = x / R;
    touchInput.joyY = y / R;
    touchInput.active = true;
  };
  const end = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    touchInput.joyX = 0;
    touchInput.joyY = 0;
    touchInput.active = false;
  };

  const btn = 'pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border-3 border-ink text-[11px] font-bold opacity-90 shadow-[0_3px_0_#0b0d15] active:translate-y-0.5';

  return (
    <>
      <div
        ref={base}
        className="pointer-events-auto absolute bottom-4 left-4 h-28 w-28 touch-none rounded-full border-4 border-parchment/30 bg-night/30"
        onPointerDown={(e) => {
          pointer.current = e.pointerId;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          update(e);
        }}
        onPointerMove={(e) => pointer.current === e.pointerId && update(e)}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label="Movement joystick"
        role="application"
      >
        <div
          className="absolute top-1/2 left-1/2 h-14 w-14 rounded-full border-4 border-ink bg-parchment/80"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        />
      </div>
      <MountButton client={client} />
      <div className="absolute right-[124px] bottom-4 flex flex-col gap-2">
        <SkillBar client={client} compact />
      </div>
      <div className="absolute right-3 bottom-4 grid grid-cols-2 gap-2">
        <button
          className={`${btn} ${hint || action ? 'bg-gold text-ink' : 'bg-night-3/80 text-parchment/60'}`}
          style={{ borderWidth: 3 }}
          onClick={() => client.primaryAction()}
          aria-label={hint ? `Talk to ${hint}` : (action ?? 'Interact')}
        >
          {hint ? 'Talk' : 'Use'}
        </button>
        <button className={`${btn} bg-[#a8473a] text-parchment`} style={{ borderWidth: 3 }} onClick={() => client.attackKey()} aria-label="Attack">
          Attack
        </button>
        <button className={`${btn} bg-night-3/80 text-parchment`} style={{ borderWidth: 3 }} onClick={() => window.dispatchEvent(new Event('terrago:focus-chat'))} aria-label="Chat">
          Chat
        </button>
        <button className={`${btn} bg-wood text-parchment`} style={{ borderWidth: 3 }} onClick={() => openPanel('inventory')} aria-label="Inventory">
          Bag
        </button>
      </div>
    </>
  );
}
