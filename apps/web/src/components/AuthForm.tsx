'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ACCOUNT } from '@terrago/shared';
import { api, ApiError } from '@/lib/api';
import { markSignedIn } from '@/lib/session';
import { Logo } from './Logo';
import { SkyScene } from './SkyScene';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return setSlow(false);
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [busy]);
  const register = mode === 'register';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (register && password !== confirm) return setError('Passwords do not match.');
    if (register && password.length < ACCOUNT.passwordMinLength) {
      return setError(`Password must be at least ${ACCOUNT.passwordMinLength} characters.`);
    }
    setBusy(true);
    try {
      if (register) await api.register(email, password);
      else await api.login(email, password);
      markSignedIn(true);
      router.push('/characters');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <SkyScene className="fixed inset-0" />
      <div className="fixed inset-0 bg-gradient-to-r from-night/80 via-night/30 to-night/70" />
      <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <section className="hidden lg:block">
          <Link href="/">
            <Logo size="lg" />
          </Link>
          <p className="text-outline mt-6 max-w-md font-display text-3xl leading-tight font-semibold text-white">
            {register ? 'The crystal core is breaking. Terago needs you.' : 'Welcome back, Recruit. The Fracture waits for no one.'}
          </p>
          <ul className="mt-6 space-y-2 text-parchment/85">
            {['Five classes, ten mastery paths', 'Twelve regions above a sea of clouds', 'World bosses, waystones and real players'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="h-2 w-2 rotate-45 bg-sky shadow-[0_0_8px_#5ec8ff]" /> {t}
              </li>
            ))}
          </ul>
        </section>
      <form onSubmit={submit} className="px-panel mx-auto w-full max-w-sm p-7" noValidate>
        <Link href="/" className="flex justify-center lg:hidden">
          <Logo size="md" />
        </Link>
        <h1 className="mt-4 text-center text-2xl font-bold text-wood-dark lg:mt-0">{register ? 'Create your account' : 'Welcome back'}</h1>
        <p className="mt-1 text-center text-sm text-parchment/60">{register ? 'Free to play. No download.' : 'Log in to continue your journey.'}</p>

        <label className="mt-6 block text-sm font-bold" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="px-input mt-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="mt-4 block text-sm font-bold" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={register ? 'new-password' : 'current-password'}
          required
          minLength={register ? ACCOUNT.passwordMinLength : 1}
          className="px-input mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {register && (
          <>
            <label className="mt-4 block text-sm font-bold" htmlFor="confirm">
              Confirm password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className="px-input mt-1"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <p className="mt-2 text-xs text-wood-dark/80">At least {ACCOUNT.passwordMinLength} characters. A short phrase works well.</p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-berry/60 bg-berry/15 px-3 py-2 text-sm font-bold text-berry">
            {error}
          </p>
        )}

        <button type="submit" className="px-btn green mt-6 w-full" disabled={busy}>
          {busy ? 'Please wait…' : register ? 'Create account' : 'Log in'}
        </button>
        {slow && (
          <p className="mt-3 text-center text-sm text-wood-dark" role="status" data-testid="waking">
            Waking up the game server… the first visit after a quiet spell can take up to a minute.
          </p>
        )}

        <p className="mt-4 text-center text-sm">
          {register ? (
            <>
              Already have an account?{' '}
              <Link href="/login" className="font-bold text-leaf-dark underline">
                Log in
              </Link>
            </>
          ) : (
            <>
              New to Terago?{' '}
              <Link href="/register" className="font-bold text-leaf-dark underline">
                Create an account
              </Link>
            </>
          )}
        </p>
      </form>
      </div>
    </main>
  );
}
