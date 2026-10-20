'use client';

import { useRef, useState } from 'react';
import { touchInput } from '../input';
import type { GameClient } from '../net/client';
import { useStore, type Panel } from '../store';
import { SkillBar } from './CombatUi';

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
