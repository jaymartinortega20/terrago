import Phaser from 'phaser';
import type { Spot } from './CombatFx';
import { TEXT_RES } from '../hd/screen';

/**
 * The flashy layer: rune circles, lightning, vortex splashes, meteors, pillars
 * of light, ice spikes, skill-name callouts and the big pixel damage numbers.
 * Pure decoration drawn from server combat events.
 */

const TAU = Math.PI * 2;
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ';

export interface SpellColors {
  /** Main glow colour, a lighter core, and CSS versions for canvas drawing. */
  main: number;
  light: number;
  css: string;
}

export const SPELL = {
  arcane: { main: 0x4ad8ff, light: 0xd8f8ff, css: '#6ae4ff' },
  frost: { main: 0x8ad8ff, light: 0xffffff, css: '#a8e6ff' },
  fire: { main: 0xff6a2a, light: 0xffe08a, css: '#ff8a3a' },
  holy: { main: 0xffd84a, light: 0xfffbe0, css: '#ffe070' },
  shadow: { main: 0xa04aff, light: 0xe8c8ff, css: '#b46aff' },
  nature: { main: 0x6ae84a, light: 0xe0ffd0, css: '#8af06a' },
  blood: { main: 0xff3a4a, light: 0xffc0c0, css: '#ff5a6a' },
  storm: { main: 0x7ab8ff, light: 0xffffff, css: '#9ad0ff' },
} satisfies Record<string, SpellColors>;

export class SpellFx {
  /** Recent numbers per target, so a flurry stacks instead of overlapping. */
  private stack = new Map<string, { n: number; at: number }>();
  /** Last callout per caster (area skills send many hits). */
  private called = new Map<string, number>();

  constructor(
    private scene: Phaser.Scene,
    private depth: number,
    private font: string,
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
  /** Text is drawn in world space: keep it big on screen when zoomed out. */
  private get textScale(): number {
    return Math.max(0.6, Math.min(2, 1.45 / (this.scene.cameras.main.zoom || 1)));
  }

  // ---------------------------------------------------------------------------
  // Textures
  // ---------------------------------------------------------------------------

  private texture(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): string {
    if (this.scene.textures.exists(key)) return key;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d')!, size);
    this.scene.textures.addCanvas(key, c);
    return key;
  }

  /** Soft round glow (white; tint it). */
  private glowKey(): string {
    return this.texture('spell:glow', 128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
  }

  /** A rune circle: rings, tick marks, runes and a hexagram, in one colour. */
  private circleKey(css: string): string {
    return this.texture(`spell:circle:${css}`, 256, (g, s) => {
      const c = s / 2;
      const R = s * 0.46;
      g.translate(c, c);
      g.strokeStyle = css;
      g.fillStyle = css;
      g.shadowColor = css;
      g.shadowBlur = 10;
      for (const [r, w] of [
        [R, 4],
        [R * 0.86, 2],
        [R * 0.62, 3],
        [R * 0.34, 2],
      ] as const) {
        g.lineWidth = w;
        g.beginPath();
        g.arc(0, 0, r, 0, TAU);
        g.stroke();
      }
      g.lineWidth = 2.5;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU;
        const r2 = R * (i % 4 ? 0.93 : 0.99);
        g.beginPath();
        g.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
        g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        g.stroke();
      }
      g.font = `bold ${Math.round(R * 0.15)}px serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.13;
        g.save();
        g.translate(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74);
        g.rotate(a + Math.PI / 2);
        g.fillText(RUNES[i % RUNES.length]!, 0, 0);
        g.restore();
      }
      g.lineWidth = 2.5;
      for (const off of [0, Math.PI / 3]) {
        g.beginPath();
        for (let i = 0; i <= 3; i++) {
          const a = off + (i / 3) * TAU - Math.PI / 2;
          if (i) g.lineTo(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6);
          else g.moveTo(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6);
        }
        g.stroke();
      }
    });
  }

  private glow(x: number, y: number, color: number, radius: number, alpha: number, ms: number, depth = this.depth): Phaser.GameObjects.Image {
    const img = this.add
      .image(x, y, this.glowKey())
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(alpha)
      .setScale((radius * 2) / 128)
      .setDepth(depth);
    this.tweens.add({ targets: img, alpha: 0, scale: img.scale * 1.25, duration: ms, ease: 'Cubic.easeOut', onComplete: () => img.destroy() });
    return img;
  }

  // ---------------------------------------------------------------------------
  // Spells
  // ---------------------------------------------------------------------------

  /** A rune circle spinning flat on the ground under a caster. */
  magicCircle(at: Spot, c: SpellColors, radius: number, ms = 900): void {
    const box = this.add.container(at.x, at.y + 2).setDepth(this.depth - 1).setScale(1, 0.5);
    const img = this.add
      .image(0, 0, this.circleKey(c.css))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale((radius * 2) / 256 / 0.92)
      .setAlpha(0);
    const halo = this.add.image(0, 0, this.glowKey()).setTint(c.main).setBlendMode(Phaser.BlendModes.ADD).setScale((radius * 2.6) / 128).setAlpha(0);
    box.add([halo, img]);
    this.tweens.add({ targets: img, angle: 140, duration: ms + 200 });
    this.tweens.add({ targets: [img, halo], alpha: { from: 0, to: 0.95 }, duration: 140, yoyo: true, hold: ms - 280, onComplete: () => box.destroy() });
    // light motes rising from the ring
    for (let i = 0; i < 10; i++) {
      this.later(i * (ms / 14), () => {
        const a = Math.random() * TAU;
        const r = radius * (0.4 + Math.random() * 0.6);
        const x = at.x + Math.cos(a) * r;
        const y = at.y + Math.sin(a) * r * 0.5;
        const p = this.add.rectangle(x, y, 2, 6 + Math.random() * 6, c.light, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth);
        this.tweens.add({ targets: p, y: y - 30 - Math.random() * 30, alpha: 0, duration: 600, onComplete: () => p.destroy() });
      });
    }
  }

  /** Forked lightning between two points, flickering a few times. */
  lightning(from: { x: number; y: number }, to: { x: number; y: number }, c: SpellColors, forks = 3): void {
    const g = this.add.graphics().setDepth(this.depth + 2).setBlendMode(Phaser.BlendModes.ADD);
    const jag = (a: { x: number; y: number }, b: { x: number; y: number }, spread: number, n: number) => {
      const pts = [new Phaser.Math.Vector2(a.x, a.y)];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        pts.push(new Phaser.Math.Vector2(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * spread, a.y + (b.y - a.y) * t + (Math.random() - 0.5) * spread));
      }
      pts.push(new Phaser.Math.Vector2(b.x, b.y));
      return pts;
    };
    const draw = () => {
      g.clear();
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      const pts = jag(from, to, Math.min(40, len * 0.18), Math.max(6, Math.round(len / 14)));
      g.lineStyle(10, c.main, 0.25).strokePoints(pts);
      g.lineStyle(4, c.main, 0.85).strokePoints(pts);
      g.lineStyle(1.6, 0xffffff, 1).strokePoints(pts);
      for (let k = 0; k < forks; k++) {
        const p = pts[1 + Math.floor(Math.random() * (pts.length - 2))]!;
        const end = { x: p.x + (Math.random() - 0.4) * 40, y: p.y + (Math.random() - 0.3) * 30 };
        g.lineStyle(1.4, c.light, 0.9).strokePoints(jag(p, end, 10, 4));
      }
    };
    draw();
    this.later(60, draw);
    this.later(120, draw);
    this.tweens.add({ targets: g, alpha: 0, delay: 180, duration: 160, onComplete: () => g.destroy() });
    this.glow(to.x, to.y, c.main, 34, 0.9, 320);
    this.glow(from.x, from.y, c.light, 16, 0.9, 240);
  }

  /** A swirling splash where a spell lands: spiral arcs, droplets and light streaks. */
  vortex(at: { x: number; y: number }, c: SpellColors, size = 1): void {
    const g = this.add.graphics().setDepth(this.depth + 1).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 420,
      ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        g.clear();
        for (let i = 0; i < 5; i++) {
          const r = (8 + i * 7) * size * (0.5 + k);
          g.lineStyle(4 - i * 0.6, i % 2 ? c.light : c.main, (1 - k) * (0.9 - i * 0.12));
          g.beginPath();
          // flattened spiral arcs (top-down perspective)
          for (let s = 0; s <= 16; s++) {
            const a = i * 0.9 + k * 3 + (s / 16) * Math.PI * 1.25;
            const x = at.x + Math.cos(a) * r;
            const y = at.y + Math.sin(a) * r * 0.5;
            if (s) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          g.strokePath();
        }
      },
      onComplete: () => g.destroy(),
    });
    for (let i = 0; i < 14 * size; i++) {
      const a = -Math.PI * Math.random();
      const d = (18 + Math.random() * 30) * size;
      const drop = this.add.ellipse(at.x, at.y - 4, 3, 5, i % 3 ? c.main : c.light, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth + 2);
      this.tweens.add({ targets: drop, x: at.x + Math.cos(a) * d * 1.3, y: at.y - 4 + Math.sin(a) * d, alpha: 0, duration: 380 + Math.random() * 200, ease: 'Quad.easeOut', onComplete: () => drop.destroy() });
    }
    const streaks = this.add.graphics().setDepth(this.depth + 2).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * TAU;
      streaks.lineStyle(1.5, 0xffffff, 0.9).lineBetween(at.x + Math.cos(a) * 10, at.y + Math.sin(a) * 7, at.x + Math.cos(a) * (28 + Math.random() * 20) * size, at.y + Math.sin(a) * (20 + Math.random() * 14) * size);
    }
    this.tweens.add({ targets: streaks, alpha: 0, duration: 260, onComplete: () => streaks.destroy() });
    this.glow(at.x, at.y - 6, c.main, 40 * size, 0.8, 380);
  }

  /** Ice spikes burst from the ground in a ring. */
  iceSpikes(at: Spot, radius: number): void {
    const n = 14;
    this.magicCircle(at, SPELL.frost, radius * 0.9, 650);
    for (let i = 0; i < n; i++) {
      this.later(i * 12, () => {
        const a = (i / n) * TAU;
        const r = radius * (i % 2 ? 0.75 : 0.95);
        const x = at.x + Math.cos(a) * r;
        const y = at.y + Math.sin(a) * r * 0.55;
        const h = 14 + (i % 3) * 7;
        const g = this.add.graphics().setDepth(this.depth + 1).setPosition(x, y);
        g.fillStyle(0xbfeaff, 0.85).fillTriangle(-5, 0, 0, -h, 5, 0);
        g.fillStyle(0xffffff, 0.9).fillTriangle(-1, 0, 0, -h, 2, -h * 0.2);
        g.lineStyle(1, 0xffffff, 0.9).strokeTriangle(-5, 0, 0, -h, 5, 0);
        g.setScale(1, 0.1);
        this.tweens.add({ targets: g, scaleY: 1, duration: 90, ease: 'Back.easeOut', onComplete: () => this.tweens.add({ targets: g, alpha: 0, delay: 300, duration: 300, onComplete: () => g.destroy() }) });
      });
    }
    this.glow(at.x, at.y - 6, SPELL.frost.main, radius, 0.6, 600);
  }

  /** A burning meteor falls on a spot and explodes. */
  meteor(at: Spot, radius: number): void {
    const c = SPELL.fire;
    const sx = at.x - 120;
    const sy = at.y - 260;
    const rock = this.add.circle(sx, sy, 9, 0xffb04a).setDepth(this.depth + 3);
    const halo = this.add.image(sx, sy, this.glowKey()).setTint(c.main).setBlendMode(Phaser.BlendModes.ADD).setScale(0.6).setDepth(this.depth + 2);
    const trail = this.add.graphics().setDepth(this.depth + 2).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 380,
      ease: 'Quad.easeIn',
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        const x = sx + (at.x - sx) * k;
        const y = sy + (at.y - 6 - sy) * k;
        rock.setPosition(x, y);
        halo.setPosition(x, y);
        trail.clear();
        trail.lineStyle(10, c.main, 0.35).lineBetween(sx + (x - sx) * 0.5, sy + (y - sy) * 0.5, x, y);
        trail.lineStyle(4, c.light, 0.8).lineBetween(sx + (x - sx) * 0.75, sy + (y - sy) * 0.75, x, y);
      },
      onComplete: () => {
        rock.destroy();
        halo.destroy();
        trail.destroy();
        this.explosion(at, radius, c);
        (this.scene.cameras.main as Phaser.Cameras.Scene2D.Camera).shake(140, 0.004);
      },
    });
  }

  /** Fire explosion with a scorch ring and embers. */
  explosion(at: Spot, radius: number, c: SpellColors): void {
    this.glow(at.x, at.y - 10, c.light, radius * 0.6, 1, 260);
    this.glow(at.x, at.y - 10, c.main, radius * 1.3, 0.9, 520);
    const ring = this.add.ellipse(at.x, at.y, radius * 2, radius, undefined).setStrokeStyle(4, c.main, 0.9).setDepth(this.depth).setScale(0.2);
    this.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 500, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * TAU;
      const d = radius * (0.4 + Math.random() * 0.8);
      const e = this.add.rectangle(at.x, at.y - 8, 3, 3, i % 3 ? c.main : 0xffe08a).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth + 2);
      this.tweens.add({ targets: e, x: at.x + Math.cos(a) * d, y: at.y - 8 + Math.sin(a) * d * 0.6 - 16, alpha: 0, duration: 500 + Math.random() * 300, ease: 'Cubic.easeOut', onComplete: () => e.destroy() });
    }
  }

  /** A pillar of light drops on a spot (holy spells). */
  pillar(at: Spot, c: SpellColors, width = 26): void {
    const h = 220;
    const col = this.add.image(at.x, at.y, this.glowKey()).setTint(c.main).setBlendMode(Phaser.BlendModes.ADD).setOrigin(0.5, 1).setDepth(this.depth + 2).setDisplaySize(width * 2.2, h).setAlpha(0);
    const core = this.add.rectangle(at.x, at.y, width * 0.35, h, c.light, 0.9).setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth + 3).setScale(0.1, 1);
    this.tweens.add({ targets: col, alpha: 0.95, duration: 90, yoyo: true, hold: 220, onComplete: () => col.destroy() });
    this.tweens.add({ targets: core, scaleX: 1, duration: 90, yoyo: true, hold: 200, onComplete: () => core.destroy() });
    this.magicCircle(at, c, width * 1.3, 600);
    for (let i = 0; i < 12; i++) {
      const p = this.add.rectangle(at.x + (Math.random() - 0.5) * width * 1.4, at.y - Math.random() * 20, 2, 5, c.light).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth + 3);
      this.tweens.add({ targets: p, y: p.y - 60 - Math.random() * 60, alpha: 0, duration: 600 + Math.random() * 300, onComplete: () => p.destroy() });
    }
  }

  /** Purple orbs drawn out of the target back into the caster (life drain). */
  drain(from: { x: number; y: number }, to: { x: number; y: number }, c: SpellColors): void {
    const g = this.add.graphics().setDepth(this.depth + 1).setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(6, c.main, 0.3).lineBetween(from.x, from.y, to.x, to.y);
    g.lineStyle(2, c.light, 0.8).lineBetween(from.x, from.y, to.x, to.y);
    this.tweens.add({ targets: g, alpha: 0, duration: 500, onComplete: () => g.destroy() });
    for (let i = 0; i < 7; i++) {
      this.later(i * 50, () => {
        const o = this.add.image(to.x, to.y, this.glowKey()).setTint(c.main).setBlendMode(Phaser.BlendModes.ADD).setScale(0.18).setDepth(this.depth + 2);
        this.tweens.add({ targets: o, x: from.x, y: from.y, duration: 380, ease: 'Sine.easeIn', onComplete: () => o.destroy() });
      });
    }
  }

  /** Skulls and a dark ring on a cursed target. */
  hex(at: Spot, c: SpellColors): void {
    this.magicCircle(at, c, 26, 700);
    const t = this.add
      .text(at.x, at.y - at.h - 6, '☠', { fontFamily: this.font, fontSize: '22px', color: c.css, stroke: '#1a0a2a', strokeThickness: 4 })
      .setOrigin(0.5, 1)
      .setDepth(this.depth + 3);
    this.tweens.add({ targets: t, y: t.y - 18, alpha: 0, duration: 800, onComplete: () => t.destroy() });
  }

  /** A huge crescent slash (cleave) with a shockwave. */
  bigSlash(at: Spot, c: SpellColors, radius: number): void {
    const g = this.add.graphics().setDepth(this.depth + 2).setBlendMode(Phaser.BlendModes.ADD);
    const cy = at.y - at.h * 0.4;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 260,
      ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        g.clear();
        const a0 = -Math.PI * 0.9 + k * Math.PI * 1.6;
        for (let i = 0; i < 6; i++) {
          g.lineStyle(10 - i * 1.5, i < 2 ? 0xffffff : c.main, (1 - k * 0.6) * (1 - i * 0.14));
          g.beginPath();
          g.arc(at.x, cy, radius - i * 2, a0 - 1.6 + i * 0.12, a0, false);
          g.strokePath();
        }
      },
      onComplete: () => this.tweens.add({ targets: g, alpha: 0, duration: 140, onComplete: () => g.destroy() }),
    });
    const ring = this.add.ellipse(at.x, at.y, radius * 2.4, radius * 1.2, undefined).setStrokeStyle(3, c.light, 0.8).setDepth(this.depth).setScale(0.3);
    this.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 380, onComplete: () => ring.destroy() });
  }

  /** A ground shockwave (power strikes, buffs). */
  shockwave(at: Spot, c: SpellColors, radius: number): void {
    const ring = this.add.ellipse(at.x, at.y, radius * 2, radius, undefined).setStrokeStyle(4, c.main, 0.95).setDepth(this.depth).setScale(0.15).setBlendMode(Phaser.BlendModes.ADD);
    const ring2 = this.add.ellipse(at.x, at.y, radius * 1.5, radius * 0.75, undefined).setStrokeStyle(2, c.light, 0.9).setDepth(this.depth).setScale(0.15).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: [ring, ring2], scale: 1, alpha: 0, duration: 420, ease: 'Cubic.easeOut', onComplete: () => [ring, ring2].forEach((r) => r.destroy()) });
    this.glow(at.x, at.y - 4, c.main, radius * 0.8, 0.6, 400);
  }

  // ---------------------------------------------------------------------------
  // Text
  // ---------------------------------------------------------------------------

  /** "Fireball!" over the caster (once per cast, even for area skills). */
  callout(casterId: string, at: Spot, text: string, c: SpellColors): void {
    const now = this.scene.time.now;
    if ((this.called.get(casterId) ?? 0) > now) return;
    this.called.set(casterId, now + 700);
    const t = this.add
      .text(at.x, at.y - at.h - 24, text, { fontFamily: this.font, fontSize: `${Math.round(17 * this.textScale)}px`, fontStyle: 'bold', color: c.css, stroke: '#04161f', strokeThickness: 5 })
      .setShadow(0, 0, c.css, 10, true, true)
      .setOrigin(0.5, 1)
      .setResolution(TEXT_RES)
      .setDepth(this.depth + 40)
      .setScale(0.5);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, delay: 750, duration: 350, onComplete: () => t.destroy() });
  }

  /**
   * Big chunky damage numbers: gold for your hits, a starburst behind crits,
   * red for damage you take, green heals. They pop, bounce, stack and float away.
   */
  number(targetId: string, at: Spot, amount: number, kind: 'hit' | 'crit' | 'miss' | 'heal' | 'dot' | 'taken' | 'other', opts: { pet?: boolean } = {}): void {
    const now = this.scene.time.now;
    const st = this.stack.get(targetId);
    const n = st && now - st.at < 600 ? st.n + 1 : 0;
    this.stack.set(targetId, { n, at: now });
    const x = at.x + (n % 2 ? 14 : -10) + (Math.random() * 10 - 5);
    const y = at.y - at.h - 2 - (n % 5) * 20 * this.textScale;
    const crit = kind === 'crit';
    const size = crit ? 40 : kind === 'other' ? 17 : kind === 'taken' ? 24 : kind === 'miss' ? 17 : kind === 'dot' ? 18 : opts.pet ? 20 : 28;
    const scaled = Math.round(size * this.textScale);
    const text = kind === 'miss' ? 'Miss' : kind === 'heal' ? `+${amount.toLocaleString()}` : crit ? `${amount.toLocaleString()}!` : amount.toLocaleString();
    // Miss / Lucky use a flowing cursive face; everything else the rounded display face.
    const face = kind === 'miss' ? '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' : this.font;
    const t = this.add
      .text(x, y, text, { fontFamily: face, fontSize: `${kind === 'miss' ? Math.round(scaled * 1.35) : scaled}px`, fontStyle: kind === 'miss' ? 'italic bold' : 'bold', color: '#ffffff', stroke: crit ? '#3a1600' : '#0a0f22', strokeThickness: crit ? 8 : 5 })
      .setOrigin(0.5, 1)
      .setResolution(TEXT_RES)
      .setDepth(this.depth + 30 + n * 0.01);
    t.setShadow(0, 3, '#000000', 0, true, false);
    // Gradient fills: gold for your hits, white for others, red for damage taken, green heals.
    const stops: Record<string, string[]> = {
      hit: ['#ffffff', '#ffffff', '#dfe6ff', '#ffffff'],
      crit: ['#fffbe0', '#ffe066', '#ffaa00', '#ffd23a'],
      taken: ['#ffd0c8', '#ff6a5a', '#c8282a', '#ff8a7a'],
      heal: ['#e8ffd8', '#8af06a', '#2fa83a', '#a8ff8a'],
      dot: ['#f0ffd0', '#b6f06a', '#6aa82a', '#c8f88a'],
      other: ['#ffffff', '#e8e8e8', '#b8b8c0', '#f0f0f0'],
      miss: ['#e8f4ff', '#bcd8ff', '#8fb0e8', '#d8ecff'],
    };
    const ctx = t.context;
    const gr = ctx.createLinearGradient(0, t.height * 0.15, 0, t.height * 0.85);
    (stops[kind] ?? stops.hit!).forEach((col, i, arr) => gr.addColorStop(i / (arr.length - 1), col));
    t.setFill(gr);
    let burst: Phaser.GameObjects.Graphics | null = null;
    if (crit) {
      burst = this.add.graphics().setDepth(t.depth - 0.5).setPosition(x, y - t.displayHeight * 0.5);
      const pts = (R: number, r: number) => {
        const out: Phaser.Math.Vector2[] = [];
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * TAU + 0.2;
          const rr = i % 2 ? r * (0.85 + Math.random() * 0.3) : R * (0.85 + Math.random() * 0.3);
          out.push(new Phaser.Math.Vector2(Math.cos(a) * rr, Math.sin(a) * rr * 0.7));
        }
        return out;
      };
      const w = Math.max(60, t.width * 0.5);
      burst.fillStyle(0xff8a1c, 0.92).fillPoints(pts(w * 0.95, w * 0.45), true);
      burst.lineStyle(3, 0x5a2400, 1).strokePoints(pts(w * 0.95, w * 0.45), true);
      burst.fillStyle(0xffd23a, 0.95).fillPoints(pts(w * 0.62, w * 0.32), true);
      burst.setScale(0.2);
      this.tweens.add({ targets: burst, scale: 1, angle: 8, duration: 120, ease: 'Back.easeOut' });
      this.tweens.add({ targets: burst, alpha: 0, delay: 520, duration: 260, onComplete: () => burst?.destroy() });
      this.glow(x, y - t.displayHeight * 0.5, 0xffc04a, w, 0.5, 500, t.depth - 1);
    }
    // pop, bounce, hold, float away
    t.setScale(0.3);
    this.tweens.add({
      targets: t,
      scale: crit ? 1.25 : 1.12,
      duration: 90,
      ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({ targets: t, scale: 1, duration: 90 }),
    });
    this.tweens.add({ targets: t, y: y - (crit ? 30 : 22), alpha: 0, delay: crit ? 650 : 480, duration: 420, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
  }
}
