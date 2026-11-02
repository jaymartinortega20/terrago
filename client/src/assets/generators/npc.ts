/**
 * Static chibi portraits for stationary world NPCs (SPEC.md section 6:
 * "chibi style... good enough to judge game feel, not grey boxes"). Found
 * missing during a visual pass: WorldScene.ts's renderNpcMarkers() drew a
 * flat solid-color circle with a text label and nothing else - no chibi
 * art at all, the single worst offender against that bar.
 *
 * Unlike the player's full paper-doll rig (per-facing frames, 8 animations,
 * swappable equipment layers - paperDoll.ts), NPCs never move, fight or
 * face a direction other than down: one static frame each is enough. This
 * deliberately borrows paperDoll.ts's proportions and shading technique
 * (oversized head, soft-shadow rounded torso via the same quadratic-curve
 * silhouette, the same eye/blush/mouth construction) rather than importing
 * its draw functions directly - those are keyed to the player's single
 * fixed palette (palette.ts's BODY_COLOR etc.), and reworking them to take
 * a per-call palette would be a bigger, riskier change to already-tested
 * code than three NPCs warrant. Keeping the same look "by eye" here means
 * NPCs read as the same art style as the player, not a different one
 * mixed in.
 */
import { SPRITE_FRAME_SIZE_PX } from '../../config.js';
import { BLUSH, EYE_COLOR, NPC_PALETTES, OUTLINE, type NpcId } from '../palette.js';

const SIZE = SPRITE_FRAME_SIZE_PX;
const CENTER_X = SIZE / 2;
const HEAD_Y = 23;
const HEAD_R = 14;
const TORSO_TOP_Y = 35;
const TORSO_BOTTOM_Y = 52;
const TORSO_HALF_W = 10;
const FOOT_Y = 61;

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function roundedTorso(ctx: CanvasRenderingContext2D, cx: number, top: number, halfW: number, height: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.7, top);
  ctx.quadraticCurveTo(cx - halfW, top + height * 0.3, cx - halfW, top + height * 0.7);
  ctx.quadraticCurveTo(cx - halfW, top + height, cx, top + height);
  ctx.quadraticCurveTo(cx + halfW, top + height, cx + halfW, top + height * 0.7);
  ctx.quadraticCurveTo(cx + halfW, top + height * 0.3, cx + halfW * 0.7, top);
  ctx.closePath();
  ctx.fill();
}

function drawHairFor(ctx: CanvasRenderingContext2D, npcId: NpcId, hair: string, hairShadow: string): void {
  ctx.fillStyle = hairShadow;
  ctx.beginPath();
  ctx.arc(CENTER_X, HEAD_Y - 2, HEAD_R + 1.5, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(CENTER_X, HEAD_Y - 3, HEAD_R + 1, Math.PI, Math.PI * 2);
  ctx.fill();

  if (npcId === 'elder_fin') {
    // A long beard is the clearest silhouette read for "village elder".
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(CENTER_X - 6, HEAD_Y + 7);
    ctx.quadraticCurveTo(CENTER_X, HEAD_Y + 20, CENTER_X + 6, HEAD_Y + 7);
    ctx.quadraticCurveTo(CENTER_X, HEAD_Y + 13, CENTER_X - 6, HEAD_Y + 7);
    ctx.closePath();
    ctx.fill();
  } else if (npcId === 'blacksmith') {
    // A practical head-wrap instead of loose hair/fringe.
    ctx.fillStyle = hairShadow;
    ctx.fillRect(CENTER_X - HEAD_R - 1, HEAD_Y - 6, (HEAD_R + 1) * 2, 3);
  } else {
    // shopkeeper: a short fringe, same construction as the player's.
    ctx.beginPath();
    ctx.ellipse(CENTER_X, HEAD_Y - HEAD_R * 0.5, HEAD_R * 0.75, HEAD_R * 0.35, 0, 0, Math.PI);
    ctx.fill();
  }
}

export function drawNpcFrame(ctx: CanvasRenderingContext2D, npcId: NpcId): void {
  const p = NPC_PALETTES[npcId];
  ctx.clearRect(0, 0, SIZE, SIZE);

  ellipse(ctx, CENTER_X, FOOT_Y + 1, TORSO_HALF_W * 0.9, 3, 'rgba(0,0,0,0.25)'); // grounding shadow

  for (const dx of [-4, 4]) ellipse(ctx, CENTER_X + dx, FOOT_Y, 3, 2.2, p.robeShadow); // feet

  ctx.lineCap = 'round';
  for (const [dx, width, color] of [
    [-TORSO_HALF_W + 1, 4, p.skinShadow],
    [TORSO_HALF_W - 1, 4, p.skinShadow],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(CENTER_X + dx, TORSO_TOP_Y + 3);
    ctx.lineTo(CENTER_X + dx * 1.15, TORSO_TOP_Y + 14);
    ctx.stroke();
  }
  for (const dx of [-TORSO_HALF_W + 1, TORSO_HALF_W - 1]) {
    ctx.strokeStyle = p.skin;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CENTER_X + dx, TORSO_TOP_Y + 3);
    ctx.lineTo(CENTER_X + dx * 1.15, TORSO_TOP_Y + 13);
    ctx.stroke();
  }

  roundedTorso(ctx, CENTER_X, TORSO_TOP_Y + 1, TORSO_HALF_W, TORSO_BOTTOM_Y - TORSO_TOP_Y, p.robeShadow);
  roundedTorso(ctx, CENTER_X, TORSO_TOP_Y, TORSO_HALF_W, TORSO_BOTTOM_Y - TORSO_TOP_Y - 1, p.robe);
  ctx.fillStyle = p.accent;
  ctx.fillRect(CENTER_X - TORSO_HALF_W + 1, TORSO_BOTTOM_Y - 5, (TORSO_HALF_W - 1) * 2, 2.5); // belt/trim

  ellipse(ctx, CENTER_X, HEAD_Y + 1, HEAD_R, HEAD_R * 0.95, p.skinShadow);
  ellipse(ctx, CENTER_X, HEAD_Y, HEAD_R, HEAD_R * 0.95, p.skin);

  const eyeY = HEAD_Y + 1;
  for (const dx of [-4.5, 4.5]) {
    ellipse(ctx, CENTER_X + dx, eyeY, 1.6, 2.2, EYE_COLOR);
    ellipse(ctx, CENTER_X + dx - 0.5, eyeY - 0.6, 0.6, 0.6, '#ffffff');
  }
  ellipse(ctx, CENTER_X - 6, HEAD_Y + 6, 2, 1.3, BLUSH);
  ellipse(ctx, CENTER_X + 6, HEAD_Y + 6, 2, 1.3, BLUSH);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(CENTER_X, HEAD_Y + 5, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  drawHairFor(ctx, npcId, p.hair, p.hairShadow);
}
