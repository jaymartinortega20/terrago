import Phaser from 'phaser';
import type { FxStyle } from './settings';
import { FX_TEX, burst, flash, shockwave } from './juice';

/** Where an entity stands: feet position plus sprite height. */
export interface Spot {
  x: number;
  y: number;
  h: number;
}

export interface Palette {
  core: number;
  glow: number;
  spark: number;
}

export type WeaponType = 'sword' | 'bow' | 'staff' | 'wand' | 'mace' | 'dagger' | 'shield' | 'fist';

/** Same metal colours as the item icons, per weapon tier. */
const TIER_METAL = [0xd8d8d2, 0xe39a4a, 0xc9ccd4, 0xf0f3f8, 0xf6cd5e, 0x7fe0d8, 0x9a7ad0, 0xffe9a8];

const STYLE: Record<Exclude<FxStyle, 'weapon' | 'rainbow'>, Palette> = {
  fire: { core: 0xffb03a, glow: 0xe0483a, spark: 0xffe48a },
  ice: { core: 0xbfeaff, glow: 0x5fb0e8, spark: 0xffffff },
  lightning: { core: 0xfff6a0, glow: 0x8fd0ff, spark: 0xffffff },
  shadow: { core: 0xb06ad6, glow: 0x3a2050, spark: 0xe0b0ff },
  holy: { core: 0xfff6c8, glow: 0xf2c14e, spark: 0xffffff },
  nature: { core: 0x9cf06a, glow: 0x3c8a3a, spark: 0xe8ffc0 },
};

export const MONSTER_PAL: Palette = { core: 0xff6a5a, glow: 0x8a1a1a, spark: 0xffd0a0 };
export const MAGIC_PAL: Palette = { core: 0xd09aff, glow: 0x6a3a9a, spark: 0xffffff };
export const ICE_PAL = STYLE.ice;
export const FIRE_PAL = STYLE.fire;
export const HOLY_PAL = STYLE.holy;
export const POISON_PAL = STYLE.nature;

export function paletteFor(style: FxStyle, tier: number, now: number): Palette {
  if (style === 'rainbow') {
    const c = Phaser.Display.Color.HSVToRGB((now / 1500) % 1, 0.65, 1) as Phaser.Types.Display.ColorObject;
    const core = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    return { core, glow: core, spark: 0xffffff };
  }
  if (style !== 'weapon') return STYLE[style];
  const m = TIER_METAL[Math.max(0, Math.min(TIER_METAL.length - 1, tier))]!;
  return { core: m, glow: tier >= 5 ? m : 0x8fd0ff, spark: 0xffffff };
}

const TAU = Math.PI * 2;
/** Item icons point their tip up-right (-45°). */
const ICON_TILT = Math.PI / 4;

/**
 * Short-lived combat visuals: weapon swings, slashes, projectiles, impacts and skill effects.
 * Pure decoration; every number still comes from the server.
 */
export class CombatFx {
  private flip = new Map<string, number>();

  constructor(
    private scene: Phaser.Scene,
    private depth: number,
  ) {}

  private get add() {
    return this.scene.add;
  }
  private get tweens() {
    return this.scene.tweens;
  }
  private later(ms: number, fn: () => void): void {
    this.scene.time.delayedCall(ms, fn);
  }
  private chest(s: Spot): { x: number; y: number } {
    return { x: s.x, y: s.y - s.h * 0.5 };
  }
  private hand(s: Spot, a: number): { x: number; y: number } {
    return { x: s.x + Math.cos(a) * 6, y: s.y - s.h * 0.42 + Math.sin(a) * 3 };
  }
  private fade(obj: Phaser.GameObjects.GameObject & { alpha: number }, ms: number, extra: object = {}): void {
    this.tweens.add({ targets: obj, alpha: 0, duration: ms, ...extra, onComplete: () => obj.destroy() });
  }

  // ---------------------------------------------------------------------------
  // Melee
  // ---------------------------------------------------------------------------

  /**
   * Swing the attacker's weapon at the target. Returns when the blow lands (ms),
   * so the caller can time the impact and hide the in-hand weapon meanwhile.
   */
  swing(id: string, from: Spot, to: Spot, type: WeaponType, iconKey: string | null, pal: Palette, opts: { big?: boolean; full: boolean }): number {
    const t = this.chest(to);
    const h = this.hand(from, Math.atan2(t.y - (from.y - from.h * 0.42), t.x - from.x));
    const a = Math.atan2(t.y - h.y, t.x - h.x);
    const big = !!opts.big;
    const side = (this.flip.get(id) ?? 1) * -1;
    this.flip.set(id, side);

    if (type === 'dagger') return this.stab(h, t, a, iconKey, pal, opts.full);
    if (type === 'fist') return this.punch(h, t, a, pal);

    const mace = type === 'mace' || type === 'staff' || type === 'wand';
    const arc = mace ? 1.0 : 1.2;
    const r = (big ? 46 : 34) * (mace ? 0.9 : 1);
    const dur = big ? 240 : mace ? 210 : 170;
    // Mace: overhead chop that always comes down; sword alternates fore- and backhand.
    const a0 = mace ? a - 1.7 : a - arc * side;
    const a1 = mace ? a + 0.25 : a + arc * side;
    const img = iconKey
      ? this.add.image(h.x, h.y, iconKey).setOrigin(0.12, 0.88).setScale(big ? 1.2 : 0.95).setDepth(this.depth + 1).setRotation(a0 + ICON_TILT)
      : null;
    const g = this.add.graphics().setDepth(this.depth).setBlendMode(Phaser.BlendModes.ADD);
    const width = (big ? 12 : 8) * (mace ? 1.2 : 1);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur,
      ease: mace ? 'Quad.easeIn' : 'Cubic.easeOut',
      onUpdate: (tw) => {
        const v = tw.getValue() ?? 0;
        const cur = a0 + (a1 - a0) * v;
        img?.setRotation(cur + ICON_TILT);
        g.clear();
        const tail = a0 + (a1 - a0) * Math.max(0, v - (opts.full ? 0.75 : 0.45));
        this.crescent(g, h.x, h.y, r, tail, cur, width, pal, 1);
      },
      onComplete: () => {
        this.fade(g, 140);
        if (img) this.fade(img, 120);
      },
    });
    if (mace && opts.full) this.later(dur, () => this.ring(t.x, to.y - 2, pal.core, 4, big ? 30 : 20, 260, 3, 0.5));
    return Math.round(dur * 0.75);
  }

  /** A tapering slash: thin at the tail, thick and bright at the head. */
  private crescent(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, a0: number, a1: number, width: number, pal: Palette, alpha: number): void {
    if (Math.abs(a1 - a0) < 0.01) return;
    const n = 12;
    const step = (a1 - a0) / n;
    const ccw = a1 < a0;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      const s = a0 + step * i;
      const e = s + step;
      g.lineStyle(width * (0.4 + 0.9 * k) + 5, pal.glow, 0.22 * k * alpha);
      g.beginPath().arc(cx, cy, r, s, e, ccw).strokePath();
      g.lineStyle(width * (0.25 + 0.75 * k), pal.core, (0.35 + 0.6 * k) * alpha);
      g.beginPath().arc(cx, cy, r, s, e, ccw).strokePath();
    }
    g.lineStyle(1.5, 0xffffff, 0.9 * alpha);
    g.beginPath().arc(cx, cy, r + width * 0.35, a0 + (a1 - a0) * 0.5, a1, ccw).strokePath();
  }

  private stab(h: { x: number; y: number }, t: { x: number; y: number }, a: number, iconKey: string | null, pal: Palette, full: boolean): number {
    const img = iconKey ? this.add.image(h.x, h.y, iconKey).setOrigin(0.15, 0.85).setScale(0.9).setDepth(this.depth + 1).setRotation(a + ICON_TILT) : null;
    if (img) {
      this.tweens.add({
        targets: img,
        x: h.x + Math.cos(a) * 16,
        y: h.y + Math.sin(a) * 16,
        duration: 60,
        yoyo: true,
        repeat: 1,
        onComplete: () => this.fade(img, 100),
      });
    }
    // Two quick cuts crossing on the target.
    this.later(60, () => this.cut(t.x, t.y, a + 0.9, 18, pal, full));
    this.later(180, () => this.cut(t.x, t.y, a - 0.9, 18, pal, full));
    return 70;
  }

  /** A straight slash line drawn quickly across a point. */
  cut(x: number, y: number, a: number, len: number, pal: Palette, full: boolean): void {
    const g = this.add.graphics().setDepth(this.depth + 2);
    const dx = Math.cos(a) * len;
    const dy = Math.sin(a) * len;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 90,
      onUpdate: (tw) => {
        const v = tw.getValue() ?? 0;
        g.clear();
        if (full) g.lineStyle(7, pal.glow, 0.3).lineBetween(x - dx, y - dy, x - dx + 2 * dx * v, y - dy + 2 * dy * v);
        g.lineStyle(3, pal.core, 1).lineBetween(x - dx, y - dy, x - dx + 2 * dx * v, y - dy + 2 * dy * v);
        g.lineStyle(1, 0xffffff, 1).lineBetween(x - dx * 0.6, y - dy * 0.6, x - dx + 2 * dx * v * 0.8, y - dy + 2 * dy * v * 0.8);
      },
      onComplete: () => this.fade(g, 160),
    });
  }

  private punch(h: { x: number; y: number }, t: { x: number; y: number }, a: number, pal: Palette): number {
    const fist = this.add.circle(h.x, h.y, 4, 0xf0c8a0).setStrokeStyle(1, 0x2a2030).setDepth(this.depth + 1);
    this.tweens.add({
      targets: fist,
      x: h.x + Math.cos(a) * 18,
      y: h.y + Math.sin(a) * 18,
      duration: 70,
      yoyo: true,
      onComplete: () => fist.destroy(),
    });
    this.later(70, () => this.star(t.x, t.y, pal.core, 10));
    return 70;
  }

  /** Monster melee: three claw scratches. */
  claws(to: Spot, pal: Palette, big: boolean): void {
    const t = this.chest(to);
    const len = big ? 20 : 12;
    for (let i = -1; i <= 1; i++) {
      this.later((i + 1) * 30, () => {
        const g = this.add.graphics().setDepth(this.depth + 2);
        const ox = t.x + i * (big ? 7 : 5);
        this.tweens.addCounter({
          from: 0,
          to: 1,
          duration: 80,
          onUpdate: (tw) => {
            const v = tw.getValue() ?? 0;
            g.clear();
            g.lineStyle(big ? 4 : 3, pal.glow, 0.6).lineBetween(ox - len * 0.4, t.y - len * 0.6, ox - len * 0.4 + len * 0.8 * v, t.y - len * 0.6 + len * 1.2 * v);
            g.lineStyle(big ? 2 : 1.5, pal.core, 1).lineBetween(ox - len * 0.4, t.y - len * 0.6, ox - len * 0.4 + len * 0.8 * v, t.y - len * 0.6 + len * 1.2 * v);
          },
          onComplete: () => this.fade(g, 220),
        });
      });
    }
  }

  /** Working a tile: the tool lifts and comes down on it (hoe, pickaxe, axe...). */
  workSwing(from: Spot, tx: number, ty: number, iconKey: string | null): void {
    if (!iconKey) return;
    const h = { x: from.x, y: from.y - from.h * 0.45 };
    const a = Math.atan2(ty - h.y, tx - h.x);
    const img = this.add.image(h.x + Math.cos(a) * 4, h.y, iconKey).setOrigin(0.12, 0.88).setScale(0.9).setDepth(this.depth + 1).setRotation(a - 1.6 + ICON_TILT);
    this.tweens.add({
      targets: img,
      rotation: a + 0.2 + ICON_TILT,
      duration: 170,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.sparks(tx, ty, 0xe8dcc0, 4, 10);
        this.fade(img, 160);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Ranged
  // ---------------------------------------------------------------------------

  /** The bow appears and draws toward the target while the arrow flies. */
  bow(from: Spot, to: Spot, iconKey: string | null): void {
    if (!iconKey) return;
    const t = this.chest(to);
    const a = Math.atan2(t.y - (from.y - from.h * 0.45), t.x - from.x);
    const h = this.hand(from, a);
    const img = this.add.image(h.x + Math.cos(a) * 6, h.y + Math.sin(a) * 6, iconKey).setScale(0.9).setDepth(this.depth + 1).setRotation(a);
    this.tweens.add({ targets: img, scaleX: 0.75, duration: 90, yoyo: true, onComplete: () => this.fade(img, 140) });
  }

  /** Staff or wand raised, with a glow at the tip. */
  raise(from: Spot, to: Spot, iconKey: string | null, pal: Palette): void {
    const t = this.chest(to);
    const a = Math.atan2(t.y - (from.y - from.h * 0.45), t.x - from.x);
    const h = this.hand(from, a);
    if (iconKey) {
      const img = this.add.image(h.x, h.y, iconKey).setOrigin(0.12, 0.88).setScale(0.95).setDepth(this.depth + 1).setRotation(a - 0.5 + ICON_TILT);
      this.tweens.add({ targets: img, rotation: a + ICON_TILT, duration: 120, onComplete: () => this.fade(img, 160) });
    }
    const tip = { x: h.x + Math.cos(a) * 20, y: h.y + Math.sin(a) * 20 };
    const glow = this.add.circle(tip.x, tip.y, 9, pal.glow, 0.45).setDepth(this.depth + 2);
    this.fade(glow, 260, { scale: 1.8 });
  }

  /**
   * Something flies from attacker to target, then onHit runs.
   * kind: arrow, orb (magic), fire (fireball), dark (monster magic).
   */
  shoot(from: Spot, to: Spot, kind: 'arrow' | 'orb' | 'fire', pal: Palette, opts: { full: boolean; glow?: boolean; size?: number; onHit?: () => void }): void {
    const sx = from.x;
    const sy = from.y - from.h * 0.55;
    const t = this.chest(to);
    const d = Math.hypot(t.x - sx, t.y - sy);
    const a = Math.atan2(t.y - sy, t.x - sx);
    if (d < 24) {
      opts.onHit?.();
      return;
    }
    const size = opts.size ?? (kind === 'arrow' ? 1 : kind === 'fire' ? 7 : 5);
    let obj: Phaser.GameObjects.Graphics | Phaser.GameObjects.Container;
    if (kind === 'arrow') {
      const g = this.add.graphics();
      if (opts.glow) g.lineStyle(6, pal.glow, 0.4).lineBetween(-10, 0, 7, 0);
      g.lineStyle(2, 0x8a5d33, 1).lineBetween(-9, 0, 5, 0);
      g.fillStyle(pal.core, 1).fillTriangle(8, 0, 3, -3, 3, 3);
      g.fillStyle(0xe8dcc0, 1).fillTriangle(-9, 0, -12, -3, -7, 0).fillTriangle(-9, 0, -12, 3, -7, 0);
      g.setRotation(a);
      obj = g;
    } else {
      const outer = this.add.image(0, 0, FX_TEX.dot).setTint(pal.glow).setBlendMode(Phaser.BlendModes.ADD).setScale((size + 10) / 22);
      const inner = this.add.image(0, 0, FX_TEX.dot).setTint(pal.core).setBlendMode(Phaser.BlendModes.ADD).setScale(size / 14);
      const core = this.add.image(0, 0, FX_TEX.flare).setBlendMode(Phaser.BlendModes.ADD).setScale(size / 26);
      obj = this.add.container(0, 0, [outer, inner, core]);
      this.tweens.add({ targets: outer, scale: 1.3, duration: 90, yoyo: true, repeat: -1 });
    }
    obj.setPosition(sx, sy).setDepth(this.depth + 3);
    let last = 0;
    const speed = kind === 'arrow' ? 0.9 : 1.3;
    this.tweens.add({
      targets: obj,
      x: t.x,
      y: t.y,
      duration: Math.max(90, Math.min(kind === 'arrow' ? 240 : 320, d * speed)),
      onUpdate: (tw) => {
        if (!opts.full) return;
        const now = tw.elapsed;
        if (now - last < 22) return;
        last = now;
        const ox = obj.x;
        const oy = obj.y;
        if (kind === 'arrow') {
          const p = this.add.image(ox - Math.cos(a) * 8, oy - Math.sin(a) * 8, FX_TEX.spark).setTint(opts.glow ? pal.core : 0xfff0d0).setBlendMode(Phaser.BlendModes.ADD).setScale(0.35, 0.3).setRotation(a).setDepth(this.depth + 2).setAlpha(0.7);
          this.fade(p, 160);
        } else {
          const c = kind === 'fire' ? [0xffe48a, 0xffb03a, 0xe0483a][Math.floor(Math.random() * 3)]! : pal.core;
          const p = this.add.image(ox + (Math.random() * 6 - 3), oy + (Math.random() * 6 - 3), FX_TEX.dot).setTint(c).setBlendMode(Phaser.BlendModes.ADD).setScale(size * 0.05).setDepth(this.depth + 2);
          this.fade(p, kind === 'fire' ? 320 : 240, { scale: 0.02, y: oy - (kind === 'fire' ? 10 : 0) });
        }
      },
      onComplete: () => {
        obj.destroy();
        opts.onHit?.();
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Impacts
  // ---------------------------------------------------------------------------

  impact(to: Spot, pal: Palette, crit: boolean, full: boolean): void {
    const t = this.chest(to);
    const sc = this.scene;
    // Hot flash at the point of contact, a star flare, flying sparks.
    flash(sc, t.x, t.y, pal.glow, crit ? 100 : 46, this.depth + 4, crit ? 300 : 180);
    flash(sc, t.x, t.y, 0xffffff, crit ? 64 : 30, this.depth + 5, crit ? 220 : 140, FX_TEX.flare);
    this.sparks(t.x, t.y, crit ? pal.core : pal.spark, full ? (crit ? 22 : 10) : crit ? 10 : 5, crit ? 46 : 28);
    if (crit) {
      this.star(t.x, t.y, pal.core, 30);
      shockwave(sc, to.x, to.y - 2, pal.core, 46, this.depth - 1, 360);
      if (full) burst(sc, t.x, t.y, { tex: FX_TEX.smoke, n: 5, color: [0xffffff, pal.glow], speed: [20, 60], life: [300, 520], scale: [0.4, 0.7], endScale: 1.2, alpha: 0.5, depth: this.depth + 3 });
    }
  }

  sparks(x: number, y: number, color: number, n: number, dist: number): void {
    const sc = this.scene;
    burst(sc, x, y, { tex: FX_TEX.spark, n, color: [color, 0xffffff, color], speed: [dist * 3.5, dist * 7.5], life: [180, 380], scale: [0.25, 0.5], endScale: 0.05, gravity: 420, rotate: true, depth: this.depth + 4 });
    burst(sc, x, y, { n: Math.ceil(n / 2), color: [color, 0xffffff], speed: [dist * 1.5, dist * 3.5], life: [250, 500], scale: [0.08, 0.16], gravity: 180, depth: this.depth + 4 });
  }

  /** Four-point flare that pops and spins. */
  star(x: number, y: number, color: number, size: number): void {
    const img = flash(this.scene, x, y, color, size * 3.2, this.depth + 5, 260, FX_TEX.flare);
    this.tweens.add({ targets: img, angle: 25, duration: 260 });
    flash(this.scene, x, y, 0xffffff, size * 1.4, this.depth + 6, 160, FX_TEX.flare);
  }

  ring(x: number, y: number, color: number, r0: number, r1: number, ms: number, width: number, alpha = 0.9): void {
    const img = this.add.image(x, y, FX_TEX.ring).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth - 1).setAlpha(Math.min(1, alpha + width * 0.04));
    const s1 = (r1 * 2.2) / 128;
    img.setScale((s1 * r0) / r1);
    this.tweens.add({ targets: img, scale: s1, duration: ms, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: img, alpha: 0, delay: ms * 0.4, duration: ms * 0.6, onComplete: () => img.destroy() });
  }

  whoosh(to: Spot): void {
    const t = this.chest(to);
    const g = this.add.graphics().setDepth(this.depth);
    g.lineStyle(2, 0xffffff, 0.6).beginPath().arc(t.x, t.y, 16, -2.4, -0.7, false).strokePath();
    g.lineStyle(1, 0xffffff, 0.4).beginPath().arc(t.x, t.y, 21, -2.2, -0.9, false).strokePath();
    this.fade(g, 260, { x: 8 });
  }

  heal(to: Spot, full: boolean): void {
    shockwave(this.scene, to.x, to.y - 2, 0x7cf06a, 34, this.depth - 1, 520);
    flash(this.scene, to.x, to.y - to.h * 0.45, 0x7cf06a, 90, this.depth + 3, 420);
    burst(this.scene, to.x, to.y - 6, { n: full ? 22 : 10, color: [0x9cf06a, 0xe8ffc0, 0xffffff], speed: [10, 40], angle: [240, 300], life: [600, 1000], scale: [0.12, 0.26], gravity: -90, spread: 16, depth: this.depth + 4 });
  }

  bubbles(to: Spot, color: number): void {
    burst(this.scene, to.x, to.y - to.h * 0.3, { n: 6, color: [color, 0xffffff], speed: [8, 24], angle: [250, 290], life: [500, 800], scale: [0.1, 0.2], gravity: -60, spread: 10, depth: this.depth + 2 });
  }

  // ---------------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------------

  explode(to: Spot, pal: Palette, full: boolean): void {
    const t = this.chest(to);
    const sc = this.scene;
    flash(sc, t.x, t.y, pal.glow, 150, this.depth + 3, 420);
    flash(sc, t.x, t.y, pal.core, 80, this.depth + 4, 300);
    flash(sc, t.x, t.y, 0xffffff, 60, this.depth + 5, 200, FX_TEX.flare);
    shockwave(sc, to.x, to.y - 2, pal.core, 54, this.depth - 1, 420);
    this.sparks(t.x, t.y, pal.spark, full ? 18 : 8, 40);
    if (full) {
      burst(sc, t.x, t.y, { tex: FX_TEX.smoke, n: 8, color: [0x3a3030, 0x5a4a40], speed: [20, 70], life: [500, 900], scale: [0.5, 0.9], endScale: 1.6, alpha: 0.55, gravity: -40, add: false, depth: this.depth + 2 });
      burst(sc, t.x, t.y, { n: 14, color: [pal.core, pal.spark, 0xffffff], speed: [40, 140], life: [500, 900], scale: [0.08, 0.16], gravity: -60, depth: this.depth + 4 });
    }
  }

  /** Smite: a pillar of light drops on the target. */
  beam(to: Spot, pal: Palette, full: boolean): void {
    const h = 140;
    const col = this.add.rectangle(to.x, to.y, 14, h, pal.core, 0.75).setOrigin(0.5, 1).setDepth(this.depth + 3).setScale(0.2, 1);
    const glow = this.add.rectangle(to.x, to.y, 30, h, pal.glow, 0.3).setOrigin(0.5, 1).setDepth(this.depth + 2).setScale(0.2, 1);
    this.tweens.add({ targets: [col, glow], scaleX: 1, duration: 110, yoyo: true, hold: 120, onComplete: () => [col, glow].forEach((o) => o.destroy()) });
    this.ring(to.x, to.y - 2, pal.core, 4, 26, 360, 3);
    if (full) this.sparks(to.x, to.y - 10, pal.spark, 10, 26);
  }

  /** Whirlwind: the weapon spins all the way round the warrior. */
  spin(from: Spot, iconKey: string | null, pal: Palette, radius: number, full: boolean): number {
    const cx = from.x;
    const cy = from.y - from.h * 0.4;
    const img = iconKey ? this.add.image(cx, cy, iconKey).setOrigin(0.12, 0.88).setScale(1.15).setDepth(this.depth + 1) : null;
    const g = this.add.graphics().setDepth(this.depth);
    const dur = 480;
    this.tweens.addCounter({
      from: 0,
      to: TAU * 2,
      duration: dur,
      ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const cur = tw.getValue() ?? 0;
        img?.setRotation(cur + ICON_TILT);
        g.clear();
        this.crescent(g, cx, cy, radius, cur - (full ? 2.6 : 1.4), cur, 8, pal, 1);
      },
      onComplete: () => {
        this.fade(g, 160);
        if (img) this.fade(img, 140);
      },
    });
    if (full) this.ring(from.x, from.y - 4, pal.core, 10, radius + 10, dur, 2, 0.5);
    return dur;
  }

  /** Frost nova: an icy ring bursts out, shards fly. */
  nova(from: Spot, pal: Palette, radius: number, full: boolean): void {
    this.ring(from.x, from.y - 6, pal.core, 6, radius, 420, 5, 0.9);
    if (full) this.ring(from.x, from.y - 6, 0xffffff, 4, radius * 0.7, 360, 2, 0.8);
    shockwave(this.scene, from.x, from.y - 2, pal.core, radius, this.depth - 1, 480);
    flash(this.scene, from.x, from.y - 10, pal.glow, radius * 1.4, this.depth + 1, 380);
    burst(this.scene, from.x, from.y - 10, { tex: FX_TEX.shard, n: full ? 22 : 10, color: [pal.core, 0xffffff], speed: [radius * 1.8, radius * 3], life: [300, 480], scale: [0.5, 0.9], endScale: 0.2, rotate: true, depth: this.depth + 2 });
    if (full) burst(this.scene, from.x, from.y - 10, { n: 20, color: [0xffffff, pal.core], speed: [20, radius * 2], life: [500, 900], scale: [0.06, 0.14], gravity: -30, depth: this.depth + 3 });
  }

  /** Volley: arrows rain down around the target. */
  rain(at: Spot, radius: number, full: boolean): void {
    const n = full ? 9 : 4;
    for (let i = 0; i < n; i++) {
      this.later(i * 35, () => {
        const x = at.x + (Math.random() * 2 - 1) * radius;
        const y = at.y - 4 + (Math.random() * 2 - 1) * radius * 0.6;
        const g = this.add.graphics().setDepth(this.depth + 3);
        g.lineStyle(2, 0x8a5d33, 1).lineBetween(0, -14, 0, 0);
        g.fillStyle(0xe8dcc0, 1).fillTriangle(0, 3, -3, -2, 3, -2);
        g.setPosition(x - 30, y - 90).setRotation(-0.32);
        this.tweens.add({
          targets: g,
          x,
          y,
          duration: 180,
          ease: 'Quad.easeIn',
          onComplete: () => {
            g.destroy();
            const dust = this.add.circle(x, y, 5, 0xe8dcc0, 0.6).setDepth(this.depth);
            this.fade(dust, 200, { scale: 2 });
          },
        });
      });
    }
  }

  /** Hunter's mark: a reticle tightens on the target. */
  reticle(to: Spot, color: number): void {
    const t = this.chest(to);
    const g = this.add.graphics().setDepth(this.depth + 4).setPosition(t.x, t.y);
    g.lineStyle(2, color, 1).strokeCircle(0, 0, 14);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      g.lineBetween(Math.cos(a) * 9, Math.sin(a) * 9, Math.cos(a) * 20, Math.sin(a) * 20);
    }
    g.setScale(2.2).setAlpha(0);
    this.tweens.add({ targets: g, scale: 1, alpha: 1, angle: 90, duration: 260, ease: 'Back.easeOut', onComplete: () => this.fade(g, 500) });
  }

  /** War cry: red shout waves. */
  shout(from: Spot, pal: Palette): void {
    for (let i = 0; i < 3; i++) this.later(i * 110, () => this.ring(from.x, from.y - from.h * 0.5, pal.core, 8, 46, 380, 3, 0.9));
  }

  /** Arcane shield: a bubble forms around the caster. */
  bubble(from: Spot, pal: Palette): void {
    const c = this.add.circle(from.x, from.y - from.h * 0.45, from.h * 0.6, pal.glow, 0.18).setStrokeStyle(2, pal.core, 0.9).setDepth(this.depth).setScale(0.3);
    this.tweens.add({ targets: c, scale: 1, duration: 200, ease: 'Back.easeOut', onComplete: () => this.fade(c, 700) });
  }

  /** Blessing: golden motes rise around the caster. */
  motes(from: Spot, color: number): void {
    shockwave(this.scene, from.x, from.y - 2, color, 30, this.depth - 1, 600, 0.7);
    burst(this.scene, from.x, from.y - 8, { n: 24, color: [color, 0xffffff], speed: [10, 30], angle: [250, 290], life: [700, 1200], scale: [0.1, 0.22], gravity: -70, spread: 18, depth: this.depth + 2 });
  }

  /** Evasion: fading copies of the character slide away. */
  afterimage(sprite: Phaser.GameObjects.Sprite | null, pal: Palette): void {
    if (!sprite) return;
    for (let i = 1; i <= 3; i++) {
      const ghost = this.add.sprite(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name).setOrigin(0.5, 1).setDepth(sprite.depth - 0.1).setAlpha(0.5).setTint(pal.core);
      this.tweens.add({ targets: ghost, x: sprite.x + (i % 2 ? -1 : 1) * 8 * i, alpha: 0, duration: 300 + i * 80, onComplete: () => ghost.destroy() });
    }
  }

  /** Backstab: the rogue blinks behind the target and cuts. */
  backstab(from: Spot, to: Spot, iconKey: string | null, pal: Palette, full: boolean): void {
    const t = this.chest(to);
    const a = Math.atan2(t.y - (from.y - from.h * 0.5), t.x - from.x);
    const bx = t.x + Math.cos(a) * 16;
    const by = t.y + Math.sin(a) * 10;
    const puff = this.add.circle(bx, by, 10, 0x3a2050, 0.5).setDepth(this.depth);
    this.fade(puff, 300, { scale: 1.8 });
    if (iconKey) {
      const img = this.add.image(bx, by, iconKey).setOrigin(0.15, 0.85).setDepth(this.depth + 1).setRotation(a + Math.PI + ICON_TILT);
      this.tweens.add({ targets: img, x: t.x, y: t.y, duration: 90, onComplete: () => this.fade(img, 120) });
    }
    this.later(80, () => {
      this.cut(t.x, t.y, a + Math.PI / 2 + 0.4, 22, pal, full);
      this.later(70, () => this.cut(t.x, t.y, a + Math.PI / 2 - 0.4, 22, pal, full));
    });
  }
}
