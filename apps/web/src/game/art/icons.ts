import { CROPS } from '@terrago/game-data';
import { PixelBuffer, seeded, shade } from './pixel';

/**
 * Parametric item icons, keyed by strings in items.json:
 *   seed:<crop>  crop:<crop>  tool:<kind>:<tier>  ore:<metal>  bar:<metal>  log:<kind>
 *   fish:<colour>  potion:<colour>  weapon:<type>:<tier>  armor:<slot>:<tier>
 *   herb:<colour>  mushroom:<colour>  gem:<colour>  food:<kind>  fertilizer:<kind>
 * Colours may be given as hex without '#'.
 */

const METAL: Record<string, string> = {
  stone: '#9a968e',
  worn: '#a7a6a1',
  copper: '#d9822b',
  iron: '#b9bcc4',
  silver: '#e2e6ee',
  gold: '#f2c14e',
  mithril: '#7fe0d8',
  crystal: '#b6a4ff',
  obsidian: '#5a4670',
  starmetal: '#ffe9a8',
  dragonstone: '#e0483a',
};

/** Tool/weapon tier → head colour. */
const TIER_METAL = ['#a7a6a1', '#d9822b', '#b9bcc4', '#e2e6ee', '#f2c14e', '#7fe0d8', '#5a4670', '#ffe9a8'];

const hex = (c: string | undefined, fallback: string) => (c ? (c.startsWith('#') ? c : `#${c}`) : fallback);
const metal = (k: string | undefined) => METAL[k ?? ''] ?? hex(k, '#b9bcc4');
const tierColor = (t: string | undefined) => TIER_METAL[Math.max(0, Math.min(TIER_METAL.length - 1, Number(t) || 0))]!;
const HANDLE = '#9a6334';
const HANDLE_DARK = '#7a4b28';

function handle(b: PixelBuffer, x0: number, y0: number, len: number): void {
  for (let i = 0; i < len; i++) b.set(x0 + i, y0 - i, HANDLE).set(x0 + i + 1, y0 - i, HANDLE_DARK);
}

function produce(b: PixelBuffer, cropId: string): void {
  const def = CROPS.find((c) => c.id === cropId);
  const fruit = def?.art.fruit ?? '#e0483a';
  const leaf = def?.art.leaf ?? '#4a9a3c';
  switch (def?.art.shape) {
    case 'root':
      if (cropId === 'carrot') {
        for (let i = 0; i < 9; i++) b.hline(4 + Math.floor(i / 2), 8 + Math.floor(i / 3), 5 + i, i > 6 ? shade(fruit, -0.15) : fruit);
      } else b.ellipse(2, 5, 12, 9, fruit).set(5, 8, shade(fruit, -0.25)).set(9, 10, shade(fruit, -0.25)).set(7, 7, shade(fruit, 0.25));
      b.rect(5, 1, 2, 4, leaf).rect(8, 0, 2, 5, shade(leaf, -0.1)).rect(10, 2, 2, 3, leaf);
      break;
    case 'grain':
      b.vline(8, 4, 15, shade(fruit, -0.3)).vline(5, 6, 15, shade(fruit, -0.3)).vline(11, 6, 15, shade(fruit, -0.3));
      for (const x of [5, 8, 11]) for (let y = x === 8 ? 1 : 3; y < (x === 8 ? 8 : 9); y += 2) b.set(x - 1, y, fruit).set(x + 1, y + 1, fruit).set(x, y, shade(fruit, 0.2));
      break;
    case 'stalk':
      b.ellipse(4, 2, 8, 13, fruit);
      for (let y = 3; y < 14; y += 2) b.hline(5, 10, y, shade(fruit, -0.15));
      b.vline(3, 6, 15, leaf).vline(12, 5, 15, leaf).set(4, 14, leaf).set(11, 14, leaf);
      break;
    case 'vine':
      if (cropId.includes('pumpkin')) {
        b.ellipse(1, 4, 14, 11, fruit).vline(5, 5, 13, shade(fruit, -0.2)).vline(10, 5, 13, shade(fruit, -0.2));
        b.rect(7, 1, 2, 4, '#5d3d22').set(9, 2, leaf).set(10, 1, leaf);
      } else {
        b.ellipse(2, 3, 12, 12, fruit).set(5, 6, shade(fruit, 0.4)).set(6, 5, shade(fruit, 0.4));
        b.rect(7, 2, 3, 2, leaf).set(6, 1, leaf).set(10, 1, leaf);
      }
      break;
    case 'bush':
      for (const [x, y] of [[3, 6], [8, 4], [6, 9], [10, 9]] as const) b.ellipse(x, y, 5, 5, fruit).set(x + 1, y + 1, shade(fruit, 0.35));
      b.rect(7, 1, 2, 3, leaf).set(6, 2, leaf).set(9, 2, leaf);
      break;
    case 'flower':
      b.vline(8, 8, 15, shade(leaf, -0.2)).set(6, 12, leaf).set(7, 11, leaf).set(10, 13, leaf);
      for (const [x, y] of [[8, 2], [5, 5], [11, 5], [6, 8], [10, 8]] as const) b.ellipse(x - 2, y - 2, 4, 4, fruit);
      b.rect(7, 4, 3, 3, '#fff6c8');
      break;
    default:
      b.ellipse(3, 3, 10, 10, fruit);
  }
}

function seedBag(b: PixelBuffer, cropId: string): void {
  const def = CROPS.find((c) => c.id === cropId);
  const fruit = def?.art.fruit ?? '#e6873a';
  const rare = (def?.levelRequired ?? 1) >= 18;
  const bag = rare ? '#8b7bb8' : '#c9a36b';
  b.ellipse(2, 4, 12, 11, bag).shadeIf((x, y) => x > 10 || y > 12, shade(bag, -0.2));
  b.rect(5, 2, 6, 3, shade(bag, -0.2)).hline(4, 11, 4, '#7a5230');
  b.rect(6, 8, 4, 4, fruit).set(7, 7, def?.art.leaf ?? '#5ca84a').set(8, 7, def?.art.leaf ?? '#5ca84a');
  if (rare) b.set(4, 6, '#fff6c8').set(11, 9, '#fff6c8');
}

function tool(b: PixelBuffer, kind: string, tierStr: string | undefined): void {
  const m = tierColor(tierStr);
  const md = shade(m, -0.3);
  switch (kind) {
    case 'hoe':
      handle(b, 3, 13, 11);
      b.rect(10, 1, 5, 3, m).hline(10, 14, 3, md).rect(13, 4, 2, 3, m);
      break;
    case 'can':
      b.rect(3, 6, 8, 7, m).vline(10, 6, 12, md).hline(3, 10, 12, md);
      b.rect(5, 3, 4, 1, md).vline(4, 4, 5, md).vline(9, 4, 5, md);
      for (let i = 0; i < 4; i++) b.set(11 + i, 8 - i, m);
      b.rect(14, 3, 2, 2, md).set(13, 13, '#5fb0e8').set(15, 12, '#5fb0e8');
      break;
    case 'pickaxe':
      handle(b, 3, 14, 10);
      for (let i = 0; i < 6; i++) b.set(6 + i, 2 + Math.floor(i / 3), m).set(9 + Math.floor(i / 2), 3 + i, m);
      b.rect(9, 3, 3, 3, md).set(5, 2, m).set(14, 9, m);
      break;
    case 'axe':
      handle(b, 3, 14, 10);
      b.rect(9, 1, 4, 7, m).rect(13, 2, 2, 5, m).vline(12, 1, 7, md).set(8, 3, md);
      break;
    case 'rod':
      for (let i = 0; i < 13; i++) b.set(2 + i, 14 - i, i < 4 ? HANDLE_DARK : HANDLE);
      b.vline(14, 2, 11, '#e6e2d3').set(14, 12, m).set(13, 12, m).set(15, 11, '#e0483a');
      b.rect(3, 11, 2, 2, m);
      break;
    case 'sickle':
      handle(b, 3, 14, 6);
      b.hline(8, 12, 3, m).set(13, 4, m).set(14, 5, m).set(14, 6, m).set(13, 7, m).hline(9, 12, 4, md);
      break;
  }
}

function weapon(b: PixelBuffer, type: string, tierStr: string | undefined): void {
  const m = tierColor(tierStr);
  const md = shade(m, -0.3);
  const ml = shade(m, 0.35);
  switch (type) {
    case 'sword':
      for (let i = 0; i < 9; i++) b.set(6 + i, 9 - i, m).set(7 + i, 9 - i, md).set(6 + i, 8 - i, ml);
      b.set(3, 9, '#8a5d33').set(4, 10, '#8a5d33').set(6, 12, '#8a5d33').set(7, 11, '#8a5d33');
      for (let i = 0; i < 3; i++) b.set(3 + i, 13 - i, HANDLE).set(2 + i, 13 - i, HANDLE_DARK);
      b.set(1, 14, '#f2c14e');
      break;
    case 'axe':
      handle(b, 3, 14, 11);
      b.ellipse(8, 1, 7, 9, m).vline(9, 2, 8, md).set(14, 4, ml);
      break;
    case 'spear':
      for (let i = 0; i < 12; i++) b.set(2 + i, 14 - i, HANDLE);
      b.rect(12, 1, 3, 3, m).set(14, 0, ml).set(11, 3, md);
      break;
    case 'bow':
      for (let y = 1; y < 15; y++) b.set(4 + Math.round(Math.sin((y / 14) * Math.PI) * 6), y, y % 4 === 0 ? m : HANDLE);
      b.vline(4, 1, 14, '#e6e2d3').rect(9, 7, 2, 2, m);
      break;
    case 'staff':
      for (let i = 0; i < 12; i++) b.set(2 + i, 15 - i, HANDLE);
      b.ellipse(10, 0, 6, 6, m).set(12, 2, '#ffffff').set(11, 1, ml);
      break;
    case 'wand':
      for (let i = 0; i < 9; i++) b.set(3 + i, 13 - i, '#e8dcc0');
      b.rect(11, 2, 3, 3, m).set(12, 1, ml).set(14, 3, ml).set(12, 5, ml);
      break;
    case 'dagger':
      for (let i = 0; i < 6; i++) b.set(7 + i, 8 - i, m).set(8 + i, 8 - i, md);
      b.hline(4, 8, 9, '#8a5d33').set(6, 8, '#8a5d33');
      for (let i = 0; i < 3; i++) b.set(4 + i, 12 - i, HANDLE);
      break;
    case 'mace':
      handle(b, 3, 14, 8);
      b.ellipse(9, 1, 6, 6, m).set(12, 0, md).set(15, 3, md).set(9, 3, md).set(12, 6, md);
      break;
    case 'shield':
      b.rect(3, 2, 10, 8, m).ellipse(3, 6, 10, 9, m).vline(8, 3, 13, md).hline(4, 12, 6, md).set(5, 4, ml);
      break;
    default:
      b.rect(4, 4, 8, 8, m);
  }
}

function armor(b: PixelBuffer, slot: string, tierStr: string | undefined): void {
  const t = Number(tierStr) || 0;
  const m = t === 0 ? '#a8743f' : tierColor(tierStr);
  const md = shade(m, -0.3);
  const ml = shade(m, 0.3);
  switch (slot) {
    case 'head':
      b.ellipse(3, 3, 10, 9, m).rect(3, 8, 10, 4, m).hline(3, 12, 8, md).rect(6, 9, 4, 2, '#2a2030').set(5, 4, ml);
      break;
    case 'chest':
      b.rect(3, 3, 10, 11, m).rect(1, 3, 3, 6, m).rect(12, 3, 3, 6, m).vline(8, 4, 13, md).rect(6, 2, 4, 2, '#2a2030').set(4, 5, ml);
      break;
    case 'gloves':
      b.rect(3, 4, 5, 8, m).rect(9, 5, 5, 8, m).hline(3, 7, 11, md).hline(9, 13, 12, md).set(4, 5, ml);
      break;
    case 'boots':
      b.rect(3, 3, 4, 9, m).rect(3, 10, 6, 3, m).rect(10, 3, 4, 9, m).rect(10, 10, 5, 3, m).hline(3, 8, 12, md).hline(10, 14, 12, md);
      break;
    case 'ring':
      b.ellipse(3, 5, 10, 9, m).ellipse(5, 7, 6, 5, null).rect(6, 2, 4, 4, '#b06ad6').set(7, 3, '#e8c8ff');
      break;
    case 'necklace':
      for (let i = 0; i < 6; i++) b.set(3 + i, 2 + i, m).set(12 - i, 2 + i, m);
      b.ellipse(6, 8, 4, 5, '#4a7fd6').set(7, 9, '#c8e0ff');
      break;
    case 'cape':
      b.rect(4, 2, 8, 3, m).ellipse(2, 3, 12, 12, m).rect(2, 9, 12, 5, m).vline(7, 4, 13, md).vline(10, 5, 13, md);
      break;
    default:
      b.rect(4, 4, 8, 8, m);
  }
}

function fish(b: PixelBuffer, color: string): void {
  b.ellipse(2, 5, 10, 7, color).set(5, 7, '#2a2030').set(4, 7, '#ffffff');
  b.rect(12, 5, 2, 7, color).set(14, 4, color).set(14, 12, color).set(13, 8, shade(color, -0.2));
  b.hline(3, 10, 11, shade(color, -0.25)).hline(5, 9, 6, shade(color, 0.3));
}

function potion(b: PixelBuffer, color: string): void {
  b.rect(6, 1, 4, 2, '#8a5d33').rect(6, 3, 4, 3, '#cfe8f5');
  b.ellipse(3, 5, 10, 10, '#cfe8f5').ellipse(4, 7, 8, 7, color).set(5, 8, shade(color, 0.5)).set(6, 8, shade(color, 0.5));
}

export function drawExtraIcon(icon: string, b: PixelBuffer): boolean {
  const [family, a, c] = icon.split(':');
  switch (family) {
    case 'seed':
      seedBag(b, a ?? '');
      return true;
    case 'crop':
      produce(b, a ?? '');
      return true;
    case 'tool':
      tool(b, a ?? 'hoe', c);
      return true;
    case 'weapon':
      weapon(b, a ?? 'sword', c);
      return true;
    case 'armor':
      armor(b, a ?? 'chest', c);
      return true;
    case 'wings': {
      // A pair of small wings: icon:style:color
      const col = `#${c ?? 'ffffff'}`;
      const dark = shade(col, -0.3);
      for (const flip of [false, true]) {
        for (let y = 2; y < 13; y++) {
          const w = Math.round(Math.sin(((y - 2) / 11) * Math.PI) * 5) + (y < 7 ? 1 : 0);
          for (let x = 0; x < w; x++) {
            const px = flip ? 9 + x : 6 - x;
            b.set(px, y, a === 'demon' || a === 'dragon' ? (x === w - 1 || y % 3 === 0 ? dark : col) : (x + y) % 3 === 0 ? shade(col, -0.12) : col);
          }
        }
      }
      b.rect(7, 5, 2, 5, '#8a6a42');
      return true;
    }
    case 'fertilizer':
      b.ellipse(2, 4, 12, 11, a === 'speed' ? '#5aa0a0' : '#8a6a42').rect(5, 2, 6, 3, '#6b4628');
      b.rect(5, 7, 6, 5, a === 'speed' ? '#b6f0d8' : '#c9e07a').set(7, 8, a === 'speed' ? '#5fc49a' : '#6f9a3c');
      return true;
    case 'stone':
      b.ellipse(1, 4, 14, 10, '#9a968e').ellipse(3, 5, 6, 4, '#b9b5ac').shadeIf((x, y) => y > 11, '#7f7b74');
      return true;
    case 'ore': {
      const col = metal(a);
      b.ellipse(1, 3, 14, 11, '#7d7a74').shadeIf((x, y) => y > 10, '#66635e');
      for (const [x, y] of [[4, 6], [9, 5], [6, 9], [11, 9], [8, 7]] as const) b.set(x, y, col).set(x + 1, y, shade(col, 0.3));
      return true;
    }
    case 'bar': {
      const col = metal(a);
      for (let y = 0; y < 5; y++) b.hline(2 + (4 - y), 13 - (4 - y) + 2, 6 + y, y === 0 ? shade(col, 0.35) : col);
      b.rect(2, 11, 14, 2, shade(col, -0.3));
      return true;
    }
    case 'log': {
      const wood = a === 'hard' ? '#6b4628' : a === 'elder' ? '#4a3a5a' : a === 'spirit' ? '#3f9a8a' : '#9a6334';
      const ring = a === 'hard' ? '#b08a55' : a === 'elder' ? '#9a86c0' : a === 'spirit' ? '#b6f0d8' : '#d6b07a';
      b.rect(1, 5, 12, 7, wood).hline(1, 12, 11, shade(wood, -0.25)).hline(1, 12, 5, shade(wood, 0.25));
      b.ellipse(11, 4, 5, 9, ring).set(13, 8, shade(ring, -0.3)).set(13, 7, shade(ring, -0.3));
      return true;
    }
    case 'plank': {
      b.rect(1, 4, 14, 3, '#c9935a').rect(1, 8, 14, 3, '#b8844d').hline(1, 14, 6, '#8a5d33').hline(1, 14, 10, '#8a5d33');
      return true;
    }
    case 'fish':
      fish(b, hex(a, '#7d9bb8'));
      return true;
    case 'potion':
      potion(b, hex(a, '#e0483a'));
      return true;
    case 'herb': {
      const col = hex(a, '#5ca84a');
      b.vline(8, 6, 15, shade(col, -0.3));
      for (const [x, y] of [[5, 4], [10, 3], [4, 9], [11, 8], [7, 1]] as const) b.ellipse(x - 2, y, 5, 4, col);
      return true;
    }
    case 'mushroom': {
      const col = hex(a, '#c0392b');
      b.rect(6, 8, 4, 7, '#efe3c2').ellipse(2, 2, 12, 8, col).set(5, 4, '#ffffff').set(9, 3, '#ffffff').set(10, 6, '#ffffff');
      return true;
    }
    case 'berry': {
      const col = hex(a, '#6a3fb0');
      for (const [x, y] of [[3, 6], [8, 5], [6, 9], [10, 10]] as const) b.ellipse(x, y, 4, 4, col).set(x + 1, y + 1, shade(col, 0.4));
      b.rect(7, 2, 2, 3, '#4a9a3c');
      return true;
    }
    case 'fiber':
      for (let i = 0; i < 5; i++) b.vline(4 + i * 2, 2 + (i % 2) * 2, 14, i % 2 ? '#c9b87a' : '#b8a35a');
      b.hline(3, 13, 9, '#8a6a42');
      return true;
    case 'gem': {
      const col = hex(a, '#4a7fd6');
      b.hline(5, 10, 3, shade(col, 0.4));
      for (let y = 4; y < 13; y++) {
        const w = y < 7 ? 3 + (y - 4) : 6 - (y - 7);
        b.hline(8 - w, 7 + w, y, y < 7 ? col : shade(col, -0.2));
      }
      b.set(6, 5, '#ffffff');
      return true;
    }
    case 'cloth':
      b.rect(2, 4, 12, 9, hex(a, '#d9cdb4')).hline(2, 13, 8, shade(hex(a, '#d9cdb4'), -0.2)).vline(13, 4, 12, shade(hex(a, '#d9cdb4'), -0.3));
      return true;
    case 'food': {
      const r = seeded(icon.length);
      switch (a) {
        case 'flour':
          b.ellipse(2, 3, 12, 12, '#efe7cf').rect(5, 1, 6, 3, '#d6c79f').set(7, 8, '#c9b87a');
          break;
        case 'soup':
          b.ellipse(1, 6, 14, 9, '#8a5d33').ellipse(2, 5, 12, 5, hex(c, '#e8862e')).set(5, 6, '#ffffff');
          break;
        case 'pie':
          b.ellipse(1, 6, 14, 8, '#d39a4f').ellipse(2, 5, 12, 6, hex(c, '#e8862e')).hline(3, 12, 7, '#e8b56a');
          break;
        case 'egg':
          b.ellipse(4, 2, 8, 12, '#f4ead2').ellipse(6, 4, 3, 4, '#ffffff');
          break;
        case 'milk':
          b.rect(5, 1, 6, 3, '#cfe8f5').rect(4, 4, 8, 10, '#f8f8f4').rect(4, 4, 8, 2, '#4a7fd6');
          break;
        case 'cheese':
          for (let y = 5; y < 13; y++) b.hline(2 + Math.max(0, 8 - y), 13, y, '#f2c14e');
          b.set(7, 9, '#d6a23a').set(10, 7, '#d6a23a').set(11, 11, '#d6a23a');
          break;
        case 'skewer':
          b.hline(1, 14, 8, '#e8dcc0');
          for (const x of [3, 7, 11]) b.ellipse(x - 1, 5, 4, 6, hex(c, '#a8473a'));
          break;
        default:
          b.ellipse(2, 4, 12, 10, hex(c, '#d39a4f'));
          for (let i = 0; i < 4; i++) b.set(4 + Math.floor(r() * 8), 6 + Math.floor(r() * 5), '#ffffff');
      }
      return true;
    }
    case 'scale':
    case 'fang':
    case 'hide':
    case 'bone':
    case 'essence': {
      const col = hex(a, family === 'hide' ? '#8a5d33' : family === 'bone' ? '#e8e0cc' : family === 'essence' ? '#b06ad6' : '#5aa0a0');
      if (family === 'hide') b.rect(2, 3, 12, 10, col).set(2, 3, null).set(13, 12, null).hline(4, 11, 7, shade(col, -0.2));
      else if (family === 'bone') b.rect(4, 6, 8, 3, col).ellipse(1, 4, 4, 4, col).ellipse(1, 7, 4, 4, col).ellipse(11, 4, 4, 4, col).ellipse(11, 7, 4, 4, col);
      else if (family === 'fang') for (let y = 2; y < 14; y++) b.hline(5 + Math.floor(y / 3), 10 - Math.floor(y / 4), y, col);
      else if (family === 'essence') b.ellipse(3, 3, 10, 10, col).ellipse(5, 5, 4, 4, shade(col, 0.5));
      else for (const [x, y] of [[3, 3], [8, 4], [5, 8], [10, 9]] as const) b.ellipse(x, y, 5, 4, col).set(x + 1, y + 1, shade(col, 0.4));
      return true;
    }
    case 'key':
      b.ellipse(1, 2, 7, 7, hex(a, '#f2c14e')).set(4, 5, null).hline(7, 14, 5, hex(a, '#f2c14e')).vline(12, 6, 8, hex(a, '#f2c14e')).vline(14, 6, 9, hex(a, '#f2c14e'));
      return true;
    case 'stone_enh':
      b.ellipse(3, 2, 10, 12, '#4a7fd6').ellipse(5, 4, 4, 5, '#8fb8f0').set(9, 9, '#ffffff');
      return true;
    case 'pet': {
      const col = hex(c, '#a8743f');
      if (a === 'slime') b.ellipse(2, 5, 12, 9, col).set(6, 8, '#2a2030').set(10, 8, '#2a2030').set(5, 6, '#ffffff');
      else {
        b.ellipse(2, 7, 9, 6, col).ellipse(9, 3, 6, 6, col).set(12, 5, '#2a2030');
        if (a === 'cat' || a === 'fox') b.set(10, 2, col).set(13, 2, col).set(10, 1, col).set(13, 1, col);
        if (a === 'fox') b.set(1, 9, '#ffffff').set(0, 8, col);
        if (a === 'dragonling') b.ellipse(3, 2, 6, 5, shade(col, 0.3)).set(10, 2, '#f2c14e').set(13, 2, '#f2c14e');
        for (const x of [4, 8]) b.vline(x, 12, 14, shade(col, -0.3));
      }
      return true;
    }
    case 'mount': {
      const col = hex(c, '#8a5d33');
      b.ellipse(1, 6, 11, 6, col).rect(10, 3, 3, 6, col).ellipse(10, 1, 6, 4, col).set(14, 2, '#2a2030');
      for (const x of [3, 5, 8, 10]) b.vline(x, 11, 14, shade(col, -0.3));
      if (a === 'stag') b.set(10, 0, '#d6c79f').set(12, 0, '#d6c79f');
      b.rect(5, 5, 4, 2, '#7a3a2a');
      return true;
    }
    case 'animal': {
      if (a === 'chicken') {
        b.ellipse(3, 5, 9, 8, '#f4f1e6').ellipse(9, 2, 5, 5, '#f4f1e6').set(13, 4, '#e8a03a').set(11, 3, '#2a2030').set(10, 1, '#e0483a').set(11, 1, '#e0483a');
        b.vline(6, 12, 14, '#e8a03a').vline(9, 12, 14, '#e8a03a');
      } else {
        const col = a === 'cow' ? '#f4f1e6' : '#e8e0cc';
        b.ellipse(1, 5, 12, 7, col).ellipse(10, 3, 5, 5, a === 'cow' ? '#f4f1e6' : '#5a5260').set(13, 5, '#2a2030');
        if (a === 'cow') b.ellipse(3, 6, 4, 3, '#2a2030').ellipse(8, 8, 3, 2, '#2a2030').set(11, 2, '#d6c79f').set(14, 2, '#d6c79f');
        else for (const [x, y] of [[2, 6], [5, 5], [8, 6], [4, 9], [7, 9]] as const) b.set(x, y, '#ffffff');
        for (const x of [3, 5, 8, 10]) b.vline(x, 11, 14, '#5a5260');
      }
      return true;
    }
    case 'chest':
      b.rect(2, 5, 12, 9, '#a8743f').rect(2, 3, 12, 4, '#b8844d').hline(2, 13, 7, '#6b4628').rect(7, 6, 2, 3, '#f2c14e');
      return true;
  }
  return false;
}
