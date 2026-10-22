'use client';

import { useEffect, useMemo, useState } from 'react';
import { CLASSES, getItem, getMap } from '@terrago/game-data';
import { QUALITIES, TILE_SIZE } from '@terrago/shared';
import { renderGround } from '../art/world';
import { audio, loadAudioSettings, type AudioSettings } from '../audio';
import type { GameClient } from '../net/client';
import { useStore, type Panel } from '../store';
import { ItemSlot, RARITY_COLOR } from './ItemSlot';
import { Window } from './Window';
import { EquipmentGrid } from './CombatUi';

export function InventoryPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const inv = useStore(client.ui, (s) => s.inventory);
  const [selected, setSelected] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  if (!inv) return null;
  const bySlot = new Map(inv.slots.map((s) => [s.slot, s]));
  const sel = selected !== null ? bySlot.get(selected) : undefined;
  const def = sel ? getItem(sel.itemId) : undefined;

  const clickSlot = (i: number) => {
    if (moving && selected !== null) {
      if (i !== selected) client.moveItem(selected, i);
      setMoving(false);
      setSelected(i);
      return;
    }
    setSelected(i === selected ? null : i);
  };

  return (
    <Window title="Inventory" onClose={onClose} testId="inventory-panel">
      <div className="grid grid-cols-5 gap-1.5 justify-self-center">
        {Array.from({ length: inv.capacity }, (_, i) => (
          <ItemSlot key={i} slot={i} item={bySlot.get(i)} selected={selected === i} onClick={() => clickSlot(i)} />
        ))}
      </div>
      <p className="mt-2 text-sm">
        <span className="font-bold text-gold-dark">◉ {inv.gold.toLocaleString()} Gold</span>
        <span className="ml-2 text-xs text-wood-dark/70">
          {inv.slots.length}/{inv.capacity} slots used
        </span>
      </p>
      {moving && <p className="mt-1 text-xs font-bold text-leaf-dark">Choose a slot to move the item to…</p>}
      {sel && def && (
        <div className="mt-3 border-t-2 border-parchment-3 pt-2" data-testid="item-details">
          <p className="text-base font-bold" style={{ color: RARITY_COLOR[def.rarity] }}>
            {def.name} {sel.quantity > 1 && <span className="text-ink">×{sel.quantity}</span>}
          </p>
          <p className="text-xs capitalize text-wood-dark">
            {def.rarity} {def.category}
            {sel.quality > 0 && ` · ${QUALITIES[sel.quality]} quality`}
          </p>
          <p className="mt-1 text-sm leading-snug">{def.description}</p>
          <ul className="mt-1 text-xs text-wood-dark/90">
            <li>Level {def.levelRequirement}+ · Sells to shops for {def.vendorValue} Gold</li>
            <li>{def.tradable && !sel.bound ? 'Tradable' : 'Bound — cannot be traded'}</li>
            {def.equip && (
              <li className="font-bold text-ink">
                {def.equip.slot}
                {def.equip.classes ? ` · ${def.equip.classes.join('/')}` : ''} ·{' '}
                {Object.entries(def.equip.stats)
                  .map(([k, v]) => `${k.toUpperCase()} +${v}`)
                  .join(', ')}
                {def.equip.range ? ` · range ${def.equip.range}` : ''}
              </li>
            )}
            {sel.durability !== null && def.maxDurability && (
              <li>
                Durability {sel.durability}/{def.maxDurability}
              </li>
            )}
          </ul>
          <div className="mt-2 flex gap-2">
            {def.consumable && (
              <button className="px-btn green small" onClick={() => client.useItem(sel.slot)} data-testid="use-item">
                Use
              </button>
            )}
            {def.equip && (
              <button className="px-btn green small" onClick={() => client.equip(sel.slot)} data-testid="equip-item">
                Equip
              </button>
            )}
            <button className="px-btn ghost small" onClick={() => setMoving(true)}>
              Move
            </button>
            {sel.slot < 9 && (
              <button className="px-btn ghost small" onClick={() => client.selectSlot(sel.slot)}>
                Hold
              </button>
            )}
          </div>
        </div>
      )}
      <button className="px-btn ghost small mt-2" onClick={() => client.ui.set({ panel: 'stall' })} data-testid="open-stall-setup">
        🏪 My market stall
      </button>
    </Window>
  );
}

export function CharacterPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const self = useStore(client.ui, (s) => s.self);
  if (!self) return null;
  const cls = CLASSES.find((c) => c.id === self.classId);
  const d = self.derived;
  const rows: [string, string | number][] = [
    ['Physical Attack', d.physicalAttack],
    ['Magic Attack', d.magicAttack],
    ['Physical Defense', d.physicalDefense],
    ['Magic Defense', d.magicDefense],
    ['Accuracy', d.accuracy],
    ['Evasion', d.evasion],
    ['Critical Chance', `${d.criticalChance}%`],
    ['Critical Damage', `${d.criticalDamage}%`],
    ['Attack Speed', `${d.attackSpeed}%`],
    ['Movement Speed', `${d.movementSpeed}%`],
    ['Gathering Efficiency', `${d.gatheringEfficiency}%`],
  ];
  const xpPct = self.xpToNext ? Math.min(100, (self.xp / self.xpToNext) * 100) : 100;
  return (
    <Window title="Character" onClose={onClose} testId="character-panel">
      <p className="text-xl font-bold">{self.name}</p>
      <p className="text-sm">
        Level {self.level} {cls?.name}
      </p>
      <div className="mt-1 text-xs">
        XP {self.xp.toLocaleString()} / {self.xpToNext.toLocaleString()}
        <div className="px-bar mt-0.5">
          <span style={{ width: `${xpPct}%`, background: '#9b59d0' }} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1 text-center text-xs">
        {(
          [
            ['STR', self.stats.strength],
            ['AGI', self.stats.agility],
            ['INT', self.stats.intelligence],
            ['VIT', self.stats.vitality],
            ['LUK', self.stats.luck],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="border-2 border-ink bg-parchment-2 py-1">
            <div className="font-bold">{v}</div>
            <div className="text-[10px]">{k}</div>
          </div>
        ))}
      </div>
      <h3 className="mt-3 text-sm font-bold text-wood-dark">Equipment</h3>
      <EquipmentGrid client={client} />
      <table className="mt-3 w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-parchment-3/60">
              <td className="py-0.5">{k}</td>
              <td className="py-0.5 text-right font-bold tabular-nums">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Window>
  );
}

export function MapPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const mapId = useStore(client.ui, (s) => s.mapId);
  const tile = useStore(client.ui, (s) => s.tile);
  const map = mapId ? getMap(mapId) : undefined;
  const url = useMemo(() => {
    if (!map) return null;
    const ground = renderGround(map);
    const scale = 6 / TILE_SIZE; // 6px per tile
    const c = document.createElement('canvas');
    c.width = map.width * 6;
    c.height = map.height * 6;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ground, 0, 0, c.width, c.height);
    for (const o of map.objects) {
      if (o.kind === 'building') {
        ctx.fillStyle = o.roof;
        ctx.fillRect(o.x * 6, o.y * 6, o.w * 6, o.h * 6);
        ctx.strokeStyle = '#2a2030';
        ctx.strokeRect(o.x * 6 + 0.5, o.y * 6 + 0.5, o.w * 6 - 1, o.h * 6 - 1);
      } else if (o.type.startsWith('tree')) {
        ctx.fillStyle = '#2f6b35';
        ctx.fillRect(o.x * 6, o.y * 6, 6, 6);
      }
    }
    void scale;
    return c.toDataURL();
  }, [map]);
  if (!map || !url) return null;
  return (
    <Window title={map.name} onClose={onClose} testId="map-panel">
      <div className="relative mx-auto border-4 border-ink" style={{ width: map.width * 5, maxWidth: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Map of ${map.name}`} className="pixel block w-full" />
        <span
          className="absolute h-2.5 w-2.5 animate-pulse border-2 border-ink bg-gold"
          style={{ left: `${((tile.x + 0.5) / map.width) * 100}%`, top: `${((tile.y + 0.5) / map.height) * 100}%`, transform: 'translate(-50%,-50%)' }}
          aria-label="You are here"
        />
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
        {map.objects.flatMap((o) => (o.kind === 'building' ? [<li key={o.id}>■ {o.name}</li>] : []))}
      </ul>
    </Window>
  );
}

export function SettingsPanel({ client, onClose, onLogout, onSwitch }: { client: GameClient; onClose: () => void; onLogout: () => void; onSwitch: () => void }) {
  const [s, setS] = useState<AudioSettings>(() => loadAudioSettings());
  const ping = useStore(client.ui, (st) => st.ping);
  useEffect(() => audio.update(s), [s]);
  const slider = (k: 'music' | 'effects' | 'ambient', label: string) => (
    <label className="mt-2 flex items-center gap-2 text-sm">
      <span className="w-20">{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} className="flex-1 accent-[#5fa04a]" />
      <span className="w-8 text-right tabular-nums">{Math.round(s[k] * 100)}</span>
    </label>
  );
  return (
    <Window title="Settings" onClose={onClose} testId="settings-panel">
      <h3 className="font-bold">Audio</h3>
      {slider('music', 'Music')}
      {slider('effects', 'Effects')}
      {slider('ambient', 'Ambient')}
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.muted} onChange={(e) => setS({ ...s, muted: e.target.checked })} /> Mute all
      </label>
      <p className="mt-1 text-xs text-wood-dark/70">Music and sounds start after your first click or key press. Levels are saved in this browser.</p>
      <h3 className="mt-4 font-bold">Connection</h3>
      <p className="text-sm">Latency: {ping === null ? '—' : `${ping} ms`}</p>
      <h3 className="mt-4 font-bold">Controls</h3>
      <p className="text-xs leading-relaxed">
        Move: WASD / Arrows · Talk / use: E or Space (or click a nearby tile) · Chat: Enter · Inventory: I · Character: C · Skills: K · Map: M · Select hotbar item: 1–9 (press again to eat) · Attack: F (or click a monster) · Skills: Q R T · Next target: Tab · Ride: Z · Quests: J · Journal (dailies, achievements, ranks): L · Crafting recipes: N · Market: P · Market stall: Inventory → My market stall · Waystones: step on a pad · Friends: O · Guild: G · Trade / Party / Duel: click a player · Chat: /g world, /p party, /gu guild, /w name, /r reply · Close: Esc
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="px-btn ghost small" onClick={onSwitch}>
          Switch character
        </button>
        <button className="px-btn small" onClick={onLogout} data-testid="logout">
          Log out
        </button>
      </div>
    </Window>
  );
}

export const MENU: { id: Exclude<Panel, null> | string; label: string; key: string; version?: string }[] = [
  { id: 'character', label: 'Character', key: 'C' },
  { id: 'inventory', label: 'Inventory', key: 'I' },
  { id: 'skills', label: 'Skills', key: 'K' },
  { id: 'quests', label: 'Quests', key: 'J' },
  { id: 'map', label: 'Map', key: 'M' },
  { id: 'journal', label: 'Journal', key: 'L' },
  { id: 'crafting', label: 'Crafting', key: 'N' },
  { id: 'market', label: 'Market', key: 'P' },
  { id: 'guild', label: 'Guild', key: 'G' },
  { id: 'friends', label: 'Friends', key: 'O' },
  { id: 'settings', label: 'Settings', key: 'Esc' },
];
