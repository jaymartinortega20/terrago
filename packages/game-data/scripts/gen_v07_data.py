"""One-off generator for v0.7 dungeons: trash monsters, bosses with abilities, boss loot, dungeons.json."""
import json, os, copy
D = os.path.join(os.path.dirname(__file__), '..', 'data')
load = lambda n: json.load(open(os.path.join(D, n)))
def save(n, v): open(os.path.join(D, n), 'w').write(json.dumps(v, indent=1) + "\n")

items = load('items.json'); by = {i['id']: i for i in items}
monsters = load('monsters.json'); mby = {m['id']: m for m in monsters}

def upsert_item(d):
    if d['id'] in by: by[d['id']].clear(); by[d['id']].update(d)
    else: items.append(d); by[d['id']] = d

def clone(src, id, name, desc, rarity, lvl, mult, vendor):
    d = copy.deepcopy(by[src])
    d.update(id=id, name=name, description=desc, rarity=rarity, levelRequirement=lvl, vendorValue=vendor, bind='equip')
    d['equip']['stats'] = {k: max(1, round(v * mult)) for k, v in d['equip']['stats'].items()}
    upsert_item(d)
    return id

# --- Boss loot -------------------------------------------------------------------------
crypt = [
 clone('silver_sword', 'cryptbone_blade', 'Cryptbone Blade', 'Forged from the Crypt Lord\'s own ribs. It hums near the dead.', 'rare', 14, 0.95, 180),
 clone('silver_bow', 'cryptbone_bow', 'Cryptbone Bow', 'Strung with grave-silk. Arrows fly silent.', 'rare', 14, 0.95, 180),
 clone('silver_staff', 'cryptbone_staff', 'Cryptbone Staff', 'A lich\'s spine, set with a cold blue eye.', 'rare', 14, 0.95, 180),
 clone('silver_mace', 'cryptbone_mace', 'Cryptbone Mace', 'Heavy, holy-scratched, and still faintly warm.', 'rare', 14, 0.95, 180),
 clone('silver_dagger', 'cryptbone_dagger', 'Cryptbone Dagger', 'A finger-bone sharpened to a whisper.', 'rare', 14, 0.95, 180),
 clone('silver_head', 'crypt_lords_cowl', "Crypt Lord's Cowl", 'Moth-eaten velvet that refuses to rot.', 'rare', 14, 1.0, 120),
 clone('sapphire_ring', 'crypt_signet', 'Crypt Signet', 'The seal of a forgotten house. Cold to the touch.', 'rare', 14, 0.9, 200),
]
ember = [
 clone('gold_sword', 'magmaforged_sword', 'Magmaforged Sword', 'Quenched in the Tyrant\'s heart. The edge never cools.', 'epic', 30, 1.15, 600),
 clone('gold_bow', 'magmaforged_bow', 'Magmaforged Bow', 'Arrows leave a trail of sparks.', 'epic', 30, 1.15, 600),
 clone('gold_staff', 'magmaforged_staff', 'Magmaforged Staff', 'A rod of obsidian with a living ember inside.', 'epic', 30, 1.15, 600),
 clone('gold_mace', 'magmaforged_mace', 'Magmaforged Mace', 'Each blow hisses like a forge.', 'epic', 30, 1.15, 600),
 clone('gold_dagger', 'magmaforged_dagger', 'Magmaforged Dagger', 'Too hot to sheathe. Rogues carry it anyway.', 'epic', 30, 1.15, 600),
 clone('gold_chest', 'tyrant_carapace', 'Tyrant Carapace', 'A plate of cooled magma shell, shaped to fit.', 'epic', 30, 1.15, 400),
 clone('emerald_amulet', 'ember_heart', 'Ember Heart', 'It beats. Slowly. Warmly.', 'epic', 30, 1.2, 500),
]
upsert_item({"id": "dungeon_key", "name": "Dungeon Sigil", "description": "Proof of a boss defeated. Collectors pay well for these.", "icon": "gem:b06ad6",
             "category": "material", "rarity": "rare", "stackSize": 99, "vendorValue": 15, "levelRequirement": 1, "tradable": False, "bind": "pickup", "maxDurability": None})
by["dungeon_key"]["vendorValue"] = 40

def drops(loot, chance):
    return [{"itemId": i, "chance": chance, "min": 1, "max": 1} for i in loot]

def monster(d):
    if d['id'] in mby: mby[d['id']].clear(); mby[d['id']].update(d)
    else: monsters.append(d); mby[d['id']] = d

# --- Trash ---------------------------------------------------------------------------------
monster({"id": "crypt_ghoul", "name": "Crypt Ghoul", "hpMult": 1.3, "atkMult": 1.2, "defMult": 1.0, "speed": 64, "aggro": 6, "range": 1.3, "cooldownMs": 1300,
         "xpMult": 1.35, "gold": [4, 10], "drops": [{"itemId": "bone", "chance": 0.5, "min": 1, "max": 2}, {"itemId": "dark_essence", "chance": 0.04, "min": 1, "max": 1}],
         "art": {"shape": "goblin", "color": "#7d8f6a", "size": 1.1}, "respawnMs": 60000})
monster({"id": "fire_imp", "name": "Fire Imp", "hpMult": 0.9, "atkMult": 1.45, "defMult": 0.9, "speed": 80, "aggro": 7, "range": 4.5, "cooldownMs": 1600, "magic": True,
         "xpMult": 1.5, "gold": [8, 18], "drops": [{"itemId": "coal", "chance": 0.4, "min": 1, "max": 3}, {"itemId": "enhancement_stone", "chance": 0.05, "min": 1, "max": 1}],
         "art": {"shape": "goblin", "color": "#d8502a", "size": 0.9}, "respawnMs": 60000})

# --- Bosses ---------------------------------------------------------------------------------
monster({"id": "crypt_lord", "name": "Crypt Lord Varn", "boss": True, "hpMult": 9, "atkMult": 1.55, "defMult": 1.4, "speed": 58, "aggro": 7, "range": 1.8, "cooldownMs": 1700,
         "xpMult": 14, "gold": [180, 320],
         "drops": drops(crypt[:5], 0.1) + drops(crypt[5:], 0.15) + [{"itemId": "enhancement_stone", "chance": 1, "min": 2, "max": 4}, {"itemId": "dungeon_key", "chance": 1, "min": 1, "max": 1}],
         "art": {"shape": "skeleton", "color": "#9b59d0", "size": 2.0}, "respawnMs": 600000,
         "abilities": [
          {"id": "bone_slam", "name": "Bone Slam", "kind": "slam", "everyMs": 8000, "windupMs": 1500, "radius": 2.2, "dmgMult": 2.2},
          {"id": "raise_dead", "name": "Raise the Dead", "kind": "summon", "atHp": [0.7, 0.4], "monster": "skeleton", "count": 3, "level": 12},
          {"id": "grave_nova", "name": "Grave Nova", "kind": "nova", "everyMs": 15000, "windupMs": 2200, "radius": 3.5, "dmgMult": 1.7},
          {"id": "undying_rage", "name": "Undying Rage", "kind": "enrage", "atHp": [0.25], "dmg": 1.4}
         ]})
monster({"id": "magma_tyrant", "name": "Magma Tyrant", "boss": True, "hpMult": 12, "atkMult": 1.6, "defMult": 1.6, "speed": 50, "aggro": 7, "range": 2.0, "cooldownMs": 1900,
         "xpMult": 16, "gold": [500, 900],
         "drops": drops(ember[:5], 0.1) + drops(ember[5:], 0.15) + [{"itemId": "enhancement_stone", "chance": 1, "min": 4, "max": 7}, {"itemId": "dungeon_key", "chance": 1, "min": 2, "max": 2}, {"itemId": "golem_core", "chance": 0.5, "min": 1, "max": 2}],
         "art": {"shape": "golem", "color": "#e0602a", "size": 2.2}, "respawnMs": 600000,
         "abilities": [
          {"id": "magma_slam", "name": "Magma Slam", "kind": "slam", "everyMs": 7000, "windupMs": 1400, "radius": 2.5, "dmgMult": 2.3},
          {"id": "eruption", "name": "Eruption", "kind": "nova", "everyMs": 13000, "windupMs": 2000, "radius": 4, "dmgMult": 1.8},
          {"id": "call_imps", "name": "Call of the Forge", "kind": "summon", "atHp": [0.75, 0.5, 0.25], "monster": "fire_imp", "count": 2, "level": 28},
          {"id": "molten_fury", "name": "Molten Fury", "kind": "enrage", "atHp": [0.2], "dmg": 1.5}
         ]})

dungeons = [
 {"id": "mossy_crypt", "name": "The Mossy Crypt", "levels": [10, 16], "seed": 7717, "floor": "k", "wall": "r",
  "entrance": {"map": "whisperwood", "x": 10, "y": 15}, "exit": {"mapId": "whisperwood", "x": 11, "y": 19},
  "rooms": 4, "props": ["bones", "ruin_pillar", "stalagmite"],
  "trash": [{"monster": "skeleton", "level": [11, 13], "count": 3}, {"monster": "crypt_ghoul", "level": [12, 14], "count": 2}, {"monster": "giant_spider", "level": [12, 14], "count": 1}],
  "boss": {"monster": "crypt_lord", "level": 16}},
 {"id": "ember_hollow", "name": "Ember Hollow", "levels": [26, 32], "seed": 4242, "floor": "a", "wall": "r",
  "entrance": {"map": "irondeep_entrance", "x": 29, "y": 10}, "exit": {"mapId": "irondeep_entrance", "x": 30, "y": 14},
  "rooms": 5, "props": ["stalagmite", "crystal", "bones"], "lava": True,
  "trash": [{"monster": "orc", "level": [26, 28], "count": 3}, {"monster": "fire_imp", "level": [27, 29], "count": 2}, {"monster": "stone_golem", "level": [28, 30], "count": 1}],
  "boss": {"monster": "magma_tyrant", "level": 32}},
]

save('items.json', items)
save('monsters.json', monsters)
save('dungeons.json', dungeons)
print('ok', len(items), len(monsters))

# --- Warden NPC and dungeon quests ------------------------------------------------
npcs = load('npcs.json'); nby = {n['id']: n for n in npcs}
warden = {"id": "warden_sela", "name": "Warden Sela", "title": "Dungeon Warden", "mapId": "whisperwood", "x": 14, "y": 19, "dir": "down",
  "appearance": {"bodyType": "b", "skinTone": 1, "hairStyle": 5, "hairColor": 2, "eyeColor": 1, "outfit": 4}, "accessory": "hood",
  "firstMeeting": {"lines": [
    "Sela. I watch the crypt so the crypt doesn't come out to watch you.",
    "Inside, your whole party shares one dungeon. Enter together, or your friends will follow you in.",
    "The boss winds up big attacks — when the ground glows red under you, MOVE. Its treasure is yours once a day."]},
  "greetings": [["Glowing red circle? Step out of it. That's the whole lesson."], ["Back from the crypt in one piece? Good."]],
  "services": []}
if 'warden_sela' in nby: nby['warden_sela'].clear(); nby['warden_sela'].update(warden)
else: npcs.append(warden)
save('npcs.json', npcs)

quests = load('quests.json'); qby = {q['id']: q for q in quests}
def quest(q):
    if q['id'] in qby: qby[q['id']].clear(); qby[q['id']].update(q)
    else: quests.append(q)
quest({"id": "q_crypt", "name": "The Mossy Crypt", "giver": "guildmaster_kael", "turnIn": "warden_sela", "requires": "q_wolves",
  "description": "Something old stirs beneath Whisperwood. Level 12+ and a party recommended.",
  "intro": ["The Guild's had word from Warden Sela in Whisperwood. The dead are walking in the old crypt.",
            "Gather friends — a party shares the dungeon and the experience. Put Crypt Lord Varn back in his grave."],
  "outro": ["Varn's down? Then the forest sleeps easier tonight.", "Keep what he dropped. He won't need it. And come back tomorrow — he never stays dead."],
  "steps": [
    {"text": "Enter the Mossy Crypt (north-west Whisperwood)", "type": "visit", "count": 1, "target": "dg_mossy_crypt", "where": {"map": "whisperwood", "x": 11, "y": 17}},
    {"text": "Defeat Crypt Lord Varn (the far chamber)", "type": "kill", "count": 1, "target": "crypt_lord"}],
  "rewards": {"gold": 600, "xp": 2600, "items": [{"itemId": "enhancement_stone", "quantity": 3}]}})
quest({"id": "q_ember", "name": "Heart of the Mountain", "giver": "warden_sela", "turnIn": "lift_gus", "requires": "q_crypt",
  "description": "A furnace-hot hollow has cracked open beside Irondeep. Level 26+ and a strong party recommended.",
  "intro": ["The miners broke into something hot beside Irondeep. Gus says the walls glow.",
            "Something called the Magma Tyrant rules it. Bring your best friends and your best armor."],
  "outro": ["The Tyrant's cold? Then my lift stops shaking. Ha!", "You're a proper legend now. The whole valley will hear of it."],
  "steps": [
    {"text": "Enter Ember Hollow (east of the Irondeep mine yard)", "type": "visit", "count": 1, "target": "dg_ember_hollow", "where": {"map": "irondeep_entrance", "x": 30, "y": 12}},
    {"text": "Defeat the Magma Tyrant", "type": "kill", "count": 1, "target": "magma_tyrant"}],
  "rewards": {"gold": 2000, "xp": 12000, "items": [{"itemId": "enhancement_stone", "quantity": 6}]}})
save('quests.json', quests)
print('npcs/quests ok')
