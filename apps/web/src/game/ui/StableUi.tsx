'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ITEMS, getItem } from '@terrago/game-data';
import { HAIR_COLORS, MOUNT_PERKS, MOUNT_STYLES, OUTFITS, SKIN_TONES, TERRAIN_SLOW, getMountStyle, speedBonusText, type MountLook, type MountStyleSlot, type StableState } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import type { MountShowcase, ShowcaseMount } from '../three/mountShowcase';
import { RARITY_COLOR } from './ItemSlot';
import { itemSources } from './sources';

const MOUNTS = ITEMS.filter((i) => i.mount).sort((a, b) => a.mount!.speed - b.mount!.speed);
const SLOTS: { id: MountStyleSlot; label: string }[] = [
  { id: 'saddle', label: 'Saddle' },
  { id: 'barding', label: 'Barding' },
  { id: 'trail', label: 'Trail' },
];

/** The rotating 3D mount with your character on it. */
function Showcase({ mount, rider }: { mount: ShowcaseMount; rider: Parameters<MountShowcase['show']>[1] }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<MountShowcase | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ mount, rider });
  latest.current = { mount, rider };
  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    void import('../three/mountShowcase')
      .then(({ MountShowcase }) => {
        if (!alive || !host.current) return;
        stage.current = new MountShowcase(host.current);
        stage.current.show(latest.current.mount, latest.current.rider);
        ro = new ResizeObserver(() => stage.current?.resize());
        ro.observe(host.current);
      })
      .catch(() => setFailed(true));
    return () => {
      alive = false;
      ro?.disconnect();
      stage.current?.dispose();
      stage.current = null;
    };
  }, []);
  useEffect(() => {
    stage.current?.show(mount, rider);
  }, [mount, rider]);
  return (
    <div ref={host} className="relative h-full min-h-[220px] w-full cursor-grab active:cursor-grabbing" data-testid="mount-showcase">
      {failed && <p className="absolute inset-0 flex items-center justify-center text-sm text-parchment/70">3D preview unavailable on this device.</p>}
    </div>
  );
}

export function StablePanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const self = useStore(client.ui, (s) => s.self);
  const [st, setSt] = useState<StableState | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<MountStyleSlot>('saddle');
  const bag = useStore(client.ui, (s) => s.inventory);
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const load = () =>
      client.stable().then(
        (s) => {
          if (!alive) return;
          setSt(s);
          setSel((cur) => cur ?? s.chosen ?? s.owned[0] ?? MOUNTS[0]!.id);
        },
        () => {
          if (alive && ++tries < 4) setTimeout(load, 800);
        },
      );
    void load();
    return () => {
      alive = false;
    };
  }, [client, bag?.slots]);
  const def = sel ? getItem(sel) : undefined;
  const owned = !!(sel && st?.owned.includes(sel));
  const look: MountLook = st?.look ?? self?.mountLook ?? {};
  const riding = self?.mount ?? null;
  const active = riding ?? st?.chosen ?? null;
  const rider = useMemo(() => {
    const a = self?.appearance;
    const o = OUTFITS[a?.outfit ?? 0] ?? OUTFITS[0]!;
    return { skin: SKIN_TONES[a?.skinTone ?? 1] ?? SKIN_TONES[1], hair: HAIR_COLORS[a?.hairColor ?? 0] ?? HAIR_COLORS[0], shirt: o.shirt, pants: o.pants };
  }, [self?.appearance]);
  const showMount = useMemo<ShowcaseMount>(
    () => ({
      kind: def?.mount?.kind ?? 'horse',
      color: def?.mount?.color ?? '#8a5d33',
      glow: def?.mount?.glow ?? null,
      saddle: getMountStyle(look.saddle)?.color ?? null,
      barding: getMountStyle(look.barding)?.color ?? null,
      trail: getMountStyle(look.trail)?.color ?? null,
      locked: !owned,
    }),
    [def, owned, look.saddle, look.barding, look.trail],
  );
  const update = (s: StableState | null) => s && setSt(s);
  const perk = def?.mount?.perk ? MOUNT_PERKS[def.mount.perk] : null;
  const tier = def ? RARITY_COLOR[def.rarity] : '#fff';

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-night/45 backdrop-blur-[3px] p-2 sm:p-6" data-testid="stable-panel" role="dialog" aria-label="Stable">
      <div className="glass flex h-full max-h-[720px] w-full max-w-[1100px] flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-white/15 px-4 py-3">
          <span className="text-2xl" aria-hidden>
            🐎
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-wide">Stable</h2>
            <p className="text-[11px] text-parchment/70">Pick your ride, dress it up, and see where to find the rest.</p>
          </div>
          <button className="glass-dark ml-auto px-3 py-1 text-sm font-bold hover:bg-white/10" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:flex-row md:overflow-hidden">
          {/* Left: 3D showcase vault */}
          <section className="glass-dark flex min-h-[260px] flex-col md:w-[46%]">
            <div className="flex items-center gap-2 px-3 pt-3">
              <p className="font-bold" style={{ color: tier }}>
                {def?.name ?? '—'}
              </p>
              {def && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: `${tier}33`, color: tier }}>{def.rarity}</span>}
              {active === sel && owned && <span className="ml-auto text-[11px] font-bold text-leaf">{riding === sel ? 'RIDING' : 'SELECTED'}</span>}
            </div>
            <div className="min-h-0 flex-1">
              <Showcase mount={showMount} rider={owned ? rider : null} />
            </div>
            <p className="px-3 pb-2 text-center text-[10px] text-parchment/50">Drag to turn</p>
          </section>

          {/* Right: catalog + stats + vanity */}
          <section className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-y-auto">
            <div className="glass-dark p-3">
              <h3 className="mb-2 text-xs font-bold tracking-widest text-parchment/70 uppercase">Stable catalog</h3>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" data-testid="stable-grid">
                {MOUNTS.map((m) => {
                  const have = !!st?.owned.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSel(m.id)}
                      title={m.name}
                      data-testid={`stable-${m.id}`}
                      className="relative flex aspect-square items-center justify-center rounded-xl bg-black/25 transition hover:bg-white/10"
                      style={{ outline: sel === m.id ? `2px solid ${RARITY_COLOR[m.rarity]}` : '1px solid rgba(255,255,255,0.1)', boxShadow: sel === m.id ? `0 0 14px ${RARITY_COLOR[m.rarity]}88` : undefined }}
                    >
                      <span style={{ filter: have ? undefined : 'brightness(0) opacity(0.55)' }}>
                        <PixelIcon icon={m.icon} size={34} />
                      </span>
                      {!have && <span className="absolute right-1 bottom-0.5 text-[10px]">🔒</span>}
                      {(riding ?? st?.chosen) === m.id && <span className="absolute top-0.5 left-1 text-[10px] text-leaf">●</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {def?.mount && (
              <div className="glass-dark p-3" data-testid="mount-stats">
                <h3 className="mb-2 text-xs font-bold tracking-widest text-parchment/70 uppercase">Stats &amp; perks</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-black/25 p-2">
                    <p className="text-[10px] text-parchment/60 uppercase">Map movement speed</p>
                    <p className="text-lg font-bold text-gold">{speedBonusText(def.mount.speed)}</p>
                  </div>
                  <div className="rounded-lg bg-black/25 p-2">
                    <p className="text-[10px] text-parchment/60 uppercase">Rider level</p>
                    <p className={`text-lg font-bold ${(self?.level ?? 0) >= def.levelRequirement ? '' : 'text-[#ff8a7a]'}`}>{def.levelRequirement}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm">
                  {perk ? (
                    <>
                      <span className="font-bold text-[#9ad0ff]">✦ {perk.name}:</span> {perk.text}
                    </>
                  ) : (
                    <span className="text-parchment/60">No terrain perk. Ice ({Math.round((1 - TERRAIN_SLOW.glacial_depths!.mult) * 100)}% slower) and scorched ground slow it.</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-parchment/60">{def.description}</p>
                {owned ? (
                  <button
                    className="mt-3 w-full rounded-xl py-2 font-bold text-ink transition disabled:opacity-50"
                    style={{ background: tier }}
                    disabled={active === sel}
                    onClick={() => void client.chooseMount(sel!).then(update)}
                    data-testid="stable-choose"
                  >
                    {active === sel ? 'Your mount' : riding ? 'Swap to this mount' : 'Ride this one'}
                  </button>
                ) : (
                  <div className="mt-3 rounded-xl bg-black/30 p-2 text-sm" data-testid="stable-source">
                    <p className="text-[10px] font-bold text-parchment/60 uppercase">Locked — where to find it</p>
                    {itemSources(sel!).map((t) => (
                      <p key={t}>• {t}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="glass-dark p-3" data-testid="mount-vanity">
              <div className="mb-2 flex items-center gap-1">
                <h3 className="mr-auto text-xs font-bold tracking-widest text-parchment/70 uppercase">Mount gear</h3>
                {SLOTS.map((s) => (
                  <button key={s.id} onClick={() => setTab(s.id)} className={`rounded-full px-3 py-0.5 text-xs font-bold ${tab === s.id ? 'bg-white/25' : 'bg-black/20 text-parchment/70'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <button
                  onClick={() => void client.mountStyle(tab, null).then(update)}
                  className="rounded-xl bg-black/25 p-2 text-left text-xs"
                  style={{ outline: !look[tab] ? '2px solid #f2c14e' : undefined }}
                >
                  <p className="font-bold">None</p>
                  <p className="text-parchment/50">{tab === 'saddle' ? 'Plain saddle' : 'Nothing'}</p>
                </button>
                {MOUNT_STYLES.filter((s) => s.slot === tab).map((s) => {
                  const have = !!st?.styles.includes(s.id);
                  const on = look[tab] === s.id;
                  return (
                    <button
                      key={s.id}
                      data-testid={`style-${s.id}`}
                      onClick={() => void (have ? client.mountStyle(tab, s.id) : client.buyMountStyle(s.id)).then(update)}
                      className="rounded-xl bg-black/25 p-2 text-left text-xs transition hover:bg-white/10"
                      style={{ outline: on ? '2px solid #f2c14e' : undefined }}
                    >
                      <p className="flex items-center gap-1 font-bold">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
                        {s.name}
                      </p>
                      <p className="text-parchment/60">{on ? 'Equipped' : have ? 'Owned · tap to equip' : `${s.price.toLocaleString()} gold · buy at Hana`}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
