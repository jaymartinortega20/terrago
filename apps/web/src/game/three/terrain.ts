/**
 * Turns a tile map into a lush floating island: a smooth heightfield whose
 * colours blend from tile to tile (two-tone grass, sandy shores, soft
 * paths), gentle hills where the map has cliffs, shiny animated water and
 * glowing lava, and a rocky underside hanging in the sky.
 */
import * as THREE from 'three';
import { GROUND_TILES, type GroundTileKey, type MapDef } from '@terrago/shared';
import { hash01 } from './kit';

interface TileLook {
  h: number;
  color: string;
  liquid?: 'water' | 'shallow' | 'ice' | 'lava' | 'swamp';
}

const GRASS_A = '#78c84e';
const GRASS_B = '#3f8a32';
const LOOK: Record<string, TileLook> = {
  '.': { h: 0, color: GRASS_A },
  ',': { h: 0, color: '#5aa83f' },
  '*': { h: 0, color: '#78c552' },
  '=': { h: -0.02, color: '#d9b77a' },
  ':': { h: 0.01, color: '#a8a294' },
  _: { h: 0.02, color: '#c9bfa8' },
  s: { h: -0.04, color: '#f0dca0' },
  h: { h: 0.1, color: '#e6c884' },
  d: { h: -0.03, color: '#8a5a34' },
  u: { h: -0.05, color: '#6a5034' },
  '~': { h: -0.7, color: '#c9b583', liquid: 'water' },
  w: { h: -0.35, color: '#d8c890', liquid: 'shallow' },
  '#': { h: 1.0, color: '#8a9a5a' },
  b: { h: -0.7, color: '#c9b583', liquid: 'water' },
  c: { h: 0, color: '#6a6070' },
  r: { h: 1.6, color: '#5a5262' },
  f: { h: 0, color: '#4c9636' },
  n: { h: 0.02, color: '#e4ecf6' },
  I: { h: -0.35, color: '#a8d8f0', liquid: 'ice' },
  L: { h: -0.45, color: '#3a1a10', liquid: 'lava' },
  a: { h: 0, color: '#5e5452' },
  q: { h: -0.4, color: '#4a5a32', liquid: 'swamp' },
  k: { h: 0.02, color: '#b4a68a' },
};

/** Themed recolours: rock walls, cliff tops and grass per map theme. */
const THEME: Partial<Record<NonNullable<MapDef['theme']>, { cliff?: string; wall?: string; grassA?: string; grassB?: string }>> = {
  meadow: { cliff: '#7fb04f' },
  forest: { cliff: '#5a9a3e', grassA: '#5eae42', grassB: '#3f8a30' },
  snow: { cliff: '#d0dce8', wall: '#9ab0c8' },
  peak: { cliff: '#c8d0da', wall: '#8a909a' },
  desert: { cliff: '#d8b47a', wall: '#b08a5a' },
  volcano: { cliff: '#4a3434', wall: '#3a2626' },
  swamp: { cliff: '#5a7a42', grassA: '#6a8a4a', grassB: '#4a6a3a' },
  ruins: { cliff: '#9a8e74', wall: '#7a6e5a' },
};

export interface Terrain {
  group: THREE.Group;
  heightAt(x: number, z: number): number;
  update(t: number, sunDir: THREE.Vector3): void;
  dispose(): void;
}

/** Smooth value noise for colour patches and gentle hills. */
export function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const h = (a: number, b: number) => hash01(a * 157.31 + b * 311.7);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(xi, zi), h(xi + 1, zi), s(fx)), THREE.MathUtils.lerp(h(xi, zi + 1), h(xi + 1, zi + 1), s(fx)), s(fz));
}

const S = 2; // vertices per tile edge

export function buildTerrain(map: MapDef): Terrain {
  const W = map.width;
  const H = map.height;
  const theme = THEME[map.theme ?? 'meadow'] ?? {};
  const key = (x: number, z: number): GroundTileKey | null => {
    if (x < 0 || z < 0 || x >= W || z >= H) return null;
    const k = map.tiles[z]?.[x] as GroundTileKey | undefined;
    return k && k in GROUND_TILES ? k : '.';
  };
  const look = (k: GroundTileKey | null): TileLook | null => (k ? (LOOK[k] ?? LOOK['.']!) : null);
  const tileColor = (k: GroundTileKey, x: number, z: number): THREE.Color => {
    const L = look(k)!;
    if (k === '#' && theme.cliff) return new THREE.Color(theme.cliff);
    if (k === 'r' && theme.wall) return new THREE.Color(theme.wall);
    if (k === '.' || k === ',' || k === '*' || k === 'f') {
      // Two-tone grass in soft patches, like a painted meadow.
      const n = vnoise(x * 0.18, z * 0.18) * 0.7 + vnoise(x * 0.6, z * 0.6) * 0.3;
      const a = new THREE.Color(k === 'f' ? (theme.grassB ?? '#4c9636') : (theme.grassA ?? GRASS_A));
      const b = new THREE.Color(theme.grassB ?? GRASS_B);
      return a.lerp(b, THREE.MathUtils.smoothstep(n, 0.3, 0.7) * (k === ',' ? 1 : 0.85));
    }
    // Soft light/dark patches on every ground type so nothing reads as flat.
    const n = vnoise(x * 0.22 + 7, z * 0.22 + 3);
    return new THREE.Color(L.color).offsetHSL(0, k === 'n' ? -0.02 : 0.02, (n - 0.5) * (k === 'n' ? 0.07 : 0.12));
  };

  // Vertex grid at S subdivisions per tile; each vertex blends the tiles that touch it.
  const VW = W * S + 1;
  const VH = H * S + 1;
  const heights = new Float32Array(VW * VH);
  const colors = new Float32Array(VW * VH * 3);
  const c = new THREE.Color();
  const sand = new THREE.Color('#ecd9a0');
  for (let j = 0; j < VH; j++)
    for (let i = 0; i < VW; i++) {
      const x = i / S;
      const z = j / S;
      let hs = 0;
      let ws = 0;
      let liquid = 0;
      let land = 0;
      c.setRGB(0, 0, 0);
      // A vertex on a tile edge/corner touches 1, 2 or 4 tiles.
      const xs = i % S ? [Math.floor(x)] : [x - 1, x];
      const zs = j % S ? [Math.floor(z)] : [z - 1, z];
      for (const tz of zs)
        for (const tx of xs) {
          const k = key(tx, tz);
          const L = look(k);
          if (!L || !k) continue;
          hs += L.h;
          ws++;
          if (L.liquid) liquid++;
          else land++;
          c.add(tileColor(k, tx, tz));
        }
      const idx = j * VW + i;
      const edge = ws < xs.length * zs.length;
      let h = ws ? hs / ws : 0;
      h += (vnoise(x * 0.35, z * 0.35) - 0.5) * (h > 0.5 ? 0.4 : 0.07);
      if (edge) h = Math.min(h, -0.08);
      heights[idx] = h;
      if (ws) c.multiplyScalar(1 / ws);
      // Sandy rims where land meets water.
      if (liquid && land && map.theme !== 'volcano' && map.theme !== 'snow') c.lerp(sand, 0.55);
      c.offsetHSL(0, 0, (hash01(i * 7.3 + j * 3.1) - 0.5) * 0.03);
      colors.set([c.r, c.g, c.b], idx * 3);
    }

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(VW * VH * 3);
  const uv = new Float32Array(VW * VH * 2);
  for (let j = 0; j < VH; j++)
    for (let i = 0; i < VW; i++) {
      pos.set([i / S, heights[j * VW + i]!, j / S], (j * VW + i) * 3);
      uv.set([i / S / 2, j / S / 2], (j * VW + i) * 2);
    }
  const idx: number[] = [];
  for (let j = 0; j < VH - 1; j++)
    for (let i = 0; i < VW - 1; i++) {
      const a = j * VW + i;
      const b = a + 1;
      const cc = a + VW;
      const d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: grainTexture() }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  const group = new THREE.Group();
  group.add(ground);
  group.add(underside(W, H, map.theme === 'snow' || map.theme === 'peak' ? '#8a9aa8' : map.theme === 'volcano' ? '#4a3030' : '#8a6a4a', map.theme === 'snow' || map.theme === 'peak' ? '#e8f0f8' : map.theme === 'volcano' ? '#5a4040' : map.theme === 'desert' ? '#e0c080' : '#6aa64a'));

  // Liquids: one surface per kind with an animated shader.
  const liquids = new Map<string, number[]>();
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const L = look(key(x, z));
      if (!L?.liquid) continue;
      const kind = L.liquid === 'shallow' ? 'water' : L.liquid;
      const list = liquids.get(kind) ?? [];
      list.push(x, z);
      liquids.set(kind, list);
    }
  const shaders: THREE.ShaderMaterial[] = [];
  const landNear = (x: number, z: number) => {
    let land = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) if (!look(key(x + dx, z + dz))?.liquid) land++;
    return Math.min(1, land / 2);
  };
  for (const [kind, tiles] of liquids) {
    const p: number[] = [];
    const sh: number[] = [];
    for (let t = 0; t < tiles.length; t += 2) {
      const x = tiles[t]!;
      const z = tiles[t + 1]!;
      const v = [
        [x, z],
        [x + 1, z],
        [x + 1, z + 1],
        [x, z + 1],
      ] as const;
      for (const k of [0, 3, 2, 0, 2, 1]) {
        p.push(v[k]![0], 0, v[k]![1]);
        sh.push(landNear(v[k]![0], v[k]![1]));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('shore', new THREE.Float32BufferAttribute(sh, 1));
    const m = liquidMaterial(kind);
    shaders.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = kind === 'lava' ? -0.18 : kind === 'ice' ? -0.08 : -0.16;
    mesh.renderOrder = 2;
    mesh.name = `liquid:${kind}`;
    group.add(mesh);
  }

  // Paving: cobbles on plazas and streets, flagstones in ruins.
  const paved: { x: number; z: number; kind: 'cobble' | 'plaza' | 'ruin' }[] = [];
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const k = key(x, z);
      if (k === ':' || k === '_') paved.push({ x, z, kind: k === ':' ? 'cobble' : k === '_' ? 'plaza' : 'ruin' });
    }
  for (const kind of ['cobble', 'plaza', 'ruin'] as const) {
    const list = paved.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const pos2: number[] = [];
    const uv2: number[] = [];
    for (const { x, z } of list) {
      const corners = [
        [x, z],
        [x + 1, z],
        [x + 1, z + 1],
        [x, z + 1],
      ] as const;
      const hh = corners.map(([cx, cz]) => {
        const i = Math.round(cx * S);
        const j = Math.round(cz * S);
        return heights[Math.min(VH - 1, j) * VW + Math.min(VW - 1, i)]! + 0.015;
      });
      for (const k of [0, 3, 2, 0, 2, 1]) {
        pos2.push(corners[k]![0], hh[k]!, corners[k]![1]);
        uv2.push(corners[k]![0] / 2, corners[k]![1] / 2);
      }
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
    g2.setAttribute('uv', new THREE.Float32BufferAttribute(uv2, 2));
    g2.computeVertexNormals();
    const pave = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ map: pavingTexture(kind), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    pave.receiveShadow = true;
    group.add(pave);
  }

  function heightAt(x: number, z: number): number {
    const k = key(Math.floor(x), Math.floor(z));
    if (k === 'b') return 0.06;
    const L = look(k);
    if (L?.liquid) return L.liquid === 'lava' ? -0.18 : -0.16;
    const gx = Math.max(0, Math.min(VW - 1.001, x * S));
    const gz = Math.max(0, Math.min(VH - 1.001, z * S));
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const h = (a: number, b: number) => heights[b * VW + a]!;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(i, j), h(i + 1, j), fx), THREE.MathUtils.lerp(h(i, j + 1), h(i + 1, j + 1), fx), fz);
  }

  return {
    group,
    heightAt,
    update(t, sunDir) {
      for (const m of shaders) {
        m.uniforms.uTime!.value = t;
        (m.uniforms.uSun!.value as THREE.Vector3).copy(sunDir);
      }
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        mat?.dispose?.();
      });
    },
  };
}

const paveCache = new Map<string, THREE.Texture>();
/** Hand-drawn style stones: rounded cobbles, big plaza slabs, cracked ruin flags. */
function pavingTexture(kind: 'cobble' | 'plaza' | 'ruin'): THREE.Texture {
  const hit = paveCache.get(kind);
  if (hit) return hit;
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const base = kind === 'plaza' ? [214, 204, 182] : kind === 'ruin' ? [196, 188, 170] : [168, 162, 150];
  g.fillStyle = `rgb(${base.map((v) => v - 40).join(',')})`;
  g.fillRect(0, 0, N, N);
  const stone = (x: number, y: number, w: number, h: number, i: number) => {
    const l = (hash01(i * 3.7) - 0.5) * 34;
    const [r, gg, b] = base.map((v) => Math.max(0, Math.min(255, v + l)));
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.beginPath();
    g.roundRect(x, y, w, h, kind === 'cobble' ? Math.min(w, h) * 0.45 : 6);
    g.fill();
    // Light top-left edge, shadow bottom-right: a little bevel.
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + 4, y + h - 4);
    g.lineTo(x + 4, y + 4);
    g.lineTo(x + w - 4, y + 4);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.moveTo(x + w - 3, y + 5);
    g.lineTo(x + w - 3, y + h - 3);
    g.lineTo(x + 5, y + h - 3);
    g.stroke();
  };
  let i = 0;
  if (kind === 'cobble') {
    for (let y = 0; y < N; y += 32)
      for (let x = -((y / 32) % 2) * 20; x < N; x += 40) stone(x + 3, y + 3, 34 + (hash01(i) - 0.5) * 6, 26 + (hash01(i + 9) - 0.5) * 4, i++);
  } else {
    const sz = kind === 'plaza' ? 64 : 85;
    for (let y = 0; y < N; y += sz) for (let x = 0; x < N; x += sz) stone(x + 3, y + 3, sz - 6, sz - 6, i++);
    if (kind === 'ruin') {
      g.strokeStyle = 'rgba(60,50,40,0.45)';
      g.lineWidth = 2;
      for (let k = 0; k < 9; k++) {
        g.beginPath();
        g.moveTo(hash01(k) * N, hash01(k + 3) * N);
        g.lineTo(hash01(k + 5) * N, hash01(k + 7) * N);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  paveCache.set(kind, t);
  return t;
}

let grain: THREE.Texture | null = null;
/** Subtle painted grain so the ground isn't a flat colour. */
function grainTexture(): THREE.Texture {
  if (grain) return grain;
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 2600; i++) {
    const x = hash01(i * 1.7) * N;
    const y = hash01(i * 3.1 + 9) * N;
    const r = 1 + hash01(i * 5.3) * 3;
    const l = 222 + Math.floor(hash01(i * 7.7) * 33);
    g.fillStyle = `rgba(${l},${l},${l},0.55)`;
    g.beginPath();
    g.ellipse(x, y, r * 1.6, r, hash01(i) * 3, 0, Math.PI * 2);
    g.fill();
  }
  grain = new THREE.CanvasTexture(cv);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.colorSpace = THREE.SRGBColorSpace;
  return grain;
}

/** Stylised water / lava / ice: colour by distance to shore, sparkles, foam at the edge. */
function liquidMaterial(kind: string): THREE.ShaderMaterial {
  const P: Record<string, { deep: string; shallow: string; foam: string; glow: number; opacity: number }> = {
    water: { deep: '#2577c8', shallow: '#57d6e4', foam: '#ffffff', glow: 0, opacity: 0.88 },
    swamp: { deep: '#3a5a2a', shallow: '#6a8a4a', foam: '#c8d8a0', glow: 0, opacity: 0.92 },
    ice: { deep: '#9ad0f0', shallow: '#e8f8ff', foam: '#ffffff', glow: 0, opacity: 0.96 },
    lava: { deep: '#c8300a', shallow: '#ff9a1a', foam: '#fff0a0', glow: 1, opacity: 1 },
  };
  const p = P[kind] ?? P.water!;
  return new THREE.ShaderMaterial({
    transparent: p.opacity < 1,
    depthWrite: p.opacity >= 1,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(p.deep) },
      uShallow: { value: new THREE.Color(p.shallow) },
      uFoam: { value: new THREE.Color(p.foam) },
      uGlow: { value: p.glow },
      uOpacity: { value: p.opacity },
      uSun: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
      uIce: { value: kind === 'ice' ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      attribute float shore;
      varying float vShore;
      varying vec3 vWorld;
      uniform float uTime;
      uniform float uIce;
      void main() {
        vShore = shore;
        vec3 p = position;
        if (uIce < 0.5) p.y += sin(uTime * 1.6 + position.x * 1.7 + position.z * 1.3) * 0.025;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying float vShore;
      varying vec3 vWorld;
      uniform float uTime, uGlow, uOpacity, uIce;
      uniform vec3 uDeep, uShallow, uFoam, uSun;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float t = uIce > 0.5 ? 0.0 : uTime;
        vec2 uv = vWorld.xz;
        float n = noise(uv * 1.3 + vec2(t * 0.25, t * 0.18)) * 0.6 + noise(uv * 3.1 - vec2(t * 0.35, -t * 0.2)) * 0.4;
        vec3 col = mix(uDeep, uShallow, clamp(vShore * 0.9 + n * 0.35, 0.0, 1.0));
        float e = 0.08;
        float nx = noise((uv + vec2(e, 0.0)) * 3.0 + t * 0.4) - noise((uv - vec2(e, 0.0)) * 3.0 + t * 0.4);
        float nz = noise((uv + vec2(0.0, e)) * 3.0 + t * 0.4) - noise((uv - vec2(0.0, e)) * 3.0 + t * 0.4);
        vec3 N = normalize(vec3(-nx * 1.4, 1.0, -nz * 1.4));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 Hh = normalize(normalize(uSun) + V);
        float spec = pow(max(dot(N, Hh), 0.0), 90.0) * 1.4;
        float fres = pow(1.0 - max(dot(V, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
        col += vec3(0.25, 0.35, 0.45) * fres * (1.0 - uGlow);
        float foam = smoothstep(0.55, 1.0, vShore) * (0.55 + 0.45 * sin(t * 2.0 + n * 6.0 + vWorld.x + vWorld.z));
        foam += smoothstep(0.82, 0.95, n) * 0.35;
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.85);
        col += spec * (uGlow > 0.5 ? vec3(1.0, 0.8, 0.4) : vec3(1.0));
        col *= 1.0 + uGlow * (0.8 + 0.6 * n);
        gl_FragColor = vec4(col, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** The island hangs in the sky: a grassy rim, then rock tapering to a point. */
function underside(W: number, H: number, rock: string, rim: string): THREE.Object3D {
  const cx = W / 2;
  const cz = H / 2;
  const pts: THREE.Vector2[] = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const r = Math.min(Math.abs(W / 2 / (dx || 1e-6)), Math.abs(H / 2 / (dz || 1e-6)));
    pts.push(new THREE.Vector2(dx * r, dz * r));
  }
  const dark = (k: number) => new THREE.Color(rock).offsetHSL(0, 0, -k).getStyle();
  const layers = [
    { y: -0.06, k: 1.0, col: rim },
    { y: -0.55, k: 1.0, col: '#8a6a4a' },
    { y: -2.2, k: 0.88, col: rock },
    { y: -5, k: 0.64, col: dark(0.06) },
    { y: -8.5, k: 0.34, col: dark(0.12) },
    { y: -12.5, k: 0.06, col: dark(0.18) },
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const C = new THREE.Color();
  for (let l = 0; l < layers.length - 1; l++) {
    const A = layers[l]!;
    const B = layers[l + 1]!;
    for (let i = 0; i < N; i++) {
      const p0 = pts[i]!;
      const p1 = pts[(i + 1) % N]!;
      const jA = l < 2 ? 1 : 1 + (vnoise(i * 0.3, l * 3) - 0.5) * 0.2;
      const jB = l + 1 < 2 ? 1 : 1 + (vnoise(i * 0.3, (l + 1) * 3) - 0.5) * 0.2;
      const jA1 = l < 2 ? 1 : 1 + (vnoise((i + 1) * 0.3, l * 3) - 0.5) * 0.2;
      const jB1 = l + 1 < 2 ? 1 : 1 + (vnoise((i + 1) * 0.3, (l + 1) * 3) - 0.5) * 0.2;
      const v = [
        [p0.x * A.k * jA, A.y, p0.y * A.k * jA],
        [p1.x * A.k * jA1, A.y, p1.y * A.k * jA1],
        [p1.x * B.k * jB1, B.y, p1.y * B.k * jB1],
        [p0.x * B.k * jB, B.y, p0.y * B.k * jB],
      ];
      for (const k of [0, 3, 1, 1, 3, 2]) {
        pos.push(v[k]![0]! + cx, v[k]![1]!, v[k]![2]! + cz);
        C.set(k < 2 ? A.col : B.col);
        col.push(C.r, C.g, C.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
}

export function isUnderground(map: MapDef): boolean {
  return map.theme === 'cave' || !!map.dungeon || map.id.startsWith('dg_') || map.id === 'rift';
}
