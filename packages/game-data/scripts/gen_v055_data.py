"""v0.5.5 data: shields, mounts, stablemaster, starter quest chain."""
import json, os
D = os.path.join(os.path.dirname(__file__), '..', 'data')
load = lambda n: json.load(open(os.path.join(D, n)))
def save(n, v): open(os.path.join(D, n), 'w').write(json.dumps(v, indent=1) + "\n")
items = load('items.json'); by = {i['id']: i for i in items}
def item(id, name, desc, icon, cat, rarity='common', vendor=1, stack=1, lvl=1, **extra):
    d = {"id": id, "name": name, "description": desc, "icon": icon, "category": cat, "rarity": rarity, "stackSize": stack,
         "vendorValue": vendor, "levelRequirement": lvl, "tradable": True, "bind": "none", "maxDurability": None}
    d.update(extra)
    if id in by: by[id].update(d)
    else: items.append(d); by[id] = d
recipes = [r for r in load('recipes.json') if not r['id'].startswith('forge_shield_')]
TIERS = [("Wooden",1,0,None,6),("Copper",5,1,"copper_bar",30),("Iron",12,2,"iron_bar",90),("Silver",22,3,"silver_bar",220),
         ("Gold",32,4,"gold_bar",450),("Mithril",42,5,"mithril_bar",900),("Obsidian",56,6,"obsidian_bar",1800),("Star Metal",70,7,"star_metal_bar",4000)]
RAR = ['common','common','common','uncommon','uncommon','rare','epic','legendary']
for t,(tn,lvl,mt,bar,v) in enumerate(TIERS):
    id = f"{tn.lower().replace(' ','_')}_shield"
    item(id, f"{tn} Shield", f"A {tn.lower()} shield. Warriors only; blocks blows and spells.", f"weapon:shield:{mt}", 'armor', RAR[t], max(4, v//2), 1, lvl,
         maxDurability=220+t*110, equip={"slot":"offhand","weapon":"shield","stats":{"def":2+t*4,"mdef":1+t*3,"hp":10*t},"classes":["warrior"]})
    if bar:
        recipes.append({"id":f"forge_shield_{id}","station":"anvil","skill":"smithing","level":max(1,lvl-1),"xp":14+t*18,"fee":4*t*t,
                        "inputs":[{"itemId":bar,"quantity":3+t},{"itemId":"hardwood_plank" if t>=2 else "softwood_plank","quantity":2}],"output":{"itemId":id,"quantity":1}})
for (id,name,desc,speed,color,kind,lvl,v,r) in [
 ("brown_pony","Brown Pony","A sturdy little pony. Faster than walking — much faster than walking.",1.45,"#8a5d33","horse",1,40,'common'),
 ("chestnut_horse","Chestnut Horse","A proper riding horse with a steady gait.",1.65,"#b5643a","horse",10,400,'uncommon'),
 ("swift_steed","Swift Steed","Bred for the long roads between regions.",1.85,"#e8e0cc","horse",22,1500,'rare'),
 ("forest_stag","Forest Stag","A proud stag from deep Whisperwood. Graceful and quick.",2.0,"#a8743f","stag",32,4000,'epic'),
 ("war_wolf","War Wolf","A great grey wolf that answers only to the bold.",2.15,"#8a8a92","wolf",45,9000,'legendary'),
]:
    item(id, name, desc, f"mount:{kind}:{color[1:]}", 'mount', r, v, 1, lvl, bind="pickup", mount={"speed":speed,"color":color,"kind":kind})
save('items.json', items); save('recipes.json', recipes)

shops = load('shops.json'); shops = [s for s in shops if s['npcId']!='stablemaster_hana']
shops.append({"npcId":"stablemaster_hana","name":"Hana's Stable","sells":[
  {"itemId":"chestnut_horse","price":2500},{"itemId":"swift_steed","price":9000},{"itemId":"forest_stag","price":24000},{"itemId":"war_wolf","price":60000}],"buys":[]})
tsh = {s['npcId']: s for s in shops}['blacksmith_toren']
tsh['sells'] = [e for e in tsh['sells'] if e['itemId']!='wooden_shield'] + [{"itemId":"wooden_shield","price":40}]
save('shops.json', shops)

npcs = load('npcs.json'); npcs = [n for n in npcs if n['id']!='stablemaster_hana']
npcs.append({"id":"stablemaster_hana","name":"Stablemaster Hana","title":"Stables","mapId":"greenhaven","x":44,"y":23,"dir":"left",
 "appearance":{"bodyType":"b","skinTone":3,"hairStyle":3,"hairColor":6,"eyeColor":3,"outfit":2},"accessory":"bandana",
 "firstMeeting":{"lines":["Hana. I keep the horses. You look like someone who's tired of walking.","Mayor Lina told me to expect you — here's a pony from the town herd. Press Z to ride, Z again to get off.","Mounts don't like fights or tight mine tunnels. Come back when you've got gold; I've faster beasts."]},
 "greetings":[["Faster mounts cost more — and they're worth every coin."],["A pony carries a farmer; a stag carries a legend."]],
 "services":["shop"]})
save('npcs.json', npcs)

def step(text, type, target=None, count=1):
    s = {"text": text, "type": type, "count": count}
    if target: s["target"] = target
    return s
quests = [
 {"id":"q_welcome","name":"Welcome to Greenhaven","description":"Every new arrival should meet the mayor.",
  "steps":[step("Talk to Mayor Lina by the fountain","talk","mayor_lina")],"rewards":{"gold":20,"xp":20},"next":"q_pony"},
 {"id":"q_pony","name":"A Horse of Your Own","description":"Walking everywhere is slow. Hana has something for you.",
  "steps":[step("Talk to Stablemaster Hana on the east side of the plaza","talk","stablemaster_hana"),step("Press Z to ride your pony","mount")],
  "rewards":{"gold":10,"xp":20,"items":[]},"grantOnStart":{"step":0,"items":[]},"next":"q_homestead"},
 {"id":"q_homestead","name":"A Patch of Your Own","description":"Your homestead is west along the Sunfield lane, through the south gate.",
  "steps":[step("Go to your Homestead (south gate, then west along the lane)","visit","homestead"),step("Till, plant, water and harvest a Carrot","harvest","carrot")],
  "rewards":{"gold":15,"xp":30,"items":[{"itemId":"carrot_seed","quantity":6}]},"next":"q_rowan"},
 {"id":"q_rowan","name":"The Farmer's Friend","description":"Rowan sells seeds and buys crops at the Farm Supply in Greenhaven.",
  "steps":[step("Talk to Farmer Rowan at the Farm Supply (south-west Greenhaven)","talk","farmer_rowan")],
  "rewards":{"gold":10,"xp":15,"items":[{"itemId":"basic_fertilizer","quantity":2}]},"next":"q_pickaxe"},
 {"id":"q_pickaxe","name":"Tools of the Trade","description":"Miner Bram sells pickaxes near the north road.",
  "steps":[step("Buy a Worn Pickaxe from Miner Bram (north Greenhaven)","buy","worn_pickaxe"),step("Mine 5 Copper Ore (Sunfield's north meadow or the mine)","gather","copper_ore",5)],
  "rewards":{"gold":30,"xp":40},"next":"q_smelt"},
 {"id":"q_smelt","name":"Fire and Metal","description":"The furnace stands east of the Blacksmith.",
  "steps":[step("Smelt a Copper Bar at the furnace (east of the Blacksmith)","craft","copper_bar")],
  "rewards":{"gold":20,"xp":40,"items":[{"itemId":"padded_head","quantity":1}]},"next":"q_slimes"},
 {"id":"q_slimes","name":"Slime Trouble","description":"Slimes are eating Sunfield's crops. Press F to attack.",
  "steps":[step("Defeat 5 Green Slimes in Sunfield Plains (F to attack)","kill","green_slime",5)],
  "rewards":{"gold":40,"xp":60,"items":[{"itemId":"minor_health_potion","quantity":3}]},"next":"q_fishing"},
 {"id":"q_fishing","name":"Gone Fishing","description":"Fisher Olan stands by the pond in south-east Greenhaven.",
  "steps":[step("Buy a Bamboo Rod from Fisher Olan (pond, south-east Greenhaven)","buy","bamboo_rod"),step("Catch any fish (face water, E to cast, E on the bite, hold Space)","fish")],
  "rewards":{"gold":30,"xp":50},"next":"q_mine"},
 {"id":"q_mine","name":"Down Below","description":"Irondeep Mine is north of Greenhaven. Gus runs a lift every five floors.",
  "steps":[step("Reach floor 5 of Irondeep Mine (north road)","visit","irondeep_5")],
  "rewards":{"gold":80,"xp":120,"items":[{"itemId":"enhancement_stone","quantity":1}]},"next":"q_wolves"},
 {"id":"q_wolves","name":"Whisperwood Warning","description":"Wolves are prowling Whisperwood Forest (Lv 10+). Get strong first.",
  "steps":[step("Enter Whisperwood Forest (west road)","visit","whisperwood"),step("Defeat 5 Forest Wolves","kill","forest_wolf",5)],
  "rewards":{"gold":200,"xp":400,"items":[{"itemId":"enhancement_stone","quantity":2}]}},
]
# pony is granted when the Hana talk step completes
quests[1]["stepRewards"] = {"0": [{"itemId":"brown_pony","quantity":1}]}
del quests[1]["grantOnStart"]
save('quests.json', quests)
print(len(items), "items")
