import { describe, expect, it } from 'vitest';
import { ClientMessageSchema, ServerMessageSchema } from './schemas.js';

describe('ClientMessageSchema', () => {
  it('accepts a valid auth:register message', () => {
    const result = ClientMessageSchema.safeParse({
      t: 'auth:register',
      username: 'jay_martin',
      password: 'correcthorse',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a username with spaces or symbols', () => {
    const result = ClientMessageSchema.safeParse({
      t: 'auth:register',
      username: 'bad name!',
      password: 'correcthorse',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password under the minimum length', () => {
    const result = ClientMessageSchema.safeParse({
      t: 'auth:login',
      username: 'jay',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown message type', () => {
    const result = ClientMessageSchema.safeParse({ t: 'totally:fake', foo: 'bar' });
    expect(result.success).toBe(false);
  });

  it('rejects a hotbar slot out of 1-8 range', () => {
    const result = ClientMessageSchema.safeParse({ t: 'hotbar:use', slot: 9 });
    expect(result.success).toBe(false);
  });

  it('accepts move:dir within -1..1 and rejects outside it', () => {
    expect(ClientMessageSchema.safeParse({ t: 'move:dir', dx: 1, dy: -1 }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ t: 'move:dir', dx: 2, dy: 0 }).success).toBe(false);
  });

  it('rejects a chat message over the length limit', () => {
    const result = ClientMessageSchema.safeParse({
      t: 'chat:send',
      channel: 'global',
      text: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a bare intro:seen message', () => {
    const result = ClientMessageSchema.safeParse({ t: 'intro:seen' });
    expect(result.success).toBe(true);
  });
});

describe('ServerMessageSchema', () => {
  it('accepts a world:snapshot with entity data', () => {
    const result = ServerMessageSchema.safeParse({
      t: 'world:snapshot',
      tick: 42,
      entered: [
        {
          id: 'e1',
          kind: 'monster',
          name: 'Slime',
          x: 3,
          y: 4,
          facing: 'down',
          anim: 'idle',
          hpPct: 100,
        },
      ],
      updated: [],
      left: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a crit combat:result with damage', () => {
    const result = ServerMessageSchema.safeParse({
      t: 'combat:result',
      attackerId: 'p1',
      defenderId: 'm1',
      outcome: 'crit',
      damage: 58,
    });
    expect(result.success).toBe(true);
  });

  it('rejects hpPct outside 0-100', () => {
    const result = ServerMessageSchema.safeParse({
      t: 'world:snapshot',
      tick: 1,
      entered: [
        { id: 'e1', kind: 'monster', name: 'Slime', x: 0, y: 0, facing: 'down', anim: 'idle', hpPct: 150 },
      ],
      updated: [],
      left: [],
    });
    expect(result.success).toBe(false);
  });
});
