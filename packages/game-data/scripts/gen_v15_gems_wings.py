"""TerraGo revision, phase 3: upgrade gems from mining, and wings.

- Gem rocks: Ruby and Sapphire veins in the Desolate Crags (low tier), Sapphire
  and Diamond veins in the Glacial Depths (high tier).
- Wings: back-slot gear with their own look. Fairy (Gnarlfang), Angel and Demon
  (Dragon's Peak champions), Dragon (Pyraxis).
- The blacksmith does upgrades.

Run from the repo root: python3 packages/game-data/scripts/gen_v15_gems_wings.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


GEM_NODES = [
    {"id": "gem_ruby", "name": "Ruby Vein", "skill": "mining", "tool": "pickaxe", "toolTier": 2, "level": 41, "yields": 2, "respawnMs": 240000, "xp": 70, "energy": 2,
     "drops": [{"itemId": "ruby", "chance": 1.0, "min": 1, "max": 1}, {"itemId": "stone", "chance": 0.5, "min": 1, "max": 2}], "art": {"kind": "crystal", "color": "#e0483a"}, "solid": True},
    {"id": "gem_sapphire", "name": "Sapphire Vein", "skill": "mining", "tool": "pickaxe", "toolTier": 2, "level": 55, "yields": 2, "respawnMs": 300000, "xp": 95, "energy": 2,
     "drops": [{"itemId": "sapphire", "chance": 1.0, "min": 1, "max": 1}, {"itemId": "stone", "chance": 0.5, "min": 1, "max": 2}], "art": {"kind": "crystal", "color": "#4a7fd6"}, "solid": True},
    {"id": "gem_diamond", "name": "Diamond Vein", "skill": "mining", "tool": "pickaxe", "toolTier": 3, "level": 75, "yields": 2, "respawnMs": 420000, "xp": 150, "energy": 3,
     "drops": [{"itemId": "diamond", "chance": 1.0, "min": 1, "max": 1}, {"itemId": "crystal_ore", "chance": 0.4, "min": 1, "max": 1}], "art": {"kind": "crystal", "color": "#dff4ff"}, "solid": True},
]


def wings(id, name, desc, rarity, level, value, color, style, stats):
    return {"id": id, "name": name, "description": desc, "icon": f"wings:{style}:{color.lstrip('#')}", "category": "armor", "rarity": rarity, "stackSize": 1,
            "vendorValue": value, "levelRequirement": level, "tradable": True, "bind": "equip", "maxDurability": 400,
            "equip": {"slot": "cape", "stats": stats}, "wings": {"style": style, "color": color}}


WINGS = [
    wings("fairy_wings", "Fairy Wings", "Delicate, shimmering wings. They hum softly when you move.", "rare", 30, 1200, "#9fe8ff", "fairy", {"agi": 4, "mdef": 6, "def": 3}),
    wings("angel_wings", "Angel Wings", "Pure white feathers that never get dirty.", "epic", 70, 6000, "#fff6e8", "angel", {"def": 12, "mdef": 18, "int": 6, "vit": 4}),
    wings("demon_wings", "Demon Wings", "Leathery and dark. Warm to the touch.", "epic", 70, 6000, "#6a1a3a", "demon", {"def": 14, "mdef": 10, "str": 6, "luk": 4}),
    wings("dragon_wings", "Dragon Wings", "Torn from the Infernal Titan's brood. Embers drift from them.", "legendary", 95, 25000, "#d0301a", "dragon", {"def": 24, "mdef": 22, "str": 8, "agi": 6, "vit": 8}),
]

DROPS = {
    "fields_warden": [{"itemId": "fairy_wings", "chance": 0.15, "min": 1, "max": 1}],
    "drake_champion": [{"itemId": "demon_wings", "chance": 0.04, "min": 1, "max": 1}, {"itemId": "diamond", "chance": 0.2, "min": 1, "max": 1}],
    "dragon_knight_champion": [{"itemId": "angel_wings", "chance": 0.04, "min": 1, "max": 1}, {"itemId": "diamond", "chance": 0.2, "min": 1, "max": 1}],
    "infernal_titan": [{"itemId": "dragon_wings", "chance": 0.25, "min": 1, "max": 1}, {"itemId": "diamond", "chance": 1.0, "min": 2, "max": 4}],
    "rock_golem": [{"itemId": "ruby", "chance": 0.03, "min": 1, "max": 1}],
    "frost_giant_brute": [{"itemId": "sapphire", "chance": 0.04, "min": 1, "max": 1}],
}


def main():
    nodes = load("nodes.json")
    have = {n["id"] for n in nodes}
    nodes += [n for n in GEM_NODES if n["id"] not in have]
    save("nodes.json", nodes)

    items = load("items.json")
    have = {i["id"] for i in items}
    items += [w for w in WINGS if w["id"] not in have]
    for it in items:
        if it["id"] in ("ruby", "sapphire", "diamond"):
            tier = {"ruby": "+1 to +3", "sapphire": "+4 to +6", "diamond": "+7 to +10"}[it["id"]]
            it["description"] = f"A rough {it['name'].lower()}. The blacksmith uses it to upgrade gear from {tier}."
        if it["id"] == "enhancement_stone":
            it["description"] = "A blessed stone. The blacksmith accepts it instead of a Ruby for upgrades up to +3."
    save("items.json", items)

    monsters = load("monsters.json")
    for m in monsters:
        for d in DROPS.get(m["id"], []):
            if not any(x["itemId"] == d["itemId"] for x in m["drops"]):
                m["drops"].append(d)
    save("monsters.json", monsters)

    npcs = load("npcs.json")
    for n in npcs:
        if n["id"] == "blacksmith_toren" and "enhance" not in n["services"]:
            n["services"].append("enhance")
    save("npcs.json", npcs)
    print("nodes", len(nodes), "items", len(items))


if __name__ == "__main__":
    main()
