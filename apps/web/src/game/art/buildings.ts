/**
 * Town buildings, drawn from code at 16 logical px per tile (blitted at 2x).
 * Styles: brick shops, stone halls, timber-framed inns, marble banks, thatched
 * cottages and a castle with towers. Returns where windows and chimneys are so
 * the scene can light windows at night and puff smoke.
 */
import type { BuildingDef, BuildingStyle } from '@terrago/shared';
import { ART_SCALE, OUTLINE, PixelBuffer, mix, seeded, shade } from './pixel';

const T = 16;

export interface BuildingArt {
  canvas: HTMLCanvasElement;
  /** Sign position relative to the canvas's bottom-left, in screen px. */
  signX: number;
  signY: number;
  /** Window panes (screen px, relative to bottom-left; y is negative = up). */
  windows: { x: number; y: number; w: number; h: number }[];
  /** Chimney tops for smoke (screen px, relative to bottom-left). */
  chimneys: { x: number; y: number }[];
  /** Small warm lights (lanterns, torches, forge). */
  lights: { x: number; y: number; r: number }[];
}

const BY_ID: Record<string, BuildingStyle> = {
  tavern: 'timber',
  guild_hall: 'castle',
  bank: 'marble',
  general_store: 'brick',
  blacksmith: 'stone',
  farm_supply: 'timber',
  cottage: 'cottage',
};

/** Which look a building gets: its own `style`, else a sensible default by id. */
export function styleOf(def: BuildingDef): BuildingStyle {
  return def.style ?? BY_ID[def.id] ?? 'brick';
}

const IRON = '#3a3640';
const WOOD = '#8a5530';
const WOOD_DARK = '#5e3a20';
const GLASS_DARK = '#4b7aa6';
const GLASS = '#8cc4e6';
const GLASS_HI = '#d8f0ff';
const STONE = '#a29a90';
const MARBLE = '#e6e0d4';
const GOLD = '#f2c14e';

class Painter {
  readonly b: PixelBuffer;
  readonly r: () => number;
  windows: BuildingArt['windows'] = [];
  chimneys: BuildingArt['chimneys'] = [];
  lights: BuildingArt['lights'] = [];

  constructor(
    readonly w: number,
    readonly h: number,
    seed: number,
  ) {
    this.b = new PixelBuffer(w, h);
    this.r = seeded(seed);
  }

  jitter(c: string, amt: number): string {
    return shade(c, (this.r() - 0.5) * amt);
  }

  // --- Wall textures --------------------------------------------------------

  brick(x: number, y: number, w: number, h: number, base: string): void {
    const mortar = mix(base, '#d6cbb5', 0.62);
    this.b.rect(x, y, w, h, mortar);
    for (let row = 0; row * 4 < h; row++) {
      const yy = y + row * 4;
      const off = row % 2 ? 4 : 0;
      for (let xx = x - off; xx < x + w; xx += 8) {
        const x0 = Math.max(x, xx);
        const x1 = Math.min(x + w - 1, xx + 6);
        if (x1 < x0) continue;
        const c = this.jitter(base, 0.16);
        for (let j = 0; j < 3 && yy + j < y + h; j++) this.b.hline(x0, x1, yy + j, j === 2 ? shade(c, -0.14) : j === 0 ? shade(c, 0.07) : c);
      }
    }
  }

  stone(x: number, y: number, w: number, h: number, base: string, rowH = 5): void {
    const mortar = shade(base, -0.42);
    this.b.rect(x, y, w, h, mortar);
    for (let row = 0; row * rowH < h; row++) {
      const yy = y + row * rowH;
      let xx = x - Math.floor(this.r() * 6);
      while (xx < x + w) {
        const bw = 6 + Math.floor(this.r() * 6);
        const x0 = Math.max(x, xx);
        const x1 = Math.min(x + w - 1, xx + bw - 2);
        const c = this.jitter(base, 0.2);
        for (let j = 0; j < rowH - 1 && yy + j < y + h; j++) this.b.hline(x0, x1, yy + j, j === 0 ? shade(c, 0.12) : j === rowH - 2 ? shade(c, -0.12) : c);
        if (this.r() < 0.12) this.b.set(x0 + 2, yy + 2, shade(c, -0.25)); // weathering
        xx += bw;
      }
    }
  }

  /** Re-shade existing pixels column by column (k = 0 at left .. 1 at right). */
  shadeCols(x: number, y: number, w: number, h: number, amount: (k: number) => number): void {
    for (let xx = x; xx < x + w; xx++) {
      const a = amount((xx - x) / Math.max(1, w - 1));
      for (let yy = y; yy < y + h; yy++) {
        const c = this.b.get(xx, yy);
        if (c) this.b.set(xx, yy, shade(c, a));
      }
    }
  }

  plaster(x: number, y: number, w: number, h: number, base: string): void {
    this.b.rect(x, y, w, h, base);
    for (let i = 0; i < (w * h) / 24; i++) this.b.set(x + Math.floor(this.r() * w), y + Math.floor(this.r() * h), shade(base, (this.r() - 0.6) * 0.12));
  }

  timber(x: number, y: number, w: number, h: number, base: string): void {
    this.plaster(x, y, w, h, base);
    const beam = '#5a3a24';
    const hi = '#7a5234';
    this.b.hline(x, x + w - 1, y, beam).hline(x, x + w - 1, y + 1, hi).hline(x, x + w - 1, y + h - 1, beam).hline(x, x + w - 1, y + h - 2, hi);
    const step = 14;
    let panel = 0;
    for (let xx = x; xx < x + w; xx += step, panel++) {
      this.b.vline(xx, y, y + h - 1, beam).vline(xx + 1, y, y + h - 1, hi);
      const x1 = Math.min(x + w - 1, xx + step);
      if (panel % 2 === 0) for (let i = 0; i < h - 4; i++) this.b.set(xx + 2 + Math.round((i * (x1 - xx - 3)) / (h - 4)), y + 2 + i, beam);
      else for (let i = 0; i < h - 4; i++) this.b.set(x1 - 1 - Math.round((i * (x1 - xx - 3)) / (h - 4)), y + 2 + i, beam);
    }
    this.b.vline(x + w - 1, y, y + h - 1, beam);
  }

  /** Light stone blocks up the corners of a wall. */
  quoins(x: number, y: number, w: number, h: number, c: string): void {
    for (let yy = y, i = 0; yy < y + h; yy += 4, i++) {
      const bw = i % 2 ? 4 : 6;
      this.b.rect(x, yy, bw, 3, shade(c, 0.05)).hline(x, x + bw - 1, yy + 2, shade(c, -0.15));
      this.b.rect(x + w - bw, yy, bw, 3, shade(c, -0.05)).hline(x + w - bw, x + w - 1, yy + 2, shade(c, -0.2));
    }
  }

  // --- Roofs ----------------------------------------------------------------

  /**
   * Hipped roof seen from the front: ridge on top, sloped hip ends, tile courses.
   * kind: tile (clay), slate (flat grey-blue), thatch (straw).
   */
  roof(x: number, y: number, w: number, h: number, color: string, kind: 'tile' | 'slate' | 'thatch'): void {
    const hip = Math.min(10, Math.floor(h * 0.45));
    const courseH = kind === 'slate' ? 3 : kind === 'thatch' ? 5 : 4;
    const tileW = kind === 'slate' ? 7 : 5;
    for (let j = 0; j < h; j++) {
      const inset = Math.max(0, hip - j);
      const x0 = x + inset;
      const x1 = x + w - 1 - inset;
      const fromBottom = h - 1 - j;
      const course = Math.floor(fromBottom / courseH);
      const inCourse = fromBottom % courseH;
      for (let xx = x0; xx <= x1; xx++) {
        // Hip ends are shaded: left catches light, right is in shade.
        const leftHip = xx - x < hip - j + hip && xx - x0 < hip && j < hip * 2;
        const rightHip = x1 - xx < hip && j < hip * 2;
        let c = color;
        if (kind === 'thatch') {
          c = shade(color, Math.sin(xx * 1.7 + course * 3) * 0.08 + (inCourse === 0 ? -0.22 : 0));
        } else {
          const tileIdx = Math.floor((xx - x + (course % 2) * Math.floor(tileW / 2)) / tileW);
          const tint = ((tileIdx * 7 + course * 13) % 5) / 5 - 0.5;
          c = shade(color, tint * 0.1);
          if (inCourse === 0) c = shade(color, -0.32);
          else if (inCourse === courseH - 1) c = shade(c, 0.12);
          const edge = (xx - x + (course % 2) * Math.floor(tileW / 2)) % tileW === 0;
          if (edge && inCourse <= 1) c = shade(color, -0.25);
        }
        if (rightHip) c = shade(c, -0.18);
        else if (leftHip) c = shade(c, 0.08);
        else if (xx > x + w * 0.72) c = shade(c, -0.07);
        this.b.set(xx, y + j, c);
      }
    }
    // Ridge cap.
    this.b.hline(x + hip, x + w - 1 - hip, y, shade(color, 0.28)).hline(x + hip, x + w - 1 - hip, y + 1, shade(color, -0.2));
    // Eave edge.
    this.b.hline(x, x + w - 1, y + h - 1, shade(color, -0.45));
    if (kind === 'thatch') for (let xx = x; xx < x + w; xx += 2) this.b.set(xx, y + h, shade(color, -0.35));
  }

  /** Dormer window poking out of a roof. */
  dormer(cx: number, y: number, roofColor: string, wall: string): void {
    this.b.rect(cx - 6, y + 4, 12, 9, wall);
    for (let j = 0; j < 6; j++) this.b.hline(cx - 7 - Math.floor(j / 2) + 3, cx + 7 + Math.floor(j / 2) - 3, y + j, j === 0 ? shade(roofColor, 0.25) : shade(roofColor, j % 2 ? -0.1 : 0));
    this.window(cx - 4, y + 6, 8, 6, { frame: shade(wall, -0.25) });
  }

  chimney(x: number, top: number, bottom: number, base = '#9a5a44'): void {
    this.brick(x, top + 2, 8, bottom - top - 2, base);
    this.b.rect(x - 1, top, 10, 2, '#6f6a66').hline(x - 1, x + 8, top, '#8a8580');
    this.b.rect(x + 2, top, 4, 1, '#2a2020');
    this.chimneys.push({ x: (x + 4) * ART_SCALE, y: -(this.h - top) * ART_SCALE });
  }

  // --- Openings -------------------------------------------------------------

  window(x: number, y: number, w: number, h: number, o: { frame: string; shutter?: string; arch?: boolean; box?: boolean; bars?: boolean }): void {
    const f = o.frame;
    this.b.rect(x - 1, y - 1, w + 2, h + 2, shade(f, -0.25));
    if (o.arch) this.b.rect(x, y - 2, w, 1, shade(f, -0.25)).hline(x + 1, x + w - 2, y - 3, shade(f, -0.25));
    for (let j = 0; j < h; j++) this.b.hline(x, x + w - 1, y + j, mix(GLASS_DARK, GLASS, j / h));
    if (o.arch) this.b.hline(x + 1, x + w - 2, y - 1, GLASS_DARK).hline(x + 1, x + w - 2, y - 2, GLASS_DARK);
    for (let i = 0; i < Math.min(w, h) - 2; i++) this.b.set(x + 1 + i, y + h - 2 - i, GLASS_HI); // glint
    this.b.vline(x + Math.floor(w / 2), y, y + h - 1, f).hline(x, x + w - 1, y + Math.floor(h / 2), f);
    if (o.bars) for (let xx = x + 2; xx < x + w; xx += 3) this.b.vline(xx, y, y + h - 1, IRON);
    this.b.hline(x - 2, x + w + 1, y + h + 1, shade(f, 0.15)).hline(x - 2, x + w + 1, y + h + 2, shade(f, -0.3));
    if (o.shutter) {
      for (const sx of [x - 4, x + w + 1]) {
        this.b.rect(sx, y - 1, 3, h + 2, o.shutter);
        for (let j = y; j < y + h + 1; j += 2) this.b.hline(sx, sx + 2, j, shade(o.shutter, -0.22));
      }
    }
    if (o.box) {
      this.b.rect(x - 1, y + h + 3, w + 2, 3, WOOD).hline(x - 1, x + w, y + h + 5, WOOD_DARK);
      const petals = ['#e0483a', '#f2c14e', '#e88ad0', '#ffffff', '#b06ad6'];
      for (let xx = x; xx < x + w; xx += 2) {
        this.b.set(xx, y + h + 2, '#4a9a3c');
        if (this.r() < 0.7) this.b.set(xx + (this.r() < 0.5 ? 1 : 0), y + h + 2, petals[Math.floor(this.r() * petals.length)]!);
      }
    }
    this.windows.push({ x: x * ART_SCALE, y: -(this.h - y) * ART_SCALE, w: w * ART_SCALE, h: h * ART_SCALE });
  }

  door(cx: number, bottom: number, o: { frame: string; w?: number; h?: number; color?: string; lanterns?: boolean }): void {
    const w = o.w ?? 14;
    const h = o.h ?? 22;
    const x = cx - Math.floor(w / 2);
    const top = bottom - h;
    // Stone arch surround.
    this.b.rect(x - 3, top + 2, w + 6, h - 1, o.frame);
    this.b.ellipse(x - 3, top - 2, w + 6, 10, o.frame);
    for (let i = 0; i < w + 6; i += 3) this.b.set(x - 3 + i, top - 1, shade(o.frame, -0.25));
    // Planks.
    const wood = o.color ?? WOOD;
    this.b.rect(x, top + 3, w, h - 3, wood);
    this.b.ellipse(x, top, w, 8, wood);
    for (let xx = x + 3; xx < x + w; xx += 3) this.b.vline(xx, top + 1, bottom - 1, shade(wood, -0.25));
    this.b.hline(x, x + w - 1, top + 7, IRON).hline(x, x + w - 1, bottom - 5, IRON);
    this.b.set(x + w - 4, top + h / 2 + 2, GOLD).set(x + w - 4, top + h / 2 + 3, shade(GOLD, -0.3));
    // Step.
    this.b.rect(x - 4, bottom - 2, w + 8, 2, shade(o.frame, 0.1)).hline(x - 4, x + w + 3, bottom - 1, shade(o.frame, -0.2));
    if (o.lanterns !== false) {
      for (const lx of [x - 6, x + w + 4]) {
        this.b.set(lx + 1, top + 5, IRON).rect(lx, top + 6, 3, 4, '#ffd27a').set(lx + 1, top + 7, '#fff3c4').hline(lx, lx + 2, top + 10, IRON);
        this.lights.push({ x: (lx + 1.5) * ART_SCALE, y: -(this.h - top - 8) * ART_SCALE, r: 14 });
      }
    }
  }

  awning(x: number, y: number, w: number, a: string, bColor = '#f4ecdc'): void {
    for (let j = 0; j < 6; j++) {
      for (let xx = x - Math.floor(j / 2); xx < x + w + Math.floor(j / 2); xx++) {
        const stripe = Math.floor((xx - x + 40) / 4) % 2 === 0 ? a : bColor;
        this.b.set(xx, y + j, j === 5 ? shade(stripe, -0.2) : j === 0 ? shade(stripe, 0.12) : stripe);
      }
    }
    for (let xx = x - 3; xx < x + w + 3; xx += 4) this.b.set(xx, y + 6, Math.floor((xx - x + 40) / 4) % 2 === 0 ? shade(a, -0.2) : shade(bColor, -0.2));
  }

  sign(cx: number, y: number, w: number): { x: number; y: number } {
    const x = Math.round(cx - w / 2);
    this.b.rect(x, y, w, 8, '#5e3a20').rect(x + 1, y + 1, w - 2, 6, '#b8844d').hline(x + 1, x + w - 2, y + 1, '#d0a06a');
    return { x: x + w / 2, y: y + 4 };
  }

  battlements(x: number, y: number, w: number, c: string, merlon = 5, gap = 3): void {
    for (let xx = x; xx < x + w; xx += merlon + gap) {
      const x1 = Math.min(x + w - 1, xx + merlon - 1);
      this.b.rect(xx, y, x1 - xx + 1, 5, c).hline(xx, x1, y, shade(c, 0.18)).vline(x1, y, y + 4, shade(c, -0.2));
    }
  }

  banner(x: number, y: number, len: number, color: string): void {
    this.b.rect(x - 1, y - 1, 9, 2, IRON);
    this.b.rect(x, y + 1, 7, len, color).vline(x + 6, y + 1, y + len, shade(color, -0.25)).vline(x, y + 1, y + len, shade(color, 0.15));
    this.b.set(x + 3, y + len, null).set(x + 2, y + len, null).set(x + 4, y + len, null).set(x + 3, y + len - 1, null);
    // Emblem: a little gold sprout (TerraGo's crest).
    const ey = y + Math.floor(len / 2) - 2;
    this.b.vline(x + 3, ey, ey + 4, GOLD).set(x + 2, ey + 1, GOLD).set(x + 4, ey, GOLD).set(x + 1, ey, GOLD).set(x + 5, ey - 1, GOLD);
  }

  flag(x: number, top: number, pole: number, color: string): void {
    this.b.vline(x, top, top + pole, IRON);
    for (let j = 0; j < 5; j++) this.b.hline(x + 1, x + 8 - Math.abs(j - 2), top + 1 + j, j === 4 ? shade(color, -0.25) : color);
    this.b.set(x, top - 1, GOLD);
  }

  torch(x: number, y: number): void {
    this.b.rect(x, y + 3, 2, 4, WOOD_DARK).rect(x - 1, y, 4, 3, '#ffb03a').set(x, y - 1, '#ffe48a').set(x + 1, y + 1, '#fff3c4');
    this.lights.push({ x: (x + 1) * ART_SCALE, y: -(this.h - y - 1) * ART_SCALE, r: 18 });
  }

  done(sign: { x: number; y: number }): BuildingArt {
    this.b.outline(OUTLINE);
    return {
      canvas: this.b.toCanvas(),
      signX: sign.x * ART_SCALE,
      signY: -(this.h - sign.y) * ART_SCALE,
      windows: this.windows,
      chimneys: this.chimneys,
      lights: this.lights,
    };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Window x positions along a wall, skipping the door. */
function windowSlots(w: number, doorCx: number, every: number, margin: number, gap = 18): number[] {
  const out: number[] = [];
  for (let x = margin; x + 10 <= w - margin; x += every) if (Math.abs(x + 5 - doorCx) > gap) out.push(x);
  return out;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Brick shop: clay-tile roof, quoins, shuttered windows, striped awning. */
function brickShop(def: BuildingDef, p: Painter, doorCx: number): { x: number; y: number } {
  const { w, h } = p;
  const wallH = 44;
  const wallTop = h - wallH;
  p.brick(1, wallTop, w - 2, wallH - 4, mix(def.wall, '#b5563c', 0.75));
  p.stone(1, h - 5, w - 2, 5, STONE, 5);
  p.quoins(1, wallTop, w - 2, wallH - 5, '#e2d6bf');
  p.roof(0, 0, w, wallTop + 1, def.roof, 'tile');
  p.b.hline(1, w - 2, wallTop + 1, '#3a2a2a').hline(1, w - 2, wallTop + 2, shade(mix(def.wall, '#b5563c', 0.75), -0.4));
  p.dormer(Math.round(w * 0.3), 6, def.roof, '#e8dcc4');
  p.chimney(w - 22, 2, wallTop - 4);
  for (const x of windowSlots(w, doorCx, 26, 10)) {
    p.awning(x - 3, wallTop + 7, 16, def.roof);
    p.window(x, wallTop + 15, 10, 11, { frame: '#efe6d2', box: true });
  }
  p.door(doorCx, h - 1, { frame: '#d8ccb4', color: '#6e4a2c' });
  return p.sign(doorCx, wallTop + 4, 34);
}

/** Two storeys: stone-and-brick ground floor, timber-framed upper floor. */
function timberInn(def: BuildingDef, p: Painter, doorCx: number): { x: number; y: number } {
  const { w, h } = p;
  const wallH = 58;
  const wallTop = h - wallH;
  const upperH = 24;
  p.timber(1, wallTop, w - 2, upperH, def.wall);
  p.b.hline(0, w - 1, wallTop + upperH, '#4a3020').hline(0, w - 1, wallTop + upperH + 1, '#6b4a2e');
  p.brick(1, wallTop + upperH + 2, w - 2, wallH - upperH - 7, '#9e5b42');
  p.stone(1, h - 5, w - 2, 5, STONE, 5);
  p.roof(0, 0, w, wallTop + 1, def.roof, 'tile');
  p.b.hline(1, w - 2, wallTop + 1, '#3a2a2a');
  p.chimney(w - 26, 0, wallTop - 2);
  if (w > 120) p.chimney(16, 4, wallTop - 2);
  p.dormer(Math.round(w / 2), 8, def.roof, def.wall);
  for (const x of windowSlots(w, -100, 28, 9)) p.window(x + 2, wallTop + 6, 8, 10, { frame: '#5a3a24', shutter: '#3f7d6a', box: true });
  for (const x of windowSlots(w, doorCx, 24, 8)) p.window(x, wallTop + upperH + 9, 10, 12, { frame: '#e2d6bf', arch: true });
  p.door(doorCx, h - 1, { frame: '#cfc3ab', w: 16, h: 24 });
  // Hanging sign on an iron bracket.
  const sx = Math.min(w - 26, doorCx + 14);
  p.b.hline(sx - 2, sx + 22, wallTop + upperH + 3, IRON);
  return p.sign(sx + 10, wallTop + upperH + 5, 22);
}

/** Heavy stone workshop with a big forge chimney. */
function stoneWorkshop(def: BuildingDef, p: Painter, doorCx: number): { x: number; y: number } {
  const { w, h } = p;
  const wallH = 46;
  const wallTop = h - wallH;
  p.stone(1, wallTop, w - 2, wallH, mix(def.wall, STONE, 0.7), 6);
  p.roof(0, 0, w, wallTop + 1, def.roof, 'slate');
  p.b.hline(1, w - 2, wallTop + 1, '#2a2430');
  p.chimney(10, 0, wallTop + 6, '#7a706a');
  p.chimney(w - 20, 6, wallTop - 2, '#7a706a');
  for (const x of windowSlots(w, doorCx, 26, 12)) p.window(x, wallTop + 12, 10, 12, { frame: '#d0c6b4', arch: true, bars: true });
  // Forge mouth glowing beside the door.
  const fx = doorCx < w / 2 ? w - 26 : 8;
  p.b.rect(fx, h - 18, 16, 13, '#5a524c').ellipse(fx + 2, h - 16, 12, 10, '#2a1a14');
  p.b.rect(fx + 4, h - 10, 8, 4, '#ff8a2a').hline(fx + 5, fx + 10, h - 11, '#ffd27a').set(fx + 7, h - 12, '#fff3c4');
  p.lights.push({ x: (fx + 8) * ART_SCALE, y: -12 * ART_SCALE, r: 26 });
  p.door(doorCx, h - 1, { frame: '#cbbfae', color: '#5e4430' });
  return p.sign(doorCx, wallTop + 4, 34);
}

/** Marble bank: columns, a pediment and broad steps. */
function marbleBank(def: BuildingDef, p: Painter, doorCx: number): { x: number; y: number } {
  const { w, h } = p;
  const wallH = 54;
  const wallTop = h - wallH;
  p.stone(1, wallTop, w - 2, wallH, MARBLE, 6);
  p.roof(0, 0, w, wallTop - 8, def.roof, 'slate');
  // Pediment (triangular gable over the portico).
  const pw = w - 16;
  const px = 8;
  const ph = 14;
  const py = wallTop - 10;
  for (let j = 0; j < ph; j++) {
    const half = Math.round(((j + 1) / ph) * (pw / 2));
    p.b.hline(px + pw / 2 - half, px + pw / 2 + half - 1, py + j, j === ph - 1 ? shade(MARBLE, -0.2) : j < 2 ? shade(MARBLE, 0.1) : MARBLE);
  }
  for (let j = 3; j < ph - 2; j++) {
    const half = Math.round(((j + 1) / ph) * (pw / 2)) - 4;
    if (half > 0) p.b.hline(px + pw / 2 - half, px + pw / 2 + half - 1, py + j, shade(def.roof, -0.1));
  }
  p.b.rect(Math.round(px + pw / 2 - 3), py + 6, 6, 5, GOLD).set(Math.round(px + pw / 2 - 1), py + 7, shade(GOLD, -0.3));
  p.b.rect(4, py + ph, w - 8, 4, shade(MARBLE, 0.08)).hline(4, w - 5, py + ph + 3, shade(MARBLE, -0.3));
  // Shadowed interior behind the columns.
  p.b.rect(8, py + ph + 4, w - 16, h - (py + ph + 4) - 6, shade(MARBLE, -0.3));
  for (const x of windowSlots(w, doorCx, 24, 14, 14)) p.window(x, py + ph + 12, 10, 14, { frame: '#cfc6b6', arch: true, bars: true });
  p.door(doorCx, h - 6, { frame: shade(MARBLE, -0.1), w: 16, h: 24, color: '#5a3a24', lanterns: false });
  // Columns.
  const cols = Math.max(4, Math.round(w / 26));
  for (let i = 0; i < cols; i++) {
    const cx = Math.round(10 + (i * (w - 26)) / (cols - 1));
    if (Math.abs(cx + 3 - doorCx) < 12) continue;
    const top = py + ph + 4;
    p.b.rect(cx, top, 7, h - 6 - top, MARBLE).vline(cx, top, h - 7, '#fbf8f1').vline(cx + 5, top, h - 7, shade(MARBLE, -0.22)).vline(cx + 6, top, h - 7, shade(MARBLE, -0.35));
    p.b.vline(cx + 2, top + 2, h - 8, shade(MARBLE, -0.1)).vline(cx + 4, top + 2, h - 8, shade(MARBLE, -0.1));
    p.b.rect(cx - 1, top, 9, 2, shade(MARBLE, 0.1)).rect(cx - 1, h - 8, 9, 2, shade(MARBLE, -0.05));
  }
  // Steps.
  for (let s = 0; s < 3; s++) p.b.rect(2 + s * 2, h - 6 + s * 2, w - 4 - s * 4, 2, s % 2 ? shade(MARBLE, -0.12) : MARBLE);
  p.torch(4, h - 26);
  p.torch(w - 6, h - 26);
  return { x: px + pw / 2, y: py + ph + 1.5 };
}

/** Small stone cottage with a thatched roof. */
function cottage(def: BuildingDef, p: Painter, doorCx: number): { x: number; y: number } {
  const { w, h } = p;
  const wallH = 40;
  const wallTop = h - wallH;
  p.stone(1, wallTop, w - 2, wallH, '#b8ab98', 5);
  p.roof(0, 0, w, wallTop + 2, mix(def.roof, '#c9a24e', 0.75), 'thatch');
  p.chimney(w - 22, 0, wallTop - 2, '#8a7d70');
  for (const x of windowSlots(w, doorCx, 26, 10)) p.window(x, wallTop + 12, 10, 10, { frame: '#e8dcc4', shutter: '#4b6f9e', box: true });
  p.door(doorCx, h - 1, { frame: '#cfc3ab', color: '#7a4a2a' });
  return p.sign(doorCx, wallTop + 5, 30);
}

/** A castle: two towers with cone roofs, a crenellated curtain wall, a keep behind, gate and banners. */
function castle(def: BuildingDef, p: Painter, doorCx: number): { x: number; y: number } {
  const { w, h } = p;
  const stoneC = mix(def.wall, '#a8a196', 0.75);
  const tw = Math.min(34, Math.round(w * 0.24));
  const wallH = 50;
  const wallTop = h - wallH;
  // Keep (behind the curtain wall).
  const kx = tw + 6;
  const kw = w - kx * 2;
  const kTop = 44;
  p.stone(kx, kTop, kw, wallTop - kTop + 6, shade(stoneC, -0.08), 6);
  p.battlements(kx, kTop - 5, kw, shade(stoneC, -0.04));
  for (const x of [kx + 6, kx + kw - 14]) p.window(x, kTop + 8, 8, 12, { frame: '#d8cfbf', arch: true, bars: true });
  p.shadeCols(kx, kTop - 5, kw, wallTop - kTop + 11, (k) => 0.06 - k * 0.2);
  p.flag(Math.round(w / 2), kTop - 24, 18, def.roof);
  // Curtain wall.
  p.stone(tw - 4, wallTop, w - (tw - 4) * 2, wallH, stoneC, 6);
  p.battlements(tw - 4, wallTop - 5, w - (tw - 4) * 2, stoneC);
  p.b.hline(tw - 4, w - tw + 3, wallTop + 1, shade(stoneC, -0.3));
  // Towers.
  for (const tx of [0, w - tw]) {
    const top = 40;
    p.stone(tx + 1, top, tw - 2, h - top, shade(stoneC, 0.06), 6);
    // Round tower: light on the left, deep shade on the right.
    p.shadeCols(tx + 1, top, tw - 2, h - top, (k) => 0.22 - k * 0.55);
    // Plinth at the foot and a shadow cast onto the curtain wall.
    p.b.rect(tx, h - 7, tw, 7, shade(stoneC, -0.05)).hline(tx, tx + tw - 1, h - 7, shade(stoneC, 0.2));
    p.shadeCols(tx, h - 7, tw, 7, (k) => 0.15 - k * 0.45);
    const castX = tx === 0 ? tw : tx - 4;
    if (tx === 0) for (let yy = wallTop; yy < h - 1; yy++) for (let xx = castX; xx < castX + 4; xx++) { const c = p.b.get(xx, yy); if (c) p.b.set(xx, yy, shade(c, -0.25)); }
    // Crenellated parapet ring.
    p.b.rect(tx - 2, top - 3, tw + 4, 5, shade(stoneC, 0.1));
    p.battlements(tx - 2, top - 8, tw + 4, shade(stoneC, 0.05), 4, 3);
    p.shadeCols(tx - 2, top - 8, tw + 4, 10, (k) => 0.18 - k * 0.45);
    p.b.hline(tx - 2, tx + tw + 1, top + 2, shade(stoneC, -0.45));
    // Cone roof.
    const coneH = 26;
    const half0 = tw / 2 - 1;
    for (let j = 0; j < coneH; j++) {
      const half = Math.round(((j + 1) / coneH) * half0);
      for (let xx = -half; xx < half; xx++) {
        const course = Math.floor((coneH - j) / 3);
        let c = shade(def.roof, xx < -half / 3 ? 0.1 : xx > half / 3 ? -0.2 : 0);
        if ((coneH - j) % 3 === 0) c = shade(c, -0.25);
        else if ((xx + course * 2 + 40) % 5 === 0) c = shade(c, -0.12);
        p.b.set(Math.round(tx + tw / 2) + xx, top - 9 - coneH + j, c);
      }
    }
    p.flag(Math.round(tx + tw / 2), top - coneH - 19, 10, def.roof);
    // Arrow slits and a lit window.
    const cx = Math.round(tx + tw / 2);
    for (const sy of [top + 10, h - 26]) p.b.rect(cx - 2, sy - 1, 4, 9, shade(stoneC, 0.12)).rect(cx - 1, sy, 2, 7, '#1e1a22');
    p.window(cx - 4, top + 24, 8, 8, { frame: '#d8cfbf', arch: true });
  }
  // Gate.
  const gw = 26;
  const gx = doorCx - gw / 2;
  const gTop = h - 34;
  p.b.ellipse(gx - 5, gTop - 6, gw + 10, 22, shade(stoneC, 0.22));
  p.b.rect(gx - 5, gTop + 4, gw + 10, h - gTop - 4, shade(stoneC, 0.22));
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    p.b.set(Math.round(doorCx + Math.cos(a) * (gw / 2 + 3)), Math.round(gTop + 5 + Math.sin(a) * 9), shade(stoneC, -0.35));
  }
  p.b.ellipse(gx, gTop - 2, gw, 16, '#1e1a22').rect(gx, gTop + 6, gw, h - gTop - 6, '#1e1a22');
  // Wooden doors in the lower half, portcullis teeth above.
  p.b.rect(gx + 1, gTop + 12, gw - 2, h - gTop - 13, '#6a4428');
  for (let xx = gx + 3; xx < gx + gw - 1; xx += 3) p.b.vline(xx, gTop + 12, h - 2, '#4e3018');
  p.b.vline(doorCx, gTop + 12, h - 2, '#2a1a10').hline(gx + 1, gx + gw - 2, gTop + 16, IRON).hline(gx + 1, gx + gw - 2, h - 6, IRON);
  for (let xx = gx + 2; xx < gx + gw - 1; xx += 4) {
    p.b.vline(xx, gTop - 1, gTop + 9, '#5a5560');
    p.b.set(xx, gTop + 10, '#8a8590');
  }
  for (let yy = gTop + 1; yy < gTop + 10; yy += 4) p.b.hline(gx + 1, gx + gw - 2, yy, '#5a5560');
  // Banners and torches.
  p.banner(gx - 16, wallTop + 8, 26, def.roof);
  p.banner(gx + gw + 9, wallTop + 8, 26, def.roof);
  p.torch(gx - 5, gTop - 2);
  p.torch(gx + gw + 4, gTop - 2);
  // Sign stone above the gate.
  p.b.rect(doorCx - 20, wallTop + 3, 40, 8, shade(stoneC, 0.25)).hline(doorCx - 20, doorCx + 19, wallTop + 10, shade(stoneC, -0.25));
  // Ivy.
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(p.r() * w);
    const y0 = h - 2 - Math.floor(p.r() * 12);
    if (Math.abs(x - doorCx) < gw / 2 + 6) continue;
    if (p.b.get(x, y0)) p.b.set(x, y0, p.r() < 0.5 ? '#4a8a3c' : '#5ca84a');
  }
  return { x: doorCx, y: wallTop + 7 };
}

/** Extra canvas height above the tile footprint, per style. */
const HEADROOM: Record<BuildingStyle, number> = { brick: 16, timber: 22, stone: 14, marble: 18, cottage: 10, castle: 62 };

export function buildingArt(def: BuildingDef): BuildingArt {
  const style = styleOf(def);
  const w = def.w * T;
  const h = def.h * T + HEADROOM[style];
  const p = new Painter(w, h, hash(def.id + def.name));
  const doorCx = def.doorX * T + T / 2;
  const sign =
    style === 'castle'
      ? castle(def, p, doorCx)
      : style === 'marble'
        ? marbleBank(def, p, doorCx)
        : style === 'timber'
          ? timberInn(def, p, doorCx)
          : style === 'stone'
            ? stoneWorkshop(def, p, doorCx)
            : style === 'cottage'
              ? cottage(def, p, doorCx)
              : brickShop(def, p, doorCx);
  return p.done(sign);
}
