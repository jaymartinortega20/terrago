/**
 * "Juice": soft HD particle textures and one-shot particle bursts used by
 * every effect — glowing sparks, flares, shockwave rings, smoke, embers,
 * dust and magic motes. All additive and short-lived.
 */
import Phaser from 'phaser';

export const FX_TEX = {
  dot: 'fx:dot',
  spark: 'fx:spark',
  flare: 'fx:flare',
  ring: 'fx:ring',
  smoke: 'fx:smoke',
  shard: 'fx:shard',
  leaf: 'fx:leaf',
  slash: 'fx:slash',
} as const;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Create the shared particle textures once per scene. */
export function ensureFxTextures(scene: Phaser.Scene): void {
  const tm = scene.textures;
  if (tm.exists(FX_TEX.dot)) return;
  {
    const [c, g] = canvas(64, 64);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    tm.addCanvas(FX_TEX.dot, c);
  }
  {
    // A bright streak (sparks fly along their length).
    const [c, g] = canvas(64, 16);
    const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(32, 8, 32, 4, 0, 0, Math.PI * 2);
    g.fill();
    const glow = g.createRadialGradient(56, 8, 0, 56, 8, 8);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(40, 0, 24, 16);
    tm.addCanvas(FX_TEX.spark, c);
  }
  {
    // Four-point lens flare.
    const [c, g] = canvas(128, 128);
    const glow = g.createRadialGradient(64, 64, 0, 64, 64, 46);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 128, 128);
    for (const [w, h] of [
      [64, 5],
      [5, 64],
    ] as const) {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, Math.max(w, h));
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(64, 64, w, h, 0, 0, Math.PI * 2);
      g.fill();
    }
    tm.addCanvas(FX_TEX.flare, c);
  }
  {
    // Soft shockwave ring.
    const [c, g] = canvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 34, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    tm.addCanvas(FX_TEX.ring, c);
  }
  {
    // Smoke / dust puff (lumpy).
    const [c, g] = canvas(64, 64);
    for (let i = 0; i < 7; i++) {
      const x = 20 + Math.random() * 24;
      const y = 20 + Math.random() * 24;
      const r = 12 + Math.random() * 10;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    }
    tm.addCanvas(FX_TEX.smoke, c);
  }
  {
    const [c, g] = canvas(16, 32);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(8, 0);
    g.lineTo(15, 16);
    g.lineTo(8, 32);
    g.lineTo(1, 16);
    g.closePath();
    g.fill();
    tm.addCanvas(FX_TEX.shard, c);
  }
  {
    const [c, g] = canvas(24, 16);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(12, 8, 11, 6, 0.3, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.moveTo(2, 10);
    g.lineTo(22, 6);
    g.stroke();
    tm.addCanvas(FX_TEX.leaf, c);
  }
  {
    // Crescent slash (white; tinted per weapon).
    const [c, g] = canvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 30, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(64, 64);
    g.arc(64, 64, 62, -Math.PI * 0.95, -Math.PI * 0.05);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.ellipse(64, 74, 54, 48, 0, 0, Math.PI * 2);
    g.fill();
    tm.addCanvas(FX_TEX.slash, c);
  }
}

export interface BurstOpts {
  tex?: string;
  n: number;
  color: number | number[];
  speed: [number, number];
  life: [number, number];
  scale: [number, number];
  endScale?: number;
  gravity?: number;
  angle?: [number, number];
  /** Rotate particles to their direction (sparks). */
  rotate?: boolean;
  alpha?: number;
  depth: number;
  add?: boolean;
  /** Spread the spawn area (px). */
  spread?: number;
}

/** A one-shot particle burst at (x, y). */
export function burst(scene: Phaser.Scene, x: number, y: number, o: BurstOpts): void {
  ensureFxTextures(scene);
  const colors = Array.isArray(o.color) ? o.color : [o.color];
  const em = scene.add.particles(x, y, o.tex ?? FX_TEX.dot, {
    speed: { min: o.speed[0], max: o.speed[1] },
    lifespan: { min: o.life[0], max: o.life[1] },
    scale: { start: o.scale[1], end: o.endScale ?? 0 },
    alpha: { start: o.alpha ?? 1, end: 0 },
    angle: { min: o.angle?.[0] ?? 0, max: o.angle?.[1] ?? 360 },
    gravityY: o.gravity ?? 0,
    tint: colors,
    rotate: o.rotate
      ? {
          onEmit: (p?: Phaser.GameObjects.Particles.Particle) => (p ? Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)) : 0),
          onUpdate: (p: Phaser.GameObjects.Particles.Particle) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)),
        }
      : { min: 0, max: 360 },
    blendMode: o.add === false ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD,
    emitting: false,
    emitZone: o.spread ? { type: 'random', source: new Phaser.Geom.Circle(0, 0, o.spread) as never } : undefined,
  });
  em.setDepth(o.depth);
  em.explode(o.n);
  scene.time.delayedCall(o.life[1] + 50, () => em.destroy());
}

/** A soft flash of light (additive glow that pops and fades). */
export function flash(scene: Phaser.Scene, x: number, y: number, color: number, size: number, depth: number, ms = 220, tex: string = FX_TEX.dot): Phaser.GameObjects.Image {
  ensureFxTextures(scene);
  const img = scene.add.image(x, y, tex).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth);
  const s = size / 64;
  img.setScale(s * 0.3);
  scene.tweens.add({ targets: img, scale: s, duration: ms * 0.35, ease: 'Cubic.easeOut' });
  scene.tweens.add({ targets: img, alpha: 0, delay: ms * 0.3, duration: ms * 0.7, onComplete: () => img.destroy() });
  return img;
}

/** An expanding shockwave ring on the ground (squashed for the 3/4 view). */
export function shockwave(scene: Phaser.Scene, x: number, y: number, color: number, radius: number, depth: number, ms = 380, alpha = 0.9): void {
  ensureFxTextures(scene);
  const img = scene.add.image(x, y, FX_TEX.ring).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setAlpha(alpha);
  const s = (radius * 2) / 128;
  img.setScale(s * 0.15, s * 0.15 * 0.55);
  scene.tweens.add({ targets: img, scaleX: s, scaleY: s * 0.55, duration: ms, ease: 'Cubic.easeOut' });
  scene.tweens.add({ targets: img, alpha: 0, delay: ms * 0.35, duration: ms * 0.65, onComplete: () => img.destroy() });
}
