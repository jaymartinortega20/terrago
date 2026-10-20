"""One-off generator for v0.5 combat data. Writes plain JSON to ../data for hand-tuning."""
import json, os
D = os.path.join(os.path.dirname(__file__), '..', 'data')
load = lambda n: json.load(open(os.path.join(D, n)))
def save(n, v): open(os.path.join(D, n), 'w').write(json.dumps(v, indent=1) + "\n")

items = load('items.json'); by = {i['id']: i for i in items}
def item(id, name, desc, icon, cat, rarity='common', vendor=1, stack=99, lvl=1, **extra):
    d = {"id": id, "name": name, "description": desc, "icon": icon, "category": cat, "rarity": rarity, "stackSize": stack,
         "vendorValue": vendor, "levelRequirement": lvl, "tradable": True, "bind": "none", "maxDurability": None}
    d.update(extra)
    if id in by: by[id].update(d)
    else: items.append(d); by[id] = d

# --- Monster materials ------------------------------------------------------------
for (id, name, desc, icon, v, r) in [
 ("slime_gel","Slime Gel","Wobbly and faintly sweet. Alchemists use it as a binder.","essence:7cc35a",2,'common'),
 ("rat_tail","Rat Tail","Proof of pest control. Somebody pays for these.","fang:c99a7a",2,'common'),
 ("boar_hide","Boar Hide","Thick bristly hide. Tanned into leather.","hide:8a5d33",5,'common'),
 ("wolf_pelt","Wolf Pelt","Grey fur, warm and tough.","hide:9a948a",9,'common'),
 ("spider_silk","Spider Silk","Strong as wire, light as air. Weavers want it.","fiber",10,'uncommon'),
 ("bat_wing","Bat Wing","Leathery. Used in a few odd potions.","hide:4a3a5a",4,'common'),
 ("bone","Bone","Old and dry. Useful, somehow.","bone",3,'common'),
 ("goblin_trinket","Goblin Trinket","A shiny something a goblin was very proud of.","gem:f2c14e",12,'uncommon'),
 ("orc_tusk","Orc Tusk","Yellowed and heavy. Smiths grind it into flux.","fang:e8dcc0",18,'uncommon'),
 ("golem_core","Golem Core","Still warm. Hums with stubborn magic.","essence:b6a4ff",45,'rare'),
 ("dark_essence","Dark Essence","A shard of shadow. Handle with gloves.","essence:4a2a6a",40,'rare'),
 ("leather","Leather","Tanned hide, ready for armor.","hide:a8743f",10,'common'),
 ("linen","Linen","Woven cloth for robes and capes.","cloth:e8dcc0",8,'common'),
 ("silk_cloth","Silk Cloth","Fine cloth woven from spider silk.","cloth:f4f1e6",30,'uncommon'),
 ("enhancement_stone","Enhancement Stone","Used at the Enhancement Altar to strengthen equipment.","stone_enh",25,'uncommon'),
]: item(id, name, desc, icon, 'material', r, v)

# --- Weapons and armor ----------------------------------------------------------------
TIERS = [  # name, level, metal icon tier, bar, wood, vendor
 ("Training", 1, 0, None, "softwood_plank", 6),
 ("Copper", 5, 1, "copper_bar", "softwood_plank", 30),
 ("Iron", 12, 2, "iron_bar", "hardwood_plank", 90),
 ("Silver", 22, 3, "silver_bar", "hardwood_plank", 220),
 ("Gold", 32, 4, "gold_bar", "elderwood_plank", 450),
 ("Mithril", 42, 5, "mithril_bar", "elderwood_plank", 900),
 ("Obsidian", 56, 6, "obsidian_bar", "spiritwood_plank", 1800),
 ("Star Metal", 70, 7, "star_metal_bar", "spiritwood_plank", 4000),
]
RAR = ['common','common','common','uncommon','uncommon','rare','epic','legendary']
WEAPONS = {  # type: (class, noun, statfn, speed, range, magic)
 "sword": ("warrior", "Sword", lambda t: {"atk": 4 + t * 9 + t * t}, 900, 1.5, False),
 "bow": ("ranger", "Bow", lambda t: {"atk": 3 + t * 8 + t * t, "agi": t}, 1100, 6, False),
 "staff": ("mage", "Staff", lambda t: {"matk": 5 + t * 10 + t * t, "int": t, "mp": 10 * t}, 1200, 5, True),
 "mace": ("priest", "Mace", lambda t: {"matk": 4 + t * 8 + t * t, "atk": 2 + t * 3, "mp": 8 * t}, 1050, 1.6, True),
 "dagger": ("rogue", "Dagger", lambda t: {"atk": 3 + t * 7 + t * t, "crit": 2 + t}, 650, 1.3, False),
}
weapons = []
recipes = load('recipes.json'); recipes = [r for r in recipes if not r['id'].startswith(('forge_w_', 'forge_a_', 'make_w_', 'weave_', 'tan_', 'jewel_', 'brew_enh'))]
def rec(id, station, skill, level, xp, fee, inputs, out, qty=1):
    recipes.append({"id": id, "station": station, "skill": skill, "level": level, "xp": xp, "fee": fee,
                    "inputs": [{"itemId": i, "quantity": q} for (i, q) in inputs], "output": {"itemId": out, "quantity": qty}})
for t, (tn, lvl, mt, bar, wood, vend) in enumerate(TIERS):
    for wt, (cls, noun, stat, speed, rng, magic) in WEAPONS.items():
        id = f"{tn.lower().replace(' ', '_')}_{wt}"
        dur = 200 + t * 120
        item(id, f"{tn} {noun}", f"A {tn.lower()} {noun.lower()} for {cls}s.", f"weapon:{wt}:{mt}", 'weapon', RAR[t], vend, 1, lvl,
             maxDurability=dur, equip={"slot": "mainhand", "weapon": wt, "stats": stat(t), "speedMs": speed, "range": rng,
                                       **({"magic": True} if magic else {}), "classes": [cls]})
        if t >= 1:
            sl = max(1, lvl - 2)
            if wt in ("bow", "staff"):
                rec(f"make_w_{id}", "workbench", "crafting", sl, 15 + t * 20, 5 * t * t, [(wood, 3 + t), (bar, 1 + t // 2), ("rope" if wt == "bow" else "glass_vial", 2)], id)
            else:
                rec(f"forge_w_{id}", "anvil", "smithing", sl, 15 + t * 20, 5 * t * t, [(bar, 3 + t), (wood, 1 + t // 2)], id)
    # Armor set
    for (slot, noun, stat, icon) in [
        ("head", "Helm", lambda t: {"def": 1 + t * 3, "hp": 5 * t}, "head"),
        ("chest", "Armor", lambda t: {"def": 3 + t * 6, "hp": 15 * t, "mdef": t * 2}, "chest"),
        ("gloves", "Gloves", lambda t: {"def": 1 + t * 2, "atk": t, "matk": t}, "gloves"),
        ("boots", "Boots", lambda t: {"def": 1 + t * 2, "agi": max(0, t - 1)}, "boots"),
    ]:
        nm = "Padded" if t == 0 else tn
        id = f"{nm.lower().replace(' ', '_')}_{slot}"
        item(id, f"{nm} {noun}", f"{nm} {noun.lower()}. Worn by any class.", f"armor:{slot}:{mt}", 'armor', RAR[t], max(4, vend // 2), 1, lvl,
             maxDurability=180 + t * 100, equip={"slot": slot, "stats": stat(t)})
        if t >= 1:
            base = [(bar, 2 + t + (2 if slot == 'chest' else 0))]
            extra = [("leather", 2 + t // 2)] if t <= 3 else [("silk_cloth", 1 + t // 3)]
            rec(f"forge_a_{id}", "anvil", "smithing", max(1, lvl - 1), 12 + t * 18, 4 * t * t, base + extra, id)

# Accessories
for (id, name, slot, stats, inputs, lvl, v, r) in [
 ("copper_ring", "Copper Ring", "ring", {"atk": 2, "matk": 2}, [("copper_bar", 2)], 3, 20, 'common'),
 ("amethyst_ring", "Amethyst Ring", "ring", {"int": 3, "mp": 25, "matk": 4}, [("silver_bar", 1), ("amethyst", 1)], 15, 90, 'uncommon'),
 ("sapphire_ring", "Sapphire Ring", "ring", {"mdef": 10, "vit": 2}, [("silver_bar", 1), ("sapphire", 1)], 20, 140, 'rare'),
 ("ruby_ring", "Ruby Ring", "ring", {"atk": 9, "matk": 9}, [("gold_bar", 1), ("ruby", 1)], 30, 260, 'rare'),
 ("diamond_ring", "Diamond Ring", "ring", {"crit": 6, "luk": 6}, [("mithril_bar", 1), ("diamond", 1)], 42, 600, 'epic'),
 ("bone_necklace", "Bone Necklace", "necklace", {"hp": 25, "str": 1}, [("bone", 6), ("rope", 1)], 6, 25, 'common'),
 ("emerald_amulet", "Emerald Amulet", "necklace", {"hp": 80, "vit": 4}, [("gold_bar", 1), ("emerald", 1)], 25, 200, 'rare'),
 ("woven_cape", "Woven Cape", "cape", {"def": 2, "mdef": 2}, [("linen", 4)], 4, 18, 'common'),
 ("silk_cape", "Silk Cape", "cape", {"def": 6, "mdef": 8, "agi": 2}, [("silk_cloth", 4), ("gold_bar", 1)], 28, 220, 'rare'),
]:
    item(id, name, f"{name}. Worn by any class.", f"armor:{slot}:{1 if lvl < 10 else 3 if lvl < 25 else 5}", 'armor', r, v, 1, lvl,
         maxDurability=None if slot in ('ring', 'necklace') else 300, equip={"slot": slot, "stats": stats})
    rec(f"jewel_{id}", "anvil" if slot != 'cape' else "loom", "smithing" if slot != 'cape' else "crafting", lvl, 20 + lvl * 3, 3 * lvl, inputs, id)
# Material processing
rec("tan_boar_hide", "workbench", "crafting", 2, 6, 1, [("boar_hide", 2)], "leather")
rec("tan_wolf_pelt", "workbench", "crafting", 8, 10, 1, [("wolf_pelt", 1)], "leather")
rec("weave_linen", "loom", "crafting", 1, 4, 0, [("plant_fiber", 4)], "linen")
rec("weave_silk", "loom", "crafting", 15, 18, 3, [("spider_silk", 3)], "silk_cloth")
rec("brew_enhancement_stone", "alchemy_table", "alchemy", 18, 30, 10, [("amethyst", 1), ("slime_gel", 4), ("glass_vial", 1)], "enhancement_stone")
rec("brew_enhancement_stone_2", "alchemy_table", "alchemy", 28, 45, 15, [("golem_core", 1), ("glass_vial", 1)], "enhancement_stone", 2)
save('items.json', items); save('recipes.json', recipes)

# --- Monsters --------------------------------------------------------------------------
def mon(id, name, hp, atk, de, speed, aggro, rng, cd, xp, gold, drops, shape, color, size=1.0, respawn=45, magic=False):
    m = {"id": id, "name": name, "hpMult": hp, "atkMult": atk, "defMult": de, "speed": speed, "aggro": aggro, "range": rng,
         "cooldownMs": cd, "xpMult": xp, "gold": gold, "drops": [{"itemId": a, "chance": b, "min": 1, "max": c} for (a, b, c) in drops],
         "art": {"shape": shape, "color": color, "size": size}, "respawnMs": respawn * 1000}
    if magic: m["magic"] = True
    return m
E = ("enhancement_stone",)
monsters = [
 mon("green_slime", "Green Slime", 0.9, 0.75, 0.6, 40, 0, 1.2, 1500, 0.9, [0, 2], [("slime_gel", 0.5, 2), ("minor_health_potion", 0.03, 1)], "slime", "#7cc35a"),
 mon("blue_slime", "Lake Slime", 1.0, 0.85, 0.7, 45, 0, 1.2, 1400, 1.0, [1, 3], [("slime_gel", 0.6, 2), ("minor_mana_potion", 0.04, 1)], "slime", "#5fa8e8"),
 mon("field_rat", "Field Rat", 0.75, 1.0, 0.7, 70, 4, 1.2, 1100, 1.0, [0, 3], [("rat_tail", 0.5, 1)], "rat", "#9a7a6a"),
 mon("wild_boar", "Wild Boar", 1.4, 1.1, 1.2, 62, 0, 1.3, 1600, 1.2, [1, 4], [("boar_hide", 0.5, 1), ("bone", 0.2, 1)], "boar", "#7a5a3a", 1.15),
 mon("forest_wolf", "Forest Wolf", 1.05, 1.25, 0.9, 88, 6, 1.3, 1150, 1.2, [2, 6], [("wolf_pelt", 0.45, 1), ("bone", 0.2, 1), ("enhancement_stone", 0.02, 1)], "wolf", "#8a8a92", 1.1),
 mon("goblin_scout", "Goblin Scout", 0.95, 1.1, 0.9, 66, 6, 1.4, 1250, 1.15, [4, 10], [("goblin_trinket", 0.25, 1), ("minor_health_potion", 0.06, 1), ("enhancement_stone", 0.04, 1)], "goblin", "#6f9a3c"),
 mon("giant_spider", "Giant Spider", 1.1, 1.2, 1.0, 76, 5, 1.3, 1200, 1.25, [3, 8], [("spider_silk", 0.5, 2), ("enhancement_stone", 0.03, 1)], "spider", "#3b3842", 1.15),
 mon("cave_bat", "Cave Bat", 0.7, 1.0, 0.6, 92, 6, 1.2, 1000, 0.95, [0, 3], [("bat_wing", 0.5, 1)], "bat", "#5a4670", 0.9),
 mon("skeleton", "Skeleton", 1.2, 1.15, 1.3, 56, 6, 1.4, 1300, 1.25, [3, 9], [("bone", 0.6, 2), ("enhancement_stone", 0.05, 1)], "skeleton", "#e8e0cc"),
 mon("orc", "Orc", 1.6, 1.35, 1.4, 60, 6, 1.4, 1500, 1.45, [8, 18], [("orc_tusk", 0.45, 1), ("enhancement_stone", 0.06, 1), ("health_potion", 0.05, 1)], "orc", "#5f8a3a", 1.25),
 mon("stone_golem", "Stone Golem", 2.4, 1.4, 2.0, 40, 4, 1.5, 2000, 1.8, [10, 25], [("golem_core", 0.3, 1), ("stone", 0.6, 4), ("enhancement_stone", 0.08, 1)], "golem", "#8b8a86", 1.45, 90),
 mon("dark_mage", "Dark Mage", 1.0, 1.5, 1.0, 55, 7, 5, 1800, 1.6, [10, 22], [("dark_essence", 0.35, 1), ("mana_potion", 0.06, 1), ("enhancement_stone", 0.08, 1)], "mage", "#4a2a6a", 1.0, 60, True),
]
save('monsters.json', monsters)

# --- Class skills ------------------------------------------------------------------------
def sk(id, cls, name, desc, lvl, mp, cd, kind, mult, magic, rng, icon, radius=None, maxt=None, eff=None):
    s = {"id": id, "classId": cls, "name": name, "description": desc, "level": lvl, "mp": mp, "cooldownMs": cd, "kind": kind,
         "mult": mult, "magic": magic, "range": rng, "icon": icon}
    if radius: s["radius"] = radius
    if maxt: s["maxTargets"] = maxt
    if eff: s["effect"] = eff
    return s
skills = [
 sk("power_strike", "warrior", "Power Strike", "A heavy blow for 180% damage.", 1, 6, 5000, "attack", 1.8, False, 1.6, "weapon:sword:2"),
 sk("war_cry", "warrior", "War Cry", "Roar: deal 30% more damage for 15s.", 5, 10, 30000, "buff", 0, False, 0, "essence:e0483a", eff={"id": "war_cry", "name": "War Cry", "durationMs": 15000, "mods": {"dmg": 1.3}}),
 sk("whirlwind", "warrior", "Whirlwind", "Spin, hitting every enemy around you for 120%.", 12, 16, 10000, "aoe", 1.2, False, 0, "weapon:axe:3", radius=1.8, maxt=6),
 sk("aimed_shot", "ranger", "Aimed Shot", "A careful shot for 200% damage.", 1, 6, 6000, "attack", 2.0, False, 7, "weapon:bow:2"),
 sk("hunters_mark", "ranger", "Hunter's Mark", "Mark a target: it takes 25% more damage for 12s.", 5, 8, 20000, "debuff", 0, False, 7, "essence:e8a03a", eff={"id": "marked", "name": "Marked", "durationMs": 12000, "mods": {"taken": 1.25}}),
 sk("volley", "ranger", "Volley", "Rain arrows on up to 4 enemies near the target for 90%.", 12, 14, 9000, "aoe", 0.9, False, 6, "weapon:bow:4", radius=2.0, maxt=4),
 sk("fireball", "mage", "Fireball", "Hurl fire for 220% magic damage.", 1, 8, 4000, "attack", 2.2, True, 6, "essence:f5a623"),
 sk("frost_nova", "mage", "Frost Nova", "Freeze nearby enemies: 100% damage and 50% slower for 6s.", 5, 14, 12000, "aoe", 1.0, True, 0, "essence:8fe0ff", radius=2.2, maxt=6, eff={"id": "chilled", "name": "Chilled", "durationMs": 6000, "mods": {"slow": 0.5}}),
 sk("arcane_shield", "mage", "Arcane Shield", "A barrier absorbs damage (4× Intelligence) for 20s.", 12, 16, 30000, "buff", 0, True, 0, "essence:4a7fd6", eff={"id": "arcane_shield", "name": "Arcane Shield", "durationMs": 20000, "mods": {"shield": 4}, "scale": "int"}),
 sk("heal", "priest", "Heal", "Restore HP to yourself or an ally (40 + 3× Intelligence).", 1, 10, 3000, "heal", 0, True, 6, "potion:7cc35a"),
 sk("smite", "priest", "Smite", "Holy light for 170% magic damage.", 5, 8, 5000, "attack", 1.7, True, 6, "essence:ffe48a"),
 sk("blessing", "priest", "Blessing", "Regenerate HP (1× Intelligence per second) for 15s.", 12, 14, 25000, "buff", 0, True, 0, "essence:fff6c8", eff={"id": "blessing", "name": "Blessing", "durationMs": 15000, "mods": {"regen": 1}, "scale": "int"}),
 sk("backstab", "rogue", "Backstab", "A vicious stab for 230% damage.", 1, 6, 5000, "attack", 2.3, False, 1.4, "weapon:dagger:2"),
 sk("poison_blade", "rogue", "Poison Blade", "Poison the target: 80% now, then damage every second for 8s.", 5, 10, 12000, "attack", 0.8, False, 1.4, "essence:7cc35a", eff={"id": "poison", "name": "Poisoned", "durationMs": 8000, "mods": {"dot": 1}, "scale": "str"}),
 sk("evasion", "rogue", "Evasion", "Double your evasion for 8s.", 12, 10, 25000, "buff", 0, False, 0, "essence:9a948a", eff={"id": "evasion", "name": "Evasion", "durationMs": 8000, "mods": {"eva": 2.0}}),
]
save('skills.json', skills)

classes = load('classes.json')
growth = {"warrior": {"strength": 2, "agility": 0.8, "intelligence": 0.3, "vitality": 1.8, "luck": 0.4},
          "ranger": {"strength": 1, "agility": 2, "intelligence": 0.5, "vitality": 1, "luck": 0.7},
          "mage": {"strength": 0.3, "agility": 0.8, "intelligence": 2.4, "vitality": 0.9, "luck": 0.6},
          "priest": {"strength": 0.6, "agility": 0.7, "intelligence": 2.0, "vitality": 1.3, "luck": 0.6},
          "rogue": {"strength": 1.3, "agility": 2, "intelligence": 0.4, "vitality": 0.9, "luck": 1}}
starter = {"warrior": "training_sword", "ranger": "training_bow", "mage": "training_staff", "priest": "training_mace", "rogue": "training_dagger"}
for c in classes:
    c["growth"] = growth[c["id"]]; c["starterWeapon"] = starter[c["id"]]
save('classes.json', classes)

shops = load('shops.json'); sh = {s['npcId']: s for s in shops}
sh['blacksmith_toren']['sells'] = [{"itemId": "worn_axe", "price": 25}, {"itemId": "copper_axe", "price": 180, "requires": {"skill": "woodcutting", "level": 8}}] + \
  [{"itemId": f"training_{w}", "price": 40} for w in WEAPONS] + [{"itemId": f"padded_{s}", "price": p} for (s, p) in [("head", 30), ("chest", 50), ("gloves", 25), ("boots", 25)]]
sh['merchant_mira']['sells'] = [{"itemId": "travelers_bread", "price": 10}, {"itemId": "glass_vial", "price": 5},
   {"itemId": "minor_health_potion", "price": 35}, {"itemId": "minor_mana_potion", "price": 35}]
sh['merchant_mira']['buys'] = ["crop", "seed", "material", "fish", "consumable", "tool", "weapon", "armor"]
save('shops.json', shops)
print(len(items), 'items', len(recipes), 'recipes', len(monsters), 'monsters', len(skills), 'skills')
