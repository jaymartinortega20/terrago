"""TerraGo: world bosses. Four huge bosses rotate through the open maps on a
clock-based schedule (see packages/shared/src/worldBoss.ts).

Run from the repo root: python3 packages/game-data/scripts/gen_v21_world_bosses.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


def drop(item, chance, lo=1, hi=1):
    return {"itemId": item, "chance": chance, "min": lo, "max": hi}


BOSSES = [
    {
        "id": "wb_elder_treant", "name": "Elder Treant", "hpMult": 260, "atkMult": 1.6, "defMult": 2.0, "speed": 40, "aggro": 9, "range": 2.6,
        "cooldownMs": 2200, "xpMult": 60, "gold": [2000, 4000],
        "drops": [drop("enhancement_stone", 1, 4, 8), drop("elderwood_log", 1, 4, 8), drop("magmaforged_sword", 0.05), drop("magmaforged_staff", 0.05),
                  drop("magmaforged_bow", 0.05), drop("magmaforged_dagger", 0.05), drop("magmaforged_mace", 0.05), drop("giants_mantle", 0.06), drop("emerald", 0.5, 1, 2)],
        "art": {"shape": "golem", "color": "#4a7a2a", "size": 3.6}, "respawnMs": 999999999, "boss": True, "worldBoss": True,
        "abilities": [
            {"id": "root_slam", "name": "Root Slam", "kind": "slam", "everyMs": 6000, "windupMs": 1500, "radius": 3.0, "dmgMult": 2.2},
            {"id": "thorn_nova", "name": "Thorn Nova", "kind": "nova", "everyMs": 11000, "windupMs": 1700, "radius": 5.0, "dmgMult": 1.6},
            {"id": "saplings", "name": "Call the Saplings", "kind": "summon", "atHp": [0.75, 0.5, 0.25], "monster": "orc", "count": 4, "level": 30},
            {"id": "bark_skin", "name": "Bark Skin", "kind": "harden", "everyMs": 22000, "durationMs": 6000, "taken": 0.25, "belowHp": 0.6},
            {"id": "wildfire", "name": "Wildgrowth", "kind": "enrage", "atHp": [0.15], "dmg": 1.5},
        ],
    },
    {
        "id": "wb_storm_roc", "name": "Storm Roc", "hpMult": 300, "atkMult": 2.0, "defMult": 2.4, "speed": 70, "aggro": 10, "range": 3.2,
        "cooldownMs": 2000, "xpMult": 80, "gold": [5000, 9000],
        "drops": [drop("enhancement_stone", 1, 6, 12), drop("obsidian_sword", 0.05), drop("obsidian_staff", 0.05), drop("obsidian_bow", 0.05),
                  drop("obsidian_dagger", 0.05), drop("obsidian_mace", 0.05), drop("obsidian_chest", 0.06), drop("obsidian_head", 0.06), drop("diamond_ring", 0.05), drop("ruby", 0.6, 1, 2)],
        "art": {"shape": "bat", "color": "#5a6a9a", "size": 3.8}, "respawnMs": 999999999, "boss": True, "worldBoss": True,
        "abilities": [
            {"id": "thunderclap", "name": "Thunderclap", "kind": "nova", "everyMs": 8000, "windupMs": 1500, "radius": 5.0, "dmgMult": 2.0},
            {"id": "talon_dive", "name": "Talon Dive", "kind": "slam", "everyMs": 5000, "windupMs": 1200, "radius": 2.5, "dmgMult": 2.6},
            {"id": "gale", "name": "Gale Wings", "kind": "harden", "everyMs": 20000, "durationMs": 6000, "taken": 0.2, "belowHp": 0.7},
            {"id": "flock", "name": "Call the Flock", "kind": "summon", "atHp": [0.7, 0.4], "monster": "sand_scorpion", "count": 4, "level": 60},
            {"id": "tempest", "name": "Tempest", "kind": "enrage", "atHp": [0.2], "dmg": 1.6},
        ],
    },
    {
        "id": "wb_glacial_behemoth", "name": "Glacial Behemoth", "hpMult": 340, "atkMult": 2.2, "defMult": 2.8, "speed": 45, "aggro": 9, "range": 3.0,
        "cooldownMs": 2300, "xpMult": 90, "gold": [8000, 14000],
        "drops": [drop("enhancement_stone", 1, 8, 14), drop("star_metal_sword", 0.04), drop("star_metal_staff", 0.04), drop("star_metal_bow", 0.04),
                  drop("star_metal_dagger", 0.04), drop("star_metal_mace", 0.04), drop("star_metal_chest", 0.05), drop("star_metal_boots", 0.05), drop("frost_shard", 1, 4, 8), drop("sapphire", 0.6, 1, 3)],
        "art": {"shape": "golem", "color": "#9ad8ff", "size": 4.0}, "respawnMs": 999999999, "boss": True, "worldBoss": True,
        "abilities": [
            {"id": "glacier_fall", "name": "Glacier Fall", "kind": "slam", "everyMs": 6000, "windupMs": 1600, "radius": 3.5, "dmgMult": 2.6},
            {"id": "blizzard", "name": "Blizzard", "kind": "nova", "everyMs": 10000, "windupMs": 1800, "radius": 5.5, "dmgMult": 1.9},
            {"id": "ice_armor", "name": "Ice Armor", "kind": "harden", "everyMs": 24000, "durationMs": 7000, "taken": 0.15, "belowHp": 0.65},
            {"id": "frost_kin", "name": "Frost Kin", "kind": "summon", "atHp": [0.75, 0.5, 0.25], "monster": "frost_yeti", "count": 3, "level": 88},
            {"id": "deep_freeze", "name": "Deep Freeze", "kind": "enrage", "atHp": [0.2], "dmg": 1.6},
        ],
    },
    {
        "id": "wb_elder_dragon", "name": "Vyrnax the Elder Dragon", "hpMult": 420, "atkMult": 2.5, "defMult": 3.0, "speed": 65, "aggro": 10, "range": 3.4,
        "cooldownMs": 2000, "xpMult": 110, "gold": [12000, 20000],
        "drops": [drop("enhancement_stone", 1, 10, 18), drop("dragonstone", 1, 3, 6), drop("drake_scale", 1, 3, 6), drop("infernal_greatsword", 0.02), drop("infernal_staff", 0.02),
                  drop("infernal_longbow", 0.02), drop("infernal_fang", 0.02), drop("infernal_scepter", 0.02), drop("dragon_wings", 0.03), drop("pet_dragonling", 0.04)],
        "art": {"shape": "wolf", "color": "#a02a1a", "size": 4.2}, "respawnMs": 999999999, "boss": True, "worldBoss": True,
        "abilities": [
            {"id": "dragonfire", "name": "Dragonfire", "kind": "slam", "everyMs": 5000, "windupMs": 1400, "radius": 4.0, "dmgMult": 2.8},
            {"id": "wing_buffet", "name": "Wing Buffet", "kind": "nova", "everyMs": 9000, "windupMs": 1600, "radius": 5.5, "dmgMult": 2.1},
            {"id": "scales", "name": "Iron Scales", "kind": "harden", "everyMs": 22000, "durationMs": 7000, "taken": 0.15, "belowHp": 0.7},
            {"id": "brood", "name": "Call the Brood", "kind": "summon", "atHp": [0.8, 0.6, 0.4, 0.2], "monster": "young_drake", "count": 4, "level": 98},
            {"id": "cataclysm", "name": "Cataclysm", "kind": "enrage", "atHp": [0.2], "dmg": 1.8},
        ],
    },
]


def main():
    monsters = load("monsters.json")
    have = {m["id"] for m in monsters}
    monsters = [m for m in monsters if m["id"] not in {b["id"] for b in BOSSES}] + BOSSES
    save("monsters.json", monsters)
    print("monsters", len(monsters), "world bosses", len(BOSSES), "new" if not have & {b["id"] for b in BOSSES} else "updated")


if __name__ == "__main__":
    main()
