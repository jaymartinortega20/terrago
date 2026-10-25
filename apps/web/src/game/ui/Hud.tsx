'use client';

import { CLASSES, getJob } from '@terrago/game-data';
import { CharacterPreview } from '@/components/CharacterPreview';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { RESOURCE_COLOR } from './CombatUi';

const RES_SHORT = { mana: 'MP', rage: 'RG', energy: 'EN' } as const;

function Ring({ r, value, max, color, track, width }: { r: number; value: number; max: number; color: string; track: string; width: number }) {
  const c = 2 * Math.PI * r;
  const k = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <>
      <circle cx="50" cy="50" r={r} fill="none" stroke={track} strokeWidth={width} />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeDasharray={`${k * c} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        style={{ filter: `drop-shadow(0 0 3px ${color})`, transition: 'stroke-dasharray 0.25s' }}
      />
    </>
  );
}

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-1.5" title={`${label} ${value}/${max}`}>
      <span className="w-5 text-[10px] font-bold text-parchment/80">{label}</span>
      <div className="hud-bar w-32 sm:w-36">
        <span style={{ width: `${pct}%`, background: `linear-gradient(180deg, ${color}, ${color}aa)` }} />
      </div>
      <span className="w-16 text-right text-[10px] tabular-nums text-parchment/90">
        {value}/{max}
      </span>
    </div>
  );
}

/**
 * Top-left player status: a round portrait ringed by HP (outer, red) and the
 * class resource (inner), a level badge, and on desktop the exact numbers.
 */
export function Hud({ client, compact }: { client: GameClient; compact?: boolean }) {
  const self = useStore(client.ui, (s) => s.self);
  const gold = useStore(client.ui, (s) => s.inventory?.gold ?? s.self?.gold ?? 0);
  if (!self) return null;
  const cls = CLASSES.find((c) => c.id === self.classId);
  const res = cls?.resource ?? 'mana';
  const resColor = res === 'mana' ? '#3a8aff' : RESOURCE_COLOR[res];
  const size = compact ? 78 : 96;
  const xpPct = self.xpToNext > 0 ? Math.min(100, (self.xp / self.xpToNext) * 100) : 100;
  return (
    <div className="pointer-events-auto flex items-start gap-2" data-testid="hud">
      <div className="relative shrink-0" style={{ width: size, height: size + 12 }}>
        <svg width={size} height={size} viewBox="0 0 100 100" className="absolute inset-0" aria-hidden>
          <circle cx="50" cy="50" r="48" fill="#1a1208" stroke="#e8c060" strokeWidth="3" />
          <circle cx="50" cy="50" r="46" fill="none" stroke="#7a4e18" strokeWidth="1.5" />
          <Ring r={41} value={self.hp} max={self.maxHp} color="#ff3a3a" track="#3a0c0c" width={6} />
          <Ring r={34} value={self.mp} max={self.maxMp} color={resColor} track="#0c1a2a" width={5} />
          <circle cx="50" cy="50" r="30" fill="url(#hud-portrait-bg)" />
          <defs>
            <radialGradient id="hud-portrait-bg" cx="40%" cy="30%">
              <stop offset="0" stopColor="#5ae0e8" />
              <stop offset="1" stopColor="#0a3040" />
            </radialGradient>
          </defs>
        </svg>
        <div className="absolute overflow-hidden rounded-full" style={{ left: size * 0.2, top: size * 0.2, width: size * 0.6, height: size * 0.6 }}>
          <div style={{ marginLeft: -size * 0.24, marginTop: -size * 0.02 }}>
            <CharacterPreview appearance={self.appearance} scale={compact ? 4 : 5} />
          </div>
        </div>
        <div className="hud-pill absolute left-1/2 -translate-x-1/2 px-2 text-[12px] font-bold whitespace-nowrap text-[#ffe9a8]" style={{ top: size - 10, boxShadow: '0 0 0 2px #e8c060' }} data-testid="hud-level">
          Lv {self.level}
        </div>
      </div>
      <div className={`hud-pill px-2.5 py-1.5 ${compact ? 'mt-1' : 'mt-2'}`}>
        <div className="flex items-baseline gap-2">
          <span className="max-w-[9rem] truncate text-sm font-bold text-gold" data-testid="hud-name">
            {self.name}
          </span>
          {!compact && <span className="text-[11px] text-parchment/80">{getJob(self.job)?.name ?? cls?.name}</span>}
          <span className="ml-auto text-[11px] text-gold" title="Gold">
            ◉ {gold.toLocaleString()}
          </span>
        </div>
        {compact ? (
          <p className="text-[10px] text-parchment/80">
            HP {self.hp}/{self.maxHp} · {RES_SHORT[res]} {self.mp}
          </p>
        ) : (
          <>
            <Bar label="HP" value={self.hp} max={self.maxHp} color="#ff4a4a" />
            <Bar label={RES_SHORT[res]} value={self.mp} max={self.maxMp} color={resColor} />
            <Bar label="ST" value={self.energy} max={self.maxEnergy} color="#9ab85a" />
          </>
        )}
        <div className="hud-bar mt-1" style={{ height: 3 }} title={`XP ${self.xp}/${self.xpToNext}`}>
          <span style={{ width: `${xpPct}%`, background: '#ffd34a' }} />
        </div>
      </div>
    </div>
  );
}
