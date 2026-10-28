/**
 * Phaser side of the HD sprites: bakes sheets on demand (one at a time, in
 * the background), turns them into textures with numbered frames, and frees
 * the ones nobody has used for a while.
 */
import type Phaser from 'phaser';
import { frameXY, type Sheet } from './baker';

export interface SheetInfo {
  /** Texture px per frame. */
  fw: number;
  fh: number;
  cols: number;
  rows: number;
  /** Extra data from the baker (frame size and foot in world px). */
  meta?: Record<string, number>;
}

export class HdSheets {
  private pending = new Map<string, Promise<boolean>>();
  private info = new Map<string, SheetInfo>();
  private lastUsed = new Map<string, number>();
  private failed = new Set<string>();

  constructor(private scene: Phaser.Scene) {}

  get(key: string): SheetInfo | undefined {
    if (!this.scene.textures.exists(key)) return undefined;
    this.lastUsed.set(key, performance.now());
    return this.info.get(key);
  }

  /** Start baking `key` unless it exists, is baking or failed. Resolves true when ready. */
  ensure(key: string, make: () => Promise<Sheet & { foot?: number; w?: number; h?: number; ox?: number; oy?: number; top?: number }>): Promise<boolean> {
    if (this.scene.textures.exists(key)) return Promise.resolve(true);
    if (this.failed.has(key)) return Promise.resolve(false);
    let p = this.pending.get(key);
    if (p) return p;
    p = make()
      .then((sh) => {
        const tm = this.scene.sys?.textures;
        if (!tm || tm.exists(key)) return !!tm;
        const tex = tm.addCanvas(key, sh.canvas);
        if (!tex) return false;
        for (let i = 0; i < sh.rows * sh.cols; i++) {
          const at = frameXY(sh, i);
          tex.add(i, 0, at.x, at.y, sh.fw, sh.fh);
        }
        tex.setFilter(1 /* LINEAR */);
        const meta: Record<string, number> = {};
        for (const k of ['foot', 'w', 'h', 'ox', 'oy', 'top'] as const) if (typeof sh[k] === 'number') meta[k] = sh[k];
        this.info.set(key, { fw: sh.fw, fh: sh.fh, cols: sh.cols, rows: sh.rows, meta });
        this.lastUsed.set(key, performance.now());
        return true;
      })
      .catch((e) => {
        console.warn('[hd] bake failed', key, e);
        this.failed.add(key);
        return false;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  /** Drop sheets unused for `ms` (keeps GPU memory bounded). */
  sweep(ms: number, keep: (key: string) => boolean): void {
    const now = performance.now();
    for (const [k, t] of this.lastUsed) {
      if (now - t < ms || keep(k)) continue;
      this.lastUsed.delete(k);
      this.info.delete(k);
      if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    }
  }
}
