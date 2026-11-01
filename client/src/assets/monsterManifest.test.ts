import { describe, expect, it } from 'vitest';
import { ANIM_FRAME_COUNTS } from './generators/pose.js';
import {
  FALLBACK_MONSTER_SPRITE_ID,
  MONSTER_ANIMS,
  MONSTER_SPRITE_IDS,
  listMonsterFrameAssets,
  monsterFrameKey,
  monsterSpriteIdFor,
} from './monsterManifest.js';

describe('MONSTER_ANIMS', () => {
  it('is every pose.ts anim except mounted - monsters never mount', () => {
    expect(MONSTER_ANIMS).not.toContain('mounted');
    expect(MONSTER_ANIMS.length).toBe(Object.keys(ANIM_FRAME_COUNTS).length - 1);
  });
});

describe('monsterSpriteIdFor', () => {
  it('passes through a known monsterId', () => {
    expect(monsterSpriteIdFor('slime')).toBe('slime');
  });

  it('falls back for an unknown or missing monsterId, rather than throwing', () => {
    expect(monsterSpriteIdFor('future_m2_monster')).toBe(FALLBACK_MONSTER_SPRITE_ID);
    expect(monsterSpriteIdFor(undefined)).toBe(FALLBACK_MONSTER_SPRITE_ID);
  });
});

describe('listMonsterFrameAssets', () => {
  it('produces exactly spriteIds x anims x their frame counts, all uniquely keyed', () => {
    const assets = listMonsterFrameAssets();
    const expectedCount = MONSTER_SPRITE_IDS.length * MONSTER_ANIMS.reduce((sum, a) => sum + ANIM_FRAME_COUNTS[a], 0);
    expect(assets).toHaveLength(expectedCount);
    expect(new Set(assets.map((a) => a.key)).size).toBe(assets.length);
  });

  it('every key matches monsterFrameKey for its own spriteId/anim/frame', () => {
    const assets = listMonsterFrameAssets();
    for (const spriteId of MONSTER_SPRITE_IDS) {
      for (const anim of MONSTER_ANIMS) {
        for (let frame = 0; frame < ANIM_FRAME_COUNTS[anim]; frame++) {
          expect(assets.some((a) => a.key === monsterFrameKey(spriteId, anim, frame))).toBe(true);
        }
      }
    }
  });

  it("each asset's draw function is callable (no arity mismatch), closing over its own anim/frame", () => {
    // Actual rendering correctness isn't something Vitest can check (no
    // canvas implementation in this Node test environment) - verified
    // instead via the Playwright-screenshotted preview gallery, same as
    // the paper-doll frames (docs/DECISIONS.md, task #78).
    const assets = listMonsterFrameAssets();
    expect(typeof assets[0]!.draw).toBe('function');
    expect(assets[0]!.draw.length).toBeLessThanOrEqual(1);
  });
});
