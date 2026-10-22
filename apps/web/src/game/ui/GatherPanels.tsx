'use client';

import { useEffect, useRef, useState } from 'react';
import { MAPS, RECIPES, getItem, recipesFor } from '@terrago/game-data';
import { FISHING_STEP_MS, SKILL_NAMES, getSpec, type SkillId, fishingStart, fishingStep, type FishingState, type StationType } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { RARITY_COLOR } from './ItemSlot';
import { Window } from './Window';

const STATION_TITLES: Record<string, string> = {
  furnace: 'Furnace — smelting',
  anvil: 'Anvil — smithing',
  workbench: 'Workbench — crafting',
  cooking_pot: 'Cooking Pot',
  alchemy_table: 'Alchemy Table',
  mill: 'Mill',
  loom: 'Loom',
  enhance_altar: 'Enhancement Altar',
};

export function CraftPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const station = useStore(client.ui, (s) => s.station) as StationType | null;
  const inv = useStore(client.ui, (s) => s.inventory);
  const skills = useStore(client.ui, (s) => s.self?.skills);
  const [busy, setBusy] = useState(false);
  const specs = useStore(client.ui, (s) => s.self?.specs ?? {});
  if (!station || !inv || !skills) return null;
  const have = (id: string) => inv.slots.filter((s) => s.itemId === id).reduce((n, s) => n + s.quantity, 0);
  const recipes = recipesFor(station);
  return (
    <Window title={STATION_TITLES[station] ?? station} onClose={onClose} testId="craft-panel" wide>
      <ul className="space-y-1.5">
        {recipes.map((r) => {
          const out = getItem(r.output.itemId)!;
          const lvl = skills[r.skill].level;
          const locked = lvl < r.level || (!!r.spec && specs[r.skill] !== r.spec);
          const max = Math.min(50, ...r.inputs.map((i) => Math.floor(have(i.itemId) / i.quantity)), r.fee > 0 ? Math.floor(inv.gold / r.fee) : 50);
          return (
            <li key={r.id} className={`border-2 border-parchment-3 bg-parchment-2 p-1.5 ${locked ? 'opacity-55' : ''}`} data-testid={`recipe-${r.id}`}>
              <div className="flex items-center gap-2">
                <PixelIcon icon={out.icon} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" style={{ color: RARITY_COLOR[out.rarity] }}>
                    {out.name} {r.output.quantity > 1 && `×${r.output.quantity}`}
                  </p>
                  <p className="text-[11px] text-wood-dark">
                    {SKILL_NAMES[r.skill]} {r.level}
                    {lvl < r.level && ` (you: ${lvl})`} · +{r.xp} XP{r.fee ? ` · ${r.fee} Gold fee` : ''}
                    {r.spec && <b className="ml-1 text-gold-dark">★ {getSpec(r.spec)?.name} only</b>}
                  </p>
                </div>
                <button className="px-btn green small" disabled={busy || locked || max < 1} onClick={async () => { setBusy(true); await client.craft(r.id, 1); setBusy(false); }}>
                  Make
                </button>
                {max > 1 && (
                  <button className="px-btn small" disabled={busy || locked} onClick={async () => { setBusy(true); await client.craft(r.id, max); setBusy(false); }}>
                    ×{max}
                  </button>
                )}
              </div>
              <p className="mt-1 flex flex-wrap gap-x-2 text-[11px]">
                {r.inputs.map((i) => (
                  <span key={i.itemId} className={have(i.itemId) >= i.quantity ? 'text-leaf-dark' : 'text-[#a33]'}>
                    {i.quantity}× {getItem(i.itemId)?.name} ({have(i.itemId)})
                  </span>
                ))}
              </p>
            </li>
          );
        })}
      </ul>
    </Window>
  );
}

export function LiftPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const npc = useStore(client.ui, (s) => s.serviceNpc);
  const [floors, setFloors] = useState<number[] | null>(null);
  useEffect(() => {
    if (npc) client.liftFloors(npc).then((r) => setFloors(r.floors), () => setFloors([]));
  }, [client, npc]);
  if (!npc) return null;
  return (
    <Window title="Mine lift" onClose={onClose} testId="lift-panel">
      <p className="text-sm">The ladder by the entrance goes to floor 1. Reach floors 5, 10, 15… and the lift can take you back there.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {floors?.length === 0 && <p className="text-xs">You haven&apos;t reached a lift stop yet.</p>}
        {floors?.map((f) => (
          <button key={f} className="px-btn green small" onClick={() => { void client.liftGo(npc, f); onClose(); }}>
            Floor {f}
          </button>
        ))}
      </div>
    </Window>
  );
}

/** Waiting for a bite, then the reeling minigame. Hold Space / mouse / touch to raise the green zone. */
export function FishingOverlay({ client }: { client: GameClient }) {
  const fishing = useStore(client.ui, (s) => s.fishing);
  const round = fishing?.phase === 'reeling' ? fishing.round : null;
  const [view, setView] = useState<FishingState | null>(null);
  const holding = useRef(false);

  useEffect(() => {
    if (!round) return;
    const p = round;
    const s = fishingStart(p);
    const toggles: number[] = [];
    let held = false;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        holding.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'e' || e.key === 'E') holding.current = false;
    };
    const mdown = () => (holding.current = true);
    const mup = () => (holding.current = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointerdown', mdown);
    window.addEventListener('pointerup', mup);
    window.addEventListener('pointercancel', mup);
    const frame = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      while (acc >= FISHING_STEP_MS && !s.done) {
        if (holding.current !== held) {
          held = holding.current;
          toggles.push(s.step);
        }
        fishingStep(p, s, held);
        acc -= FISHING_STEP_MS;
      }
      setView({ ...s });
      if (s.done) {
        client.reel(p, toggles, s.step);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointerdown', mdown);
      window.removeEventListener('pointerup', mup);
      window.removeEventListener('pointercancel', mup);
      holding.current = false;
    };
  }, [client, round]);

  if (!fishing) return null;
  if (fishing.phase !== 'reeling') {
    return (
      <div className="px-panel-dark px-3 py-1 text-sm font-bold text-gold" data-testid="fishing-wait">
        {fishing.phase === 'bite' ? '! Something bit — press E / tap Use NOW!' : 'Waiting for a bite… (move to stop fishing)'}
      </div>
    );
  }
  if (!view || !round) return null;
  const H = 220;
  return (
    <div className="px-panel pointer-events-auto flex items-end gap-3 p-3 select-none" data-testid="fishing-game" style={{ touchAction: 'none' }}>
      <div className="relative w-10 border-4 border-ink bg-[#2e5d8a]" style={{ height: H }}>
        <div className="absolute right-0 left-0 border-y-2 border-[#d8ffb0] bg-[#7cc35a]/70" style={{ bottom: view.zonePos * H, height: round.zone * H }} />
        <div className="absolute left-1/2 h-4 w-6 -translate-x-1/2 border-2 border-ink bg-[#f2c14e]" style={{ bottom: view.fishPos * H - 8 }} />
      </div>
      <div className="relative w-3 border-2 border-ink bg-night" style={{ height: H }}>
        <div className="absolute right-0 bottom-0 left-0 bg-leaf" style={{ height: `${view.progress * 100}%` }} />
      </div>
      <div className="w-36 text-xs">
        <p className="text-sm font-bold">Reel it in!</p>
        <p className="mt-1">Hold <b>Space</b> (or press and hold anywhere) to lift the green zone. Keep the fish inside it.</p>
        <p className="mt-2">Line tension</p>
        <div className="px-bar">
          <span style={{ width: `${Math.round(view.tension * 100)}%`, background: view.tension > 0.6 ? '#d64545' : '#e0a52e' }} />
        </div>
      </div>
    </div>
  );
}

/** Where each crafting station stands (map names), from the map data. */
const STATION_PLACES: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const m of Object.values(MAPS))
    for (const o of m.objects)
      if (o.kind === 'prop' && STATION_TITLES[o.type]) {
        const list = (out[o.type] ??= []);
        if (!list.includes(m.name)) list.push(m.name);
      }
  return out;
})();

/** The Crafting menu: every recipe, what it needs, and where to make it. */
export function RecipeBook({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const inv = useStore(client.ui, (s) => s.inventory);
  const skills = useStore(client.ui, (s) => s.self?.skills);
  const specs = useStore(client.ui, (s) => s.self?.specs ?? {});
  const profs = [...new Set(RECIPES.map((r) => r.skill))];
  const [prof, setProf] = useState<string>(profs[0] ?? 'smithing');
  const [q, setQ] = useState('');
  const [canMake, setCanMake] = useState(false);
  if (!inv || !skills) return null;
  const have = (id: string) => inv.slots.filter((s) => s.itemId === id).reduce((n, s) => n + s.quantity, 0);
  const list = RECIPES.filter((r) => r.skill === prof)
    .filter((r) => !q || getItem(r.output.itemId)?.name.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => !canMake || (skills[r.skill as SkillId].level >= r.level && r.inputs.every((i) => have(i.itemId) >= i.quantity)))
    .sort((a, b) => a.level - b.level);
  return (
    <Window title="Crafting — recipe book" onClose={onClose} testId="recipe-book" wide>
      <div className="mb-2 flex flex-wrap gap-1">
        {profs.map((p) => (
          <button key={p} className={`border-2 border-ink px-1.5 text-xs ${p === prof ? 'bg-gold font-bold' : 'bg-parchment'}`} onClick={() => setProf(p)} data-testid={`book-${p}`}>
            {SKILL_NAMES[p as SkillId]} {skills[p as SkillId]?.level}
            {specs[p] ? ' ★' : ''}
          </button>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search…" className="min-w-0 flex-1 border-2 border-ink bg-parchment px-1" />
        <label>
          <input type="checkbox" checked={canMake} onChange={(e) => setCanMake(e.target.checked)} /> I can make it now
        </label>
      </div>
      <p className="mb-1 text-[11px] text-wood-dark/80">Craft at the station shown — walk up to it and press E (or tap it).</p>
      <ul className="space-y-1">
        {list.length === 0 && <li className="text-sm">Nothing here yet.</li>}
        {list.map((r) => {
          const out = getItem(r.output.itemId)!;
          const lvl = skills[r.skill as SkillId].level;
          const specLocked = !!r.spec && specs[r.skill] !== r.spec;
          return (
            <li key={r.id} className={`border-2 border-parchment-3 bg-parchment-2 p-1.5 text-xs ${lvl < r.level ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2">
                <PixelIcon icon={out.icon} size={24} />
                <b className="truncate" style={{ color: out.rarity === 'common' ? undefined : RARITY_COLOR[out.rarity] }}>
                  {out.name}
                  {r.output.quantity > 1 && ` ×${r.output.quantity}`}
                </b>
                <span className="ml-auto whitespace-nowrap">Lv {r.level}{r.fee ? ` · ◉${r.fee}` : ''}</span>
              </div>
              <p className="mt-0.5">
                {r.inputs.map((i) => (
                  <span key={i.itemId} className={`mr-2 ${have(i.itemId) >= i.quantity ? 'text-leaf-dark' : 'text-[#a33]'}`}>
                    {i.quantity}× {getItem(i.itemId)?.name}
                  </span>
                ))}
              </p>
              <p className="text-wood-dark/80">
                {STATION_TITLES[r.station]?.split(' —')[0] ?? r.station}
                {STATION_PLACES[r.station]?.length ? ` · ${STATION_PLACES[r.station]!.join(', ')}` : ''}
                {r.spec && <span className={specLocked ? 'ml-1 font-bold text-[#a33]' : 'ml-1 font-bold text-gold-dark'}>★ {getSpec(r.spec)?.name} only</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </Window>
  );
}
