import { EYE_COLORS, HAIR_COLORS, OUTFITS, SKIN_TONES, type Appearance, type Direction, type NpcAccessory } from '@terrago/shared';
import { OUTLINE, PixelBuffer, SHADOW, makeCanvas, shade } from './pixel';

/**
 * Procedural character sprites: 16x24 logical pixels per frame (32x48 on screen).
 * Sheet layout: rows = down, left, right, up; columns = stand, stepA, stepB,
 * action (arms up / reaching forward: attacking, casting, working), sit.
 */
export const CHAR_W = 16;
export const CHAR_H = 24;
export const CHAR_FRAMES_PER_DIR = 5;
/** Column of the action and sitting poses. */
export const FRAME_ACTION = 3;
export const FRAME_SIT = 4;
export const CHAR_DIR_ROWS: Direction[] = ['down', 'left', 'right', 'up'];

type Frame = 0 | 1 | 2 | 3 | 4;

interface Palette {
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  eye: string;
  shirt: string;
  shirtShade: string;
  pants: string;
  pantsShade: string;
  shoes: string;
  accent: string;
  robe: boolean;
}

function palette(a: Appearance): Palette {
  const skin = SKIN_TONES[a.skinTone] ?? SKIN_TONES[0];
  const hair = HAIR_COLORS[a.hairColor] ?? HAIR_COLORS[0];
  const outfit = OUTFITS[a.outfit] ?? OUTFITS[0]!;
  return {
    skin,
    skinShade: shade(skin, -0.16),
    hair,
    hairShade: shade(hair, -0.3),
    eye: EYE_COLORS[a.eyeColor] ?? EYE_COLORS[0],
    shirt: outfit.shirt,
    shirtShade: outfit.shirtShade,
    pants: outfit.pants,
    pantsShade: shade(outfit.pants, -0.25),
    shoes: outfit.shoes,
    accent: outfit.accent,
    robe: outfit.robe,
  };
}

export function drawCharacterFrame(a: Appearance, dir: Direction, frame: Frame, accessory?: NpcAccessory): PixelBuffer {
  const side = dir === 'left' || dir === 'right';
  let base = side ? drawSide(a, frame === 4 ? 0 : frame, accessory) : drawFrontBack(a, dir === 'up', frame === 4 ? 0 : frame, accessory);
  if (frame === 4) base = seated(base, a, side, dir === 'up');
  const buf = dir === 'right' ? base.mirrored() : base;
  buf.outline(OUTLINE);
  // Soft ground shadow under the feet.
  for (let y = 21; y < 24; y++)
    for (let x = 3; x < 13; x++) {
      const dx = (x - 7.5) / 5;
      const dy = (y - 22.5) / 1.6;
      if (dx * dx + dy * dy <= 1) buf.under(x, y, SHADOW);
    }
  return buf;
}

/** Sitting: the upper body drops 3px and the legs fold forward. */
function seated(stand: PixelBuffer, a: Appearance, side: boolean, back: boolean): PixelBuffer {
  const p = palette(a);
  const b = new PixelBuffer(CHAR_W, CHAR_H);
  for (let y = 0; y <= 17; y++) for (let x = 0; x < CHAR_W; x++) b.set(x, y + 3, stand.get(x, y));
  const leg = p.robe ? p.shirt : p.pants;
  const legShade = p.robe ? p.shirtShade : p.pantsShade;
  if (side) {
    b.rect(2, 20, 8, 2, leg).hline(2, 9, 21, legShade);
    b.rect(2, 22, 2, 1, legShade).rect(1, 23, 3, 1, p.shoes);
  } else {
    b.rect(5, 20, 6, 2, leg).vline(10, 20, 21, legShade).vline(7, 21, 21, legShade);
    if (!back) b.rect(5, 22, 2, 1, p.shoes).rect(9, 22, 2, 1, p.shoes);
  }
  return b;
}

function drawFrontBack(a: Appearance, back: boolean, frame: Frame, acc?: NpcAccessory): PixelBuffer {
  const p = palette(a);
  const b = new PixelBuffer(CHAR_W, CHAR_H);
  const narrow = a.bodyType === 'b';
  const tl = narrow ? 5 : 4; // torso left
  const tr = narrow ? 10 : 11; // torso right
  const lift = (leg: 0 | 1) => (frame === 1 && leg === 0) || (frame === 2 && leg === 1);
  const action = frame === 3;

  if (acc === 'cape' && back) b.rect(3, 11, 10, 10, '#8e2b3a').vline(12, 11, 20, '#6e1f2c');
  if (acc === 'cape' && !back) {
    b.vline(3, 11, 20, '#8e2b3a');
    b.vline(12, 11, 20, '#6e1f2c');
  }

  // Legs and shoes
  if (p.robe) {
    b.rect(tl, 11, tr - tl + 1, 10, p.shirt);
    b.hline(tl - 1, tr + 1, 19, p.shirt).hline(tl - 1, tr + 1, 20, p.shirtShade);
    b.vline(tr, 13, 20, p.shirtShade);
    const ly = lift(0) ? 20 : 21;
    const ry = lift(1) ? 20 : 21;
    b.rect(5, ly, 3, 1, p.shoes).rect(8, ry, 3, 1, p.shoes);
    if (ly === 21) b.rect(5, 21, 3, 1, p.shoes);
  } else {
    for (const leg of [0, 1] as const) {
      const x = leg === 0 ? 5 : 8;
      const top = 18;
      const bottom = lift(leg) ? 20 : 21;
      b.rect(x, top, 3, bottom - top + 1, leg === 0 ? p.pants : p.pantsShade);
      b.rect(x, bottom + 1, 3, 1, p.shoes);
    }
    // Torso
    b.rect(tl, 11, tr - tl + 1, 7, p.shirt);
    if (narrow) b.hline(4, 11, 17, p.shirt);
    b.vline(tr, 12, 17, p.shirtShade);
    b.hline(tl, tr, 16, p.accent); // belt
  }
  if (!back) b.set(7, 11, p.skinShade).set(8, 11, p.skinShade); // collar
  if (!back && p.robe) b.hline(tl, tr, 15, p.accent); // sash

  // Arms (swing with steps)
  const armSwing = (left: boolean) => (frame === 0 ? 0 : (frame === 1) === left ? -1 : 1);
  for (const left of [true, false]) {
    const x = left ? tl - 1 : tr + 1;
    if (action) {
      // Both arms raised: swinging a weapon, casting, lifting a tool.
      const ox = left ? x - 1 : x + 1;
      b.rect(x, 9, 1, 4, left ? p.shirt : p.shirtShade).rect(ox, 7, 1, 3, left ? p.shirt : p.shirtShade);
      b.set(ox, 6, p.skin);
      continue;
    }
    const dy = armSwing(left);
    b.rect(x, 12 + dy, 1, 5, left ? p.shirt : p.shirtShade);
    b.set(x, 17 + dy, p.skin);
  }

  // Apron sits over the torso
  if (acc === 'apron' && !back) {
    b.rect(5, 13, 6, 7, '#e9e1cc').vline(10, 13, 19, '#c9c0a8');
    b.set(5, 12, '#e9e1cc').set(10, 12, '#e9e1cc');
  }

  // Head
  b.rect(4, 4, 8, 6, p.skin);
  b.hline(5, 10, 3, p.skin).hline(5, 10, 10, p.skin);
  b.vline(11, 4, 9, p.skinShade);
  b.hline(5, 10, 10, p.skinShade);

  if (!back) {
    b.rect(6, 7, 1, 2, p.eye).rect(9, 7, 1, 2, p.eye);
    b.set(6, 7, shade(p.eye, 0.35));
    b.set(9, 7, shade(p.eye, 0.35));
  }

  drawHairFrontBack(b, a.hairStyle, p, back);
  drawHeadAccessory(b, acc, false, back);
  return b;
}

function drawHairFrontBack(b: PixelBuffer, style: number, p: Palette, back: boolean): void {
  const h = p.hair;
  const s = p.hairShade;
  const cap = () => {
    b.hline(5, 10, 2, h);
    b.rect(4, 3, 8, 2, h);
    b.vline(11, 3, 4, s);
  };
  if (back) {
    if (style === 5) {
      b.hline(5, 10, 2, s).rect(4, 3, 8, 6, s);
      return;
    }
    cap();
    b.rect(4, 5, 8, 5, h);
    b.vline(11, 5, 9, s);
    b.hline(5, 10, 10, s);
    if (style === 2) b.rect(4, 10, 8, 2, h).rect(5, 12, 6, 2, h).vline(10, 12, 13, s).vline(11, 10, 11, s); // long
    if (style === 4) b.rect(3, 5, 10, 5, h).vline(12, 5, 9, s); // bob
    if (style === 3) b.rect(7, 10, 2, 5, h).vline(8, 10, 14, s); // ponytail
    if (style === 6) for (let y = 10; y < 17; y++) b.rect(7, y, 2, 1, y % 2 ? h : s); // braid
    if (style === 1) for (const x of [4, 6, 8, 10]) b.set(x, 1, h); // spikes
    return;
  }
  switch (style) {
    case 0: // Short Crop
      cap();
      b.hline(4, 5, 5, h).hline(8, 11, 5, h).set(4, 6, h).set(11, 6, s);
      break;
    case 1: // Spiky
      cap();
      for (const x of [4, 6, 8, 10]) b.set(x, 1, h);
      b.set(3, 3, h).set(12, 3, s);
      for (const x of [4, 6, 8, 10]) b.set(x, 5, h);
      b.set(11, 5, s);
      break;
    case 2: // Long Flow
      cap();
      b.hline(4, 6, 5, h).hline(9, 11, 5, h);
      b.rect(3, 4, 2, 10, h).rect(11, 4, 2, 10, s);
      break;
    case 3: // Ponytail
      cap();
      b.hline(4, 6, 5, h).hline(9, 11, 5, h).set(4, 6, h);
      b.rect(12, 4, 1, 6, s);
      b.set(11, 2, p.accent);
      break;
    case 4: // Bob
      cap();
      b.hline(4, 11, 5, h).hline(4, 5, 6, h).hline(10, 11, 6, s);
      b.rect(3, 4, 1, 6, h).rect(12, 4, 1, 6, s);
      break;
    case 5: // Buzz
      b.hline(5, 10, 2, s).rect(4, 3, 8, 1, s).set(4, 4, s).set(11, 4, s);
      break;
    default: // Braided
      cap();
      b.hline(4, 6, 5, h).hline(9, 11, 5, h);
      for (let y = 4; y < 16; y++) {
        b.set(3, y, y % 2 ? h : s);
        b.set(12, y, y % 2 ? s : h);
      }
  }
}

function drawSide(a: Appearance, frame: Frame, acc?: NpcAccessory): PixelBuffer {
  // Drawn facing left; "right" is mirrored.
  const p = palette(a);
  const b = new PixelBuffer(CHAR_W, CHAR_H);

  if (acc === 'cape') b.rect(9, 11, 3, 10, '#8e2b3a').vline(11, 12, 20, '#6e1f2c');

  // Legs
  if (p.robe) {
    b.rect(5, 11, 6, 10, p.shirt).hline(4, 11, 20, p.shirtShade).vline(10, 12, 19, p.shirtShade);
    const fx = frame === 1 ? 3 : frame === 2 ? 6 : frame === 3 ? 3 : 4;
    b.rect(fx, 21, 3, 1, p.shoes).rect(8, 21, 2, 1, shade(p.shoes, -0.2));
    b.hline(5, 10, 15, p.accent);
  } else {
    const legs: Record<Frame, [number, number]> = { 0: [6, 8], 1: [4, 9], 2: [8, 5], 3: [4, 9], 4: [6, 8] };
    const [front, far] = legs[frame];
    b.rect(far, 18, 2, 4, p.pantsShade).rect(far, 22, 2, 1, shade(p.shoes, -0.25));
    b.rect(front, 18, 2, 4, p.pants).rect(front - 1, 22, 3, 1, p.shoes);
    b.rect(5, 11, 6, 7, p.shirt).vline(10, 12, 17, p.shirtShade);
    b.hline(5, 10, 16, p.accent);
  }

  if (acc === 'apron') b.rect(4, 13, 3, 7, '#e9e1cc');

  // Near arm swings forward/back
  if (frame === 3) {
    // Reaching forward (lunge / strike / cast).
    b.rect(2, 12, 6, 2, p.shirtShade).rect(1, 12, 1, 2, p.skin);
  } else {
    const ax = frame === 1 ? 5 : frame === 2 ? 9 : 7;
    b.rect(ax, 12, 2, 4, p.shirtShade);
    b.rect(ax, 16, 2, 1, p.skin);
  }

  // Head (facing left)
  b.rect(4, 4, 7, 6, p.skin).hline(5, 9, 3, p.skin).hline(5, 9, 10, p.skinShade);
  b.set(3, 7, p.skin).set(3, 8, p.skinShade); // nose
  b.rect(5, 7, 1, 2, p.eye).set(5, 7, shade(p.eye, 0.35));
  b.set(7, 9, p.skinShade);

  drawHairSide(b, a.hairStyle, p);
  drawHeadAccessory(b, acc, true, false);
  return b;
}

function drawHairSide(b: PixelBuffer, style: number, p: Palette): void {
  const h = p.hair;
  const s = p.hairShade;
  if (style === 5) {
    b.hline(5, 9, 2, s).rect(4, 3, 7, 1, s).rect(9, 4, 2, 3, s);
    return;
  }
  b.hline(5, 9, 2, h).rect(4, 3, 7, 2, h);
  b.rect(8, 5, 3, 4, h).vline(10, 3, 9, s);
  b.set(4, 5, h);
  switch (style) {
    case 1:
      for (const x of [5, 7, 9]) b.set(x, 1, h);
      b.set(11, 4, s).set(11, 6, s);
      break;
    case 2:
      b.rect(9, 9, 3, 5, h).vline(11, 5, 13, s);
      break;
    case 3:
      b.rect(11, 4, 2, 2, h).rect(12, 6, 1, 4, s);
      break;
    case 4:
      b.rect(8, 5, 4, 5, h).vline(11, 5, 9, s).set(4, 6, h);
      break;
    case 6:
      for (let y = 9; y < 16; y++) b.set(10, y, y % 2 ? h : s);
      break;
    default:
      break;
  }
}

function drawHeadAccessory(b: PixelBuffer, acc: NpcAccessory | undefined, side: boolean, back: boolean): void {
  if (!acc) return;
  if (acc === 'hat') {
    const straw = '#d9b45a';
    b.hline(side ? 1 : 2, side ? 12 : 13, 4, straw);
    b.rect(side ? 4 : 5, 1, side ? 6 : 6, 3, straw);
    b.hline(side ? 4 : 5, side ? 9 : 10, 3, '#9a5a2c');
    b.hline(side ? 1 : 2, side ? 12 : 13, 5, shade(straw, -0.25));
  } else if (acc === 'helmet') {
    const y = '#e0b23a';
    b.rect(4, 1, side ? 7 : 8, 3, y).hline(3, side ? 11 : 12, 4, shade(y, -0.3));
    if (!back) b.rect(side ? 4 : 7, 2, 2, 1, '#fff6b0');
  } else if (acc === 'crown') {
    b.hline(5, 10, 2, '#e8c24a');
    for (const x of [5, 7, 9]) b.set(x, 1, '#e8c24a');
  } else if (acc === 'bandana') {
    b.rect(4, 3, side ? 7 : 8, 2, '#c0392b');
    if (side) b.rect(11, 4, 2, 2, '#c0392b');
    else b.set(12, 5, '#c0392b');
  } else if (acc === 'hood') {
    b.rect(3, 2, 10, 4, '#4b3a6b').vline(3, 2, 10, '#4b3a6b').vline(12, 2, 10, '#3a2c54');
  }
}

const sheetCache = new Map<string, HTMLCanvasElement>();

export function characterSheetKey(a: Appearance, accessory?: NpcAccessory): string {
  return `char:${a.bodyType}${a.skinTone}.${a.hairStyle}.${a.hairColor}.${a.eyeColor}.${a.outfit}${accessory ? `.${accessory}` : ''}`;
}

/** Full spritesheet canvas: 3 frames x 4 directions at 2x scale (96x192). */
export function buildCharacterSheet(a: Appearance, accessory?: NpcAccessory): HTMLCanvasElement {
  const key = characterSheetKey(a, accessory);
  const cached = sheetCache.get(key);
  if (cached) return cached;
  const scale = 2;
  const canvas = makeCanvas(CHAR_W * scale * CHAR_FRAMES_PER_DIR, CHAR_H * scale * CHAR_DIR_ROWS.length);
  const ctx = canvas.getContext('2d')!;
  CHAR_DIR_ROWS.forEach((dir, row) => {
    for (let f = 0; f < CHAR_FRAMES_PER_DIR; f++) {
      drawCharacterFrame(a, dir, f as Frame, accessory).draw(ctx, f * CHAR_W * scale, row * CHAR_H * scale, scale);
    }
  });
  sheetCache.set(key, canvas);
  return canvas;
}

/** A single still frame (used for portraits and the character creator). */
export function characterPreview(a: Appearance, dir: Direction = 'down', scale = 4, frame: Frame = 0): HTMLCanvasElement {
  const buf = drawCharacterFrame(a, dir, frame);
  return buf.toCanvas(scale);
}
