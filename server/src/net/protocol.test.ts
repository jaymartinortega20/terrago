import { describe, expect, it } from 'vitest';
import { ConnectionRateLimiter, MAX_MESSAGE_BYTES, encodeServerMessage, parseClientMessage } from './protocol.js';

describe('parseClientMessage', () => {
  it('accepts a well-formed message matching a known schema', () => {
    const result = parseClientMessage(JSON.stringify({ t: 'move:dir', dx: 1, dy: 0 }));
    expect(result).toEqual({ ok: true, message: { t: 'move:dir', dx: 1, dy: 0 } });
  });

  it('rejects malformed JSON without throwing', () => {
    const result = parseClientMessage('{not json');
    expect(result).toEqual({ ok: false, error: 'invalid_json' });
  });

  it('rejects valid JSON that matches no schema', () => {
    const result = parseClientMessage(JSON.stringify({ t: 'not:a:real:type', foo: 'bar' }));
    expect(result).toEqual({ ok: false, error: 'invalid_message' });
  });

  it('rejects a message that fails its own schema field constraints', () => {
    // chat:send text has a max length of 200; channel must be one of the enum values.
    const result = parseClientMessage(JSON.stringify({ t: 'chat:send', channel: 'dm', text: 'hi' }));
    expect(result).toEqual({ ok: false, error: 'invalid_message' });
  });

  it('rejects a payload over MAX_MESSAGE_BYTES before attempting to parse it', () => {
    const huge = JSON.stringify({ t: 'chat:send', channel: 'global', text: 'x'.repeat(MAX_MESSAGE_BYTES) });
    const result = parseClientMessage(huge);
    expect(result).toEqual({ ok: false, error: 'message_too_large' });
  });
});

describe('encodeServerMessage', () => {
  it('round-trips through JSON', () => {
    const message = { t: 'system:announce' as const, text: 'Boss incoming!' };
    const encoded = encodeServerMessage(message);
    expect(JSON.parse(encoded)).toEqual(message);
  });
});

describe('ConnectionRateLimiter', () => {
  it('allows messages up to the per-type limit within the window', () => {
    const limiter = new ConnectionRateLimiter();
    // auth:login allows 5 per 60s.
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('auth:login', 1000)).toBe(true);
    }
    expect(limiter.check('auth:login', 1000)).toBe(false);
  });

  it('allows another message once the oldest hit ages out of the window', () => {
    const limiter = new ConnectionRateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('auth:login', 1000)).toBe(true);
    }
    expect(limiter.check('auth:login', 1000)).toBe(false);
    // 60_001ms later the first of the 5 hits (at t=1000) has aged out.
    expect(limiter.check('auth:login', 61_001)).toBe(true);
  });

  it('tracks each message type independently', () => {
    const limiter = new ConnectionRateLimiter();
    for (let i = 0; i < 5; i++) limiter.check('auth:login', 0);
    expect(limiter.check('auth:login', 0)).toBe(false);
    // chat:send has never been hit on this connection, so it's unaffected.
    expect(limiter.check('chat:send', 0)).toBe(true);
  });

  it('falls back to the default limit for an unlisted message type', () => {
    const limiter = new ConnectionRateLimiter();
    for (let i = 0; i < 10; i++) {
      expect(limiter.check('some:future:type', 0)).toBe(true);
    }
    expect(limiter.check('some:future:type', 0)).toBe(false);
  });
});
