"""Endgame content (levels 38-100): Dusthaven Desert, Ember Ridge, Ancient Ruins,
Dragonspire; Stoneheart Golem and Ancient Wyvern world bosses; Sunken Sanctum
dungeon; boss loot; region NPCs and quests."""
import json, os, copy
D = os.path.join(os.path.dirname(__file__), '..', 'data')
load = lambda n: json.load(open(os.path.join(D, n)))
def save(n, v): open(os.path.join(D, n), 'w').write(json.dumps(v, indent=1) + "\n")

items = load('items.json'); by = {i['id']: i for i in items}
monsters = load('monsters.json'); mby = {m['id']: m for m in monsters}
def upsert(lst, idx, d):
    if d['id'] in idx: idx[d['id']].clear(); idx[d['id']].update(d)
    else: lst.append(d); idx[d['id']] = d

def material(id, name, desc, icon, value, rarity):
    upsert(items, by, {"id": id, "name": name, "description": desc, "icon": icon, "category": "material", "rarity": rarity, "stackSize": 99,
                       "vendorValue": value, "levelRequirement": 1, "tradable": True, "bind": "none", "maxDurability": None})
material('sand_crystal', 'Sand Crystal', 'Glassy shards grown in the dunes. Alchemists grind them.', 'gem:f2d86a', 45, 'uncommon')
material('ember_core', 'Ember Core', 'A coal that never stops glowing.', 'essence:e0602a', 90, 'rare')
material('ancient_relic', 'Ancient Relic', 'A carved token from a forgotten empire. Collectors pay well.', 'gem:b6a4ff', 140, 'rare')
material('drake_scale', 'Drake Scale', 'Hard as steel, light as leather.', 'scale:a83a2a', 180, 'rare')
material('wyvern_scale', 'Wyvern Scale', 'Shimmering, heat-proof — the rarest hide in the world.', 'scale:5a8a3a', 900, 'epic')

def clone(src, id, name, desc, rarity, lvl, mult, vendor, bind='equip'):
    d = copy.deepcopy(by[src])
    d.update(id=id, name=name, description=desc, rarity=rarity, levelRequirement=lvl, vendorValue=vendor, bind=bind)
    d['equip']['stats'] = {k: max(1, round(v * mult)) for k, v in d['equip']['stats'].items()}
    upsert(items, by, d)
    return id
stone = [clone('star_metal_shield', 'stoneheart_aegis', 'Stoneheart Aegis', "Carved from the Golem's own chest. Blows simply stop.", 'legendary', 72, 1.25, 3000),
         clone('emerald_amulet', 'golem_heart', 'Heart of Stone', 'It still beats, very slowly.', 'legendary', 72, 2.4, 2500)]
wyv = [clone(f'star_metal_{w}', f'wyvernbane_{w}', f'Wyvernbane {w.title()}', 'Forged from a fallen Ancient Wyvern. The finest weapon in TerraGo.', 'mythic', 90, 1.35, 8000)
       for w in ['sword', 'bow', 'staff', 'mace', 'dagger']]
upsert(items, by, {"id": "wyvern_whelp", "name": "Wyvern Whelp", "description": "A young wyvern that chose you. The fastest mount in the world.", "icon": "mount:wyvern:5a8a3a",
                   "category": "mount", "rarity": "mythic", "stackSize": 1, "vendorValue": 5000, "levelRequirement": 80, "tradable": True, "bind": "none", "maxDurability": None,
                   "mount": {"speed": 1.9, "color": "#5a8a3a", "kind": "wyvern"}})
lich = [clone('obsidian_staff', 'sanctum_scepter', 'Sanctum Scepter', 'The drowned lich bound storms into it.', 'epic', 74, 1.3, 2400),
        clone('diamond_ring', 'drowned_seal', 'Drowned Seal', 'Cold, heavy, and humming with old magic.', 'epic', 74, 1.4, 2200)]

dr = lambda i, c, a=1, b=1: {"itemId": i, "chance": c, "min": a, "max": b}
def monster(id, name, shape, color, size, hp, atk, df, speed, aggro, rng, cd, xp, gold, drops, magic=False, **extra):
    d = {"id": id, "name": name, "hpMult": hp, "atkMult": atk, "defMult": df, "speed": speed, "aggro": aggro, "range": rng, "cooldownMs": cd,
         "xpMult": xp, "gold": gold, "drops": drops, "art": {"shape": shape, "color": color, "size": size}, "respawnMs": 50000}
    if magic: d["magic"] = True
    d.update(extra)
    upsert(monsters, mby, d)

# Dusthaven Desert (38-50)
monster('sand_scorpion', 'Sand Scorpion', 'spider', '#d8a04a', 1.25, 1.5, 1.45, 1.4, 70, 6, 1.4, 1300, 1.9, [18, 36], [dr('sand_crystal', 0.3), dr('gold_ore', 0.25, 1, 2)])
monster('dust_bandit', 'Dust Bandit', 'goblin', '#c9a06a', 1.15, 1.4, 1.5, 1.3, 72, 7, 1.4, 1250, 2.0, [25, 50], [dr('goblin_trinket', 0.3), dr('sand_crystal', 0.15)])
monster('sand_golem', 'Sand Golem', 'golem', '#d8c08a', 1.55, 2.6, 1.5, 2.0, 42, 4, 1.5, 2000, 2.4, [30, 60], [dr('sand_crystal', 0.5, 1, 2), dr('golem_core', 0.08)])
# Ember Ridge (50-65)
monster('magma_hound', 'Magma Hound', 'wolf', '#d8502a', 1.25, 1.5, 1.55, 1.3, 95, 7, 1.3, 1100, 2.1, [30, 60], [dr('ember_core', 0.08), dr('coal', 0.5, 1, 3)])
monster('ember_elemental', 'Ember Elemental', 'mage', '#e0702a', 1.1, 1.3, 1.7, 1.2, 55, 8, 5, 1800, 2.2, [35, 70], [dr('ember_core', 0.15), dr('obsidian_ore', 0.2)], magic=True)
monster('obsidian_golem', 'Obsidian Golem', 'golem', '#3a3048', 1.65, 2.8, 1.6, 2.3, 40, 4, 1.5, 2100, 2.8, [45, 90], [dr('obsidian_ore', 0.6, 1, 3), dr('golem_core', 0.12)])
# Ancient Ruins (65-80)
monster('ruin_sentinel', 'Ruin Sentinel', 'golem', '#9a948a', 1.6, 2.8, 1.6, 2.4, 44, 5, 1.6, 2000, 3.0, [60, 110], [dr('ancient_relic', 0.12), dr('star_metal_ore', 0.15)])
monster('cursed_knight', 'Cursed Knight', 'skeleton', '#7a5aa0', 1.3, 1.9, 1.7, 1.8, 62, 7, 1.5, 1400, 2.8, [50, 100], [dr('ancient_relic', 0.08), dr('dark_essence', 0.2)])
monster('wraith', 'Wraith', 'mage', '#c8c8d8', 1.1, 1.3, 1.8, 1.2, 70, 8, 5, 1700, 2.7, [50, 95], [dr('dark_essence', 0.3), dr('ancient_relic', 0.06)], magic=True)
# Dragonspire (80-100)
monster('young_drake', 'Young Drake', 'wolf', '#a83a2a', 1.45, 2.0, 1.75, 1.8, 90, 7, 1.5, 1200, 3.2, [80, 140], [dr('drake_scale', 0.12), dr('dragonstone', 0.08)])
monster('dragon_knight', 'Dragon Knight', 'orc', '#3a2a4a', 1.45, 2.4, 1.85, 2.2, 64, 7, 1.6, 1400, 3.5, [100, 180], [dr('drake_scale', 0.1), dr('star_metal_ore', 0.3, 1, 2)])
monster('elder_drake', 'Elder Drake', 'wolf', '#7a1a1a', 1.85, 3.4, 1.95, 2.4, 80, 8, 2.0, 1600, 4.2, [140, 260], [dr('drake_scale', 0.3, 1, 2), dr('dragonstone', 0.2)])

# World bosses — meant for many players at once.
monster('stoneheart_golem', 'Stoneheart Golem', 'golem', '#6a6460', 3.0, 60, 1.9, 2.6, 36, 8, 2.2, 2200, 40, [2000, 4000],
        [dr(stone[0], 0.06), dr(stone[1], 0.06), dr('ancient_relic', 1, 2, 4), dr('enhancement_stone', 1, 6, 10), dr('dungeon_key', 1, 2, 3)],
        boss=True, respawnMs=3600000,
        abilities=[
          {"id": "rockfall", "name": "Rockfall", "kind": "slam", "everyMs": 6000, "windupMs": 1600, "radius": 3.0, "dmgMult": 2.4},
          {"id": "quake", "name": "Quake", "kind": "nova", "everyMs": 12000, "windupMs": 2200, "radius": 6, "dmgMult": 1.7},
          {"id": "stone_skin", "name": "Stone Skin", "kind": "harden", "everyMs": 30000, "durationMs": 9000, "taken": 0.25, "belowHp": 0.6},
          {"id": "shards", "name": "Shards of the Mountain", "kind": "summon", "atHp": [0.75, 0.5, 0.25], "monster": "ruin_sentinel", "count": 4, "level": 72},
          {"id": "crumble", "name": "Last Stand", "kind": "enrage", "atHp": [0.15], "dmg": 1.6}])
monster('ancient_wyvern', 'Ancient Wyvern', 'wolf', '#4a7a3a', 3.4, 120, 2.1, 2.8, 70, 9, 3.0, 2000, 70, [6000, 12000],
        [dr(w, 0.03) for w in wyv] + [dr('wyvern_whelp', 0.02), dr('wyvern_scale', 1, 2, 4), dr('dragonstone', 1, 3, 6), dr('enhancement_stone', 1, 10, 16), dr('dungeon_key', 1, 3, 5)],
        boss=True, respawnMs=7200000,
        abilities=[
          {"id": "fire_breath", "name": "Fire Breath", "kind": "slam", "everyMs": 5000, "windupMs": 1400, "radius": 3.5, "dmgMult": 2.6},
          {"id": "tail_sweep", "name": "Tail Sweep", "kind": "nova", "everyMs": 9000, "windupMs": 1600, "radius": 4.5, "dmgMult": 2.0},
          {"id": "skyward", "name": "Takes to the Sky", "kind": "harden", "everyMs": 25000, "durationMs": 7000, "taken": 0.1, "belowHp": 0.7},
          {"id": "brood", "name": "Call the Brood", "kind": "summon", "atHp": [0.8, 0.6, 0.4, 0.2], "monster": "young_drake", "count": 4, "level": 88},
          {"id": "inferno", "name": "Inferno", "kind": "enrage", "atHp": [0.2], "dmg": 1.7}])
monster('sanctum_lich', 'The Drowned Lich', 'mage', '#5a3a8a', 2.2, 14, 1.8, 1.8, 50, 7, 5, 1900, 22, [800, 1500],
        [dr(lich[0], 0.1), dr(lich[1], 0.12), dr('ancient_relic', 1, 2, 3), dr('enhancement_stone', 1, 4, 7), dr('dungeon_key', 1, 2, 2)],
        magic=True, boss=True, respawnMs=600000,
        abilities=[
          {"id": "drown", "name": "Drowning Tide", "kind": "nova", "everyMs": 11000, "windupMs": 2000, "radius": 4, "dmgMult": 1.9},
          {"id": "hex", "name": "Grave Hex", "kind": "slam", "everyMs": 6500, "windupMs": 1400, "radius": 2.4, "dmgMult": 2.2},
          {"id": "ward", "name": "Bone Ward", "kind": "harden", "everyMs": 28000, "durationMs": 8000, "taken": 0.3, "belowHp": 0.5},
          {"id": "risen", "name": "The Drowned Rise", "kind": "summon", "atHp": [0.7, 0.35], "monster": "cursed_knight", "count": 3, "level": 74},
          {"id": "despair", "name": "Despair", "kind": "enrage", "atHp": [0.2], "dmg": 1.5}])

save('items.json', items)
save('monsters.json', monsters)

dungeons = load('dungeons.json'); dby = {d['id']: d for d in dungeons}
upsert(dungeons, dby, {"id": "sunken_sanctum", "name": "The Sunken Sanctum", "levels": [70, 80], "seed": 9191, "floor": "k", "wall": "r",
  "entrance": {"map": "ancient_ruins", "x": 44, "y": 30}, "exit": {"mapId": "ancient_ruins", "x": 45, "y": 34},
  "rooms": 5, "props": ["ruin_pillar", "bones", "crystal"],
  "trash": [{"monster": "cursed_knight", "level": [71, 74], "count": 3}, {"monster": "wraith", "level": [72, 75], "count": 2}, {"monster": "ruin_sentinel", "level": [74, 76], "count": 1}],
  "boss": {"monster": "sanctum_lich", "level": 80}})
save('dungeons.json', dungeons)

npcs = load('npcs.json'); nby = {n['id']: n for n in npcs}
def npc(id, name, title, mapId, x, y, app, acc, lines, greet):
    upsert(npcs, nby, {"id": id, "name": name, "title": title, "mapId": mapId, "x": x, "y": y, "dir": "down", "appearance": app, "accessory": acc,
                       "firstMeeting": {"lines": lines}, "greetings": [[g] for g in greet], "services": []})
npc('caravan_zara', 'Caravan Master Zara', 'Desert Caravan', 'dusthaven_desert', 10, 20, {"bodyType": "b", "skinTone": 4, "hairStyle": 2, "hairColor": 0, "eyeColor": 3, "outfit": 2}, 'bandana',
    ["Zara. My caravans cross the dunes — when the scorpions let them.", "Bandits on the roads, golems in the sand. Clear the way and you'll have friends in every oasis."],
    ["Water's worth more than gold out here.", "Stay off the open dunes at noon."])
npc('forgewarden_hal', 'Forgewarden Hal', 'Ember Ridge', 'ember_ridge', 10, 20, {"bodyType": "a", "skinTone": 2, "hairStyle": 1, "hairColor": 5, "eyeColor": 1, "outfit": 3}, 'helmet',
    ["Hal. I guard the old dwarf forges on this ridge.", "Magma hounds and fire spirits, and golems of black glass. Bring your best armor — and bring water."],
    ["The mountain breathes fire. Respect it.", "Obsidian? The golems are made of it. Help yourself."])
npc('archivist_elowen', 'Archivist Elowen', 'Ancient Ruins', 'ancient_ruins', 30, 42, {"bodyType": "b", "skinTone": 1, "hairStyle": 4, "hairColor": 3, "eyeColor": 4, "outfit": 4}, 'hood',
    ["Elowen. I study the empire that built these halls.", "The Stoneheart Golem guards the central court. It takes a small army to wake it — and to put it back to sleep.",
     "Below us lies the Sunken Sanctum. A lich drowned there long ago. He didn't stay dead."],
    ["Every stone here has a story.", "Mind the sentinels. They still think it's wartime."])
npc('hunter_kade', 'Dragon Hunter Kade', 'Dragonspire', 'dragonspire', 10, 22, {"bodyType": "a", "skinTone": 3, "hairStyle": 3, "hairColor": 1, "eyeColor": 0, "outfit": 5}, 'cape',
    ["Kade. I hunt dragons. Mostly they hunt me.", "Drakes on the slopes, dragon knights on the bridges — and at the summit, the Ancient Wyvern.",
     "Twenty of the best fighters in TerraGo, maybe. That's what it'll take."],
    ["Fire-proof cloak? Good. Now a bigger one.", "If you hear wings, run."])
save('npcs.json', npcs)

quests = load('quests.json'); qby = {q['id']: q for q in quests}
def quest(id, name, giver, turn, req, desc, intro, outro, steps, rewards):
    upsert(quests, qby, {"id": id, "name": name, "giver": giver, "turnIn": turn, "requires": req, "description": desc, "intro": intro, "outro": outro, "steps": steps, "rewards": rewards})
st = lambda text, typ, target, count, where=None: {k: v for k, v in {"text": text, "type": typ, "target": target, "count": count, "where": where}.items() if v is not None}
quest('q_desert', 'Sand and Stings', 'hunter_moss', 'caravan_zara', 'q_mire', 'East of Crystal Lake the land turns to sand. Level 38+ recommended.',
      ["You've cleaned up the mire. Ever seen a desert?", "Past Crystal Lake, east. Caravan Master Zara could use a blade like yours."],
      ["Six scorpions and four bandits. The caravans will roll again!", "When you want real heat, head east to Ember Ridge."],
      [st('Cross Crystal Lake to Dusthaven Desert (east shore)', 'visit', 'dusthaven_desert', 1, {"map": "crystal_lake", "x": 58, "y": 22}),
       st('Defeat 6 Sand Scorpions', 'kill', 'sand_scorpion', 6, {"map": "dusthaven_desert", "x": 30, "y": 32}),
       st('Defeat 4 Dust Bandits', 'kill', 'dust_bandit', 4, {"map": "dusthaven_desert", "x": 42, "y": 14})],
      {"gold": 4000, "xp": 40000, "items": [{"itemId": "enhancement_stone", "quantity": 8}]})
quest('q_ridge', 'The Burning Ridge', 'caravan_zara', 'forgewarden_hal', 'q_desert', 'Beyond the desert, the mountains smoke. Level 50+ recommended.',
      ["Smoke on the eastern horizon — that's Ember Ridge.", "Forgewarden Hal keeps the old forges there. Tell him Zara sent you."],
      ["Hounds and golems both. You're tougher than the obsidian.", "North of here lie the Ancient Ruins. Elowen will want to meet you."],
      [st('Travel east to Ember Ridge', 'visit', 'ember_ridge', 1, {"map": "dusthaven_desert", "x": 62, "y": 23}),
       st('Defeat 8 Magma Hounds', 'kill', 'magma_hound', 8, {"map": "ember_ridge", "x": 30, "y": 30}),
       st('Defeat 3 Obsidian Golems', 'kill', 'obsidian_golem', 3, {"map": "ember_ridge", "x": 46, "y": 14})],
      {"gold": 7000, "xp": 90000, "items": [{"itemId": "enhancement_stone", "quantity": 10}, {"itemId": "ember_core", "quantity": 2}]})
quest('q_ruins', 'Echoes of an Empire', 'forgewarden_hal', 'archivist_elowen', 'q_ridge', 'North of Ember Ridge: the ruins of an ancient empire. Level 65+ recommended.',
      ["Take the north pass. The ruins are older than the mountain, some say.", "Archivist Elowen studies them. She'll need someone to keep the sentinels busy."],
      ["You fought back the knights and sentinels. The archive is safe — for now.", "If you gather an army, the Stoneheart Golem waits in the central court."],
      [st('Climb the north pass to the Ancient Ruins', 'visit', 'ancient_ruins', 1, {"map": "ember_ridge", "x": 31, "y": 1}),
       st('Defeat 8 Cursed Knights', 'kill', 'cursed_knight', 8, {"map": "ancient_ruins", "x": 16, "y": 16}),
       st('Defeat 4 Ruin Sentinels', 'kill', 'ruin_sentinel', 4, {"map": "ancient_ruins", "x": 46, "y": 14})],
      {"gold": 12000, "xp": 180000, "items": [{"itemId": "enhancement_stone", "quantity": 12}, {"itemId": "ancient_relic", "quantity": 2}]})
quest('q_dragonspire', 'The Dragon Road', 'archivist_elowen', 'hunter_kade', 'q_ruins', 'East of the ruins, the Dragonspire. The end of the map — and of easy days. Level 80+ recommended.',
      ["The empire fell to dragons, the records say. They're still there — east, on the Dragonspire.", "Find Kade, the dragon hunter. He's mad, and he's right."],
      ["Elder drakes don't fall to just anyone. You're a legend.", "The Ancient Wyvern is all that's left. Gather twenty friends. I'll be watching."],
      [st('Cross into the Dragonspire', 'visit', 'dragonspire', 1, {"map": "ancient_ruins", "x": 62, "y": 21}),
       st('Defeat 10 Young Drakes', 'kill', 'young_drake', 10, {"map": "dragonspire", "x": 26, "y": 30}),
       st('Defeat 3 Elder Drakes', 'kill', 'elder_drake', 3, {"map": "dragonspire", "x": 46, "y": 12})],
      {"gold": 25000, "xp": 400000, "items": [{"itemId": "enhancement_stone", "quantity": 20}, {"itemId": "drake_scale", "quantity": 4}]})
save('quests.json', quests)
print('ok', len(items), len(monsters), len(npcs), len(quests))
