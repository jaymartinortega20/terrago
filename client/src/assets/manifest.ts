/**
 * Loads client/assets/manifest.json, resolves each entry's named generator
 * through the registry, and merges in the programmatically-enumerated
 * paper-doll frame grid (paperDollManifest.ts) - the single list
 * BootScene actually iterates to build every Phaser texture this game
 * uses. No other module reads manifest.json directly.
 */
import manifestJson from '../../assets/manifest.json' with { type: 'json' };
import { TILE_SIZE_PX, SPRITE_FRAME_SIZE_PX } from '../config.js';
import { GENERATOR_REGISTRY } from './generators/index.js';
import { ICON_SIZE_PX } from './generators/ui.js';
import { INTRO_BG_HEIGHT, INTRO_BG_WIDTH } from './generators/intro.js';
import { listPaperDollFrameAssets, listWingsFrameAssets } from './paperDollManifest.js';
import { listMonsterFrameAssets } from './monsterManifest.js';
import { listNpcFrameAssets } from './npcManifest.js';

export interface AssetEntry {
  key: string;
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

interface RawManifestEntry {
  key: string;
  generator: string;
  params?: Record<string, unknown>;
}

interface RawManifest {
  tiles: RawManifestEntry[];
  ui: RawManifestEntry[];
  intro: RawManifestEntry[];
}

function resolveEntries(entries: RawManifestEntry[], defaultSize: { width: number; height: number }, sizeFor?: (params: Record<string, unknown>) => { width: number; height: number } | undefined): AssetEntry[] {
  return entries.map((entry) => {
    const generator = GENERATOR_REGISTRY[entry.generator];
    if (!generator) {
      throw new Error(`client/assets/manifest.json: entry "${entry.key}" names unknown generator "${entry.generator}"`);
    }
    const params = entry.params ?? {};
    const size = sizeFor?.(params) ?? defaultSize;
    return { key: entry.key, width: size.width, height: size.height, draw: (ctx) => generator(ctx, params) };
  });
}

/** Every generated texture this game needs, keyed uniquely across tiles,
 * UI icons, intro backgrounds and the full paper-doll frame grid. Called
 * once at boot. */
export function listAllAssetEntries(): AssetEntry[] {
  const manifest = manifestJson as unknown as RawManifest;

  const tileAssets = resolveEntries(manifest.tiles, { width: TILE_SIZE_PX, height: TILE_SIZE_PX });
  const uiAssets = resolveEntries(manifest.ui, { width: ICON_SIZE_PX, height: ICON_SIZE_PX }, (params) => {
    const size = typeof params.size === 'number' ? params.size : undefined;
    return size ? { width: size, height: size } : undefined;
  });
  const introAssets = resolveEntries(manifest.intro, { width: INTRO_BG_WIDTH, height: INTRO_BG_HEIGHT });

  const paperDollSize = { width: SPRITE_FRAME_SIZE_PX, height: SPRITE_FRAME_SIZE_PX };
  const paperDollAssets = listPaperDollFrameAssets().map((a) => ({ ...a, ...paperDollSize }));
  const wingsAssets = listWingsFrameAssets().map((a) => ({ ...a, ...paperDollSize }));
  const monsterAssets = listMonsterFrameAssets().map((a) => ({ ...a, ...paperDollSize }));
  const npcAssets = listNpcFrameAssets().map((a) => ({ ...a, ...paperDollSize }));

  return [...tileAssets, ...uiAssets, ...introAssets, ...paperDollAssets, ...wingsAssets, ...monsterAssets, ...npcAssets];
}
