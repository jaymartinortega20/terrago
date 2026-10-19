import { PROP_TYPES, type BuildingDef, type GroundTileKey, type MapDef, type PropType } from '@terrago/shared';
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

type Family = 'grass' | 'path' | 'stone' | 'sand' | 'soil' | 'water' | 'cliff' | 'bridge';

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
        if ((fam === 'path' || fam === 'stone' || fam === 'sand' || fam === 'soil') && nf === 'grass') {
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
  }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BuildingArt {
  canvas: HTMLCanvasElement;
  /** Sign position relative to the canvas's bottom-left, in screen px. */
  signX: number;
  signY: number;
}

const WALL_H = 38;
const ROOF_OVERHANG = 8;

export function buildingArt(def: BuildingDef): BuildingArt {
  const w = def.w * T;
  const h = def.h * T + ROOF_OVERHANG;
  const b = new PixelBuffer(w, h);
  const roof = def.roof;
  const wall = def.wall;
  const wallTop = h - WALL_H;
  const beam = '#6b4a2e';

  // Walls
  b.rect(1, wallTop, w - 2, WALL_H, wall);
  b.hline(1, w - 2, wallTop, beam).hline(1, w - 2, wallTop + 1, shade(beam, 0.2));
  b.vline(1, wallTop, h - 1, beam).vline(w - 2, wallTop, h - 1, beam);
  for (let x = 32; x < w - 8; x += 32) b.vline(x, wallTop, h - 1, beam);
  b.hline(1, w - 2, h - 1, shade(wall, -0.35)).hline(1, w - 2, h - 2, shade(wall, -0.15));

  // Door
  const doorCx = def.doorX * T + T / 2;
  const dx0 = doorCx - 6;
  b.rect(dx0 - 1, h - 22, 14, 22, '#5a3e26');
  b.rect(dx0, h - 21, 12, 21, '#8a5530');
  b.vline(dx0 + 6, h - 21, h - 1, '#6e4224');
  b.rect(dx0 + 2, h - 18, 3, 6, '#7a4a2a').rect(dx0 + 8, h - 18, 3, 6, '#7a4a2a');
  b.set(dx0 + 9, h - 10, '#e3c35a');

  // Windows, avoiding the door
  for (let x = 8; x + 12 < w - 4; x += 24) {
    if (Math.abs(x + 6 - doorCx) < 16) continue;
    const y = wallTop + 10;
    b.rect(x - 1, y - 1, 14, 12, '#5a3e26');
    b.rect(x, y, 12, 10, '#9fd3ec');
    b.rect(x, y, 5, 4, '#d4eefa');
    b.vline(x + 6, y, y + 9, '#5a3e26').hline(x, x + 11, y + 5, '#5a3e26');
    b.hline(x - 2, x + 13, y + 11, shade(wall, -0.3));
  }

  // Sign plank above the door
  const signW = 30;
  const sx = Math.max(2, Math.min(w - signW - 2, doorCx - signW / 2));
  const sy = wallTop + 3;
  b.rect(sx, sy, signW, 7, '#8a5d33').rect(sx + 1, sy + 1, signW - 2, 5, '#b8844d');

  // Roof: shingle courses
  const roofBottom = wallTop - 1;
  for (let y = 0; y <= roofBottom; y++) {
    const inset = Math.max(0, 6 - y);
    const course = Math.floor((roofBottom - y) / 4);
    const inCourse = (roofBottom - y) % 4;
    const base = inCourse === 0 ? shade(roof, -0.22) : roof;
    b.hline(inset, w - 1 - inset, y, base);
    if (inCourse === 2) {
      for (let x = inset + ((course % 2) * 3); x < w - inset; x += 6) b.set(x, y, shade(roof, 0.12));
    }
  }
  b.hline(6, w - 7, 0, shade(roof, 0.3)).hline(5, w - 6, 1, shade(roof, 0.18));
  b.hline(0, w - 1, roofBottom, shade(roof, -0.45)).hline(0, w - 1, roofBottom - 1, shade(roof, -0.3));
  b.shadeIf((x, y) => y <= roofBottom && x > w - 8 && y > 2, shade(roof, -0.15));

  if (def.id === 'tavern' || def.id === 'blacksmith') {
    const cx = def.id === 'tavern' ? w - 30 : 14;
    b.rect(cx, 0, 8, 12, '#8a817a').hline(cx - 1, cx + 8, 0, '#6b645e').vline(cx + 7, 1, 11, '#6b645e');
  }

  b.outline(OUTLINE);
  const canvas = b.toCanvas();
  return { canvas, signX: (sx + signW / 2) * ART_SCALE, signY: -(h - sy - 3.5) * ART_SCALE };
}

// ---------------------------------------------------------------------------
// Item icons (16x16 logical)
// ---------------------------------------------------------------------------

const iconCache = new Map<string, HTMLCanvasElement>();

export function itemIcon(icon: string, scale = ART_SCALE): HTMLCanvasElement {
  const key = `${icon}@${scale}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
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
  const canvas = b.toCanvas(scale);
  iconCache.set(key, canvas);
  return canvas;
}
