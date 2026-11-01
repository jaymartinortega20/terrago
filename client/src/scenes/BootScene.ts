/**
 * Generates every placeholder texture (SPEC.md section 4: "the loading bar
 * fills to 100%") before anything else can run - LoginScene is the first
 * scene that needs real art (its background), so nothing starts until
 * every canvas in the manifest has been drawn and registered.
 */
import Phaser from 'phaser';
import { listAllAssetEntries, type AssetEntry } from '../assets/manifest.js';
import { registerPaperDollAnimations } from '../assets/paperDollAnims.js';

/** How many textures to generate per `update()` tick - small enough that
 * even the heaviest single draw (an intro background) never stalls a
 * frame long enough to look frozen, since the progress bar should
 * visibly move rather than jump straight to 100%. */
const ENTRIES_PER_TICK = 24;

export class BootScene extends Phaser.Scene {
  private entries: AssetEntry[] = [];
  private cursor = 0;
  private barBg!: Phaser.GameObjects.Graphics;
  private barFill!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.Text;
  private done = false;

  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0a0710');

    this.add
      .text(width / 2, height / 2 - 60, 'TERAGO ONLINE', {
        fontFamily: 'Georgia, serif',
        fontSize: '36px',
        color: '#e8d9ff',
      })
      .setOrigin(0.5);

    const barWidth = Math.min(420, width * 0.7);
    const barX = width / 2 - barWidth / 2;
    const barY = height / 2;

    this.barBg = this.add.graphics();
    this.barBg.fillStyle(0x241c32, 1).fillRoundedRect(barX, barY, barWidth, 14, 7);
    this.barFill = this.add.graphics();
    this.label = this.add
      .text(width / 2, barY + 30, 'Preparing the world... 0%', { fontFamily: 'sans-serif', fontSize: '14px', color: '#b8a8d0' })
      .setOrigin(0.5);

    this.data.set('barGeom', { x: barX, y: barY, width: barWidth, height: 14 });

    this.entries = listAllAssetEntries();
    this.cursor = 0;
  }

  update(): void {
    if (this.done) return;

    const end = Math.min(this.cursor + ENTRIES_PER_TICK, this.entries.length);
    for (let i = this.cursor; i < end; i++) {
      const entry = this.entries[i]!;
      if (this.textures.exists(entry.key)) continue; // a dev hot-reload re-running create() shouldn't double-register
      const canvas = document.createElement('canvas');
      canvas.width = entry.width;
      canvas.height = entry.height;
      const ctx = canvas.getContext('2d');
      if (ctx) entry.draw(ctx);
      this.textures.addCanvas(entry.key, canvas);
    }
    this.cursor = end;

    const pct = this.entries.length === 0 ? 1 : this.cursor / this.entries.length;
    this.drawProgress(pct);

    if (this.cursor >= this.entries.length) {
      this.finish();
    }
  }

  private drawProgress(pct: number): void {
    const geom = this.data.get('barGeom') as { x: number; y: number; width: number; height: number };
    this.barFill.clear();
    this.barFill.fillStyle(0x8a5fe0, 1).fillRoundedRect(geom.x, geom.y, Math.max(geom.height, geom.width * pct), geom.height, 7);
    this.label.setText(`Preparing the world... ${Math.round(pct * 100)}%`);
  }

  private finish(): void {
    this.done = true;
    registerPaperDollAnimations(this);
    this.scene.start('Login');
  }
}
