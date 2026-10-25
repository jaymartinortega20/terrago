'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ACCOUNT } from '@terrago/shared';
import { api, ApiError } from '@/lib/api';
import { markSignedIn } from '@/lib/session';

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
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <form onSubmit={submit} className="px-panel w-full max-w-sm p-6" noValidate>
        <Link href="/" className="text-outline block text-center text-4xl font-bold tracking-wider text-gold">
          TERRAGO
        </Link>
        <h1 className="mt-4 text-center text-2xl font-bold text-wood-dark">{register ? 'Create your account' : 'Welcome back'}</h1>

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
          <p role="alert" className="mt-4 border-2 border-berry bg-berry/10 px-3 py-2 text-sm font-bold text-berry">
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
              New to TerraGo?{' '}
              <Link href="/register" className="font-bold text-leaf-dark underline">
                Create an account
              </Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
