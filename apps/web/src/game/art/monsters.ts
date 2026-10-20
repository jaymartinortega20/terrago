import { OUTLINE, PixelBuffer, SHADOW, shade } from './pixel';

/**
 * Monster sprites, generated from a shape and a colour. Two frames (idle /
 * step) facing right; the scene mirrors them for left.
 */

const EYE = '#2a2030';

function frame(shape: string, color: string, f: number): PixelBuffer {
  const dark = shade(color, -0.3);
  const light = shade(color, 0.3);
  const bob = f ? 1 : 0;
  let b: PixelBuffer;
  switch (shape) {
    case 'slime': {
      b = new PixelBuffer(20, 16);
      const w = f ? 18 : 16;
      const h = f ? 10 : 12;
      b.ellipse(10 - w / 2, 15 - h, w, h, color).ellipse(10 - w / 2 + 3, 16 - h, 6, 3, light).shadeIf((x, y) => y > 12, dark);
      b.set(12, 10 - (f ? 0 : 1), EYE).set(15, 10 - (f ? 0 : 1), EYE);
      break;
    }
    case 'rat': {
      b = new PixelBuffer(22, 12);
      b.ellipse(3, 3 + bob, 14, 8, color).ellipse(14, 4 + bob, 7, 6, color).set(19, 6 + bob, '#e8a0a0');
      b.set(17, 5 + bob, EYE).set(15, 2 + bob, shade(color, 0.2)).set(16, 2 + bob, shade(color, 0.2));
      for (let i = 0; i < 4; i++) b.set(2 - Math.floor(i / 2), 7 + i, '#c99a7a');
      b.set(6, 11, dark).set(12, 11, dark);
      break;
    }
    case 'boar':
    case 'wolf': {
      b = new PixelBuffer(28, 20);
      b.ellipse(3, 4 + bob, 18, 11, color).shadeIf((x, y) => y > 11 + bob, dark);
      b.ellipse(17, 3 + bob, 10, 9, color);
      if (shape === 'wolf') b.set(20, 1 + bob, color).set(21, 0 + bob, color).set(24, 1 + bob, color).set(25, 6 + bob, EYE).hline(26, 27, 9 + bob, dark);
      else b.set(23, 6 + bob, EYE).rect(25, 8 + bob, 3, 3, '#e8c8b0').set(26, 11 + bob, '#efe7cf').hline(5, 15, 4 + bob, dark);
      for (const x of [5, 9, 15, 19]) b.vline(x + (f && x % 2 ? 1 : 0), 14, 19, dark);
      if (shape === 'wolf') b.set(2, 6 + bob, color).set(1, 5 + bob, color).set(0, 4 + bob, light);
      break;
    }
    case 'goblin':
    case 'orc':
    case 'skeleton':
    case 'mage': {
      const big = shape === 'orc';
      b = new PixelBuffer(20, big ? 30 : 26);
      const H = b.h;
      const skin = shape === 'skeleton' ? '#e8e0cc' : color;
      const cloth = shape === 'mage' ? color : shape === 'skeleton' ? '#5a5260' : shape === 'orc' ? '#6b4628' : '#8a5d33';
      const head = shape === 'mage' ? '#c8b8d8' : skin;
      // legs
      b.rect(6, H - 7, 3, 6 + (f ? 0 : 1), shape === 'skeleton' ? skin : dark).rect(11, H - 7, 3, 6 + (f ? 1 : 0), shape === 'skeleton' ? skin : dark);
      // body
      b.rect(4, H - 17, 12, 11, cloth);
      if (shape === 'skeleton') for (let y = H - 15; y < H - 8; y += 2) b.hline(6, 13, y, skin);
      if (shape === 'mage') b.rect(3, H - 8, 14, 3, cloth);
      // arms + weapon
      b.rect(2, H - 16 + bob, 2, 8, skin).rect(16, H - 16 + bob, 2, 8, skin);
      if (shape === 'mage') b.vline(18, H - 24, H - 4, '#5d3d22').rect(17, H - 26, 3, 3, '#b06ad6');
      else b.vline(18, H - 22 + bob, H - 9 + bob, shape === 'orc' ? '#7d7a74' : '#a7a6a1').hline(17, 19, H - 12 + bob, '#5d3d22');
      // head
      b.ellipse(5, H - (big ? 29 : 25), 10, 9, head);
      if (shape === 'goblin') b.set(3, H - 22, head).set(2, H - 23, head).set(16, H - 22, head).set(17, H - 23, head);
      if (shape === 'orc') b.set(8, H - 21, '#efe7cf').set(12, H - 21, '#efe7cf');
      if (shape === 'mage') b.ellipse(4, H - 27, 12, 6, cloth).set(10, H - 30, cloth);
      b.set(8, H - (big ? 25 : 21), shape === 'skeleton' || shape === 'mage' ? '#e0483a' : EYE).set(11, H - (big ? 25 : 21), shape === 'skeleton' || shape === 'mage' ? '#e0483a' : EYE);
      break;
    }
    case 'spider': {
      b = new PixelBuffer(26, 16);
      b.ellipse(3, 3, 12, 10, color).ellipse(13, 5, 9, 8, shade(color, 0.15)).set(19, 7, '#e0483a').set(20, 9, '#e0483a');
      for (let i = 0; i < 4; i++) {
        const x = 6 + i * 4;
        b.set(x, 13, dark).set(x - 1, 14 + ((i + f) % 2), dark).set(x + 1, 2, dark).set(x + 2, 1 - ((i + f) % 2) + 1, dark);
      }
      break;
    }
    case 'bat': {
      b = new PixelBuffer(24, 14);
      b.ellipse(9, 4, 6, 7, color).set(10, 6, '#e0483a').set(13, 6, '#e0483a').set(10, 3, color).set(14, 3, color);
      const up = f === 0;
      for (let i = 0; i < 8; i++) {
        const y = up ? 4 - Math.floor(i / 3) + (i % 2) : 6 + Math.floor(i / 3);
        b.set(8 - i, y, dark).set(8 - i, y + 1, color).set(15 + i, y, dark).set(15 + i, y + 1, color);
      }
      break;
    }
    case 'golem': {
      b = new PixelBuffer(28, 30);
      b.rect(6, 6, 16, 16, color).rect(1, 9 + bob, 6, 12, color).rect(21, 9 + bob, 6, 12, color).rect(8, 22, 5, 7, dark).rect(15, 22, 5, 7, dark);
      b.rect(9, 0, 10, 8, color).set(12, 3, '#8fe0ff').set(16, 3, '#8fe0ff').rect(12, 12, 4, 4, '#b6a4ff');
      b.shadeIf((x, y) => (x * 5 + y * 3) % 9 === 0, dark);
      break;
    }
    default:
      b = new PixelBuffer(16, 16);
      b.ellipse(1, 1, 14, 14, color);
  }
  b.outline(OUTLINE);
  for (let x = 2; x < b.w - 2; x++) b.under(x, b.h - 1, SHADOW);
  return b;
}

/** Two frames side by side: [idle | step]. */
export function monsterSheet(shape: string, color: string): { canvas: HTMLCanvasElement; w: number; h: number } {
  const a = frame(shape, color, 0);
  const b = frame(shape, color, 1);
  const w = Math.max(a.w, b.w);
  const h = Math.max(a.h, b.h);
  const sheet = new PixelBuffer(w * 2, h);
  sheet.stamp(a, 0, h - a.h);
  sheet.stamp(b, w, h - b.h);
  return { canvas: sheet.toCanvas(), w, h };
}
