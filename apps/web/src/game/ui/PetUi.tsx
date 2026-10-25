'use client';

import { useEffect, useState } from 'react';
import { getItem } from '@terrago/game-data';
import {
  PET_GROWTH,
  PET_GROWTH_MAX,
  PET_LOYALTY_LOW,
  PET_LOYALTY_SKILL,
  PET_SKILL2_LEVEL,
  archetypeOf,
  petFoodValue,
  type PetGrowthId,
  type PetMenuState,
  type PetView,
} from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

const ROLE: Record<string, { label: string; color: string }> = {
  tank: { label: 'Tank', color: '#6aa8ff' },
  striker: { label: 'Striker', color: '#ff8a5a' },
  support: { label: 'Support', color: '#7cf06a' },
  skirmisher: { label: 'Skirmisher', color: '#e8c24a' },
};

function Bar({ value, max, color, label, testId }: { value: number; max: number; color: string; label: string; testId?: string }) {
  const k = max > 0 ? Math.max(0, Math.min(1, value / max)) : 1;
  return (
    <div data-testid={testId}>
      <div className="flex justify-between text-[11px] text-parchment/70">
        <span>{label}</span>
        <span>
          {Math.floor(value).toLocaleString()} / {max ? max.toLocaleString() : 'MAX'}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/40">
        <div className="h-full rounded-full transition-all" style={{ width: `${k * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

function Portrait({ pet }: { pet: PetView }) {
  const icon = pet.id === 'hawk' ? null : getItem(pet.id)?.icon;
  return <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-black/30 text-3xl">{icon ? <PixelIcon icon={icon} size={48} /> : '🦅'}</div>;
}

export function PetPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const live = useStore(client.ui, (s) => s.pet);
  const inv = useStore(client.ui, (s) => s.inventory);
  const [menu, setMenu] = useState<PetMenuState | null>(null);
  useEffect(() => {
    void client.pets().then((m) => m && setMenu(m));
  }, [client]);
  const pet = live && menu?.active?.id === live.id ? { ...menu.active, ...live } : (live ?? menu?.active ?? null);
  const food = (inv?.slots ?? []).filter((s) => {
    const d = getItem(s.itemId);
    return d && petFoodValue(d);
  });
  const arche = pet ? archetypeOf(pet.kind) : null;
  const now = Date.now();

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-night/45 backdrop-blur-[3px] p-2" data-testid="pet-panel" role="dialog" aria-label="Pets">
      <div className="glass flex max-h-[min(92dvh,720px)] w-full max-w-[560px] flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-white/15 px-4 py-3">
          <span className="text-2xl" aria-hidden>
            🐾
          </span>
          <h2 className="text-lg font-bold">Companion</h2>
          <button className="glass-dark ml-auto px-3 py-1 text-sm font-bold hover:bg-white/10" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex flex-col gap-3 overflow-y-auto p-3">
          {!pet || !arche ? (
            <div className="glass-dark p-4 text-sm">
              <p className="font-bold">No companion at your side.</p>
              <p className="mt-1 text-parchment/70">Use a pet from your bag to call it. Stablemaster Hana sells pups and kittens; rarer pets drop from monsters. Beastmasters always fly with their hawk.</p>
            </div>
          ) : (
            <>
              <div className="glass-dark flex gap-3 p-3" data-testid="pet-card">
                <Portrait pet={pet} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-bold">
                    {pet.name}
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: `${ROLE[arche.role]!.color}33`, color: ROLE[arche.role]!.color }}>
                      {ROLE[arche.role]!.label}
                    </span>
                    <span className="ml-auto text-gold" data-testid="pet-level">
                      Lv {pet.level}
                    </span>
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <Bar label="Pet EXP" value={pet.xp} max={pet.xpToNext} color="#b48aff" testId="pet-xp" />
                    <Bar label={pet.koUntil > now ? 'Knocked out' : 'Health'} value={pet.hp} max={pet.maxHp} color={pet.koUntil > now ? '#7a7a8a' : '#e0483a'} />
                    <Bar label="Loyalty" value={pet.loyalty} max={100} color={pet.loyalty < PET_LOYALTY_LOW ? '#ff6a5a' : pet.loyalty >= PET_LOYALTY_SKILL ? '#f2c14e' : '#7cc3f0'} testId="pet-loyalty" />
                  </div>
                  {pet.loyalty < PET_LOYALTY_LOW && <p className="mt-1 text-xs font-bold text-[#ff8a7a]">Sulking: half damage until you feed it.</p>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="glass-dark p-2">
                  <p className="text-[10px] text-parchment/60 uppercase">Health</p>
                  <p className="font-bold">{pet.maxHp}</p>
                </div>
                <div className="glass-dark p-2">
                  <p className="text-[10px] text-parchment/60 uppercase">Attack</p>
                  <p className="font-bold">{pet.atk}</p>
                </div>
                <div className="glass-dark p-2">
                  <p className="text-[10px] text-parchment/60 uppercase">Aggro draw</p>
                  <p className="font-bold">{pet.aggro}%</p>
                </div>
              </div>

              <div className="glass-dark p-3">
                <h3 className="mb-2 text-xs font-bold tracking-widest text-parchment/70 uppercase">Skills</h3>
                {arche.skills.map((s, i) => {
                  const open = i === 0 || (i === 1 ? pet.level >= PET_SKILL2_LEVEL : pet.loyalty >= PET_LOYALTY_SKILL);
                  const need = i === 1 ? `Pet level ${PET_SKILL2_LEVEL}` : `Loyalty ${PET_LOYALTY_SKILL}+`;
                  return (
                    <div key={s.name} className={`mb-1.5 rounded-lg p-2 text-sm ${open ? 'bg-white/10' : 'bg-black/25 text-parchment/45'}`} data-testid={`pet-skill-${i + 1}`}>
                      <p className="font-bold">
                        {open ? '✦' : '🔒'} Tier {i + 1}: {s.name} {!open && <span className="text-[11px] font-normal">— {need}</span>}
                      </p>
                      <p className="text-xs">{s.text}</p>
                    </div>
                  );
                })}
              </div>

              <div className="glass-dark p-3" data-testid="pet-growth">
                <h3 className="mb-2 flex text-xs font-bold tracking-widest text-parchment/70 uppercase">
                  Growth traits
                  <span className={`ml-auto ${pet.points ? 'text-gold' : ''}`}>{pet.points} point{pet.points === 1 ? '' : 's'}</span>
                </h3>
                {(Object.keys(PET_GROWTH) as PetGrowthId[]).map((id) => {
                  const n = pet.growth[id] ?? 0;
                  return (
                    <div key={id} className="mb-1.5 flex items-center gap-2 rounded-lg bg-black/25 p-2 text-sm">
                      <div className="flex-1">
                        <p className="font-bold">
                          {PET_GROWTH[id].name} <span className="text-[11px] text-parchment/60">{n}/{PET_GROWTH_MAX}</span>
                        </p>
                        <p className="text-xs text-parchment/70">{PET_GROWTH[id].text(Math.max(1, n))}</p>
                      </div>
                      <button
                        className="h-8 w-8 rounded-full bg-gold font-bold text-ink disabled:opacity-30"
                        disabled={!pet.points || n >= PET_GROWTH_MAX}
                        onClick={() => void client.growPet(id).then((m) => m && setMenu(m))}
                        aria-label={`Spend a point on ${PET_GROWTH[id].name}`}
                        data-testid={`grow-${id}`}
                      >
                        +
                      </button>
                    </div>
                  );
                })}
                <p className="text-[11px] text-parchment/50">One point every 10 pet levels. Pets level up to your own level.</p>
              </div>

              <div className="glass-dark p-3" data-testid="pet-food">
                <h3 className="mb-2 text-xs font-bold tracking-widest text-parchment/70 uppercase">Feed</h3>
                {food.length === 0 ? (
                  <p className="text-sm text-parchment/60">Catch common fish or buy Pet Treats from Stablemaster Hana.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {food.map((s) => {
                      const d = getItem(s.itemId)!;
                      const v = petFoodValue(d)!;
                      return (
                        <button
                          key={s.slot}
                          className="flex items-center gap-2 rounded-xl bg-black/25 px-2 py-1 text-left text-xs hover:bg-white/10"
                          onClick={() => void client.feedPet(s.slot).then((m) => m && setMenu(m))}
                          data-testid={`feed-${s.itemId}`}
                        >
                          <PixelIcon icon={d.icon} size={24} />
                          <span>
                            <span className="font-bold">
                              {d.name} ×{s.quantity}
                            </span>
                            <br />+{v.xp} EXP · +{v.loyalty} loyalty
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {menu && menu.pets.length > 1 && (
            <div className="glass-dark p-3">
              <h3 className="mb-2 text-xs font-bold tracking-widest text-parchment/70 uppercase">Your pets</h3>
              {menu.pets.map((p) => (
                <p key={p.id} className="text-sm">
                  {p.active ? '● ' : '○ '}
                  {p.name} — Lv {p.level}, loyalty {p.loyalty}
                </p>
              ))}
              <p className="mt-1 text-[11px] text-parchment/50">Use a pet from your bag to swap who follows you.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
