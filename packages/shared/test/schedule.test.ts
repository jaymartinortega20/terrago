import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORLD_BOSS_OFFSET_MS, WORLD_BOSS_PERIOD_MS, WORLD_BOSS_WINDOW_MS, currentWorldBoss, guildWeek, nextWorldBoss } from '../src';

test('world bosses: one every 3 hours for 30 minutes, rotating', () => {
  const t0 = 1000 * WORLD_BOSS_PERIOD_MS + WORLD_BOSS_OFFSET_MS;
  const a = currentWorldBoss(t0 + 1000)!;
  assert.equal(a.start, t0);
  assert.equal(a.end, t0 + WORLD_BOSS_WINDOW_MS);
  assert.equal(currentWorldBoss(t0 + WORLD_BOSS_WINDOW_MS + 1), null);
  assert.equal(currentWorldBoss(t0 - 1), null);
  const n = nextWorldBoss(t0 + WORLD_BOSS_WINDOW_MS + 1);
  assert.equal(n.start, t0 + WORLD_BOSS_PERIOD_MS);
  assert.notEqual(n.def.monster, a.def.monster, 'rotates');
  assert.equal(nextWorldBoss(t0 - 60_000).start, t0);
});

test('guild weeks start on Monday (UTC)', () => {
  assert.equal(guildWeek(Date.UTC(2026, 9, 26, 12)), '2026-10-26'); // a Monday
  assert.equal(guildWeek(Date.UTC(2026, 10, 1, 23)), '2026-10-26'); // Sunday
  assert.equal(guildWeek(Date.UTC(2026, 10, 2, 0, 0, 1)), '2026-11-02');
});
