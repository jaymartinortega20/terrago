'use client';

import { useEffect, useState } from 'react';
import { getClass, getItem, skillsFor } from '@terrago/game-data';

export const RESOURCE_LABEL = { mana: 'Mana', rage: 'Rage', energy: 'Energy' } as const;
export const RESOURCE_COLOR = { mana: '#4a7fd6', rage: '#c0392b', energy: '#e6c229' } as const;
import { EQUIP_SLOTS, ENHANCE_SAFE_LEVEL, MAX_ENHANCE, enhanceChance, enhanceCost } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { keyFor, keyLabel, type ActionId } from '../keybinds';
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
    <div className="flex flex-wrap gap-1.5 pl-1" data-testid="effects">
      {live.map((e) => {
        const bad = e.id === 'weakness' || e.id === 'poison' || e.id.includes('slow') || e.id.includes('curse');
        return (
          <span key={e.id} className="hud-pill flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold" style={{ boxShadow: `0 0 0 1.5px ${bad ? '#ff6a5a' : '#e8c060'}`, color: bad ? '#ffb0a0' : '#ffe9a8' }}>
            {e.name} {Math.ceil((e.until - now) / 1000)}s
          </span>
        );
      })}
    </div>
  );
}

/** One round skill button: icon, hotkey badge, cooldown sweep and seconds left. */
export function SkillOrb({ client, index, size = 48, showKey = true }: { client: GameClient; index: number; size?: number; showKey?: boolean }) {
  const self = useStore(client.ui, (s) => s.self);
  const cooldowns = useStore(client.ui, (s) => s.cooldowns);
  if (!self) return null;
  const sk = skillsFor(self.classId, self.job)[index];
  if (!sk) return null;
  const res = RESOURCE_LABEL[getClass(self.classId).resource];
  const now = client.serverNow();
  const cd = Math.max(0, (cooldowns[sk.id] ?? 0) - now);
  const pct = cd > 0 && sk.cooldownMs ? Math.min(100, (cd / sk.cooldownMs) * 100) : 0;
  const locked = self.level < sk.level;
  const short = self.mp < sk.mp;
  return (
    <button
      title={`${sk.name} (${keyLabel(keyFor(`skill${index + 1}` as ActionId))}) — ${sk.description} ${sk.mp} ${res}`}
      onClick={() => client.useSkill(index)}
      className={`orb pointer-events-auto ${cd > 0 || locked ? 'orb-dark' : ''} ${locked ? 'orb-disabled' : ''}`}
      style={{ width: size, height: size }}
      aria-label={sk.name}
      data-testid={`skill-${index}`}
    >
      <PixelIcon icon={sk.icon} size={Math.round(size * 0.62)} />
      {showKey && <span className="orb-key">{keyLabel(keyFor(`skill${index + 1}` as ActionId))}</span>}
      {pct > 0 && <span className="orb-cd" style={{ ['--p' as string]: `${pct}%` }} />}
      {cd > 0 && <span className="orb-num" style={{ fontSize: size * 0.34 }}>{cd < 1000 ? (cd / 1000).toFixed(1) : Math.ceil(cd / 1000)}</span>}
      {locked && <span className="orb-num bottom-0 text-[10px]">L{sk.level}</span>}
      {!locked && short && cd <= 0 && <span className="absolute inset-0 rounded-full bg-[#1a2a6a]/45" />}
    </button>
  );
}

export function SkillBar({ client }: { client: GameClient }) {
  const self = useStore(client.ui, (s) => s.self);
  useTick(150);
  if (!self) return null;
  const skills = skillsFor(self.classId, self.job);
  return (
    <div className="pointer-events-auto flex gap-2.5 px-1 pt-3 pb-1" data-testid="skill-bar">
      {skills.map((sk, i) => (
        <SkillOrb key={sk.id} client={client} index={i} size={42} />
      ))}
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
  const count = (id: string) => inv.slots.filter((s) => s.itemId === id).reduce((n, s) => n + s.quantity, 0);
  const have = { ruby: count('ruby') + count('enhancement_stone'), sapphire: count('sapphire'), diamond: count('diamond') };
  return (
    <Window title="Blacksmith: Upgrades" onClose={onClose} testId="enhance-panel" wide>
      <p className="text-xs">
        Upgrade worn gear up to +{MAX_ENHANCE} (+8% stats per level). Each upgrade costs Gold and gems, even on failure: <b className="text-[#c0392b]">Ruby</b> for +1–+3,{' '}
        <b className="text-[#2f5fa8]">Sapphire</b> for +4–+6, <b>Diamond</b> for +7–+10. Mine them in the Desolate Crags and Glacial Depths. Failures above +{ENHANCE_SAFE_LEVEL} drop the item one
        level; it is never destroyed. Upgraded gear glows: blue from +4, purple from +7, radiant gold at +10.
      </p>
      <p className="mt-1 text-xs" data-testid="gem-count">
        You have <b>{have.ruby}</b> Ruby (incl. blessed stones) · <b>{have.sapphire}</b> Sapphire · <b>{have.diamond}</b> Diamond
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
                    → +{lvl + 1}: {Math.round(enhanceChance(lvl) * 100)}% · {cost.gold} Gold · {cost.gems} {getItem(cost.gem)?.name}
                    {cost.gems > 1 ? 's' : ''}
                  </p>
                ) : (
                  <p>Maximum level.</p>
                )}
              </div>
              <button
                className="px-btn green small"
                disabled={busy || lvl >= MAX_ENHANCE || have[cost.gem] < cost.gems || inv.gold < cost.gold}
                onClick={async () => {
                  setBusy(true);
                  await client.enhance(e.slot);
                  setBusy(false);
                }}
              >
                Upgrade
              </button>
            </li>
          );
        })}
        {!(inv.equipment ?? []).length && <li className="text-sm">Wear something first.</li>}
      </ul>
    </Window>
  );
}

/** Big health bar for a boss you are fighting (or near). */
export function BossBar({ client }: { client: GameClient }) {
  useTick(250);
  const boss = [...client.monsters.values()].find((m) => m.info.boss && Math.hypot(m.x - client.pos.x, m.y - client.pos.y) < 14 * 32);
  if (!boss) return null;
  return (
    <div className="px-panel-dark w-[min(80vw,420px)] px-3 py-1.5 text-center" data-testid="boss-bar">
      <div className="text-sm font-bold text-[#ff9a7a]">
        ☠ {boss.info.name} <span className="text-xs text-parchment/70">Lv {boss.info.level}</span>
      </div>
      <div className="px-bar mt-1 h-3">
        <span style={{ width: `${boss.hp}%`, background: 'linear-gradient(#e0483a, #a02a20)' }} />
      </div>
    </div>
  );
}
