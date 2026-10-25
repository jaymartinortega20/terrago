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
import { validateMapDef, type MapDef, type PortalDef } from '@terrago/shared';
import dungeonsJson from '../data/dungeons.json';
import { DUNGEON_PREFIX, MapBuilder, generateDungeon, ladderRowsFor, rng, type DungeonDef } from '../src/mapgen';

const DUNGEONS = dungeonsJson as DungeonDef[];

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
  m.prop('sign', 15, 42, 'Teleport Station — step on a waystone to travel to any region you have visited (small fee).');

  // --- Exits ------------------------------------------------------------------
  m.prop('sign', 29, 3, 'North: the Desolate Crags (Lv 41–70). Ore and gems. Bring a pickaxe.');
  m.prop('sign', 4, 20, 'The western woods are closed. The road south leads to Whispering Fields.');
  m.prop('sign', 59, 20, 'The eastern road is closed. Fish the pond: Olan says it is full of rare catches.');

  // --- Crafting stations ------------------------------------------------------
  m.station('furnace', 54, 15);
  m.station('anvil', 57, 16);
  m.station('cooking_pot', 27, 9);
  m.station('mill', 5, 29);
  m.station('workbench', 4, 14);
  m.station('alchemy_table', 4, 17);
  m.station('loom', 6, 11);
  m.station('enhance_altar', 36, 13);
  m.prop('lamp', 29, 45);
  m.prop('lamp', 34, 45);
  m.prop('sign', 35, 44, 'South gate: Whispering Fields (Lv 1–40). Master Aldric waits at the far end.');

  // NPC standing spots (kept clear of scatter)
  for (const [x, y] of [[28, 22], [12, 34], [46, 20], [47, 25], [45, 39], [35, 12], [42, 12]] as const) m.reserve(x - 1, y - 1, 3, 3);
  // Spawn area
  m.reserve(29, 24, 6, 4);

  // --- Nature ---------------------------------------------------------------
  m.forestBorder(r, 2, 4, [
    { side: 'n', from: 30, to: 33 },
    { side: 's', from: 30, to: 33 },
  ]);
  m.scatterGround(r, 0.06, ',');
  m.scatterGround(r, 0.035, '*');
  m.scatterProps(r, ['tree_oak', 'tree_fruit', 'tree_oak', 'bush', 'bush', 'rock', 'stump'], 46);

  return m.toMap({
    id: 'greenhaven',
    name: 'Oakhaven Sanctuary',
    safeZone: true,
    music: 'town_greenhaven',
    spawn: { x: 31, y: 26, dir: 'down' },
    portals: [
      { id: 'gh_south_gate', x: 30, y: 47, w: 4, h: 1, to: 'sunfield_plains', toX: 30, toY: 2, toDir: 'down', label: 'Whispering Fields' },
      { id: 'gh_north', x: 30, y: 0, w: 4, h: 1, to: 'desolate_crags', toX: 31, toY: 45, toDir: 'up', label: 'Desolate Crags' },
    ],
    theme: 'meadow',
    // The town pond: fishing XP and rare crafting catches.
    fishing: 'lake',
    levels: [1, 5],
  });
}

/** Whispering Fields: farmland near town, goblins and wolves further south, and Gnarlfang's arena guarding Master Aldric. Lv 1-40. */
function sunfield(): MapDef {
  const W = 60;
  const H = 100;
  const r = rng(77031);
  const m = new MapBuilder(W, H);

  m.rect(28, 0, 4, 22, '='); // road from Oakhaven
  m.rect(5, 20, 51, 3, '='); // farm lane: west to the homesteads
  m.rect(28, 22, 4, 57, '='); // the long road south to the arena

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
  m.prop('sign', 32, 3, 'Whispering Fields — slimes near town, goblins and wolves to the south. Gnarlfang guards the far end.');
  m.prop('lamp', 27, 2);
  m.prop('lamp', 32, 2);

  // Irrigation pond between the southern fields
  m.rect(28, 29, 6, 5, '~', true);
  m.rect(27, 30, 1, 3, 'w', true);
  m.rect(34, 30, 1, 3, 'w', true);
  m.rect(29, 28, 4, 1, 'w', true);
  m.rect(29, 34, 4, 1, 'w', true);
  m.rect(28, 35, 4, 44, '=', true); // road continues past the pond

  m.reserve(27, 1, 6, 4);
  waystone(m, 34, 7, '.');

  // Goblin camp (Lv 10-22)
  m.rect(36, 45, 12, 7, '=', true);
  m.prop('tent', 37, 45);
  m.prop('tent', 43, 45);
  m.prop('campfire', 41, 48);
  m.prop('sign', 34, 43, 'Goblin camp. Level 10+.');

  // Dungeons under the fields
  const crypt = dungeonGate(m, 'mossy_crypt', '.');
  const hollow = dungeonGate(m, 'ember_hollow', '.');

  // Gnarlfang's arena: cliffs across the whole map with one way through.
  m.rect(2, 79, 56, 12, '#', true);
  m.rect(19, 80, 22, 10, ':', true);
  m.rect(28, 79, 4, 1, '=', true);
  m.rect(28, 90, 4, 1, '=', true);
  m.prop('sign', 33, 77, "Gnarlfang's Arena. Level 40 — bring friends. Master Aldric's grove lies beyond.");
  m.prop('torch', 27, 78);
  m.prop('torch', 32, 78);
  // Master Aldric's grove
  m.rect(16, 91, 28, 6, '.', true);
  m.rect(28, 91, 4, 3, ':', true);
  m.prop('flower_bed', 22, 93);
  m.prop('flower_bed', 36, 93);
  m.prop('lamp', 26, 94);
  m.prop('lamp', 34, 94);
  m.reserve(27, 93, 7, 4);

  m.forestBorder(r, 2, 3, [{ side: 'n', from: 28, to: 31 }]);
  m.scatterGround(r, 0.09, ',');
  m.scatterGround(r, 0.05, '*');
  // Starter resources: north meadows for stone, copper and pine; herbs everywhere; hardwood in the south.
  m.scatterNodes(r, [{ type: 'rock_stone', solid: true, weight: 3 }, { type: 'rock_copper', solid: true, weight: 2 }], 12, { x: 36, y: 3, w: 20, h: 15 });
  m.scatterNodes(r, [{ type: 'tree_softwood', solid: true, weight: 1 }], 10, { x: 4, y: 3, w: 22, h: 15 });
  m.scatterNodes(r, [{ type: 'plant_fiber', solid: false, weight: 3 }, { type: 'plant_herb', solid: false, weight: 2 }, { type: 'plant_berry', solid: true, weight: 1 }], 16, { x: 0, y: 0, w: 60, h: 40 });
  m.scatterNodes(r, [{ type: 'tree_hardwood', solid: true, weight: 2 }, { type: 'plant_mushroom', solid: false, weight: 2 }, { type: 'plant_silverleaf', solid: false, weight: 1 }], 18, { x: 3, y: 42, w: 54, h: 35 });
  m.scatterProps(r, ['tree_oak', 'tree_fruit', 'bush', 'rock', 'stump'], 30, { x: 0, y: 0, w: 60, h: 40 });
  m.scatterProps(r, ['tree_pine', 'tree_pine', 'tree_oak', 'bush', 'rock'], 70, { x: 2, y: 42, w: 56, h: 36 });

  return m.toMap({
    id: 'sunfield_plains',
    name: 'Whispering Fields',
    safeZone: false,
    music: 'field_sunfield',
    spawn: { x: 30, y: 3, dir: 'down' },
    portals: [
      { id: 'sf_north_road', x: 28, y: 0, w: 4, h: 1, to: 'greenhaven', toX: 31, toY: 45, toDir: 'up', label: 'Oakhaven Sanctuary' },
      { id: 'sf_homesteads', x: 4, y: 20, w: 1, h: 3, to: 'homestead', toX: 19, toY: 27, toDir: 'up', label: 'Your Homestead', instance: 'self' },
      crypt,
      hollow,
    ],
    theme: 'meadow',
    fishing: 'pond',
    levels: [1, 40],
    respawn: { mapId: 'greenhaven', x: 31, y: 26 },
    spawns: [
      { monster: 'green_slime', level: [1, 2], count: 6, area: { x: 34, y: 4, w: 22, h: 14 } },
      { monster: 'green_slime', level: [2, 3], count: 4, area: { x: 6, y: 4, w: 20, h: 13 } },
      { monster: 'field_rat', level: [2, 4], count: 5, area: { x: 36, y: 24, w: 20, h: 12 } },
      { monster: 'wild_boar', level: [4, 6], count: 3, area: { x: 8, y: 32, w: 18, h: 5 } },
      { monster: 'blue_slime', level: [6, 9], count: 5, area: { x: 4, y: 38, w: 20, h: 6 } },
      { monster: 'goblin_scout', level: [10, 16], count: 9, area: { x: 34, y: 42, w: 22, h: 14 } },
      { monster: 'orc', level: [16, 22], count: 6, area: { x: 4, y: 58, w: 20, h: 10 } },
      { monster: 'forest_wolf', level: [20, 28], count: 10, area: { x: 4, y: 66, w: 22, h: 11 } },
      { monster: 'giant_spider', level: [26, 34], count: 7, area: { x: 34, y: 56, w: 22, h: 12 } },
      { monster: 'skeleton', level: [32, 38], count: 6, area: { x: 34, y: 72, w: 22, h: 6 } },
      { monster: 'fields_warden', level: [40, 40], count: 1, area: { x: 28, y: 83, w: 4, h: 4 } },
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
  // Animal pen (south-west): fenced, gate on the north side by the path.
  const pen = { x: 3, y: 21, w: 11, h: 6 };
  for (let x = pen.x; x < pen.x + pen.w; x++) {
    if (x !== 7 && x !== 8) m.prop('fence_h', x, pen.y);
    m.prop('fence_h', x, pen.y + pen.h);
  }
  for (let y = pen.y + 1; y < pen.y + pen.h; y++) {
    m.prop('fence_v', pen.x, y);
    m.prop('fence_v', pen.x + pen.w - 1, y);
  }
  m.prop('hay_bale', 11, 22);
  m.prop('barrel', 4, 22);
  m.prop('sign', 9, 20, 'Animal pen — buy chickens, sheep and cows from Farmer Rowan, then tend them here.');
  m.reserve(pen.x, pen.y, pen.w, pen.h + 1);
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
    pen: { x: 4, y: 22, w: 9, h: 5 },
    theme: 'meadow',
    fishing: 'pond',
  });
}

/** A waystone (3x3 teleport pad) on cleared ground. */
function waystone(m: MapBuilder, x: number, y: number, ground: string) {
  m.rect(x - 1, y - 1, 5, 5, ground, true);
  m.prop('teleport_pad', x, y);
}

/** A dungeon gate (3x2) with its entry portal on the row in front. */
function dungeonGate(m: MapBuilder, id: string, ground: string): PortalDef {
  const d = DUNGEONS.find((x) => x.id === id)!;
  const { x, y } = d.entrance;
  m.rect(x - 1, y - 1, 5, 6, ground, true);
  m.prop('dungeon_gate', x, y);
  m.prop('torch', x - 1, y + 1);
  m.prop('torch', x + 3, y + 1);
  m.prop('sign', x + 4, y + 2, `${d.name}. Recommended level ${d.levels[0]}–${d.levels[1]}. Click the gate to pick Normal, Hard, Nightmare or Mythic. Your party shares one run.`);
  const spawn = generateDungeon(d).spawn;
  return { id: `gate_${id}`, x, y: y + 2, w: 3, h: 1, to: DUNGEON_PREFIX + id, toX: spawn.x, toY: spawn.y, toDir: 'right', label: d.name };
}

/** Ragged cliff edges for wild regions. */
function cliffs(m: MapBuilder, salt: number) {
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const edge = Math.min(x, m.width - 1 - x, y, m.height - 1 - y);
      if (edge < 2 + Math.floor((Math.sin(x * 0.45 + salt) + Math.sin(y * 0.6 + salt * 2)) * 1.1 + 1)) m.grid[y]![x] = '#';
    }
}

/** A camp: cleared ground, tent, campfire, and a reserved spot for the region's NPC. */
function camp(m: MapBuilder, x: number, y: number, ground: string, sign: string) {
  m.rect(x, y, 9, 6, ground, true);
  m.prop('tent', x + 1, y);
  m.prop('campfire', x + 5, y + 2);
  m.prop('sign', x + 7, y + 5, sign);
}

/** The roof of the world: drakes, dragon knights, and the Ancient Wyvern. Lv 80-100. */
function dragonspire(): MapDef {
  const m = new MapBuilder(64, 48, 'n');
  const r = rng(80808);
  cliffs(m, 7);
  // Scorched patches around old dragon fire.
  for (let i = 0; i < 10; i++) {
    const cx = 8 + Math.floor(r() * 48);
    const cy = 6 + Math.floor(r() * 36);
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 3; x <= cx + 3; x++) if (m.tile(x, y) === 'n' && (x - cx) ** 2 / 9 + (y - cy) ** 2 / 4 < 1) m.grid[y]![x] = 'a';
  }
  m.rect(0, 22, 30, 3, '=', true);
  m.rect(28, 0, 3, 25, '=', true);
  camp(m, 6, 15, '=', "Dragon's Peak. Everything here is level 100. Beyond the summit burns the Infernal Caldera.");
  waystone(m, 18, 16, '=');
  // Summit (world boss)
  m.rect(36, 2, 24, 12, ':', true);
  m.prop('sign', 34, 13, 'The Summit. Elder drakes nest here. The road north leads to the Infernal Caldera.');
  // The dragon knights' citadel guards the eastern slopes.
  m.rect(40, 26, 13, 10, ':', true);
  m.building('dragon_citadel', 'Dragonspire Citadel', 41, 27, 11, 7, '#8a2a2a', '#5e5550', 5, 'castle');
  m.prop('torch', 44, 35);
  m.prop('torch', 48, 35);
  for (let i = 0; i < 6; i++) {
    const x = 34 + Math.floor(r() * 24);
    const y = 20 + Math.floor(r() * 20);
    if (m.free(x, y, 2, 2)) m.rect(x, y, 2, 2, 'L', true);
  }
  m.scatterNodes(r, [{ type: 'rock_dragonstone', solid: true, weight: 2 }, { type: 'rock_starmetal', solid: true, weight: 2 }], 12, undefined, 'na');
  m.scatterProps(r, ['tree_snow', 'rock', 'bones', 'tree_dead'], 60, undefined, 'na');
  return m.toMap({
    id: 'dragonspire',
    name: "Dragon's Peak",
    safeZone: false,
    music: 'dragon',
    spawn: { x: 2, y: 23, dir: 'right' },
    portals: [
      { id: 'ds_west', x: 0, y: 22, w: 1, h: 3, to: 'glacial_depths', toX: 61, toY: 23, toDir: 'left', label: 'Glacial Depths' },
      { id: 'ds_north', x: 28, y: 0, w: 3, h: 1, to: 'infernal_caldera', toX: 24, toY: 37, toDir: 'up', label: 'The Infernal Caldera' },
    ],
    theme: 'peak',
    levels: [100, 100],
    respawn: { mapId: 'dragonspire', x: 11, y: 20 },
    spawns: [
      { monster: 'young_drake', level: [100, 100], count: 9, area: { x: 12, y: 27, w: 24, h: 15 } },
      { monster: 'dragon_knight', level: [100, 100], count: 6, area: { x: 34, y: 34, w: 24, h: 10 } },
      { monster: 'elder_drake', level: [100, 100], count: 5, area: { x: 36, y: 3, w: 22, h: 10 } },
      { monster: 'drake_champion', level: [100, 100], count: 2, area: { x: 12, y: 30, w: 20, h: 10 } },
      { monster: 'dragon_knight_champion', level: [100, 100], count: 2, area: { x: 40, y: 24, w: 10, h: 4 } },
      { monster: 'dragon_priest', level: [100, 100], count: 3, area: { x: 34, y: 34, w: 24, h: 10 } },
      { monster: 'wyrm_hatchling', level: [100, 100], count: 4, area: { x: 12, y: 27, w: 24, h: 15 } },
      { monster: 'drake_broodmother', level: [100, 100], count: 2, area: { x: 36, y: 3, w: 22, h: 10 } },
    ],
  });
}

/** North of Oakhaven: cracked stone, old lava flows and living rock. Ore and low-tier gems. Lv 41-70. */
function desolateCrags(): MapDef {
  const m = new MapBuilder(64, 48, 'k');
  const r = rng(41414);
  cliffs(m, 2);
  // Hardened black magma flows and rock outcrops.
  for (let i = 0; i < 10; i++) {
    const cx = 6 + Math.floor(r() * 52);
    const cy = 4 + Math.floor(r() * 32);
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 4; x <= cx + 4; x++) if (m.tile(x, y) === 'k' && (x - cx) ** 2 / 16 + (y - cy) ** 2 / 4 < 1) m.grid[y]![x] = 'a';
  }
  for (let i = 0; i < 7; i++) {
    const x = 6 + Math.floor(r() * 50);
    const y = 4 + Math.floor(r() * 30);
    if (Math.abs(x - 30) < 5) continue;
    m.rect(x, y, 2 + Math.floor(r() * 3), 2, '#', false);
  }
  m.rect(30, 0, 4, 48, '=', true); // the pass north to the ice
  camp(m, 6, 38, '=', 'Desolate Crags. Earth elementals in the west, rock golems in the east. Ore everywhere.');
  m.reserve(9, 40, 3, 3);
  waystone(m, 18, 39, '=');
  m.scatterNodes(r, [
    { type: 'rock_copper', solid: true, weight: 2 },
    { type: 'rock_iron', solid: true, weight: 3 },
    { type: 'rock_silver', solid: true, weight: 2 },
    { type: 'rock_gold', solid: true, weight: 2 },
    { type: 'rock_coal', solid: true, weight: 2 },
  ], 26, undefined, 'ka');
  // Low-tier upgrade gems.
  m.scatterNodes(r, [{ type: 'gem_ruby', solid: true, weight: 3 }, { type: 'gem_sapphire', solid: true, weight: 1 }], 10, undefined, 'ka');
  m.scatterProps(r, ['rock', 'rock', 'stalagmite', 'tree_dead', 'bones'], 45, undefined, 'ka');
  return m.toMap({
    id: 'desolate_crags',
    name: 'Desolate Crags',
    safeZone: false,
    music: 'ruins',
    spawn: { x: 31, y: 45, dir: 'up' },
    portals: [
      { id: 'dc_south', x: 30, y: 47, w: 4, h: 1, to: 'greenhaven', toX: 31, toY: 2, toDir: 'down', label: 'Oakhaven Sanctuary' },
      { id: 'dc_north', x: 30, y: 0, w: 4, h: 1, to: 'glacial_depths', toX: 31, toY: 45, toDir: 'up', label: 'Glacial Depths' },
    ],
    theme: 'ruins',
    levels: [41, 70],
    respawn: { mapId: 'desolate_crags', x: 31, y: 40 },
    spawns: [
      { monster: 'earth_elemental', level: [41, 55], count: 8, area: { x: 5, y: 4, w: 22, h: 30 } },
      { monster: 'sand_scorpion', level: [43, 52], count: 5, area: { x: 5, y: 20, w: 22, h: 14 } },
      { monster: 'boulder_mite', level: [45, 55], count: 4, area: { x: 5, y: 4, w: 22, h: 16 } },
      { monster: 'dust_bandit', level: [50, 60], count: 5, area: { x: 18, y: 8, w: 26, h: 14 } },
      { monster: 'crag_shaman', level: [52, 62], count: 3, area: { x: 18, y: 8, w: 26, h: 14 } },
      { monster: 'rock_golem', level: [55, 70], count: 7, area: { x: 36, y: 4, w: 22, h: 34 } },
      { monster: 'wraith', level: [60, 68], count: 4, area: { x: 36, y: 14, w: 22, h: 24 } },
      { monster: 'cursed_knight', level: [64, 70], count: 3, area: { x: 40, y: 4, w: 18, h: 10 } },
    ],
  });
}

/** Frozen caverns beyond the Crags: rare ore and high-tier gems. Lv 71-99. */
function glacialDepths(): MapDef {
  const m = new MapBuilder(64, 48, 'n');
  const r = rng(71717);
  cliffs(m, 4);
  // Ice-cave floors and frozen pools.
  for (let i = 0; i < 12; i++) {
    const cx = 6 + Math.floor(r() * 52);
    const cy = 4 + Math.floor(r() * 34);
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 5; x <= cx + 5; x++) if (m.tile(x, y) === 'n' && (x - cx) ** 2 / 25 + (y - cy) ** 2 / 9 < 1) m.grid[y]![x] = 'c';
  }
  for (let i = 0; i < 6; i++) {
    const x = 8 + Math.floor(r() * 48);
    const y = 4 + Math.floor(r() * 30);
    if (Math.abs(x - 30) < 6 || Math.abs(y - 23) < 3) continue;
    m.rect(x, y, 3, 2, 'I', false);
  }
  m.rect(30, 22, 4, 26, '=', true); // up from the Crags
  m.rect(30, 22, 34, 3, '=', true); // east to Dragon's Peak
  camp(m, 6, 38, '=', 'Glacial Depths. Ice specters drift in the west caves; frost giants roam the east.');
  m.reserve(9, 40, 3, 3);
  waystone(m, 18, 39, '=');
  const sanctum = dungeonGate(m, 'sunken_sanctum', 'n');
  m.scatterNodes(r, [
    { type: 'rock_mithril', solid: true, weight: 3 },
    { type: 'rock_crystal', solid: true, weight: 2 },
    { type: 'rock_obsidian', solid: true, weight: 2 },
    { type: 'rock_starmetal', solid: true, weight: 1 },
  ], 24, undefined, 'nc');
  // High-tier upgrade gems.
  m.scatterNodes(r, [{ type: 'gem_sapphire', solid: true, weight: 2 }, { type: 'gem_diamond', solid: true, weight: 2 }], 10, undefined, 'nc');
  m.scatterProps(r, ['tree_snow', 'rock', 'stalagmite', 'stalagmite'], 45, undefined, 'nc');
  return m.toMap({
    id: 'glacial_depths',
    name: 'Glacial Depths',
    safeZone: false,
    music: 'snow',
    spawn: { x: 31, y: 45, dir: 'up' },
    portals: [
      { id: 'gd_south', x: 30, y: 47, w: 4, h: 1, to: 'desolate_crags', toX: 31, toY: 2, toDir: 'down', label: 'Desolate Crags' },
      { id: 'gd_east', x: 63, y: 22, w: 1, h: 3, to: 'dragonspire', toX: 2, toY: 23, toDir: 'right', label: "Dragon's Peak" },
      sanctum,
    ],
    theme: 'snow',
    levels: [71, 99],
    respawn: { mapId: 'glacial_depths', x: 31, y: 40 },
    spawns: [
      { monster: 'ice_specter', level: [71, 82], count: 7, area: { x: 5, y: 4, w: 22, h: 30 } },
      { monster: 'snow_wolf', level: [72, 80], count: 5, area: { x: 5, y: 4, w: 22, h: 30 } },
      { monster: 'ice_wisp', level: [74, 84], count: 5, area: { x: 5, y: 14, w: 22, h: 20 } },
      { monster: 'frost_mite', level: [78, 88], count: 4, area: { x: 18, y: 20, w: 26, h: 14 } },
      { monster: 'frost_priestess', level: [82, 92], count: 3, area: { x: 30, y: 20, w: 26, h: 10 } },
      { monster: 'frost_yeti', level: [86, 95], count: 5, area: { x: 36, y: 4, w: 24, h: 16 } },
      { monster: 'glacier_warlock', level: [88, 96], count: 3, area: { x: 36, y: 4, w: 24, h: 16 } },
      { monster: 'frost_giant_brute', level: [90, 99], count: 6, area: { x: 36, y: 4, w: 24, h: 16 } },
    ],
  });
}

/** The raid lair: a lava-ringed crater where Pyraxis, the Infernal Titan, sleeps. Lv 100. */
function infernalCaldera(): MapDef {
  const m = new MapBuilder(48, 40, 'a');
  const r = rng(66666);
  cliffs(m, 9);
  // Lava ring around the crater floor.
  for (let y = 3; y < 33; y++)
    for (let x = 4; x < 44; x++) {
      const d = Math.hypot((x - 24) / 18, (y - 17) / 13);
      if (d > 0.82 && d < 0.98 && !(x >= 22 && x <= 26 && y > 17)) m.grid[y]![x] = 'L';
    }
  m.rect(22, 18, 5, 22, '=', true); // the path in from the south
  m.rect(14, 9, 20, 15, ':', true); // the crater floor (arena)
  m.prop('sign', 27, 34, 'The Infernal Caldera. Pyraxis, the Infernal Titan. A raid of level 100 heroes. Everyone who fights gets their own loot.');
  m.prop('torch', 21, 33);
  m.prop('torch', 27, 33);
  m.reserve(20, 32, 9, 8);
  m.scatterProps(r, ['bones', 'rock', 'stalagmite'], 16, undefined, 'a');
  return m.toMap({
    id: 'infernal_caldera',
    name: 'The Infernal Caldera',
    safeZone: false,
    music: 'boss',
    spawn: { x: 24, y: 37, dir: 'up' },
    portals: [{ id: 'ic_south', x: 22, y: 39, w: 5, h: 1, to: 'dragonspire', toX: 29, toY: 2, toDir: 'down', label: "Dragon's Peak" }],
    theme: 'volcano',
    levels: [100, 100],
    respawn: { mapId: 'dragonspire', x: 11, y: 20 },
    spawns: [
      { monster: 'infernal_titan', level: [100, 100], count: 1, area: { x: 22, y: 13, w: 4, h: 4 } },
      { monster: 'ember_elemental', level: [96, 100], count: 6, area: { x: 15, y: 10, w: 18, h: 12 } },
      { monster: 'magma_hound', level: [96, 100], count: 3, area: { x: 15, y: 22, w: 18, h: 8 } },
      { monster: 'fire_imp', level: [96, 100], count: 3, area: { x: 15, y: 22, w: 18, h: 8 } },
    ],
  });
}

for (const map of [greenhaven(), sunfield(), homestead(), desolateCrags(), glacialDepths(), dragonspire(), infernalCaldera()]) {
  const errors = validateMapDef(map);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  writeFileSync(join(outDir, `${map.id}.json`), `${JSON.stringify(map, null, 1)}\n`);
  console.log(`wrote ${map.id}.json (${map.width}x${map.height}, ${map.objects.length} objects)`);
}
