'use client';

import { useEffect, useState } from 'react';
import { useSound } from './sound';

const TAGLINES = ['Farm.', 'Trade.', 'Fight.', 'Grow.'];

/** TERRAGO with bouncing letters, floating sparkles and a cycling tagline. */
export function HeroTitle() {
  const { blip } = useSound();
  const [k, setK] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setK((v) => v + 1), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative">
      <Sparkles />
      <h1 className="text-outline relative select-none text-6xl font-bold tracking-wider text-gold drop-shadow-[0_0_24px_rgba(232,194,74,0.55)] sm:text-8xl" aria-label="TerraGo">
        {'TERRAGO'.split('').map((c, i) => (
          <span
            key={i}
            aria-hidden
            onMouseEnter={() => blip('pick')}
            className="inline-block cursor-default animate-[letter-bob_2.4s_ease-in-out_infinite] transition-transform hover:scale-125 hover:text-parchment motion-reduce:animate-none"
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            {c}
          </span>
        ))}
      </h1>
      <p className="text-outline mt-4 text-2xl font-bold text-parchment sm:text-3xl" aria-label="Farm. Trade. Fight. Grow.">
        {TAGLINES.map((t, i) => (
          <span key={t} aria-hidden className={`mx-1 inline-block transition-all duration-300 ${k % 4 === i ? 'scale-125 text-gold' : ''}`}>
            {t}
          </span>
        ))}
      </p>
    </div>
  );
}

function Sparkles() {
  const [dots] = useState(() =>
    Array.from({ length: 18 }, (_, i) => ({
      left: (i * 37) % 100,
      top: (i * 53) % 100,
      d: 2 + ((i * 7) % 5) * 0.6,
      delay: (i * 0.37) % 3,
      s: 4 + (i % 3) * 2,
    })),
  );
  return (
    <div className="pointer-events-none absolute -inset-x-10 -inset-y-8" aria-hidden>
      {dots.map((p, i) => (
        <span
          key={i}
          className="absolute rotate-45 bg-gold motion-reduce:hidden"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.s,
            height: p.s,
            animation: `twinkle ${p.d}s ease-in-out ${p.delay}s infinite`,
            boxShadow: '0 0 8px #e8c24a',
          }}
        />
      ))}
    </div>
  );
}
