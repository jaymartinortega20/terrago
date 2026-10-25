'use client';

import { useEffect, useRef } from 'react';
import { npcsForMap } from '@terrago/game-data';
import { TILE_SIZE, type MapDef } from '@terrago/shared';
import { renderGround } from '../art/world';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

const PX = 3; // pixels per tile on the minimap
const W = 160;
const H = 120;

const overviews = new Map<string, HTMLCanvasElement>();

/** The whole map, small: ground, buildings and trees (cached per map). */
function overview(map: MapDef): HTMLCanvasElement {
  const hit = overviews.get(map.id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = map.width * PX;
  c.height = map.height * PX;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.drawImage(renderGround(map), 0, 0, c.width, c.height);
  for (const o of map.objects) {
    if (o.kind === 'building') {
      g.fillStyle = o.roof;
      g.fillRect(o.x * PX, o.y * PX, o.w * PX, o.h * PX);
      g.strokeStyle = '#1a1420';
      g.strokeRect(o.x * PX + 0.5, o.y * PX + 0.5, o.w * PX - 1, o.h * PX - 1);
    } else if (o.type.startsWith('tree')) {
      g.fillStyle = '#2f6b35';
      g.fillRect(o.x * PX, o.y * PX, PX, PX);
    }
  }
  for (const p of map.portals ?? []) {
    g.fillStyle = '#7ad8ff';
    g.fillRect(p.x * PX - 1, p.y * PX - 1, PX + 2, PX + 2);
  }
  overviews.set(map.id, c);
  return c;
}

/**
 * Corner minimap: centred on you, with monsters (red), townsfolk (yellow),
 * other players (blue), your party (green) and you (gold). Click for the big map.
 */
export function Minimap({ client, onOpen }: { client: GameClient; onOpen: () => void }) {
  const mapId = useStore(client.ui, (s) => s.mapId);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const map = client.map;
    const cv = ref.current;
    if (!map || !cv) return;
    const g = cv.getContext('2d')!;
    const bg = overview(map);
    const npcs = npcsForMap(map.id);
    const draw = () => {
      const px = (client.pos.x / TILE_SIZE) * PX;
      const py = (client.pos.y / TILE_SIZE) * PX;
      const ox = Math.max(0, Math.min(bg.width - W, px - W / 2));
      const oy = Math.max(0, Math.min(bg.height - H, py - H / 2));
      g.fillStyle = '#0b0d15';
      g.fillRect(0, 0, W, H);
      g.drawImage(bg, ox, oy, W, H, 0, 0, W, H);
      const dot = (x: number, y: number, color: string, r = 2) => {
        const sx = (x / TILE_SIZE) * PX - ox;
        const sy = (y / TILE_SIZE) * PX - oy;
        if (sx < -3 || sy < -3 || sx > W + 3 || sy > H + 3) return;
        g.fillStyle = '#0b0d15';
        g.fillRect(Math.round(sx) - r - 1, Math.round(sy) - r - 1, r * 2 + 2, r * 2 + 2);
        g.fillStyle = color;
        g.fillRect(Math.round(sx) - r, Math.round(sy) - r, r * 2, r * 2);
      };
      for (const n of npcs) dot((n.x + 0.5) * TILE_SIZE, (n.y + 0.5) * TILE_SIZE, '#ffe14a');
      for (const m of client.monsters.values()) if (m.hp > 0) dot(m.x, m.y, m.info.boss ? '#ff3a8a' : '#ff5a4a', m.info.boss ? 3 : 1.5);
      const party = new Set(client.ui.get().party?.members.map((x) => x.id) ?? []);
      for (const r of client.remotes.values()) dot(r.x, r.y, party.has(r.info.id) ? '#7cf06a' : '#6ab4ff');
      dot(client.pos.x, client.pos.y, '#ffffff', 3);
      dot(client.pos.x, client.pos.y, '#f2c14e', 2);
    };
    draw();
    const t = setInterval(draw, 200);
    return () => clearInterval(t);
  }, [client, mapId]);
  if (!mapId) return null;
  return (
    <button
      className="pointer-events-auto relative overflow-hidden rounded-xl"
      style={{ width: W, height: H, boxShadow: '0 0 0 2px #2a1a08, 0 0 0 4px #e8c060, 0 4px 12px rgba(0,0,0,0.5)' }}
      onClick={onOpen}
      title="Open the map (M)"
      aria-label="Minimap — open the map"
      data-testid="minimap"
    >
      <canvas ref={ref} width={W} height={H} className="block" style={{ imageRendering: 'pixelated' }} />
    </button>
  );
}
