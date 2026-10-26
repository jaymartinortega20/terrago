"""TerraGo: the Endless Rift — an instanced ring of floors that get harder forever,
and the Rift Keeper who opens it (Oakhaven, by the old altar).

Run from the repo root: python3 packages/game-data/scripts/gen_v25_rift.py
"""
import json
import random
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
W, H = 30, 22


def main():
    rnd = random.Random(7)
    rows = []
    for y in range(H):
        row = ""
        for x in range(W):
            edge = x in (0, W - 1) or y in (0, H - 1)
            if edge or ((x < 2 or x > W - 3) and (y < 2 or y > H - 3)):
                row += "#"
            else:
                row += "c" if rnd.random() < 0.85 else "k"
        rows.append(row)
    pillars = [(7, 6), (22, 6), (7, 15), (22, 15), (14, 4), (15, 17)]
    objects = [{"kind": "prop", "type": "crystal", "x": x, "y": y} for x, y in pillars]
    objects += [{"kind": "prop", "type": "torch", "x": x, "y": y} for x, y in [(3, 2), (26, 2), (3, 19), (26, 19)]]
    rift = {
        "id": "rift", "name": "The Endless Rift", "safeZone": False, "music": "dungeon",
        "spawn": {"x": 15, "y": 19, "dir": "up"}, "portals": [], "instanced": True, "rift": True,
        "theme": "cave", "width": W, "height": H, "tileSize": 32, "tiles": rows, "objects": objects,
        "respawn": {"mapId": "greenhaven", "x": 38, "y": 13},
    }
    (DATA / "maps" / "rift.json").write_text(json.dumps(rift, indent=1) + "\n")

    npcs = json.loads((DATA / "npcs.json").read_text())
    if not any(n["id"] == "rift_keeper_sera" for n in npcs):
        npcs.append({
            "id": "rift_keeper_sera", "name": "Rift Keeper Sera", "title": "The Endless Rift", "mapId": "greenhaven", "x": 38, "y": 12, "dir": "down",
            "appearance": {"bodyType": "b", "skinTone": 1, "hairStyle": 1, "hairColor": 6, "eyeColor": 4, "outfit": 4},
            "accessory": "hood",
            "firstMeeting": {"lines": [
                "You feel it too? The old altar hums at night. There's a crack in the world behind it — the Rift.",
                "Every floor down is harder than the last, and nobody has found the bottom.",
                "Go as deep as you dare. Bring friends. Bring food. I'll trade for the shards you find.",
            ]},
            "greetings": [["The Rift is restless today."], ["How deep did you get last time?"]],
            "services": ["rift"],
        })
    (DATA / "npcs.json").write_text(json.dumps(npcs, indent=1) + "\n")
    print("\n".join(rows[:4]))


if __name__ == "__main__":
    main()
