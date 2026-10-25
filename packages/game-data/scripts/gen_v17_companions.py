"""TerraGo: mount stable and pet growth.

- Mount terrain perks (Ice Walker, Lava Strider, Celestial Stride) and glow colors.
- New mounts: Mechanical Hover-Gear (Desolate Crags golems) and the Celestial Stag
  (Pyraxis, the Map 6 world boss).
- Pet treats at Stablemaster Hana.

Run from the repo root: python3 packages/game-data/scripts/gen_v17_companions.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


PERKS = {"war_wolf": "ice_walker", "wyvern_whelp": "lava_strider", "mech_hovergear": "lava_strider", "celestial_stag": "all_terrain"}

NEW_MOUNTS = [
    {"id": "mech_hovergear", "name": "Mechanical Hover-Gear", "description": "A humming gnome-built hover disc. Its jets don't care about lava.",
     "icon": "mount:hovergear:c08a3a", "category": "mount", "rarity": "epic", "stackSize": 1, "vendorValue": 6000, "levelRequirement": 35,
     "tradable": True, "bind": "none", "maxDurability": None,
     "mount": {"speed": 1.75, "color": "#c08a3a", "kind": "hovergear", "perk": "lava_strider", "glow": "#5ad0ff"}},
    {"id": "celestial_stag", "name": "Celestial Stag", "description": "A stag of starlight that walks on ice and fire alike. Only Pyraxis guards one.",
     "icon": "mount:stag:dfe6ff", "category": "mount", "rarity": "mythic", "stackSize": 1, "vendorValue": 20000, "levelRequirement": 90,
     "tradable": True, "bind": "none", "maxDurability": None,
     "mount": {"speed": 2.3, "color": "#dfe6ff", "kind": "stag", "perk": "all_terrain", "glow": "#9ab8ff"}},
]

TREATS = [
    {"id": "pet_treat", "name": "Pet Treat", "description": "A crunchy snack. Feed it to your pet (Pet menu, or use it from the bag): +500 Pet EXP, +5 loyalty.",
     "icon": "food:treat:d8a05a", "category": "consumable", "rarity": "common", "stackSize": 50, "vendorValue": 20, "levelRequirement": 1,
     "tradable": True, "bind": "none", "maxDurability": None, "petFood": {"xp": 500, "loyalty": 5}},
    {"id": "premium_pet_treat", "name": "Premium Pet Treat", "description": "A gourmet feast for companions: +3000 Pet EXP, +12 loyalty.",
     "icon": "food:treat:e8603a", "category": "consumable", "rarity": "rare", "stackSize": 50, "vendorValue": 150, "levelRequirement": 1,
     "tradable": True, "bind": "none", "maxDurability": None, "petFood": {"xp": 3000, "loyalty": 12}},
]


def main():
    items = load("items.json")
    have = {i["id"] for i in items}
    items += [i for i in NEW_MOUNTS + TREATS if i["id"] not in have]
    for i in items:
        if i["id"] in PERKS and i.get("mount"):
            i["mount"]["perk"] = PERKS[i["id"]]
    save("items.json", items)

    monsters = load("monsters.json")
    for m in monsters:
        if m["id"] == "infernal_titan" and not any(d["itemId"] == "celestial_stag" for d in m["drops"]):
            m["drops"].append({"itemId": "celestial_stag", "chance": 0.05, "min": 1, "max": 1})
        if m["id"] == "rock_golem" and not any(d["itemId"] == "mech_hovergear" for d in m["drops"]):
            m["drops"].append({"itemId": "mech_hovergear", "chance": 0.004, "min": 1, "max": 1})
    save("monsters.json", monsters)

    shops = load("shops.json")
    for s in shops:
        if s["npcId"] == "stablemaster_hana":
            for t, price in (("pet_treat", 60), ("premium_pet_treat", 450)):
                if not any(e["itemId"] == t for e in s["sells"]):
                    s["sells"].append({"itemId": t, "price": price})
    save("shops.json", shops)
    print("items", len(items))


if __name__ == "__main__":
    main()
