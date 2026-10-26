'use client';

import { useEffect, useRef } from 'react';
import { MAPS, NPCS } from '@terrago/game-data';
import type { Appearance, Direction } from '@terrago/shared';
import { buildCharacterSheet } from '@/game/art/characters';
import { monsterSheet } from '@/game/art/monsters';
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

const CHAT = ['anyone up for the Rift?', 'WTS gold carrots!', 'Storm Roc soon!!', 'gg everyone', 'my pet evolved :D', 'lf2m dungeon', 'just hit lv 40!', 'nice wings!', 'party at the fountain'];
const FIGHTER: Appearance = { bodyType: 'a', skinTone: 2, hairStyle: 0, hairColor: 2, eyeColor: 0, outfit: 1 };

/** Little fighter vs slime loop, wandering slimes, fireflies and chat bubbles. */
function makeLife(T: number, ox: number, oy: number) {
  const slime = monsterSheet('slime', '#7cc35a');
  const blue = monsterSheet('slime', '#5fa8e8');
  const fighter = buildCharacterSheet(FIGHTER, 'helmet');
  const fx = 23 * T + ox;
  const fy = 22 * T + 22 + oy;
  const hoppers = [
    { sheet: slime, cx: 22, cy: 27, r: 1.6, ph: 0 },
    { sheet: blue, cx: 50, cy: 18, r: 2.2, ph: 2 },
    { sheet: slime, cx: 37, cy: 30, r: 1.8, ph: 4 },
  ];
  const flies = Array.from({ length: 26 }, (_, i) => ({ x: (i * 97) % (40 * T), y: (i * 61) % (30 * T), ph: i }));
  const pops: { x: number; y: number; text: string; color: string; born: number }[] = [];
  const bits: { x: number; y: number; vx: number; vy: number; born: number }[] = [];
  let hits = 0;
  let nextHit = 0;
  let deadUntil = 0;
  let lunge = 0;
  let flash = 0;
  const bubbles: { who: number; text: string; until: number }[] = [];
  let nextChat = 1500;

  return {
    statics(now: number) {
      const out: { y: number; draw: (c: CanvasRenderingContext2D) => void }[] = [];
      // The fight
      if (now > nextHit && now > deadUntil) {
        nextHit = now + 900;
        hits++;
        lunge = now;
        flash = now;
        const crit = hits % 4 === 0;
        pops.push({ x: fx + 52, y: fy - 40, text: crit ? `CRIT ${30 + ((hits * 7) % 15)}!` : String(9 + ((hits * 5) % 11)), color: crit ? '#ffd84a' : '#ffffff', born: now });
        if (crit) {
          for (let i = 0; i < 14; i++) bits.push({ x: fx + 52, y: fy - 12, vx: Math.cos(i) * (40 + i * 6), vy: -60 - ((i * 13) % 50), born: now });
          pops.push({ x: fx + 52, y: fy - 64, text: '+12 XP', color: '#8fe07a', born: now + 200 });
          deadUntil = now + 1600;
        }
      }
      const lk = Math.max(0, 1 - (now - lunge) / 220);
      out.push({ y: fy, draw: (c) => c.drawImage(fighter, (lk > 0.5 ? 1 : 0) * 32, 2 * 48, 32, 48, Math.round(fx - 16 + lk * 8), fy - 46, 32, 48) });
      if (now > deadUntil) {
        const f = Math.floor(now / 260) % 2;
        const kb = Math.max(0, 1 - (now - flash) / 200) * 6;
        out.push({
          y: fy,
          draw: (c) => {
            if (now - flash < 90) c.filter = 'brightness(4)';
            c.drawImage(slime.canvas, f * slime.w, 0, slime.w, slime.h, Math.round(fx + 36 + kb), fy - slime.h * 2 + 4, slime.w * 2, slime.h * 2);
            c.filter = 'none';
          },
        });
      }
      for (const h of hoppers) {
        const t = now / 1000 + h.ph;
        const x = (h.cx + Math.cos(t * 0.4) * h.r) * T + ox;
        const yb = (h.cy + Math.sin(t * 0.3) * h.r * 0.5) * T + 22 + oy;
        const hop = Math.abs(Math.sin(t * 3.2)) * 8;
        out.push({ y: yb, draw: (c) => c.drawImage(h.sheet.canvas, 0, 0, h.sheet.w, h.sheet.h, Math.round(x - h.sheet.w), Math.round(yb - h.sheet.h * 2 + 4 - hop), h.sheet.w * 2, h.sheet.h * 2) });
      }
      return out;
    },
    overlay(c: CanvasRenderingContext2D, now: number, dt: number, heads: { x: number; y: number }[]) {
      // Fireflies
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const f of flies) {
        const t = now / 1000 + f.ph;
        const a = 0.35 + 0.35 * Math.sin(t * 2.3);
        const x = f.x + Math.sin(t * 0.5) * 30;
        const y = f.y + Math.cos(t * 0.37) * 22;
        c.fillStyle = `rgba(255,230,120,${a * 0.35})`;
        c.fillRect(x - 3, y - 3, 6, 6);
        c.fillStyle = `rgba(255,245,180,${a})`;
        c.fillRect(x - 1, y - 1, 2, 2);
      }
      c.restore();
      // Hit sparks
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i]!;
        const age = (now - b.born) / 1000;
        if (age > 0.7) {
          bits.splice(i, 1);
          continue;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vy += 220 * dt;
        c.fillStyle = `rgba(160,230,110,${1 - age / 0.7})`;
        c.fillRect(Math.round(b.x), Math.round(b.y), 4, 4);
      }
      // Damage numbers
      c.font = 'bold 18px ui-monospace, monospace';
      c.textAlign = 'center';
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]!;
        const age = (now - p.born) / 1000;
        if (age < 0) continue;
        if (age > 1) {
          pops.splice(i, 1);
          continue;
        }
        const y = p.y - age * 36;
        const s = age < 0.12 ? 1 + (0.12 - age) * 4 : 1;
        c.save();
        c.translate(p.x, y);
        c.scale(s, s);
        c.globalAlpha = 1 - Math.max(0, age - 0.6) / 0.4;
        c.lineWidth = 4;
        c.strokeStyle = '#2a2030';
        c.strokeText(p.text, 0, 0);
        c.fillStyle = p.color;
        c.fillText(p.text, 0, 0);
        c.restore();
      }
      // Chat bubbles over the strollers
      if (now > nextChat && heads.length) {
        nextChat = now + 2200;
        const who = Math.floor(now / 2200) % heads.length;
        if (!bubbles.some((b) => b.who === who)) bubbles.push({ who, text: CHAT[Math.floor(now / 2200) % CHAT.length]!, until: now + 3600 });
      }
      c.font = 'bold 13px ui-sans-serif, system-ui, sans-serif';
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]!;
        if (now > b.until) {
          bubbles.splice(i, 1);
          continue;
        }
        const h = heads[b.who];
        if (!h) continue;
        const w = c.measureText(b.text).width + 14;
        const x = Math.round(h.x - w / 2);
        const y = Math.round(h.y - 72);
        c.fillStyle = 'rgba(243,230,196,0.95)';
        c.strokeStyle = '#2a2030';
        c.lineWidth = 2;
        c.beginPath();
        c.roundRect(x, y, w, 22, 6);
        c.moveTo(h.x - 5, y + 22);
        c.lineTo(h.x, y + 29);
        c.lineTo(h.x + 5, y + 22);
        c.fill();
        c.stroke();
        c.fillStyle = '#2a2030';
        c.fillText(b.text, h.x, y + 15);
      }
    },
  };
}

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
    const life = makeLife(T, ox, oy);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.drawImage(ground, -ox, -oy, VIEW.w * T, VIEW.h * T, 0, 0, VIEW.w * T, VIEW.h * T);
      const heads: { x: number; y: number }[] = [];
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
        heads.push({ x, y });
        return { y, draw: (c) => c.drawImage(w.sheet, step * 32, row * 48, 32, 48, Math.round(x - 16), Math.round(y - 46), 32, 48) };
      });
      const alive = reduced ? [] : life.statics(now);
      [...statics, ...dyn, ...alive].sort((p, q) => p.y - q.y).forEach((d) => d.draw(ctx));
      if (!reduced) life.overlay(ctx, now, dt, heads);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
