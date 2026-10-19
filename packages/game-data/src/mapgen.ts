import { PROP_TYPES, TILE_SIZE, type MapDef, type MapObject, type NodePlacement, type PropType } from '@terrago/shared';

/**
 * Map building toolkit. Used by scripts/generate-maps.ts to write the
 * hand-laid maps to JSON, and at runtime (client and server alike) to
 * generate procedural maps such as Irondeep Mine's floors from a seed —
 * identical output everywhere, so no map data needs to be shipped for them.
 */

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOCKING = new Set(['~', 'w', '#', 'r', 'I', 'L', 'q']);

export class MapBuilder {
  grid: string[][];
  objects: MapObject[] = [];
  nodes: NodePlacement[] = [];
  /** Tiles that must stay clear of scatter (roads, doors, NPC spots...). */
  reserved: boolean[][];
  occupied: boolean[][];
  private nodeSeq = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    fill = '.',
  ) {
    this.grid = Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
    this.reserved = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
    this.occupied = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
  }

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  tile(x: number, y: number): string {
    return this.inside(x, y) ? this.grid[y]![x]! : '#';
  }

  rect(x: number, y: number, w: number, h: number, tile: string, reserve = true) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        if (!this.inside(i, j)) continue;
        this.grid[j]![i] = tile;
        if (reserve) this.reserved[j]![i] = true;
      }
  }

  reserve(x: number, y: number, w = 1, h = 1) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.inside(i, j)) this.reserved[j]![i] = true;
  }

  free(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        if (!this.inside(i, j) || this.occupied[j]![i] || this.reserved[j]![i]) return false;
        if (BLOCKING.has(this.grid[j]![i]!)) return false;
      }
    return true;
  }

  occupy(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.inside(i, j)) this.occupied[j]![i] = true;
  }

  prop(type: PropType, x: number, y: number, text?: string) {
    const d = PROP_TYPES[type];
    this.objects.push(text ? { kind: 'prop', type, x, y, text } : { kind: 'prop', type, x, y });
    this.occupy(x, y, d.w, d.h);
  }

  /** Place a prop only if its footprint is free. */
  tryProp(type: PropType, x: number, y: number) {
    const d = PROP_TYPES[type];
    if (!this.free(x, y, d.w, d.h)) return false;
    this.prop(type, x, y);
    return true;
  }

  /** Place a prop that must fit; throws during generation if the spot is taken. */
  station(type: PropType, x: number, y: number) {
    const d = PROP_TYPES[type];
    for (let j = y; j < y + d.h; j++)
      for (let i = x; i < x + d.w; i++)
        if (!this.inside(i, j) || this.occupied[j]![i] || BLOCKING.has(this.grid[j]![i]!)) throw new Error(`${type} at ${x},${y} overlaps something`);
    this.prop(type, x, y);
    this.reserve(x - 1, y - 1, d.w + 2, d.h + 2);
  }

  building(id: string, name: string, x: number, y: number, w: number, h: number, roof: string, wall: string, doorX: number) {
    this.objects.push({ kind: 'building', id, name, x, y, w, h, roof, wall, doorX });
    this.occupy(x, y, w, h);
    this.reserve(x + doorX, y + h, 1, 1);
    this.reserve(x - 1, y - 1, w + 2, h + 2);
  }

  /** A gatherable node at a tile (rock, tree, herb...). */
  node(type: string, x: number, y: number, solid: boolean) {
    this.nodes.push({ id: `n${this.nodeSeq++}`, type, x, y, solid });
    this.occupy(x, y, 1, 1);
  }

  tryNode(type: string, x: number, y: number, solid: boolean, margin = 1) {
    if (!this.free(x - margin, y - margin, 1 + margin * 2, 1 + margin * 2)) return false;
    if (BLOCKING.has(this.grid[y]![x]!)) return false;
    this.node(type, x, y, solid);
    return true;
  }

  scatterNodes(r: () => number, types: { type: string; solid: boolean; weight: number }[], count: number, area = { x: 0, y: 0, w: this.width, h: this.height }, onTiles?: string) {
    const total = types.reduce((n, t) => n + t.weight, 0);
    let placed = 0;
    for (let attempt = 0; attempt < count * 60 && placed < count; attempt++) {
      const x = area.x + Math.floor(r() * area.w);
      const y = area.y + Math.floor(r() * area.h);
      if (onTiles && !onTiles.includes(this.tile(x, y))) continue;
      let pick = r() * total;
      const t = types.find((tt) => (pick -= tt.weight) < 0) ?? types[0]!;
      if (this.tryNode(t.type, x, y, t.solid)) placed++;
    }
    return placed;
  }

  /** Irregular border of props (trees, rocks...), leaving gaps where roads exit. */
  border(r: () => number, minDepth: number, maxDepth: number, gaps: { side: 'n' | 's' | 'e' | 'w'; from: number; to: number }[], props: PropType[]) {
    const isGap = (side: 'n' | 's' | 'e' | 'w', pos: number) => gaps.some((g) => g.side === side && pos >= g.from && pos <= g.to);
    const depthAt = (pos: number, salt: number) => minDepth + Math.floor(((Math.sin(pos * 0.7 + salt) + Math.sin(pos * 0.23 + salt * 2)) / 4 + 0.5) * (maxDepth - minDepth + 1));
    const put = (x: number, y: number) => {
      if (this.occupied[y]![x] || this.reserved[y]![x]) return;
      this.prop(props[Math.floor(r() * props.length)]!, x, y);
    };
    for (let x = 0; x < this.width; x++) {
      const dn = depthAt(x, 1);
      const ds = depthAt(x, 5);
      for (let y = 0; y < dn; y++) if (!isGap('n', x)) put(x, y);
      for (let y = this.height - ds; y < this.height; y++) if (!isGap('s', x)) put(x, y);
    }
    for (let y = 0; y < this.height; y++) {
      const dw = depthAt(y, 9);
      const de = depthAt(y, 13);
      for (let x = 0; x < dw; x++) if (!isGap('w', y)) put(x, y);
      for (let x = this.width - de; x < this.width; x++) if (!isGap('e', y)) put(x, y);
    }
  }

  /** Classic forest border (pines and oaks). */
  forestBorder(r: () => number, minDepth: number, maxDepth: number, gaps: { side: 'n' | 's' | 'e' | 'w'; from: number; to: number }[]) {
    this.border(r, minDepth, maxDepth, gaps, ['tree_pine', 'tree_pine', 'tree_oak']);
  }

  scatterGround(r: () => number, chance: number, tile: string, on = '.') {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y]![x] === on && !this.reserved[y]![x] && r() < chance) this.grid[y]![x] = tile;
      }
  }

  scatterProps(r: () => number, types: PropType[], count: number, area = { x: 0, y: 0, w: this.width, h: this.height }, onTiles = '.,*') {
    let placed = 0;
    for (let attempt = 0; attempt < count * 40 && placed < count; attempt++) {
      const x = area.x + Math.floor(r() * area.w);
      const y = area.y + Math.floor(r() * area.h);
      const t = types[Math.floor(r() * types.length)]!;
      const d = PROP_TYPES[t];
      if (!this.free(x - 1, y - 1, d.w + 2, d.h + 2)) continue;
      if (!onTiles.includes(this.grid[y]![x]!)) continue;
      this.prop(t, x, y);
      placed++;
    }
  }

  /** Winding water course (a stream) between two points. */
  stream(r: () => number, x0: number, y0: number, x1: number, y1: number, width = 2) {
    let x = x0;
    let y = y0;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      x = Math.round(x0 + (x1 - x0) * t + Math.sin(t * 9 + x0) * 2 * (r() * 0.5 + 0.5));
      y = Math.round(y0 + (y1 - y0) * t + Math.cos(t * 7 + y0) * 2 * (r() * 0.5 + 0.5));
      for (let j = 0; j < width; j++)
        for (let k = 0; k < width; k++) if (this.inside(x + j, y + k) && !this.reserved[y + k]![x + j]) this.grid[y + k]![x + j] = 'w';
    }
  }

  toMap(meta: Omit<MapDef, 'width' | 'height' | 'tileSize' | 'tiles' | 'objects'>): MapDef {
    return {
      ...meta,
      width: this.width,
      height: this.height,
      tileSize: TILE_SIZE,
      tiles: this.grid.map((row) => row.join('')),
      objects: this.objects,
      ...(this.nodes.length ? { nodes: this.nodes } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Irondeep Mine floors — generated at runtime from the floor number
// ---------------------------------------------------------------------------

export const MINE_FLOORS = 40;
export const MINE_PREFIX = 'irondeep_';

export function mineFloorId(n: number): string {
  return `${MINE_PREFIX}${n}`;
}

export function mineFloorNumber(mapId: string): number | null {
  if (!mapId.startsWith(MINE_PREFIX)) return null;
  const n = Number(mapId.slice(MINE_PREFIX.length));
  return Number.isInteger(n) && n >= 1 && n <= MINE_FLOORS ? n : null;
}

interface Band {
  upTo: number;
  ores: { type: string; weight: number }[];
}

const BANDS: Band[] = [
  { upTo: 5, ores: [{ type: 'rock_stone', weight: 5 }, { type: 'rock_copper', weight: 5 }, { type: 'rock_coal', weight: 2 }] },
  { upTo: 10, ores: [{ type: 'rock_iron', weight: 5 }, { type: 'rock_copper', weight: 2 }, { type: 'rock_coal', weight: 3 }, { type: 'rock_stone', weight: 2 }] },
  { upTo: 20, ores: [{ type: 'rock_silver', weight: 5 }, { type: 'rock_iron', weight: 3 }, { type: 'rock_coal', weight: 3 }] },
  { upTo: 30, ores: [{ type: 'rock_gold', weight: 5 }, { type: 'rock_silver', weight: 2 }, { type: 'rock_coal', weight: 3 }] },
  { upTo: 40, ores: [{ type: 'rock_mithril', weight: 4 }, { type: 'rock_crystal', weight: 3 }, { type: 'rock_gold', weight: 2 }, { type: 'rock_coal', weight: 2 }] },
];

const MINE_W = 38;
const MINE_H = 30;

/** Ladder rows for a floor (separate seed so neighbouring floors can link without generating each other). */
export function ladderRowsFor(n: number): { up: number; down: number } {
  const lr = rng(424_242 + n * 31);
  return { up: 4 + Math.floor(lr() * (MINE_H - 10)), down: 4 + Math.floor(lr() * (MINE_H - 10)) };
}

/** A cave floor: cellular-automata caverns, ladders up and down, ore by depth. */
export function generateMineFloor(n: number): MapDef {
  const W = MINE_W;
  const H = MINE_H;
  const r = rng(9001 + n * 7919);
  const m = new MapBuilder(W, H, 'r');

  // Cellular automata caverns.
  let cells = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 ? 1 : r() < 0.43 ? 1 : 0)));
  for (let it = 0; it < 5; it++) {
    cells = cells.map((row, y) =>
      row.map((v, x) => {
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return 1;
        let walls = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) walls += cells[y + j]?.[x + i] ?? 1;
        return walls >= 5 ? 1 : 0;
      }),
    );
  }
  // Guarantee a connected spine from the up-ladder (left) to the down-ladder (right).
  const { up: upY, down: downY } = ladderRowsFor(n);
  let cy = upY;
  for (let x = 3; x <= W - 4; x++) {
    const target = upY + ((downY - upY) * (x - 3)) / (W - 7);
    cy += Math.sign(target - cy) * (r() < 0.7 ? 1 : 0);
    cy = Math.max(3, Math.min(H - 4, cy));
    for (let j = -1; j <= 1; j++) for (let i = 0; i <= 1; i++) cells[cy + j]![x + i] = 0;
  }
  // Join the spine's end to the down-ladder row, and open both ladder alcoves.
  for (let y = Math.min(cy, downY); y <= Math.max(cy, downY); y++) for (let x = W - 6; x <= W - 5; x++) cells[y]![x] = 0;
  for (let j = -1; j <= 1; j++) {
    for (let x = 2; x <= 5; x++) cells[upY + j]![x] = 0;
    for (let x = W - 6; x <= W - 3; x++) cells[downY + j]![x] = 0;
  }
  // Keep only the floor region connected to the up-ladder.
  const reach = Array.from({ length: H }, () => Array.from({ length: W }, () => false));
  const stack: [number, number][] = [[3, upY]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= W || y >= H || reach[y]![x] || cells[y]![x]) continue;
    reach[y]![x] = true;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.grid[y]![x] = reach[y]![x] ? 'c' : 'r';

  // Underground pools on some floors (cave fishing).
  if (n % 3 === 0) {
    for (let tries = 0; tries < 40; tries++) {
      const px = 8 + Math.floor(r() * (W - 16));
      const py = 4 + Math.floor(r() * (H - 10));
      let ok = true;
      for (let j = -1; j <= 3; j++) for (let i = -1; i <= 4; i++) if (m.tile(px + i, py + j) !== 'c') ok = false;
      if (!ok || Math.abs(py - upY) < 3) continue;
      m.rect(px, py, 4, 3, 'w', true);
      break;
    }
  }

  const upX = 3;
  const downX = W - 4;
  m.prop('ladder_up', upX - 1, upY);
  m.reserve(upX - 2, upY - 2, 5, 5);
  m.prop('ladder_down', downX + 1, downY);
  m.reserve(downX - 1, downY - 2, 4, 5);
  m.prop('torch', upX - 1, upY - 2);
  if (m.tile(upX - 1, upY - 2) !== 'c') m.grid[upY - 2]![upX - 1] = 'c';

  const band = BANDS.find((b) => n <= b.upTo) ?? BANDS[BANDS.length - 1]!;
  const ores = band.ores.map((o) => ({ ...o, solid: true }));
  m.scatterNodes(r, ores, 16 + Math.floor(n / 4), undefined, 'c');
  if (n >= 4) m.scatterNodes(r, [{ type: 'plant_glowcap', solid: false, weight: 1 }], 2, undefined, 'c');
  if (n >= 35 && r() < 0.5) m.scatterNodes(r, [{ type: 'rock_starmetal', solid: true, weight: 1 }], 1, undefined, 'c');
  m.scatterProps(r, ['stalagmite', 'stalagmite', 'bones', 'crystal'], 8 + Math.floor(n / 5), undefined, 'c');

  const portals: MapDef['portals'] = [
    n === 1
      ? { id: 'up', x: upX - 1, y: upY, w: 1, h: 1, to: 'irondeep_entrance', toX: 20, toY: 10, toDir: 'down', label: 'Surface' }
      : { id: 'up', x: upX - 1, y: upY, w: 1, h: 1, to: mineFloorId(n - 1), toX: downX - 1, toY: ladderRowsFor(n - 1).down, toDir: 'left', label: `Floor ${n - 1}` },
  ];
  if (n < MINE_FLOORS) portals.push({ id: 'down', x: downX + 1, y: downY, w: 1, h: 1, to: mineFloorId(n + 1), toX: upX + 1, toY: ladderRowsFor(n + 1).up, toDir: 'right', label: `Floor ${n + 1}` });

  const map = m.toMap({
    id: mineFloorId(n),
    name: `Irondeep Mine — Floor ${n}`,
    safeZone: false,
    music: 'cave',
    spawn: { x: upX + 1, y: upY, dir: 'right' },
    portals,
    fishing: 'cave',
    theme: 'cave',
    levels: [Math.max(1, n), n + 5],
    respawn: { mapId: 'irondeep_entrance', x: 20, y: 11 },
  });
  return map;
}

