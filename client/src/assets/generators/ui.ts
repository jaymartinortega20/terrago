/**
 * Procedural icons for the HUD (hotbar slots, inventory grid) - small
 * pictograms, not the paper-doll rig. SPEC.md section 11's rarity border
 * glow is drawn by the HUD's CSS (per-item `border-color`), not baked
 * into these icons, so a later swap to hand-drawn art only needs new
 * square images, no border logic to port.
 */
import { createPrng, prngRange } from '../../util/prng.js';
import { WEAPON_HILT, WEAPON_METAL, WEAPON_METAL_SHADOW } from '../palette.js';

export const ICON_SIZE_PX = 40;

function clear(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ICON_SIZE_PX, ICON_SIZE_PX);
}

const CENTER = ICON_SIZE_PX / 2;

export function drawSwordIcon(ctx: CanvasRenderingContext2D): void {
  clear(ctx);
  ctx.save();
  ctx.translate(CENTER, CENTER);
  ctx.rotate((45 * Math.PI) / 180);

  ctx.fillStyle = WEAPON_METAL_SHADOW;
  ctx.fillRect(-3, -16, 6, 24);
  ctx.fillStyle = WEAPON_METAL;
  ctx.fillRect(-2, -16, 4, 22);
  ctx.beginPath();
  ctx.moveTo(-2, -16);
  ctx.lineTo(0, -20);
  ctx.lineTo(2, -16);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = WEAPON_HILT;
  ctx.fillRect(-5, 6, 10, 3);
  ctx.fillRect(-2, 9, 4, 7);
  ctx.restore();
}

export function drawPotionIcon(ctx: CanvasRenderingContext2D, liquidColor = '#e34a4a'): void {
  clear(ctx);
  ctx.fillStyle = '#c9ccd4';
  ctx.fillRect(CENTER - 2, 8, 4, 5);
  ctx.beginPath();
  ctx.moveTo(CENTER - 7, 16);
  ctx.quadraticCurveTo(CENTER - 9, 20, CENTER - 8, 26);
  ctx.quadraticCurveTo(CENTER - 7, 32, CENTER, 32);
  ctx.quadraticCurveTo(CENTER + 7, 32, CENTER + 8, 26);
  ctx.quadraticCurveTo(CENTER + 9, 20, CENTER + 7, 16);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.fillStyle = liquidColor;
  ctx.beginPath();
  ctx.moveTo(CENTER - 7.5, 22);
  ctx.quadraticCurveTo(CENTER - 8.5, 26, CENTER - 7, 29);
  ctx.quadraticCurveTo(CENTER, 32, CENTER + 7, 29);
  ctx.quadraticCurveTo(CENTER + 8.5, 26, CENTER + 7.5, 22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8d9099';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(CENTER - 7, 16);
  ctx.quadraticCurveTo(CENTER - 9, 20, CENTER - 8, 26);
  ctx.quadraticCurveTo(CENTER - 7, 32, CENTER, 32);
  ctx.quadraticCurveTo(CENTER + 7, 32, CENTER + 8, 26);
  ctx.quadraticCurveTo(CENTER + 9, 20, CENTER + 7, 16);
  ctx.stroke();
}

/** A raw, gooey material drop - used for Slime Gel and any future kill/
 * gather quest material that doesn't warrant its own bespoke icon. */
export function drawMaterialBlobIcon(ctx: CanvasRenderingContext2D, color: string, seed = 0): void {
  clear(ctx);
  const rng = createPrng(seed + 7000);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(CENTER, 8);
  for (let i = 0; i <= 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = prngRange(rng, 10, 14);
    ctx.lineTo(CENTER + Math.cos(angle) * r, CENTER + 2 + Math.sin(angle) * r * 0.9);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(CENTER - 4, CENTER - 3, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawHelmetIcon(ctx: CanvasRenderingContext2D, color: string): void {
  clear(ctx);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER + 2, 12, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(CENTER - 13, CENTER, 26, 4);
}

export function drawChestIcon(ctx: CanvasRenderingContext2D, color: string): void {
  clear(ctx);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(CENTER - 10, 10);
  ctx.lineTo(CENTER + 10, 10);
  ctx.lineTo(CENTER + 8, 30);
  ctx.lineTo(CENTER - 8, 30);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(CENTER - 2, 8, 4, 6);
}

export function drawBootsIcon(ctx: CanvasRenderingContext2D, color: string): void {
  clear(ctx);
  ctx.fillStyle = color;
  for (const dx of [-6, 6]) {
    ctx.beginPath();
    ctx.moveTo(CENTER + dx - 3, 12);
    ctx.lineTo(CENTER + dx + 3, 12);
    ctx.lineTo(CENTER + dx + 3, 26);
    ctx.lineTo(CENTER + dx + 6, 30);
    ctx.lineTo(CENTER + dx - 3, 30);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawWingsIcon(ctx: CanvasRenderingContext2D, color: string): void {
  clear(ctx);
  ctx.fillStyle = color;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CENTER, CENTER);
    ctx.quadraticCurveTo(CENTER + dir * 16, CENTER - 10, CENTER + dir * 14, CENTER + 6);
    ctx.quadraticCurveTo(CENTER + dir * 6, CENTER + 10, CENTER, CENTER);
    ctx.closePath();
    ctx.fill();
  }
}

/** A plain fallback glyph for any item id this generator doesn't
 * recognize yet - never leaves a hotbar/inventory slot blank. */
export function drawGenericItemIcon(ctx: CanvasRenderingContext2D): void {
  clear(ctx);
  ctx.strokeStyle = '#9aa0ab';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, ICON_SIZE_PX - 20, ICON_SIZE_PX - 20);
  ctx.beginPath();
  ctx.moveTo(10, 10);
  ctx.lineTo(ICON_SIZE_PX - 10, ICON_SIZE_PX - 10);
  ctx.stroke();
}

/** The circular frame drawn around the status block's live character
 * portrait (SPEC.md section 7). */
export function drawPortraitFrame(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);
  const r = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
  ctx.stroke();
}

/** Dispatches an item id to its icon drawer, with the generic glyph as a
 * safe fallback for any item added before art is (SPEC.md section 6:
 * placeholder art must be swappable with no code changes - new item ids
 * just fall back gracefully rather than erroring). */
export function drawItemIcon(ctx: CanvasRenderingContext2D, itemId: string): void {
  switch (itemId) {
    case 'recruit_training_sword':
      drawSwordIcon(ctx);
      return;
    case 'potion_hp_small':
      drawPotionIcon(ctx, '#e34a4a');
      return;
    case 'slime_gel':
      drawMaterialBlobIcon(ctx, '#7fd94a', 1);
      return;
    case 'recruit_cloth_cap':
      drawHelmetIcon(ctx, '#8a6a4a');
      return;
    case 'recruit_cloth_vest':
      drawChestIcon(ctx, '#7a5a9a');
      return;
    case 'recruit_leather_boots':
      drawBootsIcon(ctx, '#5a4433');
      return;
    case 'tattered_wings':
      drawWingsIcon(ctx, 'rgba(230,220,255,0.85)');
      return;
    default:
      drawGenericItemIcon(ctx);
  }
}
