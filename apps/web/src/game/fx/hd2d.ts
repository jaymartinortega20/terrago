import Phaser from 'phaser';

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

/** Soft sunbeams and drifting dust, fixed to the screen (outdoors, daytime). */
export class Atmosphere {
  private beams: Phaser.GameObjects.Image[] = [];
  private motes: { o: Phaser.GameObjects.Rectangle; vx: number; vy: number; ph: number }[] = [];

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

  build(): void {
    this.destroy();
    const cam = this.scene.cameras.main;
    for (let i = 0; i < 4; i++) {
      const b = this.scene.add
        .image(cam.width * (0.12 + i * 0.26), -40, this.beamKey())
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setRotation(-0.42)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(this.depth)
        .setDisplaySize(70 + i * 24, cam.height * 1.5)
        .setAlpha(0);
      this.beams.push(b);
    }
    for (let i = 0; i < 16; i++) {
      const o = this.scene.add
        .rectangle(Math.random() * cam.width, Math.random() * cam.height, 2, 2, 0xfff2c8, 0.6)
        .setScrollFactor(0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(this.depth);
      this.motes.push({ o, vx: 4 + Math.random() * 8, vy: -2 - Math.random() * 5, ph: Math.random() * 6 });
    }
  }

  /** day: 0 (night) … 1 (bright day); off hides everything. */
  update(time: number, dtMs: number, day: number, off: boolean): void {
    const cam = this.scene.cameras.main;
    const k = off ? 0 : day;
    this.beams.forEach((b, i) => {
      b.setAlpha(k * (0.07 + 0.04 * Math.sin(time / 2600 + i * 1.7)));
      b.x = cam.width * (0.12 + i * 0.26) + Math.sin(time / 9000 + i) * 30;
    });
    const s = dtMs / 1000;
    for (const m of this.motes) {
      m.o.x += m.vx * s;
      m.o.y += m.vy * s + Math.sin(time / 900 + m.ph) * 0.15;
      if (m.o.x > cam.width + 4) m.o.x = -4;
      if (m.o.y < -4) m.o.y = cam.height + 4;
      m.o.setAlpha((off ? 0 : 0.25 + 0.35 * day) * (0.6 + 0.4 * Math.sin(time / 700 + m.ph)));
    }
  }

  destroy(): void {
    this.beams.forEach((b) => b.destroy());
    this.motes.forEach((m) => m.o.destroy());
    this.beams = [];
    this.motes = [];
  }
}
