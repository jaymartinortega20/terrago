'use client';

import { useEffect, useRef } from 'react';
import { MAPS, NPCS } from '@terrago/game-data';
import type { Appearance, Direction } from '@terrago/shared';
import { buildCharacterSheet } from '@/game/art/characters';
import { TREE_VARIANTS, buildingArt, propArt, renderGround } from '@/game/art/world';

/**
 * Animated hero backdrop: a live slice of Greenhaven drawn with the same
 * generated pixel art the game uses, with a few villagers strolling about.
 */
const VIEW = { x: 14, y: 2, w: 40, h: 30 }; // tiles

const walkers: { look: Appearance; path: [number, number][]; speed: number }[] = [
  { look: { bodyType: 'a', skinTone: 1, hairStyle: 0, hairColor: 1, eyeColor: 0, outfit: 0 }, path: [[31, 14], [31, 30], [24, 30], [24, 17], [31, 17]], speed: 1.6 },
  { look: { bodyType: 'b', skinTone: 3, hairStyle: 2, hairColor: 3, eyeColor: 2, outfit: 2 }, path: [[42, 22], [26, 22], [26, 27], [42, 27]], speed: 1.3 },
  { look: { bodyType: 'a', skinTone: 5, hairStyle: 1, hairColor: 6, eyeColor: 1, outfit: 3 }, path: [[19, 12], [19, 22], [33, 22], [33, 12]], speed: 1.8 },
  { look: { bodyType: 'b', skinTone: 0, hairStyle: 4, hairColor: 9, eyeColor: 4, outfit: 4 }, path: [[47, 26], [56, 26], [56, 30], [47, 30]], speed: 1.1 },
];

export function HeroScene({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const map = MAPS.greenhaven!;
    const T = 32;
    canvas.width = VIEW.w * T;
    canvas.height = VIEW.h * T;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Static layer: ground + objects sorted by their base line.
    const ground = renderGround(map);
    type Drawable = { y: number; draw: (c: CanvasRenderingContext2D) => void };
    const statics: Drawable[] = [];
    const ox = -VIEW.x * T;
    const oy = -VIEW.y * T;
    for (const o of map.objects) {
      if (o.kind === 'building') {
        const art = buildingArt(o);
        const bx = o.x * T + ox;
        const by = (o.y + o.h) * T + oy;
        statics.push({ y: by, draw: (c) => c.drawImage(art.canvas, bx, by - art.canvas.height) });
      } else {
        const art = propArt(o.type, (o.x * 7 + o.y * 13) % TREE_VARIANTS);
        const cx = (o.x + art.footW / 2) * T + ox;
        const by = (o.y + art.footH) * T + oy;
        statics.push({ y: by, draw: (c) => c.drawImage(art.canvas, Math.round(cx - art.canvas.width / 2), by - art.canvas.height) });
      }
    }
    for (const n of NPCS.filter((n) => n.mapId === 'greenhaven')) {
      const sheet = buildCharacterSheet(n.appearance, n.accessory);
      const row = ['down', 'left', 'right', 'up'].indexOf(n.dir);
      const cx = n.x * T + 16 + ox;
      const by = n.y * T + 22 + oy;
      statics.push({ y: by, draw: (c) => c.drawImage(sheet, 0, row * 48, 32, 48, cx - 16, by - 46, 32, 48) });
    }

    const state = walkers.map((w) => ({ ...w, sheet: buildCharacterSheet(w.look), seg: 0, t: 0 }));
    let raf = 0;
    let last = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.drawImage(ground, -ox, -oy, VIEW.w * T, VIEW.h * T, 0, 0, VIEW.w * T, VIEW.h * T);
      const dyn: Drawable[] = state.map((w) => {
        const a = w.path[w.seg % w.path.length]!;
        const b = w.path[(w.seg + 1) % w.path.length]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!reduced) w.t += (dt * w.speed) / Math.max(len, 0.01);
        if (w.t >= 1) {
          w.t = 0;
          w.seg++;
        }
        const x = (a[0] + (b[0] - a[0]) * w.t) * T + 16 + ox;
        const y = (a[1] + (b[1] - a[1]) * w.t) * T + 22 + oy;
        const dir: Direction = b[0] > a[0] ? 'right' : b[0] < a[0] ? 'left' : b[1] < a[1] ? 'up' : 'down';
        const row = ['down', 'left', 'right', 'up'].indexOf(dir);
        const step = [1, 0, 2, 0][Math.floor(now / 140) % 4]!;
        return { y, draw: (c) => c.drawImage(w.sheet, step * 32, row * 48, 32, 48, Math.round(x - 16), Math.round(y - 46), 32, 48) };
      });
      [...statics, ...dyn].sort((p, q) => p.y - q.y).forEach((d) => d.draw(ctx));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
