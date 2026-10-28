/**
 * HD sprite baker: renders the CC0 3D models (KayKit heroes, Quaternius
 * monsters, nature and props) into high-resolution 2D sprite sheets with a
 * soft anime cel-shade and an ink outline. The game itself stays 2D: Phaser
 * draws these sheets like any other sprite.
 *
 * Units: a tile is 1 model unit and 32 world px. Sheets are drawn at
 * BAKE_RES texture px per world px, so sprites are shown at 1 / BAKE_RES.
 */
import * as THREE from 'three';
import type { Actor } from './actors';

/** Texture px per world px (a little lower on phones to save memory). */
export const BAKE_RES = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 1.5 : 2;
/** World px per tile. */
export const TILE_PX = 32;
/** Camera tilt above the horizon (matches the map's 3/4 view). */
const PITCH = THREE.MathUtils.degToRad(32);
/** Supersampling factor (render bigger, scale down: smooth edges). */
const SS = 2;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let gradient: THREE.DataTexture | null = null;

function setup(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene } {
  if (renderer && scene) return { renderer, scene };
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  // Soft sky fill plus a warm key light from the upper left-front and a cool rim from behind.
  scene.add(new THREE.HemisphereLight(0xeef4ff, 0x8a7a8a, 1.7));
  const key = new THREE.DirectionalLight(0xfff4e0, 2.0);
  key.position.set(-1.4, 2.6, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe6ff, 1.6);
  rim.position.set(1.6, 1.4, -2.4);
  scene.add(rim);
  return { renderer, scene };
}

/** Three-step light ramp: the anime cel-shade. */
function toonRamp(): THREE.DataTexture {
  if (gradient) return gradient;
  const d = new Uint8Array([150, 150, 150, 255, 190, 190, 190, 255, 228, 228, 228, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const toonCache = new WeakMap<THREE.Material, THREE.Material>();

/** Swap lit materials for cel-shaded ones (keeping colour, texture and glow). */
export function toonify(root: THREE.Object3D): void {
  const ramp = toonRamp();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const conv = (mat: THREE.Material): THREE.Material => {
      const s = mat as THREE.MeshStandardMaterial;
      if (!(s as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) return mat;
      const hit = toonCache.get(mat);
      if (hit) return hit;
      const t = new THREE.MeshToonMaterial({
        color: s.color.clone(),
        map: s.map,
        gradientMap: ramp,
        emissive: s.emissive.clone(),
        emissiveMap: s.emissiveMap,
        emissiveIntensity: s.emissiveIntensity,
        transparent: s.transparent,
        opacity: s.opacity,
        alphaTest: s.alphaTest,
        side: s.side,
        vertexColors: s.vertexColors,
      });
      t.name = s.name;
      toonCache.set(mat, t);
      return t;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
}

export interface FrameSpec {
  /** Sets the pose for this frame. */
  pose: () => void;
}

export interface SheetLayout {
  /** World px per frame. */
  frameW: number;
  frameH: number;
  /** World px from the frame's bottom edge to the feet. */
  foot: number;
  /** Model yaw per row (radians; 0 faces the camera). */
  rows: number[];
  /** Frames per row (the same poses for every row). */
  frames: FrameSpec[];
  /** Outline colour and width (texture px). */
  outline?: { color: string; width: number } | null;
  /** Lift the model (flying creatures), in tiles. */
  lift?: number;
  /** Shift the view sideways (world px) when the model isn't centred. */
  offsetX?: number;
}

export interface Sheet {
  canvas: HTMLCanvasElement;
  /** Texture px per frame. */
  fw: number;
  fh: number;
  cols: number;
  rows: number;
  /** Frames per line in the image (frames wrap to stay under GPU size limits). */
  perLine: number;
}

/** Largest texture side we use (safe on phones). */
const MAX_TEX = 4096;

/** Where frame `i` (row * cols + col) sits in the sheet image. */
export function frameXY(sh: { fw: number; fh: number; perLine: number }, i: number): { x: number; y: number } {
  return { x: (i % sh.perLine) * sh.fw, y: Math.floor(i / sh.perLine) * sh.fh };
}

const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

/** One bake at a time (they share the renderer); higher priority first (your own hero). */
const jobs: { pri: number; seq: number; run: () => Promise<void> }[] = [];
let running = false;
let seq = 0;

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (jobs.length) {
      jobs.sort((a, b) => b.pri - a.pri || a.seq - b.seq);
      await jobs.shift()!.run();
    }
  } finally {
    running = false;
  }
}

/** Render `obj` (feet at the origin) through every pose and direction into one sheet. */
export function bakeSheet(obj: THREE.Object3D, layout: SheetLayout, priority = 0): Promise<Sheet> {
  return new Promise<Sheet>((resolve, reject) => {
    jobs.push({ pri: priority, seq: seq++, run: () => doBake(obj, layout).then(resolve, reject) });
    void pump();
  });
}

async function doBake(obj: THREE.Object3D, L: SheetLayout): Promise<Sheet> {
  const { renderer: r, scene: sc } = setup();
  const fw = Math.round(L.frameW * BAKE_RES);
  const fh = Math.round(L.frameH * BAKE_RES);
  r.setSize(fw * SS, fh * SS, false);
  const wT = L.frameW / TILE_PX;
  const hT = L.frameH / TILE_PX;
  const footT = L.foot / TILE_PX;
  const ox = (L.offsetX ?? 0) / TILE_PX;
  const cam = new THREE.OrthographicCamera(-wT / 2 + ox, wT / 2 + ox, hT - footT, -footT, 0.1, 100);
  cam.position.set(0, Math.sin(PITCH) * 20, Math.cos(PITCH) * 20);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  // Glow halos are drawn by the 2D scene (additive), not baked in.
  obj.traverse((o) => {
    if ((o as THREE.Sprite).isSprite || o.name === 'ring') o.visible = false;
  });
  const holder = new THREE.Group();
  holder.add(obj);
  obj.position.y = L.lift ?? 0;
  sc.add(holder);
  const cols = L.frames.length;
  const total = cols * L.rows.length;
  const perLine = Math.max(1, Math.min(total, Math.floor(MAX_TEX / fw)));
  const sheet = document.createElement('canvas');
  sheet.width = fw * perLine;
  sheet.height = fh * Math.ceil(total / perLine);
  const g = sheet.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  let n = 0;
  try {
    for (let row = 0; row < L.rows.length; row++) {
      holder.rotation.y = L.rows[row]!;
      for (let col = 0; col < cols; col++) {
        L.frames[col]!.pose();
        obj.updateMatrixWorld(true);
        r.render(sc, cam);
        const at = frameXY({ fw, fh, perLine }, row * cols + col);
        g.drawImage(r.domElement, at.x, at.y, fw, fh);
        if (++n % 6 === 0) await yieldFrame();
      }
    }
  } finally {
    sc.remove(holder);
    holder.remove(obj);
  }
  if (L.outline !== null) outline(sheet, L.outline?.color ?? 'rgba(24,18,44,0.8)', L.outline?.width ?? 1.3);
  return { canvas: sheet, fw, fh, cols, rows: L.rows.length, perLine };
}

/** Ink outline around every opaque shape (drawn behind it). */
function outline(c: HTMLCanvasElement, color: string, w: number): void {
  const sil = document.createElement('canvas');
  sil.width = c.width;
  sil.height = c.height;
  const sg = sil.getContext('2d')!;
  sg.drawImage(c, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = color;
  sg.fillRect(0, 0, sil.width, sil.height);
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = c.height;
  const og = out.getContext('2d')!;
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    og.drawImage(sil, Math.cos(a) * w, Math.sin(a) * w);
  }
  og.drawImage(c, 0, 0);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(out, 0, 0);
}

/** Bake a still model sized to fit: returns the image and where its origin (ground point) lands. */
export async function bakeFit(obj: THREE.Object3D, opts: { yaw?: number; pad?: number; outline?: { color: string; width: number } | null; priority?: number } = {}): Promise<{ canvas: HTMLCanvasElement; w: number; h: number; ox: number; oy: number }> {
  const yaw = opts.yaw ?? 0;
  const pad = opts.pad ?? 4;
  const probe = new THREE.Group();
  probe.rotation.y = yaw;
  probe.add(obj);
  probe.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(probe, true);
  probe.remove(obj);
  const cp = Math.cos(PITCH);
  const sp = Math.sin(PITCH);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [b.min.x, b.max.x])
    for (const y of [b.min.y, b.max.y])
      for (const z of [b.min.z, b.max.z]) {
        const vy = y * cp - z * sp;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, vy);
        maxY = Math.max(maxY, vy);
      }
  const w = Math.ceil((maxX - minX) * TILE_PX + pad * 2);
  const h = Math.ceil((maxY - minY) * TILE_PX + pad * 2);
  const foot = -minY * TILE_PX + pad;
  const offsetX = ((minX + maxX) / 2) * TILE_PX;
  const sh = await bakeSheet(obj, { frameW: w, frameH: h, foot, rows: [yaw], frames: [{ pose: () => {} }], outline: opts.outline, offsetX }, opts.priority ?? 0);
  return { canvas: sh.canvas, w, h, ox: 0.5 - offsetX / w, oy: 1 - foot / h };
}

/** Bake a still model (tree, rock, building) as one image, feet at the bottom centre. */
export async function bakeStill(obj: THREE.Object3D, opts: { w: number; h: number; foot: number; yaw?: number; outline?: { color: string; width: number } | null }): Promise<HTMLCanvasElement> {
  const sh = await bakeSheet(obj, { frameW: opts.w, frameH: opts.h, foot: opts.foot, rows: [opts.yaw ?? 0], frames: [{ pose: () => {} }], outline: opts.outline });
  return sh.canvas;
}

/** Sample `n` evenly spaced moments of a clip (loops skip the repeated end). */
export function sampleTimes(clip: THREE.AnimationClip | undefined, n: number, loop: boolean, from = 0, to = 1): number[] {
  const d = clip?.duration ?? 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? from : loop ? from + ((to - from) * i) / n : from + ((to - from) * i) / (n - 1);
    out.push(k * d);
  }
  return out;
}

/** Pose frames for an actor clip. */
export function clipFrames(actor: Actor, clip: THREE.AnimationClip | undefined, n: number, loop: boolean, from = 0, to = 1): FrameSpec[] {
  return sampleTimes(clip, n, loop, from, to).map((t) => ({ pose: () => actor.poseAt(clip, t) }));
}
