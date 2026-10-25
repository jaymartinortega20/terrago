"""TerraGo: the ranked arena — a small walled ring for 1v1 matches (an instance per match).

Run from the repo root: python3 packages/game-data/scripts/gen_v23_arena.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
W, H = 26, 18


def main():
    rows = []
    for y in range(H):
        row = ""
        for x in range(W):
            edge = x in (0, W - 1) or y in (0, H - 1)
            corner = (x < 3 or x > W - 4) and (y < 3 or y > H - 4)
            if edge or corner:
                row += "#"
            elif (x + y) % 7 == 0 and 4 < x < W - 5 and 3 < y < H - 4:
                row += ":"
            else:
                row += "k"
        rows.append(row)
    objects = [
        {"kind": "prop", "type": "ruin_pillar", "x": 8, "y": 6},
        {"kind": "prop", "type": "ruin_pillar", "x": 17, "y": 6},
        {"kind": "prop", "type": "ruin_pillar", "x": 8, "y": 11},
        {"kind": "prop", "type": "ruin_pillar", "x": 17, "y": 11},
        {"kind": "prop", "type": "torch", "x": 4, "y": 2},
        {"kind": "prop", "type": "torch", "x": 21, "y": 2},
        {"kind": "prop", "type": "torch", "x": 4, "y": 15},
        {"kind": "prop", "type": "torch", "x": 21, "y": 15},
    ]
    arena = {
        "id": "arena", "name": "Proving Grounds", "safeZone": False, "music": "ruins",
        "spawn": {"x": 5, "y": 9, "dir": "right"}, "portals": [], "instanced": True, "arena": True,
        "theme": "ruins", "width": W, "height": H, "tileSize": 32, "tiles": rows, "objects": objects,
    }
    (DATA / "maps" / "arena.json").write_text(json.dumps(arena, indent=1) + "\n")
    print("\n".join(rows))


if __name__ == "__main__":
    main()
