"""TerraGo: food buffs and pet evolution.

- Cooked dishes give a "Well Fed" buff on top of their HP/Energy (one at a time).
- Two new late-game dishes.
- Evolution Stone: evolves a pet at level 30 (1 stone) and 60 (3 stones).
  Sold by Stablemaster Hana; dropped by world bosses and some bosses.

Run from the repo root: python3 packages/game-data/scripts/gen_v22_food_pets.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


MIN = 60_000

# dish -> (buff name, minutes, mods)
BUFFS = {
    "carrot_soup": ("Warm Belly", 10, {"regen": 2}),
    "grilled_fish": ("Light Feet", 10, {"eva": 1.08}),
    "fish_skewer": ("Skewer Strength", 10, {"dmg": 1.05}),
    "berry_jam": ("Berry Bright", 10, {"regen": 3}),
    "cheese": ("Aged Resolve", 10, {"taken": 0.94}),
    "omelette": ("Sunny Side Up", 10, {"dmg": 1.04, "eva": 1.05}),
    "mushroom_stew": ("Forest Vigor", 15, {"regen": 4, "taken": 0.95}),
    "fried_rice": ("Fueled Up", 15, {"xp": 1.05}),
    "honey_cake": ("Sugar Rush", 15, {"xp": 1.06, "eva": 1.05}),
    "pumpkin_pie": ("Harvest Joy", 20, {"xp": 1.1}),
    "hearty_stew": ("Hearty", 20, {"taken": 0.9, "regen": 6}),
    "salmon_steak": ("Sea Strength", 20, {"dmg": 1.08}),
    "hunters_feast": ("Hunter's Feast", 30, {"dmg": 1.1, "taken": 0.92, "xp": 1.05}),
    "dragon_pepper_stew": ("Dragon's Fire", 30, {"dmg": 1.12, "regen": 10}),
}

NEW_ITEMS = [
    {"id": "hunters_feast", "name": "Hunter's Feast", "description": "A platter for a long hunt. +10% damage, -8% damage taken, +5% EXP for 30 minutes.",
     "icon": "food:pie:c0703a", "category": "consumable", "rarity": "rare", "stackSize": 20, "vendorValue": 120, "levelRequirement": 30, "tradable": True,
     "bind": "none", "maxDurability": None, "consumable": {"hp": 400, "energy": 40}},
    {"id": "dragon_pepper_stew", "name": "Dragon Pepper Stew", "description": "Burns going down. +12% damage and strong regeneration for 30 minutes.",
     "icon": "food:soup:d0402a", "category": "consumable", "rarity": "epic", "stackSize": 20, "vendorValue": 300, "levelRequirement": 60, "tradable": True,
     "bind": "none", "maxDurability": None, "consumable": {"hp": 900, "energy": 50}},
    {"id": "evolution_stone", "name": "Evolution Stone", "description": "Glows warmly near pets. Evolves a pet at level 30 (1 stone) and level 60 (3 stones) — see the Pet menu (U).",
     "icon": "gem:e0a0ff", "category": "material", "rarity": "epic", "stackSize": 99, "vendorValue": 2000, "levelRequirement": 1, "tradable": True,
     "bind": "none", "maxDurability": None},
]

NEW_RECIPES = [
    {"id": "cook_hunters_feast", "station": "cooking_pot", "skill": "cooking", "level": 30, "xp": 60, "fee": 0,
     "inputs": [{"itemId": "salmon_steak", "quantity": 1}, {"itemId": "hearty_stew", "quantity": 1}, {"itemId": "pumpkin_pie", "quantity": 1}],
     "output": {"itemId": "hunters_feast", "quantity": 2}},
    {"id": "cook_dragon_pepper_stew", "station": "cooking_pot", "skill": "cooking", "level": 55, "xp": 120, "fee": 0,
     "inputs": [{"itemId": "hunters_feast", "quantity": 1}, {"itemId": "drake_scale", "quantity": 1}, {"itemId": "ember_core", "quantity": 1}],
     "output": {"itemId": "dragon_pepper_stew", "quantity": 2}},
]

STONE_DROPS = {"wb_elder_treant": 0.25, "wb_storm_roc": 0.3, "wb_glacial_behemoth": 0.35, "wb_elder_dragon": 0.4,
               "frost_giant": 0.1, "stoneheart_golem": 0.1, "ancient_wyvern": 0.15, "infernal_titan": 0.15}


def main():
    items = load("items.json")
    have = {i["id"] for i in items}
    items += [i for i in NEW_ITEMS if i["id"] not in have]
    for i in items:
        if i["id"] in BUFFS:
            name, mins, mods = BUFFS[i["id"]]
            i["consumable"]["buff"] = {"name": name, "durationMs": mins * MIN, "mods": mods}
    save("items.json", items)

    recipes = load("recipes.json")
    have = {r["id"] for r in recipes}
    recipes += [r for r in NEW_RECIPES if r["id"] not in have]
    save("recipes.json", recipes)

    shops = load("shops.json")
    for s in shops:
        if s["npcId"] == "stablemaster_hana" and not any(e["itemId"] == "evolution_stone" for e in s["sells"]):
            s["sells"].append({"itemId": "evolution_stone", "price": 25000})
    save("shops.json", shops)

    monsters = load("monsters.json")
    for m in monsters:
        c = STONE_DROPS.get(m["id"])
        if c and not any(d["itemId"] == "evolution_stone" for d in m["drops"]):
            m["drops"].append({"itemId": "evolution_stone", "chance": c, "min": 1, "max": 1})
    save("monsters.json", monsters)
    print("buffs", len(BUFFS), "items", len(items), "recipes", len(recipes))


if __name__ == "__main__":
    main()
