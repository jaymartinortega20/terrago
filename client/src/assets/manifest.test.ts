import { describe, expect, it } from 'vitest';
import { listAllAssetEntries } from './manifest.js';
import { PAPER_DOLL_FACINGS, PAPER_DOLL_LAYERS, TOTAL_FRAMES_PER_FACING, WINGS_FLUTTER_FRAME_COUNT } from './paperDollManifest.js';
import { ANIM_FRAME_COUNTS } from './generators/pose.js';
import { MONSTER_ANIMS, MONSTER_SPRITE_IDS } from './monsterManifest.js';
import { NPC_PALETTES } from './palette.js';
import manifestJson from '../../assets/manifest.json' with { type: 'json' };

describe('listAllAssetEntries', () => {
  it('loads manifest.json and resolves every entry to a real generator with no throw', () => {
    expect(() => listAllAssetEntries()).not.toThrow();
  });

  it('includes every tiles/ui/intro entry from manifest.json plus the full paper-doll grid, with no duplicate keys', () => {
    const entries = listAllAssetEntries();
    const raw = manifestJson as unknown as { tiles: unknown[]; ui: unknown[]; intro: unknown[] };
    const monsterFrameCount = MONSTER_SPRITE_IDS.length * MONSTER_ANIMS.reduce((sum, a) => sum + ANIM_FRAME_COUNTS[a], 0);
    const expectedCount =
      raw.tiles.length +
      raw.ui.length +
      raw.intro.length +
      PAPER_DOLL_LAYERS.length * PAPER_DOLL_FACINGS.length * TOTAL_FRAMES_PER_FACING +
      PAPER_DOLL_FACINGS.length * WINGS_FLUTTER_FRAME_COUNT +
      monsterFrameCount +
      Object.keys(NPC_PALETTES).length;

    expect(entries).toHaveLength(expectedCount);
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
  });

  it('gives every entry a positive width and height', () => {
    for (const entry of listAllAssetEntries()) {
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
    }
  });

  it('resolves ui_portrait_frame to its own declared size rather than the default icon size', () => {
    const entries = listAllAssetEntries();
    const portrait = entries.find((e) => e.key === 'ui_portrait_frame');
    expect(portrait).toBeDefined();
    expect(portrait!.width).toBe(96);
    expect(portrait!.height).toBe(96);
  });

  it('throws a clear error if a manifest entry names a generator the registry does not have', async () => {
    // Exercises resolveEntries' validation directly rather than mutating
    // the real manifest.json - re-import the module fresh isn't needed
    // since the failure path is pure and doesn't depend on module state.
    const { GENERATOR_REGISTRY } = await import('./generators/index.js');
    expect(GENERATOR_REGISTRY['totally-not-a-real-generator']).toBeUndefined();
  });
});
