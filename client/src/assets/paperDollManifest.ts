/**
 * The paper-doll frame grid is fully regular (every layer needs the exact
 * same facings/anims/frame-counts), so unlike manifest.json's hand-listed
 * entries, it's enumerated here in code rather than as 600+ hand-written
 * JSON rows. M1 has exactly one content variant per layer (one body, one
 * hairstyle, one weapon, one of each armor piece - there's no character
 * creation or cosmetic choice yet, docs/DECISIONS.md), so "layer" here
 * doubles as both the slot name and its only occupant.
 */
import { ANIM_FRAME_COUNTS, computePose, type AnimName } from './generators/pose.js';
import {
  drawBody,
  drawBoots,
  drawChest,
  drawHair,
  drawHead,
  drawHelmet,
  drawWeapon,
  drawWings,
  type PaperDollFacing,
} from './generators/paperDoll.js';
import type { Pose } from './generators/pose.js';

export const PAPER_DOLL_FACINGS: readonly PaperDollFacing[] = ['down', 'up', 'left'];

export type PaperDollLayer = 'body' | 'head' | 'hair' | 'weapon' | 'helmet' | 'chest' | 'boots';
export const PAPER_DOLL_LAYERS: readonly PaperDollLayer[] = ['body', 'head', 'hair', 'weapon', 'helmet', 'chest', 'boots'];

/** Back-to-front stacking order for compositing one character (wings are
 * drawn separately, always behind this whole stack - see WorldScene/
 * previewGallery). Verified visually via the Playwright-screenshotted
 * preview gallery (docs/DECISIONS.md, task #78): body, then boots, so
 * boots peek out from under the torso; chest over the torso; then head,
 * hair, helmet in that order so hair sits over the skull but helmet sits
 * over hair; weapon last so it's never occluded by the body holding it. */
export const PAPER_DOLL_COMPOSITE_ORDER: readonly PaperDollLayer[] = [
  'body',
  'boots',
  'chest',
  'head',
  'hair',
  'helmet',
  'weapon',
];

/** How many frames the wings' independent flutter loop gets - not tied to
 * ANIM_FRAME_COUNTS since wings never follow the body's current anim
 * (SPEC.md section 6). */
export const WINGS_FLUTTER_FRAME_COUNT = 6;

/** Exported so the HUD's status-block portrait (`ui/portrait.ts`, task
 * #81) can composite a static "idle, facing down" frame from the player's
 * CURRENT equipment without duplicating this layer->drawer lookup. */
export const LAYER_DRAWERS: Record<PaperDollLayer, (ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose) => void> = {
  body: drawBody,
  head: drawHead,
  hair: drawHair,
  weapon: drawWeapon,
  helmet: drawHelmet,
  chest: drawChest,
  boots: drawBoots,
};

export interface PaperDollAsset {
  key: string;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export function paperDollFrameKey(layer: PaperDollLayer, facing: PaperDollFacing, anim: AnimName, frame: number): string {
  return `pd_${layer}_${facing}_${anim}_${frame}`;
}

export function wingsFrameKey(facing: PaperDollFacing, frame: number): string {
  return `pd_wings_${facing}_${frame}`;
}

export function listPaperDollFrameAssets(): PaperDollAsset[] {
  const assets: PaperDollAsset[] = [];
  for (const layer of PAPER_DOLL_LAYERS) {
    const drawFn = LAYER_DRAWERS[layer];
    for (const facing of PAPER_DOLL_FACINGS) {
      for (const animName of Object.keys(ANIM_FRAME_COUNTS) as AnimName[]) {
        const frameCount = ANIM_FRAME_COUNTS[animName];
        for (let frame = 0; frame < frameCount; frame++) {
          assets.push({
            key: paperDollFrameKey(layer, facing, animName, frame),
            draw: (ctx) => drawFn(ctx, facing, computePose(animName, frame, frameCount)),
          });
        }
      }
    }
  }
  return assets;
}

export function listWingsFrameAssets(): PaperDollAsset[] {
  const assets: PaperDollAsset[] = [];
  for (const facing of PAPER_DOLL_FACINGS) {
    for (let frame = 0; frame < WINGS_FLUTTER_FRAME_COUNT; frame++) {
      assets.push({
        key: wingsFrameKey(facing, frame),
        draw: (ctx) => drawWings(ctx, facing, frame / WINGS_FLUTTER_FRAME_COUNT),
      });
    }
  }
  return assets;
}

/** Total frame count per layer across every facing - handy for both the
 * boot-progress bar and tests. */
export const TOTAL_FRAMES_PER_FACING = Object.values(ANIM_FRAME_COUNTS).reduce((sum, n) => sum + n, 0);
