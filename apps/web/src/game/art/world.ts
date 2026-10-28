import { PROP_TYPES, type GroundTileKey, type MapDef, type PropType } from '@terrago/shared';
import { drawExtraIcon } from './icons';
import { ART_SCALE, OUTLINE, PixelBuffer, SHADOW, makeCanvas, mix, seeded, shade } from './pixel';

const T = 16; // logical pixels per tile

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

const GRASS = '#67a84a';
const GRASS_DARK = '#58953f';
const GRASS_LIGHT = '#7dbd5b';
const PATH = '#c9a36b';

type Family = 'grass' | 'path' | 'stone' | 'sand' | 'soil' | 'water' | 'cliff' | 'bridge' | 'cave' | 'snow' | 'lava';

const FAMILY: Record<GroundTileKey, Family> = {
  '.': 'grass',
  ',': 'grass',
  '*': 'grass',
  '=': 'path',
  ':': 'stone',
  '_': 'stone',
  s: 'sand',
  d: 'soil',
  '~': 'water',
  w: 'water',
  '#': 'cliff',
  b: 'bridge',
  c: 'cave',
  r: 'cliff',
  f: 'grass',
  n: 'snow',
  I: 'water',
  L: 'lava',
  a: 'path',
  u: 'soil',
  q: 'water',
  k: 'stone',
  h: 'sand',
};

function groundTile(key: GroundTileKey, r: () => number): PixelBuffer {
  const b = new PixelBuffer(T, T);
  const speck = (n: number, c: string) => {
    for (let i = 0; i < n; i++) b.set(Math.floor(r() * T), Math.floor(r() * T), c);
  };
  switch (key) {
    case '.':
    case ',':
    case '*': {
      b.rect(0, 0, T, T, GRASS);
      speck(12, GRASS_DARK);
      speck(7, GRASS_LIGHT);
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(r() * 15);
        const y = 1 + Math.floor(r() * 14);
        b.set(x, y, '#4f8a39').set(x, y - 1, '#4f8a39');
      }
      if (key === ',') {
        for (let i = 0; i < 4; i++) {
          const x = 1 + Math.floor(r() * 13);
          const y = 3 + Math.floor(r() * 11);
          b.set(x, y, '#477f33').set(x - 1, y + 1, '#477f33').set(x + 1, y + 1, '#477f33').set(x, y - 1, '#8cc965');
        }
      }
      if (key === '*') {
        const petals = ['#f4f1e6', '#f5d34f', '#ef8fb1', '#8fb8f0', '#f08a5d'];
        for (let i = 0; i < 4; i++) {
          const x = 1 + Math.floor(r() * 14);
          const y = 1 + Math.floor(r() * 13);
          b.set(x, y + 1, '#3f7a2f').set(x, y, petals[Math.floor(r() * petals.length)]!);
        }
      }
      break;
    }
    case '=':
      b.rect(0, 0, T, T, PATH);
      speck(6, '#b08a55');
      speck(6, '#dcbb86');
      speck(2, '#9c7848');
      break;
    case ':': {
      b.rect(0, 0, T, T, '#8e8676');
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 2 : 0;
        for (let col = -1; col < 4; col++) {
          const x = col * 4 + off;
          const c = r() < 0.5 ? '#b6ad9c' : '#a89f8e';
          b.rect(x, row * 4, 3, 3, c);
          b.set(x, row * 4, shade(c, 0.15));
        }
      }
      break;
    }
    case '_':
      b.rect(0, 0, T, T, '#d6cdb8');
      b.hline(0, 15, 7, '#c4baa3').vline(7, 0, 15, '#c4baa3');
      b.hline(0, 15, 15, '#c4baa3').vline(15, 0, 15, '#c4baa3');
      speck(3, '#e2dac8');
      break;
    case 's':
      b.rect(0, 0, T, T, '#e6d296');
      speck(10, '#d4bd7d');
      speck(4, '#f1e2b0');
      break;
    case 'd':
      b.rect(0, 0, T, T, '#7b5738');
      for (let y = 1; y < T; y += 4) b.hline(0, 15, y, '#6a4a2f');
      speck(6, '#8d6744');
      break;
    case '~':
      b.rect(0, 0, T, T, '#3f86c9');
      speck(4, '#3576b5');
      for (let i = 0; i < 2; i++) {
        const x = Math.floor(r() * 11);
        const y = 2 + Math.floor(r() * 12);
        b.hline(x, x + 3, y, '#69aae3');
      }
      break;
    case 'w':
      b.rect(0, 0, T, T, '#62a7da');
      for (let i = 0; i < 2; i++) {
        const x = Math.floor(r() * 12);
        const y = 2 + Math.floor(r() * 12);
        b.hline(x, x + 2, y, '#8fc6ea');
      }
      break;
    case '#':
      b.rect(0, 0, T, T, '#7d7a74');
      speck(8, '#6a6761');
      speck(5, '#94918a');
      break;
    case 'c':
      b.rect(0, 0, T, T, '#4a4152');
      speck(10, '#3d3545');
      speck(6, '#5a5063');
      break;
    case 'r':
      b.rect(0, 0, T, T, '#2b2431');
      speck(8, '#382f40');
      for (let i = 0; i < 3; i++) b.hline(Math.floor(r() * 10), Math.floor(r() * 10) + 4, Math.floor(r() * 16), '#1d1822');
      break;
    case 'f':
      b.rect(0, 0, T, T, '#4f8a3c');
      speck(14, '#457a33');
      speck(6, '#5f9c4a');
      for (let i = 0; i < 2; i++) b.set(Math.floor(r() * 16), Math.floor(r() * 16), '#8a6a42');
      break;
    case 'n':
      b.rect(0, 0, T, T, '#eef3f8');
      speck(8, '#d8e2ee');
      speck(3, '#ffffff');
      break;
    case 'I':
      b.rect(0, 0, T, T, '#9fd0ea');
      for (let i = 0; i < 2; i++) b.hline(Math.floor(r() * 10), Math.floor(r() * 10) + 5, 2 + Math.floor(r() * 12), '#d4eefa');
      break;
    case 'L':
      b.rect(0, 0, T, T, '#e0541f');
      speck(10, '#f5a623');
      speck(4, '#ffe06a');
      break;
    case 'a':
      b.rect(0, 0, T, T, '#5d5560');
      speck(10, '#4b444e');
      speck(3, '#a0473a');
      break;
    case 'u':
      b.rect(0, 0, T, T, '#5e5236');
      speck(10, '#4f452c');
      speck(4, '#6f8f4a');
      break;
    case 'q':
      b.rect(0, 0, T, T, '#3f5a3a');
      speck(6, '#4f6f45');
      b.hline(2, 6, 5, '#6f8f5a').hline(9, 13, 11, '#6f8f5a');
      break;
    case 'k':
      b.rect(0, 0, T, T, '#a59a84');
      b.hline(0, 15, 7, '#8a7f6a').vline(7, 0, 7, '#8a7f6a').vline(3, 8, 15, '#8a7f6a').vline(12, 8, 15, '#8a7f6a');
      speck(4, '#6f8f4a');
      break;
    case 'h':
      b.rect(0, 0, T, T, '#e8c88a');
      for (let y = 3; y < T; y += 5) b.hline(0, 15, y, '#d8b474');
      break;
    case 'b':
      b.rect(0, 0, T, T, '#b07b45');
      for (let x = 0; x < T; x += 4) b.vline(x, 0, 15, '#7a5230');
      b.hline(0, 15, 0, '#8a5d33').hline(0, 15, 15, '#6b4628');
      for (let x = 2; x < T; x += 4) b.set(x, 2, '#5d3d22').set(x, 13, '#5d3d22');
      break;
  }
  return b;
}

/**
 * Pre-render a whole map's ground into one canvas, including soft edges where
 * grass meets paths and water meets land. Cheap to draw every frame afterwards.
 */
export function renderGround(map: MapDef): HTMLCanvasElement {
  const s = ART_SCALE;
  const canvas = makeCanvas(map.width * T * s, map.height * T * s);
  const ctx = canvas.getContext('2d')!;
  const at = (x: number, y: number): GroundTileKey | null => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return (map.tiles[y]![x] ?? '.') as GroundTileKey;
  };

  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const key = at(x, y)!;
      const r = seeded((x * 73856093) ^ (y * 19349663) ^ key.charCodeAt(0));
      const tile = groundTile(key, r);
      const fam = FAMILY[key];

      // Edge treatment against neighbours.
      const neighbours: [number, number, 'n' | 's' | 'e' | 'w'][] = [
        [x, y - 1, 'n'],
        [x, y + 1, 's'],
        [x - 1, y, 'w'],
        [x + 1, y, 'e'],
      ];
      for (const [nx, ny, side] of neighbours) {
        const nk = at(nx, ny);
        if (!nk) continue;
        const nf = FAMILY[nk];
        const edge = (depth: number, color: string, jitter = 0) => {
          for (let i = 0; i < T; i++) {
            const d = depth + (jitter && r() < jitter ? 1 : 0);
            for (let k = 0; k < d; k++) {
              if (side === 'n') tile.set(i, k, color);
              if (side === 's') tile.set(i, T - 1 - k, color);
              if (side === 'w') tile.set(k, i, color);
              if (side === 'e') tile.set(T - 1 - k, i, color);
            }
          }
        };
        if (fam === 'cave' && nk === 'r') {
          edge(2, '#2b2431', 0.5);
        } else if ((fam === 'path' || fam === 'stone' || fam === 'sand' || fam === 'soil') && nf === 'grass') {
          edge(1, GRASS_DARK, 0.45);
        } else if (fam === 'water' && nf !== 'water' && nf !== 'bridge') {
          edge(1, '#cfe8f5');
        } else if (fam === 'grass' && nf === 'water') {
          edge(1, '#4c7f36');
        } else if (fam === 'water' && key === '~' && nk === 'w') {
          edge(1, mix('#3f86c9', '#62a7da', 0.5));
        }
      }
      tile.draw(ctx, x * T * s, y * T * s, s);
    }
  return canvas;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PropArt {
  canvas: HTMLCanvasElement;
  /** Footprint in tiles; the art is anchored bottom-centre of the footprint. */
  footW: number;
  footH: number;
}

function finish(b: PixelBuffer, shadowRows = 2): PixelBuffer {
  b.outline(OUTLINE);
  // Ground shadow along the bottom.
  for (let y = b.h - shadowRows; y < b.h; y++) for (let x = 1; x < b.w - 1; x++) b.under(x, y, SHADOW);
  return b;
}

function tree(kind: 'oak' | 'pine' | 'fruit', seed: number): PixelBuffer {
  const r = seeded(seed);
  const b = new PixelBuffer(24, 34);
  // Trunk
  b.rect(10, 22, 4, 10, '#7a5230').vline(13, 22, 31, '#5d3d22').set(9, 31, '#7a5230').set(14, 31, '#5d3d22');
  if (kind === 'pine') {
    const g = '#2f7a46';
    const layers = [
      [12, 2, 3],
      [12, 6, 6],
      [12, 11, 8],
      [12, 16, 10],
      [12, 21, 11],
    ] as const;
    for (const [cx, top, half] of layers) {
      for (let row = 0; row < 6; row++) {
        const w = Math.max(1, Math.round((half * (row + 1)) / 6));
        b.hline(cx - w, cx + w - 1, top + row, row === 5 ? shade(g, -0.25) : g);
      }
    }
    b.shadeIf((x, y) => x >= 13 && y > 3, '#276a3c');
    for (let i = 0; i < 8; i++) {
      const x = 6 + Math.floor(r() * 10);
      const y = 6 + Math.floor(r() * 18);
      if (b.get(x, y)) b.set(x, y, '#46a05f');
    }
  } else {
    const g = kind === 'fruit' ? '#4f9a3f' : '#3f8f3c';
    b.ellipse(1, 1, 22, 24, g);
    b.ellipse(4, 3, 10, 9, shade(g, 0.18));
    b.shadeIf((x, y) => x + y * 0.6 > 26, shade(g, -0.22));
    b.shadeIf((x, y) => y > 21, shade(g, -0.32));
    for (let i = 0; i < 14; i++) {
      const x = 2 + Math.floor(r() * 20);
      const y = 2 + Math.floor(r() * 20);
      if (b.get(x, y)) b.set(x, y, r() < 0.5 ? shade(g, 0.3) : shade(g, -0.3));
    }
    if (kind === 'fruit') {
      for (let i = 0; i < 7; i++) {
        const x = 3 + Math.floor(r() * 18);
        const y = 4 + Math.floor(r() * 16);
        if (b.get(x, y)) b.set(x, y, r() < 0.5 ? '#e0483a' : '#f29a2e');
      }
    }
  }
  return finish(b);
}

const propCache = new Map<string, PropArt>();

export function propArt(type: PropType, variant = 0): PropArt {
  const key = `${type}:${variant}`;
  const hit = propCache.get(key);
  if (hit) return hit;
  const def = PROP_TYPES[type];
  const b = drawProp(type, variant);
  const art = { canvas: b.toCanvas(), footW: def.w, footH: def.h };
  propCache.set(key, art);
  return art;
}

export const TREE_VARIANTS = 4;

function drawProp(type: PropType, variant: number): PixelBuffer {
  switch (type) {
    case 'tree_oak':
      return tree('oak', 101 + variant * 17);
    case 'tree_pine':
      return tree('pine', 211 + variant * 13);
    case 'tree_fruit':
      return tree('fruit', 307 + variant * 11);
    case 'bush': {
      const b = new PixelBuffer(16, 13);
      b.ellipse(0, 1, 16, 12, '#3f8f3c').ellipse(2, 2, 7, 5, '#57a84f');
      b.shadeIf((x, y) => y > 9, '#2f7030');
      b.set(5, 6, '#e6e2d3').set(11, 5, '#e6e2d3');
      return finish(b);
    }
    case 'rock': {
      const b = new PixelBuffer(15, 11);
      b.ellipse(0, 1, 15, 10, '#8b8a86').ellipse(2, 2, 7, 4, '#a7a6a1');
      b.shadeIf((x, y) => y > 7 || x > 11, '#6f6e6a');
      b.set(8, 4, '#6f6e6a').set(9, 5, '#6f6e6a');
      return finish(b);
    }
    case 'stump': {
      const b = new PixelBuffer(12, 10);
      b.rect(1, 3, 10, 6, '#7a5230').vline(10, 3, 8, '#5d3d22');
      b.ellipse(1, 0, 10, 5, '#c9a36b').ellipse(4, 1, 4, 3, '#b08a55');
      return finish(b);
    }
    case 'fence_h': {
      const b = new PixelBuffer(16, 14);
      b.hline(0, 15, 5, '#a8743f').hline(0, 15, 6, '#8a5d33');
      b.hline(0, 15, 10, '#a8743f').hline(0, 15, 11, '#8a5d33');
      b.rect(1, 2, 3, 11, '#b8844d').vline(3, 2, 12, '#7a5230');
      b.rect(12, 2, 3, 11, '#b8844d').vline(14, 2, 12, '#7a5230');
      return b;
    }
    case 'fence_v': {
      const b = new PixelBuffer(16, 20);
      b.rect(7, 0, 2, 20, '#a8743f').vline(8, 0, 19, '#8a5d33');
      b.rect(6, 2, 4, 4, '#b8844d').rect(6, 12, 4, 4, '#b8844d');
      return b;
    }
    case 'lamp': {
      const b = new PixelBuffer(10, 30);
      b.rect(4, 8, 2, 21, '#3b3a44').rect(3, 27, 4, 2, '#2c2b33');
      b.rect(2, 2, 6, 6, '#ffe48a').rect(3, 3, 4, 4, '#fff6c8');
      b.hline(1, 8, 1, '#3b3a44').hline(2, 7, 0, '#3b3a44').hline(2, 7, 8, '#3b3a44');
      return finish(b, 1);
    }
    case 'sign': {
      const b = new PixelBuffer(16, 16);
      b.rect(7, 8, 2, 8, '#7a5230');
      b.rect(1, 2, 14, 7, '#b8844d').hline(1, 14, 8, '#8a5d33');
      b.hline(3, 12, 4, '#6b4628').hline(3, 10, 6, '#6b4628');
      return finish(b, 1);
    }
    case 'barrel': {
      const b = new PixelBuffer(12, 15);
      b.rect(1, 1, 10, 13, '#9a6334').vline(10, 1, 13, '#7a4b28');
      b.hline(1, 10, 3, '#4a4650').hline(1, 10, 11, '#4a4650');
      b.ellipse(1, 0, 10, 3, '#b8844d');
      return finish(b);
    }
    case 'crate': {
      const b = new PixelBuffer(13, 13);
      b.rect(0, 0, 13, 13, '#b8844d');
      b.rect(0, 0, 13, 1, '#d09a5e').vline(12, 0, 12, '#8a5d33').hline(0, 12, 12, '#8a5d33');
      for (let i = 1; i < 12; i++) b.set(i, i, '#8a5d33').set(12 - i, i, '#8a5d33');
      return finish(b);
    }
    case 'well': {
      const b = new PixelBuffer(30, 34);
      b.rect(3, 22, 24, 10, '#9a968e').hline(3, 26, 22, '#b9b5ac');
      for (let x = 3; x < 27; x += 5) b.vline(x, 23, 31, '#7f7b74');
      b.ellipse(5, 18, 20, 7, '#9a968e').ellipse(8, 19, 14, 4, '#2e5d8a');
      b.rect(5, 6, 2, 16, '#7a5230').rect(23, 6, 2, 16, '#7a5230');
      for (let y = 0; y < 7; y++) b.hline(2 + y, 27 - y, 6 - y, y % 2 ? '#a8473a' : '#8f3a2f');
      b.hline(14, 15, 12, '#5d3d22').vline(15, 8, 18, '#cfc9b8');
      return finish(b);
    }
    case 'fountain': {
      const b = new PixelBuffer(64, 52);
      b.ellipse(1, 18, 62, 32, '#a9a49a');
      b.ellipse(3, 19, 58, 26, '#c9c3b7');
      b.ellipse(6, 22, 52, 22, '#4f97d6');
      b.ellipse(10, 25, 22, 8, '#79b6e8');
      b.shadeIf((x, y) => y > 44, '#8f8a80');
      // Centre pillar and spray
      b.rect(28, 12, 8, 22, '#bdb7ab').vline(35, 12, 33, '#9d978c');
      b.ellipse(22, 8, 20, 8, '#c9c3b7').ellipse(24, 9, 16, 5, '#4f97d6');
      b.rect(30, 0, 4, 9, '#a7d4f5').vline(31, 0, 8, '#e3f3ff');
      for (const [x, y] of [[26, 3], [37, 3], [24, 6], [39, 6], [20, 16], [43, 16]] as const) b.set(x, y, '#c4e4fb');
      return finish(b, 3);
    }
    case 'market_stall': {
      const b = new PixelBuffer(48, 44);
      const colors = variant % 2 ? ['#d94f4f', '#f1e7d2'] : ['#3f7fc0', '#f1e7d2'];
      b.rect(2, 14, 3, 28, '#7a5230').rect(43, 14, 3, 28, '#7a5230');
      b.rect(1, 28, 46, 14, '#a8743f').hline(1, 46, 28, '#c9935a').hline(1, 46, 41, '#7a5230');
      for (let x = 4; x < 44; x += 6) {
        const goods = ['#e0483a', '#f29a2e', '#f5d34f', '#7cc35a', '#b06ad6'];
        b.rect(x, 25, 4, 3, goods[(x + variant) % goods.length]!);
      }
      for (let y = 0; y < 14; y++)
        for (let x = 0; x < 48; x++) {
          const stripe = Math.floor(x / 6) % 2;
          b.set(x, y + 2, y === 13 ? shade(colors[stripe]!, -0.25) : colors[stripe]!);
        }
      for (let x = 0; x < 48; x += 6) b.rect(x, 15, 3, 2, colors[0]!);
      b.hline(0, 47, 1, shade(colors[0]!, -0.3));
      return finish(b);
    }
    case 'bench': {
      const b = new PixelBuffer(32, 14);
      b.rect(1, 2, 30, 3, '#a8743f').rect(1, 7, 30, 3, '#b8844d').hline(1, 30, 9, '#8a5d33');
      b.rect(3, 10, 2, 4, '#5d3d22').rect(27, 10, 2, 4, '#5d3d22');
      return finish(b, 1);
    }
    case 'notice_board': {
      const b = new PixelBuffer(32, 26);
      b.rect(3, 10, 2, 16, '#7a5230').rect(27, 10, 2, 16, '#7a5230');
      b.rect(1, 2, 30, 16, '#8a5d33').rect(3, 4, 26, 12, '#c9935a');
      b.rect(5, 5, 7, 8, '#f1ead7').rect(14, 6, 6, 7, '#f6e7a8').rect(22, 5, 5, 6, '#e8d8f0');
      b.hline(6, 10, 7, '#9a8f7a').hline(6, 10, 9, '#9a8f7a').hline(15, 18, 8, '#9a8f7a');
      b.rect(0, 0, 32, 2, '#a8473a');
      return finish(b, 1);
    }
    case 'teleport_pad': {
      const b = new PixelBuffer(48, 48);
      b.ellipse(0, 2, 48, 44, '#8e8a9e').ellipse(3, 5, 42, 38, '#a9a5b8');
      b.ellipse(10, 11, 28, 26, '#5fd4e6').ellipse(13, 14, 22, 20, '#a9a5b8');
      b.ellipse(19, 19, 10, 10, '#8ff0ff');
      for (const [x, y] of [[23, 7], [23, 40], [7, 23], [40, 23], [12, 12], [35, 12], [12, 35], [35, 35]] as const) {
        b.rect(x, y, 2, 2, '#3fb6cc');
      }
      return b;
    }
    case 'flower_bed': {
      const b = new PixelBuffer(32, 14);
      b.rect(0, 3, 32, 11, '#8a5d33').rect(1, 4, 30, 9, '#6a4a2f');
      const r = seeded(91 + variant);
      const petals = ['#ef8fb1', '#f5d34f', '#f4f1e6', '#b06ad6', '#f08a5d'];
      for (let i = 0; i < 18; i++) {
        const x = 2 + Math.floor(r() * 28);
        const y = 3 + Math.floor(r() * 8);
        b.set(x, y + 1, '#3f7a2f').set(x, y, petals[i % petals.length]!);
      }
      return finish(b, 1);
    }
    case 'hay_bale': {
      const b = new PixelBuffer(16, 14);
      b.rect(0, 2, 16, 11, '#e0bf5a').hline(0, 15, 2, '#efd27c').hline(0, 15, 12, '#b89540');
      b.vline(4, 2, 12, '#a3402f').vline(11, 2, 12, '#a3402f');
      for (let i = 0; i < 6; i++) b.set(1 + i * 2, 6 + (i % 3), '#c9a74b');
      return finish(b);
    }
    case 'scarecrow': {
      const b = new PixelBuffer(16, 30);
      b.rect(7, 10, 2, 20, '#7a5230');
      b.rect(1, 12, 14, 2, '#7a5230');
      b.rect(4, 11, 8, 9, '#5a7fc0').vline(11, 11, 19, '#46649a');
      b.rect(5, 3, 6, 7, '#e8d48a').rect(6, 6, 1, 1, '#2a2030').rect(9, 6, 1, 1, '#2a2030');
      b.hline(2, 13, 3, '#b89540').rect(5, 0, 6, 3, '#b89540');
      return finish(b, 1);
    }
    case 'tree_dead': {
      const b = new PixelBuffer(20, 32);
      b.rect(8, 8, 4, 23, '#6b5a4a').vline(11, 8, 30, '#4f4236');
      for (let i = 0; i < 6; i++) b.set(7 - i, 12 - i, '#6b5a4a').set(12 + i, 16 - i, '#6b5a4a').set(9 - Math.floor(i / 2), 6 - i, '#6b5a4a');
      return finish(b);
    }
    case 'tree_snow': {
      const b = tree('pine', 777 + variant * 3);
      b.shadeIf((x, y) => y < 22 && (x + y * 3 + variant) % 5 === 0, '#f4f8fc');
      for (let y = 2; y < 22; y += 5) b.shadeIf((x, yy) => yy === y && b.get(x, yy - 1) === null, '#ffffff');
      return b;
    }
    case 'tree_swamp': {
      const b = new PixelBuffer(24, 32);
      b.rect(10, 14, 4, 17, '#4a3f2e').set(8, 30, '#4a3f2e').set(15, 30, '#4a3f2e');
      b.ellipse(1, 2, 22, 16, '#4f6f3a').shadeIf((x, y) => y > 12, '#3f5a2e');
      for (let x = 3; x < 22; x += 4) b.vline(x, 14, 20 + (x % 3), '#6f8f4a');
      return finish(b);
    }
    case 'tree_ancient': {
      const b = new PixelBuffer(28, 38);
      b.rect(11, 22, 6, 15, '#5d3d22').vline(16, 22, 36, '#4a2f1a').set(9, 36, '#5d3d22').set(18, 36, '#5d3d22');
      b.ellipse(0, 0, 28, 27, '#2f6f35').ellipse(3, 2, 12, 10, '#3f8a45').shadeIf((x, y) => y > 20 || x + y > 36, '#255a2b');
      return finish(b);
    }
    case 'cactus': {
      const b = new PixelBuffer(16, 26);
      b.rect(6, 2, 4, 23, '#4f9a3f').vline(9, 2, 24, '#3f7a2f');
      b.rect(1, 8, 3, 8, '#4f9a3f').rect(1, 14, 6, 2, '#4f9a3f').rect(12, 5, 3, 7, '#4f9a3f').rect(9, 11, 6, 2, '#4f9a3f');
      return finish(b);
    }
    case 'crystal': {
      const b = new PixelBuffer(16, 20);
      const c = ['#b6a4ff', '#8fe0ff', '#ff9ad5'][variant % 3]!;
      b.rect(6, 2, 4, 16, c).rect(2, 8, 3, 10, shade(c, -0.15)).rect(11, 6, 3, 12, shade(c, -0.1)).vline(7, 3, 12, shade(c, 0.5));
      return finish(b);
    }
    case 'stalagmite': {
      const b = new PixelBuffer(14, 22);
      for (let y = 0; y < 20; y++) b.hline(7 - Math.floor(y / 3), 6 + Math.floor(y / 3), y + 1, y % 4 === 0 ? '#5a5063' : '#4a4152');
      return finish(b);
    }
    case 'bones': {
      const b = new PixelBuffer(16, 10);
      b.hline(2, 12, 5, '#e8e0cc').set(1, 4, '#e8e0cc').set(1, 6, '#e8e0cc').set(13, 4, '#e8e0cc').set(13, 6, '#e8e0cc');
      b.ellipse(9, 1, 5, 4, '#e8e0cc').set(10, 2, '#2a2030');
      return b;
    }
    case 'ruin_pillar': {
      const b = new PixelBuffer(14, 34);
      b.rect(3, 4, 8, 28, '#b0a690').vline(10, 4, 31, '#8a7f6a').rect(1, 1, 12, 3, '#c4baa3').rect(1, 30, 12, 3, '#9a8f7a');
      b.set(5, 12, '#6f8f4a').set(6, 13, '#6f8f4a').set(4, 20, '#6f8f4a');
      return finish(b);
    }
    case 'mushroom_big': {
      const b = new PixelBuffer(18, 22);
      b.rect(7, 10, 4, 11, '#efe3c2').ellipse(0, 1, 18, 11, '#c0392b').set(4, 4, '#fff').set(10, 3, '#fff').set(13, 6, '#fff');
      return finish(b);
    }
    case 'reeds': {
      const b = new PixelBuffer(16, 20);
      for (const x of [3, 6, 9, 12]) b.vline(x, 4 + (x % 3), 19, '#6f8f3a').rect(x, 2 + (x % 3), 1, 4, '#7a5230');
      return b;
    }
    case 'ladder_down': {
      const b = new PixelBuffer(16, 16);
      b.rect(1, 1, 14, 14, '#14101a');
      b.vline(4, 2, 15, '#8a5d33').vline(11, 2, 15, '#8a5d33');
      for (let y = 4; y < 15; y += 3) b.hline(4, 11, y, '#b8844d');
      return b;
    }
    case 'ladder_up': {
      const b = new PixelBuffer(16, 24);
      b.vline(4, 0, 23, '#8a5d33').vline(11, 0, 23, '#8a5d33');
      for (let y = 2; y < 23; y += 4) b.hline(4, 11, y, '#b8844d');
      b.rect(2, 0, 12, 2, '#ffe48a');
      return finish(b, 1);
    }
    case 'mine_entrance': {
      const b = new PixelBuffer(48, 36);
      b.rect(0, 6, 48, 30, '#6b645e').shadeIf((x, y) => (x + y) % 7 === 0, '#5a544e');
      b.rect(10, 12, 28, 24, '#14101a');
      b.rect(8, 10, 4, 26, '#8a5d33').rect(36, 10, 4, 26, '#8a5d33').rect(6, 8, 36, 4, '#a8743f');
      b.hline(16, 31, 30, '#6b645e').hline(16, 31, 33, '#6b645e');
      return finish(b, 1);
    }
    case 'torch': {
      const b = new PixelBuffer(8, 24);
      b.rect(3, 8, 2, 16, '#7a5230').ellipse(1, 1, 6, 8, '#f5a623').ellipse(2, 2, 4, 5, '#ffe06a');
      return b;
    }
    case 'dock_post': {
      const b = new PixelBuffer(10, 20);
      b.rect(3, 2, 4, 18, '#7a5230').vline(6, 2, 19, '#5d3d22').hline(2, 7, 2, '#a8743f').hline(2, 7, 6, '#d6c79f');
      return finish(b, 1);
    }
    case 'tent': {
      const b = new PixelBuffer(32, 30);
      for (let y = 0; y < 26; y++) b.hline(16 - Math.floor(y * 0.62), 15 + Math.floor(y * 0.62), y + 2, y % 6 === 5 ? '#a8473a' : '#c95a48');
      for (let y = 10; y < 28; y++) b.hline(15 - Math.floor((y - 10) * 0.25), 16 + Math.floor((y - 10) * 0.25), y, '#2a2030');
      return finish(b, 1);
    }
    case 'campfire': {
      const b = new PixelBuffer(16, 16);
      b.rect(2, 11, 12, 3, '#7a5230').set(1, 12, '#5d3d22').set(14, 12, '#5d3d22');
      b.ellipse(4, 2, 8, 10, '#f5a623').ellipse(6, 5, 4, 6, '#ffe06a');
      return finish(b, 1);
    }
    case 'furnace': {
      const b = new PixelBuffer(32, 36);
      b.rect(2, 6, 28, 30, '#7d7a74').shadeIf((x, y) => (x * 3 + y * 5) % 11 === 0, '#6a6761');
      b.rect(10, 18, 12, 10, '#2a2030').rect(12, 21, 8, 7, '#f5a623').rect(14, 24, 4, 4, '#ffe06a');
      b.rect(20, 0, 6, 8, '#6a6761').hline(19, 26, 0, '#4f4c47');
      return finish(b);
    }
    case 'anvil': {
      const b = new PixelBuffer(16, 16);
      b.rect(1, 3, 14, 4, '#4a4650').rect(0, 3, 3, 2, '#4a4650').rect(5, 7, 6, 4, '#3b3842').rect(3, 11, 10, 4, '#7a5230');
      b.hline(2, 13, 3, '#6f6a76');
      return finish(b, 1);
    }
    case 'workbench': {
      const b = new PixelBuffer(32, 20);
      b.rect(1, 4, 30, 4, '#b8844d').hline(1, 30, 4, '#d09a5e').rect(3, 8, 3, 11, '#8a5d33').rect(26, 8, 3, 11, '#8a5d33');
      b.rect(6, 1, 8, 3, '#c9935a').rect(20, 2, 2, 2, '#a7a6a1').rect(22, 1, 6, 1, '#a7a6a1');
      return finish(b, 1);
    }
    case 'cooking_pot': {
      const b = new PixelBuffer(16, 18);
      b.rect(2, 14, 12, 3, '#7a5230').ellipse(4, 12, 8, 5, '#f5a623');
      b.ellipse(1, 3, 14, 11, '#3b3842').hline(1, 14, 4, '#5a5663').ellipse(3, 3, 10, 3, '#c9a36b');
      b.set(6, 0, '#e8e8f0').set(9, 1, '#e8e8f0');
      return finish(b, 1);
    }
    case 'alchemy_table': {
      const b = new PixelBuffer(32, 22);
      b.rect(1, 8, 30, 4, '#6b4a8a').hline(1, 30, 8, '#8a6aa8').rect(3, 12, 3, 9, '#4a3a5a').rect(26, 12, 3, 9, '#4a3a5a');
      b.ellipse(4, 1, 6, 7, '#5fd4e6').rect(6, 0, 2, 2, '#cfe8f5').ellipse(13, 3, 5, 5, '#e0483a').rect(20, 2, 4, 6, '#9fd36a').rect(25, 4, 4, 4, '#f2c14e');
      return finish(b, 1);
    }
    case 'mill': {
      const b = new PixelBuffer(32, 40);
      b.rect(6, 16, 20, 24, '#d9cdb4').rect(13, 30, 6, 10, '#8a5530').rect(4, 12, 24, 5, '#a8473a');
      for (let i = 0; i < 12; i++) b.set(16 + i, 14 - i, '#8a5d33').set(16 - i, 14 - i, '#8a5d33').set(16 + i, 14 + Math.floor(i / 2), '#8a5d33');
      b.rect(14, 12, 4, 4, '#5d3d22');
      return finish(b);
    }
    case 'loom': {
      const b = new PixelBuffer(32, 22);
      b.rect(2, 2, 3, 19, '#8a5d33').rect(27, 2, 3, 19, '#8a5d33').rect(2, 2, 28, 3, '#a8743f');
      for (let x = 6; x < 27; x += 2) b.vline(x, 5, 14, '#e8dcc0');
      b.rect(6, 10, 21, 5, '#4a7fd6');
      return finish(b, 1);
    }
    case 'enhance_altar': {
      const b = new PixelBuffer(32, 26);
      b.rect(2, 12, 28, 13, '#6a6070').hline(2, 29, 12, '#8a8094').rect(12, 2, 8, 10, '#4a7fd6').rect(14, 4, 4, 6, '#8fb8f0');
      return finish(b, 1);
    }
    case 'dungeon_gate': {
      const b = new PixelBuffer(48, 40);
      b.rect(0, 8, 48, 32, '#5a5260').rect(12, 14, 24, 26, '#14101a').rect(8, 4, 32, 8, '#6a6070');
      for (let x = 14; x < 36; x += 4) b.vline(x, 14, 39, '#3b3842');
      b.rect(22, 6, 4, 4, '#e0483a');
      return finish(b, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export { buildingArt, type BuildingArt } from './buildings';

// ---------------------------------------------------------------------------
// Item icons (16x16 logical)
// ---------------------------------------------------------------------------

const iconCache = new Map<string, HTMLCanvasElement>();

/** HD (smooth) item icon, `size` px square. */
export function itemIconHd(icon: string, size = 96): HTMLCanvasElement {
  const key = `${icon}@hd${size}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const c = iconBuffer(icon).toHdCanvas(size);
  iconCache.set(key, c);
  return c;
}

export function itemIcon(icon: string, scale = ART_SCALE): HTMLCanvasElement {
  const key = `${icon}@${scale}`;
  const hit0 = iconCache.get(key);
  if (hit0) return hit0;
  const canvas = iconBuffer(icon).toCanvas(scale);
  iconCache.set(key, canvas);
  return canvas;
}

function iconBuffer(icon: string): PixelBuffer {
  const b = new PixelBuffer(16, 16);
  switch (icon) {
    case 'hoe':
      for (let i = 0; i < 11; i++) b.set(3 + i, 13 - i, '#9a6334').set(4 + i, 13 - i, '#7a4b28');
      b.rect(10, 1, 5, 3, '#a7a6a1').hline(10, 14, 3, '#7d7a74').rect(13, 4, 2, 3, '#a7a6a1');
      break;
    case 'watering_can':
      b.rect(3, 6, 8, 7, '#7d9bb8').vline(10, 6, 12, '#5d7a96').hline(3, 10, 12, '#5d7a96');
      b.rect(5, 3, 4, 1, '#5d7a96').vline(4, 4, 5, '#5d7a96').vline(9, 4, 5, '#5d7a96');
      for (let i = 0; i < 4; i++) b.set(11 + i, 8 - i, '#7d9bb8');
      b.rect(14, 3, 2, 2, '#5d7a96');
      b.set(13, 13, '#5fb0e8').set(15, 12, '#5fb0e8');
      break;
    case 'seed_bag':
      b.ellipse(2, 4, 12, 11, '#c9a36b').shadeIf((x, y) => x > 10 || y > 12, '#a98552');
      b.rect(5, 2, 6, 3, '#a98552').hline(4, 11, 4, '#7a5230');
      b.rect(6, 8, 4, 4, '#e6873a').set(7, 7, '#5ca84a').set(8, 7, '#5ca84a');
      break;
    case 'carrot':
      for (let i = 0; i < 9; i++) b.hline(4 + Math.floor(i / 2), 8 + Math.floor(i / 3), 5 + i, i > 6 ? '#d9661f' : '#f08a2e');
      b.set(6, 8, '#c5561a').set(7, 11, '#c5561a');
      b.rect(5, 1, 2, 4, '#5ca84a').rect(8, 0, 2, 5, '#4a9a3c').rect(10, 2, 2, 3, '#5ca84a');
      break;
    case 'bread':
      b.ellipse(1, 5, 14, 9, '#d39a4f').ellipse(2, 5, 12, 5, '#e8b56a');
      for (const x of [4, 7, 10]) b.set(x, 7, '#a8743f').set(x + 1, 6, '#a8743f');
      b.shadeIf((x, y) => y > 11, '#a8743f');
      break;
    case 'honey_bun':
      b.ellipse(2, 4, 12, 10, '#d39a4f').ellipse(3, 4, 10, 6, '#f2c14e');
      b.set(6, 6, '#fff3c4').set(7, 6, '#fff3c4').set(9, 8, '#e0a52e');
      b.shadeIf((x, y) => y > 12, '#a8743f');
      break;
    case 'scroll':
      b.rect(3, 3, 10, 10, '#efe3c2').vline(12, 3, 12, '#d6c79f');
      b.rect(2, 2, 12, 2, '#d6c79f').rect(2, 12, 12, 2, '#d6c79f');
      b.hline(5, 10, 6, '#9a8f7a').hline(5, 9, 8, '#9a8f7a').set(10, 10, '#c0392b').set(11, 10, '#c0392b');
      break;
    case 'ore_copper':
      b.ellipse(1, 3, 14, 11, '#8b8a86').shadeIf((x, y) => y > 10, '#6f6e6a');
      for (const [x, y] of [[4, 6], [9, 5], [6, 9], [11, 9], [8, 7]] as const) b.set(x, y, '#d9822b').set(x + 1, y, '#3fae8f');
      break;
    case 'log':
      b.rect(1, 5, 12, 7, '#9a6334').hline(1, 12, 11, '#7a4b28').hline(1, 12, 5, '#b8844d');
      b.ellipse(11, 4, 5, 9, '#d6b07a').set(13, 8, '#a8743f').set(13, 7, '#a8743f');
      break;
    default:
      if (!drawExtraIcon(icon, b)) b.rect(3, 3, 10, 10, '#b06ad6').rect(6, 5, 4, 2, '#fff').rect(8, 7, 2, 2, '#fff').rect(7, 10, 2, 2, '#fff');
  }
  b.outline(OUTLINE);
  return b;
}
