/**
 * TERAGO ONLINE wordmark: a glowing Aetherite crystal and gold lettering.
 */
export function Crystal({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="cr-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c8f6ff" />
          <stop offset="0.45" stopColor="#5fd8ff" />
          <stop offset="1" stopColor="#5a3cff" />
        </linearGradient>
        <linearGradient id="cr-b" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#7fe8ff" stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id="cr-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7fe8ff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#7fe8ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#cr-g)" />
      <path d="M32 4 L48 26 L32 60 L16 26 Z" fill="url(#cr-a)" stroke="#e8fbff" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M32 4 L40 26 L32 60 L24 26 Z" fill="url(#cr-b)" opacity="0.55" />
      <path d="M16 26 H48" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  );
}

export function Logo({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const s = { sm: [26, 'text-xl', 'text-[9px]'], md: [38, 'text-3xl', 'text-[11px]'], lg: [56, 'text-5xl', 'text-sm'], xl: [88, 'text-6xl sm:text-8xl', 'text-base sm:text-xl'] }[size] as [number, string, string];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="Terago Online">
      <Crystal size={s[0]} className="drop-shadow-[0_0_12px_rgba(110,220,255,0.7)]" />
      <span className="flex flex-col leading-none">
        <span
          className={`font-display font-bold tracking-[0.06em] ${s[1]}`}
          style={{
            background: 'linear-gradient(180deg, #fff6d0 0%, #ffd36e 45%, #f39a1e 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            filter: 'drop-shadow(0 2px 0 rgba(60,30,0,0.65)) drop-shadow(0 0 14px rgba(255,190,80,0.35))',
          }}
        >
          TERAGO
        </span>
        <span className={`font-display font-semibold tracking-[0.55em] text-sky-200/90 ${s[2]}`} style={{ textShadow: '0 0 10px rgba(110,200,255,0.8)' }}>
          ONLINE
        </span>
      </span>
    </span>
  );
}
