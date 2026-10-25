'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { seemsSignedIn } from '@/lib/session';

/** Play: your characters if you're logged in, otherwise the login page. */
export function PlayLink({ className, children }: { className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <a
      href="/characters"
      className={className}
      data-testid="play-link"
      onClick={(e) => {
        e.preventDefault();
        router.push(seemsSignedIn() ? '/characters' : '/login?next=/characters');
      }}
    >
      {children}
    </a>
  );
}

/**
 * The game server sleeps when nobody has played for a while (free hosting).
 * Poke it as soon as someone opens the home page so it's awake by the time
 * they press Play.
 */
export function WakeServer() {
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' }).catch(() => {});
  }, []);
  return null;
}
