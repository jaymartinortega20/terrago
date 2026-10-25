"""TerraGo: identical gear stacks in one slot, and Bag Expansions (+10 slots, up to 250).

Run from the repo root: python3 packages/game-data/scripts/gen_v18_bags.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


BAG = {"id": "bag_expansion", "name": "Bag Expansion", "description": "Sew 10 more slots into your bag (up to 250). Use it from your bag.",
       "icon": "cloth:c8a46a", "category": "consumable", "rarity": "rare", "stackSize": 20, "vendorValue": 500, "levelRequirement": 1,
       "tradable": True, "bind": "none", "maxDurability": None, "bagSlots": 10}


def main():
    items = load("items.json")
    for i in items:
        # Gear, tools, mounts, pets and cosmetics: identical pieces share a slot.
        if i["stackSize"] == 1 and i["category"] in ("weapon", "armor", "mount", "cosmetic") and (i.get("equip") or i.get("maxDurability") is None):
            i["stackSize"] = 99
    if not any(i["id"] == BAG["id"] for i in items):
        items.append(BAG)
    save("items.json", items)
    shops = load("shops.json")
    for s in shops:
        if s["npcId"] == "merchant_mira" and not any(e["itemId"] == "bag_expansion" for e in s["sells"]):
            s["sells"].append({"itemId": "bag_expansion", "price": 5000})
    save("shops.json", shops)
    print("items", len(items))


if __name__ == "__main__":
    main()
