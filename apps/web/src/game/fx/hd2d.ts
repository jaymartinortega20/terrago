import Phaser from 'phaser';
import { FX_TEX, ensureFxTextures } from './juice';

/**
 * "HD-2D": pixel art with depth. Buildings, trees and props cast long soft
 * shadows from the sun, sunbeams and dust drift over the scene, and the camera
 * adds bloom, a tilt-shift focus blur at the top and bottom of the screen and
 * a gentle colour grade. Everything is decoration on top of the 2D world.
 */

/**
 * ultra   — HD-2D plus GPU post-processing (bloom, tilt-shift focus): strong PCs only.
 * hd      — HD-2D without extra GPU passes: baked sun shadows, colour grade,
 *           sunbeams, depth haze. Runs on integrated graphics.
 * lite    — baked shadows only.
 * classic — plain pixels.
 */
export type GraphicsMode = 'ultra' | 'hd' | 'lite' | 'classic';

export const GRAPHICS_ORDER: GraphicsMode[] = ['ultra', 'hd', 'lite', 'classic'];

/** How far shadows lean (per pixel of height) and how flat they are. */
const SKEW = 0.55;
const SQUASH = 0.42;

/**
 * A skewed, blurred silhouette of an art canvas: the shadow it casts on the
 * ground. The ground line (bottom row) stays put; higher pixels lean right
 * and flatten, as if the sun were low behind the viewer's left shoulder.
 */
export function shadowCanvas(src: CanvasImageSource & { width: number; height: number }, blur = 2): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  const extra = Math.ceil(H * SKEW) + blur * 4;
  const c = document.createElement('canvas');
  c.width = W + extra;
  c.height = H + blur * 4;
  const g = c.getContext('2d')!;
  g.save();
  if ('filter' in g) g.filter = `blur(${blur}px)`;
  // x' = x + SKEW·(H − y);  y' = H − SQUASH·(H − y)
  g.setTransform(1, 0, -SKEW, SQUASH, SKEW * H + blur * 2, H * (1 - SQUASH));
  g.drawImage(src, 0, 0);
  g.restore();
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#0a0c18';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Camera post-processing for the chosen mode (WebGL only). */
export function applyCameraLook(cam: Phaser.Cameras.Scene2D.Camera, mode: GraphicsMode, renderer: { type: number }): void {
  if (renderer.type !== Phaser.WEBGL || !cam.postFX) return;
  cam.postFX.clear();
  // Only Ultra pays for full-screen shader passes; the other modes bake their look into textures.
  if (mode !== 'ultra') return;
  cam.postFX.addBloom(0xffffff, 1, 1, 0.7, 0.38, 2);
  cam.postFX.addTiltShift(0.85, 1, 0.3, 0.55, 0.55, 0.38);
}

/** Ground with the map's shadows painted in and a gentle colour grade — one texture, zero runtime cost. */
export function bakeGround(ground: HTMLCanvasElement, shadows: { src: HTMLCanvasElement; left: number; by: number; blur: number }[], grade: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ground.width;
  c.height = ground.height;
  const g = c.getContext('2d')!;
  if (grade && 'filter' in g) g.filter = 'saturate(1.12) contrast(1.05)';
  g.drawImage(ground, 0, 0);
  g.filter = 'none';
  g.globalAlpha = 0.3;
  const cache = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  for (const d of shadows) {
    let sh = cache.get(d.src);
    if (!sh) cache.set(d.src, (sh = shadowCanvas(d.src, d.blur)));
    g.drawImage(sh, Math.round(d.left - d.blur * 2), Math.round(d.by + d.blur * 4 - sh.height));
  }
  return c;
}

/**
 * Living air over the map: sunbeams and drifting dust by day, fireflies at
 * night, falling leaves in green places, slow fog banks and floating motes.
 * Everything is placed in world space around the camera's view, so it looks
 * the same at any zoom or screen density.
 */
export class Atmosphere {
  private beams: Phaser.GameObjects.Image[] = [];
  private motes: { o: Phaser.GameObjects.Image; x: number; y: number; vx: number; vy: number; ph: number }[] = [];
  private flies: { o: Phaser.GameObjects.Image; x: number; y: number; ph: number; sp: number }[] = [];
  private leaves: { o: Phaser.GameObjects.Image; x: number; y: number; vy: number; ph: number; spin: number }[] = [];
  private fog: { o: Phaser.GameObjects.Image; x: number; y: number; vx: number }[] = [];
  private butterflies: { o: Phaser.GameObjects.Image; x: number; y: number; ph: number }[] = [];
  private birds: { o: Phaser.GameObjects.Image; t0: number; y: number }[] = [];
  private nextBird = 0;
  private theme = 'meadow';

  constructor(
    private scene: Phaser.Scene,
    private depth: number,
  ) {}

  private beamKey(): string {
    const key = 'hd2d:beam';
    if (this.scene.textures.exists(key)) return key;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 512;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(255,240,200,0)');
    gr.addColorStop(0.5, 'rgba(255,240,200,1)');
    gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 512);
    const fade = g.createLinearGradient(0, 0, 0, 512);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.35, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = fade;
    g.fillRect(0, 0, 64, 512);
    this.scene.textures.addCanvas(key, c);
    return key;
  }

  build(theme = 'meadow'): void {
    this.destroy();
    this.theme = theme;
    ensureFxTextures(this.scene);
    const add = this.scene.add;
    for (let i = 0; i < 4; i++) {
      this.beams.push(add.image(0, 0, this.beamKey()).setOrigin(0.5, 0).setRotation(-0.42).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth).setAlpha(0));
    }
    const warm = theme === 'volcano';
    const cold = theme === 'snow' || theme === 'peak';
    for (let i = 0; i < 34; i++) {
      const o = add.image(0, 0, FX_TEX.dot).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth).setTint(warm ? 0xff9a4a : cold ? 0xe8f4ff : 0xfff2c8).setScale(0.05 + Math.random() * 0.06);
      this.motes.push({ o, x: Math.random(), y: Math.random(), vx: 0.004 + Math.random() * 0.01, vy: warm ? -0.02 - Math.random() * 0.02 : -0.003 - Math.random() * 0.006, ph: Math.random() * 6 });
    }
    if (!cold && !warm) {
      for (let i = 0; i < 22; i++) {
        const o = add.image(0, 0, FX_TEX.dot).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth).setTint(i % 3 ? 0xd8ff7a : 0xfff27a).setScale(0.12);
        this.flies.push({ o, x: Math.random(), y: Math.random(), ph: Math.random() * 6, sp: 0.4 + Math.random() * 0.6 });
      }
    }
    if (theme === 'meadow' || theme === 'forest' || theme === 'lake' || theme === 'swamp') {
      const tints = theme === 'swamp' ? [0x8a9a4a, 0x6a7a3a] : [0x8ad46a, 0xf2c14e, 0xe8803a, 0x6ab450];
      for (let i = 0; i < 12; i++) {
        const o = add.image(0, 0, FX_TEX.leaf).setDepth(this.depth).setTint(tints[i % tints.length]!).setScale(0.45 + Math.random() * 0.3);
        this.leaves.push({ o, x: Math.random(), y: Math.random(), vy: 0.012 + Math.random() * 0.012, ph: Math.random() * 6, spin: (Math.random() - 0.5) * 3 });
      }
    }
    if (theme === 'meadow' || theme === 'forest' || theme === 'lake') {
      const tints = [0xff8ad0, 0xffe066, 0x8ad8ff, 0xffffff, 0xffa64a];
      for (let i = 0; i < 6; i++) {
        const o = add.image(0, 0, FX_TEX.leaf).setDepth(this.depth).setTint(tints[i % tints.length]!).setScale(0.5);
        this.butterflies.push({ o, x: Math.random(), y: Math.random(), ph: Math.random() * 6 });
      }
    }
    if (theme !== 'cave') {
      for (let i = 0; i < 3; i++) this.birds.push({ o: add.image(0, 0, FX_TEX.leaf).setDepth(this.depth - 2).setTint(0x0a0c18).setAlpha(0).setScale(1.6, 0.9), t0: -1e9, y: 0 });
    }
    const fogN = theme === 'swamp' || theme === 'cave' ? 6 : theme === 'lake' || cold ? 4 : 3;
    for (let i = 0; i < fogN; i++) {
      const o = add.image(0, 0, FX_TEX.smoke).setDepth(this.depth - 1).setTint(theme === 'volcano' ? 0x5a3a3a : theme === 'swamp' ? 0xc8e0c0 : 0xf0f4ff).setAlpha(0);
      this.fog.push({ o, x: Math.random(), y: Math.random(), vx: 0.004 + Math.random() * 0.004 });
    }
  }

  /** day: 0 (night) … 1 (bright day); off hides everything. */
  update(time: number, dtMs: number, day: number, off: boolean): void {
    const v = this.scene.cameras.main.worldView;
    const s = Math.min(0.1, dtMs / 1000);
    const k = off ? 0 : day;
    const night = off ? 0 : 1 - day;
    this.beams.forEach((b, i) => {
      b.setPosition(v.x + v.width * (0.12 + i * 0.26) + Math.sin(time / 9000 + i) * 30, v.y - 40)
        .setDisplaySize(v.width * (0.05 + i * 0.018), v.height * 1.5)
        .setAlpha(k * (0.08 + 0.05 * Math.sin(time / 2600 + i * 1.7)));
    });
    const wrap = (n: number) => n - Math.floor(n);
    for (const m of this.motes) {
      m.x = wrap(m.x + m.vx * s);
      m.y = wrap(m.y + m.vy * s);
      m.o.setPosition(v.x + m.x * v.width, v.y + m.y * v.height + Math.sin(time / 900 + m.ph) * 6);
      m.o.setAlpha((off ? 0 : 0.25 + 0.4 * day) * (0.5 + 0.5 * Math.sin(time / 700 + m.ph)));
    }
    for (const f of this.flies) {
      const t = time / 1000;
      const x = f.x + Math.sin(t * 0.3 * f.sp + f.ph) * 0.05;
      const y = f.y + Math.cos(t * 0.23 * f.sp + f.ph * 2) * 0.04;
      f.o.setPosition(v.x + wrap(x) * v.width, v.y + wrap(y) * v.height);
      f.o.setAlpha(night * Math.max(0, Math.sin(t * 2 * f.sp + f.ph)) * 0.95);
    }
    for (const l of this.leaves) {
      l.y = wrap(l.y + l.vy * s);
      l.x = wrap(l.x + Math.sin(time / 1300 + l.ph) * 0.0006);
      l.o.setPosition(v.x + l.x * v.width + Math.sin(time / 600 + l.ph) * 14, v.y + l.y * v.height).setRotation(Math.sin(time / 500 + l.ph) * 1.2 + l.spin);
      l.o.setAlpha(off ? 0 : 0.85 * (0.4 + 0.6 * day));
    }
    for (const b of this.butterflies) {
      const t = time / 1000;
      const x = b.x + Math.sin(t * 0.21 + b.ph) * 0.12 + Math.sin(t * 1.3 + b.ph) * 0.01;
      const y = b.y + Math.cos(t * 0.17 + b.ph * 2) * 0.1 + Math.sin(t * 2.1 + b.ph) * 0.008;
      b.o.setPosition(v.x + wrap(x) * v.width, v.y + wrap(y) * v.height).setScale(0.5 * Math.abs(Math.sin(t * 16 + b.ph)) + 0.08, 0.45);
      b.o.setAlpha(k * 0.95);
    }
    // Now and then a flock's shadow sweeps over the ground.
    if (!off && day > 0.5 && time > this.nextBird && this.birds.length) {
      this.nextBird = time + 14000 + Math.random() * 12000;
      const y = 0.15 + Math.random() * 0.7;
      this.birds.forEach((b, i) => {
        b.t0 = time + i * 260;
        b.y = y + (i - 1) * 0.04;
      });
    }
    for (const b of this.birds) {
      const p = (time - b.t0) / 5200;
      if (p < 0 || p > 1) {
        b.o.setAlpha(0);
        continue;
      }
      b.o.setPosition(v.x + (-0.1 + p * 1.2) * v.width, v.y + (b.y - p * 0.15) * v.height).setRotation(-0.15).setScale(1.6, 0.6 + 0.4 * Math.abs(Math.sin(time / 120)));
      b.o.setAlpha(0.16 * Math.sin(p * Math.PI));
    }
    const fogBase = this.theme === 'swamp' || this.theme === 'cave' ? 0.22 : 0.1;
    for (const f of this.fog) {
      f.x = wrap(f.x + f.vx * s);
      f.o.setPosition(v.x + (f.x * 1.4 - 0.2) * v.width, v.y + f.y * v.height).setDisplaySize(v.width * 0.7, v.height * 0.45);
      f.o.setAlpha(off ? 0 : fogBase * (0.6 + 0.6 * night) * (0.6 + 0.4 * Math.sin(time / 5000 + f.y * 9)));
    }
  }

  destroy(): void {
    for (const o of [...this.beams, ...this.motes.map((m) => m.o), ...this.flies.map((f) => f.o), ...this.leaves.map((l) => l.o), ...this.fog.map((f) => f.o), ...this.butterflies.map((b) => b.o), ...this.birds.map((b) => b.o)]) o.destroy();
    this.butterflies = [];
    this.birds = [];
    this.beams = [];
    this.motes = [];
    this.flies = [];
    this.leaves = [];
    this.fog = [];
  }
}
