/**
 * HD scenery: trees, bushes, rocks, props, resource nodes and buildings,
 * baked once per kind from the CC0 model packs (Quaternius Stylized Nature,
 * KayKit Medieval Hexagon / Dungeon) or from hand-built low-poly shapes
 * when no model fits. Each bake is a still image with a known ground point.
 */
import * as THREE from 'three';
import { PROP_TYPES, type BuildingDef, type PropType } from '@terrago/shared';
import { boundsOf, instance, ownMaterials, tintModel, glowModel } from './assets';
import { bakeFit, toonify } from './baker';
import { VCOLOR, VCOLOR_GLOW, hash01 } from './kit';
import { buildingGeometry, nodeGeometry, propGeometry } from './props3d';

export interface StillArt {
  canvas: HTMLCanvasElement;
  /** World px. */
  w: number;
  h: number;
  /** Origin (ground point) as a fraction of the image. */
  ox: number;
  oy: number;
}

/** Which models stand in for each prop. `h` = height in tiles. */
const PROP: Partial<Record<PropType, { files: string[]; h: number; tint?: string }>> = {
  tree_oak: { files: [1, 2, 3, 4, 5].map((i) => `nature/CommonTree_${i}.glb`), h: 3.5 },
  tree_pine: { files: [1, 2, 3, 4, 5].map((i) => `nature/Pine_${i}.glb`), h: 3.9 },
  tree_fruit: { files: ['nature/CherryBlossom_1.glb', 'nature/CherryBlossom_2.glb'], h: 2.7 },
  tree_dead: { files: [1, 2, 3].map((i) => `nature/DeadTree_${i}.glb`), h: 3.1 },
  tree_snow: { files: [1, 2, 3, 4, 5].map((i) => `nature/Pine_${i}.glb`), h: 3.7, tint: '#cfe6ee' },
  tree_swamp: { files: [1, 2, 3].map((i) => `nature/TwistedTree_${i}.glb`), h: 3.4 },
  tree_ancient: { files: ['nature/GiantPine_1.glb', 'nature/GiantPine_2.glb'], h: 5.4 },
  bush: { files: ['nature/Bush_Common_Flowers.glb', 'nature/Bush_Large.glb', 'nature/Bush_Large_Flowers.glb', 'nature/Bush_Common.glb'], h: 1.0 },
  rock: { files: ['nature/Rock_Medium_1.glb', 'nature/Rock_Medium_2.glb', 'nature/Rock_Medium_3.glb', 'nature/Rock_Medium_4.glb'], h: 0.85 },
  stump: { files: ['props/tree_single_A_cut.glb'], h: 0.5 },
  fence_h: { files: ['build/fence_wood_straight.glb'], h: 0.65 },
  fence_v: { files: ['build/fence_wood_straight.glb'], h: 0.65 },
  barrel: { files: ['props/barrel.glb'], h: 0.7 },
  crate: { files: ['props/crate_A_small.glb', 'props/crate_A_big.glb'], h: 0.65 },
  well: { files: ['build/well_blue.glb'], h: 2.1 },
  hay_bale: { files: ['props/sack.glb'], h: 0.5 },
  mushroom_big: { files: ['nature/Mushroom_RedCap.glb', 'nature/Mushroom_Laetiporus.glb'], h: 0.7 },
  reeds: { files: ['nature/Grass_Wheat.glb'], h: 0.8 },
  stalagmite: { files: ['props/rock_single_A.glb', 'props/rock_single_C.glb', 'props/rock_single_D.glb'], h: 1.3 },
  ruin_pillar: { files: ['props/column.glb', 'props/pillar.glb'], h: 1.9 },
  torch: { files: ['props/torch_lit.glb'], h: 1.35 },
  tent: { files: ['props/tent.glb'], h: 1.9 },
  mine_entrance: { files: ['build/mine_blue.glb'], h: 2.1 },
  mill: { files: ['build/windmill_blue.glb'], h: 3.2 },
  ladder_up: { files: ['props/ladder.glb'], h: 1.6 },
};

/** How many looks each modelled prop has. */
export function propVariants(t: PropType): number {
  return PROP[t]?.files.length ?? 1;
}

async function modelOf(file: string, h: number, tint?: string, maxW = Infinity): Promise<THREE.Object3D> {
  const { root } = await instance(file);
  ownMaterials(root);
  if (tint) tintModel(root, tint, 0.55);
  const b = boundsOf(root);
  const sz = b.getSize(new THREE.Vector3());
  // Height as asked, but never wider than the footprint allows.
  const k = Math.min(h / Math.max(0.01, sz.y), maxW / Math.max(0.01, sz.x, sz.z));
  root.scale.multiplyScalar(k);
  const b2 = boundsOf(root);
  const c = b2.getCenter(new THREE.Vector3());
  root.position.set(-c.x, -b2.min.y, -c.z);
  const holder = new THREE.Group();
  holder.add(root);
  return holder;
}

function meshOf(geo: { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null }): THREE.Object3D {
  const g = new THREE.Group();
  if (geo.solid) g.add(new THREE.Mesh(geo.solid, VCOLOR));
  if (geo.glow) g.add(new THREE.Mesh(geo.glow, VCOLOR_GLOW));
  return g;
}

const OUTLINE = { color: '#1c2418', width: 1.4 };

/** A prop as an HD still (variant picks the model and turn). */
export async function bakeProp(type: PropType, variant: number): Promise<StillArt> {
  const spec = PROP[type];
  let obj: THREE.Object3D;
  let yaw = 0;
  if (spec) {
    const fw = PROP_TYPES[type]?.w ?? 1;
    const tree = type.startsWith('tree');
    obj = await modelOf(spec.files[variant % spec.files.length]!, spec.h * (tree ? 0.92 + hash01(variant * 3.1) * 0.16 : 1), spec.tint, tree ? Infinity : fw * 1.3);
    if (type === 'fence_v') yaw = Math.PI / 2;
    else if (!type.startsWith('fence') && !['well', 'tent', 'mine_entrance', 'mill', 'ladder_up', 'torch'].includes(type)) yaw = hash01(variant * 7.7) * Math.PI * 2;
  } else {
    // Hand-built shape (already centred on its footprint), a touch larger.
    obj = meshOf(propGeometry(type, variant % 3));
    obj.scale.setScalar(1.25);
  }
  toonify(obj);
  return bakeFit(obj, { yaw, outline: OUTLINE });
}

/** A resource node (tree, ore rock, crystal, herb...). */
export async function bakeNode(kind: string, color: string, spent: boolean, seed: number): Promise<StillArt> {
  let obj: THREE.Object3D;
  if (kind === 'tree' && !spent) obj = await modelOf(`nature/CommonTree_${1 + (seed % 5)}.glb`, 2.5);
  else if (kind === 'bush' && !spent) {
    obj = await modelOf('nature/Bush_Large_Flowers.glb', 0.85);
    tintModel(obj, color, 0.35, /flower|petal|berry|Flowers/i);
  } else if ((kind === 'rock' || !['crystal', 'grass', 'herb', 'mushroom', 'tree', 'bush'].includes(kind)) && !spent) {
    obj = await modelOf(`nature/Rock_Medium_${1 + (seed % 3)}.glb`, 0.8);
    // Ore veins: nuggets on the boulder.
    const glow = ['#f2c14e', '#7fe0d8', '#ffe9a8', '#e2e6ee'].includes(color);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + seed;
      const n = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075 + (i % 3) * 0.02, 0), new THREE.MeshStandardMaterial({ color, emissive: glow ? color : '#000000', emissiveIntensity: glow ? 0.4 : 0, roughness: 0.4, metalness: 0.5, flatShading: true }));
      n.position.set(Math.cos(a) * 0.3, 0.22 + (i % 2) * 0.22, Math.sin(a) * 0.27);
      obj.add(n);
    }
  } else obj = meshOf(nodeGeometry(kind, color, spent, seed));
  if (kind === 'crystal' && !spent) glowModel(obj, color, 0.25);
  toonify(obj);
  return bakeFit(obj, { yaw: hash01(seed * 2.3) * Math.PI * 2, outline: OUTLINE });
}

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

/**
 * A building fitted to its footprint. The origin is the middle of the
 * footprint's front (south) edge.
 */
export async function bakeBuilding(def: BuildingDef, useModel = true): Promise<StillArt> {
  let obj: THREE.Object3D;
  if (useModel) {
    const name = BUILDING_BY_ID[def.id] ?? BY_STYLE[def.style ?? 'brick'] ?? 'home_B_red';
    const { root } = await instance(`build/${name}.glb`);
    ownMaterials(root);
    const b = boundsOf(root);
    const size = b.getSize(new THREE.Vector3());
    const k = Math.min(def.w / size.x, def.h / size.z) * 1.12;
    root.scale.setScalar(k);
    const b2 = boundsOf(root);
    const c = b2.getCenter(new THREE.Vector3());
    // Front edge of the footprint at z = 0.
    root.position.set(-c.x, -b2.min.y, -c.z - def.h / 2);
    obj = new THREE.Group();
    obj.add(root);
  } else {
    const geo = buildingGeometry(def);
    const inner = meshOf(geo);
    inner.position.set(-def.w / 2, 0, -def.h);
    obj = new THREE.Group();
    obj.add(inner);
  }
  toonify(obj);
  return bakeFit(obj, { outline: { color: '#1a1622', width: 1.6 } });
}
