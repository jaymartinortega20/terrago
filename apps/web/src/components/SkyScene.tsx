/**
 * The world of Terago as a painted backdrop: a twilight sky over a sea of
 * clouds, floating islands, a temple and the great Aetherite crystal.
 * Pure SVG (crisp at any size) with gentle CSS motion.
 */
const rnd = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  // Rounded so server and browser render identical attribute strings.
  return Math.round((s - Math.floor(s)) * 1000) / 1000;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function Island({ x, y, s, dark = false }: { x: number; y: number; s: number; dark?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={dark ? 0.55 : 1}>
      <path d="M-120 0 C-80 -18 80 -18 120 0 C110 40 60 70 20 150 C10 175 -6 175 -12 150 C-50 80 -110 40 -120 0 Z" fill={dark ? '#2c2a5c' : 'url(#rock)'} />
      <path d="M-122 2 C-80 -22 80 -22 122 2 C90 12 -90 12 -122 2 Z" fill={dark ? '#3a4a7a' : 'url(#grass)'} />
      {!dark && (
        <>
          <path d="M-60 30 C-40 60 -30 90 -10 120" stroke="#a88ad8" strokeOpacity="0.25" strokeWidth="6" fill="none" />
          <circle cx="-70" cy="-16" r="16" fill="#3fa85a" />
          <circle cx="-52" cy="-22" r="20" fill="#4cc06a" />
          <circle cx="78" cy="-16" r="14" fill="#3fa85a" />
        </>
      )}
    </g>
  );
}

export function SkyScene({ className = '', calm = false }: { className?: string; calm?: boolean }) {
  const stars = Array.from({ length: 90 }, (_, i) => ({ x: r2(rnd(i) * 1600), y: r2(rnd(i + 99) * 420), r: r2(0.6 + rnd(i + 7) * 1.6), d: 2 + rnd(i + 3) * 4 }));
  const motes = Array.from({ length: calm ? 0 : 26 }, (_, i) => ({ x: r2(300 + rnd(i + 40) * 1100), y: r2(380 + rnd(i + 70) * 420), r: r2(1.5 + rnd(i + 5) * 2.5), d: 6 + rnd(i + 9) * 8 }));
  return (
    <div className={`pointer-events-none overflow-hidden ${className}`} aria-hidden>
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b0a2a" />
            <stop offset="0.38" stopColor="#2a2470" />
            <stop offset="0.66" stopColor="#7a4ab0" />
            <stop offset="0.82" stopColor="#f08a9a" />
            <stop offset="1" stopColor="#ffcf8a" />
          </linearGradient>
          <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#9ff0ff" stopOpacity="0.9" />
            <stop offset="0.35" stopColor="#5fb8ff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#5f7bff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="moon" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff8e8" />
            <stop offset="0.6" stopColor="#ffe9c0" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ffe9c0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rock" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7a5a8a" />
            <stop offset="0.5" stopColor="#4a3a72" />
            <stop offset="1" stopColor="#241c48" />
          </linearGradient>
          <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7cf08a" />
            <stop offset="1" stopColor="#2fa860" />
          </linearGradient>
          <linearGradient id="crystal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e6fdff" />
            <stop offset="0.4" stopColor="#6fe0ff" />
            <stop offset="1" stopColor="#5a3cff" />
          </linearGradient>
          <linearGradient id="ray" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#bff6ff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#bff6ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="fall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e8f8ff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#e8f8ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff4f0" />
            <stop offset="1" stopColor="#c8a8e8" />
          </linearGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <rect width="1600" height="900" fill="url(#sky)" />
        <circle cx="1280" cy="150" r="120" fill="url(#moon)" />
        <circle cx="1280" cy="150" r="38" fill="#fff8e8" opacity="0.92" />
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" className="sky-twinkle" style={{ animationDuration: `${r2(s.d)}s`, animationDelay: `${r2(-s.d * rnd(i))}s` }} />
        ))}
        {/* Distant islands */}
        <g className="sky-bob" style={{ animationDuration: '11s' }}>
          <Island x={230} y={430} s={0.55} dark />
        </g>
        <g className="sky-bob" style={{ animationDuration: '13s', animationDelay: '-4s' }}>
          <Island x={1420} y={470} s={0.42} dark />
        </g>
        {/* Light rays from the crystal */}
        <g opacity="0.7">
          {[-34, -16, 0, 16, 34].map((a, i) => (
            <polygon key={a} points="800,250 760,900 840,900" fill="url(#ray)" transform={`rotate(${a} 800 250)`} className="sky-ray" style={{ animationDelay: `${-i * 0.8}s` }} />
          ))}
        </g>
        {/* Main island with temple and waterfalls */}
        <g className="sky-bob" style={{ animationDuration: '9s' }}>
          <rect x="690" y="470" width="8" height="300" fill="url(#fall)" />
          <rect x="902" y="470" width="6" height="240" fill="url(#fall)" />
          <Island x={800} y={470} s={1.55} />
          {/* Temple */}
          <g transform="translate(800 440)">
            <rect x="-70" y="-6" width="140" height="10" rx="2" fill="#efe6ff" />
            {[-58, -30, 30, 58].map((x) => (
              <rect key={x} x={x - 5} y="-62" width="10" height="56" rx="2" fill="#e6dcff" />
            ))}
            <path d="M-80 -62 L0 -96 L80 -62 Z" fill="#cfc0f6" />
            <rect x="-80" y="-66" width="160" height="6" rx="2" fill="#efe6ff" />
          </g>
        </g>
        {/* The Aetherite crystal */}
        <g className="sky-crystal">
          <circle cx="800" cy="250" r="170" fill="url(#glow)" />
          <path d="M800 140 L852 236 L800 372 L748 236 Z" fill="url(#crystal)" stroke="#eaffff" strokeWidth="2" />
          <path d="M800 140 L820 236 L800 372 L780 236 Z" fill="#fff" opacity="0.35" />
          <path d="M748 236 H852" stroke="#fff" strokeOpacity="0.6" strokeWidth="2" />
        </g>
        {/* Rising motes of light */}
        {motes.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y} r={m.r} fill="#bff6ff" className="sky-mote" style={{ animationDuration: `${r2(m.d)}s`, animationDelay: `${r2(-m.d * rnd(i + 50))}s` }} />
        ))}
        {/* Sea of clouds */}
        <g className="sky-drift" style={{ animationDuration: '90s' }}>
          {Array.from({ length: 14 }, (_, i) => (
            <ellipse key={i} cx={i * 240 - 200} cy={800 + (i % 3) * 18} rx={190} ry={70} fill="url(#cloud)" opacity="0.85" filter="url(#soft)" />
          ))}
        </g>
        <g className="sky-drift" style={{ animationDuration: '60s', animationDirection: 'reverse' }}>
          {Array.from({ length: 14 }, (_, i) => (
            <ellipse key={i} cx={i * 260 - 300} cy={870 + (i % 2) * 14} rx={220} ry={80} fill="#fff6f0" opacity="0.92" filter="url(#soft)" />
          ))}
        </g>
      </svg>
    </div>
  );
}
