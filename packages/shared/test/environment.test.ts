import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IN_SEASON_SPEED, darknessAt, seasonAt, seasonSpeed, weatherAt, weatherRegion } from '../src';

test('seasons change every Monday (UTC), in order', () => {
  assert.equal(seasonAt(Date.UTC(2026, 9, 5, 0, 0, 1)), 'spring');
  assert.equal(seasonAt(Date.UTC(2026, 9, 12, 12)), 'summer');
  assert.equal(seasonAt(Date.UTC(2026, 9, 21, 12)), 'autumn');
  assert.equal(seasonAt(Date.UTC(2026, 9, 26, 0, 0, 1)), 'winter');
  assert.equal(seasonAt(Date.UTC(2026, 10, 2, 0, 0, 1)), 'spring');
  assert.equal(seasonSpeed(['autumn'], Date.UTC(2026, 9, 21)), IN_SEASON_SPEED);
  assert.equal(seasonSpeed(['summer'], Date.UTC(2026, 9, 21)), 1);
});

test('weather is deterministic, regional, varied, and never inside caves', () => {
  const t = Date.UTC(2026, 9, 21, 15);
  assert.equal(weatherAt('meadow', t), weatherAt('forest', t), 'one valley, one sky');
  assert.equal(weatherAt('cave', t), 'clear');
  assert.equal(weatherRegion('ruins'), null);
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) seen.add(weatherAt('meadow', t + i * 12 * 60_000));
  assert.ok(seen.size >= 4, `variety: ${[...seen]}`);
  for (let i = 0; i < 300; i++) assert.notEqual(weatherAt('snow', Date.UTC(2026, 9, 19) + i * 12 * 60_000), 'rain', 'no rain on the peaks');
});

test('nights are dark, days are bright', () => {
  const day = 40 * 60_000;
  const base = Math.floor(Date.now() / day) * day;
  assert.equal(darknessAt(base + day * 0.3), 0);
  assert.ok(darknessAt(base + day * 0.8) > 0.5);
});
