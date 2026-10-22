/** Wings: one wing (the right one) drawn from code; the left is mirrored. 22x26 logical px. */
import { OUTLINE, PixelBuffer, mix, shade } from './pixel';

export type WingStyle = 'fairy' | 'angel' | 'demon' | 'dragon';

const W = 22;
const H = 26;
const cache = new Map<string, HTMLCanvasElement>();

/** Root of the wing is at the left edge, about 30% down. */
function fairy(b: PixelBuffer, c: string): void {
  const light = mix(c, '#ffffff', 0.55);
  // Upper lobe
  for (let y = 1; y < 15; y++) {
    const half = Math.round(Math.sin((y / 15) * Math.PI) * 9);
    for (let x = 1; x <= 2 + half + Math.round(y * 0.6); x++) b.set(x, y, (x + y) % 5 === 0 ? light : c);
  }
  // Lower lobe
  for (let y = 13; y < 24; y++) {
    const half = Math.round(Math.sin(((y - 13) / 11) * Math.PI) * 6);
    for (let x = 1; x <= 1 + half; x++) b.set(x, y, (x * 2 + y) % 6 === 0 ? light : shade(c, -0.08));
  }
  // Veins
  for (let i = 0; i < 12; i++) b.set(1 + i, 7 - Math.floor(i / 3), '#ffffff');
  for (let i = 0; i < 6; i++) b.set(1 + i, 16 + Math.floor(i / 2), '#ffffff');
  b.set(14, 4, '#ffffff').set(9, 10, '#ffffff').set(5, 20, '#ffffff');
}

function angel(b: PixelBuffer, c: string): void {
  const dark = shade(c, -0.18);
  const tips = shade(c, -0.32);
  // Feather rows sweeping out and down.
  for (let row = 0; row < 6; row++) {
    const y0 = 2 + row * 3;
    const len = 20 - row * 2.6;
    for (let x = 0; x < len; x++) {
      const y = y0 + Math.round((x / len) * (2 + row * 0.6)) - (x > len - 4 ? 1 : 0);
      b.set(1 + x, y, row % 2 ? dark : c).set(1 + x, y + 1, row % 2 ? c : dark);
      if (x === Math.floor(len) - 1) b.set(1 + x, y + 2, tips);
    }
  }
  for (let x = 1; x < 8; x++) b.set(x, 1, shade(c, 0.1));
}

function bat(b: PixelBuffer, membrane: string, bone: string, spikes: boolean): void {
  // Arm bone along the top, three finger struts, scalloped membrane.
  for (let x = 1; x < 21; x++) b.set(x, 3 + Math.round(x * 0.15), bone).set(x, 2 + Math.round(x * 0.15), shade(bone, 0.2));
  const struts = [
    [20, 6, 18, 20],
    [20, 6, 11, 22],
    [20, 6, 4, 19],
  ];
  for (let y = 4; y < 23; y++)
    for (let x = 1; x < 21; x++) {
      // membrane inside the polygon bounded by the arm and the outer strut, scalloped at the bottom
      const bottom = 16 + Math.round(Math.abs(Math.sin((x / 21) * Math.PI * 3)) * 5);
      if (y > 3 + x * 0.15 && y < bottom && x < 21 - (y - 4) * 0.12) b.set(x, y, (x + y) % 7 === 0 ? shade(membrane, 0.12) : membrane);
    }
  for (const [x0, y0, x1, y1] of struts) {
    const n = Math.max(Math.abs(x1! - x0!), Math.abs(y1! - y0!));
    for (let i = 0; i <= n; i++) b.set(Math.round(x0! + ((x1! - x0!) * i) / n), Math.round(y0! + ((y1! - y0!) * i) / n), bone);
  }
  b.set(21, 4, bone).set(21, 5, shade(bone, -0.2));
  if (spikes) for (const x of [6, 11, 16]) b.set(x, 1 + Math.round(x * 0.15), shade(bone, 0.3));
}

export function wingCanvas(style: WingStyle, color: string): HTMLCanvasElement {
  const key = `${style}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = new PixelBuffer(W, H);
  if (style === 'fairy') fairy(b, color);
  else if (style === 'angel') angel(b, color);
  else if (style === 'demon') bat(b, color, shade(color, -0.35), false);
  else bat(b, mix(color, '#ff9a3a', 0.35), shade(color, -0.3), true);
  b.outline(style === 'fairy' ? shade(color, -0.35) : OUTLINE);
  const c = b.toCanvas(2);
  cache.set(key, c);
  return c;
}
