/**
 * Shared bits for the 3D view: cached materials and geometries, a soft glow
 * sprite, and helpers to bake coloured parts into one mesh (for instancing).
 * Everything is built from simple shapes, so there are no model files to load.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const mats = new Map<string, THREE.Material>();

/** Flat-shaded standard material, shared by colour + options. */
export function mat(color: string | number, o: { emissive?: string | number; ei?: number; metal?: number; rough?: number; opacity?: number; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  const key = `s|${color}|${o.emissive ?? ''}|${o.ei ?? ''}|${o.metal ?? ''}|${o.rough ?? ''}|${o.opacity ?? ''}|${o.side ?? ''}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: o.rough ?? 0.8,
      metalness: o.metal ?? 0.02,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.ei ?? 1,
      transparent: o.opacity != null && o.opacity < 1,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
    });
    mats.set(key, m);
  }
  return m;
}

/** Unlit colour (lamps, flames, runes, eyes). */
export function glowMat(color: string | number, opacity = 1): THREE.MeshBasicMaterial {
  const key = `b|${color}|${opacity}`;
  let m = mats.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    mats.set(key, m);
  }
  return m;
}

const geos = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g;
}
export const box = (w: number, h: number, d: number) => cached(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
export const sphere = (r: number, ws = 8, hs = 6) => cached(`sph${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export const ico = (r: number, d = 0) => cached(`ico${r},${d}`, () => new THREE.IcosahedronGeometry(r, d));
export const dodeca = (r: number) => cached(`dod${r}`, () => new THREE.DodecahedronGeometry(r, 0));
export const cyl = (rt: number, rb: number, h: number, s = 6) => cached(`cyl${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
export const cone = (r: number, h: number, s = 6) => cached(`cone${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
export const torus = (r: number, t: number, rs = 5, ts = 12, arc = Math.PI * 2) => cached(`tor${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));

/** A mesh positioned and rotated in one call. */
export function part(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = shadow;
  return mesh;
}

export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + k)));
  return `#${c.getHexString()}`;
}

let glowTex: THREE.Texture | null = null;
/** A soft round glow (for additive sprites). */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function glowSprite(color: string | number, size: number, opacity = 0.8): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1);
  return s;
}

// ---------------------------------------------------------------------------
// Baking: coloured pieces merged into one geometry (vertex colours), so a
// whole tree or building is one draw call and can be instanced.
// ---------------------------------------------------------------------------

export class Baker {
  solid: THREE.BufferGeometry[] = [];
  glow: THREE.BufferGeometry[] = [];

  /** Add a piece: geometry, colour, position, rotation, scale. */
  add(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, glow = false): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    const col = new THREE.Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    (glow ? this.glow : this.solid).push(g);
    g = null as never;
    return this;
  }

  glowAdd(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    return this.add(geo, color, x, y, z, rx, ry, rz, sx, sy, sz, true);
  }

  /** Merge into (at most) two geometries: lit and unlit. */
  bake(): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
    const m = (list: THREE.BufferGeometry[]) => (list.length ? mergeGeometries(list, false) : null);
    const out = { solid: m(this.solid), glow: m(this.glow) };
    for (const g of [...this.solid, ...this.glow]) g.dispose();
    this.solid = [];
    this.glow = [];
    return out;
  }
}

export const VCOLOR = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.02 });
export const VCOLOR_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Small deterministic random from a number. */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Metal colour for an equipment tier (matches the 2D icons). */
export const TIER_METAL = ['#a7a6a1', '#d9822b', '#b9bcc4', '#e2e6ee', '#f2c14e', '#7fe0d8', '#5a4670', '#ffe9a8'];
export const tierMetal = (t: number) => TIER_METAL[Math.max(0, Math.min(TIER_METAL.length - 1, t | 0))]!;
/** Glow colours for +4 / +7 / +10 gear. */
export const GLOW_TIER = [0, 0x5fb0ff, 0xc07aff, 0xffe9a8] as const;
