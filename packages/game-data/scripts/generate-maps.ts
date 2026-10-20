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
import { validateMapDef, type MapDef } from '@terrago/shared';
import { MapBuilder, ladderRowsFor, rng } from '../src/mapgen';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'maps');

function greenhaven(): MapDef {
  const W = 64;
  const H = 48;
  const r = rng(20261019);
  const m = new MapBuilder(W, H);

  // --- Roads and plaza ---------------------------------------------------
  m.rect(30, 0, 4, 16, '='); // north road to Irondeep
  m.rect(30, 30, 4, 18, '='); // south road to Sunfield gate
  m.rect(0, 21, 22, 4, '='); // west road to Whisperwood
  m.rect(42, 21, 22, 4, '='); // east road to Crystal Lake
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

  // --- Exits ------------------------------------------------------------------
  m.prop('sign', 29, 3, 'North: Irondeep Mine. Bring a pickaxe.');
  m.prop('sign', 4, 20, 'West: Whisperwood Forest (Lv 10–20). Hardwood, herbs — and wolves.');
  m.prop('sign', 59, 20, 'East: Crystal Lake. Best fishing in TerraGo.');

  // --- Crafting stations ------------------------------------------------------
  m.station('furnace', 54, 15);
  m.station('anvil', 57, 16);
  m.station('cooking_pot', 27, 9);
  m.station('mill', 5, 29);
  m.station('workbench', 4, 14);
  m.station('alchemy_table', 4, 17);
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
      { id: 'gh_north', x: 30, y: 0, w: 4, h: 1, to: 'irondeep_entrance', toX: 20, toY: 27, toDir: 'up', label: 'Irondeep Mine' },
      { id: 'gh_west', x: 0, y: 21, w: 1, h: 4, to: 'whisperwood', toX: 62, toY: 23, toDir: 'left', label: 'Whisperwood Forest' },
      { id: 'gh_east', x: 63, y: 21, w: 1, h: 4, to: 'crystal_lake', toX: 1, toY: 22, toDir: 'right', label: 'Crystal Lake' },
    ],
    theme: 'meadow',
    fishing: 'pond',
    levels: [1, 5],
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
  // Starter resources: north meadows for stone, copper and pine; herbs everywhere.
  m.scatterNodes(r, [{ type: 'rock_stone', solid: true, weight: 3 }, { type: 'rock_copper', solid: true, weight: 2 }], 12, { x: 36, y: 3, w: 20, h: 15 });
  m.scatterNodes(r, [{ type: 'tree_softwood', solid: true, weight: 1 }], 10, { x: 4, y: 3, w: 22, h: 15 });
  m.scatterNodes(r, [{ type: 'plant_fiber', solid: false, weight: 3 }, { type: 'plant_herb', solid: false, weight: 2 }, { type: 'plant_berry', solid: true, weight: 1 }], 16);
  m.scatterProps(r, ['tree_oak', 'tree_fruit', 'bush', 'rock', 'stump'], 30);

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
    theme: 'meadow',
    fishing: 'pond',
    levels: [1, 8],
    respawn: { mapId: 'greenhaven', x: 31, y: 26 },
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
  for (const [x, y] of [[5, 22], [8, 25]] as const) m.tryNode('rock_stone', x, y, true);
  for (const [x, y] of [[26, 4], [30, 6], [35, 4]] as const) m.tryNode('tree_softwood', x, y, true);
  for (const [x, y] of [[25, 23], [12, 24], [36, 16]] as const) m.tryNode('plant_fiber', x, y, false);
  m.tryNode('plant_herb', 27, 17, false);
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
    theme: 'meadow',
    fishing: 'pond',
  });
}

/** West of Greenhaven: old forest, hardwood, herbs, a river — and (later) wolves. */
function whisperwood(): MapDef {
  const W = 64;
  const H = 48;
  const r = rng(31337);
  const m = new MapBuilder(W, H, 'f');
  m.rect(40, 21, 24, 4, '='); // road from Greenhaven
  m.rect(8, 20, 33, 2, '=', true); // old trail west
  m.reserve(56, 19, 8, 8);
  m.stream(r, 30, 0, 26, 47, 2);
  m.rect(27, 20, 3, 2, 'b'); // bridge over the river
  m.reserve(26, 19, 5, 4);
  // Ranger camp
  m.rect(44, 26, 7, 5, ':');
  m.prop('tent', 45, 26);
  m.prop('campfire', 48, 28);
  m.prop('sign', 50, 26, 'Whisperwood Ranger Camp. Hardwood grows deep in the forest; elder trees deeper still.');
  m.reserve(43, 25, 9, 7);
  m.border(r, 2, 4, [{ side: 'e', from: 21, to: 24 }, { side: 'n', from: 25, to: 33 }, { side: 's', from: 23, to: 31 }], ['tree_pine', 'tree_oak', 'tree_ancient']);
  m.scatterNodes(r, [{ type: 'tree_hardwood', solid: true, weight: 6 }, { type: 'tree_softwood', solid: true, weight: 2 }], 30);
  m.scatterNodes(r, [{ type: 'tree_elder', solid: true, weight: 1 }], 4, { x: 4, y: 4, w: 18, h: 40 });
  m.scatterNodes(r, [
    { type: 'plant_silverleaf', solid: false, weight: 2 },
    { type: 'plant_mushroom', solid: false, weight: 3 },
    { type: 'plant_berry', solid: true, weight: 2 },
    { type: 'plant_herb', solid: false, weight: 3 },
    { type: 'plant_fiber', solid: false, weight: 2 },
  ], 26);
  m.scatterProps(r, ['tree_oak', 'tree_pine', 'tree_ancient', 'bush', 'mushroom_big', 'stump', 'rock'], 70, undefined, 'f,');
  return m.toMap({
    id: 'whisperwood',
    name: 'Whisperwood Forest',
    safeZone: false,
    music: 'forest',
    spawn: { x: 60, y: 23, dir: 'left' },
    portals: [{ id: 'ww_east', x: 63, y: 21, w: 1, h: 4, to: 'greenhaven', toX: 1, toY: 23, toDir: 'right', label: 'Greenhaven' }],
    theme: 'forest',
    fishing: 'river',
    levels: [10, 20],
    respawn: { mapId: 'greenhaven', x: 31, y: 26 },
  });
}

/** East of Greenhaven: a wide lake with a dock — the best fishing around. */
function crystalLake(): MapDef {
  const W = 60;
  const H = 44;
  const r = rng(424242);
  const m = new MapBuilder(W, H);
  m.rect(0, 21, 18, 3, '='); // road from Greenhaven
  m.reserve(0, 19, 6, 7);
  // The lake: an ellipse of deep water with a shallow rim and a sandy shore.
  const cx = 36;
  const cy = 22;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = ((x - cx) / 17) ** 2 + ((y - cy) / 13) ** 2;
      if (d < 0.78) m.grid[y]![x] = '~';
      else if (d < 1) m.grid[y]![x] = 'w';
      else if (d < 1.35) m.grid[y]![x] = 's';
    }
  // Dock out into the water from the west shore
  m.rect(17, 22, 7, 1, 'b');
  m.rect(16, 21, 2, 3, 's');
  m.reserve(15, 20, 10, 5);
  m.prop('dock_post', 23, 21);
  m.prop('dock_post', 23, 23);
  m.prop('sign', 15, 19, 'Crystal Lake. Old Whiskers, the lake legend, only bites at night.');
  m.prop('campfire', 12, 26);
  m.prop('tent', 9, 25);
  m.reserve(8, 24, 7, 5);
  m.forestBorder(r, 2, 3, [{ side: 'w', from: 20, to: 24 }]);
  m.scatterProps(r, ['reeds', 'reeds', 'reeds'], 22, undefined, 's');
  m.scatterGround(r, 0.06, ',');
  m.scatterGround(r, 0.04, '*');
  m.scatterNodes(r, [{ type: 'rock_copper', solid: true, weight: 2 }, { type: 'rock_iron', solid: true, weight: 1 }, { type: 'rock_stone', solid: true, weight: 2 }], 7, { x: 4, y: 3, w: 52, h: 6 });
  m.scatterNodes(r, [{ type: 'tree_softwood', solid: true, weight: 2 }, { type: 'plant_fiber', solid: false, weight: 2 }, { type: 'plant_herb', solid: false, weight: 2 }, { type: 'plant_berry', solid: true, weight: 1 }], 14);
  m.scatterProps(r, ['tree_oak', 'bush', 'rock', 'tree_fruit'], 24);
  return m.toMap({
    id: 'crystal_lake',
    name: 'Crystal Lake',
    safeZone: false,
    music: 'lake',
    spawn: { x: 2, y: 22, dir: 'right' },
    portals: [{ id: 'cl_west', x: 0, y: 20, w: 1, h: 4, to: 'greenhaven', toX: 62, toY: 22, toDir: 'left', label: 'Greenhaven' }],
    theme: 'lake',
    fishing: 'lake',
    levels: [5, 25],
    respawn: { mapId: 'greenhaven', x: 31, y: 26 },
  });
}

/** North of Greenhaven: the mountain path and the mouth of Irondeep Mine. */
function irondeepEntrance(): MapDef {
  const W = 40;
  const H = 30;
  const r = rng(80085);
  const m = new MapBuilder(W, H);
  // Mountain walls
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, W - 1 - x, y);
      if (edge < 3 + Math.floor((Math.sin(x * 0.8) + Math.sin(y * 0.6 + 1)) * 1.2 + 1)) m.grid[y]![x] = '#';
    }
  m.rect(18, 9, 4, 21, '='); // path up to the mine
  m.rect(14, 8, 12, 4, ':'); // mine yard
  m.reserve(13, 6, 14, 7);
  m.prop('mine_entrance', 19, 6);
  m.rect(19, 5, 3, 1, '#');
  m.prop('torch', 18, 7);
  m.prop('torch', 22, 7);
  m.prop('sign', 24, 10, 'Irondeep Mine. Forty floors deep. Floors 1–5: stone and copper. Iron below 6, silver below 11, gold below 21.');
  m.prop('crate', 15, 9);
  m.prop('barrel', 16, 9);
  m.scatterGround(r, 0.08, ',');
  m.scatterNodes(r, [{ type: 'rock_stone', solid: true, weight: 4 }, { type: 'rock_copper', solid: true, weight: 2 }, { type: 'rock_coal', solid: true, weight: 1 }], 12);
  m.scatterProps(r, ['rock', 'tree_pine', 'stump', 'bush'], 16);
  return m.toMap({
    id: 'irondeep_entrance',
    name: 'Irondeep Mine',
    safeZone: true,
    music: 'mountain',
    spawn: { x: 20, y: 11, dir: 'down' },
    portals: [
      { id: 'ie_south', x: 18, y: 29, w: 4, h: 1, to: 'greenhaven', toX: 31, toY: 1, toDir: 'down', label: 'Greenhaven' },
      { id: 'ie_mine', x: 19, y: 8, w: 3, h: 1, to: 'irondeep_1', toX: 4, toY: ladderRowsFor(1).up, toDir: 'right', label: 'Floor 1' },
    ],
    theme: 'meadow',
    levels: [1, 10],
    respawn: { mapId: 'greenhaven', x: 31, y: 26 },
  });
}

for (const map of [greenhaven(), sunfield(), homestead(), whisperwood(), crystalLake(), irondeepEntrance()]) {
  const errors = validateMapDef(map);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  writeFileSync(join(outDir, `${map.id}.json`), `${JSON.stringify(map, null, 1)}\n`);
  console.log(`wrote ${map.id}.json (${map.width}x${map.height}, ${map.objects.length} objects)`);
}
