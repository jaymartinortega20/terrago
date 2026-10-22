import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AntiBot } from '../../src/security/antibot';

function setup() {
  const events: string[] = [];
  const world = { players: new Map() } as never;
  const pool = { query: async () => ({ rows: [{ n: 0 }] }) } as never;
  const bot = new AntiBot(world, pool, { record: (kind) => events.push(kind) });
  bot.stop();
  return { bot, events };
}

test('machine-perfect action timing is flagged; human jitter is not', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const robot = { id: 'r', userId: 'u', ip: null } as never;
  const human = { id: 'h', userId: 'u2', ip: null } as never;
  const a = setup();
  for (let i = 0; i < 300; i++) {
    t.mock.timers.tick(1000);
    a.bot.action(robot);
  }
  assert.deepEqual(a.events, ['bot_timing']);
  const b = setup();
  for (let i = 0; i < 300; i++) {
    t.mock.timers.tick(700 + Math.floor(Math.random() * 900));
    b.bot.action(human);
  }
  assert.deepEqual(b.events, []);
});
