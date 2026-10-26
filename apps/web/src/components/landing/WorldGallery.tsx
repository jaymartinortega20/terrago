'use client';

import { useEffect, useRef } from 'react';
import { MAPS, MONSTERS } from '@terrago/game-data';
import { TREE_VARIANTS, buildingArt, propArt, renderGround } from '@/game/art/world';
import { Mon } from './MonsterParade';
import { useSound } from './sound';

const RESIDENT: Record<string, string> = { sunfield_plains: 'green_slime', desolate_crags: 'stone_golem', glacial_depths: 'frost_yeti', dragonspire: 'young_drake', infernal_caldera: 'magma_hound' };

const WORLD: { map: string; name: string; text: string; tag: string; tint: string }[] = [
  { map: 'greenhaven', name: 'Oakhaven Sanctuary', text: 'The safe town hub: quest givers, the blacksmith, crafting stations, the market and a pond full of rare catches.', tag: 'Town', tint: '#5fa04a' },
  { map: 'sunfield_plains', name: 'Whispering Fields', text: 'Slimes, goblins and wolves, levels 1–40. Gnarlfang guards the Job Trainer at the far end.', tag: 'Lv 1–40', tint: '#c8b040' },
  { map: 'desolate_crags', name: 'Desolate Crags', text: 'Cracked stone and living rock. Ore veins and the first upgrade gems.', tag: 'Lv 41–70', tint: '#a07050' },
  { map: 'glacial_depths', name: 'Glacial Depths', text: 'Frozen caverns with rare ore and high-tier gems, guarded by frost giants.', tag: 'Lv 71–99', tint: '#6cb0de' },
  { map: 'dragonspire', name: "Dragon's Peak", text: 'Level 100 drakes, dragon knights and champions.', tag: 'Lv 100', tint: '#c05040' },
  { map: 'infernal_caldera', name: 'The Infernal Caldera', text: 'Raid lair of Pyraxis, the Infernal Titan.', tag: 'Raid', tint: '#e06020' },
];

/** Map cards with a real thumbnail of each map, drawn when they scroll into view. */
export function WorldGallery() {
  const { blip } = useSound();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="world-gallery">
      {WORLD.map((w) => (
        <article
          key={w.map}
          onMouseEnter={() => blip('portal')}
          className="group px-panel-dark overflow-hidden transition duration-300 hover:-translate-y-1"
          style={{ ['--tint' as string]: w.tint }}
        >
          <div className="relative h-36 overflow-hidden border-b-2 border-ink">
            <Thumb mapId={w.map} />
            <div className="absolute inset-0 bg-gradient-to-t from-night via-transparent to-transparent" />
            <span className="absolute top-2 right-2 border-2 border-ink px-2 py-0.5 text-xs font-bold text-ink" style={{ background: w.tint }}>
              {w.tag}
            </span>
            {(() => {
              const m = MONSTERS.find((x) => x.id === RESIDENT[w.map]);
              return m ? (
                <div className="absolute right-3 bottom-1 transition duration-300 group-hover:scale-125">
                  <Mon shape={m.art.shape} color={m.art.color} size={Math.min(1.2, m.art.size ?? 1)} />
                </div>
              ) : null;
            })()}
            <h3 className="text-outline absolute bottom-2 left-3 text-xl font-bold text-gold">{w.name}</h3>
          </div>
          <p className="p-4 text-sm leading-relaxed text-parchment/85">{w.text}</p>
        </article>
      ))}
    </div>
  );
}

function Thumb({ mapId }: { mapId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const map = MAPS[mapId];
    if (!c || !map) return;
    let done = false;
    const draw = () => {
      if (done) return;
      done = true;
      // A 30x15-tile window around the map's spawn, with its buildings and props.
      const T = 32;
      const W = 30;
      const H = 15;
      const vx = Math.max(0, Math.min(map.width - W, map.spawn.x - W / 2));
      const vy = Math.max(0, Math.min(map.height - H, map.spawn.y - H / 2));
      c.width = W * T;
      c.height = H * T;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const g = renderGround(map);
      const k = g.width / (map.width * T);
      ctx.drawImage(g, vx * T * k, vy * T * k, W * T * k, H * T * k, 0, 0, W * T, H * T);
      const ox = -vx * T;
      const oy = -vy * T;
      const items: { y: number; draw: () => void }[] = [];
      for (const o of map.objects) {
        if (o.x > vx + W + 4 || o.y > vy + H + 6 || o.x + 12 < vx || o.y + 12 < vy) continue;
        if (o.kind === 'building') {
          const art = buildingArt(o);
          const by = (o.y + o.h) * T + oy;
          items.push({ y: by, draw: () => ctx.drawImage(art.canvas, o.x * T + ox, by - art.canvas.height) });
        } else {
          const art = propArt(o.type, (o.x * 7 + o.y * 13) % TREE_VARIANTS);
          const cx = (o.x + art.footW / 2) * T + ox;
          const by = (o.y + art.footH) * T + oy;
          items.push({ y: by, draw: () => ctx.drawImage(art.canvas, Math.round(cx - art.canvas.width / 2), by - art.canvas.height) });
        }
      }
      items.sort((a, b) => a.y - b.y).forEach((d) => d.draw());
    };
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
        if (idle) idle(draw);
        else setTimeout(draw, 50);
      }
    });
    io.observe(c);
    return () => io.disconnect();
  }, [mapId]);
  return <canvas ref={ref} className="h-full w-full object-cover transition duration-700 group-hover:scale-110" />;
}
