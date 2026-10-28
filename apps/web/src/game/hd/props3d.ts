/**
 * Low-poly props, buildings, resource nodes, farm plots and loot for the 3D
 * view. Props are baked to vertex-coloured geometry so a forest of a thousand
 * pines is a handful of instanced draw calls.
 *
 * Local space: footprint centre at the origin, ground at y = 0, +Z = south
 * (toward the camera), 1 unit = 1 tile.
 */
import * as THREE from 'three';
import { PROP_TYPES, type BuildingDef, type PropType } from '@terrago/shared';
import { styleOf } from '../art/buildings';
import { Baker, box, cone, cyl, dodeca, hash01, ico, shade, sphere, torus } from './kit';

export const PROP_VARIANTS = 3;
const LEAF = ['#4f9a3c', '#5aa844', '#468a36'];
const PINE = ['#2f7a46', '#367f4a', '#2a6e40'];
const TRUNK = '#6d4428';
const STONE = '#9a968e';
const WOOD = '#8a5530';
const WOOD_D = '#5e3a20';

function oak(b: Baker, v: number, color = LEAF[v % 3]!, scale = 1): void {
  b.add(cyl(0.09, 0.13, 0.7, 6), TRUNK, 0, 0.35 * scale, 0, 0, 0, 0, scale, scale, scale);
  const blobs: [number, number, number, number][] = [
    [0, 1.05, 0, 0.48],
    [0.28, 0.9, 0.1, 0.32],
    [-0.25, 0.92, -0.08, 0.34],
    [0.05, 1.32, -0.05, 0.3],
  ];
  blobs.forEach(([x, y, z, r], i) => b.add(ico(r, 0), i % 2 ? shade(color, 0.05) : color, x * scale, y * scale, z * scale, v + i, v * 2, 0, scale, scale, scale));
}

function pine(b: Baker, v: number, color = PINE[v % 3]!, snow = false, scale = 1): void {
  const s = scale * (0.9 + v * 0.1);
  b.add(cyl(0.07, 0.1, 0.4, 5), TRUNK, 0, 0.2 * s, 0, 0, 0, 0, s, s, s);
  for (let i = 0; i < 3; i++) {
    const r = 0.5 - i * 0.12;
    b.add(cone(r, 0.6, 7), shade(color, i * 0.03), 0, (0.55 + i * 0.36) * s, 0, 0, v + i, 0, s, s, s);
    if (snow) b.add(cone(r * 0.6, 0.28, 7), '#f4f8ff', 0, (0.72 + i * 0.36) * s, 0, 0, v + i, 0, s, s, s);
  }
}

/** Build a prop. Returns the baked lit + unlit geometries. */
export function propGeometry(type: PropType, v: number): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  const b = new Baker();
  const size = PROP_TYPES[type] ?? { w: 1, h: 1 };
  const W = size.w;
  const H = size.h;
  switch (type) {
    case 'tree_oak':
      oak(b, v);
      break;
    case 'tree_ancient':
      oak(b, v, '#3f7a2c', 1.6);
      break;
    case 'tree_fruit':
      oak(b, v, '#5aa844');
      for (let i = 0; i < 6; i++) b.add(sphere(0.06, 5, 3), '#d0302a', Math.cos(i * 1.7) * 0.42, 0.9 + (i % 3) * 0.15, Math.sin(i * 1.7) * 0.42);
      break;
    case 'tree_pine':
      pine(b, v);
      break;
    case 'tree_snow':
      pine(b, v, '#3a6a5a', true);
      break;
    case 'tree_swamp':
      b.add(cyl(0.1, 0.18, 0.9, 6), '#4a3a2a', 0, 0.45, 0, 0.1, 0, 0.1);
      for (let i = 0; i < 4; i++) b.add(ico(0.3, 0), '#4a6a3a', Math.cos(i * 1.6) * 0.25, 1.0, Math.sin(i * 1.6) * 0.25, 0, 0, 0, 1, 0.6, 1);
      for (let i = 0; i < 5; i++) b.add(box(0.03, 0.4, 0.03), '#6a8a4a', Math.cos(i * 1.3) * 0.4, 0.7, Math.sin(i * 1.3) * 0.4);
      break;
    case 'tree_dead':
      b.add(cyl(0.06, 0.12, 1.0, 5), '#6a5a4a', 0, 0.5, 0);
      b.add(cyl(0.03, 0.05, 0.5, 4), '#6a5a4a', 0.15, 0.85, 0, 0, 0, -0.8);
      b.add(cyl(0.03, 0.05, 0.4, 4), '#6a5a4a', -0.12, 0.75, 0.05, 0.2, 0, 0.9);
      break;
    case 'bush':
      b.add(ico(0.3, 0), LEAF[v % 3]!, 0, 0.22, 0, v, v, 0, 1.2, 0.8, 1.1);
      b.add(ico(0.18, 0), shade(LEAF[v % 3]!, 0.06), 0.18, 0.3, 0.08);
      break;
    case 'rock':
      b.add(dodeca(0.32), STONE, 0, 0.18, 0, v, v * 2, 0, 1.1, 0.7, 1);
      b.add(dodeca(0.15), shade(STONE, -0.08), 0.25, 0.08, 0.15, v, 0, 0);
      break;
    case 'stump':
      b.add(cyl(0.22, 0.26, 0.25, 7), TRUNK, 0, 0.125, 0);
      b.add(cyl(0.2, 0.2, 0.02, 7), '#c9a36b', 0, 0.255, 0);
      break;
    case 'fence_h':
      for (const x of [-0.42, 0.42]) b.add(box(0.09, 0.5, 0.09), WOOD_D, x, 0.25, 0);
      for (const y of [0.18, 0.36]) b.add(box(1.0, 0.07, 0.05), WOOD, 0, y, 0);
      break;
    case 'fence_v':
      for (const z of [-0.42, 0.42]) b.add(box(0.09, 0.5, 0.09), WOOD_D, 0, 0.25, z);
      for (const y of [0.18, 0.36]) b.add(box(0.05, 0.07, 1.0), WOOD, 0, y, 0);
      break;
    case 'lamp':
      b.add(cyl(0.04, 0.06, 1.3, 6), '#3a3640', 0, 0.65, 0);
      b.add(box(0.2, 0.05, 0.2), '#3a3640', 0, 1.32, 0);
      b.glowAdd(box(0.15, 0.2, 0.15), '#ffe08a', 0, 1.42, 0);
      b.add(cone(0.16, 0.12, 4), '#3a3640', 0, 1.58, 0, 0, Math.PI / 4);
      break;
    case 'torch':
      b.add(cyl(0.04, 0.05, 0.9, 5), WOOD_D, 0, 0.45, 0);
      b.glowAdd(cone(0.09, 0.25, 5), '#ffb04a', 0, 1.02, 0);
      b.glowAdd(cone(0.05, 0.16, 5), '#fff0a0', 0, 1.0, 0);
      break;
    case 'sign':
      b.add(box(0.07, 0.7, 0.07), WOOD_D, 0, 0.35, 0);
      b.add(box(0.6, 0.32, 0.06), WOOD, 0, 0.62, 0.04);
      break;
    case 'barrel':
      b.add(cyl(0.24, 0.24, 0.55, 8), WOOD, 0, 0.275, 0);
      for (const y of [0.1, 0.45]) b.add(cyl(0.25, 0.25, 0.04, 8), '#3a3640', 0, y, 0);
      break;
    case 'crate':
      b.add(box(0.55, 0.5, 0.55), WOOD, 0, 0.25, 0, 0, v * 0.3, 0);
      b.add(box(0.57, 0.08, 0.57), WOOD_D, 0, 0.42, 0, 0, v * 0.3, 0);
      break;
    case 'hay_bale':
      b.add(cyl(0.3, 0.3, 0.6, 8), '#e0c060', 0, 0.3, 0, 0, 0, Math.PI / 2);
      break;
    case 'well':
      b.add(cyl(0.6, 0.65, 0.5, 10), STONE, 0, 0.25, 0);
      b.add(cyl(0.48, 0.48, 0.02, 10), '#2a5a8a', 0, 0.45, 0);
      for (const x of [-0.55, 0.55]) b.add(box(0.08, 1.1, 0.08), WOOD_D, x, 0.85, 0);
      b.add(cone(0.85, 0.5, 4), '#a8473a', 0, 1.55, 0, 0, Math.PI / 4, 0, 1, 1, 0.8);
      break;
    case 'fountain':
      b.add(cyl(1.6, 1.7, 0.35, 12), '#cfc6b0', 0, 0.175, 0, 0, 0, 0, 1, 1, H / W);
      b.glowAdd(cyl(1.45, 1.45, 0.02, 12), '#6cb0de', 0, 0.34, 0, 0, 0, 0, 1, 1, H / W);
      b.add(cyl(0.2, 0.3, 0.8, 8), '#cfc6b0', 0, 0.6, 0);
      b.add(cyl(0.6, 0.4, 0.15, 10), '#cfc6b0', 0, 1.0, 0);
      b.glowAdd(cone(0.25, 0.55, 8), '#bfe6ff', 0, 1.35, 0);
      break;
    case 'market_stall': {
      b.add(box(W * 0.9, 0.55, 0.6), WOOD, 0, 0.28, 0.35);
      for (const x of [-W * 0.42, W * 0.42]) for (const z of [-0.55, 0.55]) b.add(box(0.08, 1.4, 0.08), WOOD_D, x, 0.7, z);
      const cols = ['#d0302a', '#f4f0e6'];
      for (let i = 0; i < 6; i++) b.add(box(W * 0.95 / 6, 0.06, 1.4), cols[i % 2]!, -W * 0.95 / 2 + (i + 0.5) * (W * 0.95 / 6), 1.42, 0, 0.18);
      for (let i = 0; i < 5; i++) b.add(sphere(0.08, 5, 3), ['#f08a2e', '#d0302a', '#e8c24a', '#5aa844'][i % 4]!, -0.8 + i * 0.4, 0.62, 0.35);
      break;
    }
    case 'bench':
      b.add(box(1.6, 0.08, 0.45), WOOD, 0, 0.35, 0);
      b.add(box(1.6, 0.35, 0.06), WOOD, 0, 0.6, -0.2);
      for (const x of [-0.7, 0.7]) b.add(box(0.08, 0.35, 0.4), '#3a3640', x, 0.17, 0);
      break;
    case 'notice_board':
      for (const x of [-0.8, 0.8]) b.add(box(0.1, 1.5, 0.1), WOOD_D, x, 0.75, 0);
      b.add(box(1.6, 0.9, 0.08), WOOD, 0, 1.0, 0);
      for (let i = 0; i < 4; i++) b.add(box(0.28, 0.32, 0.01), '#f3e6c4', -0.5 + i * 0.34, 1.0 + (i % 2) * 0.1, 0.05, 0, 0, (i - 1.5) * 0.08);
      break;
    case 'teleport_pad':
      b.add(cyl(1.4, 1.5, 0.12, 12), '#7a7090', 0, 0.06, 0);
      b.glowAdd(torus(1.1, 0.05, 4, 24), '#7fe0ff', 0, 0.13, 0, Math.PI / 2);
      b.glowAdd(torus(0.6, 0.04, 4, 18), '#b6a4ff', 0, 0.13, 0, Math.PI / 2);
      for (let i = 0; i < 4; i++) b.add(box(0.15, 0.5, 0.15), '#5a5070', Math.cos(i * 1.57 + 0.78) * 1.3, 0.25, Math.sin(i * 1.57 + 0.78) * 1.3);
      break;
    case 'flower_bed':
      b.add(box(W * 0.95, 0.12, H * 0.9), '#6d4428', 0, 0.06, 0);
      for (let i = 0; i < 10; i++) b.add(sphere(0.07, 5, 3), ['#e48aa9', '#e8c24a', '#d0302a', '#b06ad6', '#ffffff'][i % 5]!, -W * 0.4 + (i % 5) * (W * 0.2), 0.2, (i < 5 ? -0.15 : 0.15));
      break;
    case 'scarecrow':
      b.add(box(0.07, 1.2, 0.07), WOOD_D, 0, 0.6, 0);
      b.add(box(0.9, 0.06, 0.06), WOOD_D, 0, 0.95, 0);
      b.add(box(0.36, 0.45, 0.2), '#8a5d33', 0, 0.85, 0);
      b.add(sphere(0.17, 7, 5), '#e0c060', 0, 1.25, 0);
      b.add(cone(0.3, 0.3, 8), '#6d4428', 0, 1.42, 0);
      break;
    case 'cactus':
      b.add(cyl(0.14, 0.16, 1.0, 7), '#4f8a3a', 0, 0.5, 0);
      b.add(cyl(0.08, 0.08, 0.35, 6), '#4f8a3a', 0.2, 0.6, 0, 0, 0, -0.6);
      b.add(cyl(0.08, 0.08, 0.3, 6), '#4f8a3a', -0.18, 0.75, 0, 0, 0, 0.6);
      break;
    case 'crystal':
      for (let i = 0; i < 4; i++) b.glowAdd(cone(0.12, 0.6 - i * 0.08, 5), ['#b6a4ff', '#7fe0ff', '#c8b8ff', '#9ad0ff'][i]!, Math.cos(i * 1.7) * 0.15, 0.3, Math.sin(i * 1.7) * 0.15, Math.cos(i) * 0.3, 0, Math.sin(i) * 0.3);
      break;
    case 'stalagmite':
      b.add(cone(0.3, 1.0, 6), '#6a6070', 0, 0.5, 0, 0, v);
      b.add(cone(0.15, 0.5, 6), '#7a7080', 0.22, 0.25, 0.1);
      break;
    case 'ruin_pillar':
      b.add(cyl(0.26, 0.3, 1.2 - v * 0.25, 8), '#b8b0a0', 0, (1.2 - v * 0.25) / 2, 0);
      b.add(box(0.7, 0.15, 0.7), '#a8a090', 0, 0.075, 0);
      break;
    case 'bones':
      b.add(sphere(0.12, 6, 4), '#e8e0cc', 0, 0.1, 0);
      for (let i = 0; i < 3; i++) b.add(cyl(0.025, 0.025, 0.4, 4), '#e8e0cc', Math.cos(i * 2) * 0.2, 0.03, Math.sin(i * 2) * 0.2, Math.PI / 2, i, 0);
      break;
    case 'mushroom_big':
      b.add(cyl(0.1, 0.14, 0.6, 7), '#efe7cf', 0, 0.3, 0);
      b.add(sphere(0.38, 9, 5), '#c0392b', 0, 0.6, 0, 0, 0, 0, 1, 0.55, 1);
      break;
    case 'reeds':
      for (let i = 0; i < 6; i++) b.add(box(0.03, 0.6, 0.03), '#6a8a3a', Math.cos(i * 1.1) * 0.2, 0.3, Math.sin(i * 1.1) * 0.2, Math.cos(i) * 0.15, 0, Math.sin(i) * 0.15);
      break;
    case 'ladder_down':
    case 'ladder_up':
      b.add(box(0.85, 0.04, 0.85), '#1a1420', 0, 0.02, 0);
      for (const x of [-0.25, 0.25]) b.add(box(0.06, type === 'ladder_up' ? 1.6 : 0.3, 0.06), WOOD, x, type === 'ladder_up' ? 0.8 : 0.15, 0);
      for (let i = 0; i < (type === 'ladder_up' ? 5 : 1); i++) b.add(box(0.5, 0.04, 0.04), WOOD, 0, 0.2 + i * 0.3, 0);
      break;
    case 'mine_entrance':
      b.add(dodeca(0.9), '#7a7068', 0, 0.6, -0.2, 0, 0, 0, 1.7, 1, 0.8);
      b.glowAdd(box(1.1, 1.0, 0.1), '#0a0810', 0, 0.5, 0.45);
      for (const x of [-0.6, 0.6]) b.add(box(0.12, 1.2, 0.12), WOOD_D, x, 0.6, 0.5);
      b.add(box(1.4, 0.12, 0.14), WOOD_D, 0, 1.2, 0.5);
      break;
    case 'dock_post':
      b.add(cyl(0.1, 0.12, 0.8, 6), WOOD_D, 0, 0.3, 0);
      break;
    case 'tent':
      b.add(cone(1.0, 1.3, 4), '#c9a36b', 0, 0.65, 0, 0, Math.PI / 4);
      b.glowAdd(box(0.4, 0.6, 0.02), '#2a1a12', 0, 0.3, 0.68);
      break;
    case 'campfire':
      for (let i = 0; i < 4; i++) b.add(cyl(0.05, 0.05, 0.5, 5), WOOD_D, 0, 0.06, 0, Math.PI / 2, i * 0.8, 0);
      for (let i = 0; i < 6; i++) b.add(dodeca(0.07), STONE, Math.cos(i) * 0.3, 0.04, Math.sin(i) * 0.3);
      b.glowAdd(cone(0.18, 0.45, 5), '#ff8a2a', 0, 0.3, 0);
      b.glowAdd(cone(0.1, 0.3, 5), '#ffe08a', 0, 0.25, 0);
      break;
    case 'furnace':
      b.add(box(1.6, 1.2, 1.4), '#7a7068', 0, 0.6, 0);
      b.add(cyl(0.2, 0.25, 0.8, 6), '#5a5050', 0.4, 1.5, -0.3);
      b.glowAdd(box(0.6, 0.4, 0.05), '#ff8a2a', 0, 0.45, 0.71);
      break;
    case 'anvil':
      b.add(box(0.3, 0.35, 0.3), '#5a4a3a', 0, 0.17, 0);
      b.add(box(0.6, 0.18, 0.28), '#3a3640', 0, 0.44, 0);
      b.add(cone(0.12, 0.25, 4), '#3a3640', 0.38, 0.44, 0, 0, 0, -Math.PI / 2);
      break;
    case 'workbench':
    case 'loom':
    case 'alchemy_table':
      b.add(box(W * 0.9, 0.1, 0.8), WOOD, 0, 0.7, 0);
      for (const x of [-W * 0.4, W * 0.4]) for (const z of [-0.3, 0.3]) b.add(box(0.08, 0.7, 0.08), WOOD_D, x, 0.35, z);
      if (type === 'workbench') {
        b.add(box(0.3, 0.06, 0.1), '#b9bcc4', -0.3, 0.78, 0.1);
        b.add(box(0.2, 0.15, 0.2), WOOD_D, 0.4, 0.82, -0.1);
      } else if (type === 'loom') {
        b.add(box(0.06, 0.8, 0.06), WOOD_D, -0.7, 1.1, -0.3);
        b.add(box(0.06, 0.8, 0.06), WOOD_D, 0.7, 1.1, -0.3);
        b.add(box(1.4, 0.6, 0.02), '#b06ad6', 0, 1.1, -0.3);
      } else for (let i = 0; i < 4; i++) b.glowAdd(cyl(0.06, 0.08, 0.2, 6), ['#5fd45a', '#b06ad6', '#5fb0ff', '#e0483a'][i]!, -0.6 + i * 0.4, 0.85, 0);
      break;
    case 'cooking_pot':
      for (let i = 0; i < 3; i++) b.add(cyl(0.03, 0.03, 0.8, 4), WOOD_D, Math.cos(i * 2.1) * 0.3, 0.4, Math.sin(i * 2.1) * 0.3, Math.sin(i * 2.1) * 0.35, 0, -Math.cos(i * 2.1) * 0.35);
      b.add(sphere(0.25, 8, 6), '#2a2030', 0, 0.35, 0);
      b.glowAdd(cone(0.15, 0.25, 5), '#ff8a2a', 0, 0.1, 0);
      break;
    case 'mill':
      b.add(box(1.4, 1.6, 1.4), '#e4cfa6', 0, 0.8, 0);
      b.add(cone(1.15, 0.8, 4), '#8a5a3c', 0, 2.0, 0, 0, Math.PI / 4);
      for (let i = 0; i < 4; i++) b.add(box(0.2, 1.4, 0.04), '#f3e6c4', 0, 1.5, 0.75, 0, 0, i * 1.57 + 0.4);
      break;
    case 'enhance_altar':
      b.add(box(1.6, 0.6, 0.8), '#7a7090', 0, 0.3, 0);
      b.glowAdd(ico(0.22, 0), '#7fe0ff', 0, 1.0, 0);
      b.glowAdd(torus(0.35, 0.03, 4, 16), '#b6a4ff', 0, 1.0, 0, Math.PI / 2);
      break;
    case 'dungeon_gate':
      for (const x of [-1.1, 1.1]) b.add(box(0.6, 2.2, 0.8), '#5a5060', x, 1.1, 0);
      b.add(box(2.8, 0.6, 0.9), '#5a5060', 0, 2.4, 0);
      b.glowAdd(box(1.6, 2.0, 0.1), '#4a1a6a', 0, 1.0, 0.1);
      b.glowAdd(box(1.2, 1.6, 0.11), '#8a3ad0', 0, 1.0, 0.1);
      break;
    default:
      b.add(box(0.6, 0.6, 0.6), '#8a7a6a', 0, 0.3, 0);
  }
  return b.bake();
}

/** Props that never block the camera or cast shadows. */
export const FLAT_PROPS = new Set<PropType>(['teleport_pad', 'flower_bed', 'bones', 'reeds', 'ladder_down']);

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/** A gable roof: ridge along X at height h, eaves at z = ±d/2 (centred). */
function gable(w: number, d: number, h: number): THREE.BufferGeometry {
  const x0 = -w / 2;
  const x1 = w / 2;
  const z0 = -d / 2;
  const z1 = d / 2;
  // prettier-ignore
  const v = [
    // south slope
    x0, 0, z1, x1, 0, z1, x1, h, 0, x0, 0, z1, x1, h, 0, x0, h, 0,
    // north slope
    x1, 0, z0, x0, 0, z0, x0, h, 0, x1, 0, z0, x0, h, 0, x1, h, 0,
    // gable ends
    x0, 0, z0, x0, 0, z1, x0, h, 0, x1, 0, z1, x1, 0, z0, x1, h, 0,
    // underside
    x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A building as one baked geometry, placed with its footprint's top-left at
 * the origin (x → east, z → south). Returns its height for labels.
 */
export function buildingGeometry(def: BuildingDef): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null; height: number } {
  const b = new Baker();
  const style = styleOf(def);
  const W = def.w;
  const D = def.h;
  const cx = W / 2;
  const cz = D / 2;
  const wall = style === 'stone' || style === 'castle' ? shade(def.wall, -0.1) : style === 'marble' ? '#ece6da' : def.wall;
  const roof = def.roof;
  const wallH = style === 'castle' ? 3.2 : style === 'cottage' ? 1.7 : style === 'timber' ? 2.6 : 2.3;
  // Plinth + walls (inset a little so the roof overhangs).
  b.add(box(W, 0.18, D), shade(wall, -0.25), cx, 0.09, cz);
  b.add(box(W - 0.2, wallH, D - 0.4), wall, cx, wallH / 2, cz - 0.05);
  const front = D - 0.25;
  // Timber frame.
  if (style === 'timber' || style === 'cottage') {
    for (let x = 0.2; x <= W - 0.2; x += (W - 0.4) / Math.max(2, Math.round(W / 2.5))) b.add(box(0.1, wallH, 0.06), '#5e3a20', x, wallH / 2, front);
    b.add(box(W - 0.2, 0.1, 0.06), '#5e3a20', cx, wallH * 0.55, front);
  }
  if (style === 'brick') for (let y = 0.4; y < wallH; y += 0.45) b.add(box(W - 0.18, 0.03, 0.03), shade(wall, -0.12), cx, y, front + 0.01);
  // Door.
  const dx = def.doorX + 0.5;
  b.add(box(0.9, 1.35, 0.08), '#5e3a20', dx, 0.85, front + 0.02);
  b.add(box(1.05, 0.12, 0.1), shade(wall, -0.3), dx, 1.58, front + 0.03);
  b.add(sphere(0.05, 4, 3), '#e8c24a', dx + 0.3, 0.85, front + 0.08);
  // Windows (lit from inside).
  const winY = style === 'castle' ? 2.0 : wallH * 0.58;
  for (let x = 1.1; x < W - 0.6; x += 1.6) {
    if (Math.abs(x - dx) < 0.9) continue;
    b.add(box(0.7, 0.75, 0.06), '#4a321e', x, winY, front + 0.02);
    b.glowAdd(box(0.55, 0.6, 0.06), '#ffd98a', x, winY, front + 0.035);
    b.add(box(0.06, 0.6, 0.07), '#4a321e', x, winY, front + 0.05);
    b.add(box(0.8, 0.07, 0.14), shade(wall, -0.2), x, winY - 0.4, front + 0.06);
  }
  // Side windows.
  for (let z = 1.0; z < D - 1.2; z += 1.8) for (const sx of [0.1 - 0.01, W - 0.1 + 0.01]) b.glowAdd(box(0.06, 0.5, 0.45), '#ffd98a', sx, winY, z);
  let top = wallH;
  if (style === 'castle') {
    // Flat roof with crenellations and corner towers.
    b.add(box(W - 0.1, 0.2, D - 0.3), shade(wall, -0.1), cx, wallH + 0.1, cz - 0.05);
    for (let x = 0.3; x < W - 0.2; x += 0.6) for (const z of [0.25, D - 0.35]) b.add(box(0.32, 0.35, 0.3), wall, x, wallH + 0.37, z);
    for (const [tx, tz] of [
      [0.5, 0.5],
      [W - 0.5, 0.5],
      [0.5, D - 0.6],
      [W - 0.5, D - 0.6],
    ] as const) {
      b.add(cyl(0.6, 0.65, wallH + 1.2, 8), wall, tx, (wallH + 1.2) / 2, tz);
      b.add(cone(0.78, 1.3, 8), roof, tx, wallH + 1.85, tz);
      b.glowAdd(box(0.2, 0.35, 0.05), '#ffd98a', tx, wallH + 0.4, tz + 0.62);
    }
    for (const x of [dx - 1.2, dx + 1.2]) b.add(box(0.5, 1.3, 0.03), roof, x, wallH - 0.6, front + 0.04);
    top = wallH + 2.5;
  } else if (style === 'marble') {
    // Columns along the front and a low pediment.
    b.add(box(W, 0.2, 1.0), '#e6e0d4', cx, 0.1, D - 0.3);
    for (let x = 0.5; x <= W - 0.4; x += (W - 1) / 4) b.add(cyl(0.16, 0.18, wallH, 8), '#f4f0e6', x, wallH / 2, D - 0.15);
    b.add(box(W + 0.1, 0.25, D + 0.1), '#e6e0d4', cx, wallH + 0.12, cz);
    b.add(gable(W + 0.1, D + 0.1, 0.9), roof, cx, wallH + 0.25, cz);
    top = wallH + 1.4;
  } else {
    // Gable roof running east–west.
    const rh = style === 'cottage' ? 1.4 : 1.6;
    b.add(gable(W + 0.35, D + 0.1, rh), roof, cx, wallH - 0.05, cz - 0.05);
    b.add(box(W + 0.3, 0.08, 0.1), shade(roof, -0.2), cx, wallH + rh - 0.05, cz - 0.05);
    if (style === 'stone' || style === 'brick') b.add(box(0.5, 1.2, 0.5), style === 'stone' ? '#5a5a66' : '#8a3a2a', W - 1.3, wallH + rh * 0.7, cz - 0.6);
    if (style === 'cottage') for (let i = 0; i < 3; i++) b.add(box(W + 0.4, 0.06, 0.1), shade(roof, 0.1), cx, wallH + 0.3 + i * 0.35, cz + D * 0.42 - i * D * 0.13);
    top = wallH + rh;
  }
  // Signboard over the door.
  b.add(box(Math.min(2.4, W * 0.5), 0.4, 0.06), '#7a5230', dx, Math.min(wallH - 0.3, 2.0), front + 0.08);
  const out = b.bake();
  return { ...out, height: top };
}

// ---------------------------------------------------------------------------
// Resource nodes, farm plots and loot
// ---------------------------------------------------------------------------

export function nodeGeometry(kind: string, color: string, depleted: boolean, seed: number): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  const b = new Baker();
  const r = (i: number) => hash01(seed * 13 + i);
  switch (kind) {
    case 'tree':
      if (depleted) {
        b.add(cyl(0.2, 0.24, 0.25, 7), TRUNK, 0, 0.125, 0);
        b.add(cyl(0.18, 0.18, 0.02, 7), '#c9a36b', 0, 0.255, 0);
      } else oak(b, Math.floor(r(1) * 3), color, 1.05);
      break;
    case 'crystal':
      b.add(dodeca(0.22), '#6a6070', 0, 0.1, 0);
      if (!depleted) for (let i = 0; i < 4; i++) b.glowAdd(cone(0.09, 0.45 - i * 0.06, 5), shade(color, i * 0.05), Math.cos(i * 1.7) * 0.12, 0.3, Math.sin(i * 1.7) * 0.12, Math.cos(i) * 0.35, 0, Math.sin(i) * 0.35);
      break;
    case 'grass':
    case 'herb':
      if (depleted) b.add(box(0.3, 0.04, 0.3), '#6a5a3a', 0, 0.02, 0);
      else
        for (let i = 0; i < 7; i++) b.add(cone(0.05, 0.35 + r(i) * 0.2, 4), kind === 'grass' ? color : shade(color, (i % 2) * 0.08), Math.cos(i * 0.9) * 0.15, 0.18, Math.sin(i * 0.9) * 0.15, Math.cos(i) * 0.25, 0, Math.sin(i) * 0.25);
      if (!depleted && kind === 'herb') for (let i = 0; i < 3; i++) b.add(sphere(0.04, 4, 3), '#ffffff', Math.cos(i * 2) * 0.12, 0.38, Math.sin(i * 2) * 0.12);
      break;
    case 'bush':
      b.add(ico(0.28, 0), '#3f7a2c', 0, 0.24, 0, 0, 0, 0, 1.1, 0.85, 1);
      if (!depleted) for (let i = 0; i < 7; i++) b.add(sphere(0.05, 4, 3), color, Math.cos(i * 0.9) * 0.24, 0.2 + (i % 3) * 0.08, Math.sin(i * 0.9) * 0.24);
      break;
    case 'mushroom':
      for (let i = 0; i < (depleted ? 1 : 3); i++) {
        const x = (i - 1) * 0.15;
        b.add(cyl(0.03, 0.04, 0.16, 5), '#efe7cf', x, 0.08, (i % 2) * 0.1);
        const glow = color === '#5fd4e6';
        b.add(sphere(0.1, 7, 4), color, x, 0.18, (i % 2) * 0.1, 0, 0, 0, 1, 0.55, 1, glow);
      }
      break;
    default: {
      // Ore rock: grey boulder with coloured veins.
      b.add(dodeca(0.36), depleted ? '#6a6460' : STONE, 0, 0.2, 0, r(1), r(2) * 3, 0, 1.1, 0.75, 1);
      if (!depleted) for (let i = 0; i < 5; i++) b.add(ico(0.08, 0), color, Math.cos(i * 1.4) * 0.28, 0.2 + r(i) * 0.2, Math.sin(i * 1.4) * 0.26, 0, 0, 0, 1, 1, 1, ['#f2c14e', '#7fe0d8', '#ffe9a8', '#e2e6ee'].includes(color));
    }
  }
  return b.bake();
}

export function cropGeometry(stage: number, ready: boolean, leaf: string, fruit: string, shape: string): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  const b = new Baker();
  const h = 0.12 + stage * 0.1;
  const n = stage === 0 ? 2 : 5;
  for (let i = 0; i < n; i++) b.add(cone(0.05 + stage * 0.01, h, 4), leaf, Math.cos(i * 1.3) * 0.08, h / 2 + 0.05, Math.sin(i * 1.3) * 0.08, Math.cos(i) * 0.3, 0, Math.sin(i) * 0.3);
  if (ready) {
    if (shape === 'root') b.add(cone(0.1, 0.18, 6), fruit, 0, 0.08, 0, Math.PI);
    else if (shape === 'vine' || shape === 'bush') for (let i = 0; i < 4; i++) b.add(sphere(0.07, 5, 4), fruit, Math.cos(i * 1.6) * 0.14, 0.25 + (i % 2) * 0.08, Math.sin(i * 1.6) * 0.14);
    else if (shape === 'stalk') for (let i = 0; i < 3; i++) b.add(cyl(0.035, 0.035, 0.3, 5), fruit, Math.cos(i * 2) * 0.08, h + 0.12, Math.sin(i * 2) * 0.08);
    else b.add(sphere(0.14, 7, 5), fruit, 0, 0.15, 0);
  }
  return b.bake();
}
