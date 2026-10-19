'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Suspense } from 'react';

// Phaser touches `window` on import, so the game is client-only.
const GameView = dynamic(() => import('@/game/GameView'), {
  ssr: false,
  loading: () => <p className="mt-[40vh] text-center text-xl">Loading TerraGo…</p>,
});

function Play() {
  const id = useSearchParams().get('c');
  const router = useRouter();
  if (!id) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <div className="px-panel p-6 text-center">
          <p className="font-bold">No character selected.</p>
          <Link href="/characters" className="px-btn green mt-4">
            Choose a character
          </Link>
        </div>
      </main>
    );
  }
  return (
    <GameView
      characterId={id}
      onExit={async (to) => {
        if (to === '/') await api.logout().catch(() => {});
        router.push(to);
      }}
    />
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <Play />
    </Suspense>
  );
}
