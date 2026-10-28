'use client';

import { useEffect, useRef, useState } from 'react';
import type { Appearance, Direction, NpcAccessory } from '@terrago/shared';

const ORDER: Direction[] = ['down', 'right', 'up', 'left'];
/** A starter weapon per class so menus show the hero ready for adventure. */
const STARTER: Record<string, { type: 'sword' | 'staff' | 'bow' | 'wand' | 'dagger'; tier: number; glow: number }> = {
  warrior: { type: 'sword', tier: 1, glow: 0 },
  mage: { type: 'staff', tier: 1, glow: 0 },
  archer: { type: 'bow', tier: 1, glow: 0 },
  acolyte: { type: 'wand', tier: 1, glow: 0 },
  rogue: { type: 'dagger', tier: 1, glow: 0 },
};

/**
 * HD character render (baked from the 3D chibi models). `walk` plays the run
 * cycle, `spin` turns the hero around, `face` shows a head-and-shoulders crop.
 * The box is 16×24 × `scale` CSS px (or square for `face`).
 */
export function CharacterPreview({
  appearance,
  accessory,
  classId,
  job,
  npcId,
  scale = 3,
  dir = 'down',
  walk = false,
  spin = false,
  face = false,
  className = '',
}: {
  appearance: Appearance;
  accessory?: NpcAccessory;
  classId?: string;
  job?: string | null;
  npcId?: string;
  scale?: number;
  dir?: Direction;
  walk?: boolean;
  spin?: boolean;
  face?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const w = face ? 24 * scale : 16 * scale;
  const h = 24 * scale;

  useEffect(() => {
    let dead = false;
    let raf = 0;
    setReady(false);
    (async () => {
      const [{ heroSheet, HERO_ANIMS, HERO_COLS }, { classBase, npcBase }, { frameXY }] = await Promise.all([import('@/game/hd/heroes'), import('@/game/hd/actors'), import('@/game/hd/baker')]);
      const base = npcId || accessory ? npcBase(accessory, npcId ?? 'npc') : classBase(classId ?? 'warrior', job);
      const sheet = await heroSheet({ base, appearance, weapon: classId ? (STARTER[classId] ?? null) : null });
      const canvas = ref.current;
      if (dead || !canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      setReady(true);
      const draw = (now: number) => {
        const d = spin ? ORDER[Math.floor(now / 1600) % 4]! : dir;
        const anim = walk ? HERO_ANIMS.walk : HERO_ANIMS.idle;
        const i = walk ? Math.floor(now / 85) % anim.n : Math.floor(now / 260) % anim.n;
        const row = d === 'down' ? 0 : d === 'up' ? 2 : 1;
        const { x: sx, y: sy } = frameXY(sheet, row * HERO_COLS + anim.start + i);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        if (d === 'left') {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        if (face) {
          // Head and shoulders: the top part of the frame.
          const ch = sheet.fh * 0.44;
          const cw = ch * (canvas.width / canvas.height);
          ctx.drawImage(sheet.canvas, sx + (sheet.fw - cw) / 2, sy + sheet.fh * 0.27, cw, ch, 0, 0, canvas.width, canvas.height);
        } else {
          // Fit the frame's height, centred.
          const k = canvas.height / sheet.fh;
          const dw = sheet.fw * k;
          ctx.drawImage(sheet.canvas, sx, sy, sheet.fw, sheet.fh, (canvas.width - dw) / 2, 0, dw, canvas.height);
        }
        ctx.restore();
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    })().catch(() => undefined);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(appearance), accessory, classId, job, npcId, w, h, dir, walk, spin, face]);

  return (
    <span className={`relative inline-block ${className}`} style={{ width: w, height: h }} aria-hidden="true">
      {!ready && <span className="absolute inset-[20%] animate-pulse rounded-full bg-white/10" />}
      <canvas ref={ref} style={{ width: w, height: h, display: 'block' }} />
    </span>
  );
}
