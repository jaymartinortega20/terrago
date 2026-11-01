/**
 * Atmospheric placeholder illustrations for the three story scrolls
 * (SPEC.md section 4): "layered gradients, silhouettes of floating islands
 * and cracked crystals, drifting particles". Generated oversized relative
 * to the viewport IntroScene actually shows, so its slow Ken Burns pan/zoom
 * has room to move without ever revealing a canvas edge.
 */
import { createPrng, prngRange } from '../../util/prng.js';

export const INTRO_BG_WIDTH = 1280;
export const INTRO_BG_HEIGHT = 800;

function sky(ctx: CanvasRenderingContext2D, stops: Array<[number, string]>): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, INTRO_BG_HEIGHT);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, INTRO_BG_WIDTH, INTRO_BG_HEIGHT);
}

function stars(ctx: CanvasRenderingContext2D, rng: () => number, count: number, maxY: number): void {
  for (let i = 0; i < count; i++) {
    const x = prngRange(rng, 0, INTRO_BG_WIDTH);
    const y = prngRange(rng, 0, maxY);
    const r = prngRange(rng, 0.5, 1.8);
    ctx.globalAlpha = prngRange(rng, 0.3, 0.9);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function floatingIsland(ctx: CanvasRenderingContext2D, rng: () => number, cx: number, cy: number, scale: number): void {
  const w = 90 * scale;
  const h = 26 * scale;
  ctx.fillStyle = 'rgba(20, 16, 40, 0.75)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
  ctx.fill();
  // Jagged underside dripping down - the "shattered rock still clinging to its island" look.
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.6, cy + h * 0.5);
  const spikes = 5;
  for (let i = 0; i <= spikes; i++) {
    const x = cx - w * 0.6 + (w * 1.2 * i) / spikes;
    const y = cy + h * 0.5 + prngRange(rng, h * 0.4, h * 1.6);
    ctx.lineTo(x, y);
    ctx.lineTo(x + (w * 1.2) / spikes / 2, cy + h * 0.5);
  }
  ctx.closePath();
  ctx.fill();
  // A thin crystal spire on top, implying the Aetherite temples.
  ctx.fillStyle = 'rgba(150, 190, 255, 0.5)';
  ctx.beginPath();
  ctx.moveTo(cx - 3 * scale, cy - h * 0.4);
  ctx.lineTo(cx, cy - h * 0.4 - 18 * scale);
  ctx.lineTo(cx + 3 * scale, cy - h * 0.4);
  ctx.closePath();
  ctx.fill();
}

function drifting(ctx: CanvasRenderingContext2D, rng: () => number, count: number, color: string): void {
  for (let i = 0; i < count; i++) {
    const x = prngRange(rng, 0, INTRO_BG_WIDTH);
    const y = prngRange(rng, 0, INTRO_BG_HEIGHT);
    const r = prngRange(rng, 1, 3);
    ctx.globalAlpha = prngRange(rng, 0.2, 0.6);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Scroll 1: "a thousand generations... suspended in a sea of clouds" -
 * calm, balanced, a cluster of island-temples adrift in a dawn-blue sky. */
export function drawIntroScroll1(ctx: CanvasRenderingContext2D): void {
  const rng = createPrng(101);
  sky(ctx, [
    [0, '#0d1b3a'],
    [0.45, '#1f3a6b'],
    [0.75, '#4a6fa0'],
    [1, '#7fa0c2'],
  ]);
  stars(ctx, rng, 90, INTRO_BG_HEIGHT * 0.4);

  // A sea of clouds along the lower third.
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 10; i++) {
    const x = prngRange(rng, 0, INTRO_BG_WIDTH);
    const y = prngRange(rng, INTRO_BG_HEIGHT * 0.7, INTRO_BG_HEIGHT * 0.95);
    ctx.beginPath();
    ctx.ellipse(x, y, prngRange(rng, 80, 160), prngRange(rng, 16, 30), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  floatingIsland(ctx, rng, 420, 300, 1.4);
  floatingIsland(ctx, rng, 850, 420, 1.1);
  floatingIsland(ctx, rng, 1050, 230, 0.8);
  floatingIsland(ctx, rng, 180, 480, 0.7);

  drifting(ctx, rng, 40, 'rgba(200, 220, 255, 0.6)');
}

/** Scroll 2: "The Fracture... a violent surge... shattering the
 * crystals... darkness spilled". Jagged lightning through a broken sky,
 * cracked crystal shards, a much darker palette. */
export function drawIntroScroll2(ctx: CanvasRenderingContext2D): void {
  const rng = createPrng(202);
  sky(ctx, [
    [0, '#05030a'],
    [0.5, '#1a0e24'],
    [1, '#330f1a'],
  ]);
  stars(ctx, rng, 40, INTRO_BG_HEIGHT * 0.3);

  // Jagged energy surge lines.
  for (let i = 0; i < 5; i++) {
    const startX = prngRange(rng, 100, INTRO_BG_WIDTH - 100);
    ctx.strokeStyle = `rgba(180, 140, 255, ${prngRange(rng, 0.3, 0.7)})`;
    ctx.lineWidth = prngRange(rng, 1.5, 3);
    ctx.beginPath();
    let x = startX;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < INTRO_BG_HEIGHT) {
      x += prngRange(rng, -60, 60);
      y += prngRange(rng, 40, 90);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Shattered floating islands, broken apart compared to scroll 1.
  floatingIsland(ctx, rng, 300, 250, 1.2);
  floatingIsland(ctx, rng, 700, 180, 0.6);
  // Drifting crystal shards - small bright triangles.
  for (let i = 0; i < 14; i++) {
    const x = prngRange(rng, 0, INTRO_BG_WIDTH);
    const y = prngRange(rng, 0, INTRO_BG_HEIGHT);
    const s = prngRange(rng, 5, 16);
    ctx.fillStyle = `rgba(150, 200, 255, ${prngRange(rng, 0.3, 0.7)})`;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.4, y + s * 0.5);
    ctx.lineTo(x - s * 0.4, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  // Darkness spilling up from the bottom.
  const gradient = ctx.createLinearGradient(0, INTRO_BG_HEIGHT * 0.6, 0, INTRO_BG_HEIGHT);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(10,0,5,0.85)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, INTRO_BG_WIDTH, INTRO_BG_HEIGHT);
}

/** Scroll 3: "You awake... in Oakhaven Sanctuary, the last standing safe
 * haven". Warmer again than scroll 2, but dimmer than scroll 1 - hope
 * inside a threatened world, town lanterns glowing below a bruised sky. */
export function drawIntroScroll3(ctx: CanvasRenderingContext2D): void {
  const rng = createPrng(303);
  sky(ctx, [
    [0, '#1a1430'],
    [0.5, '#4a3450'],
    [0.8, '#a8724a'],
    [1, '#e0a05a'],
  ]);
  stars(ctx, rng, 30, INTRO_BG_HEIGHT * 0.25);

  floatingIsland(ctx, rng, 950, 180, 0.6);

  // Town silhouette along the bottom: simple rooftops and a tower.
  ctx.fillStyle = 'rgba(15, 10, 20, 0.9)';
  ctx.beginPath();
  ctx.moveTo(0, INTRO_BG_HEIGHT);
  let x = 0;
  const roofRng = rng;
  while (x < INTRO_BG_WIDTH) {
    const w = prngRange(roofRng, 60, 140);
    const h = prngRange(roofRng, 60, 160);
    ctx.lineTo(x, INTRO_BG_HEIGHT - h);
    ctx.lineTo(x + w * 0.5, INTRO_BG_HEIGHT - h - 30);
    ctx.lineTo(x + w, INTRO_BG_HEIGHT - h);
    x += w;
  }
  ctx.lineTo(INTRO_BG_WIDTH, INTRO_BG_HEIGHT);
  ctx.closePath();
  ctx.fill();

  // Warm window/lantern glow points.
  for (let i = 0; i < 16; i++) {
    const wx = prngRange(rng, 0, INTRO_BG_WIDTH);
    const wy = prngRange(rng, INTRO_BG_HEIGHT * 0.78, INTRO_BG_HEIGHT * 0.96);
    ctx.fillStyle = 'rgba(255, 210, 120, 0.85)';
    ctx.beginPath();
    ctx.arc(wx, wy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drifting(ctx, rng, 20, 'rgba(255, 230, 180, 0.5)');
}
