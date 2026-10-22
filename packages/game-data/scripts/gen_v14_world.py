"""TerraGo revision, phase 2: the six-map world.

Oakhaven Sanctuary (town) -> Whispering Fields (1-40, Lv 40 mini-boss guards the
Job Trainer) -> Desolate Crags (41-70, mining) -> Glacial Depths (71-99, mining)
-> Dragon's Peak (100) -> The Infernal Caldera (raid boss).

Run from the repo root: python3 packages/game-data/scripts/gen_v14_world.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


def mob(id, name, shape, color, size, hp, atk, df, xp, gold, drops, speed=55, aggro=5, rng=1.3, cd=1600, respawn=60000, magic=False, **extra):
    m = {"id": id, "name": name, "hpMult": hp, "atkMult": atk, "defMult": df, "speed": speed, "aggro": aggro, "range": rng,
         "cooldownMs": cd, "xpMult": xp, "gold": gold, "drops": drops, "art": {"shape": shape, "color": color, "size": size}, "respawnMs": respawn}
    if magic:
        m["magic"] = True
    m.update(extra)
    return m


def drop(item, chance, lo=1, hi=1):
    return {"itemId": item, "chance": chance, "min": lo, "max": hi}


NEW_MONSTERS = [
    # Whispering Fields mini-boss (level 40) — guards the Job Trainer's grove.
    mob("fields_warden", "Gnarlfang, Warden of the Fields", "wolf", "#5a4a3a", 1.9, 16, 1.55, 1.2, 14, [400, 700],
        [drop("enhancement_stone", 1.0, 2, 3), drop("wolf_pelt", 1.0, 3, 5)], speed=70, aggro=6, cd=1500, respawn=300000, boss=True,
        abilities=[
            {"id": "maul", "name": "Maul", "kind": "slam", "everyMs": 7000, "windupMs": 1400, "radius": 2.2, "dmgMult": 2.0},
            {"id": "howl", "name": "Call the Pack", "kind": "summon", "atHp": [0.7, 0.4], "monster": "forest_wolf", "count": 3, "level": 34},
            {"id": "fury", "name": "Feral Fury", "kind": "enrage", "atHp": [0.25], "dmg": 1.4},
        ]),
    # Desolate Crags (41-70).
    mob("earth_elemental", "Earth Elemental", "golem", "#8a6a3a", 1.0, 1.7, 1.5, 1.5, 2.0, [8, 18], [drop("stone", 0.6, 1, 3), drop("copper_ore", 0.25, 1, 2)], speed=45, rng=1.4),
    mob("rock_golem", "Rock Golem", "golem", "#7a7068", 1.35, 2.6, 1.6, 2.0, 2.4, [12, 26], [drop("stone", 0.7, 2, 4), drop("iron_ore", 0.3, 1, 2), drop("gold_ore", 0.06, 1, 1)], speed=40, rng=1.5, cd=1900),
    # Glacial Depths (71-99).
    mob("ice_specter", "Ice Specter", "mage", "#bfe8ff", 1.0, 1.4, 1.8, 1.2, 2.8, [16, 30], [drop("mithril_ore", 0.18, 1, 2), drop("crystal_ore", 0.12, 1, 1)], speed=60, rng=5, magic=True, cd=1800),
    mob("frost_giant_brute", "Frost Giant", "orc", "#a8c8e8", 1.55, 3.2, 1.9, 2.2, 3.4, [24, 44], [drop("mithril_ore", 0.25, 1, 2), drop("obsidian_ore", 0.1, 1, 1)], speed=42, rng=1.6, cd=2000),
    # Dragon's Peak champions (level 100 elites).
    mob("drake_champion", "Drake Champion", "wolf", "#c02a1a", 1.5, 6.0, 2.2, 2.4, 9.0, [80, 140], [drop("dragonstone", 0.3, 1, 2), drop("enhancement_stone", 0.4, 1, 2)], speed=62, aggro=6, cd=1600),
    mob("dragon_knight_champion", "Dragon Knight Champion", "orc", "#2a1a3a", 1.5, 6.5, 2.3, 2.6, 10.0, [90, 160], [drop("dragonstone", 0.35, 1, 2), drop("star_metal_ore", 0.3, 1, 2)], speed=55, aggro=6, cd=1700),
    # The Infernal Caldera world boss.
    mob("infernal_titan", "Pyraxis, the Infernal Titan", "golem", "#d0301a", 2.6, 220, 2.3, 2.6, 120, [5000, 9000],
        [drop("dragonstone", 1.0, 3, 6), drop("enhancement_stone", 1.0, 4, 8), drop("star_metal_ore", 1.0, 4, 8)], speed=40, aggro=8, rng=2.2, cd=2200, respawn=3600000, boss=True,
        abilities=[
            {"id": "magma_fist", "name": "Magma Fist", "kind": "slam", "everyMs": 5500, "windupMs": 1400, "radius": 3.2, "dmgMult": 2.7},
            {"id": "caldera_burst", "name": "Caldera Burst", "kind": "nova", "everyMs": 10000, "windupMs": 2000, "radius": 6, "dmgMult": 2.1},
            {"id": "obsidian_shell", "name": "Obsidian Shell", "kind": "harden", "everyMs": 26000, "durationMs": 7000, "taken": 0.15, "belowHp": 0.75},
            {"id": "spawn_of_fire", "name": "Spawn of Fire", "kind": "summon", "atHp": [0.8, 0.6, 0.4, 0.2], "monster": "ember_elemental", "count": 4, "level": 98},
            {"id": "cataclysm", "name": "Cataclysm", "kind": "enrage", "atHp": [0.15], "dmg": 1.8},
        ]),
]

MOVED_NPCS = {
    # Region guides now stand in the new maps' camps.
    "forgewarden_hal": ("desolate_crags", 10, 41, "Desolate Crags"),
    "scout_bjorna": ("glacial_depths", 10, 41, "Glacial Depths"),
    "hunter_kade": ("dragonspire", 10, 22, "Dragon's Peak"),
}
REMOVED_NPCS = {"lift_gus", "warden_sela", "hunter_moss", "caravan_zara", "archivist_elowen"}

# Job Trainer: behind the Warden's arena at the far end of Whispering Fields.
ALDRIC = {"mapId": "sunfield_plains", "x": 30, "y": 95}

KEEP_QUESTS = ["q_pony", "q_homestead", "q_pickaxe", "q_smelt", "q_slimes", "q_fishing"]


def quest(id, name, giver, turn, requires, desc, intro, outro, steps, gold, xp, items=None):
    q = {"id": id, "name": name, "giver": giver, "turnIn": turn, "requires": requires, "description": desc, "intro": intro, "outro": outro, "steps": steps,
         "rewards": {"gold": gold, "xp": xp}}
    if items:
        q["rewards"]["items"] = [{"itemId": i, "quantity": n} for i, n in items]
    return q


def step(text, type, count=1, target=None, where=None):
    s = {"text": text, "type": type, "count": count}
    if target:
        s["target"] = target
    if where:
        s["where"] = {"map": where[0], "x": where[1], "y": where[2]}
    return s


NEW_QUESTS = [
    quest("q_goblins", "Goblins in the Fields", "fisher_olan", "mayor_lina", "q_fishing",
          "Goblins have made camp in the middle of Whispering Fields. Level 10+ recommended.",
          ["Bad news from the south road. Goblins set up a camp past the old farm fields.", "Get to level ten or so, then thin them out. The mayor will want to hear it's done."],
          ["Eight goblins! Oakhaven owes you one.", "The fields go much further south than most dare. Wolves, then worse. Talk to Kael at the castle."],
          [step("Defeat 8 Goblin Scouts (goblin camp, middle of Whispering Fields)", "kill", 8, "goblin_scout", ("sunfield_plains", 40, 50))], 220, 450, [("enhancement_stone", 2)]),
    quest("q_wolves", "Howls in the South", "mayor_lina", "guildmaster_kael", "q_goblins",
          "Wolf packs roam the southern Whispering Fields. Level 20+ recommended.",
          ["Kael at the castle wants fighters for the southern fields. Wolves, in packs.", "They're no slimes. Level twenty, at least."],
          ["Ten wolves. You've got steel in you.", "There's something old under the fields too. If you've friends, Kael has a job for you."],
          [step("Defeat 10 Forest Wolves (south Whispering Fields)", "kill", 10, "forest_wolf", ("sunfield_plains", 30, 68))], 400, 1200, [("enhancement_stone", 2)]),
    quest("q_crypt", "The Mossy Crypt", "guildmaster_kael", "guildmaster_kael", "q_wolves",
          "Something old stirs beneath the fields. Level 12+ and a party recommended.",
          ["The dead are walking in the old crypt under Whispering Fields.", "Gather friends: a party shares the dungeon and the experience. Put Crypt Lord Varn back in his grave."],
          ["Varn's down? Then the fields sleep easier tonight.", "Keep what he dropped. And come back tomorrow: he never stays dead."],
          [step("Enter the Mossy Crypt (west side of Whispering Fields)", "visit", 1, "dg_mossy_crypt", ("sunfield_plains", 9, 55)), step("Defeat Crypt Lord Varn (the far chamber)", "kill", 1, "crypt_lord")],
          600, 2600, [("enhancement_stone", 3)]),
    quest("q_warden", "The Warden of the Fields", "guildmaster_kael", "job_master_aldric", "q_crypt",
          "Gnarlfang guards the way to Master Aldric. Level 40, and bring friends.",
          ["At the far south end of Whispering Fields an old wolf guards the way to Master Aldric's grove.", "Aldric teaches the second jobs, but only to those who get past Gnarlfang. Level forty. Bring friends."],
          ["You beat Gnarlfang? Then you have earned the right to choose.", "Two paths for every class. Choose well: there is no going back."],
          [step("Defeat Gnarlfang, Warden of the Fields (the arena, far south)", "kill", 1, "fields_warden", ("sunfield_plains", 30, 84))], 2500, 9000, [("enhancement_stone", 4)]),
    quest("q_crags", "The Desolate Crags", "job_master_aldric", "forgewarden_hal", "q_warden",
          "North of Oakhaven lie the Crags: ore, gems and living rock. Level 41+.",
          ["Your new path needs better steel. North of Oakhaven lie the Desolate Crags.", "Forgewarden Hal camps there. Earth elementals guard the ore."],
          ["Ten of them? The rock will remember you.", "Mine what you can. The best ore lies deeper still, in the ice."],
          [step("Defeat 10 Earth Elementals (Desolate Crags, north of Oakhaven)", "kill", 10, "earth_elemental", ("desolate_crags", 30, 30))], 3000, 15000, [("enhancement_stone", 4)]),
    quest("q_depths", "Into the Glacial Depths", "forgewarden_hal", "scout_bjorna", "q_crags",
          "Rare ore and gems wait in the frozen caverns. Level 71+.",
          ["Past the crags the mountain turns to ice. Scout Bjorna knows the way through the Glacial Depths.", "Ice specters drift there. They don't like visitors."],
          ["Eight specters! I'd have run.", "Beyond the ice is Dragon's Peak. Only the strongest go there."],
          [step("Defeat 8 Ice Specters (Glacial Depths)", "kill", 8, "ice_specter", ("glacial_depths", 30, 24))], 5000, 30000, [("enhancement_stone", 5)]),
    quest("q_peak", "Dragon's Peak", "scout_bjorna", "hunter_kade", "q_depths",
          "Level 100 drakes and champions rule the summit.",
          ["You're ready for the Peak. Kade the dragon hunter waits at the camp below the summit.", "Everything up there is level one hundred. Everything."],
          ["You lived. That's the first test.", "There's one more. Beyond the peak burns the Infernal Caldera."],
          [step("Defeat 10 Young Drakes on Dragon's Peak", "kill", 10, "young_drake", ("dragonspire", 22, 32))], 8000, 60000, [("enhancement_stone", 6)]),
    quest("q_caldera", "The Infernal Titan", "hunter_kade", "hunter_kade", "q_peak",
          "Pyraxis waits in the Caldera. A raid of the realm's best is needed.",
          ["Pyraxis, the Infernal Titan. He sleeps in the Caldera past the summit.", "Gather a raid. Everyone who fights him gets their own share of the loot."],
          ["The Titan fell! They'll sing about this in Oakhaven.", "He'll rise again. They always do."],
          [step("Defeat Pyraxis in the Infernal Caldera", "kill", 1, "infernal_titan", ("infernal_caldera", 24, 18))], 20000, 150000, [("enhancement_stone", 10)]),
]


def main():
    monsters = load("monsters.json")
    have = {m["id"] for m in monsters}
    for m in NEW_MONSTERS:
        if m["id"] not in have:
            monsters.append(m)
    save("monsters.json", monsters)

    npcs = [n for n in load("npcs.json") if n["id"] not in REMOVED_NPCS]
    for n in npcs:
        if n["id"] in MOVED_NPCS:
            m, x, y, title = MOVED_NPCS[n["id"]]
            n.update({"mapId": m, "x": x, "y": y, "title": title})
        if n["id"] == "job_master_aldric":
            n.update(ALDRIC)
            n["firstMeeting"]["lines"] = ["You made it past Gnarlfang. Few do.", "At level 40 I teach the second jobs: two roads for every class, and you may walk only one."]
        if n["id"] == "miner_bram":
            n["greetings"] = [["The Crags are north of town. Bring a good pickaxe."], ["Ore in the Crags, gems deeper still, in the ice."]]
    save("npcs.json", npcs)

    quests = load("quests.json")
    kept = [q for q in quests if q["id"] in KEEP_QUESTS]
    for q in kept:
        for s in q["steps"]:
            w = s.get("where")
            if w and w["map"] not in ("greenhaven", "sunfield_plains", "homestead"):
                s.pop("where")
        q["description"] = q["description"].replace("Sunfield", "Whispering Fields").replace("Greenhaven", "Oakhaven")
        q["intro"] = [l.replace("Sunfield", "Whispering Fields").replace("Greenhaven", "Oakhaven") for l in q["intro"]]
        for s in q["steps"]:
            s["text"] = s["text"].replace("Sunfield", "Whispering Fields").replace("Greenhaven", "Oakhaven")
    save("quests.json", kept + NEW_QUESTS)

    dungeons = load("dungeons.json")
    places = {
        "mossy_crypt": ("sunfield_plains", 8, 52),
        "ember_hollow": ("sunfield_plains", 48, 70),
        "sunken_sanctum": ("glacial_depths", 50, 30),
    }
    for d in dungeons:
        m, x, y = places[d["id"]]
        d["entrance"] = {"map": m, "x": x, "y": y}
        d["exit"] = {"mapId": m, "x": x + 1, "y": y + 4}
    save("dungeons.json", dungeons)
    print("monsters", len(monsters), "npcs", len(npcs), "quests", len(kept) + len(NEW_QUESTS))


if __name__ == "__main__":
    main()
