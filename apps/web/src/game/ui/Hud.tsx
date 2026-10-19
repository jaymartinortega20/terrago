'use client';

import { CLASSES } from '@terrago/game-data';
import { CharacterPreview } from '@/components/CharacterPreview';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

function Bar({ value, max, color, label, compact }: { value: number; max: number; color: string; label: string; compact?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-1.5" title={`${label} ${value}/${max}`}>
      <span className="w-6 text-[10px] font-bold text-parchment/80">{label}</span>
      <div className={`px-bar ${compact ? 'w-20' : 'w-32 sm:w-40'}`}>
        <span style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-14 text-right text-[10px] tabular-nums text-parchment/90">
        {value}/{max}
      </span>
    </div>
  );
}

/** Top-left player status: portrait, level, HP / MP / Energy, Gold. */
export function Hud({ client, compact }: { client: GameClient; compact?: boolean }) {
  const self = useStore(client.ui, (s) => s.self);
  const gold = useStore(client.ui, (s) => s.inventory?.gold ?? s.self?.gold ?? 0);
  if (!self) return null;
  const cls = CLASSES.find((c) => c.id === self.classId);
  return (
    <div className={`px-panel-dark pointer-events-auto flex items-center gap-2 ${compact ? 'origin-top-left scale-90 p-1.5' : 'p-2'}`} data-testid="hud">
      <div className="h-14 w-12 overflow-hidden border-2 border-ink bg-[#67a84a]">
        <div style={{ marginLeft: -24, marginTop: -4 }}>
          <CharacterPreview appearance={self.appearance} scale={6} />
        </div>
      </div>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-gold" data-testid="hud-name">
            {self.name}
          </span>
          <span className="text-[11px] text-parchment/80">
            Lv {self.level} {cls?.name}
          </span>
          <span className="ml-auto text-[11px] text-gold" title="Gold">
            ◉ {gold.toLocaleString()}
          </span>
        </div>
        <Bar compact={compact} label="HP" value={self.hp} max={self.maxHp} color="#d64545" />
        <Bar compact={compact} label="MP" value={self.mp} max={self.maxMp} color="#4a7fd6" />
        <Bar compact={compact} label="EN" value={self.energy} max={self.maxEnergy} color="#e0a52e" />
      </div>
    </div>
  );
}
