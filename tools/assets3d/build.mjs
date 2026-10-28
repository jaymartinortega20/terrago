/**
 * Builds the 3D model pack for TerraGo's 3D view from free CC0 sources
 * (KayKit by Kay Lousberg, Quaternius, a few others — see CREDITS.md).
 *
 *   SRC=/path/to/downloaded/packs node build.mjs
 *
 * Every model is cleaned up (dedup, prune), its textures shrunk to web sizes
 * (WebP), geometry meshopt-compressed, and written to apps/web/public/3d.
 * The hero animations from KayKit's Rig_Medium packs are merged into one
 * animation-only file.
 */
import { mkdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const SRC = resolve(process.env.SRC ?? '.');
const OUT = resolve(new URL('../../apps/web/public/3d', import.meta.url).pathname);
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const KK = 'tgt/tools/blender/assets/kaykit';
const KKA = `${KK}/adventurers`;
const HEX = 'KayKit-Medieval-Hexagon-Pack-1.0/addons/kaykit_medieval_hexagon_pack/Assets/gltf';
const DUN = 'KayKit-Dungeon-Remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf';
const NAT = 'tilakverse-assets/quaternius/stylized-nature-megakit/glTF';
const LIB = 'nrknithin_html-anime/models/library';
const QM = 'tgt/tools/blender/assets/quaternius/monsters';
const FCR = 'fcr/public/assets/units';

/** [output path, source path, max texture size] */
const MODELS = [];
const add = (out, src, tex = 512) => MODELS.push([out, src, tex]);

// Heroes (modular, share one 23-bone rig) and their gear.
for (const h of ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded']) add(`heroes/${h.toLowerCase()}.glb`, `${KKA}/characters/${h}.glb`, 256);
for (const w of ['sword_1handed', 'sword_2handed', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'wand', 'bow_withString', 'crossbow_1handed', 'shield_round', 'shield_square', 'shield_spikes', 'shield_badge', 'spellbook_open', 'quiver'])
  add(`gear/${w}.glb`, `${KKA}/assets/${w}.gltf`, 256);
for (const s of ['Minion', 'Warrior', 'Mage', 'Rogue']) add(`mon/skeleton_${s.toLowerCase()}.glb`, `${KK}/skeletons/characters/Skeleton_${s}.glb`, 256);
for (const s of ['Blade', 'Axe', 'Staff', 'Shield_Small_A']) add(`gear/skeleton_${s.toLowerCase()}.glb`, `${KK}/skeletons/assets/Skeleton_${s}.gltf`, 256);

// Monsters, animals, villagers (Quaternius and friends).
for (const m of ['slime', 'bat', 'spider', 'rat', 'goblin', 'zombie', 'crab', 'wolf', 'fox', 'dog', 'cat', 'pig', 'cow', 'sheep', 'horse', 'deer', 'chicken', 'robot', 'dragon-cute', 'chest'])
  add(`mon/${m.replace('-quaternius', '')}.glb`, `${LIB}/${m}/model.glb`);
for (const [d, m] of [
  ['big', 'BlueDemon'],
  ['big', 'Demon'],
  ['big', 'Dino'],
  ['big', 'MushroomKing'],
  ['blob', 'Mushnub'],
  ['flying', 'Ghost'],
  ['flying', 'Hywirl'],
])
  add(`mon/q_${m.toLowerCase()}.glb`, `${QM}/${d}/${m}.gltf`, 256);
add('mon/dragon.glb', `${FCR}/dragon.glb`);
add('mon/dragon_evolved.glb', `${FCR}/dragon_evolved.glb`);

// Nature (Stylized Nature MegaKit).
const nat = [
  ...[1, 2, 3, 4, 5].flatMap((i) => [`CommonTree_${i}`, `Pine_${i}`]),
  ...[1, 2, 3].flatMap((i) => [`DeadTree_${i}`, `TwistedTree_${i}`, `Birch_${i}`]),
  'GiantPine_1', 'GiantPine_2', 'CherryBlossom_1', 'CherryBlossom_2',
  'Bush_Common', 'Bush_Common_Flowers', 'Bush_Large', 'Bush_Large_Flowers', 'Bush_Long_1',
  'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3', 'Rock_Medium_4', 'Rock_Big_1', 'Rock_Big_2', 'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'RockPath_Round_Wide', 'RockPath_Round_Small_1',
  'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Tall', 'Grass_Wheat', 'Grass_Wide_Short', 'Fern_1', 'Fern_2', 'Clover_1',
  'Flower_1_Group', 'Flower_2_Group', 'Flower_3_Group', 'Flower_4_Group', 'Flower_7_Group', 'Mushroom_Common', 'Mushroom_RedCap', 'Mushroom_Laetiporus', 'Plant_1', 'Plant_7', 'Plant_7_Big',
];
for (const n of nat) add(`nature/${n}.glb`, `${NAT}/${n}.gltf`, 512);

// Buildings and props (KayKit Medieval Hexagon + Dungeon Remastered).
for (const c of ['blue', 'red'])
  for (const b of ['tavern', 'blacksmith', 'castle', 'church', 'home_A', 'home_B', 'market', 'mine', 'windmill', 'well', 'watermill', 'lumbermill', 'barracks', 'tower_A', 'archeryrange'])
    add(`build/${b}_${c}.glb`, `${HEX}/buildings/${c}/building_${b}_${c}.gltf`, 256);
for (const b of ['building_bridge_A', 'building_grain', 'fence_wood_straight', 'fence_stone_straight', 'wall_straight', 'building_destroyed', 'building_stage_A']) add(`build/${b}.glb`, `${HEX}/buildings/neutral/${b}.gltf`, 256);
for (const p of ['barrel', 'crate_A_small', 'crate_A_big', 'crate_long_A', 'sack', 'tent', 'flag_red', 'flag_blue', 'weaponrack', 'wheelbarrow', 'bucket_water', 'resource_lumber', 'resource_stone', 'ladder', 'target', 'pallet'])
  add(`props/${p}.glb`, `${HEX}/decoration/props/${p}.gltf`, 256);
for (const p of ['tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_B_small', 'cloud_big', 'cloud_small', 'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E', 'tree_single_A_cut', 'mountain_A_grass_trees', 'mountain_B', 'hills_A_trees', 'waterlily_A', 'waterplant_A'])
  add(`props/${p}.glb`, `${HEX}/decoration/nature/${p}.gltf`, 256);
for (const p of ['torch_lit', 'torch_mounted', 'barrel_large', 'keg', 'banner_patternA_red', 'banner_shield_blue', 'pillar', 'pillar_decorated', 'column', 'rubble_large', 'candle_triple', 'box_stacked', 'crates_stacked', 'table_medium', 'stool', 'sword_shield_gold', 'coin_stack_large', 'trunk_large_A', 'shelf_small_candles', 'wall_arched', 'stairs'])
  add(`props/${p}.glb`, `${DUN}/${p}.gltf.glb`, 256);

// Hero animations: keep the clips the game uses, drop everything else.
const KEEP = new Set([
  'Idle_A', 'Idle_B', 'Walking_A', 'Running_A', 'Running_B', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B', 'Interact', 'PickUp', 'Use_Item', 'Throw', 'Spawn_Ground',
  'Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Slice_Horizontal', 'Melee_1H_Attack_Stab', 'Melee_2H_Attack_Chop', 'Melee_2H_Attack_Slice', 'Melee_2H_Attack_Spin', 'Melee_2H_Idle', 'Melee_Dualwield_Attack_Slice', 'Melee_Unarmed_Attack_Punch_A', 'Melee_Block',
  'Ranged_Bow_Release', 'Ranged_Bow_Draw', 'Ranged_Bow_Idle', 'Ranged_Bow_Aiming_Idle', 'Ranged_Magic_Shoot', 'Ranged_Magic_Spellcasting', 'Ranged_Magic_Raise', 'Ranged_Magic_Summon', 'Ranged_1H_Shoot',
  'Cheering', 'Waving', 'Sit_Floor_Idle', 'Sit_Chair_Idle', 'Lie_Idle',
  'Chopping', 'Pickaxing', 'Digging', 'Hammering', 'Working_A', 'Fishing_Cast', 'Fishing_Idle', 'Fishing_Reeling', 'Fishing_Catch', 'Holding_A',
  'Skeletons_Idle', 'Skeletons_Walking', 'Skeletons_Taunt', 'Skeletons_Death', 'Skeletons_Awaken_Standing',
  'Jump_Full_Short', 'Dodge_Forward',
]);

async function optimize(doc, tex) {
  await doc.transform(
    dedup(),
    prune({ keepAttributes: false }),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 }),
    unpartition(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  return doc;
}

let total = 0;
const missing = [];
for (const [out, src, tex] of MODELS) {
  const from = join(SRC, src);
  if (!existsSync(from)) {
    missing.push(src);
    continue;
  }
  const doc = await io.read(from);
  // Normal maps cost a lot of bytes for little gain at this camera distance.
  for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null);
    // Some sources ship opaque materials with alpha 0 in the base colour.
    const f = m.getBaseColorFactor();
    if (m.getAlphaMode() === 'OPAQUE' || (m.getAlphaMode() === 'MASK' && f[3] < 0.05)) {
      if (!m.getBaseColorTexture()) m.setAlphaMode('OPAQUE');
      m.setBaseColorFactor([f[0], f[1], f[2], 1]);
    }
  }
  await optimize(doc, tex);
  const dst = join(OUT, out);
  mkdirSync(dirname(dst), { recursive: true });
  await io.write(dst, doc);
  total += statSync(dst).size;
}

// Merge the animation packs.
{
  const files = ['CombatMelee', 'CombatRanged', 'General', 'MovementBasic', 'Simulation', 'Special', 'Tools', 'MovementAdvanced'].map((f) => join(SRC, `${KK}/animations/rig_medium/Rig_Medium_${f}.glb`));
  const base = await io.read(files[0]);
  for (const f of files.slice(1)) mergeDocuments(base, await io.read(f));
  const root = base.getRoot();
  const seen = new Set();
  for (const a of root.listAnimations()) {
    if (!KEEP.has(a.getName()) || seen.has(a.getName())) a.dispose();
    else seen.add(a.getName());
  }
  // Every pack brought its own copy of the rig: point all clips at the first one.
  const first = new Map();
  for (const n of root.listScenes()[0].listChildren().flatMap(function walk(x) { return [x, ...x.listChildren().flatMap(walk)]; })) if (!first.has(n.getName())) first.set(n.getName(), n);
  for (const a of root.listAnimations()) for (const c of a.listChannels()) {
    const t = first.get(c.getTargetNode()?.getName());
    if (t) c.setTargetNode(t);
  }
  for (const sc of root.listScenes().slice(1)) sc.dispose();
  for (const n of root.listNodes()) if (n.getMesh()) n.setMesh(null);
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const t of root.listTextures()) t.dispose();
  await base.transform(prune(), resample(), unpartition());
  base.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const dst = join(OUT, 'heroes/anims.glb');
  await io.write(dst, base);
  total += statSync(dst).size;
  console.log('animations kept:', [...seen].length, 'missing:', [...KEEP].filter((k) => !seen.has(k)).join(', ') || 'none');
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(MODELS.filter(([, s]) => !missing.includes(s)).map(([o]) => o).concat(['heroes/anims.glb']), null, 0));
console.log(`${MODELS.length - missing.length} models, ${(total / 1048576).toFixed(1)} MB`);
if (missing.length) console.log('missing:', missing.join('\n  '));
