/**
 * Map scenery from the model pack: trees, bushes, rocks, flowers and grass
 * (Quaternius Stylized Nature), buildings and props (KayKit Medieval
 * Hexagon / Dungeon). Everything that repeats is instanced, so a forest of a
 * thousand pines is a handful of draw calls.
 */
import * as THREE from 'three';
import type { BuildingDef, PropType } from '@terrago/shared';
import { boundsOf, loadModel } from './assets';
import { hash01 } from './kit';

export interface Placement {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
}

/** Instanced copies of a model (one InstancedMesh per mesh in it). */
export async function instancedModel(path: string, list: Placement[], opts: { height?: number; shadow?: boolean; tint?: string } = {}): Promise<THREE.Group> {
  const g = await loadModel(path);
  const out = new THREE.Group();
  if (!list.length) return out;
  const src = g.scene;
  src.updateMatrixWorld(true);
  // Normalise to a target height (tiles) if asked.
  let norm = 1;
  let lift = 0;
  if (opts.height) {
    const b = boundsOf(src);
    norm = opts.height / Math.max(0.01, b.max.y - b.min.y);
    lift = -b.min.y * norm;
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  // Split into 12×12-tile chunks so off-screen parts are culled.
  const chunks = new Map<string, Placement[]>();
  for (const p of list) {
    const k = `${Math.floor(p.x / 12)},${Math.floor(p.z / 12)}`;
    const c = chunks.get(k) ?? [];
    c.push(p);
    chunks.set(k, c);
  }
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let material = mesh.material as THREE.Material;
    if (opts.tint) {
      const mm = (material as THREE.MeshStandardMaterial).clone();
      mm.color.set(opts.tint);
      material = mm;
    }
    for (const part of chunks.values()) {
      const im = new THREE.InstancedMesh(mesh.geometry, material, part.length);
      part.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        const s = p.scale * norm;
        m4.compose(new THREE.Vector3(p.x, p.y + lift * p.scale, p.z), q, new THREE.Vector3(s, s, s)).multiply(mesh.matrixWorld);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = opts.shadow !== false;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      out.add(im);
    }
  });
  return out;
}

/** Which model(s) stand in for each prop. `h` = height in tiles. */
const PROP: Partial<Record<PropType, { files: string[]; h: number; rot?: boolean; jitter?: number }>> = {
  tree_oak: { files: [1, 2, 3, 4, 5].map((i) => `nature/CommonTree_${i}.glb`), h: 2.6, rot: true, jitter: 0.25 },
  tree_pine: { files: [1, 2, 3, 4, 5].map((i) => `nature/Pine_${i}.glb`), h: 2.9, rot: true, jitter: 0.25 },
  tree_fruit: { files: ['nature/CherryBlossom_1.glb', 'nature/CherryBlossom_2.glb'], h: 2.4, rot: true, jitter: 0.15 },
  tree_dead: { files: [1, 2, 3].map((i) => `nature/DeadTree_${i}.glb`), h: 2.4, rot: true, jitter: 0.2 },
  tree_snow: { files: [1, 2, 3, 4, 5].map((i) => `nature/Pine_${i}.glb`), h: 2.7, rot: true, jitter: 0.2 },
  tree_swamp: { files: [1, 2, 3].map((i) => `nature/TwistedTree_${i}.glb`), h: 2.5, rot: true, jitter: 0.2 },
  tree_ancient: { files: ['nature/GiantPine_1.glb', 'nature/GiantPine_2.glb'], h: 4.2, rot: true, jitter: 0.15 },
  bush: { files: ['nature/Bush_Common_Flowers.glb', 'nature/Bush_Large.glb', 'nature/Bush_Large_Flowers.glb'], h: 0.8, rot: true, jitter: 0.2 },
  rock: { files: ['nature/Rock_Medium_1.glb', 'nature/Rock_Medium_2.glb', 'nature/Rock_Medium_3.glb'], h: 0.7, rot: true, jitter: 0.3 },
  stump: { files: ['props/tree_single_A_cut.glb'], h: 0.45, rot: true },
  fence_h: { files: ['build/fence_wood_straight.glb'], h: 0.6 },
  fence_v: { files: ['build/fence_wood_straight.glb'], h: 0.6 },
  barrel: { files: ['props/barrel.glb'], h: 0.65, rot: true },
  crate: { files: ['props/crate_A_small.glb', 'props/crate_A_big.glb'], h: 0.6, rot: true },
  well: { files: ['build/well_blue.glb'], h: 1.8 },
  hay_bale: { files: ['props/sack.glb'], h: 0.45, rot: true },
  mushroom_big: { files: ['nature/Mushroom_RedCap.glb', 'nature/Mushroom_Laetiporus.glb'], h: 0.6, rot: true },
  reeds: { files: ['nature/Grass_Wheat.glb'], h: 0.8, rot: true },
  stalagmite: { files: ['props/rock_single_A.glb', 'props/rock_single_C.glb', 'props/rock_single_D.glb'], h: 1.0, rot: true, jitter: 0.3 },
  ruin_pillar: { files: ['props/column.glb', 'props/pillar.glb'], h: 1.5, rot: true },
  torch: { files: ['props/torch_lit.glb'], h: 1.1 },
  tent: { files: ['props/tent.glb'], h: 1.5 },
  mine_entrance: { files: ['build/mine_blue.glb'], h: 2.0 },
  mill: { files: ['build/windmill_blue.glb'], h: 3.0 },
  ladder_up: { files: ['props/ladder.glb'], h: 1.6 },
};

/** Props that get a model (others stay hand-built). */
export function propHasModel(t: PropType): boolean {
  return !!PROP[t];
}

/** Low settings: light KayKit trees instead of the dense painted ones. */
const LOW_TREES: Partial<Record<PropType, { files: string[]; h: number; rot?: boolean; jitter?: number }>> = {
  tree_oak: { files: ['props/tree_single_B.glb', 'props/trees_A_small.glb'], h: 2.0, rot: true, jitter: 0.2 },
  tree_pine: { files: ['props/tree_single_A.glb'], h: 2.4, rot: true, jitter: 0.2 },
  tree_snow: { files: ['props/tree_single_A.glb'], h: 2.2, rot: true, jitter: 0.2 },
  tree_fruit: { files: ['props/tree_single_B.glb'], h: 2.0, rot: true },
  tree_swamp: { files: ['props/trees_B_small.glb'], h: 2.0, rot: true },
  tree_ancient: { files: ['props/trees_A_small.glb'], h: 3.2, rot: true },
};

/** Build every modelled prop of a map, grouped into instanced meshes. */
export async function buildProps(objects: { type: PropType; x: number; z: number; y: number; w: number; h: number }[], low = false): Promise<THREE.Group> {
  const group = new THREE.Group();
  const byFile = new Map<string, { h: number; list: Placement[] }>();
  for (const o of objects) {
    const spec = (low && LOW_TREES[o.type]) || PROP[o.type];
    if (!spec) continue;
    const r = hash01(o.x * 7.1 + o.z * 13.3);
    const file = spec.files[Math.floor(r * spec.files.length)]!;
    const jit = spec.jitter ?? 0;
    const entry = byFile.get(`${file}|${spec.h}`) ?? { h: spec.h, list: [] };
    entry.list.push({
      x: o.x + (jit ? (hash01(o.x * 3.3 + o.z) - 0.5) * jit : 0),
      y: o.y,
      z: o.z + (jit ? (hash01(o.z * 5.1 + o.x) - 0.5) * jit : 0),
      rot: spec.rot ? r * Math.PI * 2 : o.type === 'fence_h' ? Math.PI / 2 : 0,
      scale: 1 + (hash01(o.x + o.z * 9.7) - 0.5) * (o.type.startsWith('tree') ? 0.35 : 0.15),
    });
    byFile.set(`${file}|${spec.h}`, entry);
  }
  await Promise.all(
    [...byFile].map(async ([k, v]) => {
      const file = k.split('|')[0]!;
      group.add(await instancedModel(file, v.list, { height: v.h }));
    }),
  );
  return group;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

const BUILDING_BY_ID: Record<string, string> = {
  tavern: 'tavern_red',
  guild_hall: 'castle_blue',
  bank: 'church_blue',
  general_store: 'market_red',
  blacksmith: 'blacksmith_red',
  farm_supply: 'home_B_blue',
  cottage: 'home_A_red',
  dragon_citadel: 'castle_red',
};
const BY_STYLE: Record<string, string> = { brick: 'home_B_red', timber: 'tavern_blue', stone: 'blacksmith_blue', marble: 'church_red', cottage: 'home_A_blue', castle: 'castle_blue' };

/** A KayKit building scaled to the footprint, door to the south. */
export async function buildingModel(def: BuildingDef, groundY: number): Promise<{ obj: THREE.Object3D; height: number }> {
  const name = BUILDING_BY_ID[def.id] ?? BY_STYLE[def.style ?? 'brick'] ?? 'home_B_red';
  const g = await loadModel(`build/${name}.glb`);
  const obj = g.scene.clone(true);
  const b = boundsOf(obj);
  const size = b.getSize(new THREE.Vector3());
  // Fit the footprint (keep proportions), a little bigger so it feels grand.
  const k = Math.min(def.w / size.x, def.h / size.z) * 1.08;
  obj.scale.setScalar(k);
  const ctr = b.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  obj.position.set(-ctr.x * k, -b.min.y * k, -ctr.z * k);
  holder.add(obj);
  holder.position.set(def.x + def.w / 2, groundY, def.y + def.h / 2);
  holder.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { obj: holder, height: size.y * k };
}

// ---------------------------------------------------------------------------
// Ground cover: grass tufts, flowers, ferns, pebbles
// ---------------------------------------------------------------------------

export async function groundCover(map: { width: number; height: number; tiles: string[]; theme?: string }, heightAt: (x: number, z: number) => number, budget: number): Promise<THREE.Group> {
  const group = new THREE.Group();
  const grass: Placement[] = [];
  const tall: Placement[] = [];
  const flowers: Placement[][] = [[], [], [], []];
  const ferns: Placement[] = [];
  const pebbles: Placement[] = [];
  const dry: Placement[] = [];
  const crags: Placement[][] = [[], [], []];
  const snow = map.theme === 'snow' || map.theme === 'peak';
  for (let z = 0; z < map.height; z++)
    for (let x = 0; x < map.width; x++) {
      const k = map.tiles[z]?.[x];
      const r = hash01(x * 9.1 + z * 3.3);
      const at = (i: number) => {
        const px = x + 0.15 + hash01(x * 3 + z * 7 + i) * 0.7;
        const pz = z + 0.15 + hash01(z * 5 + x * 11 + i * 3) * 0.7;
        return { x: px, z: pz, y: heightAt(px, pz), rot: hash01(i + x * z) * 6.28, scale: 0.8 + hash01(px * pz) * 0.5 };
      };
      if ((k === '.' || k === ',') && !snow && r < (k === ',' ? 0.9 : 0.45)) {
        grass.push(at(1));
        if (k === ',') tall.push(at(2));
      } else if (k === '*' && r < 0.95) {
        flowers[Math.floor(hash01(x + z * 31) * 4)]!.push(at(1));
        if (r < 0.5) grass.push(at(2));
      } else if (k === 'f' && r < 0.55) ferns.push(at(1));
      else if ((k === '=' || k === 'a' || k === 's' || k === 'n' || k === 'k') && r < (k === 'k' ? 0.3 : 0.12)) pebbles.push({ ...at(1), scale: 0.7 });
      if ((k === 'k' || k === 'n' || k === 'a') && hash01(x * 5.7 + z * 1.3) < 0.18) dry.push(at(4));
      // Rocky ridges where the map has cliffs.
      if ((k === '#' || k === 'r') && r < 0.55) crags[Math.floor(hash01(x * 2.3 + z) * 3)]!.push({ ...at(5), scale: 1.2 + hash01(x + z * 3) * 1.4 });
    }
  const cap = (l: Placement[]) => (l.length > budget ? l.filter((_, i) => i % Math.ceil(l.length / budget) === 0) : l);
  const jobs: Promise<THREE.Group>[] = [
    instancedModel('nature/Grass_Common_Short.glb', cap(grass), { height: 0.32, shadow: false, tint: '#d8ff9a' }),
    instancedModel('nature/Grass_Common_Tall.glb', cap(tall), { height: 0.5, shadow: false, tint: '#d8ff9a' }),
    instancedModel('nature/Fern_1.glb', cap(ferns), { height: 0.45, shadow: false }),
    instancedModel('nature/Pebble_Round_1.glb', cap(pebbles), { height: 0.08, shadow: false }),
    instancedModel('nature/Grass_Wispy_Tall.glb', cap(dry), { height: 0.4, shadow: false, tint: snow ? '#c8d0b0' : '#d8c890' }),
    ...['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Big_1'].map((f, i) =>
      instancedModel(`nature/${f}.glb`, crags[i]!, { height: 0.9, tint: snow ? '#e8eef8' : map.theme === 'volcano' ? '#6a5050' : map.theme === 'ruins' || map.theme === 'desert' ? '#d8c4a0' : undefined }),
    ),
    ...['Flower_1_Group', 'Flower_2_Group', 'Flower_3_Group', 'Flower_4_Group'].map((f, i) => instancedModel(`nature/${f}.glb`, cap(flowers[i]!), { height: 0.45, shadow: false })),
  ];
  for (const g of await Promise.all(jobs)) group.add(g);
  return group;
}
