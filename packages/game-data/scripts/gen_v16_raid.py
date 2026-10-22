"""TerraGo revision, phase 4: mythic raid loot.

Pyraxis, the Infernal Titan, always drops an Infernal Cache (opens into a mythic
weapon for your class) and an Infernal Warlord armor skin.

Run from the repo root: python3 packages/game-data/scripts/gen_v16_raid.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


def weapon(id, name, type, classes, stats, speed, rng, magic=False):
    eq = {"slot": "mainhand", "weapon": type, "stats": stats, "speedMs": speed, "range": rng, "classes": classes}
    if magic:
        eq["magic"] = True
    return {"id": id, "name": name, "description": "Forged in the Infernal Caldera from the Titan's own fire. Mythic.", "icon": f"weapon:{type}:6",
            "category": "weapon", "rarity": "mythic", "stackSize": 1, "vendorValue": 12000, "levelRequirement": 95, "tradable": True, "bind": "equip",
            "maxDurability": 1200, "equip": eq}


MYTHICS = [
    weapon("infernal_greatsword", "Infernal Greatsword", "sword", ["warrior"], {"atk": 165, "str": 8}, 900, 1.5),
    weapon("infernal_longbow", "Infernal Longbow", "bow", ["archer"], {"atk": 152, "agi": 10}, 1100, 6),
    weapon("infernal_fang", "Infernal Fang", "dagger", ["archer"], {"atk": 142, "crit": 12}, 650, 1.3),
    weapon("infernal_staff", "Infernal Staff", "staff", ["mage"], {"matk": 172, "int": 10, "mp": 95}, 1200, 5, True),
    weapon("infernal_scepter", "Infernal Scepter", "mace", ["acolyte"], {"matk": 152, "atk": 32, "mp": 78}, 1050, 1.6, True),
]

EXTRA = [
    {"id": "infernal_cache", "name": "Infernal Cache", "description": "A smoldering chest from the Titan's hoard. Use it: a mythic weapon for your class is inside.",
     "icon": "chest:d0301a", "category": "consumable", "rarity": "mythic", "stackSize": 10, "vendorValue": 1, "levelRequirement": 1, "tradable": False, "bind": "pickup",
     "maxDurability": None, "unlock": {"cache": "infernal"}},
    {"id": "skin_infernal_warlord", "name": "Infernal Warlord Skin", "description": "Use it to unlock the Infernal Warlord armor skin in your wardrobe (Character window).",
     "icon": "scroll", "category": "consumable", "rarity": "mythic", "stackSize": 10, "vendorValue": 1, "levelRequirement": 1, "tradable": True, "bind": "none",
     "maxDurability": None, "unlock": {"skin": "Infernal Warlord"}},
]


def main():
    items = load("items.json")
    have = {i["id"] for i in items}
    items += [i for i in MYTHICS + EXTRA if i["id"] not in have]
    save("items.json", items)
    monsters = load("monsters.json")
    for m in monsters:
        if m["id"] == "infernal_titan":
            for d in [{"itemId": "infernal_cache", "chance": 1.0, "min": 1, "max": 1}, {"itemId": "skin_infernal_warlord", "chance": 1.0, "min": 1, "max": 1}]:
                if not any(x["itemId"] == d["itemId"] for x in m["drops"]):
                    m["drops"].append(d)
    save("monsters.json", monsters)
    print("items", len(items))


if __name__ == "__main__":
    main()
