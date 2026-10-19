'use client';

import { useEffect, useRef } from 'react';
import type { Appearance, Direction, NpcAccessory } from '@terrago/shared';
import { buildCharacterSheet } from '@/game/art/characters';

const ORDER: Direction[] = ['down', 'left', 'up', 'right'];

/**
 * Live character sprite. `walk` animates the walk cycle; `spin` slowly turns
 * the character through all four directions (used in the creator).
 */
export function CharacterPreview({
  appearance,
  accessory,
  scale = 3,
  dir = 'down',
  walk = false,
  spin = false,
  className = '',
}: {
  appearance: Appearance;
  accessory?: NpcAccessory;
  scale?: number;
  dir?: Direction;
  walk?: boolean;
  spin?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const sheet = buildCharacterSheet(appearance, accessory);
    let raf = 0;
    const draw = (now: number) => {
      const d = spin ? ORDER[Math.floor(now / 1400) % 4]! : dir;
      const row = ['down', 'left', 'right', 'up'].indexOf(d);
      const col = walk ? [1, 0, 2, 0][Math.floor(now / 160) % 4]! : 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(sheet, col * 32, row * 48, 32, 48, 0, 0, 32 * (scale / 2), 48 * (scale / 2));
      if (walk || spin) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [appearance, accessory, scale, dir, walk, spin]);

  return <canvas ref={ref} width={16 * scale} height={24 * scale} className={className} aria-hidden="true" />;
}
