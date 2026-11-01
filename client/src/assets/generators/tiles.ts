/**
 * Procedural 48x48 tile textures (SPEC.md section 6: "richly saturated
 * tile maps", generated programmatically rather than grey boxes). Each
 * function draws into a caller-supplied 2D context sized TILE_SIZE_PX
 * square. `variant` seeds a local PRNG so the TileMapRenderer (world/) can
 * pick a few different-looking instances of the same tile type per
 * position, deterministically, without needing hand-authored variants.
 */
import { TILE_SIZE_PX } from '../../config.js';
import { createPrng, prngRange } from '../../util/prng.js';
import { OAKHAVEN_PALETTE, OBSTACLE_PALETTE, WAYSTONE_PALETTE, WHISPERING_FIELDS_PALETTE } from '../palette.js';

const SIZE = TILE_SIZE_PX;

export function drawOakhavenFloorTile(ctx: CanvasRenderingContext2D, variant: number): void {
  const rng = createPrng(variant + 1000);
  ctx.fillStyle = OAKHAVEN_PALETTE.floorBase;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Flagstone seams: a couple of soft lines dividing the tile into an
  // irregular stone pattern.
  ctx.strokeStyle = OAKHAVEN_PALETTE.floorShadow;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const seamY = prngRange(rng, SIZE * 0.3, SIZE * 0.7);
  ctx.moveTo(0, seamY);
  ctx.quadraticCurveTo(SIZE * 0.5, seamY + prngRange(rng, -6, 6), SIZE, seamY + prngRange(rng, -4, 4));
  ctx.stroke();

  // A few warm highlight speckles for texture.
  ctx.fillStyle = OAKHAVEN_PALETTE.floorHighlight;
  for (let i = 0; i < 5; i++) {
    const x = prngRange(rng, 2, SIZE - 2);
    const y = prngRange(rng, 2, SIZE - 2);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, prngRange(rng, 1, 2.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawOakhavenPathTile(ctx: CanvasRenderingContext2D, variant: number): void {
  const rng = createPrng(variant + 2000);
  ctx.fillStyle = OAKHAVEN_PALETTE.pathStone;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = OAKHAVEN_PALETTE.pathStoneShadow;
  for (let i = 0; i < 4; i++) {
    const x = prngRange(rng, 4, SIZE - 12);
    const y = prngRange(rng, 4, SIZE - 8);
    const w = prngRange(rng, 8, 14);
    const h = prngRange(rng, 5, 9);
    drawRoundedRect(ctx, x, y, w, h, 2);
    ctx.fill();
  }
}

export function drawFieldsGrassTile(ctx: CanvasRenderingContext2D, variant: number): void {
  const rng = createPrng(variant + 3000);
  ctx.fillStyle = WHISPERING_FIELDS_PALETTE.grassBase;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Darker undergrowth patches.
  ctx.fillStyle = WHISPERING_FIELDS_PALETTE.grassShadow;
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(prngRange(rng, 6, SIZE - 6), prngRange(rng, 6, SIZE - 6), prngRange(rng, 4, 8), prngRange(rng, 3, 5), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Tufts of brighter grass blades.
  ctx.strokeStyle = WHISPERING_FIELDS_PALETTE.grassHighlight;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const x = prngRange(rng, 3, SIZE - 3);
    const y = prngRange(rng, 3, SIZE - 3);
    const lean = prngRange(rng, -3, 3);
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x + lean, y - 4);
    ctx.stroke();
  }

  // Rare flower accent.
  if (rng() < 0.3) {
    const fx = prngRange(rng, 8, SIZE - 8);
    const fy = prngRange(rng, 8, SIZE - 8);
    ctx.fillStyle = rng() < 0.5 ? WHISPERING_FIELDS_PALETTE.flowerPink : WHISPERING_FIELDS_PALETTE.flowerWhite;
    for (let p = 0; p < 4; p++) {
      const angle = (p / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(angle) * 2.5, fy + Math.sin(angle) * 2.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawFieldsDirtPatchTile(ctx: CanvasRenderingContext2D, variant: number): void {
  const rng = createPrng(variant + 4000);
  ctx.fillStyle = WHISPERING_FIELDS_PALETTE.grassBase;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = WHISPERING_FIELDS_PALETTE.dirtPatch;
  ctx.beginPath();
  ctx.ellipse(SIZE / 2, SIZE / 2, prngRange(rng, 16, 20), prngRange(rng, 12, 16), 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A blocked tile: drawn as a mossy boulder cluster sitting on grass, used
 * wherever `collisionRows` marks a Whispering Fields tile impassable. */
export function drawRockObstacleTile(ctx: CanvasRenderingContext2D, variant: number): void {
  const rng = createPrng(variant + 5000);
  drawFieldsGrassTile(ctx, variant);

  const cx = SIZE / 2;
  const cy = SIZE / 2 + 4;
  ctx.fillStyle = OBSTACLE_PALETTE.rockShadow;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 10, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 3; i++) {
    const rx = cx + prngRange(rng, -10, 10);
    const ry = cy + prngRange(rng, -6, 6);
    const r = prngRange(rng, 7, 12);
    ctx.fillStyle = OBSTACLE_PALETTE.rockBase;
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = OBSTACLE_PALETTE.rockHighlight;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(rx - r * 0.3, ry - r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** Alternate obstacle look: a dense bush, for visual variety against the
 * rock cluster on the same impassable-tile role. */
export function drawBushObstacleTile(ctx: CanvasRenderingContext2D, variant: number): void {
  const rng = createPrng(variant + 6000);
  drawFieldsGrassTile(ctx, variant);

  const cx = SIZE / 2;
  const cy = SIZE / 2 + 2;
  for (let i = 0; i < 4; i++) {
    const bx = cx + prngRange(rng, -10, 10);
    const by = cy + prngRange(rng, -8, 8);
    const r = prngRange(rng, 8, 13);
    ctx.fillStyle = OBSTACLE_PALETTE.bushShadow;
    ctx.beginPath();
    ctx.arc(bx, by + 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = OBSTACLE_PALETTE.bushBase;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The map's one Waystone (SPEC.md section 6) - drawn oversized-looking
 * even on a single tile so it reads as a landmark, with a soft glow that
 * the renderer can additively pulse later. */
export function drawWaystoneTile(ctx: CanvasRenderingContext2D, baseTile: 'oakhaven' | 'fields'): void {
  if (baseTile === 'oakhaven') drawOakhavenFloorTile(ctx, 0);
  else drawFieldsGrassTile(ctx, 0);

  const cx = SIZE / 2;
  const cy = SIZE / 2;

  ctx.fillStyle = WAYSTONE_PALETTE.glow;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(cx, cy, SIZE * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = WAYSTONE_PALETTE.stoneShadow;
  drawRoundedRect(ctx, cx - 7, cy - 2, 14, 16, 2);
  ctx.fill();
  ctx.fillStyle = WAYSTONE_PALETTE.stone;
  drawRoundedRect(ctx, cx - 6, cy - 16, 12, 16, 3);
  ctx.fill();

  ctx.strokeStyle = WAYSTONE_PALETTE.glow;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 13);
  ctx.lineTo(cx, cy - 1);
  ctx.moveTo(cx - 3, cy - 9);
  ctx.lineTo(cx + 3, cy - 9);
  ctx.stroke();
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
