import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashPassword, needsRehash, verifyPassword } from '../../src/auth/passwords';
import { accountBlockReason, clearSessionCookie, parseCookies, sessionCookie } from '../../src/auth/sessions';
import { loadConfig } from '../../src/config';
import { TokenBucket, WindowLimiter } from '../../src/security/rateLimit';

describe('password hashing', () => {
  test('hashes are salted, verifiable and never contain the password', async () => {
    const pw = 'correct horse battery staple';
    const h1 = await hashPassword(pw);
    const h2 = await hashPassword(pw);
    assert.notEqual(h1, h2, 'random salt');
    assert.match(h1, /^scrypt\$16384\$8\$5\$/);
    assert.ok(!h1.includes(pw));
    assert.equal(await verifyPassword(pw, h1), true);
    assert.equal(await verifyPassword('wrong password!!', h1), false);
    assert.equal(needsRehash(h1), false);
  });

  test('malformed hashes never verify', async () => {
    assert.equal(await verifyPassword('x', 'plaintext'), false);
    assert.equal(await verifyPassword('x', 'scrypt$a$b$c$d$e'), false);
    assert.equal(needsRehash('scrypt$1024$8$1$aa$bb'), true);
  });
});

describe('session cookies', () => {
  test('cookie is HttpOnly, SameSite=Lax, and Secure when configured', () => {
    const c = sessionCookie('abc', { maxAgeMs: 60_000, secure: true, domain: '.terrago.gg' });
    assert.equal(c, 'tg_session=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure; Domain=.terrago.gg');
    assert.match(clearSessionCookie({ secure: false }), /Max-Age=0/);
  });

  test('parses cookie headers defensively', () => {
    assert.deepEqual(parseCookies('a=1; tg_session=x%20y; broken; =v'), { a: '1', tg_session: 'x y' });
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies('a=%E0%A4%A'), { a: '%E0%A4%A' });
  });

  test('bans and suspensions block play', () => {
    assert.equal(accountBlockReason({ status: 'active', bannedUntil: null }), null);
    assert.match(accountBlockReason({ status: 'banned', bannedUntil: null })!, /banned/);
    assert.match(accountBlockReason({ status: 'suspended', bannedUntil: new Date(Date.now() + 1e6) })!, /suspended until/);
    assert.equal(accountBlockReason({ status: 'suspended', bannedUntil: new Date(Date.now() - 1000) }), null);
  });
});

describe('rate limiting', () => {
  test('token bucket allows bursts then refills over time', () => {
    const b = new TokenBucket(3, 1 / 1000, 0);
    assert.equal(b.take(1, 0), true);
    assert.equal(b.take(1, 0), true);
    assert.equal(b.take(1, 0), true);
    assert.equal(b.take(1, 0), false);
    assert.equal(b.take(1, 1000), true);
    assert.equal(b.take(1, 1000), false);
  });

  test('window limiter counts per key and reports wait time', () => {
    const w = new WindowLimiter(2, 60_000);
    assert.equal(w.hit('ip', 0), 0);
    assert.equal(w.hit('ip', 1), 0);
    assert.equal(w.hit('ip', 2), 60);
    assert.equal(w.hit('other', 2), 0);
    assert.equal(w.hit('ip', 60_001), 0, 'window resets');
  });
});

describe('config', () => {
  test('requires DATABASE_URL and parses origins', () => {
    assert.throws(() => loadConfig({}), /DATABASE_URL/);
    const c = loadConfig({ DATABASE_URL: 'postgres://x', WEB_ORIGINS: 'https://a.gg/, https://b.gg' });
    assert.deepEqual(c.webOrigins, ['https://a.gg', 'https://b.gg']);
    assert.equal(c.cookieSecure, false);
    assert.equal(c.rateLimitsEnabled, true);
  });

  test('production forces secure cookies and rate limits', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production', DISABLE_RATE_LIMITS: 'true' });
    assert.equal(c.cookieSecure, true);
    assert.equal(c.rateLimitsEnabled, true);
  });
});
