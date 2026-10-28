'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CLASSES, MAPS } from '@terrago/game-data';
import { ACCOUNT, type CharacterSummary } from '@terrago/shared';
import { CharacterCreator } from '@/components/CharacterCreator';
import { CharacterPreview } from '@/components/CharacterPreview';
import { api, ApiError, type User } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { SkyScene } from '@/components/SkyScene';

export default function CharactersPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [chars, setChars] = useState<CharacterSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => !cancelled && setSlow(true), 4000);
    (async () => {
      try {
        const me = await api.me();
        const { characters } = await api.characters();
        if (cancelled) return;
        setUser(me.user);
        setChars(characters);
        setCreating(characters.length === 0);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) router.replace('/login?next=/characters');
        else setError(err instanceof Error ? err.message : 'Could not load characters.');
      } finally {
        clearTimeout(slowTimer);
        if (!cancelled) setSlow(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [router, attempt]);

  async function logout() {
    await api.logout().catch(() => {});
    router.push('/');
  }

  const play = (id: string) => router.push(`/play?c=${encodeURIComponent(id)}`);

  return (
    <main className="relative min-h-dvh">
      <SkyScene className="fixed inset-0" calm />
      <div className="fixed inset-0 bg-gradient-to-b from-night/70 via-night/40 to-night/85" />
      <div className="relative mx-auto max-w-5xl px-4 py-6">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label="Home">
          <Logo size="sm" />
        </Link>
        <span className="ml-auto hidden text-sm text-parchment/70 sm:block">{user?.email}</span>
        {user?.roles?.includes('admin') && (
          <Link href="/admin" className="px-btn small" data-testid="admin-link">
            Admin
          </Link>
        )}
        <button className="px-btn ghost small" onClick={logout}>
          Log out
        </button>
      </header>

      {error && (
        <div className="px-panel mt-8 p-4" data-testid="characters-error">
          <p className="font-bold text-berry">{error}</p>
          <div className="mt-3 flex gap-2">
            <button className="px-btn green small" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
            <Link href="/login?next=/characters" className="px-btn small">
              Log in
            </Link>
          </div>
        </div>
      )}
      {!chars && !error && (
        <div className="mt-16 text-center" role="status">
          <p className="text-xl">Loading your characters…</p>
          {slow && (
            <div className="px-panel mx-auto mt-6 max-w-md p-4 text-sm" data-testid="waking">
              <p>Waking up the game server — the first visit after a quiet spell can take up to a minute.</p>
              <p className="mt-2">
                Not logged in yet?{' '}
                <Link href="/login?next=/characters" className="font-bold underline">
                  Log in here
                </Link>
              </p>
            </div>
          )}
        </div>
      )}

      {chars && !creating && (
        <section className="mt-8">
          <h1 className="text-outline text-4xl font-bold">Choose your hero</h1>
          <p className="mt-1 text-parchment/70">Pick up where you left off, or start a new legend.</p>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {chars.map((c) => (
              <button
                key={c.id}
                onClick={() => play(c.id)}
                className="px-panel group flex flex-col items-center p-4 text-left transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_0_40px_rgba(95,200,255,0.35)]"
                data-testid="character-card"
              >
                <div className="relative flex h-40 w-full items-end justify-center overflow-hidden rounded-2xl" style={{ background: 'radial-gradient(circle at 50% 85%, rgba(120,220,255,0.55), rgba(60,60,170,0.35) 45%, rgba(10,14,40,0.2) 75%)' }}>
                  <div className="absolute bottom-3 h-4 w-28 rounded-[50%] bg-black/35 blur-sm" />
                  <div className="relative transition-transform duration-300 group-hover:scale-110">
                    <CharacterPreview appearance={c.appearance} classId={c.classId} scale={6} />
                  </div>
                  <span className="absolute top-2 left-2 rounded-full bg-gradient-to-b from-sky to-mana px-2 py-0.5 text-xs font-bold text-white shadow">Lv {c.level}</span>
                </div>
                <span className="mt-3 font-display text-xl font-bold">{c.name}</span>
                <span className="text-sm text-gold">{CLASSES.find((k) => k.id === c.classId)?.name}</span>
                <span className="text-xs text-parchment/60">{MAPS[c.mapId]?.name ?? c.mapId}</span>
                <span className="px-btn green small mt-3 w-full">▶ Play</span>
              </button>
            ))}
            {chars.length < ACCOUNT.maxCharacters && (
              <button onClick={() => setCreating(true)} className="px-panel-dark group flex min-h-72 flex-col items-center justify-center p-4 transition hover:-translate-y-1.5">
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-gold/60 text-4xl text-gold shadow-[0_0_24px_rgba(255,200,80,0.35)] transition group-hover:scale-110">+</span>
                <span className="mt-2 font-bold">New character</span>
                <span className="text-xs text-parchment/60">
                  {chars.length}/{ACCOUNT.maxCharacters} slots used
                </span>
              </button>
            )}
          </div>
        </section>
      )}

      {chars && creating && (
        <section className="mt-8">
          <h1 className="text-outline mb-1 text-4xl font-bold">Create your hero</h1>
          <p className="mb-5 text-parchment/70">Every legend in Terago begins as a Recruit in Oakhaven Sanctuary.</p>
          <CharacterCreator
            onCreated={(c) => {
              setChars((prev) => [...(prev ?? []), c]);
              setCreating(false);
            }}
            onCancel={chars.length ? () => setCreating(false) : undefined}
          />
        </section>
      )}
      </div>
    </main>
  );
}
