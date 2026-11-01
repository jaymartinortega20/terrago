/**
 * A tiny deterministic PRNG (mulberry32) for the procedural art generators:
 * the same seed must always draw the same tile/frame so Phaser's texture
 * cache and any later re-generation stay stable, while different seeds
 * give tiles visual variety without needing hand-authored variants.
 */
export function createPrng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic random number in [min, max). */
export function prngRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
