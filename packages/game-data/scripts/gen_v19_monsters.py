"""TerraGo: fuller late maps. New monsters with behaviours (healers, summoners,
exploders, chargers) for the Crags, Glacial Depths and Dragon's Peak.
Spawns live in generate-maps.ts.

Run from the repo root: python3 packages/game-data/scripts/gen_v19_monsters.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


def mon(id, name, shape, color, size, hp, atk, df, speed, aggro, rng, cd, xp, gold, drops, behavior=None, magic=False, summon=None):
    m = {"id": id, "name": name, "hpMult": hp, "atkMult": atk, "defMult": df, "speed": speed, "aggro": aggro, "range": rng, "cooldownMs": cd,
         "xpMult": xp, "gold": gold, "drops": [{"itemId": i, "chance": c, "min": 1, "max": mx} for i, c, mx in drops],
         "art": {"shape": shape, "color": color, "size": size}, "respawnMs": 60000}
    if magic:
        m["magic"] = True
    if behavior:
        m["behavior"] = behavior
    if summon:
        m["summon"] = summon
    return m


NEW = [
    # Desolate Crags (41-70)
    mon("crag_shaman", "Crag Shaman", "mage", "#c08a4a", 1.05, 1.2, 1.3, 1.1, 50, 7, 4.5, 1800, 2.4, [20, 40], [("ruby", 0.04, 1), ("iron_ore", 0.4, 2), ("enhancement_stone", 0.05, 1)], "healer", magic=True),
    mon("boulder_mite", "Boulder Mite", "slime", "#8a7a6a", 0.85, 0.9, 2.2, 1.0, 85, 7, 1.2, 1500, 1.6, [8, 18], [("stone", 0.6, 3), ("copper_ore", 0.3, 2)], "exploder"),
    # Glacial Depths (71-99)
    mon("frost_priestess", "Frost Priestess", "mage", "#9ad0ff", 1.05, 1.3, 1.4, 1.2, 50, 7, 4.5, 1800, 3.0, [25, 50], [("sapphire", 0.04, 1), ("crystal_ore", 0.35, 2), ("enhancement_stone", 0.06, 1)], "healer", magic=True),
    mon("frost_mite", "Frost Mite", "slime", "#bfeaff", 0.85, 0.9, 2.3, 1.0, 90, 7, 1.2, 1500, 2.0, [10, 22], [("frost_shard", 0.6, 3), ("mithril_ore", 0.25, 1)], "exploder"),
    mon("glacier_warlock", "Glacier Warlock", "mage", "#5a8ad8", 1.15, 1.5, 1.6, 1.4, 48, 8, 5.0, 2000, 3.4, [30, 60], [("sapphire", 0.06, 1), ("mithril_ore", 0.4, 2), ("enhancement_stone", 0.08, 1)], "summoner", magic=True, summon="ice_wisp"),
    # Dragon's Peak (100)
    mon("dragon_priest", "Dragon Priest", "mage", "#c0402a", 1.15, 1.6, 1.6, 1.5, 50, 8, 5.0, 1800, 3.4, [60, 120], [("dragonstone", 0.05, 1), ("drake_scale", 0.4, 2), ("enhancement_stone", 0.1, 1)], "healer", magic=True),
    mon("wyrm_hatchling", "Wyrm Hatchling", "bat", "#e0603a", 0.9, 1.0, 2.4, 1.2, 95, 8, 1.2, 1500, 2.6, [30, 60], [("drake_scale", 0.5, 1)], "exploder"),
    mon("drake_broodmother", "Drake Broodmother", "wolf", "#8a2a1a", 1.7, 2.8, 1.8, 2.0, 60, 8, 2.0, 2200, 4.0, [100, 200], [("dragonstone", 0.1, 1), ("drake_scale", 0.6, 3), ("enhancement_stone", 0.15, 1)], "summoner", summon="wyrm_hatchling"),
]

CHARGERS = ["sand_scorpion", "snow_wolf", "magma_hound", "young_drake"]


def main():
    monsters = load("monsters.json")
    have = {m["id"] for m in monsters}
    monsters += [m for m in NEW if m["id"] not in have]
    for m in monsters:
        if m["id"] in CHARGERS:
            m["behavior"] = "charger"
    save("monsters.json", monsters)
    print("monsters", len(monsters))


if __name__ == "__main__":
    main()
