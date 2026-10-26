"""TerraGo: activity currencies (Arena Tokens, Bounty Seals, Rift Shards).
Bound to the character; spent at the exchanges in packages/shared/src/exchange.ts.

Run from the repo root: python3 packages/game-data/scripts/gen_v24_currencies.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

NEW = [
    {"id": "arena_token", "name": "Arena Token", "description": "Earned in ranked arena matches (3 for a win, 1 for a loss). Spend them in the Arena window.",
     "icon": "gem:f2c14e", "category": "quest", "rarity": "rare", "stackSize": 9999, "vendorValue": 0, "levelRequirement": 1, "tradable": False, "bind": "pickup", "maxDurability": None, "weight": 0},
    {"id": "bounty_seal", "name": "Bounty Seal", "description": "Earned by handing in bounties (1 / 2 / 4 by difficulty). Trade them at any bounty board.",
     "icon": "gem:c08a4a", "category": "quest", "rarity": "uncommon", "stackSize": 9999, "vendorValue": 0, "levelRequirement": 1, "tradable": False, "bind": "pickup", "maxDurability": None, "weight": 0},
    {"id": "rift_shard", "name": "Rift Shard", "description": "Found on the floors of the Endless Rift. Trade them with the Rift Keeper.",
     "icon": "gem:7af0ff", "category": "quest", "rarity": "epic", "stackSize": 9999, "vendorValue": 0, "levelRequirement": 1, "tradable": False, "bind": "pickup", "maxDurability": None, "weight": 0},
]


def main():
    items = json.loads((DATA / "items.json").read_text())
    have = {i["id"] for i in items}
    items += [i for i in NEW if i["id"] not in have]
    (DATA / "items.json").write_text(json.dumps(items, indent=1) + "\n")
    print("items", len(items))


if __name__ == "__main__":
    main()
