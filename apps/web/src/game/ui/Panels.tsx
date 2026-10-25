'use client';

import { ACTIONS, RESERVED, keyFor, keyLabel, onKeysChanged, resetKeys, setKey, type ActionId } from '../keybinds';
import { useEffect, useMemo, useState } from 'react';
import { CLASSES, getItem, getJob, getMap, skillsForJob } from '@terrago/game-data';
import { BASE_OUTFIT_COUNT, JOB_LEVEL, OUTFITS, QUALITIES, TILE_SIZE, affixText, setOf } from '@terrago/shared';
import { characterPreview } from '../art/characters';
import { renderGround } from '../art/world';
import { audio, loadAudioSettings, type AudioSettings } from '../audio';
import { FX_STYLES, fxSettings, setFxSettings, type FxLevel, type FxSettings, type FxStyle } from '../fx/settings';
import type { GameClient } from '../net/client';
import { useStore, type Panel } from '../store';
import { ItemSlot, RARITY_COLOR } from './ItemSlot';
import { Window } from './Window';
import { EquipmentGrid, SetInfo } from './CombatUi';

export function InventoryPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const inv = useStore(client.ui, (s) => s.inventory);
  const [selected, setSelected] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [trash, setTrash] = useState<{ slot: number; qty: number } | null>(null);
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
    <Window title="Inventory" onClose={onClose} testId="inventory-panel" wide>
      <div className="max-h-[min(34dvh,300px)] overflow-y-auto pr-1">
        <div className="grid grid-cols-8 gap-1">
          {Array.from({ length: inv.capacity }, (_, i) => (
            <ItemSlot key={i} slot={i} item={bySlot.get(i)} selected={selected === i} onClick={() => clickSlot(i)} size={42} />
          ))}
        </div>
      </div>
      <p className="mt-2 flex items-center text-sm">
        <span className="font-bold text-gold-dark">◉ {inv.gold.toLocaleString()} Gold</span>
        <span className="ml-2 text-xs text-wood-dark/70" data-testid="bag-capacity">
          {inv.slots.length}/{inv.capacity} slots
        </span>
        <button className="px-btn ghost small ml-auto" onClick={() => void client.sortBag()} title="Merge identical items and tidy the bag" data-testid="sort-bag">
          Sort &amp; stack
        </button>
      </p>
      <WeightBar client={client} />
      {inv.capacity < 250 && <p className="text-[11px] text-wood-dark/70">Need room? Merchant Mira sells Bag Expansions (+10 slots, up to 250).</p>}
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
            {sel.affixes?.map((a) => (
              <li key={a.stat} className="font-bold" style={{ color: '#3f7fd0' }} data-testid="affix">
                ✦ {affixText(a)}
              </li>
            ))}
            {def.equip && setOf(def.id) && <SetInfo itemId={def.id} />}
            {sel.durability !== null && def.maxDurability && (
              <li>
                Durability {sel.durability}/{def.maxDurability}
              </li>
            )}
          </ul>
          <div className="mt-2 flex gap-2">
            {(def.consumable || def.unlock || def.bagSlots || def.petFood) && (
              <button className="px-btn green small" onClick={() => client.useItem(sel.slot)} data-testid="use-item">
                {def.unlock?.cache ? 'Open' : def.unlock?.skin ? 'Unlock skin' : def.petFood ? 'Feed pet' : 'Use'}
              </button>
            )}
            {def.pet && (
              <button className="px-btn green small" onClick={() => client.useItem(sel.slot)} data-testid="pet-toggle">
                Call / dismiss
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
            {def.category !== 'quest' && (
              <button className="px-btn ghost small ml-auto text-berry" onClick={() => setTrash({ slot: sel.slot, qty: sel.quantity })} data-testid="discard-item">
                🗑 Delete
              </button>
            )}
          </div>
          {trash && trash.slot === sel.slot && (
            <div className="mt-2 border-2 border-berry/50 bg-berry/10 p-2 text-sm" data-testid="discard-confirm">
              <p className="font-bold">Throw away {def.name} for good?</p>
              {sel.quantity > 1 && (
                <label className="mt-1 flex items-center gap-2 text-xs">
                  How many
                  <input
                    type="number"
                    min={1}
                    max={sel.quantity}
                    value={trash.qty}
                    onChange={(e) => setTrash({ slot: sel.slot, qty: Math.max(1, Math.min(sel.quantity, Math.floor(Number(e.target.value) || 1))) })}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="w-20 border-2 border-ink bg-parchment px-1"
                  />
                  of {sel.quantity}
                </label>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  className="px-btn small bg-berry text-parchment"
                  onClick={() => {
                    void client.discard(sel.slot, trash.qty);
                    setTrash(null);
                    if (trash.qty >= sel.quantity) setSelected(null);
                  }}
                  data-testid="discard-yes"
                >
                  Delete
                </button>
                <button className="px-btn ghost small" onClick={() => setTrash(null)}>
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <button className="px-btn ghost small mt-2" onClick={() => client.ui.set({ panel: 'stall' })} data-testid="open-stall-setup">
        🏪 My market stall
      </button>
    </Window>
  );
}

/** Outfits you can wear: the starter outfits plus any skins a game master gave you. */
function Wardrobe({ client }: { client: GameClient }) {
  const self = useStore(client.ui, (s) => s.self);
  const [owned, setOwned] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client
      .wardrobe()
      .then((w) => setOwned(w.owned))
      .catch(() => {});
  }, [client]);
  const choices = useMemo(() => [...OUTFITS.keys()].filter((i) => i < BASE_OUTFIT_COUNT || owned.includes(i)), [owned]);
  const previews = useMemo(() => {
    if (!self || typeof document === 'undefined') return {} as Record<number, string>;
    return Object.fromEntries(choices.map((i) => [i, characterPreview({ ...self.appearance, outfit: i }, 'down', 2).toDataURL()]));
  }, [choices, self]);
  if (!self) return null;
  return (
    <>
      <h3 className="mt-3 text-sm font-bold text-wood-dark">Wardrobe</h3>
      <div className="mt-1 grid grid-cols-5 gap-1" data-testid="wardrobe">
        {choices.map((i) => {
          const o = OUTFITS[i]!;
          const on = self.appearance.outfit === i;
          return (
            <button
              key={i}
              disabled={busy || on}
              title={o.name}
              onClick={async () => {
                setBusy(true);
                const r = await client.wear(i);
                if (r) setOwned(r.owned);
                setBusy(false);
              }}
              className={`flex flex-col items-center border-2 p-0.5 text-[9px] leading-tight ${on ? 'border-gold bg-gold/30' : o.exclusive ? 'border-[#b06ad6] bg-parchment-2' : 'border-ink bg-parchment-2'}`}
              data-testid={`wear-${i}`}
            >
              {previews[i] && <img src={previews[i]} alt="" width={32} height={48} style={{ imageRendering: 'pixelated' }} />}
              <span className="truncate">{o.exclusive ? '👑 ' : ''}{o.name}</span>
            </button>
          );
        })}
      </div>
      {owned.length === 0 && <p className="mt-1 text-[11px] text-wood-dark/70">Exclusive skins appear here when a game master gives you one.</p>}
    </>
  );
}

const STAT_KEY = { STR: 'strength', AGI: 'agility', INT: 'intelligence', VIT: 'vitality', LUK: 'luck' } as const;
const STAT_HELP: Record<string, string> = {
  STR: 'Strength: melee/physical attack, a little defense.',
  AGI: 'Agility: attack speed (ASPD), accuracy and evasion (flee).',
  INT: 'Intelligence: magic attack, max Mana and healing power.',
  VIT: 'Vitality: max HP, HP recovery and physical defense.',
  LUK: 'Luck: critical chance, perfect dodge and slightly better drops.',
};

/** Job Trainer: pick one of your class's two second jobs at level 40. */
export function JobPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const self = useStore(client.ui, (s) => s.self);
  const npcId = useStore(client.ui, (s) => s.serviceNpc);
  if (!self) return null;
  const cls = CLASSES.find((c) => c.id === self.classId);
  return (
    <Window title="Second job" onClose={onClose} testId="job-panel">
      {self.job ? (
        <p>
          You are a <b>{getJob(self.job)?.name}</b>. The choice is final.
        </p>
      ) : (
        <p className="text-sm">
          At level {JOB_LEVEL} a {cls?.name} chooses one path. {self.level < JOB_LEVEL ? <b>You are level {self.level}: come back at {JOB_LEVEL}.</b> : 'Choose carefully: this is permanent.'}
        </p>
      )}
      <div className="mt-2 grid gap-2">
        {cls?.jobs.map((j) => (
          <div key={j.id} className={`border-2 p-2 ${self.job === j.id ? 'border-gold bg-gold/20' : 'border-ink bg-parchment-2'}`} data-testid={`job-${j.id}`}>
            <div className="flex items-center">
              <b className="text-base">{j.name}</b>
              {!self.job && (
                <button
                  className="px-btn green small ml-auto"
                  disabled={self.level < JOB_LEVEL || !npcId}
                  onClick={async () => {
                    if (!confirm(`Become a ${j.name}? You can't change it later.`)) return;
                    if (await client.advanceJob(npcId!, j.id)) onClose();
                  }}
                  data-testid={`job-pick-${j.id}`}
                >
                  Become {j.name}
                </button>
              )}
            </div>
            <p className="text-xs">{j.summary}</p>
            <ul className="mt-1 text-[11px]">
              {skillsForJob(j.id).map((s) => (
                <li key={s.id}>
                  • <b>{s.name}</b> (Lv {s.level}) — {s.description}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
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
        {self.job ? ` · ${getJob(self.job)?.name}` : self.level >= JOB_LEVEL ? ' · second job ready (see Master Aldric)' : ` · second job at Lv ${JOB_LEVEL}`}
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
          <div key={k} className="relative border-2 border-ink bg-parchment-2 py-1" title={STAT_HELP[k]}>
            <div className="font-bold">{v}</div>
            <div className="text-[10px]">{k}</div>
            {(self.statPoints ?? 0) > 0 && (
              <button
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full border-2 border-ink bg-gold text-[11px] leading-none font-bold"
                onClick={(e) => client.addStat(STAT_KEY[k], e.shiftKey ? Math.min(10, self.statPoints ?? 1) : 1)}
                aria-label={`Add a point to ${k}`}
                data-testid={`stat-add-${k}`}
              >
                +
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-wood-dark/80" data-testid="stat-points">
        {(self.statPoints ?? 0) > 0 ? <b className="text-gold-dark">{self.statPoints} stat points to spend</b> : 'No stat points left'} · 5 per level · Shift-click adds 10. Hover a stat to see what it does.
      </p>
      <h3 className="mt-3 text-sm font-bold text-wood-dark">Equipment</h3>
      <EquipmentGrid client={client} />
      <Wardrobe client={client} />
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

function FxSection() {
  const [fx, setFx] = useState<FxSettings>(() => fxSettings());
  const set = (p: Partial<FxSettings>) => setFx(setFxSettings(p));
  const check = (k: 'handWeapon' | 'shake' | 'numbers', label: string) => (
    <label className="mt-1 flex items-center gap-2 text-sm">
      <input type="checkbox" checked={fx[k]} onChange={(e) => set({ [k]: e.target.checked })} data-testid={`fx-${k}`} /> {label}
    </label>
  );
  return (
    <>
      <h3 className="mt-4 font-bold">Graphics</h3>
      <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Graphics">
        {(
          [
            ['ultra', 'Ultra'],
            ['hd', 'HD-2D'],
            ['lite', 'Lite'],
            ['classic', 'Classic'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`px-btn small ${fx.graphics === id ? '' : 'ghost'}`} onClick={() => set({ graphics: id })} aria-pressed={fx.graphics === id} data-testid={`gfx-${id}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-wood-dark/70">HD-2D: sun shadows, richer colour, sunbeams and depth haze — runs on integrated graphics. Ultra adds glow bloom and a focus blur (needs a gaming GPU). Lite: shadows only. Classic: plain pixels. The game steps down by itself if it gets slow.</p>
      <h3 className="mt-4 font-bold">Attack effects</h3>
      <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Effect amount">
        {(['full', 'light', 'off'] as FxLevel[]).map((l) => (
          <button key={l} className={`px-btn small ${fx.level === l ? '' : 'ghost'}`} onClick={() => set({ level: l })} aria-pressed={fx.level === l} data-testid={`fx-level-${l}`}>
            {l === 'full' ? 'Full' : l === 'light' ? 'Light' : 'Off'}
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <span className="w-20">Your colour</span>
        <select className="flex-1 rounded border border-wood-dark/40 bg-white/70 px-1 py-0.5" value={fx.style} onChange={(e) => set({ style: e.target.value as FxStyle })} data-testid="fx-style">
          {FX_STYLES.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {check('handWeapon', 'Show weapons in hand')}
      {check('shake', 'Shake screen on critical hits')}
      {check('numbers', 'Show damage numbers')}
      <p className="mt-1 text-xs text-wood-dark/70">Your colour applies to your own slashes, arrows and spells, and only you see it. Use Light or Off on slow devices.</p>
    </>
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
      <FxSection />
      <ControlsSection />
      <h3 className="mt-4 font-bold">Connection</h3>
      <p className="text-sm">Latency: {ping === null ? '—' : `${ping} ms`}</p>
      <h3 className="mt-4 font-bold">Controls</h3>
      <p className="text-xs leading-relaxed">
        Move: WASD / Arrows · Talk / use: E or Space (or click a nearby tile) · Chat: Enter · Inventory: I · Character: C · Skills: K · Map: M · Select hotbar item: 1–9 (press again to eat) · Attack: F (or click a monster) · Skills: Q R T · Next target: Tab · Ride: Z · Quests: J · Journal (dailies, achievements, ranks): L · Crafting recipes: N · Market: P · Market stall: Inventory → My market stall · Waystones: step on a pad · Friends: O · Guild: G · Trade / Party / Duel: click a player · Chat: /g world, /p party, /gu guild, /w name, /r reply · Emotes: Y (or /wave, /dance, /sit…) · Close: Esc
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
  { id: 'stable', label: 'Stable', key: 'Shift+Z' },
  { id: 'pets', label: 'Pets', key: 'U' },
  { id: 'guild', label: 'Guild', key: 'G' },
  { id: 'friends', label: 'Friends', key: 'O' },
  { id: 'settings', label: 'Settings', key: 'Esc' },
];

/** Bag weight against what your STR lets you carry. */
function WeightBar({ client }: { client: GameClient }) {
  const load = useStore(client.ui, (s) => s.self?.load ?? 0);
  const carry = useStore(client.ui, (s) => s.self?.carry ?? 0);
  if (!carry) return null;
  const k = load / carry;
  const color = k > 1.5 ? '#c0392b' : k > 1 ? '#e8a03a' : '#5fa04a';
  return (
    <div className="mt-1 text-[11px]" data-testid="bag-weight" title="Heavier than your limit: you walk slower. More STR carries more.">
      <div className="flex">
        <span className="font-bold">Weight</span>
        <span className="ml-auto">
          {load} / {carry}
          {k > 1 && <span className="ml-1 font-bold" style={{ color }}>{k > 1.5 ? '— very slow!' : '— slowed'}</span>}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden border border-ink bg-night/30">
        <div className="h-full" style={{ width: `${Math.min(100, k * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

/** Rebind action keys: click a key, then press the new one. */
function ControlsSection() {
  const [, bump] = useState(0);
  const [wait, setWait] = useState<ActionId | null>(null);
  useEffect(() => onKeysChanged(() => bump((n) => n + 1)), []);
  useEffect(() => {
    if (!wait) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const k = e.key.toLowerCase();
      if (k !== 'escape' && !RESERVED.has(k) && k.length === 1) setKey(wait, k);
      setWait(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [wait]);
  return (
    <>
      <h3 className="mt-4 font-bold">Controls</h3>
      <p className="text-xs text-wood-dark/70">Click a key, then press the new one. Move with WASD or arrows; E to talk / use.</p>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm" data-testid="keybinds">
        {ACTIONS.map((a) => (
          <div key={a.id} className="flex items-center">
            <span className="truncate">{a.label}</span>
            <button className={`px-btn small ml-auto min-w-[2.5rem] ${wait === a.id ? 'green' : 'ghost'}`} onClick={() => setWait(a.id)} data-testid={`key-${a.id}`}>
              {wait === a.id ? '…' : keyLabel(keyFor(a.id))}
            </button>
          </div>
        ))}
      </div>
      <button className="px-btn ghost small mt-2" onClick={resetKeys}>
        Reset keys
      </button>
    </>
  );
}
