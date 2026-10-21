"""One-off generator for v0.8 regions: Frostpine Peaks and Mirefen Swamp (monsters, loot, NPCs, quests)."""
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
material('frost_shard', 'Frost Shard', 'A sliver of ice that never melts. Enchanters prize it.', 'essence:9fd8ff', 30, 'uncommon')
material('yeti_fur', 'Yeti Fur', 'Thick white fur, warm as a hearth.', 'hide:eef2f6', 22, 'uncommon')
material('bog_moss', 'Bog Moss', 'Spongy, smelly, and surprisingly useful in potions.', 'fiber', 14, 'common')
material('swamp_pearl', 'Swamp Pearl', 'A murky green pearl from the deep mire.', 'gem:6ad0a0', 60, 'rare')

def clone(src, id, name, desc, rarity, lvl, mult, vendor):
    d = copy.deepcopy(by[src])
    d.update(id=id, name=name, description=desc, rarity=rarity, levelRequirement=lvl, vendorValue=vendor, bind='equip')
    d['equip']['stats'] = {k: max(1, round(v * mult)) for k, v in d['equip']['stats'].items()}
    upsert(items, by, d)
    return id
giant = [clone('ruby_ring', 'frostbound_ring', 'Frostbound Ring', "Cut from the Frost Giant's crown. It frosts your breath.", 'epic', 26, 1.25, 500),
         clone('silk_cape', 'giants_mantle', "Giant's Mantle", 'A cloak that fell from enormous shoulders. Still fits, somehow.', 'epic', 26, 1.35, 450)]
witch = [clone('emerald_amulet', 'mirewitch_charm', 'Mirewitch Charm', 'A knot of bog-iron and green glass. Whispers at night.', 'rare', 30, 1.1, 300)]

def monster(id, name, shape, color, size, lv_hp, atk, df, speed, aggro, rng, cd, xp, gold, drops, magic=False, **extra):
    d = {"id": id, "name": name, "hpMult": lv_hp, "atkMult": atk, "defMult": df, "speed": speed, "aggro": aggro, "range": rng, "cooldownMs": cd,
         "xpMult": xp, "gold": gold, "drops": drops, "art": {"shape": shape, "color": color, "size": size}, "respawnMs": 50000}
    if magic: d["magic"] = True
    d.update(extra)
    upsert(monsters, mby, d)
dr = lambda i, c, a=1, b=1: {"itemId": i, "chance": c, "min": a, "max": b}
monster('snow_wolf', 'Snow Wolf', 'wolf', '#e8eef4', 1.15, 1.1, 1.3, 1.0, 92, 7, 1.3, 1100, 1.3, [6, 14], [dr('wolf_pelt', 0.5), dr('frost_shard', 0.08)])
monster('ice_wisp', 'Ice Wisp', 'bat', '#9fd8ff', 1.0, 0.85, 1.4, 0.8, 85, 7, 4.5, 1700, 1.35, [6, 14], [dr('frost_shard', 0.25)], magic=True)
monster('frost_yeti', 'Frost Yeti', 'golem', '#dfe8f0', 1.5, 2.0, 1.45, 1.6, 52, 5, 1.5, 1800, 1.8, [12, 26], [dr('yeti_fur', 0.6, 1, 2), dr('frost_shard', 0.15), dr('enhancement_stone', 0.04)])
monster('bog_lurker', 'Bog Lurker', 'slime', '#4a6a3a', 1.45, 1.6, 1.35, 1.3, 50, 4, 1.4, 1500, 1.5, [10, 20], [dr('bog_moss', 0.6, 1, 3), dr('slime_gel', 0.5, 1, 2)])
monster('swamp_troll', 'Swamp Troll', 'orc', '#3f7a6a', 1.4, 1.9, 1.5, 1.5, 58, 6, 1.5, 1600, 1.75, [14, 30], [dr('bog_moss', 0.4), dr('swamp_pearl', 0.06), dr('orc_tusk', 0.3)])
monster('marsh_witch', 'Marsh Witch', 'mage', '#3a6a3a', 1.0, 1.1, 1.6, 1.1, 55, 8, 5, 1800, 1.8, [16, 32], [dr('dark_essence', 0.12), dr('swamp_pearl', 0.08), dr(witch[0], 0.02)], magic=True)
# World boss: roams the high peaks, respawns every 30 minutes.
monster('frost_giant', 'Hrimnir the Frost Giant', 'orc', '#a8c8e8', 2.4, 14, 1.6, 1.7, 48, 7, 2.0, 2000, 18, [400, 700],
        [dr(giant[0], 0.15), dr(giant[1], 0.15), dr('frost_shard', 1, 3, 6), dr('enhancement_stone', 1, 3, 5), dr('dungeon_key', 1)],
        boss=True, respawnMs=1800000,
        abilities=[
          {"id": "glacier_stomp", "name": "Glacier Stomp", "kind": "nova", "everyMs": 11000, "windupMs": 1800, "radius": 3.5, "dmgMult": 1.8},
          {"id": "ice_boulder", "name": "Ice Boulder", "kind": "slam", "everyMs": 7000, "windupMs": 1500, "radius": 2.2, "dmgMult": 2.1},
          {"id": "winter_call", "name": "Call of Winter", "kind": "summon", "atHp": [0.6, 0.3], "monster": "snow_wolf", "count": 3, "level": 24},
          {"id": "frenzy", "name": "Frenzy", "kind": "enrage", "atHp": [0.2], "dmg": 1.4}])

save('items.json', items)
save('monsters.json', monsters)

npcs = load('npcs.json'); nby = {n['id']: n for n in npcs}
upsert(npcs, nby, {"id": "scout_bjorna", "name": "Scout Bjorna", "title": "Mountain Scout", "mapId": "frostpine_peaks", "x": 9, "y": 21, "dir": "right",
  "appearance": {"bodyType": "b", "skinTone": 0, "hairStyle": 2, "hairColor": 7, "eyeColor": 2, "outfit": 3}, "accessory": "hat",
  "firstMeeting": {"lines": ["Bjorna. I scout the peaks for the Guild.", "Wolves on the slopes, yetis by the frozen lake — and up north, the Frost Giant himself.",
                             "He wakes every half hour or so. Bring a crowd if you mean to fight him."]},
  "greetings": [["Snow's deep today. Watch your step."], ["Seen the giant? You'd know if you had."]], "services": []})
upsert(npcs, nby, {"id": "hunter_moss", "name": "Hunter Moss", "title": "Witch Hunter", "mapId": "mirefen_swamp", "x": 7, "y": 18, "dir": "right",
  "appearance": {"bodyType": "a", "skinTone": 4, "hairStyle": 1, "hairColor": 1, "eyeColor": 4, "outfit": 5}, "accessory": "hood",
  "firstMeeting": {"lines": ["Moss. I hunt what hides in the mire.", "Trolls by the water, lurkers in the mud, and witches in the old ruins east.",
                             "Fog's thick here more days than not. Stay on the boardwalks when you can."]},
  "greetings": [["Smell that? That's the swamp saying hello."], ["The witches brew at night. That's when they're weakest — or so I tell myself."]], "services": []})
save('npcs.json', npcs)

quests = load('quests.json'); qby = {q['id']: q for q in quests}
upsert(quests, qby, {"id": "q_peaks", "name": "Into the Frostpine", "giver": "lift_gus", "turnIn": "scout_bjorna", "requires": "q_crypt",
  "description": "The mountain path east of the mine yard climbs into snow. Level 20+ recommended.",
  "intro": ["You've got the look of someone who's outgrown the forest.", "Take the east path from my yard up into the Frostpine Peaks. Bjorna the scout will want to meet you."],
  "outro": ["Six wolves and two yetis? The slopes are safer already.", "When you're ready for real heat, there's a hollow by Irondeep I need to tell you about."],
  "steps": [
    {"text": "Climb into the Frostpine Peaks (east path from the Irondeep yard)", "type": "visit", "count": 1, "target": "frostpine_peaks", "where": {"map": "irondeep_entrance", "x": 39, "y": 19}},
    {"text": "Defeat 6 Snow Wolves", "type": "kill", "count": 6, "target": "snow_wolf", "where": {"map": "frostpine_peaks", "x": 22, "y": 30}},
    {"text": "Defeat 2 Frost Yetis (by the frozen lake)", "type": "kill", "count": 2, "target": "frost_yeti", "where": {"map": "frostpine_peaks", "x": 40, "y": 16}}],
  "rewards": {"gold": 900, "xp": 5200, "items": [{"itemId": "enhancement_stone", "quantity": 3}]}})
q = qby['q_ember']; q['requires'] = 'q_peaks'; q['giver'] = 'scout_bjorna'
q['intro'] = ["From up here you can see it — smoke from a crack beside Irondeep.", "The miners call it Ember Hollow. Something called the Magma Tyrant rules it. Bring your best friends and your best armor."]
upsert(quests, qby, {"id": "q_mire", "name": "Witches of the Mire", "giver": "lift_gus", "turnIn": "hunter_moss", "requires": "q_ember",
  "description": "East of Sunfield, the land sinks into Mirefen Swamp. Level 28+ recommended.",
  "intro": ["One last job, legend. The farmers say the swamp east of Sunfield is creeping closer.", "Hunter Moss is out there. Help her thin out the trolls and the witches."],
  "outro": ["Five trolls, three witches. The mire's quieter than it's been in years.", "Keep that charm close if you find one. They whisper, but they protect."],
  "steps": [
    {"text": "Enter Mirefen Swamp (east lane of Sunfield)", "type": "visit", "count": 1, "target": "mirefen_swamp", "where": {"map": "sunfield_plains", "x": 59, "y": 21}},
    {"text": "Defeat 5 Swamp Trolls", "type": "kill", "count": 5, "target": "swamp_troll", "where": {"map": "mirefen_swamp", "x": 26, "y": 30}},
    {"text": "Defeat 3 Marsh Witches (eastern ruins)", "type": "kill", "count": 3, "target": "marsh_witch", "where": {"map": "mirefen_swamp", "x": 50, "y": 14}}],
  "rewards": {"gold": 2500, "xp": 16000, "items": [{"itemId": "enhancement_stone", "quantity": 6}, {"itemId": "swamp_pearl", "quantity": 2}]}})
save('quests.json', quests)
print('ok')
