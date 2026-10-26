'use client';

import { useState } from 'react';
import { CLASSES, skillsForClass } from '@terrago/game-data';
import type { Appearance, ClassId, NpcAccessory } from '@terrago/shared';
import { CharacterPreview } from '@/components/CharacterPreview';
import { PixelIcon } from '@/components/PixelIcon';
import { useSound } from './sound';

const LOOK: Record<string, { look: Appearance; acc?: NpcAccessory; color: string; tag: string }> = {
  warrior: { look: { bodyType: 'a', skinTone: 2, hairStyle: 0, hairColor: 2, eyeColor: 0, outfit: 1 }, acc: 'helmet', color: '#c0503a', tag: 'Tank · Rage' },
  mage: { look: { bodyType: 'b', skinTone: 1, hairStyle: 3, hairColor: 7, eyeColor: 3, outfit: 5 }, acc: 'hood', color: '#6a5ad0', tag: 'Burst · Mana' },
  archer: { look: { bodyType: 'a', skinTone: 4, hairStyle: 1, hairColor: 4, eyeColor: 1, outfit: 2 }, acc: 'bandana', color: '#4f9a4a', tag: 'Speed · Energy' },
  acolyte: { look: { bodyType: 'b', skinTone: 0, hairStyle: 4, hairColor: 9, eyeColor: 2, outfit: 4 }, acc: 'cape', color: '#d8b040', tag: 'Healer · Mana' },
};

/** Pick-your-hero cards: a live sprite, the first skills and the two second jobs. */
export function ClassShowcase() {
  const { blip } = useSound();
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4" data-testid="class-showcase">
      {CLASSES.map((c) => {
        const l = LOOK[c.id] ?? LOOK.warrior!;
        const on = hover === c.id;
        return (
          <article
            key={c.id}
            onMouseEnter={() => {
              setHover(c.id);
              blip('open');
            }}
            onMouseLeave={() => setHover(null)}
            className="group px-panel-dark relative flex flex-col items-center overflow-hidden p-3 text-center transition duration-300 hover:-translate-y-2 sm:p-4"
            style={{ boxShadow: on ? `0 0 0 3px ${l.color}, 0 12px 30px ${l.color}66` : undefined }}
          >
            <div className="absolute inset-x-0 top-0 h-24 opacity-40 transition group-hover:opacity-80" style={{ background: `radial-gradient(circle at 50% 80%, ${l.color}, transparent 70%)` }} />
            <div className="relative mt-2 animate-[float_3s_ease-in-out_infinite] motion-reduce:animate-none">
              <CharacterPreview appearance={l.look} accessory={l.acc} scale={3} walk={on} spin={!on} />
            </div>
            <h3 className="relative mt-2 text-2xl font-bold text-gold">{c.name}</h3>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: l.color }}>
              {l.tag}
            </p>
            <p className="mt-2 hidden text-sm leading-snug text-parchment/80 sm:block">{c.summary}</p>
            <ul className="mt-3 flex justify-center gap-2">
              {skillsForClass(c.id as ClassId)
                .slice(0, 3)
                .map((s) => (
                  <li key={s.id} title={`${s.name}: ${s.description}`} className="flex h-10 w-10 items-center justify-center border-2 border-ink bg-night-3 transition group-hover:scale-110">
                    <PixelIcon icon={s.icon ?? 'weapon:sword:1'} size={28} />
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-[11px] text-parchment/60">
              Level 40 → {c.jobs.map((j) => j.name).join(' or ')}
            </p>
          </article>
        );
      })}
    </div>
  );
}
