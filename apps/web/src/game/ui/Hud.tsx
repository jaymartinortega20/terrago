'use client';

import { CLASSES, getJob } from '@terrago/game-data';
import { CharacterPreview } from '@/components/CharacterPreview';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { RESOURCE_COLOR } from './CombatUi';

const RES_SHORT = { mana: 'MP', rage: 'RG', energy: 'EN' } as const;


function Bar({ value, max, color, label, h = 12, testid }: { value: number; max: number; color: string; label: string; h?: number; testid?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="relative overflow-hidden rounded-full bg-black/55 ring-1 ring-white/10" style={{ height: h }} title={`${label} ${value}/${max}`} data-testid={testid}>
      <span
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, background: `linear-gradient(180deg, ${color}, ${color}bb 55%, ${color}88)`, boxShadow: `0 0 10px ${color}88` }}
      />
      <span className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/20" />
      {h >= 10 && (
        <span className="absolute inset-0 flex items-center justify-between px-2 text-[10px] leading-none font-extrabold text-white [text-shadow:0_1px_2px_#000]">
          <span>{label}</span>
          <span className="tabular-nums">
            {value.toLocaleString()} / {max.toLocaleString()}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * Top-left player frame: portrait, Base Level and Job Level, job title,
 * HP and class-resource bars, then the yellow Base EXP and green Job EXP bars.
 */
export function Hud({ client, compact }: { client: GameClient; compact?: boolean }) {
  const self = useStore(client.ui, (s) => s.self);
  const gold = useStore(client.ui, (s) => s.inventory?.gold ?? s.self?.gold ?? 0);
  if (!self) return null;
  const cls = CLASSES.find((c) => c.id === self.classId);
  const res = cls?.resource ?? 'mana';
  const resColor = res === 'mana' ? '#4f8cff' : RESOURCE_COLOR[res];
  const ext = self as typeof self & { jobLevel?: number; jobXp?: number; jobXpToNext?: number };
  const jobLevel = ext.jobLevel ?? 1;
  const portrait = compact ? 64 : 84;
  return (
    <div className="pointer-events-auto flex items-start gap-0" data-testid="hud">
      <div className="relative z-10 shrink-0" style={{ width: portrait, height: portrait }}>
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#ffe9a0] via-[#e0a63a] to-[#8a5a10] p-[2px] shadow-[0_6px_20px_rgba(0,0,0,.5),0_0_18px_rgba(255,200,80,.35)]">
          <div className="relative h-full w-full overflow-hidden rounded-[14px]" style={{ background: 'radial-gradient(circle at 40% 30%, #6ad8ff, #1c2a6a 70%)' }}>
            <CharacterPreview appearance={self.appearance} classId={self.classId} job={self.job} face scale={(portrait - 4) / 24} className="absolute inset-0" />
          </div>
        </div>
        <span
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-b from-[#ffe58a] to-[#e0901c] px-2 py-0.5 text-[11px] font-extrabold whitespace-nowrap text-[#2a1600] shadow-[0_2px_6px_rgba(0,0,0,.5)]"
          data-testid="hud-level"
        >
          Lv {self.level}
        </span>
      </div>
      <div className={`glass -ml-3 rounded-r-2xl rounded-l-md py-2 pr-3 pl-5 ${compact ? 'w-48' : 'w-64'}`} style={{ borderRadius: '6px 18px 18px 6px' }}>
        <div className="flex items-baseline gap-2">
          <span className="max-w-[8rem] truncate font-display text-[15px] font-bold text-white" data-testid="hud-name">
            {self.name}
          </span>
          <span className="ml-auto text-[11px] font-bold text-gold" title="Gold">
            ◉ {gold.toLocaleString()}
          </span>
        </div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold">
          <span className="rounded-md bg-sky/20 px-1.5 py-px text-sky" data-testid="hud-job">
            {getJob(self.job)?.name ?? cls?.name}
          </span>
          <span className="text-parchment/70">Base {self.level}</span>
          <span className="text-parchment/40">·</span>
          <span className="text-parchment/70">Job {jobLevel}</span>
        </div>
        <div className="space-y-1">
          <Bar label="HP" value={self.hp} max={self.maxHp} color="#ff4a5c" h={compact ? 10 : 13} testid="hud-hp" />
          <Bar label={RES_SHORT[res]} value={self.mp} max={self.maxMp} color={resColor} h={compact ? 8 : 11} />
          <div className="flex items-center gap-1.5 pt-0.5">
            <span className="w-7 text-[9px] font-extrabold text-[#ffd84a]">BASE</span>
            <div className="flex-1">
              <Bar label="Base EXP" value={self.xp} max={self.xpToNext} color="#ffd84a" h={4} />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-7 text-[9px] font-extrabold text-[#4ee08a]">JOB</span>
            <div className="flex-1">
              <Bar label="Job EXP" value={ext.jobXp ?? 0} max={ext.jobXpToNext ?? 1} color="#4ee08a" h={4} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
