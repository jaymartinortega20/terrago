import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_APPEARANCE } from '../src/appearance';
import { containsProfanity, isOffensiveName, maskProfanity } from '../src/profanity';
import { applyXp, settleEnergy, totalXpToReach, xpToNext } from '../src/progression';
import { sanitizeChatText } from '../src/text';
import { checkCharacterName, createCharacterSchema, registerSchema } from '../src/validation';

describe('character names', () => {
  test('accepts ordinary names', () => {
    for (const n of ['Aria', 'Kael_Hunter', 'Bram42', 'Cassandra', 'Shiitake', 'Stafford']) {
      assert.equal(checkCharacterName(n).ok, true, n);
    }
  });

  test('rejects bad formats', () => {
    for (const n of ['ab', 'a'.repeat(17), '1Abc', 'Ab cd', 'Ab__cd', 'Abc_', 'Ab-cd', 'Ab12345', '<script>']) {
      assert.equal(checkCharacterName(n).ok, false, n);
    }
  });

  test('rejects staff impersonation and profanity, including leetspeak', () => {
    for (const n of ['Admin', 'Administrator', 'GM_Bob', 'Mod', 'TerraGoTeam', 'Sh1tLord', 'F_u_c_k', 'Fuuuck', 'Tangina']) {
      assert.equal(checkCharacterName(n).ok, false, n);
    }
  });
});

describe('profanity filter', () => {
  test('avoids false positives on innocent words', () => {
    for (const t of ['I sell grapes and shiitake', 'push it to the therapist', 'Cassandra assassin class', 'my reputation is good', 'bastion']) {
      assert.equal(containsProfanity(t), false, t);
    }
  });

  test('masks offending words but keeps the message', () => {
    assert.equal(maskProfanity('hello you ass'), 'hello you ***');
    assert.equal(maskProfanity('what the fuuuck'), 'what the ******');
    assert.equal(isOffensiveName('F.U.C.K'), true);
  });
});

describe('chat text', () => {
  test('strips control, zero-width and bidi characters', () => {
    assert.equal(sanitizeChatText('hi‮evil​\u0007 there', 160), 'hievil there');
  });
  test('collapses whitespace and bounds length by code points', () => {
    assert.equal(sanitizeChatText('  a   b  ', 160), 'a b');
    assert.equal(sanitizeChatText('😀'.repeat(10), 3), '😀😀😀');
  });
  test('non-strings become empty', () => {
    assert.equal(sanitizeChatText({ toString: () => 'x' }, 10), '');
  });
});

describe('progression', () => {
  const curve = { baseXp: 100, exponent: 1.8, maxLevel: 100 };

  test('XP curve is nonlinear and increasing', () => {
    assert.equal(xpToNext(1, curve), 100);
    assert.ok(xpToNext(50, curve) > 50 * xpToNext(2, curve) / 2);
    for (let l = 1; l < 99; l++) assert.ok(xpToNext(l + 1, curve) > xpToNext(l, curve));
    assert.equal(xpToNext(100, curve), 0);
    assert.ok(totalXpToReach(100, curve) > 10_000_000, 'level 100 should be a long road');
  });

  test('applyXp rolls over multiple levels and caps at max', () => {
    const r = applyXp(1, 0, xpToNext(1, curve) + xpToNext(2, curve) + 5, curve);
    assert.deepEqual(r, { level: 3, xp: 5, levelsGained: 2 });
    assert.deepEqual(applyXp(99, 0, 1e12, curve), { level: 100, xp: 0, levelsGained: 1 });
  });

  test('energy regenerates from timestamps and keeps partial progress', () => {
    const cfg = { max: 100, regenIntervalMs: 60_000 };
    const r = settleEnergy(50, 0, 150_000, cfg);
    assert.deepEqual(r, { energy: 52, updatedAtMs: 120_000 });
    assert.deepEqual(settleEnergy(99, 0, 10 * 60_000, cfg), { energy: 100, updatedAtMs: 600_000 });
  });
});

describe('input schemas', () => {
  test('register normalises email and enforces password rules', () => {
    const ok = registerSchema.safeParse({ email: '  Player@Example.COM ', password: 'correct horse battery' });
    assert.equal(ok.success, true);
    if (ok.success) assert.equal(ok.data.email, 'player@example.com');
    assert.equal(registerSchema.safeParse({ email: 'x@y.z', password: 'short' }).success, false);
    assert.equal(registerSchema.safeParse({ email: 'x@y.z', password: 'aaaaaaaaaaaa' }).success, false);
  });

  test('character creation validates appearance ranges', () => {
    assert.equal(createCharacterSchema.safeParse({ name: 'Aria', classId: 'mage', appearance: DEFAULT_APPEARANCE }).success, true);
    assert.equal(
      createCharacterSchema.safeParse({ name: 'Aria', classId: 'mage', appearance: { ...DEFAULT_APPEARANCE, hairStyle: 99 } }).success,
      false,
    );
    assert.equal(createCharacterSchema.safeParse({ name: 'Aria', classId: 'necromancer', appearance: DEFAULT_APPEARANCE }).success, false);
  });
});
