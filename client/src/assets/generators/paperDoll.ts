/**
 * Draws one paper-doll layer (SPEC.md section 6: "wings, body, boots,
 * chest piece, head, hair, helmet, weapon") into a 64x64 canvas for one
 * (facing, pose) combination. "right" is never generated here - SPEC.md
 * says it's "mirrored left", so world/PaperDollSprite.ts (task #80) just
 * flips the 'left' textures with Phaser's `setFlipX` instead of doubling
 * every texture.
 *
 * Every layer shares the same anchor points (head center, torso center,
 * limb pivots) so they stay visually registered when assembled together;
 * `pose` (see pose.ts) is the only thing that varies frame to frame.
 *
 * Z-ordering between layers ("the weapon renders behind the body when
 * facing up, and wings always render behind the body") is NOT this
 * module's job - that's about which Phaser depth each layer's GameObject
 * gets per facing, decided where the layers are assembled (task #80).
 * This module only draws each layer's own shape correctly for its facing.
 */
import { SPRITE_FRAME_SIZE_PX } from '../../config.js';
import {
  BLUSH,
  BODY_COLOR,
  BODY_SHADOW,
  BOOTS_COLOR,
  CHEST_COLOR,
  EYE_COLOR,
  HAIR_COLOR,
  HAIR_SHADOW,
  HELMET_COLOR,
  OUTLINE,
  SKIN_SHADOW,
  SKIN_TONE,
  WEAPON_HILT,
  WEAPON_METAL,
  WEAPON_METAL_SHADOW,
  WINGS_COLOR,
  WINGS_EDGE,
} from '../palette.js';
import type { Pose } from './pose.js';

export type PaperDollFacing = 'down' | 'up' | 'left';

const SIZE = SPRITE_FRAME_SIZE_PX;
const CENTER_X = SIZE / 2;

/** Shared anchor points every layer draws relative to, offset by the
 * pose's bob/tilt/scale so every layer moves together. */
interface Anchors {
  headX: number;
  headY: number;
  headR: number;
  torsoTopY: number;
  torsoBottomY: number;
  torsoHalfWidth: number;
  hipY: number;
  footY: number;
}

function computeAnchors(pose: Pose): Anchors {
  const bob = pose.headBobY + pose.bodyOffsetY;
  const headR = 13 * Math.min(1, pose.bodyScaleY + 0.15);
  return {
    headX: CENTER_X,
    headY: 23 + bob,
    headR,
    torsoTopY: 34 + bob * pose.bodyScaleY,
    torsoBottomY: 50 + bob * pose.bodyScaleY,
    torsoHalfWidth: 9,
    hipY: 50 + bob,
    footY: 60 + bob,
  };
}

function withTiltAndOpacity(ctx: CanvasRenderingContext2D, pose: Pose, pivotX: number, pivotY: number, draw: () => void): void {
  ctx.save();
  ctx.globalAlpha = pose.opacity;
  ctx.translate(pivotX, pivotY);
  ctx.rotate((pose.bodyTiltDeg * Math.PI) / 180);
  ctx.translate(-pivotX, -pivotY);
  draw();
  ctx.restore();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// --------------------------------------------------------------- body

/** Torso + limbs. The oversized head is its own "head" layer. */
export function drawBody(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose): void {
  const a = computeAnchors(pose);
  withTiltAndOpacity(ctx, pose, CENTER_X, a.hipY, () => {
    drawLegs(ctx, facing, pose, a);
    drawTorso(ctx, facing, a);
    drawArms(ctx, facing, pose, a);
  });
}

function drawTorso(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, a: Anchors): void {
  const halfW = facing === 'left' ? a.torsoHalfWidth * 0.75 : a.torsoHalfWidth;
  const x = facing === 'left' ? CENTER_X - 1 : CENTER_X;
  ctx.fillStyle = BODY_SHADOW;
  roundedBody(ctx, x, a.torsoTopY + 1, halfW, a.torsoBottomY - a.torsoTopY);
  ctx.fillStyle = BODY_COLOR;
  roundedBody(ctx, x, a.torsoTopY, halfW, a.torsoBottomY - a.torsoTopY - 1);
}

function roundedBody(ctx: CanvasRenderingContext2D, cx: number, top: number, halfW: number, height: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.7, top);
  ctx.quadraticCurveTo(cx - halfW, top + height * 0.3, cx - halfW, top + height * 0.7);
  ctx.quadraticCurveTo(cx - halfW, top + height, cx, top + height);
  ctx.quadraticCurveTo(cx + halfW, top + height, cx + halfW, top + height * 0.7);
  ctx.quadraticCurveTo(cx + halfW, top + height * 0.3, cx + halfW * 0.7, top);
  ctx.closePath();
  ctx.fill();
}

function drawArms(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose, a: Anchors): void {
  const shoulderY = a.torsoTopY + 3;
  const armLen = 13;
  if (facing === 'left') {
    // Profile: only the far (left-rendered) arm reads clearly.
    drawLimb(ctx, CENTER_X - 2, shoulderY, armLen, pose.armSwingR, 3, SKIN_TONE, SKIN_SHADOW);
    return;
  }
  drawLimb(ctx, CENTER_X - a.torsoHalfWidth + 1, shoulderY, armLen, pose.armSwingL, 3, SKIN_TONE, SKIN_SHADOW);
  drawLimb(ctx, CENTER_X + a.torsoHalfWidth - 1, shoulderY, armLen, -pose.armSwingR, 3, SKIN_TONE, SKIN_SHADOW);
}

function drawLegs(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose, a: Anchors): void {
  const legLen = 10;
  if (facing === 'left') {
    drawLimb(ctx, CENTER_X, a.hipY, legLen, pose.legSwingL, 3.5, BODY_SHADOW, OUTLINE);
    return;
  }
  drawLimb(ctx, CENTER_X - 4, a.hipY, legLen, pose.legSwingL, 3.5, BODY_SHADOW, OUTLINE);
  drawLimb(ctx, CENTER_X + 4, a.hipY, legLen, -pose.legSwingR, 3.5, BODY_SHADOW, OUTLINE);
}

/** A simple pivoted capsule - the shared building block for arms and legs,
 * swinging `angleDeg` forward/back from straight down. */
function drawLimb(
  ctx: CanvasRenderingContext2D,
  pivotX: number,
  pivotY: number,
  length: number,
  angleDeg: number,
  thickness: number,
  color: string,
  shadow: string
): void {
  const rad = (angleDeg * Math.PI) / 180;
  const endX = pivotX + Math.sin(rad) * length;
  const endY = pivotY + Math.cos(rad) * length;
  ctx.strokeStyle = shadow;
  ctx.lineWidth = thickness + 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

// --------------------------------------------------------------- head

export function drawHead(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose): void {
  const a = computeAnchors(pose);
  withTiltAndOpacity(ctx, pose, a.headX, a.headY, () => {
    ellipse(ctx, a.headX, a.headY + 1, a.headR, a.headR * 0.95, SKIN_SHADOW);
    ellipse(ctx, a.headX, a.headY, a.headR, a.headR * 0.95, SKIN_TONE);

    if (facing === 'up') return; // back of the head: no face, just skull silhouette + hair on top

    const eyeY = a.headY + 1;
    if (facing === 'left') {
      drawEye(ctx, a.headX - 4, eyeY);
      ellipse(ctx, a.headX - a.headR + 2, eyeY + 3, 1.2, 0.8, SKIN_SHADOW); // nose hint
      return;
    }

    // down: full face
    drawEye(ctx, a.headX - 4.5, eyeY);
    drawEye(ctx, a.headX + 4.5, eyeY);
    ellipse(ctx, a.headX - 6, a.headY + 6, 2, 1.3, BLUSH);
    ellipse(ctx, a.headX + 6, a.headY + 6, 2, 1.3, BLUSH);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(a.headX, a.headY + 5, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  });
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ellipse(ctx, x, y, 1.6, 2.2, EYE_COLOR);
  ellipse(ctx, x - 0.5, y - 0.6, 0.6, 0.6, '#ffffff');
}

// --------------------------------------------------------------- hair

export function drawHair(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose): void {
  const a = computeAnchors(pose);
  withTiltAndOpacity(ctx, pose, a.headX, a.headY, () => {
    ctx.fillStyle = HAIR_SHADOW;
    ctx.beginPath();
    ctx.arc(a.headX, a.headY - 2, a.headR + 1.5, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HAIR_COLOR;
    ctx.beginPath();
    ctx.arc(a.headX, a.headY - 3, a.headR + 1, Math.PI, Math.PI * 2);
    ctx.fill();

    if (facing === 'up') {
      // Covers most of the back of the head.
      ctx.beginPath();
      ctx.ellipse(a.headX, a.headY, a.headR + 1, a.headR * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // A short fringe over the forehead.
    const fringeX = facing === 'left' ? a.headX - 3 : a.headX;
    ctx.beginPath();
    ctx.ellipse(fringeX, a.headY - a.headR * 0.55, a.headR * 0.75, a.headR * 0.35, 0, 0, Math.PI);
    ctx.fill();
  });
}

// --------------------------------------------------------------- weapon

/** The Recruit's basic sword. Held in the right hand; swings with
 * `pose.weaponSwingDeg` on top of the arm's own swing. */
export function drawWeapon(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose): void {
  const a = computeAnchors(pose);
  const shoulderY = a.torsoTopY + 3;
  const handX = facing === 'left' ? CENTER_X - 2 : CENTER_X + a.torsoHalfWidth - 1;
  const armAngle = facing === 'left' ? pose.armSwingR : -pose.armSwingR;
  const rad = (armAngle * Math.PI) / 180;
  const armLen = 13;
  const gripX = handX + Math.sin(rad) * armLen;
  const gripY = shoulderY + Math.cos(rad) * armLen;

  withTiltAndOpacity(ctx, pose, gripX, gripY, () => {
    ctx.save();
    ctx.translate(gripX, gripY);
    ctx.rotate(((armAngle + pose.weaponSwingDeg + 20) * Math.PI) / 180);

    ctx.fillStyle = WEAPON_HILT;
    ctx.fillRect(-1.5, 0, 3, 5);
    ctx.fillStyle = WEAPON_METAL_SHADOW;
    ctx.fillRect(-1.8, -14, 3.6, 14);
    ctx.fillStyle = WEAPON_METAL;
    ctx.fillRect(-1.2, -14, 2.4, 13);
    ctx.beginPath();
    ctx.moveTo(-1.2, -14);
    ctx.lineTo(0, -17);
    ctx.lineTo(1.2, -14);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  });
}

// --------------------------------------------------------------- armor

export function drawHelmet(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose): void {
  const a = computeAnchors(pose);
  withTiltAndOpacity(ctx, pose, a.headX, a.headY, () => {
    ctx.fillStyle = HELMET_COLOR;
    ctx.beginPath();
    ctx.arc(a.headX, a.headY - 2, a.headR + 2, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    if (facing !== 'up') {
      ctx.fillRect(a.headX - a.headR - 1, a.headY - 4, (a.headR + 1) * 2, 3);
    }
  });
}

export function drawChest(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose): void {
  const a = computeAnchors(pose);
  const halfW = (facing === 'left' ? a.torsoHalfWidth * 0.75 : a.torsoHalfWidth) + 1;
  withTiltAndOpacity(ctx, pose, CENTER_X, a.hipY, () => {
    ctx.fillStyle = CHEST_COLOR;
    roundedBody(ctx, CENTER_X, a.torsoTopY - 1, halfW, (a.torsoBottomY - a.torsoTopY) * 0.75);
  });
}

export function drawBoots(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: Pose): void {
  const a = computeAnchors(pose);
  withTiltAndOpacity(ctx, pose, CENTER_X, a.footY, () => {
    const footPositions = facing === 'left' ? [0] : [-4, 4];
    for (const dx of footPositions) {
      ctx.fillStyle = BOOTS_COLOR;
      ellipse(ctx, CENTER_X + dx, a.footY, 3, 2.2, BOOTS_COLOR);
    }
  });
}

// --------------------------------------------------------------- wings

/** Flutters on its own loop independent of the body animation (SPEC.md
 * section 6) - callers pass a flutter phase in [0, 1), not the body's
 * Pose, since wings never follow the equipped character's current anim. */
export function drawWings(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, flutterPhase: number): void {
  const flap = Math.sin(flutterPhase * Math.PI * 2) * 6;
  const baseX = CENTER_X;
  const baseY = 38;
  const side = facing === 'left' ? [1] : [-1, 1];

  for (const dir of side) {
    ctx.save();
    ctx.translate(baseX + dir * 6, baseY);
    ctx.rotate(((dir * (12 + flap)) * Math.PI) / 180);
    ctx.fillStyle = WINGS_COLOR;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dir * 16, -10, dir * 14, 4);
    ctx.quadraticCurveTo(dir * 8, 10, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WINGS_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
