/** Emote bubbles: a little speech bubble with a pixel icon, drawn from code. */
import { OUTLINE, PixelBuffer } from './pixel';

const W = 16;
const H = 16;
const cache = new Map<string, HTMLCanvasElement>();

function bubble(b: PixelBuffer): void {
  b.rect(1, 0, 14, 12, '#fffaf0').rect(0, 1, 16, 10, '#fffaf0');
  b.hline(1, 14, 11, '#e6dcc6');
  // Tail.
  b.rect(6, 12, 4, 1, '#fffaf0').rect(7, 13, 2, 1, '#fffaf0').set(7, 14, '#fffaf0');
}

const ICONS: Record<string, (b: PixelBuffer) => void> = {
  wave(b) {
    const s = '#f2c9a0';
    const d = '#c9946a';
    b.rect(5, 4, 6, 5, s).hline(5, 10, 8, d);
    for (const x of [5, 7, 9]) b.vline(x, 2, 4, s);
    b.vline(11, 3, 5, s).set(4, 6, s).set(3, 5, s);
    b.set(12, 2, '#8fd0ff').set(13, 3, '#8fd0ff').set(2, 3, '#8fd0ff').set(1, 4, '#8fd0ff');
  },
  laugh(b) {
    const y = '#f6cd4e';
    b.rect(4, 2, 8, 8, y).rect(3, 3, 10, 6, y);
    b.set(5, 5, OUTLINE).set(6, 4, OUTLINE).set(7, 5, OUTLINE);
    b.set(9, 5, OUTLINE).set(10, 4, OUTLINE).set(11, 5, OUTLINE);
    b.rect(6, 7, 5, 2, '#a8323a').hline(6, 10, 7, '#ffffff');
    b.set(2, 4, '#8fd0ff').set(13, 4, '#8fd0ff');
  },
  heart(b) {
    const r = '#e0483a';
    b.rect(4, 3, 3, 2, r).rect(9, 3, 3, 2, r).rect(3, 4, 10, 3, r).rect(4, 7, 8, 1, r).rect(5, 8, 6, 1, r).rect(6, 9, 4, 1, r).rect(7, 10, 2, 1, r);
    b.set(5, 4, '#ff9a8a').set(4, 5, '#ff9a8a');
  },
  cheer(b) {
    const g = '#f2c14e';
    b.vline(8, 1, 10, g).hline(3, 13, 5, g).rect(6, 3, 5, 5, g).set(5, 8, g).set(11, 8, g).set(4, 9, g).set(12, 9, g);
    b.set(8, 5, '#fff3c4');
    b.set(2, 2, '#e0483a').set(14, 2, '#5fb0e8').set(2, 10, '#5fa04a').set(14, 10, '#b06ad6');
  },
  angry(b) {
    const r = '#d0302a';
    b.rect(4, 2, 2, 3, r).rect(10, 2, 2, 3, r).rect(4, 7, 2, 3, r).rect(10, 7, 2, 3, r);
    b.rect(2, 4, 3, 2, r).rect(11, 4, 3, 2, r).rect(2, 7, 3, 1, r).rect(11, 7, 3, 1, r);
  },
  cry(b) {
    const y = '#f6cd4e';
    b.rect(4, 2, 8, 8, y).rect(3, 3, 10, 6, y);
    b.hline(5, 6, 5, OUTLINE).hline(9, 10, 5, OUTLINE);
    b.vline(5, 6, 9, '#5fb0e8').vline(10, 6, 9, '#5fb0e8').set(5, 10, '#5fb0e8').set(10, 10, '#5fb0e8');
    b.hline(7, 8, 8, OUTLINE).set(6, 9, OUTLINE).set(9, 9, OUTLINE);
  },
  dance(b) {
    const n = '#6a4ad0';
    b.rect(3, 8, 3, 2, n).vline(5, 2, 8, n).rect(9, 7, 3, 2, n).vline(11, 1, 7, n).hline(5, 11, 1, n).hline(5, 11, 2, n);
  },
  bow(b) {
    const g = '#f2c14e';
    for (const [x, y] of [[4, 3], [11, 4], [7, 8], [3, 9], [12, 9]] as const) b.set(x, y, g).set(x - 1, y, '#fff3c4').set(x + 1, y, '#fff3c4').set(x, y - 1, '#fff3c4').set(x, y + 1, '#fff3c4');
  },
  zzz(b) {
    const c = '#5f8fd0';
    b.hline(9, 13, 1, c).set(12, 2, c).set(11, 3, c).set(10, 4, c).hline(9, 13, 5, c);
    b.hline(3, 7, 5, c).set(6, 6, c).set(5, 7, c).set(4, 8, c).hline(3, 7, 9, c);
  },
};

export function emoteIcon(id: string): HTMLCanvasElement | null {
  const draw = ICONS[id];
  if (!draw) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const b = new PixelBuffer(W, H);
  bubble(b);
  draw(b);
  b.outline(OUTLINE);
  const c = b.toCanvas(2);
  cache.set(id, c);
  return c;
}
