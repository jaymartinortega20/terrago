import { OUTLINE, PixelBuffer, SHADOW, shade } from './pixel';

/** Colours for the saddle and barding (armour plates). */
export interface MountPaint {
  saddle?: string;
  barding?: string;
}

/** A gnome-built hover disc: a brass body on a glowing jet (no legs). */
function hover(color: string, f: number, paint: MountPaint): PixelBuffer {
  const b = new PixelBuffer(30, 22);
  const dark = shade(color, -0.35);
  b.ellipse(3, 8, 24, 7, color).shadeIf((x, y) => y > 11, dark);
  b.hline(5, 24, 10, shade(color, 0.35));
  for (const x of [7, 12, 17, 22]) b.set(x, 12, '#5ad0ff');
  b.rect(12, 4, 6, 4, paint.barding ?? shade(color, -0.15)).set(18, 5, '#5ad0ff');
  b.rect(11, 6, 8, 2, paint.saddle ?? '#5a4670');
  // jets flicker between frames
  const jet = f ? '#9ae8ff' : '#5ad0ff';
  for (const x of [8, 21]) b.vline(x, 15, f ? 19 : 18, jet).vline(x + 1, 15, f ? 18 : 19, jet);
  b.outline(OUTLINE);
  for (let x = 6; x < 24; x++) b.under(x, 21, SHADOW);
  return b;
}

/** Side-view mount sprites (2 frames), drawn under the rider. */
function frame(kind: string, color: string, f: number, paint: MountPaint = {}): PixelBuffer {
  if (kind === 'hovergear') return hover(color, f, paint);
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
  if (kind === 'boar') b.set(29, 6, '#efe7cf').set(28, 5, '#efe7cf').vline(21, 1, 4, dark);
  if (kind === 'wyvern') {
    // Wings (flap between frames), a long tail and a horned head.
    const wing = shade(color, 0.25);
    for (let i = 0; i < 9; i++) {
      const y = f ? 4 - Math.floor(i / 3) : 1 + Math.floor(i / 2);
      b.hline(9 + i, 15 + Math.floor(i / 2), Math.max(0, y - (f ? 0 : 1)), wing);
      b.vline(9 + i, Math.max(0, y), 7, wing);
    }
    b.hline(0, 5, 12, color).set(0, 11, dark).set(23, 0, '#d6c79f').set(26, 0, '#d6c79f');
  }
  // barding: armour plates over the body and a face plate
  if (paint.barding) {
    const plate = paint.barding;
    b.hline(7, 22, 9, plate).hline(8, 21, 10, shade(plate, -0.2)).hline(9, 20, 12, plate);
    for (const x of [9, 13, 17]) b.set(x, 11, shade(plate, 0.4));
    b.set(23, 3, plate).set(24, 3, plate).set(25, 2, shade(plate, 0.4));
  }
  // saddle
  const sad = paint.saddle ?? (kind === 'wolf' ? '#5a4670' : '#7a3a2a');
  if (kind !== 'wolf') b.rect(11, 5, 7, 3, sad).hline(11, 17, 8, shade(sad, -0.3));
  else b.rect(11, 6, 7, 2, sad);
  b.outline(OUTLINE);
  for (let x = 4; x < 26; x++) b.under(x, 21, SHADOW);
  return b;
}

export function mountSheet(kind: string, color: string, paint: MountPaint = {}): { canvas: HTMLCanvasElement; w: number; h: number } {
  const a = frame(kind, color, 0, paint);
  const c = frame(kind, color, 1, paint);
  const sheet = new PixelBuffer(a.w * 2, a.h);
  sheet.stamp(a, 0, 0);
  sheet.stamp(c, a.w, 0);
  return { canvas: sheet.toCanvas(), w: a.w, h: a.h };
}
