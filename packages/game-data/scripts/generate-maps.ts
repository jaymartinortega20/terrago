/**
 * Generates the v0.1 maps (Greenhaven, Sunfield Plains) as JSON.
 *
 *   npm run maps:generate
 *
 * Layout is explicit (buildings, roads, plaza); only decorative scatter uses a
 * seeded RNG, so output is identical on every run. The JSON is the source the
 * game loads; regenerate after editing, or replace with Tiled maps later.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROP_TYPES, TILE_SIZE, validateMapDef, type MapDef, type MapObject, type PropType } from '@terrago/shared';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'maps');

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MapBuilder {
  grid: string[][];
  objects: MapObject[] = [];
  /** Tiles that must stay clear of scatter (roads, doors, NPC spots...). */
  reserved: boolean[][];
  occupied: boolean[][];

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
        const t = this.grid[j]![i]!;
        if (t === '~' || t === 'w' || t === '#') return false;
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

  building(id: string, name: string, x: number, y: number, w: number, h: number, roof: string, wall: string, doorX: number) {
    this.objects.push({ kind: 'building', id, name, x, y, w, h, roof, wall, doorX });
    this.occupy(x, y, w, h);
    // Keep the tile in front of the door walkable and clear.
    this.reserve(x + doorX, y + h, 1, 1);
    // A little margin so scatter doesn't hug walls.
    this.reserve(x - 1, y - 1, w + 2, h + 2);
  }

  /** Irregular forest border, leaving gaps where roads exit. */
  forestBorder(r: () => number, minDepth: number, maxDepth: number, gaps: { side: 'n' | 's' | 'e' | 'w'; from: number; to: number }[]) {
    const isGap = (side: 'n' | 's' | 'e' | 'w', pos: number) => gaps.some((g) => g.side === side && pos >= g.from && pos <= g.to);
    const depthAt = (pos: number, salt: number) => minDepth + Math.floor(((Math.sin(pos * 0.7 + salt) + Math.sin(pos * 0.23 + salt * 2)) / 4 + 0.5) * (maxDepth - minDepth + 1));
    for (let x = 0; x < this.width; x++) {
      const dn = depthAt(x, 1);
      const ds = depthAt(x, 5);
      for (let y = 0; y < dn; y++) if (!isGap('n', x)) this.borderTree(r, x, y);
      for (let y = this.height - ds; y < this.height; y++) if (!isGap('s', x)) this.borderTree(r, x, y);
    }
    for (let y = 0; y < this.height; y++) {
      const dw = depthAt(y, 9);
      const de = depthAt(y, 13);
      for (let x = 0; x < dw; x++) if (!isGap('w', y)) this.borderTree(r, x, y);
      for (let x = this.width - de; x < this.width; x++) if (!isGap('e', y)) this.borderTree(r, x, y);
    }
  }

  private borderTree(r: () => number, x: number, y: number) {
    if (this.occupied[y]![x] || this.reserved[y]![x]) return;
    this.prop(r() < 0.55 ? 'tree_pine' : 'tree_oak', x, y);
  }

  scatterGround(r: () => number, chance: number, tile: string, on = '.') {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y]![x] === on && !this.reserved[y]![x] && r() < chance) this.grid[y]![x] = tile;
      }
  }

  scatterProps(r: () => number, types: PropType[], count: number, area = { x: 0, y: 0, w: this.width, h: this.height }) {
    let placed = 0;
    for (let attempt = 0; attempt < count * 40 && placed < count; attempt++) {
      const x = area.x + Math.floor(r() * area.w);
      const y = area.y + Math.floor(r() * area.h);
      const t = types[Math.floor(r() * types.length)]!;
      // Keep a 1-tile breathing gap around scattered props.
      const d = PROP_TYPES[t];
      if (!this.free(x - 1, y - 1, d.w + 2, d.h + 2)) continue;
      const g = this.grid[y]![x]!;
      if (!'.,*'.includes(g)) continue;
      this.prop(t, x, y);
      placed++;
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
    };
  }
}

function greenhaven(): MapDef {
  const W = 64;
  const H = 48;
  const r = rng(20261019);
  const m = new MapBuilder(W, H);

  // --- Roads and plaza ---------------------------------------------------
  m.rect(30, 0, 4, 16, '='); // north road (to Irondeep, closed)
  m.rect(30, 30, 4, 18, '='); // south road to Sunfield gate
  m.rect(0, 21, 22, 4, '='); // west road (to Whisperwood, closed)
  m.rect(42, 21, 22, 4, '='); // east road (to Crystal Lake, closed)
  m.rect(22, 16, 20, 14, ':'); // central cobblestone plaza
  m.rect(27, 19, 10, 8, '_'); // inner plaza ring around the fountain

  // Door paths
  m.rect(19, 11, 1, 10, '='); // tavern
  m.rect(40, 11, 1, 5, '='); // guild hall
  m.rect(52, 11, 1, 10, '='); // bank
  m.rect(12, 20, 1, 1, '='); // general store
  m.rect(47, 20, 1, 1, '='); // blacksmith
  m.rect(14, 34, 1, 2, '='); // farm supply
  m.rect(14, 35, 16, 1, '='); // farm supply -> south road
  m.rect(16, 36, 1, 3, '='); // teleport station spur

  // Marketplace square (east, below the road)
  m.rect(43, 25, 16, 9, ':');

  // Pond with a little dock (south-east)
  m.rect(47, 37, 11, 7, '~', true);
  m.rect(46, 38, 1, 5, 'w', true);
  m.rect(58, 38, 1, 5, 'w', true);
  m.rect(48, 36, 9, 1, 'w', true);
  m.rect(48, 44, 9, 1, 'w', true);
  m.rect(44, 40, 5, 1, 'b'); // dock planks out into the water
  m.rect(34, 40, 10, 1, '='); // path from the south road to the dock
  m.reserve(44, 39, 5, 3);

  // --- Buildings (door on the bottom row) ---------------------------------
  m.building('tavern', 'The Tipsy Turnip', 15, 4, 10, 7, '#a8473a', '#e4cfa6', 4);
  m.building('guild_hall', 'Guild Hall', 36, 4, 9, 7, '#4b5f9e', '#d9cdb4', 4);
  m.building('bank', 'Greenhaven Bank', 48, 4, 8, 7, '#3f7d6a', '#e8e0cc', 4);
  m.building('general_store', 'General Store', 8, 14, 8, 6, '#c27a35', '#ead7b0', 4);
  m.building('blacksmith', 'Blacksmith', 44, 14, 7, 6, '#5a5a66', '#c9b597', 3);
  m.building('farm_supply', 'Farm Supply', 10, 28, 8, 6, '#6f9a3c', '#ecdcb6', 4);

  // --- Plaza features -------------------------------------------------------
  m.prop('fountain', 30, 21);
  m.prop('notice_board', 35, 18, 'Welcome to Greenhaven! New residents: speak with Mayor Lina by the fountain.');
  m.prop('bench', 25, 20);
  m.prop('bench', 37, 20);
  m.prop('bench', 25, 26);
  m.prop('bench', 37, 26);
  for (const [x, y] of [
    [22, 16], [41, 16], [22, 29], [41, 29], [29, 13], [34, 13], [29, 33], [34, 33], [29, 41], [34, 41],
    [8, 25], [17, 25], [46, 25], [56, 20],
  ] as const) {
    if (m.free(x, y, 1, 1)) m.prop('lamp', x, y);
  }
  m.prop('flower_bed', 23, 18);
  m.prop('flower_bed', 39, 18);
  m.prop('flower_bed', 23, 27);
  m.prop('flower_bed', 39, 27);

  // Marketplace stalls
  m.prop('market_stall', 44, 27);
  m.prop('market_stall', 49, 27);
  m.prop('market_stall', 54, 27);
  m.prop('market_stall', 44, 31);
  m.prop('market_stall', 54, 31);
  m.prop('crate', 48, 31);
  m.prop('barrel', 52, 31);

  // Shop clutter
  m.prop('barrel', 25, 9);
  m.prop('barrel', 26, 9);
  m.prop('crate', 14, 9);
  m.prop('well', 27, 12);
  m.prop('barrel', 51, 18);
  m.prop('crate', 51, 17);
  m.prop('rock', 43, 18);
  m.prop('crate', 7, 18);
  m.prop('hay_bale', 18, 32);
  m.prop('hay_bale', 9, 32);
  m.prop('barrel', 18, 29);

  // Teleport station (south-west)
  m.rect(14, 38, 7, 5, ':');
  m.prop('teleport_pad', 16, 39);
  m.prop('lamp', 14, 38);
  m.prop('lamp', 20, 38);
  m.prop('sign', 15, 42, 'Teleport Station — waystones are still being attuned.');

  // --- Closed exits (future regions) ----------------------------------------
  for (let x = 30; x < 34; x++) m.prop('fence_h', x, 2);
  m.prop('sign', 29, 3, 'North: Irondeep Mine — road closed by a rockslide.');
  for (let y = 21; y < 25; y++) m.prop('fence_v', 3, y);
  m.prop('sign', 4, 20, 'West: Whisperwood Forest — wolves sighted, path closed.');
  for (let y = 21; y < 25; y++) m.prop('fence_v', 60, y);
  m.prop('sign', 59, 20, 'East: Crystal Lake — bridge under repair.');
  m.prop('lamp', 29, 45);
  m.prop('lamp', 34, 45);
  m.prop('sign', 35, 44, 'South gate: Sunfield Plains');

  // NPC standing spots (kept clear of scatter)
  for (const [x, y] of [[28, 22], [12, 34], [46, 20], [47, 25], [45, 39], [35, 12], [42, 12]] as const) m.reserve(x - 1, y - 1, 3, 3);
  // Spawn area
  m.reserve(29, 24, 6, 4);

  // --- Nature ---------------------------------------------------------------
  m.forestBorder(r, 2, 4, [
    { side: 'n', from: 30, to: 33 },
    { side: 's', from: 30, to: 33 },
    { side: 'w', from: 21, to: 24 },
    { side: 'e', from: 21, to: 24 },
  ]);
  m.scatterGround(r, 0.06, ',');
  m.scatterGround(r, 0.035, '*');
  m.scatterProps(r, ['tree_oak', 'tree_fruit', 'tree_oak', 'bush', 'bush', 'rock', 'stump'], 46);

  return m.toMap({
    id: 'greenhaven',
    name: 'Greenhaven',
    safeZone: true,
    music: 'town_greenhaven',
    spawn: { x: 31, y: 26, dir: 'down' },
    portals: [
      { id: 'gh_south_gate', x: 30, y: 47, w: 4, h: 1, to: 'sunfield_plains', toX: 30, toY: 2, toDir: 'down', label: 'Sunfield Plains' },
    ],
  });
}

function sunfield(): MapDef {
  const W = 60;
  const H = 40;
  const r = rng(77031);
  const m = new MapBuilder(W, H);

  m.rect(28, 0, 4, 22, '='); // road from Greenhaven
  m.rect(5, 20, 49, 3, '='); // east-west farm lane; its west end leads to the homesteads

  // Old commons fields (decorative), south of the lane
  const fields = [
    [10, 26],
    [19, 26],
    [38, 26],
    [47, 26],
  ] as const;
  for (const [px, py] of fields) {
    m.rect(px + 1, py + 1, 6, 4, 'd');
    for (let x = px; x < px + 8; x++) {
      if (x !== px + 3 && x !== px + 4) m.prop('fence_h', x, py);
      m.prop('fence_h', x, py + 5);
    }
    for (let y = py + 1; y < py + 5; y++) {
      m.prop('fence_v', px, y);
      m.prop('fence_v', px + 7, y);
    }
    m.reserve(px - 1, py - 1, 10, 8);
  }
  m.prop('scarecrow', 14, 28);
  m.prop('scarecrow', 42, 28);

  // Homestead gate at the west end of the lane
  m.prop('lamp', 6, 19);
  m.prop('lamp', 6, 23);
  m.prop('sign', 8, 19, 'Homesteads — follow the lane west to your own farm.');
  m.reserve(4, 18, 6, 7);

  m.prop('hay_bale', 25, 16);
  m.prop('hay_bale', 26, 16);
  m.prop('hay_bale', 36, 34);
  m.prop('sign', 32, 3, 'Sunfield Plains — homesteads to the west. Mind the slimes after dark.');
  m.prop('lamp', 27, 2);
  m.prop('lamp', 32, 2);

  // Irrigation pond between the southern fields
  m.rect(28, 29, 6, 5, '~', true);
  m.rect(27, 30, 1, 3, 'w', true);
  m.rect(34, 30, 1, 3, 'w', true);
  m.rect(29, 28, 4, 1, 'w', true);
  m.rect(29, 34, 4, 1, 'w', true);

  m.reserve(27, 1, 6, 4);
  m.forestBorder(r, 2, 3, [
    { side: 'n', from: 28, to: 31 },
    { side: 'w', from: 19, to: 23 },
  ]);
  m.scatterGround(r, 0.09, ',');
  m.scatterGround(r, 0.05, '*');
  m.scatterProps(r, ['tree_oak', 'tree_fruit', 'bush', 'rock', 'rock', 'stump'], 40);

  return m.toMap({
    id: 'sunfield_plains',
    name: 'Sunfield Plains',
    safeZone: true,
    music: 'field_sunfield',
    spawn: { x: 30, y: 3, dir: 'down' },
    portals: [
      { id: 'sf_north_road', x: 28, y: 0, w: 4, h: 1, to: 'greenhaven', toX: 31, toY: 45, toDir: 'up', label: 'Greenhaven' },
      { id: 'sf_homesteads', x: 4, y: 20, w: 1, h: 3, to: 'homestead', toX: 19, toY: 27, toDir: 'up', label: 'Your Homestead', instance: 'self' },
    ],
  });
}

/** A personal farm. Every character gets their own instance of this map. */
function homestead(): MapDef {
  const W = 40;
  const H = 30;
  const r = rng(5150);
  const m = new MapBuilder(W, H);

  // Field: plots unlock in growing rectangles (tier 1 → 5).
  const fx = 12;
  const fy = 9;
  const tiers: [number, number][] = [
    [6, 2],
    [6, 4],
    [10, 5],
    [20, 5],
    [20, 10],
  ];
  const plots: [number, number][] = [];
  const seen = new Set<string>();
  for (const [w, h] of tiers) {
    for (let y = fy; y < fy + h; y++)
      for (let x = fx; x < fx + w; x++) {
        const k = `${x},${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        plots.push([x, y]);
      }
  }
  m.reserve(fx - 1, fy - 1, 22, 12);

  // Paths
  m.rect(18, 20, 4, 10, '='); // to the exit
  m.rect(9, 10, 1, 10, '='); // cottage to field
  m.rect(9, 19, 13, 1, '=');
  m.rect(4, 19, 5, 1, '=');

  m.building('cottage', 'Homestead', 3, 3, 8, 6, '#8a5a3c', '#ecdcb6', 4);
  m.reserve(6, 9, 3, 2);
  m.prop('well', 4, 12);
  m.prop('barrel', 11, 7);
  m.prop('crate', 12, 7);
  m.prop('hay_bale', 3, 16);
  m.prop('hay_bale', 4, 16);
  m.prop('scarecrow', 34, 12);
  m.prop('sign', 22, 21, 'Your homestead. Till, plant, water, harvest — upgrades from Farmer Rowan.');
  m.prop('lamp', 17, 27);
  m.prop('lamp', 22, 27);

  // Small pond
  m.rect(30, 21, 6, 4, '~', true);
  m.rect(29, 22, 1, 2, 'w', true);
  m.rect(36, 22, 1, 2, 'w', true);
  m.rect(31, 20, 4, 1, 'w', true);
  m.rect(31, 25, 4, 1, 'w', true);

  m.reserve(17, 24, 6, 6);
  m.forestBorder(r, 2, 3, [{ side: 's', from: 18, to: 21 }]);
  m.scatterGround(r, 0.07, ',');
  m.scatterGround(r, 0.04, '*');
  m.scatterProps(r, ['tree_oak', 'tree_fruit', 'bush', 'stump'], 18);

  return m.toMap({
    id: 'homestead',
    name: 'Homestead',
    safeZone: true,
    music: 'field_sunfield',
    spawn: { x: 19, y: 26, dir: 'up' },
    portals: [{ id: 'hs_exit', x: 18, y: 29, w: 4, h: 1, to: 'sunfield_plains', toX: 7, toY: 21, toDir: 'right', label: 'Sunfield Plains' }],
    instanced: true,
    farmPlots: plots,
  });
}

for (const map of [greenhaven(), sunfield(), homestead()]) {
  const errors = validateMapDef(map);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  writeFileSync(join(outDir, `${map.id}.json`), `${JSON.stringify(map, null, 1)}\n`);
  console.log(`wrote ${map.id}.json (${map.width}x${map.height}, ${map.objects.length} objects)`);
}
