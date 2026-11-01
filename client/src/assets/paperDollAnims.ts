/**
 * Registers one Phaser animation per (layer, facing, anim) combination
 * against the frame textures paperDollManifest.ts's keys already named,
 * plus the wings flutter loop and every monster sprite's anims
 * (monsterManifest.ts) - called once from BootScene after every texture
 * exists. Any scene can then just `sprite.play(paperDollAnimKey(...))` /
 * `wingsAnimKey(...)` / `monsterAnimKey(...)` with no further setup.
 */
import type Phaser from 'phaser';
import { ANIM_FRAME_COUNTS, type AnimName } from './generators/pose.js';
import type { PaperDollFacing } from './generators/paperDoll.js';
import {
  PAPER_DOLL_FACINGS,
  PAPER_DOLL_LAYERS,
  WINGS_FLUTTER_FRAME_COUNT,
  paperDollFrameKey,
  wingsFrameKey,
  type PaperDollLayer,
} from './paperDollManifest.js';
import { MONSTER_ANIMS, MONSTER_SPRITE_IDS, monsterFrameKey } from './monsterManifest.js';

/** How many of each anim's frames play per second - looping anims (idle,
 * walk, mounted's held frame) read naturally slower than one-shot action
 * anims (attack/hurt/cast), which should feel snappy. */
const ANIM_FRAME_RATE: Record<AnimName, number> = {
  idle: 4,
  walk: 8,
  attack: 10,
  cast: 8,
  hurt: 8,
  death: 6,
  wakeUp: 6,
  mounted: 1,
};

const LOOPING_ANIMS = new Set<AnimName>(['idle', 'walk', 'mounted']);

export function paperDollAnimKey(layer: PaperDollLayer, facing: PaperDollFacing, anim: AnimName): string {
  return `pd_${layer}_${facing}_${anim}`;
}

export function wingsAnimKey(facing: PaperDollFacing): string {
  return `pd_wings_${facing}_flutter`;
}

export function monsterAnimKey(spriteId: string, anim: AnimName): string {
  return `mon_${spriteId}_${anim}`;
}

export function registerPaperDollAnimations(scene: Phaser.Scene): void {
  for (const layer of PAPER_DOLL_LAYERS) {
    for (const facing of PAPER_DOLL_FACINGS) {
      for (const animName of Object.keys(ANIM_FRAME_COUNTS) as AnimName[]) {
        const frameCount = ANIM_FRAME_COUNTS[animName];
        const key = paperDollAnimKey(layer, facing, animName);
        if (scene.anims.exists(key)) continue; // BootScene only runs once per page load, but guard anyway
        scene.anims.create({
          key,
          frames: Array.from({ length: frameCount }, (_, i) => ({ key: paperDollFrameKey(layer, facing, animName, i) })),
          frameRate: ANIM_FRAME_RATE[animName],
          repeat: LOOPING_ANIMS.has(animName) ? -1 : 0,
        });
      }
    }
  }

  for (const facing of PAPER_DOLL_FACINGS) {
    const key = wingsAnimKey(facing);
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: Array.from({ length: WINGS_FLUTTER_FRAME_COUNT }, (_, i) => ({ key: wingsFrameKey(facing, i) })),
      frameRate: 6,
      repeat: -1,
    });
  }

  for (const spriteId of MONSTER_SPRITE_IDS) {
    for (const animName of MONSTER_ANIMS) {
      const frameCount = ANIM_FRAME_COUNTS[animName];
      const key = monsterAnimKey(spriteId, animName);
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: Array.from({ length: frameCount }, (_, i) => ({ key: monsterFrameKey(spriteId, animName, i) })),
        frameRate: ANIM_FRAME_RATE[animName],
        repeat: LOOPING_ANIMS.has(animName) ? -1 : 0,
      });
    }
  }
}
