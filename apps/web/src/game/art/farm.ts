import type { CropDef } from '@terrago/shared';
import { OUTLINE, PixelBuffer, seeded, shade } from './pixel';

/**
 * Farm art, generated from code: soil states for plots and four growth stages
 * for every crop (colours and silhouette come from crops.json).
 */

export type SoilState = 'wild' | 'farmland' | 'tilled' | 'wet';

export function soilArt(state: SoilState, variant = 0): PixelBuffer {
  const b = new PixelBuffer(16, 16);
  const r = seeded(77 + variant * 13 + state.length * 31);
  if (state === 'wild') {
    // Grass with a corner stake and rope: land you can buy later.
    b.set(1, 9, '#8a5d33').set(1, 10, '#8a5d33').set(1, 11, '#6b4628').set(1, 8, '#b8844d');
    for (let x = 2; x < 15; x += 3) b.set(x, 9, 'rgba(232,214,160,0.55)');
    return b;
  }
  if (state === 'farmland') {
    b.rect(1, 1, 14, 14, '#9c7a4f');
    for (let i = 0; i < 14; i++) b.set(1 + Math.floor(r() * 14), 1 + Math.floor(r() * 14), r() < 0.5 ? '#8a6a42' : '#b08d5e');
    for (let i = 0; i < 5; i++) b.set(1 + Math.floor(r() * 14), 1 + Math.floor(r() * 14), '#6f9a3c');
    return b;
  }
  const base = state === 'wet' ? '#4f3622' : '#7b5738';
  const furrow = state === 'wet' ? '#3d2918' : '#634529';
  const light = state === 'wet' ? '#5e412a' : '#8d6744';
  b.rect(0, 0, 16, 16, base);
  for (let y = 2; y < 16; y += 4) {
    b.hline(1, 14, y, furrow);
    b.hline(1, 14, y - 1, light);
  }
  b.hline(0, 15, 0, shade(base, -0.2)).hline(0, 15, 15, shade(base, -0.3)).vline(0, 0, 15, shade(base, -0.15)).vline(15, 0, 15, shade(base, -0.25));
  if (state === 'wet') for (let i = 0; i < 4; i++) b.set(2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), '#6f8fb0');
  return b;
}

/** A crop at a growth stage (0 = seedling ... 3 = ready). Returned buffer is 16 wide, up to 26 tall. */
export function cropArt(def: CropDef, stage: number): PixelBuffer {
  const { leaf, fruit, shape } = def.art;
  const dark = shade(leaf, -0.3);
  const b = new PixelBuffer(16, 26);
  const g = 25; // ground row
  if (stage === 0) {
    // Sprout: two tiny leaves.
    b.vline(8, g - 3, g, dark);
    b.set(7, g - 3, leaf).set(6, g - 4, leaf).set(9, g - 3, leaf).set(10, g - 4, leaf);
    b.outline(OUTLINE);
    return b;
  }
  const grow = stage; // 1, 2, 3
  switch (shape) {
    case 'root': {
      const h = 3 + grow * 2;
      for (const x of [6, 8, 10]) {
        b.vline(x, g - h, g - 1, leaf);
        b.set(x - 1, g - h + 1, leaf).set(x + 1, g - h + 2, dark);
      }
      if (stage === 3) b.rect(6, g - 2, 5, 3, fruit).hline(7, 9, g - 2, shade(fruit, 0.2));
      break;
    }
    case 'grain': {
      const h = 4 + grow * 3;
      for (const x of [4, 7, 10, 12]) {
        b.vline(x, g - h, g, stage === 3 ? shade(fruit, -0.25) : leaf);
        if (stage >= 2) b.rect(x - 1, g - h, 2, 3 + stage, stage === 3 ? fruit : shade(leaf, 0.15));
      }
      break;
    }
    case 'stalk': {
      const h = 5 + grow * 5;
      b.rect(7, g - h, 2, h, leaf).vline(8, g - h, g, dark);
      for (let y = g - h + 3; y < g - 1; y += 4) b.set(5, y, leaf).set(6, y + 1, leaf).set(10, y - 1, leaf).set(9, y, leaf);
      if (stage === 3) b.rect(9, g - h + 4, 3, 6, fruit).set(10, g - h + 3, '#9fb84a');
      break;
    }
    case 'vine': {
      const w = 4 + grow * 3;
      b.ellipse(8 - w / 2, g - 3 - grow * 2, w, 3 + grow * 2, leaf);
      b.shadeIf((x, y) => y > g - 3, dark);
      if (stage === 2) b.set(7, g - 3, shade(fruit, 0.4)).set(10, g - 4, shade(fruit, 0.4));
      if (stage === 3) {
        if (def.id.includes('pumpkin')) b.ellipse(3, g - 7, 10, 8, fruit).vline(8, g - 7, g - 1, shade(fruit, -0.2)).rect(7, g - 9, 2, 2, '#5d3d22');
        else for (const [x, y] of [[5, g - 5], [9, g - 7], [11, g - 4], [7, g - 3]] as const) b.rect(x, y, 2, 2, fruit);
      }
      break;
    }
    case 'bush': {
      const w = 5 + grow * 3;
      b.ellipse(8 - w / 2, g - 2 - grow * 3, w, 3 + grow * 3, leaf);
      b.shadeIf((x, y) => y > g - 3 || x > 10, dark);
      if (stage === 3) {
        const r = seeded(def.id.length * 7);
        for (let i = 0; i < 6; i++) {
          const x = 3 + Math.floor(r() * 10);
          const y = g - 9 + Math.floor(r() * 7);
          if (b.get(x, y)) b.set(x, y, fruit).set(x, y + 1, shade(fruit, -0.25));
        }
      }
      break;
    }
    case 'flower': {
      const h = 4 + grow * 4;
      b.vline(8, g - h, g, dark);
      b.set(6, g - 4, leaf).set(7, g - 5, leaf).set(9, g - 6, leaf).set(10, g - 7, leaf);
      if (stage >= 2) b.ellipse(6, g - h - 3, 5, 4, stage === 3 ? fruit : shade(leaf, 0.2));
      if (stage === 3) b.set(8, g - h - 2, '#fff6c8').set(5, g - h - 1, fruit).set(11, g - h - 1, fruit);
      break;
    }
  }
  b.outline(OUTLINE);
  return b;
}

/** Small droplet marker for plots whose crop needs water. */
export function needsWaterArt(): PixelBuffer {
  const b = new PixelBuffer(7, 9);
  b.set(3, 0, '#5fb0e8').hline(2, 4, 1, '#5fb0e8').hline(1, 5, 2, '#5fb0e8').rect(1, 3, 5, 3, '#5fb0e8').hline(2, 4, 6, '#3f86c9');
  b.set(2, 3, '#cfe8f5');
  b.outline(OUTLINE);
  return b;
}

/** Sparkle shown on crops that are ready to harvest. */
export function readyArt(): PixelBuffer {
  const b = new PixelBuffer(7, 7);
  b.vline(3, 0, 6, '#ffe48a').hline(0, 6, 3, '#ffe48a').set(3, 3, '#ffffff');
  return b;
}
