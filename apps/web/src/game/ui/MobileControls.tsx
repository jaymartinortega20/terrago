'use client';

import { useEffect, useRef, useState } from 'react';
import { getItem, skillsFor } from '@terrago/game-data';
import { MOUNT_CHANNEL_MS } from '@terrago/shared';
import { touchInput } from '../input';
import type { GameClient } from '../net/client';
import { useStore, type Panel } from '../store';
import { SkillOrb } from './CombatUi';
import { HudIcon } from './HudIcons';
import { RARITY_COLOR } from './ItemSlot';

/**
 * The quick-mount button, just above the joystick's top-right corner so the left
 * thumb can hop on while steering. Glows in the mount's rarity colour (with a
 * pulsing MOUNTED tag) while riding; a gold ring fills while getting on.
 */
function MountButton({ client }: { client: GameClient }) {
  const mount = useStore(client.ui, (s) => s.self?.mount ?? null);
  const until = useStore(client.ui, (s) => s.self?.mountChannelUntil ?? null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick((n) => n + 1), 40);
    return () => clearInterval(t);
  }, [until]);
  const def = mount ? getItem(mount) : undefined;
  const tier = def ? RARITY_COLOR[def.rarity]! : '#ffd56a';
  const left = until ? until - client.serverNow() : 0;
  const k = until ? Math.max(0, Math.min(1, 1 - left / MOUNT_CHANNEL_MS)) : 0;
  return (
    <div className="absolute bottom-[156px] left-[118px]">
      <button
        className="orb studs pointer-events-auto h-[52px] w-[52px]"
        style={mount ? { boxShadow: `0 0 0 2px #2a1a08, 0 0 0 4px ${tier}, 0 0 0 6px #7a4e18, 0 0 20px 6px ${tier}, inset 0 -6px 14px rgba(0,0,0,0.55)` } : undefined}
        onClick={() => client.toggleMount()}
        aria-label={mount ? 'Get off your mount' : 'Ride your mount'}
        aria-pressed={!!mount}
        data-testid="mount-button"
      >
        <HudIcon name="stable" size={28} />
        {until && k < 1 && (
          <svg className="absolute inset-0" viewBox="0 0 52 52" aria-hidden>
            <circle cx="26" cy="26" r="23" fill="none" stroke="#f2c14e" strokeWidth="3.5" strokeDasharray={`${k * 144.5} 144.5`} transform="rotate(-90 26 26)" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {mount && (
        <span className="mounted-pulse orb-label -bottom-[22px] text-[9px] tracking-widest" style={{ color: tier }} data-testid="mounted-tag">
          MOUNTED
        </span>
      )}
    </div>
  );
}

/**
 * Touch controls in the ornate style: joystick bottom-left (AUTO and the mount
 * button above it); on the right a big attack button with the skills in two
 * arcs around it, plus Use/Talk, the bag and chat.
 */
export function MobileControls({ client, openPanel }: { client: GameClient; openPanel: (p: Panel) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pointer = useRef<number | null>(null);
  const hint = useStore(client.ui, (s) => s.interactHint);
  const action = useStore(client.ui, (s) => s.actionHint);
  const auto = useStore(client.ui, (s) => s.autoHunt);
  const self = useStore(client.ui, (s) => s.self);
  useStore(client.ui, (s) => s.cooldowns);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 150);
    return () => clearInterval(t);
  }, []);
  const R = 48;

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

  // Skills sit on two arcs around the attack button (centre 66px from the corner).
  const count = self ? skillsFor(self.classId, self.job).length : 0;
  const C = 66;
  const SK = 50;
  const slots: { r: number; deg: number }[] = [
    { r: 100, deg: 180 },
    { r: 100, deg: 135 },
    { r: 100, deg: 90 },
    { r: 162, deg: 178 },
    { r: 162, deg: 150 },
    { r: 162, deg: 122 },
  ];
  const at = (r: number, deg: number, size: number) => {
    const a = (deg * Math.PI) / 180;
    return { right: C - r * Math.cos(a) - size / 2, bottom: C + r * Math.sin(a) - size / 2 };
  };
  const use = at(162, 94, 50);

  return (
    <>
      {/* Joystick */}
      <div
        ref={base}
        className="orb pointer-events-auto absolute bottom-[18px] left-[18px] h-[132px] w-[132px] touch-none"
        style={{ background: 'radial-gradient(circle at 50% 50%, rgba(30,120,130,0.45), rgba(8,40,50,0.7))' }}
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
          className="pointer-events-none absolute top-1/2 left-1/2 h-[58px] w-[58px] rounded-full"
          style={{
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
            background: 'radial-gradient(circle at 40% 35%, #8ff4f4, #1a8a98 60%, #0a4050)',
            boxShadow: '0 0 0 3px #e8c060, 0 0 16px rgba(120,240,255,0.55)',
          }}
        />
      </div>
      <div className="absolute bottom-[160px] left-[24px]">
        <button
          className={`orb studs pointer-events-auto h-[54px] w-[54px] ${auto ? 'orb-on' : 'orb-dark'}`}
          onClick={() => client.setAutoHunt(!auto)}
          aria-label="Auto attack"
          aria-pressed={auto}
          data-testid="auto-button"
        >
          <HudIcon name="auto" size={28} />
        </button>
        <span className="orb-label -bottom-[20px]" style={{ color: auto ? '#8ff6ff' : '#fff' }}>
          AUTO
        </span>
      </div>
      <MountButton client={client} />

      {/* Right cluster */}
      <div className="pointer-events-none absolute right-[14px] bottom-[14px] h-[250px] w-[250px]">
        <button
          className="orb orb-red studs pointer-events-auto absolute right-[20px] bottom-[20px] h-[92px] w-[92px]"
          onClick={() => client.attackKey()}
          aria-label="Attack"
          data-testid="attack-button"
        >
          <HudIcon name="attack" size={50} />
        </button>
        {slots.slice(0, count).map((s, i) => (
          <div key={i} className="absolute" style={at(s.r, s.deg, SK)}>
            <SkillOrb client={client} index={i} size={SK} showKey={false} />
          </div>
        ))}
        <button
          className={`orb pointer-events-auto absolute h-[50px] w-[50px] ${hint || action ? 'orb-gold' : 'orb-dark'}`}
          style={use}
          onClick={() => client.primaryAction()}
          aria-label={hint ? `Talk to ${hint}` : (action ?? 'Interact')}
        >
          <HudIcon name={hint ? 'talk' : 'use'} size={26} />
          <span className="orb-label -bottom-[18px] text-[10px]">{hint ? 'Talk' : 'Use'}</span>
        </button>
      </div>
      <div className="absolute bottom-[20px] left-[164px] flex flex-col-reverse gap-3">
        <button className="orb orb-dark pointer-events-auto h-[42px] w-[42px]" onClick={() => openPanel('inventory')} aria-label="Inventory">
          <HudIcon name="inventory" size={22} />
        </button>
        <button className="orb orb-dark pointer-events-auto h-[42px] w-[42px]" onClick={() => window.dispatchEvent(new Event('terrago:focus-chat'))} aria-label="Chat">
          <HudIcon name="chat" size={22} />
        </button>
      </div>
    </>
  );
}
