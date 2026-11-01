/**
 * SPEC.md section 7: "Minimap (top right) showing Waystones and portals."
 * A small top-down canvas scaled to the current map's tile grid - redrawn
 * whenever Hud's entity signals fire, which at M1's entity counts is
 * cheap enough to just redraw wholesale rather than diffing.
 */
import type { MapDef } from '@terago/shared';

const SIZE_PX = 120;

export interface MinimapPoint {
  x: number;
  y: number;
}

export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'interactive terago-glass terago-hud-minimap';
    this.root.innerHTML = `<canvas width="${SIZE_PX}" height="${SIZE_PX}"></canvas>`;
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
  }

  update(map: MapDef, playerPos: MinimapPoint, otherPlayerPositions: readonly MinimapPoint[]): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const scale = SIZE_PX / Math.max(map.width, map.height);
    const offsetX = (SIZE_PX - map.width * scale) / 2;
    const offsetY = (SIZE_PX - map.height * scale) / 2;
    const toCanvas = (p: MinimapPoint) => ({ x: offsetX + p.x * scale, y: offsetY + p.y * scale });

    ctx.clearRect(0, 0, SIZE_PX, SIZE_PX);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(offsetX, offsetY, map.width * scale, map.height * scale);

    for (const portal of map.portals) {
      const p = toCanvas(portal.at);
      ctx.fillStyle = '#4fd1e0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (map.waystone) {
      const p = toCanvas(map.waystone);
      ctx.fillStyle = '#e0c23c';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }

    for (const other of otherPlayerPositions) {
      const p = toCanvas(other);
      ctx.fillStyle = 'rgba(240,233,255,0.65)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    const self = toCanvas(playerPos);
    ctx.fillStyle = '#5fd15f';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(self.x, self.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  destroy(): void {
    this.root.remove();
  }
}
