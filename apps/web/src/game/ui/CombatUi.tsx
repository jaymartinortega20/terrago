'use client';

import { useEffect, useState } from 'react';
import { getItem, skillsForClass } from '@terrago/game-data';
import { EQUIP_SLOTS, ENHANCE_SAFE_LEVEL, MAX_ENHANCE, enhanceChance, enhanceCost } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { ItemSlot, RARITY_COLOR } from './ItemSlot';
import { Window } from './Window';

/** Re-render every `ms` (cooldown timers, effect timers). */
function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function TargetFrame({ client }: { client: GameClient }) {
  const id = useStore(client.ui, (s) => s.targetId);
  const level = useStore(client.ui, (s) => s.self?.level ?? 1);
  useTick(200);
  const duel = useStore(client.ui, (s) => s.duel);
  const foe = id && duel?.id === id ? client.remotes.get(id) : undefined;
  if (foe) {
    return (
      <div className="px-panel-dark pointer-events-auto w-56 px-2 py-1" data-testid="target-frame">
        <div className="flex items-baseline text-xs">
          <span className="font-bold text-[#ff9a3a]">⚔ {foe.info.name}</span>
          <span className="ml-auto text-parchment/80">Lv {foe.info.level}</span>
        </div>
        <div className="px-bar mt-0.5">
          <span style={{ width: `${foe.hp}%`, background: '#d64545' }} />
        </div>
      </div>
    );
  }
  const m = id ? client.monsters.get(id) : undefined;
  if (!m) return null;
  const diff = m.info.level - level;
  const color = diff >= 10 ? '#ff5a5a' : diff >= 5 ? '#ff9a3a' : diff >= 2 ? '#ffe48a' : diff <= -6 ? '#9a9a9a' : '#ffffff';
  return (
    <div className="px-panel-dark pointer-events-auto w-56 px-2 py-1" data-testid="target-frame">
      <div className="flex items-baseline text-xs">
        <span className="font-bold" style={{ color }}>
          {m.info.name}
        </span>
        <span className="ml-auto text-parchment/80">Lv {m.info.level}</span>
        <button className="ml-2 text-parchment/60" onClick={() => client.setTarget(null)} aria-label="Clear target">
          ✕
        </button>
      </div>
      <div className="px-bar mt-0.5">
        <span style={{ width: `${m.hp}%`, background: '#d64545' }} />
      </div>
      {diff >= 5 && <p className="mt-0.5 text-[10px] text-[#ff9a3a]">{diff >= 10 ? 'Far too strong for you.' : 'Dangerous.'}</p>}
    </div>
  );
}

export function EffectsBar({ client }: { client: GameClient }) {
  const effects = useStore(client.ui, (s) => s.effects);
  useTick(500);
  const now = client.serverNow();
  const live = effects.filter((e) => e.until > now);
  if (!live.length) return null;
  return (
    <div className="flex gap-1" data-testid="effects">
      {live.map((e) => (
        <span key={e.id} className={`border-2 border-ink px-1 text-[10px] font-bold ${e.id === 'weakness' || e.id === 'poison' ? 'bg-[#6a2a2a] text-[#ffb0a0]' : 'bg-night-3 text-gold'}`}>
          {e.name} {Math.ceil((e.until - now) / 1000)}s
        </span>
      ))}
    </div>
  );
}

export function SkillBar({ client, compact }: { client: GameClient; compact?: boolean }) {
  const self = useStore(client.ui, (s) => s.self);
  const cooldowns = useStore(client.ui, (s) => s.cooldowns);
  useTick(200);
  if (!self) return null;
  const skills = skillsForClass(self.classId).slice(0, 3);
  const keys = ['Q', 'R', 'T'];
  const now = client.serverNow();
  return (
    <div className={`pointer-events-auto flex ${compact ? 'flex-col' : 'px-panel-dark p-1'} gap-1`} data-testid="skill-bar">
      {skills.map((sk, i) => {
        const cd = Math.max(0, (cooldowns[sk.id] ?? 0) - now);
        const locked = self.level < sk.level;
        const size = compact ? 42 : 40;
        return (
          <button
            key={sk.id}
            title={`${sk.name} (${keys[i]}) — ${sk.description} ${sk.mp} MP`}
            onClick={() => client.useSkill(i)}
            className={`relative flex items-center justify-center border-3 border-ink bg-night ${compact ? 'rounded-full' : ''} ${locked ? 'opacity-40' : ''}`}
            style={{ width: size, height: size, borderWidth: 3 }}
            aria-label={sk.name}
            data-testid={`skill-${i}`}
          >
            <PixelIcon icon={sk.icon} size={size - 14} />
            {cd > 0 && <span className="absolute inset-0 flex items-center justify-center bg-night/70 text-xs font-bold text-parchment">{Math.ceil(cd / 1000)}</span>}
            {!compact && <span className="absolute top-0 left-0.5 text-[9px] text-parchment/60">{keys[i]}</span>}
            {locked && <span className="absolute right-0 bottom-0 text-[9px] text-parchment/80">L{sk.level}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const SLOT_LABELS: Record<string, string> = {
  mainhand: 'Weapon',
  offhand: 'Off-hand',
  head: 'Head',
  chest: 'Chest',
  gloves: 'Gloves',
  boots: 'Boots',
  ring: 'Ring',
  necklace: 'Necklace',
  cape: 'Cape',
};

/** Worn equipment grid (click to take off). */
export function EquipmentGrid({ client }: { client: GameClient }) {
  const eq = useStore(client.ui, (s) => s.inventory?.equipment ?? []);
  const bySlot = new Map(eq.map((e) => [e.slot, e]));
  return (
    <div className="grid grid-cols-3 gap-1.5" data-testid="equipment">
      {EQUIP_SLOTS.map((name, i) => {
        const it = bySlot.get(i);
        return (
          <div key={name} className="flex flex-col items-center text-[10px]">
            <ItemSlot slot={100 + i} item={it} size={40} onClick={() => it && client.unequip(i)} />
            <span>
              {SLOT_LABELS[name]}
              {it?.enhance ? ` +${it.enhance}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function EnhancePanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const inv = useStore(client.ui, (s) => s.inventory);
  const [busy, setBusy] = useState(false);
  if (!inv) return null;
  const stones = inv.slots.filter((s) => s.itemId === 'enhancement_stone').reduce((n, s) => n + s.quantity, 0);
  return (
    <Window title="Enhancement Altar" onClose={onClose} testId="enhance-panel" wide>
      <p className="text-xs">
        Strengthen worn equipment (+8% stats per level, up to +{MAX_ENHANCE}). Costs Gold and Enhancement Stones even on failure. Failures above +{ENHANCE_SAFE_LEVEL} drop the item one level — it is
        never destroyed. You have <b>{stones}</b> stones.
      </p>
      <ul className="mt-2 space-y-1">
        {(inv.equipment ?? []).map((e) => {
          const def = getItem(e.itemId);
          if (!def) return null;
          const lvl = e.enhance ?? 0;
          const cost = enhanceCost(lvl, def.vendorValue);
          return (
            <li key={e.slot} className="flex items-center gap-2 border-2 border-parchment-3 bg-parchment-2 p-1">
              <PixelIcon icon={def.icon} size={28} />
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-bold" style={{ color: RARITY_COLOR[def.rarity] }}>
                  {def.name} +{lvl}
                </p>
                {lvl < MAX_ENHANCE ? (
                  <p>
                    → +{lvl + 1}: {Math.round(enhanceChance(lvl) * 100)}% · {cost.gold} Gold · {cost.stones} stone{cost.stones > 1 ? 's' : ''}
                  </p>
                ) : (
                  <p>Maximum level.</p>
                )}
              </div>
              <button
                className="px-btn green small"
                disabled={busy || lvl >= MAX_ENHANCE || stones < cost.stones || inv.gold < cost.gold}
                onClick={async () => {
                  setBusy(true);
                  await client.enhance(e.slot);
                  setBusy(false);
                }}
              >
                Enhance
              </button>
            </li>
          );
        })}
        {!(inv.equipment ?? []).length && <li className="text-sm">Wear something first.</li>}
      </ul>
    </Window>
  );
}
