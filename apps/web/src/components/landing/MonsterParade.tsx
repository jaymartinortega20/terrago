'use client';

import { useEffect, useRef } from 'react';
import { MONSTERS } from '@terrago/game-data';
import { monsterSheet } from '@/game/art/monsters';

const PICK = ['green_slime', 'blue_slime', 'forest_wolf', 'goblin_scout', 'cave_bat', 'skeleton', 'orc', 'fire_imp', 'ice_wisp', 'frost_yeti', 'sand_scorpion', 'wraith', 'young_drake', 'stone_golem', 'marsh_witch', 'magma_hound'];

/** Monsters marching across the page (each animated with its two-frame walk). */
export function MonsterParade() {
  const list = PICK.map((id) => MONSTERS.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m);
  return (
    <div className="relative overflow-hidden py-4" data-testid="monster-parade" aria-hidden>
      <div className="flex w-max animate-[marquee_45s_linear_infinite] items-end gap-10 motion-reduce:animate-none">
        {[...list, ...list].map((m, i) => (
          <figure key={i} className="flex flex-col items-center">
            <Mon shape={m.art.shape} color={m.art.color} size={m.art.size ?? 1} />
            <figcaption className="mt-1 whitespace-nowrap text-xs text-parchment/60">{m.name}</figcaption>
          </figure>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-night to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-night to-transparent" />
    </div>
  );
}

export function Mon({ shape, color, size }: { shape: string; color: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const s = monsterSheet(shape, color);
    // The sheet is drawn at 2x; frames are (w*2) wide.
    const fw = s.canvas.width / 2;
    const fh = s.canvas.height;
    const k = Math.min(1.6, size);
    c.width = Math.round(fw * k);
    c.height = Math.round(fh * k);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    let f = 0;
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(s.canvas, f * fw, 0, fw, fh, 0, 0, c.width, c.height);
      f = 1 - f;
    };
    draw();
    const t = setInterval(draw, 260 + Math.random() * 80);
    return () => clearInterval(t);
  }, [shape, color, size]);
  return <canvas ref={ref} className="animate-[hop_0.52s_ease-in-out_infinite] [image-rendering:pixelated]" />;
}
