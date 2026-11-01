import { describe, expect, it } from 'vitest';
import { createPrng, prngRange } from './prng.js';

describe('createPrng', () => {
  it('is deterministic: the same seed always produces the same sequence', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds produce different sequences', () => {
    const a = createPrng(1);
    const b = createPrng(2);
    expect(a()).not.toBe(b());
  });

  it('always returns a value in [0, 1)', () => {
    const rng = createPrng(7);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('treats a seed of 0 the same as a real seed, not a broken generator', () => {
    const rng = createPrng(0);
    const values = Array.from({ length: 5 }, () => rng());
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(1); // not stuck returning one constant
  });
});

describe('prngRange', () => {
  it('stays within [min, max)', () => {
    const rng = createPrng(99);
    for (let i = 0; i < 200; i++) {
      const v = prngRange(rng, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });
});
