/**
 * HD painted ground. Each terrain (grass, dirt, cobbles, sand, water, lava...)
 * is a hand-painted tileable texture; the map's tiles become soft, slightly
 * organic masks so terrains blend into each other instead of meeting on a
 * square grid. Output is a set of chunk canvases (GPU-friendly sizes).
 */
import type { GroundTileKey, MapDef } from '@terrago/shared';

const TILE = 32; // world px per tile

// ---------------------------------------------------------------------------
// Random helpers
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function mixHex(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Tileable texture painters (S×S texture px)
// ---------------------------------------------------------------------------

const S = 256;

type Painter = (g: CanvasRenderingContext2D, r: () => number) => void;

/** Draw something at (x, y) and its wrapped copies so the texture tiles. */
function wrap(x: number, y: number, pad: number, f: (x: number, y: number) => void): void {
  for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) if (x + dx > -pad && x + dx < S + pad && y + dy > -pad && y + dy < S + pad) f(x + dx, y + dy);
}

function blotches(g: CanvasRenderingContext2D, r: () => number, colors: string[], n: number, rmin: number, rmax: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = rmin + r() * (rmax - rmin);
    const c = colors[Math.floor(r() * colors.length)]!;
    wrap(x, y, rad, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, rad);
      gr.addColorStop(0, hexA(c, alpha));
      gr.addColorStop(1, hexA(c, 0));
      g.fillStyle = gr;
      g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }
}

function grassPainter(base: string, dark: string, light: string, blades = 1500, flowers = 0): Painter {
  return (g, r) => {
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    blotches(g, r, [dark, light], 26, 20, 60, 0.35);
    g.lineCap = 'round';
    for (let i = 0; i < blades; i++) {
      const x = r() * S;
      const y = r() * S;
      const len = 3 + r() * 6;
      const ang = -Math.PI / 2 + (r() - 0.5) * 0.9;
      const t = r();
      g.strokeStyle = t < 0.45 ? mixHex(dark, base, r() * 0.5) : mixHex(light, base, r() * 0.6);
      g.lineWidth = 1 + r() * 1.2;
      wrap(x, y, 10, (px, py) => {
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        g.stroke();
      });
    }
    const petals = ['#ffffff', '#ffe066', '#ff8ab0', '#b48aff', '#7ad0ff'];
    for (let i = 0; i < flowers; i++) {
      const x = r() * S;
      const y = r() * S;
      const c = petals[Math.floor(r() * petals.length)]!;
      wrap(x, y, 6, (px, py) => {
        g.fillStyle = 'rgba(30,60,20,0.35)';
        g.beginPath();
        g.ellipse(px + 1, py + 2, 3.5, 2, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = c;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          g.beginPath();
          g.arc(px + Math.cos(a) * 2.2, py + Math.sin(a) * 2.2, 1.7, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#ffd23a';
        g.beginPath();
        g.arc(px, py, 1.3, 0, Math.PI * 2);
        g.fill();
      });
    }
  };
}

function dirtPainter(base: string, dark: string, light: string, pebbles = 70): Painter {
  return (g, r) => {
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    blotches(g, r, [dark, light], 30, 14, 48, 0.4);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = hexA(r() < 0.5 ? dark : light, 0.35);
      g.fillRect(r() * S, r() * S, 1.5, 1.5);
    }
    for (let i = 0; i < pebbles; i++) {
      const x = r() * S;
      const y = r() * S;
      const w = 1.5 + r() * 3.5;
      const h = w * (0.6 + r() * 0.3);
      wrap(x, y, 8, (px, py) => {
        g.fillStyle = hexA(dark, 0.6);
        g.beginPath();
        g.ellipse(px + 0.8, py + 1, w, h, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = mixHex(light, '#ffffff', 0.2);
        g.beginPath();
        g.ellipse(px, py, w, h, 0, 0, Math.PI * 2);
        g.fill();
      });
    }
  };
}

function stonePainter(mortar: string, stone: string, size: number, jitter: number, moss = 0): Painter {
  return (g, r) => {
    g.fillStyle = mortar;
    g.fillRect(0, 0, S, S);
    const n = Math.round(S / size);
    const cell = S / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const off = j % 2 ? cell / 2 : 0;
        const cx = i * cell + off + cell / 2 + (r() - 0.5) * jitter;
        const cy = j * cell + cell / 2 + (r() - 0.5) * jitter;
        const w = cell * (0.4 + r() * 0.06);
        const h = cell * (0.38 + r() * 0.06);
        const tone = mixHex(stone, r() < 0.5 ? '#000000' : '#ffffff', r() * 0.16);
        wrap(cx, cy, cell, (px, py) => {
          g.fillStyle = 'rgba(0,0,0,0.28)';
          g.beginPath();
          g.roundRect(px - w + 1, py - h + 2, w * 2, h * 2, Math.min(w, h) * 0.6);
          g.fill();
          const gr = g.createLinearGradient(px - w, py - h, px + w, py + h);
          gr.addColorStop(0, mixHex(tone, '#ffffff', 0.22));
          gr.addColorStop(1, mixHex(tone, '#000000', 0.12));
          g.fillStyle = gr;
          g.beginPath();
          g.roundRect(px - w, py - h, w * 2, h * 2, Math.min(w, h) * 0.6);
          g.fill();
          if (moss && r() < moss) {
            g.fillStyle = 'rgba(90,140,60,0.45)';
            g.beginPath();
            g.ellipse(px - w * 0.5, py + h * 0.5, w * 0.5, h * 0.35, 0, 0, Math.PI * 2);
            g.fill();
          }
        });
      }
  };
}

const waterPainter =
  (deep: string, light: string): Painter =>
  (g, r) => {
    g.fillStyle = deep;
    g.fillRect(0, 0, S, S);
    blotches(g, r, [light, mixHex(deep, '#000000', 0.2)], 20, 30, 70, 0.3);
    g.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const x = r() * S;
      const y = r() * S;
      const w = 6 + r() * 14;
      g.strokeStyle = hexA('#ffffff', 0.12 + r() * 0.18);
      g.lineWidth = 1.2;
      wrap(x, y, 24, (px, py) => {
        g.beginPath();
        g.moveTo(px - w, py);
        g.quadraticCurveTo(px, py - 3, px + w, py);
        g.stroke();
      });
    }
  };

const lavaPainter: Painter = (g, r) => {
  g.fillStyle = '#ff6a1a';
  g.fillRect(0, 0, S, S);
  blotches(g, r, ['#ffd23a', '#ff3a10'], 30, 14, 40, 0.6);
  // Dark crust plates with glowing seams.
  for (let i = 0; i < 26; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 10 + r() * 22;
    wrap(x, y, rad, (px, py) => {
      g.fillStyle = 'rgba(40,10,6,0.85)';
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = rad * (0.7 + r() * 0.3);
        if (k === 0) g.moveTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
        else g.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    });
  }
};

const snowPainter: Painter = (g, r) => {
  g.fillStyle = '#eef4fb';
  g.fillRect(0, 0, S, S);
  blotches(g, r, ['#cfdcf0', '#ffffff'], 30, 20, 60, 0.6);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(170,190,225,0.5)';
    g.fillRect(r() * S, r() * S, 1.5, 1.5);
  }
};

const sandPainter = (base: string): Painter => (g, r) => {
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  blotches(g, r, [mixHex(base, '#a07040', 0.3), mixHex(base, '#ffffff', 0.3)], 24, 20, 60, 0.4);
  g.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const y = r() * S;
    const x = r() * S;
    const w = 14 + r() * 24;
    g.strokeStyle = hexA(mixHex(base, '#8a5a2a', 0.4), 0.25);
    g.lineWidth = 1.4;
    wrap(x, y, 40, (px, py) => {
      g.beginPath();
      g.moveTo(px - w, py);
      g.quadraticCurveTo(px, py - 4, px + w, py);
      g.stroke();
    });
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = hexA(r() < 0.5 ? '#ffffff' : '#8a6a3a', 0.25);
    g.fillRect(r() * S, r() * S, 1.2, 1.2);
  }
};

const soilPainter: Painter = (g, r) => {
  g.fillStyle = '#6b4a2e';
  g.fillRect(0, 0, S, S);
  blotches(g, r, ['#4a311d', '#86603c'], 26, 16, 40, 0.45);
  for (let y = 4; y < S; y += 16) {
    g.fillStyle = 'rgba(40,24,12,0.35)';
    g.fillRect(0, y, S, 4);
    g.fillStyle = 'rgba(160,120,80,0.25)';
    g.fillRect(0, y - 3, S, 2);
  }
};

const rockPainter = (base: string, dark: string): Painter => (g, r) => {
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  blotches(g, r, [dark, mixHex(base, '#ffffff', 0.25)], 26, 16, 50, 0.5);
  for (let i = 0; i < 46; i++) {
    const x = r() * S;
    const y = r() * S;
    const w = 8 + r() * 22;
    const h = 5 + r() * 12;
    wrap(x, y, 30, (px, py) => {
      g.fillStyle = hexA(dark, 0.55);
      g.beginPath();
      g.ellipse(px + 1.5, py + 2.5, w, h, r(), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hexA(mixHex(base, '#ffffff', 0.18), 0.85);
      g.beginPath();
      g.ellipse(px, py, w, h, r(), 0, Math.PI * 2);
      g.fill();
    });
  }
  g.strokeStyle = hexA(dark, 0.6);
  g.lineWidth = 1.2;
  for (let i = 0; i < 30; i++) {
    let x = r() * S;
    let y = r() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (r() - 0.5) * 18;
      y += (r() - 0.5) * 18;
      g.lineTo(x, y);
    }
    g.stroke();
  }
};

/** Weathered ground with scattered broken flagstones. */
const ruinPainter = (dust: string, slab: string): Painter => (g, r) => {
  dirtPainter(dust, mixHex(dust, '#3a2a1a', 0.35), mixHex(dust, '#ffffff', 0.25), 40)(g, r);
  for (let i = 0; i < 14; i++) {
    const x = r() * S;
    const y = r() * S;
    const w = 14 + r() * 18;
    const h = 10 + r() * 12;
    const tone = mixHex(slab, r() < 0.5 ? '#000000' : '#ffffff', r() * 0.15);
    wrap(x, y, 40, (px, py) => {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.roundRect(px - w + 1, py - h + 2, w * 2, h * 2, 3);
      g.fill();
      g.fillStyle = tone;
      g.beginPath();
      g.roundRect(px - w, py - h, w * 2, h * 2, 3);
      g.fill();
      g.strokeStyle = 'rgba(40,30,20,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px - w * 0.6, py - h);
      g.lineTo(px - w * 0.1, py + h * 0.2);
      g.lineTo(px + w * 0.4, py + h);
      g.stroke();
      if (r() < 0.4) {
        g.fillStyle = 'rgba(90,140,60,0.4)';
        g.beginPath();
        g.ellipse(px + w * 0.5, py - h * 0.4, w * 0.4, h * 0.4, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
  }
};

const plankPainter: Painter = (g, r) => {
  const ph = 16;
  for (let y = 0; y < S; y += ph) {
    const c = mixHex('#9a6a3e', r() < 0.5 ? '#000000' : '#ffffff', r() * 0.12);
    g.fillStyle = c;
    g.fillRect(0, y, S, ph);
    g.fillStyle = 'rgba(40,20,10,0.55)';
    g.fillRect(0, y + ph - 2, S, 2);
    g.fillStyle = 'rgba(255,230,190,0.18)';
    g.fillRect(0, y, S, 2);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(60,30,15,0.25)';
      g.fillRect(r() * S, y + 4 + r() * 8, 10 + r() * 30, 1);
    }
    const seam = r() * S;
    g.fillStyle = 'rgba(40,20,10,0.5)';
    g.fillRect(seam, y, 2, ph);
  }
};

// ---------------------------------------------------------------------------
// Terrain layers
// ---------------------------------------------------------------------------

interface Layer {
  id: string;
  keys: GroundTileKey[];
  paint: Painter;
  /** Mask softness / wobble (0 = crisp tile edges). */
  wobble: number;
  /** Extra effect drawn under the layer. */
  under?: 'cliffShadow' | 'shore' | 'glow';
}

function layersFor(map: MapDef): Layer[] {
  const theme = map.theme ?? 'meadow';
  const lush = theme === 'forest' || theme === 'swamp';
  const grass =
    theme === 'swamp'
      ? grassPainter('#5d7a3e', '#3f5a2a', '#7a9a52', 1300)
      : theme === 'desert' || theme === 'ruins'
        ? grassPainter('#9aa856', '#748238', '#bcc670', 1100)
        : theme === 'snow' || theme === 'peak'
          ? grassPainter('#7aa070', '#56785a', '#9ac08e', 1100)
          : grassPainter(lush ? '#4f9a46' : '#62b04e', lush ? '#3a7a34' : '#4a9040', lush ? '#78c060' : '#8ad46a', 1600);
  return [
    { id: 'grass', keys: ['.', ',', '*', 'f'], paint: grass, wobble: 0.3 },
    { id: 'tall', keys: [','], paint: grassPainter('#4a9040', '#357430', '#6ab450', 2400), wobble: 0.35 },
    { id: 'forest', keys: ['f'], paint: grassPainter('#3f7a36', '#2c5a28', '#5a9446', 1800), wobble: 0.35 },
    { id: 'flowers', keys: ['*'], paint: grassPainter('#62b04e', '#4a9040', '#8ad46a', 900, 110), wobble: 0.35 },
    { id: 'sand', keys: ['s', 'h'], paint: sandPainter(theme === 'desert' ? '#e8c27c' : '#ecd49a'), wobble: 0.35 },
    { id: 'soil', keys: ['d'], paint: soilPainter, wobble: 0.15 },
    { id: 'mud', keys: ['u'], paint: dirtPainter('#6e5236', '#4e3a26', '#8a6a48', 30), wobble: 0.35 },
    { id: 'dirt', keys: ['='], paint: dirtPainter('#c49a64', '#9a7446', '#dcb882'), wobble: 0.32 },
    { id: 'ash', keys: ['a'], paint: dirtPainter('#5a5250', '#3a3434', '#7a706a', 60), wobble: 0.3 },
    { id: 'snow', keys: ['n'], paint: snowPainter, wobble: 0.35 },
    { id: 'cave', keys: ['c'], paint: rockPainter('#5a5260', '#3a3440'), wobble: 0.25 },
    { id: 'cobble', keys: [':'], paint: stonePainter('#6c655e', '#a8a096', 22, 3), wobble: 0.12 },
    { id: 'plaza', keys: ['_'], paint: stonePainter('#8a8378', '#cfc6b6', 32, 1), wobble: 0.08 },
    { id: 'ruin', keys: ['k'], paint: ruinPainter(theme === 'volcano' ? '#5a4a44' : theme === 'snow' || theme === 'peak' ? '#9aa0a8' : '#a89474', theme === 'volcano' ? '#6a5a56' : '#c2b496'), wobble: 0.3 },
    { id: 'cliff', keys: ['#', 'r'], paint: rockPainter(theme === 'snow' || theme === 'peak' ? '#9aa4b4' : theme === 'volcano' ? '#4a3a3a' : '#7a6a5e', '#3a302c'), wobble: 0.25, under: 'cliffShadow' },
    { id: 'water', keys: ['~', 'w'], paint: waterPainter('#2f78c0', '#5ab0e8'), wobble: 0.3, under: 'shore' },
    { id: 'shallow', keys: ['w'], paint: waterPainter('#4aa0d8', '#8ad4f4'), wobble: 0.3 },
    { id: 'ice', keys: ['I'], paint: waterPainter('#7ab8de', '#d8f0ff'), wobble: 0.25, under: 'shore' },
    { id: 'swamp', keys: ['q'], paint: waterPainter('#3a5a3a', '#6a8a5a'), wobble: 0.3, under: 'shore' },
    { id: 'lava', keys: ['L'], paint: lavaPainter, wobble: 0.3, under: 'glow' },
    { id: 'bridge', keys: ['b'], paint: plankPainter, wobble: 0 },
  ];
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

const MASK_RES = 8; // mask px per tile

/** Soft organic coverage mask for a set of tiles (alpha channel), MASK_RES px per tile. */
function buildMask(map: MapDef, keys: Set<string>, wobble: number, seed: number): HTMLCanvasElement | null {
  const W = map.width;
  const H = map.height;
  const cov = new Float32Array(W * H);
  let any = false;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (keys.has(map.tiles[y]![x] ?? '.')) {
        cov[y * W + x] = 1;
        any = true;
      }
  if (!any) return null;
  const mw = W * MASK_RES;
  const mh = H * MASK_RES;
  const c = canvas(mw, mh);
  const g = c.getContext('2d')!;
  const img = g.createImageData(mw, mh);
  const d = img.data;
  const at = (x: number, y: number) => cov[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))]!;
  for (let py = 0; py < mh; py++) {
    const ty = (py + 0.5) / MASK_RES - 0.5;
    const y0 = Math.floor(ty);
    const fy = ty - y0;
    for (let px = 0; px < mw; px++) {
      const tx = (px + 0.5) / MASK_RES - 0.5;
      const x0 = Math.floor(tx);
      const fx = tx - x0;
      const a = at(x0, y0);
      const b = at(x0 + 1, y0);
      const cc = at(x0, y0 + 1);
      const dd = at(x0 + 1, y0 + 1);
      let v = a + (b - a) * fx + (cc - a) * fy + (a - b - cc + dd) * fx * fy;
      if (v <= 0 || v >= 1 || !wobble) {
        if (!wobble) v = at(Math.floor((px + 0.5) / MASK_RES), Math.floor((py + 0.5) / MASK_RES));
      } else {
        const n = vnoise(px / 9, py / 9, seed) * 0.65 + vnoise(px / 3.5, py / 3.5, seed + 7) * 0.35;
        v = v + (n - 0.5) * wobble * 2;
        v = Math.max(0, Math.min(1, (v - 0.4) / 0.2));
      }
      d[(py * mw + px) * 4 + 3] = Math.round(v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export interface GroundChunk {
  canvas: HTMLCanvasElement;
  /** World px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Texture px per world px for the ground. */
export function groundRes(): number {
  if (typeof window === 'undefined') return 1.5;
  return window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
}

const CHUNK_TILES = 16;

export function renderGroundHd(map: MapDef, res = groundRes()): GroundChunk[] {
  const layers = layersFor(map);
  const seedBase = [...map.id].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) >>> 0;
  const pats: { layer: Layer; tex: HTMLCanvasElement; mask: HTMLCanvasElement }[] = [];
  layers.forEach((layer, i) => {
    const mask = buildMask(map, new Set(layer.keys), layer.wobble, seedBase + i * 101);
    if (!mask) return;
    const tex = canvas(S, S);
    layer.paint(tex.getContext('2d')!, rng(seedBase + i * 977));
    pats.push({ layer, tex, mask });
  });
  // Large-scale light variation over everything (painted feel).
  const tint = canvas(map.width * 2, map.height * 2);
  {
    const g = tint.getContext('2d')!;
    const img = g.createImageData(tint.width, tint.height);
    for (let y = 0; y < tint.height; y++)
      for (let x = 0; x < tint.width; x++) {
        const n = vnoise(x / 6, y / 6, seedBase + 3);
        const i = (y * tint.width + x) * 4;
        const light = n > 0.5;
        img.data[i] = light ? 255 : 0;
        img.data[i + 1] = light ? 250 : 10;
        img.data[i + 2] = light ? 210 : 30;
        img.data[i + 3] = Math.round(Math.abs(n - 0.5) * 2 * 46);
      }
    g.putImageData(img, 0, 0);
  }
  const out: GroundChunk[] = [];
  const texScale = 1 / 1; // texture px are drawn 1:1 at chunk resolution
  for (let cy = 0; cy < map.height; cy += CHUNK_TILES)
    for (let cx = 0; cx < map.width; cx += CHUNK_TILES) {
      const tw = Math.min(CHUNK_TILES, map.width - cx);
      const th = Math.min(CHUNK_TILES, map.height - cy);
      const wx = cx * TILE;
      const wy = cy * TILE;
      const ww = tw * TILE;
      const wh = th * TILE;
      const c = canvas(ww * res, wh * res);
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.fillStyle = '#3a6a34';
      g.fillRect(0, 0, c.width, c.height);
      const tmp = canvas(c.width, c.height);
      const tg = tmp.getContext('2d')!;
      tg.imageSmoothingEnabled = true;
      tg.imageSmoothingQuality = 'high';
      const k = res; // canvas px per world px
      const mk = MASK_RES / TILE; // mask px per world px
      // Mask region (with a 1-tile margin so blurred edges match across chunks).
      const msx = cx * MASK_RES;
      const msy = cy * MASK_RES;
      const msw = tw * MASK_RES;
      const msh = th * MASK_RES;
      for (const { layer, tex, mask } of pats) {
        const drawMask = (ctx: CanvasRenderingContext2D, dx = 0, dy = 0) => ctx.drawImage(mask, msx, msy, msw, msh, dx * k, dy * k, c.width, c.height);
        if (layer.under === 'cliffShadow') {
          // Cliffs cast a soft shadow onto the ground below them.
          tg.clearRect(0, 0, tmp.width, tmp.height);
          drawMask(tg, 0, 12);
          tg.globalCompositeOperation = 'source-in';
          tg.fillStyle = 'rgba(10,12,24,0.45)';
          tg.fillRect(0, 0, tmp.width, tmp.height);
          tg.globalCompositeOperation = 'source-over';
          g.drawImage(tmp, 0, 0);
        } else if (layer.under === 'shore' || layer.under === 'glow') {
          // A wet rim / heat glow just outside the edge.
          tg.clearRect(0, 0, tmp.width, tmp.height);
          if ('filter' in tg) tg.filter = `blur(${Math.round(5 * k)}px)`;
          drawMask(tg);
          tg.filter = 'none';
          tg.globalCompositeOperation = 'source-in';
          tg.fillStyle = layer.under === 'glow' ? 'rgba(255,120,40,0.7)' : 'rgba(225,240,230,0.55)';
          tg.fillRect(0, 0, tmp.width, tmp.height);
          tg.globalCompositeOperation = 'source-over';
          g.drawImage(tmp, 0, 0);
        }
        // Texture, continuous across chunks.
        tg.clearRect(0, 0, tmp.width, tmp.height);
        const pat = tg.createPattern(tex, 'repeat')!;
        pat.setTransform(new DOMMatrix().translate(-((wx * k) % S), -((wy * k) % S)).scale(texScale));
        tg.fillStyle = pat;
        tg.fillRect(0, 0, tmp.width, tmp.height);
        tg.globalCompositeOperation = 'destination-in';
        drawMask(tg);
        tg.globalCompositeOperation = 'source-over';
        g.drawImage(tmp, 0, 0);
        // Water gets darker away from the shore.
        if (layer.id === 'water' || layer.id === 'swamp') {
          tg.clearRect(0, 0, tmp.width, tmp.height);
          if ('filter' in tg) tg.filter = `blur(${Math.round(10 * k)}px)`;
          drawMask(tg);
          tg.filter = 'none';
          tg.globalCompositeOperation = 'destination-in';
          drawMask(tg);
          tg.globalCompositeOperation = 'source-in';
          tg.fillStyle = layer.id === 'water' ? 'rgba(10,40,100,0.35)' : 'rgba(10,30,10,0.35)';
          tg.fillRect(0, 0, tmp.width, tmp.height);
          tg.globalCompositeOperation = 'source-over';
          g.drawImage(tmp, 0, 0);
        }
        void mk;
      }
      // Gentle large-scale light variation.
      g.drawImage(tint, cx * 2, cy * 2, tw * 2, th * 2, 0, 0, c.width, c.height);
      out.push({ canvas: c, x: wx, y: wy, w: ww, h: wh });
    }
  return out;
}
