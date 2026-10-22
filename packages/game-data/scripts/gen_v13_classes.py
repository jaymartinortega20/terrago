"""TerraGo revision: four base classes with class resources, 2nd jobs at level 40,
manual (RO-style) stat points instead of automatic growth.

Run from the repo root: python3 packages/game-data/scripts/gen_v13_classes.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

ZERO = {"strength": 0, "agility": 0, "intelligence": 0, "vitality": 0, "luck": 0}

CLASSES = [
    {
        "id": "warrior",
        "name": "Warrior",
        "summary": "Front-line fighter. Builds Rage by hitting and being hit, then spends it on crushing blows.",
        "resource": "rage",
        "weapons": ["sword", "axe", "spear", "shield"],
        "baseStats": {"strength": 9, "agility": 5, "intelligence": 2, "vitality": 9, "luck": 3},
        "hpBase": 70, "hpPerLevel": 14, "mpBase": 100, "mpPerLevel": 0,
        "growth": ZERO,
        "starterWeapon": "training_sword",
        "jobs": [
            {"id": "paladin", "name": "Paladin", "summary": "Holy knight: tougher, protects allies and smites with light.",
             "passive": {"hpPct": 15, "defPct": 15, "matkPct": 10}},
            {"id": "berserker", "name": "Berserker", "summary": "Reckless fury: much more damage, a little less defense.",
             "passive": {"atkPct": 20, "critAdd": 5, "defPct": -10}},
        ],
    },
    {
        "id": "mage",
        "name": "Mage",
        "summary": "Master of the elements. Huge magic damage from a deep Mana pool.",
        "resource": "mana",
        "weapons": ["staff", "wand"],
        "baseStats": {"strength": 2, "agility": 5, "intelligence": 11, "vitality": 5, "luck": 5},
        "hpBase": 45, "hpPerLevel": 8, "mpBase": 40, "mpPerLevel": 7,
        "growth": ZERO,
        "starterWeapon": "training_staff",
        "jobs": [
            {"id": "sorcerer", "name": "Sorcerer", "summary": "Raw destruction: meteors and chain lightning.",
             "passive": {"matkPct": 20, "mpPct": 15}},
            {"id": "necromancer", "name": "Necromancer", "summary": "Dark arts: drain life and curse foes.",
             "passive": {"matkPct": 10, "hpPct": 10, "regenPct": 30}},
        ],
    },
    {
        "id": "archer",
        "name": "Archer",
        "summary": "Swift marksman. Fast-refilling Energy for a steady stream of shots.",
        "resource": "energy",
        "weapons": ["bow", "crossbow", "dagger"],
        "baseStats": {"strength": 5, "agility": 10, "intelligence": 3, "vitality": 6, "luck": 4},
        "hpBase": 55, "hpPerLevel": 10, "mpBase": 100, "mpPerLevel": 0,
        "growth": ZERO,
        "starterWeapon": "training_bow",
        "jobs": [
            {"id": "ranger", "name": "Ranger", "summary": "Deadly precision: piercing shots and arrow storms.",
             "passive": {"atkPct": 15, "critAdd": 8}},
            {"id": "beastmaster", "name": "Beastmaster", "summary": "Fights beside a loyal hawk that dives, blinds and marks foes.",
             "passive": {"atkPct": 8, "hpPct": 10}, "companion": "hawk"},
        ],
    },
    {
        "id": "acolyte",
        "name": "Acolyte",
        "summary": "Servant of the light. Heals allies and punishes the wicked with Mana.",
        "resource": "mana",
        "weapons": ["mace", "staff"],
        "baseStats": {"strength": 4, "agility": 4, "intelligence": 9, "vitality": 7, "luck": 4},
        "hpBase": 52, "hpPerLevel": 9, "mpBase": 34, "mpPerLevel": 6,
        "growth": ZERO,
        "starterWeapon": "training_mace",
        "jobs": [
            {"id": "high_priest", "name": "High Priest", "summary": "Supreme healer: mass healing and holy light.",
             "passive": {"mpPct": 20, "healPct": 30}},
            {"id": "inquisitor", "name": "Inquisitor", "summary": "Battle cleric: judgment and purging flames.",
             "passive": {"matkPct": 15, "atkPct": 10, "hpPct": 5}},
        ],
    },
]


def skill(id, cls, name, desc, level, cost, cd, kind, mult=0.0, magic=False, rng=0, icon="essence:ffffff", job=None, **extra):
    s = {"id": id, "classId": cls, "name": name, "description": desc, "level": level, "mp": cost, "cooldownMs": cd,
         "kind": kind, "mult": mult, "magic": magic, "range": rng, "icon": icon}
    if job:
        s["job"] = job
    s.update(extra)
    return s


def build_skills(old):
    by_id = {s["id"]: s for s in old}
    out = []
    remap = {"ranger": "archer", "priest": "acolyte"}
    for s in old:
        if s["classId"] == "rogue":
            continue
        s = dict(s)
        s["classId"] = remap.get(s["classId"], s["classId"])
        # Rage/Energy costs feel better a bit higher than old MP costs.
        if s["classId"] in ("warrior", "archer"):
            s["mp"] = {"power_strike": 20, "war_cry": 30, "whirlwind": 45, "aimed_shot": 25, "hunters_mark": 20, "volley": 45}.get(s["id"], s["mp"])
        out.append(s)
    J = 40
    out += [
        # Warrior → Paladin / Berserker
        skill("holy_strike", "warrior", "Holy Strike", "A blessed blow of light (magic damage).", J, 30, 6000, "attack", 2.4, True, 1.6, "essence:fff6a0", "paladin"),
        skill("divine_shield", "warrior", "Divine Shield", "A shield of light absorbs damage for 15s.", J + 5, 40, 30000, "buff", 0, False, 0, "essence:f2c14e", "paladin",
              effect={"id": "divine_shield", "name": "Divine Shield", "durationMs": 15000, "mods": {"shield": 8}, "scale": "str"}),
        skill("cleave", "warrior", "Cleave", "Hew through every foe around you.", J, 40, 9000, "aoe", 1.6, False, 0, "essence:e0483a", "berserker", radius=2.0, maxTargets=6),
        skill("bloodlust", "warrior", "Bloodlust", "50% more damage but 20% more damage taken for 12s.", J + 5, 30, 35000, "buff", 0, False, 0, "essence:8a1a1a", "berserker",
              effect={"id": "bloodlust", "name": "Bloodlust", "durationMs": 12000, "mods": {"dmg": 1.5, "taken": 1.2}}),
        # Mage → Sorcerer / Necromancer
        skill("meteor", "mage", "Meteor", "Call down a meteor on the target area.", J, 30, 12000, "aoe", 2.0, True, 6, "essence:ff7a2a", "sorcerer", radius=2.2, maxTargets=6),
        skill("chain_lightning", "mage", "Chain Lightning", "A bolt of lightning (huge single-target damage).", J + 5, 22, 5000, "attack", 3.0, True, 6, "essence:8fd0ff", "sorcerer"),
        skill("life_drain", "mage", "Life Drain", "Rot the target: heavy damage over 8s.", J, 18, 8000, "debuff", 0, True, 6, "essence:6a2a8a", "necromancer",
              effect={"id": "drained", "name": "Life Drain", "durationMs": 8000, "mods": {"dot": 3}, "scale": "int"}),
        skill("curse", "mage", "Curse of Weakness", "Cursed foes take 35% more damage for 12s.", J + 5, 20, 20000, "debuff", 0, True, 6, "essence:3a2050", "necromancer",
              effect={"id": "cursed", "name": "Cursed", "durationMs": 12000, "mods": {"taken": 1.35}}),
        # Archer → Ranger / Beastmaster (hawk skills)
        skill("piercing_arrow", "archer", "Piercing Arrow", "An arrow that punches through armor.", J, 30, 6000, "attack", 2.8, False, 7, "essence:e8dcc0", "ranger"),
        skill("arrow_storm", "archer", "Arrow Storm", "Rain arrows on a wide area.", J + 5, 50, 14000, "aoe", 1.3, False, 7, "essence:c9a36b", "ranger", radius=2.6, maxTargets=8),
        skill("falcon_strike", "archer", "Falcon Strike", "Your hawk dive-bombs the target: high damage and bleeding.", J, 30, 8000, "attack", 2.4, False, 8, "essence:b8844d", "beastmaster",
              effect={"id": "bleeding", "name": "Bleeding", "durationMs": 6000, "mods": {"dot": 2}, "scale": "str"}),
        skill("blind_blitz", "archer", "Blind Blitz", "Your hawk goes for the eyes: the target's accuracy drops by 50% for 5s.", J + 3, 25, 15000, "debuff", 0, False, 8, "essence:5a4670", "beastmaster",
              effect={"id": "blinded", "name": "Blinded", "durationMs": 5000, "mods": {"acc": 0.5}}),
        skill("hunters_eye", "archer", "Hunter's Eye", "Your hawk screeches and marks every foe nearby: +25% critical chance against them for 10s.", J + 6, 35, 20000, "aoe", 0.3, False, 7, "essence:f2c14e", "beastmaster",
              radius=3.0, maxTargets=8, effect={"id": "hunters_eye", "name": "Hunter's Eye", "durationMs": 10000, "mods": {"critTaken": 25}}),
        # Acolyte → High Priest / Inquisitor
        skill("holy_light", "acolyte", "Holy Light", "A beam of searing light.", J, 14, 5000, "attack", 2.6, True, 6, "essence:fff6c8", "high_priest"),
        skill("sanctuary", "acolyte", "Sanctuary", "Holy ground: strong regeneration for 12s.", J + 5, 28, 30000, "buff", 0, False, 0, "essence:9cf06a", "high_priest",
              effect={"id": "sanctuary", "name": "Sanctuary", "durationMs": 12000, "mods": {"regen": 4}, "scale": "int"}),
        skill("judgment", "acolyte", "Judgment", "Strike down the wicked with heavy holy damage.", J, 16, 6000, "attack", 2.8, True, 1.6, "essence:f2c14e", "inquisitor"),
        skill("purge", "acolyte", "Purging Flames", "Burn foes around you.", J + 5, 24, 12000, "aoe", 1.5, True, 0, "essence:ffb03a", "inquisitor", radius=2.2, maxTargets=6),
    ]
    return out


def main():
    (DATA / "classes.json").write_text(json.dumps(CLASSES, indent=1) + "\n")
    skills = json.loads((DATA / "skills.json").read_text())
    if any(s["classId"] in ("ranger", "priest", "rogue") for s in skills):
        skills = build_skills(skills)
        (DATA / "skills.json").write_text(json.dumps(skills, indent=1) + "\n")
    items = json.loads((DATA / "items.json").read_text())
    remap = {"ranger": "archer", "priest": "acolyte", "rogue": "archer"}
    for it in items:
        eq = it.get("equip")
        if eq and eq.get("classes"):
            eq["classes"] = sorted({remap.get(c, c) for c in eq["classes"]})
    (DATA / "items.json").write_text(json.dumps(items, indent=1) + "\n")
    print("classes:", [c["id"] for c in CLASSES], "skills:", len(skills))


if __name__ == "__main__":
    main()
