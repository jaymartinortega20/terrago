/**
 * Maps the generator name strings used in client/assets/manifest.json to
 * the actual drawing functions, so the manifest loader never imports a
 * drawing module directly - it only knows generator *names*. Swapping a
 * generated asset for hand-drawn art later means deleting its manifest
 * entry (or pointing the loader at a static image instead); this registry
 * never needs to change for that.
 */
import {
  drawBushObstacleTile,
  drawFieldsDirtPatchTile,
  drawFieldsGrassTile,
  drawOakhavenFloorTile,
  drawOakhavenPathTile,
  drawRockObstacleTile,
  drawWaystoneTile,
} from './tiles.js';
import { drawItemIcon, drawPortraitFrame } from './ui.js';
import { drawIntroScroll1, drawIntroScroll2, drawIntroScroll3 } from './intro.js';

export type GeneratorFn = (ctx: CanvasRenderingContext2D, params: Record<string, unknown>) => void;

function asNumber(params: Record<string, unknown>, key: string, fallback = 0): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

function asString(params: Record<string, unknown>, key: string, fallback = ''): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

export const GENERATOR_REGISTRY: Record<string, GeneratorFn> = {
  oakhavenFloor: (ctx, p) => drawOakhavenFloorTile(ctx, asNumber(p, 'variant')),
  oakhavenPath: (ctx, p) => drawOakhavenPathTile(ctx, asNumber(p, 'variant')),
  fieldsGrass: (ctx, p) => drawFieldsGrassTile(ctx, asNumber(p, 'variant')),
  fieldsDirtPatch: (ctx, p) => drawFieldsDirtPatchTile(ctx, asNumber(p, 'variant')),
  rockObstacle: (ctx, p) => drawRockObstacleTile(ctx, asNumber(p, 'variant')),
  bushObstacle: (ctx, p) => drawBushObstacleTile(ctx, asNumber(p, 'variant')),
  waystone: (ctx, p) => drawWaystoneTile(ctx, asString(p, 'baseTile', 'oakhaven') === 'fields' ? 'fields' : 'oakhaven'),

  itemIcon: (ctx, p) => drawItemIcon(ctx, asString(p, 'itemId')),
  portraitFrame: (ctx, p) => drawPortraitFrame(ctx, asNumber(p, 'size', 96)),

  introScroll1: (ctx) => drawIntroScroll1(ctx),
  introScroll2: (ctx) => drawIntroScroll2(ctx),
  introScroll3: (ctx) => drawIntroScroll3(ctx),
};
