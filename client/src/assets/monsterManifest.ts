/**
 * The monster sprite frame grid - enumerated in code for the same reason
 * as the paper-doll frame grid (paperDollManifest.ts): it's fully regular
 * (every monster id needs the same anim x frame combinations), so hand-
 * listing it in client/assets/manifest.json would add no real data-driven
 * value. M1 has exactly one monster (Slime); adding a second is just
 * adding its id to MONSTER_SPRITE_IDS plus a case in
 * generators/monsters.ts's pose/draw functions.
 */
import { ANIM_FRAME_COUNTS, type AnimName } from './generators/pose.js';
import { computeSlimePose, drawSlimeFrame } from './generators/monsters.js';

/** Monsters never mount. */
export const MONSTER_ANIMS: readonly AnimName[] = (Object.keys(ANIM_FRAME_COUNTS) as AnimName[]).filter(
  (a) => a !== 'mounted'
);

export const MONSTER_SPRITE_IDS = ['slime'] as const;
export type MonsterSpriteId = (typeof MONSTER_SPRITE_IDS)[number];

/** monsterId values the server can send that this client doesn't (yet)
 * have art for render as this instead, rather than crashing on a missing
 * texture - forward-compatible with M2+ adding monster types ahead of
 * their sprites. */
export const FALLBACK_MONSTER_SPRITE_ID: MonsterSpriteId = 'slime';

export function monsterSpriteIdFor(monsterId: string | undefined): MonsterSpriteId {
  return (MONSTER_SPRITE_IDS as readonly string[]).includes(monsterId ?? '')
    ? (monsterId as MonsterSpriteId)
    : FALLBACK_MONSTER_SPRITE_ID;
}

export function monsterFrameKey(spriteId: MonsterSpriteId, anim: AnimName, frame: number): string {
  return `mon_${spriteId}_${anim}_${frame}`;
}

export interface MonsterSpriteAsset {
  key: string;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

function drawerFor(spriteId: MonsterSpriteId): (ctx: CanvasRenderingContext2D, anim: AnimName, frame: number, frameCount: number) => void {
  switch (spriteId) {
    case 'slime':
    default:
      return (ctx, anim, frame, frameCount) => drawSlimeFrame(ctx, computeSlimePose(anim, frame, frameCount));
  }
}

export function listMonsterFrameAssets(): MonsterSpriteAsset[] {
  const assets: MonsterSpriteAsset[] = [];
  for (const spriteId of MONSTER_SPRITE_IDS) {
    const draw = drawerFor(spriteId);
    for (const anim of MONSTER_ANIMS) {
      const frameCount = ANIM_FRAME_COUNTS[anim];
      for (let frame = 0; frame < frameCount; frame++) {
        assets.push({ key: monsterFrameKey(spriteId, anim, frame), draw: (ctx) => draw(ctx, anim, frame, frameCount) });
      }
    }
  }
  return assets;
}
