import { OUTLINE, PixelBuffer, SHADOW, shade } from './pixel';

/** Side-view mount sprites (2 frames), drawn under the rider. */
function frame(kind: string, color: string, f: number): PixelBuffer {
  const b = new PixelBuffer(30, 22);
  const dark = shade(color, -0.3);
  const legY = 15;
  // body
  b.ellipse(5, 7, 19, 10, color).shadeIf((x, y) => y > 13, dark);
  // neck + head
  if (kind === 'wolf') {
    b.ellipse(20, 4, 9, 8, color).set(27, 8, '#2a2030').set(22, 2, color).set(23, 1, color).hline(28, 29, 9, dark);
  } else {
    b.rect(21, 3, 4, 8, color).ellipse(22, 1, 8, 6, color).set(27, 3, '#2a2030').set(29, 5, dark);
    if (kind === 'stag') for (let i = 0; i < 5; i++) b.set(22 - i, 0 - (i % 2) + 1, '#d6c79f').set(24 + (i % 2), 0, '#d6c79f');
    else b.vline(20, 2, 9, kind === 'horse' ? shade(color, -0.45) : dark);
  }
  // tail
  if (kind === 'wolf') b.set(4, 8, color).set(3, 7, color).set(2, 6, shade(color, 0.3));
  else b.vline(4, 8, 15, kind === 'horse' ? shade(color, -0.45) : color).set(3, 15, dark);
  // legs (two poses)
  const pose = f ? [1, -1, -1, 1] : [-1, 1, 1, -1];
  [8, 11, 19, 22].forEach((x, i) => {
    b.vline(x + pose[i]!, legY, 21, dark);
    b.set(x + pose[i]!, 21, '#2a2030');
  });
  // saddle
  if (kind !== 'wolf') b.rect(11, 5, 7, 3, '#7a3a2a').hline(11, 17, 8, '#5a2a1e');
  else b.rect(11, 6, 7, 2, '#5a4670');
  b.outline(OUTLINE);
  for (let x = 4; x < 26; x++) b.under(x, 21, SHADOW);
  return b;
}

export function mountSheet(kind: string, color: string): { canvas: HTMLCanvasElement; w: number; h: number } {
  const a = frame(kind, color, 0);
  const c = frame(kind, color, 1);
  const sheet = new PixelBuffer(a.w * 2, a.h);
  sheet.stamp(a, 0, 0);
  sheet.stamp(c, a.w, 0);
  return { canvas: sheet.toCanvas(), w: a.w, h: a.h };
}
