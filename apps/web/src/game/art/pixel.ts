/**
 * Tiny pixel-art toolkit. Art is authored at a logical resolution (16px per
 * tile) into a PixelBuffer, then blitted at 2x so every art pixel is a crisp
 * 2x2 block on screen. All TerraGo placeholder art is generated from code —
 * no external sprites — so it is original by construction.
 */

export const ART_SCALE = 2;

export type Color = string | null;

export class PixelBuffer {
  readonly data: Color[];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Array<Color>(w * h).fill(null);
  }

  get(x: number, y: number): Color {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.data[y * this.w + x] ?? null;
  }

  set(x: number, y: number, c: Color): this {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    this.data[y * this.w + x] = c;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: Color): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  hline(x0: number, x1: number, y: number, c: Color): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
    return this;
  }

  vline(x: number, y0: number, y1: number, c: Color): this {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
    return this;
  }

  /** Filled ellipse inside the box [x, x+w) x [y, y+h). */
  ellipse(x: number, y: number, w: number, h: number, c: Color): this {
    const cx = x + w / 2 - 0.5;
    const cy = y + h / 2 - 0.5;
    const rx = w / 2;
    const ry = h / 2;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const dx = (i - cx) / rx;
        const dy = (j - cy) / ry;
        if (dx * dx + dy * dy <= 1.0) this.set(i, j, c);
      }
    return this;
  }

  /** Only paint where the buffer is currently filled (for shading). */
  shadeIf(pred: (x: number, y: number) => boolean, c: string): this {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (this.get(x, y) && pred(x, y)) this.set(x, y, c);
    return this;
  }

  /** Paint `c` into empty pixels that touch a filled pixel (4-neighbourhood). */
  outline(c: string): this {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push(y * this.w + x);
      }
    for (const i of add) this.data[i] = c;
    return this;
  }

  /** Fill only empty pixels (used for shadows drawn after the outline). */
  under(x: number, y: number, c: string): this {
    if (!this.get(x, y)) this.set(x, y, c);
    return this;
  }

  mirrored(): PixelBuffer {
    const out = new PixelBuffer(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) out.set(this.w - 1 - x, y, this.get(x, y));
    return out;
  }

  /** Copy another buffer onto this one at (ox, oy); null pixels are transparent. */
  stamp(src: PixelBuffer, ox: number, oy: number): this {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c) this.set(ox + x, oy + y, c);
      }
    return this;
  }

  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, scale = ART_SCALE): void {
    let last = '';
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.data[y * this.w + x];
        if (!c) continue;
        if (c !== last) {
          ctx.fillStyle = c;
          last = c;
        }
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
  }

  toCanvas(scale = ART_SCALE): HTMLCanvasElement {
    const canvas = makeCanvas(this.w * scale, this.h * scale);
    this.draw(canvas.getContext('2d')!, 0, 0, scale);
    return canvas;
  }
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return c;
}

/** Deterministic RNG so generated art is identical every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Darken (amount < 0) or lighten (amount > 0) a colour, -1..1. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (amount < 0) return rgbToHex(r * (1 + amount), g * (1 + amount), b * (1 + amount));
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export const OUTLINE = '#2a2030';
export const SHADOW = 'rgba(20,16,28,0.28)';
