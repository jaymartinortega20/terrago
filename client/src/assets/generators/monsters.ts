/**
 * Monster sprites. M1 has exactly one monster (Slime), which - unlike the
 * player's layered paper-doll - is simple enough to draw as a single
 * shape with no facing variants (round, no face direction to speak of)
 * and no layering. Reuses pose.ts's ANIM_FRAME_COUNTS so monster
 * animations register and play through the exact same Phaser animation
 * machinery as the paper-doll (see paperDollAnims.ts / monsterManifest.ts),
 * just with its own much simpler pose math.
 */
import { SPRITE_FRAME_SIZE_PX } from '../../config.js';
import type { AnimName } from './pose.js';
import { SLIME_BASE, SLIME_EYE, SLIME_HIGHLIGHT, SLIME_SHADOW } from '../palette.js';

const SIZE = SPRITE_FRAME_SIZE_PX;
const CENTER_X = SIZE / 2;
/** Base body center/radii, chosen so the body's bottom edge (BASE_CENTER_Y
 * + BASE_RY) lands at ~60/64 - the same foot-anchor ratio EntityView uses
 * for the player paper-doll, so both sprite families share one origin
 * convention. */
const BASE_CENTER_Y = 46;
const BASE_RX = 15;
const BASE_RY = 13;

export interface SlimePose {
  scaleX: number;
  scaleY: number;
  offsetY: number;
  opacity: number;
  /** 0..1 intensity of a white hit-flash overlay, used only by 'hurt'. */
  flash: number;
}

const NEUTRAL: SlimePose = { scaleX: 1, scaleY: 1, offsetY: 0, opacity: 1, flash: 0 };

function cyclicPhase(frame: number, frameCount: number): number {
  return frameCount > 0 ? frame / frameCount : 0;
}

function linearPhase(frame: number, frameCount: number): number {
  return frameCount > 1 ? frame / (frameCount - 1) : 0;
}

/**
 * `anim` is typed as the full AnimName (including 'mounted') purely so
 * this stays a total function callable from monsterManifest.ts's generic
 * (AnimName) => void drawer signature - monsters never actually reach
 * 'mounted' (MONSTER_ANIMS filters it out before any frame is generated).
 */
export function computeSlimePose(anim: AnimName, frame: number, frameCount: number): SlimePose {
  switch (anim) {
    case 'idle': {
      const squash = Math.sin(cyclicPhase(frame, frameCount) * Math.PI * 2) * 0.06;
      return { ...NEUTRAL, scaleY: 1 + squash, scaleX: 1 - squash * 0.6, offsetY: -squash * 6 };
    }
    case 'walk': {
      const phase = cyclicPhase(frame, frameCount);
      const hop = Math.abs(Math.sin(phase * Math.PI));
      const landing = 1 - hop;
      return { ...NEUTRAL, scaleY: 1 + hop * 0.15 - landing * 0.1, scaleX: 1 - hop * 0.08 + landing * 0.08, offsetY: -hop * 10 };
    }
    case 'attack': {
      const t = linearPhase(frame, frameCount);
      const bulge = Math.sin(t * Math.PI) * 0.25;
      return { ...NEUTRAL, scaleX: 1 + bulge, scaleY: 1 - bulge * 0.4, offsetY: bulge * -2 };
    }
    case 'cast': {
      const t = cyclicPhase(frame, frameCount);
      const pulse = Math.sin(t * Math.PI * 2) * 0.08;
      return { ...NEUTRAL, scaleX: 1 - pulse * 0.4, scaleY: 1 + pulse, opacity: 0.85 + pulse * 0.5, offsetY: -pulse * 4 };
    }
    case 'hurt': {
      const t = linearPhase(frame, frameCount);
      return { ...NEUTRAL, scaleX: 1 + 0.12 * (1 - t), scaleY: 1 - 0.18 * (1 - t), flash: 1 - t };
    }
    case 'death': {
      const t = linearPhase(frame, frameCount);
      return { scaleX: 1 + t * 0.5, scaleY: 1 - t * 0.82, offsetY: t * 10, opacity: 1 - t * 0.65, flash: 0 };
    }
    case 'wakeUp': {
      const t = linearPhase(frame, frameCount);
      // Exact mirror of death's end state (t=1) back to neutral (t=0).
      return { scaleX: 1.5 - t * 0.5, scaleY: 0.18 + t * 0.82, offsetY: 10 - t * 10, opacity: 0.35 + t * 0.65, flash: 0 };
    }
    default:
      return NEUTRAL;
  }
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawSlimeFrame(ctx: CanvasRenderingContext2D, pose: SlimePose): void {
  const cy = BASE_CENTER_Y + pose.offsetY;
  const rx = BASE_RX * pose.scaleX;
  const ry = BASE_RY * pose.scaleY;

  ctx.save();
  ctx.globalAlpha = pose.opacity;

  // Grounding shadow, fixed on the floor regardless of the body's pose.
  ellipse(ctx, CENTER_X, 59, BASE_RX * 0.75, 4, 'rgba(0,0,0,0.25)');

  ellipse(ctx, CENTER_X, cy + 2, rx, ry, SLIME_SHADOW);
  ellipse(ctx, CENTER_X, cy, rx, ry * 0.92, SLIME_BASE);
  ellipse(ctx, CENTER_X - rx * 0.35, cy - ry * 0.45, rx * 0.32, ry * 0.22, SLIME_HIGHLIGHT);

  if (pose.flash > 0) {
    ctx.globalAlpha = pose.opacity * pose.flash * 0.6;
    ellipse(ctx, CENTER_X, cy, rx, ry * 0.92, '#ffffff');
    ctx.globalAlpha = pose.opacity;
  }

  const eyeY = cy - ry * 0.15;
  ellipse(ctx, CENTER_X - rx * 0.3, eyeY, 1.6, 1.6, SLIME_EYE);
  ellipse(ctx, CENTER_X + rx * 0.3, eyeY, 1.6, 1.6, SLIME_EYE);

  ctx.restore();
}
