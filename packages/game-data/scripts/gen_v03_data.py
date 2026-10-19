"""One-off generator for v0.3 data (gathering, fishing, crafting). Output is plain JSON
in ../data, which designers then edit by hand. Re-running overwrites v0.3 entries."""
import json, os
D = os.path.join(os.path.dirname(__file__), '..', 'data')
load = lambda n: json.load(open(os.path.join(D, n)))
save = lambda n, v: open(os.path.join(D, n), 'w').write(json.dumps(v, indent=1) + "\n")

items = load('items.json')
by = {i['id']: i for i in items}
def item(id, name, desc, icon, cat, rarity='common', vendor=1, stack=99, **extra):
    d = {"id": id, "name": name, "description": desc, "icon": icon, "category": cat, "rarity": rarity, "stackSize": stack,
         "vendorValue": vendor, "levelRequirement": 1, "tradable": True, "bind": "none", "maxDurability": None}
    d.update(extra)
    if id in by:
        by[id].update(d)
    else:
        items.append(d); by[id] = d
def tool(id, name, desc, kind, tier, dur, vendor, rarity):
    item(id, name, desc, f"tool:{kind}:{tier}", 'tool', rarity, vendor, 1, maxDurability=dur, tool={"kind": kind, "tier": tier})

# --- Ores, bars, gems ---------------------------------------------------------------
ores = [("coal","Coal","Black and crumbly. Furnaces eat it by the shovelful.","ore:2a2030",4,'common'),
        ("iron_ore","Iron Ore","Rust-red ore from Irondeep's middle floors.","ore:iron",6,'common'),
        ("silver_ore","Silver Ore","Pale ore that glitters under a torch.","ore:silver",12,'uncommon'),
        ("gold_ore","Gold Ore","Heavy and warm-looking. Every miner's dream.","ore:gold",20,'uncommon'),
        ("mithril_ore","Mithril Ore","Light as a feather, tough as a promise.","ore:mithril",35,'rare'),
        ("crystal_ore","Crystal Ore","Hums faintly. Grows in the deepest caves.","ore:crystal",40,'rare'),
        ("obsidian_ore","Obsidian Ore","Volcanic glass from Ember Ridge.","ore:obsidian",55,'rare'),
        ("star_metal_ore","Star Metal Ore","Fell from the sky long ago. Still warm.","ore:starmetal",120,'epic'),
        ("dragonstone","Dragonstone","A blood-red stone found only near Dragonspire.","gem:e0483a",300,'legendary')]
for o in ores: item(o[0], o[1], o[2], o[3], 'material', o[5], o[4])
by['copper_ore']['icon'] = 'ore:copper'
by['stone']['icon'] = 'stone'
bars = [("silver_bar","Silver Bar","ore:x","bar:silver",45,'uncommon'),("gold_bar","Gold Bar","","bar:gold",75,'uncommon'),
        ("mithril_bar","Mithril Bar","","bar:mithril",130,'rare'),("obsidian_bar","Obsidian Bar","","bar:obsidian",200,'rare'),
        ("star_metal_bar","Star Metal Bar","","bar:starmetal",420,'epic')]
for b in bars: item(b[0], b[1], f"Smelted {b[1].replace(' Bar','').lower()}, ready for the anvil.", b[3], 'material', b[5], b[4])
by['copper_bar']['icon'] = 'bar:copper'; by['iron_bar']['icon'] = 'bar:iron'
gems = [("amethyst","Amethyst","b06ad6",40,'uncommon'),("sapphire","Sapphire","4a7fd6",70,'rare'),("emerald","Emerald","3fae6a",110,'rare'),
        ("ruby","Ruby","e0483a",160,'rare'),("diamond","Diamond","dff4ff",300,'epic')]
for g in gems: item(g[0], g[1], f"A rough {g[1].lower()}. Jewelers and enchanters pay well.", f"gem:{g[2]}", 'material', g[4], g[3])

# --- Wood ----------------------------------------------------------------------------
by['softwood_log']['icon'] = 'log:soft'; by['hardwood_log']['icon'] = 'log:hard'
item("elderwood_log","Elderwood Log","Ancient, violet-grained wood. Rare and prized.","log:elder",'material','rare',18)
item("spiritwood_log","Spiritwood Log","Faintly luminous wood that never rots.","log:spirit",'material','epic',45)
for (id,name,v,r) in [("softwood_plank","Softwood Plank",5,'common'),("hardwood_plank","Hardwood Plank",14,'uncommon'),
                      ("elderwood_plank","Elderwood Plank",40,'rare'),("spiritwood_plank","Spiritwood Plank",100,'epic')]:
    item(id, name, f"Sawn and planed {name.split()[0].lower()}. Ready for building.", "plank", 'material', r, v)
item("rope","Rope","Braided plant fiber. Strong enough for rods and rigging.","fiber",'material','common',4)
item("glass_vial","Glass Vial","An empty vial for potions.","potion:dff4ff",'material','common',1)

# --- Gathered plants ---------------------------------------------------------------
for (id,name,desc,icon,v,r) in [
  ("plant_fiber","Plant Fiber","Tough grass fibers. Twist them into rope.","fiber",1,'common'),
  ("wild_herb","Wild Herb","A common healing herb. Alchemists use it in nearly everything.","herb:5ca84a",3,'common'),
  ("wild_berries","Wild Berries","Tart little berries. Good for jam and tonics.","berry:6a3fb0",3,'common'),
  ("brown_mushroom","Brown Mushroom","Earthy and filling. Cooks love them.","mushroom:8a5d33",4,'common'),
  ("silverleaf","Silverleaf","A shimmering leaf from Whisperwood's shade. Potent in potions.","herb:c8d8e0",12,'uncommon'),
  ("glowcap","Glowcap","A softly glowing cave mushroom. The base of mana potions.","mushroom:5fd4e6",14,'uncommon'),
]: item(id, name, desc, icon, 'material', r, v)

# --- Fish -----------------------------------------------------------------------------
fish = [
 # id, name, rarity, level, difficulty, xp, vendor, tables, time, color, weight
 ("minnow","Minnow",'common',1,10,5,3,["pond","lake","river"],None,"9ab8c8",30),
 ("carp","Carp",'common',1,22,8,6,["pond","lake"],None,"b8944a",22),
 ("perch","Perch",'common',3,28,10,8,["pond","lake","river"],None,"8fae5a",18),
 ("sunfish","Sunfish",'common',4,30,11,9,["pond"],["day","morning"],"f2c14e",12),
 ("trout","Trout",'uncommon',8,40,18,16,["river","lake"],None,"c88a7a",12),
 ("bass","Bass",'uncommon',10,45,20,18,["lake"],None,"5f8f4a",10),
 ("catfish","Catfish",'uncommon',12,52,24,22,["lake","pond","river"],["evening","night"],"7a6a5a",8),
 ("pike","Pike",'rare',18,62,38,40,["lake","river"],None,"5a7a4a",5),
 ("salmon","Salmon",'rare',22,60,40,45,["river"],None,"e8866a",5),
 ("glass_eel","Glass Eel",'rare',25,72,55,70,["lake"],["night"],"cfe8f5",3),
 ("blind_cavefish","Blind Cavefish",'uncommon',12,48,22,24,["cave"],None,"e8d8e8",14),
 ("crystal_crab","Crystal Crab",'rare',28,68,60,80,["cave"],None,"8fe0ff",4),
 ("golden_koi","Golden Koi",'epic',35,80,120,260,["pond","lake"],["morning"],"f5c542",1),
 ("old_whiskers","Old Whiskers",'legendary',45,93,400,1200,["lake"],["night"],"4a3a2a",0.2),
]
for f in fish:
    item(f[0], f[1], f"A {f[1].lower()} — {'a common catch' if f[2]=='common' else 'not an easy catch' if f[2] in ('uncommon','rare') else 'a story you will tell for years'}.",
         f"fish:{f[9]}", 'fish', f[2], f[6], 20 if f[2] in ('common','uncommon') else 10)
save('fish.json', [{"itemId": f[0], "level": f[3], "difficulty": f[4], "xp": f[5], "tables": f[7], **({"time": f[8]} if f[8] else {}), "weight": f[10]} for f in fish])

# --- Food & potions -------------------------------------------------------------------
foods = [
 ("flour","Flour","Milled wheat. Bakers need it for anything worth eating.","food:flour",'material',4,None),
 ("bread","Fresh Bread","Warm from the oven. Restores 20 Energy.","bread",'consumable',8,{"energy":20}),
 ("carrot_soup","Carrot Soup","Sweet and hearty. Restores 25 Energy and 30 HP.","food:soup:e8862e",'consumable',30,{"energy":25,"hp":30}),
 ("grilled_fish","Grilled Fish","Simple and satisfying. Restores 50 HP.","food:skewer:c88a7a",'consumable',14,{"hp":50}),
 ("fish_skewer","Fish Skewer","Perch and tomato on a stick. Restores 70 HP and 10 Energy.","food:skewer:e0483a",'consumable',30,{"hp":70,"energy":10}),
 ("berry_jam","Berry Jam","Sticky and sweet. Restores 18 Energy.","food:pie:6a3fb0",'consumable',16,{"energy":18}),
 ("mushroom_stew","Mushroom Stew","Earthy comfort. Restores 35 Energy and 50 HP.","food:soup:8a5d33",'consumable',36,{"energy":35,"hp":50}),
 ("fried_rice","Fried Rice","A farmer's feast. Restores 45 Energy.","food:soup:f5d34f",'consumable',48,{"energy":45}),
 ("pumpkin_pie","Pumpkin Pie","A slice of autumn. Restores 60 Energy and 100 HP.","food:pie:e8862e",'consumable',150,{"energy":60,"hp":100}),
 ("hearty_stew","Hearty Stew","Trout, potato and mushroom. Restores 160 HP and 30 Energy.","food:soup:a8473a",'consumable',90,{"hp":160,"energy":30}),
 ("salmon_steak","Salmon Steak","Rich and filling. Restores 240 HP.","food:skewer:e8866a",'consumable',120,{"hp":240}),
 ("minor_health_potion","Minor Health Potion","Restores 60 HP.","potion:e0483a",'consumable',12,{"hp":60}),
 ("health_potion","Health Potion","Restores 180 HP.","potion:c0392b",'consumable',45,{"hp":180}),
 ("greater_health_potion","Greater Health Potion","Restores 420 HP.","potion:8f1f1f",'consumable',140,{"hp":420}),
 ("minor_mana_potion","Minor Mana Potion","Restores 40 MP.","potion:4a7fd6",'consumable',12,{"mp":40}),
 ("mana_potion","Mana Potion","Restores 120 MP.","potion:2a4fa6",'consumable',45,{"mp":120}),
 ("energy_tonic","Energy Tonic","A fizzy berry tonic. Restores 35 Energy.","potion:f2c14e",'consumable',20,{"energy":35}),
]
for (id,name,desc,icon,cat,v,cons) in foods:
    extra = {"consumable": cons} if cons else {}
    item(id, name, desc, icon, cat, 'common' if v < 40 else 'uncommon' if v < 120 else 'rare', v, 50 if cat=='consumable' else 99, **extra)

# --- Tools ------------------------------------------------------------------------------
tool("worn_pickaxe","Worn Pickaxe","Chipped but serviceable. Breaks stone and copper.","pickaxe",0,150,4,'common')
tool("copper_pickaxe","Copper Pickaxe","Bites through iron ore.","pickaxe",1,400,30,'common')
tool("iron_pickaxe","Iron Pickaxe","Heavy and reliable. Silver and gold give way.","pickaxe",2,900,120,'uncommon')
tool("mithril_pickaxe","Mithril Pickaxe","Light, sharp, tireless. Mithril and crystal.","pickaxe",3,1800,450,'rare')
tool("obsidian_pickaxe","Obsidian Pickaxe","A volcanic edge for volcanic rock.","pickaxe",4,2600,900,'epic')
tool("star_metal_pickaxe","Star Metal Pickaxe","Nothing in TerraGo is too hard for it.","pickaxe",5,4000,2200,'legendary')
tool("worn_axe","Worn Axe","A dull axe for soft wood.","axe",0,150,4,'common')
tool("copper_axe","Copper Axe","Cuts hardwood with some effort.","axe",1,400,30,'common')
tool("iron_axe","Iron Axe","Elderwood yields to it.","axe",2,900,120,'uncommon')
tool("mithril_axe","Mithril Axe","Even spiritwood can be felled.","axe",3,1800,450,'rare')
tool("bamboo_rod","Bamboo Rod","A light starter rod. Patience not included.","rod",0,200,5,'common')
tool("oak_rod","Hardwood Rod","A stiffer rod with a bigger catch zone.","rod",1,450,40,'common')
tool("iron_rod","Iron-Reel Rod","A reel that holds heavy fish.","rod",2,900,150,'uncommon')
tool("mithril_rod","Mithril Rod","Light as a reed, strong as a chain.","rod",3,1800,500,'rare')
save('items.json', items)

# --- Nodes ----------------------------------------------------------------------------------
def node(id, name, skill, tool, tier, level, yields, respawn, xp, drops, art, energy=2, solid=True):
    return {"id": id, "name": name, "skill": skill, "tool": tool, "toolTier": tier, "level": level, "yields": yields,
            "respawnMs": respawn*1000, "xp": xp, "energy": energy, "drops": drops, "art": art, "solid": solid}
d = lambda i, c=1.0, mn=1, mx=1: {"itemId": i, "chance": c, "min": mn, "max": mx}
nodes = [
 node("rock_stone","Stone Rock","mining","pickaxe",0,1,4,60,4,[d("stone",1,1,2), d("coal",0.05)],{"kind":"rock","color":"#9a968e"}),
 node("rock_copper","Copper Rock","mining","pickaxe",0,1,4,75,7,[d("copper_ore"), d("stone",0.15), d("amethyst",0.01)],{"kind":"rock","color":"#d9822b"}),
 node("rock_coal","Coal Seam","mining","pickaxe",0,5,5,80,9,[d("coal",1,1,2), d("stone",0.1)],{"kind":"rock","color":"#2a2030"}),
 node("rock_iron","Iron Rock","mining","pickaxe",1,10,4,100,14,[d("iron_ore"), d("sapphire",0.01)],{"kind":"rock","color":"#b5533a"}),
 node("rock_silver","Silver Rock","mining","pickaxe",2,20,3,140,24,[d("silver_ore"), d("emerald",0.012)],{"kind":"rock","color":"#e2e6ee"}),
 node("rock_gold","Gold Rock","mining","pickaxe",2,30,3,180,36,[d("gold_ore"), d("ruby",0.012)],{"kind":"rock","color":"#f2c14e"}),
 node("rock_mithril","Mithril Rock","mining","pickaxe",3,40,3,240,55,[d("mithril_ore"), d("diamond",0.008)],{"kind":"rock","color":"#7fe0d8"}),
 node("rock_crystal","Crystal Cluster","mining","pickaxe",3,45,3,260,62,[d("crystal_ore"), d("diamond",0.012)],{"kind":"crystal","color":"#b6a4ff"}),
 node("rock_obsidian","Obsidian Rock","mining","pickaxe",4,55,3,300,80,[d("obsidian_ore"), d("ruby",0.02)],{"kind":"rock","color":"#5a4670"}),
 node("rock_starmetal","Star Metal Meteorite","mining","pickaxe",5,70,2,600,130,[d("star_metal_ore"), d("diamond",0.03)],{"kind":"rock","color":"#ffe9a8"}),
 node("rock_dragonstone","Dragonstone Vein","mining","pickaxe",5,80,1,1200,220,[d("dragonstone")],{"kind":"crystal","color":"#e0483a"}),
 node("tree_softwood","Pine Tree","woodcutting","axe",0,1,4,90,6,[d("softwood_log"), d("plant_fiber",0.1)],{"kind":"tree","color":"#2f7a46"}),
 node("tree_hardwood","Old Oak","woodcutting","axe",1,10,4,140,14,[d("hardwood_log")],{"kind":"tree","color":"#3f6f2c"}),
 node("tree_elder","Elder Tree","woodcutting","axe",2,25,3,240,30,[d("elderwood_log")],{"kind":"tree","color":"#6a4f8a"}),
 node("tree_spirit","Spirit Tree","woodcutting","axe",3,45,2,420,60,[d("spiritwood_log")],{"kind":"tree","color":"#5fc49a"}),
 node("plant_fiber","Fiber Grass","gathering",None,0,1,3,45,3,[d("plant_fiber",1,1,3)],{"kind":"grass","color":"#b8a35a"},1,False),
 node("plant_herb","Herb Patch","gathering",None,0,1,2,60,5,[d("wild_herb",1,1,2)],{"kind":"herb","color":"#5ca84a"},1,False),
 node("plant_berry","Berry Bush","gathering",None,0,3,3,70,6,[d("wild_berries",1,1,2)],{"kind":"bush","color":"#6a3fb0"},1,True),
 node("plant_mushroom","Mushroom Ring","gathering",None,0,5,2,80,8,[d("brown_mushroom",1,1,2)],{"kind":"mushroom","color":"#8a5d33"},1,False),
 node("plant_silverleaf","Silverleaf","gathering",None,0,12,2,140,16,[d("silverleaf")],{"kind":"herb","color":"#c8d8e0"},1,False),
 node("plant_glowcap","Glowcap Cluster","gathering",None,0,15,2,160,18,[d("glowcap")],{"kind":"mushroom","color":"#5fd4e6"},1,False),
]
save('nodes.json', nodes)

# --- Recipes ------------------------------------------------------------------------------
def r(id, station, skill, level, xp, fee, inputs, out, qty=1):
    return {"id": id, "station": station, "skill": skill, "level": level, "xp": xp, "fee": fee,
            "inputs": [{"itemId": i, "quantity": q} for (i, q) in inputs], "output": {"itemId": out, "quantity": qty}}
R = [
 r("smelt_copper","furnace","smithing",1,8,1,[("copper_ore",3)],"copper_bar"),
 r("smelt_iron","furnace","smithing",10,15,3,[("iron_ore",3),("coal",1)],"iron_bar"),
 r("smelt_silver","furnace","smithing",20,26,5,[("silver_ore",3),("coal",1)],"silver_bar"),
 r("smelt_gold","furnace","smithing",30,40,8,[("gold_ore",3),("coal",2)],"gold_bar"),
 r("smelt_mithril","furnace","smithing",40,60,12,[("mithril_ore",3),("coal",2)],"mithril_bar"),
 r("smelt_obsidian","furnace","smithing",55,85,18,[("obsidian_ore",3),("coal",3)],"obsidian_bar"),
 r("smelt_star_metal","furnace","smithing",70,130,30,[("star_metal_ore",3),("coal",3)],"star_metal_bar"),
 r("forge_copper_pickaxe","anvil","smithing",3,20,5,[("copper_bar",3),("softwood_plank",2)],"copper_pickaxe"),
 r("forge_copper_axe","anvil","smithing",3,20,5,[("copper_bar",3),("softwood_plank",2)],"copper_axe"),
 r("forge_copper_hoe","anvil","smithing",5,24,5,[("copper_bar",4),("softwood_plank",2)],"copper_hoe"),
 r("forge_copper_can","anvil","smithing",5,24,5,[("copper_bar",5)],"copper_watering_can"),
 r("forge_iron_pickaxe","anvil","smithing",12,45,15,[("iron_bar",4),("hardwood_plank",2)],"iron_pickaxe"),
 r("forge_iron_axe","anvil","smithing",12,45,15,[("iron_bar",4),("hardwood_plank",2)],"iron_axe"),
 r("forge_iron_hoe","anvil","smithing",15,50,15,[("iron_bar",5),("hardwood_plank",2)],"iron_hoe"),
 r("forge_iron_can","anvil","smithing",15,50,15,[("iron_bar",6)],"iron_watering_can"),
 r("forge_mithril_pickaxe","anvil","smithing",42,140,60,[("mithril_bar",5),("elderwood_plank",2)],"mithril_pickaxe"),
 r("forge_mithril_axe","anvil","smithing",42,140,60,[("mithril_bar",5),("elderwood_plank",2)],"mithril_axe"),
 r("forge_obsidian_pickaxe","anvil","smithing",58,220,120,[("obsidian_bar",6),("elderwood_plank",3)],"obsidian_pickaxe"),
 r("forge_star_metal_pickaxe","anvil","smithing",72,400,300,[("star_metal_bar",6),("spiritwood_plank",3)],"star_metal_pickaxe"),
 r("saw_softwood","workbench","crafting",1,4,0,[("softwood_log",2)],"softwood_plank"),
 r("saw_hardwood","workbench","crafting",10,10,1,[("hardwood_log",2)],"hardwood_plank"),
 r("saw_elderwood","workbench","crafting",25,24,3,[("elderwood_log",2)],"elderwood_plank"),
 r("saw_spiritwood","workbench","crafting",45,50,6,[("spiritwood_log",2)],"spiritwood_plank"),
 r("twist_rope","workbench","crafting",1,3,0,[("plant_fiber",3)],"rope"),
 r("make_oak_rod","workbench","crafting",12,35,10,[("hardwood_plank",3),("rope",2)],"oak_rod"),
 r("make_iron_rod","workbench","crafting",22,70,25,[("iron_bar",2),("hardwood_plank",2),("rope",2)],"iron_rod"),
 r("make_mithril_rod","workbench","crafting",45,160,80,[("mithril_bar",3),("elderwood_plank",2),("rope",3)],"mithril_rod"),
 r("mix_fertilizer","workbench","crafting",2,5,0,[("plant_fiber",2),("wild_herb",1)],"basic_fertilizer"),
 r("mill_flour","mill","cooking",1,3,0,[("wheat",3)],"flour"),
 r("bake_bread","cooking_pot","cooking",2,6,0,[("flour",2)],"bread"),
 r("cook_carrot_soup","cooking_pot","cooking",3,10,0,[("carrot",3),("potato",1)],"carrot_soup"),
 r("cook_grilled_fish","cooking_pot","cooking",4,8,0,[("carp",1)],"grilled_fish"),
 r("cook_berry_jam","cooking_pot","cooking",6,10,0,[("wild_berries",4)],"berry_jam"),
 r("cook_fish_skewer","cooking_pot","cooking",8,16,1,[("perch",2),("tomato",1)],"fish_skewer"),
 r("cook_mushroom_stew","cooking_pot","cooking",10,20,1,[("brown_mushroom",2),("potato",1)],"mushroom_stew"),
 r("cook_fried_rice","cooking_pot","cooking",14,26,2,[("rice",2),("carrot",1),("corn",1)],"fried_rice"),
 r("bake_pumpkin_pie","cooking_pot","cooking",18,40,3,[("pumpkin",1),("flour",2),("wild_berries",1)],"pumpkin_pie"),
 r("cook_hearty_stew","cooking_pot","cooking",22,44,3,[("trout",1),("potato",2),("brown_mushroom",1)],"hearty_stew"),
 r("cook_salmon_steak","cooking_pot","cooking",30,60,4,[("salmon",1),("wild_herb",1)],"salmon_steak"),
 r("brew_minor_health","alchemy_table","alchemy",1,8,1,[("wild_herb",2),("glass_vial",1)],"minor_health_potion"),
 r("brew_minor_mana","alchemy_table","alchemy",5,12,2,[("glowcap",1),("wild_herb",1),("glass_vial",1)],"minor_mana_potion"),
 r("brew_energy_tonic","alchemy_table","alchemy",8,14,2,[("wild_berries",2),("wild_herb",1),("glass_vial",1)],"energy_tonic"),
 r("brew_growth_tonic","alchemy_table","alchemy",10,16,3,[("silverleaf",1),("plant_fiber",1),("glass_vial",1)],"growth_tonic",2),
 r("brew_health","alchemy_table","alchemy",15,30,5,[("silverleaf",2),("wild_berries",1),("glass_vial",1)],"health_potion"),
 r("brew_mana","alchemy_table","alchemy",20,40,6,[("spirit_herb",1),("glowcap",1),("glass_vial",1)],"mana_potion"),
 r("brew_greater_health","alchemy_table","alchemy",30,70,12,[("moonflower",1),("silverleaf",2),("glass_vial",1)],"greater_health_potion"),
]
save('recipes.json', R)

shops = load('shops.json')
sh = {s['npcId']: s for s in shops}
sh['merchant_mira']['sells'] = [{"itemId":"travelers_bread","price":10},{"itemId":"glass_vial","price":5},
   {"itemId":"minor_health_potion","price":35},{"itemId":"minor_mana_potion","price":35}]
sh['merchant_mira']['buys'] = ["crop","seed","material","fish","consumable","tool","weapon","armor"]
shops = [s for s in shops if s['npcId'] not in ('miner_bram','fisher_olan','blacksmith_toren')]
shops += [
 {"npcId":"miner_bram","name":"Bram's Mining Supplies","sells":[{"itemId":"worn_pickaxe","price":25},{"itemId":"copper_pickaxe","price":180,"requires":{"skill":"mining","level":8}}],
  "buys":["material"]},
 {"npcId":"fisher_olan","name":"Olan's Tackle","sells":[{"itemId":"bamboo_rod","price":30},{"itemId":"oak_rod","price":260,"requires":{"skill":"fishing","level":10}}],
  "buys":["fish"]},
 {"npcId":"blacksmith_toren","name":"Toren's Forge","sells":[{"itemId":"worn_axe","price":25},{"itemId":"copper_axe","price":180,"requires":{"skill":"woodcutting","level":8}}],
  "buys":["tool","weapon","armor","material"]},
]
save('shops.json', shops)

npcs = load('npcs.json')
for n in npcs:
    if n['id'] in ('miner_bram','fisher_olan'): n['services'] = ['shop']
    if n['id'] == 'blacksmith_toren': n['services'] = ['shop','repair']
open(os.path.join(D,'npcs.json'),'w').write(json.dumps(npcs, indent=2)+"\n")
print(len(items), 'items;', len(nodes), 'nodes;', len(R), 'recipes;', len(fish), 'fish')
