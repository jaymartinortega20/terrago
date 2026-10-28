/**
 * Loads the 3D model pack (public/3d, built by tools/assets3d) and hands
 * out ready-to-use copies: cached per file, skinned meshes cloned with their
 * skeletons, plus colour helpers (recolouring KayKit's swatch atlases and
 * tinting flat-coloured models).
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = '/3d/';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();

export function loadModel(path: string): Promise<GLTF> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(BASE + path).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        // Skinned meshes' bounds come from the bind pose; never cull them by it.
        if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const s = mat as THREE.MeshStandardMaterial;
          if (s.map) s.map.colorSpace = THREE.SRGBColorSpace;
          // Stylised look: matte, no metal sheen from the pack defaults.
          if ('roughness' in s) s.roughness = Math.max(0.55, s.roughness ?? 1);
          if ('metalness' in s) s.metalness = Math.min(0.2, s.metalness ?? 0);
          if (s.alphaTest > 0 || s.transparent) {
            s.alphaTest = Math.max(0.4, s.alphaTest);
            s.transparent = false;
            s.side = THREE.DoubleSide;
          }
        }
      });
      return g;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

/** A fresh copy of a model (skeletons included). */
export async function instance(path: string): Promise<{ root: THREE.Object3D; clips: THREE.AnimationClip[] }> {
  const g = await loadModel(path);
  return { root: cloneSkinned(g.scene), clips: g.animations };
}

/** Find the first clip whose name matches one of the patterns (in order). */
export function findClip(clips: THREE.AnimationClip[], ...pats: (RegExp | string)[]): THREE.AnimationClip | undefined {
  for (const p of pats) {
    const c = clips.find((x) => (typeof p === 'string' ? x.name === p : p.test(x.name)));
    if (c) return c;
  }
  return undefined;
}

/** Height of a model's bounds (after its own transforms). */
export function boundsOf(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const atlasCache = new Map<string, THREE.Texture>();

/**
 * KayKit textures are 8×4 grids of gradient swatches. Recolour chosen cells to
 * new colours while keeping each swatch's light-to-dark gradient.
 */
export function recolorAtlas(tex: THREE.Texture, changes: { cell: [number, number]; color: string }[], key: string): THREE.Texture {
  const k = `${tex.uuid}|${key}`;
  const hit = atlasCache.get(k);
  if (hit) return hit;
  const img = tex.image as (HTMLImageElement | ImageBitmap | HTMLCanvasElement) & { width: number; height: number };
  const W = img.width;
  const H = img.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img as CanvasImageSource, 0, 0);
  const cw = W / 8;
  const ch = H / 4;
  for (const { cell, color } of changes) {
    const x0 = Math.round(cell[0] * cw);
    const y0 = Math.round(cell[1] * ch);
    const w = Math.round(cw);
    const h = Math.round(ch);
    const d = g.getImageData(x0, y0, w, h);
    const a = d.data;
    let avg = 0;
    for (let i = 0; i < a.length; i += 4) avg += 0.299 * a[i]! + 0.587 * a[i + 1]! + 0.114 * a[i + 2]!;
    avg = avg / (a.length / 4) || 1;
    const t = new THREE.Color(color);
    for (let i = 0; i < a.length; i += 4) {
      const l = (0.299 * a[i]! + 0.587 * a[i + 1]! + 0.114 * a[i + 2]!) / avg;
      // Keep the gradient, a touch softer so dark colours don't go black.
      const k2 = 0.35 + 0.65 * l;
      a[i] = Math.min(255, t.r * 255 * k2);
      a[i + 1] = Math.min(255, t.g * 255 * k2);
      a[i + 2] = Math.min(255, t.b * 255 * k2);
    }
    g.putImageData(d, x0, y0);
  }
  const out = new THREE.CanvasTexture(c);
  out.flipY = tex.flipY;
  out.colorSpace = THREE.SRGBColorSpace;
  out.magFilter = THREE.LinearFilter;
  out.minFilter = THREE.LinearMipmapLinearFilter;
  atlasCache.set(k, out);
  return out;
}

/** Give every mesh under `root` its own copy of its materials (so tinting one model doesn't tint all). */
export function ownMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
  });
}

/**
 * Tint a model toward a colour. Textured materials are multiplied gently;
 * flat ones take the colour on their main (largest) material.
 */
export function tintModel(root: THREE.Object3D, color: string, amount = 0.65, only?: RegExp): void {
  const t = new THREE.Color(color);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mat as THREE.MeshStandardMaterial;
      if (!s.color) continue;
      if (only && !only.test(s.name)) continue;
      if (/eye|teeth|tongue|black|white|nose|belly|gold|metal/i.test(s.name) && !only) continue;
      if (s.map) {
        // Hue-shift a textured model by multiplying toward a brightened target.
        const bright = t.clone().multiplyScalar(1.5);
        s.color.lerp(bright, amount);
      } else {
        const hsl = { h: 0, s: 0, l: 0 };
        s.color.getHSL(hsl);
        const tt = { h: 0, s: 0, l: 0 };
        t.getHSL(tt);
        // Keep each part's lightness so details stay readable.
        const c2 = new THREE.Color().setHSL(tt.h, tt.s, THREE.MathUtils.lerp(hsl.l, tt.l, 0.6));
        s.color.lerp(c2, amount);
      }
    }
  });
}

/** Make a model glow (feeds the bloom pass). */
export function glowModel(root: THREE.Object3D, color: string | number, intensity: number): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mat as THREE.MeshStandardMaterial;
      if (!s.emissive) continue;
      s.emissive.set(color);
      s.emissiveIntensity = intensity;
      if (s.map && !s.emissiveMap) s.emissiveMap = s.map;
    }
  });
}

/** Preload a list of files (best effort). */
export function preload(paths: string[]): Promise<unknown> {
  return Promise.allSettled(paths.map(loadModel));
}
