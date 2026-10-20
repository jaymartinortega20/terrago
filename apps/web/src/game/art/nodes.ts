import type { NodeDef } from '@terrago/shared';
import { OUTLINE, PixelBuffer, SHADOW, seeded, shade } from './pixel';

/** Gatherable resource nodes, drawn from their colour and kind; depleted nodes look spent. */
export function nodeArt(def: NodeDef, depleted: boolean): PixelBuffer {
  const { kind, color } = def.art;
  const r = seeded(def.id.length * 131 + def.level);
  let b: PixelBuffer;
  switch (kind) {
    case 'rock':
    case 'crystal': {
      b = new PixelBuffer(18, 16);
      if (depleted) {
        b.ellipse(2, 9, 14, 6, '#7d7a74').set(5, 10, '#6a6761').set(10, 11, '#6a6761');
        break;
      }
      if (kind === 'crystal') {
        b.ellipse(1, 7, 16, 8, '#5a5063');
        b.rect(7, 0, 4, 12, color).rect(3, 4, 3, 8, shade(color, -0.2)).rect(12, 3, 3, 9, shade(color, -0.1)).vline(8, 1, 9, shade(color, 0.5));
      } else {
        b.ellipse(0, 2, 18, 13, '#8b8a86').ellipse(2, 3, 9, 6, '#a7a6a1').shadeIf((x, y) => y > 11 || x > 14, '#6f6e6a');
        for (let i = 0; i < 6; i++) {
          const x = 3 + Math.floor(r() * 12);
          const y = 4 + Math.floor(r() * 8);
          if (b.get(x, y)) b.set(x, y, color).set(x + 1, y, shade(color, 0.3));
        }
      }
      break;
    }
    case 'tree': {
      b = new PixelBuffer(24, 36);
      b.rect(9, 22, 6, 13, '#7a5230').vline(14, 22, 34, '#5d3d22');
      if (depleted) {
        b = new PixelBuffer(16, 12);
        b.rect(3, 4, 10, 7, '#7a5230').ellipse(3, 1, 10, 5, '#c9a36b').ellipse(6, 2, 4, 3, '#b08a55');
        break;
      }
      b.ellipse(0, 0, 24, 26, color).ellipse(3, 2, 10, 9, shade(color, 0.2)).shadeIf((x, y) => y > 18 || x + y * 0.6 > 26, shade(color, -0.25));
      // Axe notch: a hint that this tree can be chopped.
      b.rect(9, 28, 3, 2, '#e8d4a8');
      break;
    }
    case 'grass': {
      b = new PixelBuffer(16, 14);
      const c = depleted ? '#8f8a5a' : color;
      for (let i = 0; i < 7; i++) {
        const x = 1 + i * 2;
        const h = depleted ? 3 : 6 + Math.floor(r() * 7);
        b.vline(x, 13 - h, 13, i % 2 ? c : shade(c, -0.2));
      }
      return b;
    }
    case 'herb': {
      b = new PixelBuffer(16, 14);
      if (depleted) {
        b.vline(8, 10, 13, '#6f8f4a');
        return b;
      }
      b.vline(8, 5, 13, shade(color, -0.35));
      for (const [x, y] of [[5, 4], [11, 3], [4, 8], [12, 8], [8, 1]] as const) b.ellipse(x - 2, y, 5, 4, color);
      b.outline(OUTLINE);
      return b;
    }
    case 'bush': {
      b = new PixelBuffer(18, 16);
      b.ellipse(0, 2, 18, 13, '#3f8f3c').ellipse(2, 3, 8, 5, '#57a84f').shadeIf((x, y) => y > 11, '#2f7030');
      if (!depleted) for (let i = 0; i < 7; i++) {
        const x = 3 + Math.floor(r() * 12);
        const y = 4 + Math.floor(r() * 8);
        b.set(x, y, color).set(x, y + 1, shade(color, -0.3));
      }
      break;
    }
    case 'mushroom': {
      b = new PixelBuffer(16, 12);
      if (depleted) return b.set(7, 10, '#6f5a3a').set(8, 10, '#6f5a3a');
      for (const [x, y, s] of [[2, 4, 6], [8, 2, 7], [10, 7, 5]] as const) {
        b.rect(x + Math.floor(s / 2) - 1, y + 3, 2, 12 - y - 3, '#efe3c2');
        b.ellipse(x, y, s, 4, color).set(x + 1, y + 1, shade(color, 0.4));
      }
      b.outline(OUTLINE);
      return b;
    }
    default:
      b = new PixelBuffer(16, 16);
      b.rect(4, 4, 8, 8, color);
  }
  b.outline(OUTLINE);
  for (let x = 1; x < b.w - 1; x++) b.under(x, b.h - 1, SHADOW);
  return b;
}
