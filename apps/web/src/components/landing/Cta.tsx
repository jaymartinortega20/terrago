'use client';

import Link from 'next/link';
import { currentWorldBoss, nextWorldBoss } from '@terrago/shared';
import { PlayLink } from '@/components/PlayLink';
import { fmtLeft, useNow } from './LiveTicker';
import { useSound } from './sound';

/** The big glowing Play button (with a sound on hover and click). */
export function PlayCta({ big = false, children = '▶ Play now' }: { big?: boolean; children?: React.ReactNode }) {
  const { blip } = useSound();
  return (
    <span onMouseEnter={() => blip('click')} onClickCapture={() => blip('portal')} className="inline-block">
      <PlayLink className={`px-btn green play-cta ${big ? 'px-8 py-4 text-2xl' : 'text-lg'}`}>{children}</PlayLink>
    </span>
  );
}

export function RegisterCta() {
  const { blip } = useSound();
  return (
    <Link href="/register" className="px-btn text-lg" onMouseEnter={() => blip('click')} onClick={() => blip('open')}>
      Create account
    </Link>
  );
}

/** "Storm Roc arrives in 1h 12m — be there." */
export function BossCountdown() {
  const now = useNow();
  if (!now) return <div className="px-panel-dark mx-auto h-80 max-w-3xl" data-testid="boss-countdown" />;
  const live = currentWorldBoss(now);
  const next = nextWorldBoss(now);
  return (
    <div className="px-panel-dark relative mx-auto max-w-3xl overflow-hidden p-6 text-center sm:p-10" data-testid="boss-countdown">
      <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_50%_120%,rgba(200,60,40,0.45),transparent_60%)] motion-reduce:animate-none" />
      <p className="relative text-sm font-bold uppercase tracking-[0.3em] text-red-300">{live ? 'World boss — happening now' : 'Next world boss'}</p>
      <h2 className="text-outline relative mt-2 text-4xl font-bold text-gold sm:text-5xl">{(live ?? next).def.name}</h2>
      <p className="relative mt-3 font-display text-5xl font-bold tabular-nums text-white drop-shadow-[0_0_18px_rgba(255,120,90,.5)] sm:text-6xl">{fmtLeft(live ? live.end - now : next.start - now)}</p>
      <p className="relative mt-3 text-white/75">
        {live ? 'The whole server is fighting it right now. Top damage dealers win bonus loot.' : 'The whole server teams up to bring it down. Make a hero now and be there when it lands.'}
      </p>
      <div className="relative mt-6">
        <PlayCta big>{live ? '⚔ Join the fight' : '▶ Begin your journey'}</PlayCta>
      </div>
    </div>
  );
}
