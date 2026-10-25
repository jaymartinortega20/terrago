'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CLASSES, MAPS } from '@terrago/game-data';
import { ACCOUNT, type CharacterSummary } from '@terrago/shared';
import { CharacterCreator } from '@/components/CharacterCreator';
import { CharacterPreview } from '@/components/CharacterPreview';
import { api, ApiError, type User } from '@/lib/api';

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
    <main className="mx-auto min-h-dvh max-w-4xl px-4 py-8">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-outline text-3xl font-bold tracking-wider text-gold">
          TERRAGO
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
          <h1 className="text-outline text-3xl font-bold">Choose your character</h1>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {chars.map((c) => (
              <button
                key={c.id}
                onClick={() => play(c.id)}
                className="px-panel group flex flex-col items-center p-4 text-left transition-transform hover:-translate-y-1"
                data-testid="character-card"
              >
                <div className="flex h-32 w-full items-end justify-center border-4 border-ink bg-[#67a84a]" style={{ boxShadow: 'inset 0 -12px 0 #58953f' }}>
                  <CharacterPreview appearance={c.appearance} scale={6} walk />
                </div>
                <span className="mt-3 text-xl font-bold">{c.name}</span>
                <span className="text-sm">
                  Lv {c.level} {CLASSES.find((k) => k.id === c.classId)?.name}
                </span>
                <span className="text-xs text-wood-dark/80">{MAPS[c.mapId]?.name ?? c.mapId}</span>
                <span className="px-btn green small mt-3">Play</span>
              </button>
            ))}
            {chars.length < ACCOUNT.maxCharacters && (
              <button onClick={() => setCreating(true)} className="px-panel-dark flex min-h-64 flex-col items-center justify-center p-4 hover:border-gold">
                <span className="text-5xl text-gold">+</span>
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
          <h1 className="text-outline mb-4 text-3xl font-bold">Create your character</h1>
          <CharacterCreator
            onCreated={(c) => {
              setChars((prev) => [...(prev ?? []), c]);
              setCreating(false);
            }}
            onCancel={chars.length ? () => setCreating(false) : undefined}
          />
        </section>
      )}
    </main>
  );
}
