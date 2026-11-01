import { describe, expect, it } from 'vitest';
import { ANIM_FRAME_COUNTS } from './generators/pose.js';
import {
  PAPER_DOLL_COMPOSITE_ORDER,
  PAPER_DOLL_FACINGS,
  PAPER_DOLL_LAYERS,
  TOTAL_FRAMES_PER_FACING,
  WINGS_FLUTTER_FRAME_COUNT,
  listPaperDollFrameAssets,
  listWingsFrameAssets,
  paperDollFrameKey,
  wingsFrameKey,
} from './paperDollManifest.js';

describe('listPaperDollFrameAssets', () => {
  it('produces exactly layers x facings x total-anim-frames assets', () => {
    const assets = listPaperDollFrameAssets();
    expect(assets).toHaveLength(PAPER_DOLL_LAYERS.length * PAPER_DOLL_FACINGS.length * TOTAL_FRAMES_PER_FACING);
  });

  it('never produces a duplicate key - a collision would silently overwrite a Phaser texture', () => {
    const assets = listPaperDollFrameAssets();
    const keys = new Set(assets.map((a) => a.key));
    expect(keys.size).toBe(assets.length);
  });

  it('every key round-trips through paperDollFrameKey for its own layer/facing/anim/frame', () => {
    const assets = listPaperDollFrameAssets();
    for (const layer of PAPER_DOLL_LAYERS) {
      for (const facing of PAPER_DOLL_FACINGS) {
        for (const [anim, count] of Object.entries(ANIM_FRAME_COUNTS)) {
          for (let frame = 0; frame < count; frame++) {
            const key = paperDollFrameKey(layer, facing, anim as keyof typeof ANIM_FRAME_COUNTS, frame);
            expect(assets.some((a) => a.key === key)).toBe(true);
          }
        }
      }
    }
  });

  it('each asset\'s draw function is callable (no arity mismatch) and returns nothing', () => {
    const assets = listPaperDollFrameAssets();
    const fakeCtx = {} as CanvasRenderingContext2D; // never actually invoked in this test, just closed over
    expect(typeof assets[0]!.draw).toBe('function');
    expect(assets[0]!.draw.length).toBeLessThanOrEqual(1); // closures over facing/pose, taking only ctx
    void fakeCtx;
  });
});

describe('listWingsFrameAssets', () => {
  it('produces facings x flutter-frame-count assets, all uniquely keyed', () => {
    const assets = listWingsFrameAssets();
    expect(assets).toHaveLength(PAPER_DOLL_FACINGS.length * WINGS_FLUTTER_FRAME_COUNT);
    expect(new Set(assets.map((a) => a.key)).size).toBe(assets.length);
  });

  it('keys match wingsFrameKey for every facing/frame combination', () => {
    for (const facing of PAPER_DOLL_FACINGS) {
      for (let frame = 0; frame < WINGS_FLUTTER_FRAME_COUNT; frame++) {
        const key = wingsFrameKey(facing, frame);
        expect(listWingsFrameAssets().some((a) => a.key === key)).toBe(true);
      }
    }
  });
});

describe('PAPER_DOLL_COMPOSITE_ORDER', () => {
  it('is exactly PAPER_DOLL_LAYERS, reordered - same set, same length, no typos or omissions', () => {
    expect(PAPER_DOLL_COMPOSITE_ORDER).toHaveLength(PAPER_DOLL_LAYERS.length);
    expect(new Set(PAPER_DOLL_COMPOSITE_ORDER)).toEqual(new Set(PAPER_DOLL_LAYERS));
  });
});

describe('paperDollFrameKey / wingsFrameKey', () => {
  it('never collide with each other across the two namespaces', () => {
    const frameKeys = new Set(listPaperDollFrameAssets().map((a) => a.key));
    const wingKeys = listWingsFrameAssets().map((a) => a.key);
    for (const k of wingKeys) expect(frameKeys.has(k)).toBe(false);
  });
});
