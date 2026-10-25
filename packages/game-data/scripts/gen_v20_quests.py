"""TerraGo: map story chains, bounty boards and quest waypoints.

- Two new townsfolk: Ranger Wren (Whispering Fields) and Flamewarden Ysolde
  (Infernal Caldera).
- A short story chain on every hunting map (Sunfield, Crags, Glacial Depths,
  Dragon's Peak, Caldera). Chain quests open by level, alongside the main story.
- Bounty boards: Guildmaster Kael and the map scouts post daily bounties.
- Every quest step gets a `where` (spawn area, node or NPC) so the guide arrow
  and auto-walk can take you there.

Run from the repo root: python3 packages/game-data/scripts/gen_v20_quests.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, value):
    (DATA / name).write_text(json.dumps(value, indent=1) + "\n")


NEW_NPCS = [
    {
        "id": "ranger_wren", "name": "Ranger Wren", "title": "Whispering Fields", "mapId": "sunfield_plains", "x": 26, "y": 24, "dir": "right",
        "appearance": {"bodyType": "a", "skinTone": 1, "hairStyle": 3, "hairColor": 2, "eyeColor": 3, "outfit": 2},
        "accessory": "hood",
        "firstMeeting": {"lines": [
            "Easy there — you're the new settler? Wren. I keep the Fields road safe, mostly.",
            "Rats in the barns, boars in the fields, goblins in the east and worse to the south.",
            "If you want honest work, I always have some. And check the bounty board when you're stronger.",
        ]},
        "greetings": [["The road's quiet today. Let's keep it that way."], ["Heard the Warden stirring down south. Stay sharp."]],
        "services": ["bounty"],
    },
    {
        "id": "flamewarden_ysolde", "name": "Flamewarden Ysolde", "title": "The Infernal Caldera", "mapId": "infernal_caldera", "x": 20, "y": 33, "dir": "right",
        "appearance": {"bodyType": "b", "skinTone": 3, "hairStyle": 5, "hairColor": 0, "eyeColor": 4, "outfit": 6},
        "accessory": "helmet",
        "firstMeeting": {"lines": [
            "You climbed all the way up here? Then you're either brave or lost.",
            "I watch the Caldera for the Guild. The imps multiply, the hounds hunt in packs and the Titan sleeps in the heart of it all.",
            "Help me keep the fire in its cage.",
        ]},
        "greetings": [["The ground's hot enough to cook on. Don't."], ["The Titan stirs. Can you feel it?"]],
        "services": ["bounty"],
    },
]

BOARD_NPCS = ["guildmaster_kael", "forgewarden_hal", "scout_bjorna", "hunter_kade"]


def reward(level, stones=1, potions=None):
    items = [{"itemId": "enhancement_stone", "quantity": stones}]
    if potions:
        items.append({"itemId": potions, "quantity": 3})
    return {"gold": int(level * 55), "xp": int(level * level * 5 + 300), "items": items}


def kill(target, count, text):
    return {"text": text, "type": "kill", "target": target, "count": count}


def quest(id, name, giver, chain, min_level, requires, description, intro, outro, steps, rew, turn_in=None):
    q = {"id": id, "name": name, "giver": giver, "turnIn": turn_in or giver, "chain": chain, "minLevel": min_level,
         "description": description, "intro": intro, "outro": outro, "steps": steps, "rewards": rew}
    if requires:
        q["requires"] = requires
    return q


SF = "Whispering Fields Stories"
CR = "Crags Chronicle"
GL = "Tales of the Depths"
DS = "Dragon's Peak Saga"
IC = "Embers of the Caldera"

NEW_QUESTS = [
    # --- Sunfield Plains (Ranger Wren) ---
    quest("q_sf_rats", "Pantry Raiders", "ranger_wren", SF, 2, "q_pony",
          "Rats are eating the farmers' grain stores east of the road.",
          ["The barns east of the road are crawling with rats.", "Clear out eight of them and the farmers will sleep easier."],
          ["Good riddance. The farmers asked me to pass this on."],
          [kill("field_rat", 8, "Defeat 8 Field Rats (east of the road)")], reward(4, 1, "minor_health_potion")),
    quest("q_sf_boars", "Trampled Fields", "ranger_wren", SF, 5, "q_sf_rats",
          "Wild boars keep trampling Farmer Rowan's neighbours' crops.",
          ["Boars! Big ones, west of the road. They flatten a field in a night.", "Drive off six, then let Farmer Rowan know it's safe."],
          ["Wren sent you? Bless you — my seedlings might survive the week."],
          [kill("wild_boar", 6, "Defeat 6 Wild Boars (west fields)"), {"text": "Tell Farmer Rowan the fields are safe", "type": "talk", "target": "farmer_rowan", "count": 1}],
          reward(6, 1, "minor_health_potion"), turn_in="farmer_rowan"),
    quest("q_sf_orcs", "Orc Raiders", "ranger_wren", SF, 16, "q_sf_boars",
          "An orc warband has made camp in the south-west of the Fields.",
          ["Orcs are camped in the south-west. They've been raiding the caravans.", "Break their warband: ten should do it."],
          ["Ha! They'll think twice before raiding my road again."],
          [kill("orc", 10, "Defeat 10 Orcs (south-west camp)")], reward(19, 2)),
    quest("q_sf_spiders", "Webs in the East", "ranger_wren", SF, 26, "q_sf_orcs",
          "Giant spiders are spinning webs across the eastern trails.",
          ["Travellers keep vanishing on the east trail. Webs everywhere.", "Burn out the nest — ten giant spiders."],
          ["You came back without a single bite? Impressive."],
          [kill("giant_spider", 10, "Defeat 10 Giant Spiders (east trail)")], reward(30, 2)),
    quest("q_sf_bones", "The Restless Dead", "ranger_wren", SF, 32, "q_sf_spiders",
          "Skeletons are rising near the Warden's grounds. The Guild should hear of it.",
          ["Bones are walking near the southern ruins. That's never a good sign.", "Put twelve back in the ground, then report to Guildmaster Kael."],
          ["Skeletons, by the Warden's grounds? Then the old magic is waking. Well done."],
          [kill("skeleton", 12, "Defeat 12 Skeletons (southern ruins)"), {"text": "Report to Guildmaster Kael in Oakhaven", "type": "talk", "target": "guildmaster_kael", "count": 1}],
          reward(36, 3), turn_in="guildmaster_kael"),

    # --- Desolate Crags (Forgewarden Hal) ---
    quest("q_cr_bandits", "Dust and Daggers", "forgewarden_hal", CR, 48, "q_warden",
          "Dust bandits are robbing the ore carts that feed Hal's forge.",
          ["Bandits have been hitting my ore carts on the ridge.", "Ten of them, and the rest will scatter."],
          ["The carts are rolling again. Here — your cut."],
          [kill("dust_bandit", 10, "Defeat 10 Dust Bandits")], reward(52, 3)),
    quest("q_cr_shamans", "Stone That Heals", "forgewarden_hal", CR, 52, "q_cr_bandits",
          "Crag Shamans keep the elementals mended. Break their circle and bring Hal iron.",
          ["Ever notice the elementals won't stay down? Shamans, mending them.", "Take out six shamans — and bring me ten Iron Ore while you're out there."],
          ["Good ore, and good work. The forge thanks you."],
          [kill("crag_shaman", 6, "Defeat 6 Crag Shamans"), {"text": "Mine 10 Iron Ore", "type": "gather", "target": "iron_ore", "count": 10}], reward(56, 3)),
    quest("q_cr_golems", "Living Rock", "forgewarden_hal", CR, 56, "q_cr_shamans",
          "Rock Golems have blocked the north pass.",
          ["The north pass is clogged with golems. The giants' ancient guards, some say.", "Smash eight of them so the scouts can get through."],
          ["The pass is open. The scouts are already on their way to the Depths."],
          [kill("rock_golem", 8, "Defeat 8 Rock Golems")], reward(60, 4)),
    quest("q_cr_knights", "The Cursed Watch", "forgewarden_hal", CR, 64, "q_cr_golems",
          "Wraiths and Cursed Knights haunt the old ruins at the top of the Crags.",
          ["The old watch at the top of the Crags still keeps its post. Dead men, cursed armour.", "Lay eight wraiths and eight knights to rest."],
          ["Quiet up there at last. You've earned a forgewarden's respect."],
          [kill("wraith", 8, "Defeat 8 Wraiths"), kill("cursed_knight", 8, "Defeat 8 Cursed Knights")], reward(68, 5)),

    # --- Glacial Depths (Scout Bjorna) ---
    quest("q_gl_wolves", "Pack on the Slopes", "scout_bjorna", GL, 72, "q_crags",
          "Snow wolves are hunting the Guild's scouts on the lower slopes.",
          ["The snow wolves have my scouts pinned. They charge fast — watch for it.", "Ten wolves, and my people can move again."],
          ["They're safe. I owe you one — no, I owe you several."],
          [kill("snow_wolf", 10, "Defeat 10 Snow Wolves")], reward(75, 4)),
    quest("q_gl_priestess", "The Frozen Choir", "scout_bjorna", GL, 82, "q_gl_wolves",
          "Frost Priestesses keep the Depths' creatures alive. Silence them.",
          ["Hear that singing? Frost Priestesses. Every song mends something you just broke.", "Silence six of them."],
          ["The singing's stopped. Eerie, but better."],
          [kill("frost_priestess", 6, "Defeat 6 Frost Priestesses")], reward(85, 5)),
    quest("q_gl_yeti", "Yeti Country", "scout_bjorna", GL, 86, "q_gl_priestess",
          "Yetis by the frozen lake are smashing the scouts' camps.",
          ["Yetis have wrecked three of our camps by the lake.", "Eight of them should teach the rest some manners."],
          ["Not bad for a lowlander."],
          [kill("frost_yeti", 8, "Defeat 8 Frost Yetis")], reward(89, 5)),
    quest("q_gl_warlock", "Ice and Iron", "scout_bjorna", GL, 88, "q_gl_yeti",
          "Glacier Warlocks summon wisps to guard the Frost Giant's brutes.",
          ["Warlocks call wisps out of the ice. Kill the warlock and the wisps go with it.", "Five warlocks — then six of the giant's brutes."],
          ["The giant's guard is broken. He'll be lonely in his cave now."],
          [kill("glacier_warlock", 5, "Defeat 5 Glacier Warlocks"), kill("frost_giant_brute", 6, "Defeat 6 Frost Giant Brutes")], reward(94, 6)),

    # --- Dragon's Peak (Hunter Kade) ---
    quest("q_ds_priests", "Fire Faith", "hunter_kade", DS, 100, "q_depths",
          "Dragon Priests heal the drakes as fast as Kade can wound them.",
          ["Every drake I hurt, a priest patches up. Infuriating.", "Six priests, then we hunt properly."],
          ["Now we're hunting."],
          [kill("dragon_priest", 6, "Defeat 6 Dragon Priests")], reward(100, 6)),
    quest("q_ds_brood", "The Brood", "hunter_kade", DS, 100, "q_ds_priests",
          "Drake Broodmothers hatch wyrms faster than the Peak can hold them.",
          ["Broodmothers. Each one calls hatchlings — and hatchlings explode.", "Four broodmothers. Keep moving."],
          ["The brood's thinning. You're good at this."],
          [kill("drake_broodmother", 4, "Defeat 4 Drake Broodmothers")], reward(100, 7)),
    quest("q_ds_knights", "Knights of the Spire", "hunter_kade", DS, 100, "q_ds_brood",
          "Dragon Knights guard the way to the summit, led by their champions.",
          ["The Dragon Knights swore themselves to the old wyrm. Ten of them, and three champions.", "Then the summit's yours."],
          ["The Spire's yours, hunter. The Guild will sing about this."],
          [kill("dragon_knight", 10, "Defeat 10 Dragon Knights"), kill("drake_champion", 3, "Defeat 3 Drake Champions")], reward(100, 8)),

    # --- Infernal Caldera (Flamewarden Ysolde) ---
    quest("q_ic_imps", "Imp Infestation", "flamewarden_ysolde", IC, 100, "q_peak",
          "Fire imps are swarming out of the Caldera's vents.",
          ["Imps. Dozens. They pour out of every vent.", "Twelve should keep them busy for a day."],
          ["Fewer squeaking, at least."],
          [kill("fire_imp", 12, "Defeat 12 Fire Imps")], reward(100, 6)),
    quest("q_ic_hounds", "Hounds of Magma", "flamewarden_ysolde", IC, 100, "q_ic_imps",
          "Magma Hounds hunt in packs around the Titan's lair.",
          ["The hounds circle the lair. They charge — don't stand in a line.", "Ten hounds."],
          ["Good. The Titan's pets are fewer."],
          [kill("magma_hound", 10, "Defeat 10 Magma Hounds")], reward(100, 7)),
    quest("q_ic_embers", "Living Flame", "flamewarden_ysolde", IC, 100, "q_ic_hounds",
          "Ember Elementals feed the Titan's fire. Put them out.",
          ["Every elemental is a piece of the Titan's fire walking around.", "Put out ten, and his flame burns lower."],
          ["The fire's in its cage again. Thank you, champion."],
          [kill("ember_elemental", 10, "Defeat 10 Ember Elementals")], reward(100, 10)),
]


def centre(area):
    return area["x"] + area["w"] // 2, area["y"] + area["h"] // 2


def fill_where(quests, npcs, maps):
    """Give every step a waypoint: monster spawn area, ore node, NPC or map entrance."""
    npc_at = {n["id"]: (n["mapId"], n["x"], n["y"]) for n in npcs}
    spawn_at = {}
    node_at = {}
    for m in maps.values():
        for s in m.get("spawns", []):
            spawn_at.setdefault(s["monster"], (m["id"],) + centre(s["area"]))
        for n in m.get("nodes", []):
            node_at.setdefault(n["type"], (m["id"], n["x"], n["y"]))
    node_for_item = {"copper_ore": "rock_copper", "iron_ore": "rock_iron", "crystal_ore": "rock_crystal", "mithril_ore": "rock_mithril", "stone": "rock_stone"}
    filled = 0
    for q in quests:
        for st in q["steps"]:
            if st.get("where"):
                continue
            hit = None
            t = st.get("target")
            if st["type"] == "kill" and t in spawn_at:
                hit = spawn_at[t]
            elif st["type"] == "talk" and t in npc_at:
                hit = npc_at[t]
            elif st["type"] == "gather" and node_for_item.get(t) in node_at:
                hit = node_at[node_for_item[t]]
            if hit:
                st["where"] = {"map": hit[0], "x": hit[1], "y": hit[2]}
                filled += 1
    return filled


def main():
    npcs = load("npcs.json")
    have = {n["id"] for n in npcs}
    npcs += [n for n in NEW_NPCS if n["id"] not in have]
    for n in npcs:
        if n["id"] in BOARD_NPCS:
            n["services"] = sorted(set((n.get("services") or []) + ["bounty"]))
    save("npcs.json", npcs)

    quests = load("quests.json")
    have = {q["id"] for q in quests}
    quests += [q for q in NEW_QUESTS if q["id"] not in have]
    maps = {p.stem: json.loads(p.read_text()) for p in (DATA / "maps").glob("*.json")}
    filled = fill_where(quests, npcs, maps)
    save("quests.json", quests)
    print("npcs", len(npcs), "quests", len(quests), "waypoints added", filled)


if __name__ == "__main__":
    main()
