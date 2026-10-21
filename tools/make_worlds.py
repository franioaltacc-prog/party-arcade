"""Writes the extra Motocross free-ride worlds (public/js/games/moto/open-world/<id>.json) from short specs:
spots (the places, each with a safe pad), hills, trails between the spots and mini races on those trails.
Everything else in a world file (pads, interaction points, quests…) follows the same pattern as the first three.
Run: python3 tools/make_worlds.py"""
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "js" / "games" / "moto" / "open-world"

WORLDS = [
    {
        "id": "golddunes", "name": "Golden Dunes", "tagline": "Ride into the sunset.", "theme": "desert", "seed": 5527,
        "size": 3200, "baseHeight": 30, "cliff": [300, 500],
        "palette": {"sky": "#f2b27a", "low": "#c4884a", "high": "#f3d49a", "trail": "#e2b97a", "water": "#3f8f95", "accent": "#ffb347"},
        "look": {"sky": {"sun": [6, 250], "turbidity": 12, "rayleigh": 4, "mie": 0.02, "mieG": 0.93, "exposure": 1.05, "fog": 0.5, "fogColor": "#f0a76a", "sunColor": "#ffb57d"},
                 "dirt": [[200, 140, 66], [252, 214, 146]], "rock": [[170, 100, 50], [236, 170, 104]]},
        "terrain": {"noise": 11, "scale": 230, "hills": [[-900, -950, 230, 650, 600], [950, -900, 300, 640, 640], [900, 800, 170, 520, 480], [0, -1150, 150, 600, 420], [-300, 200, 70, 520, 400]],
                    "lake": {"position": [250, 350], "radius": [180, 140], "level": 28, "depth": 14}},
        "spots": [("camp", "Caravan Camp", -950, 950, "camp", "Shared spawn under the palms."),
                  ("crest", "Sunset Crest", -900, -950, "lookout", "The highest dune: watch the sun go down."),
                  ("oasis", "Palm Oasis", -50, 450, "checkpoint", "Water, shade and a jump park."),
                  ("sphinx", "Sandstone Sphinx", 950, -900, "ruin", "Old ruins on the far dune."),
                  ("market", "Spice Market", 950, 800, "yard", "A busy yard with a sprint round it."),
                  ("tower", "Signal Tower", 0, -1150, "tower", "A radio mast on the northern ridge.")],
        "routes": [("dune-loop", "Dune Sea Loop", [[-950, 950], [-1300, 400], [-1350, -300], [-1100, -1000], [-500, -1300], [0, -1150], [600, -1300], [1100, -1000], [1350, -300], [1300, 400], [950, 800], [400, 1200], [-300, 1300], [-950, 950]], True),
                   ("crest-climb", "Sunset Crest Climb", [[-950, 950], [-800, 500], [-1000, 0], [-700, -400], [-1000, -700], [-900, -950]], False),
                   ("sphinx-run", "Sphinx Downhill", [[950, -900], [700, -500], [1000, -100], [700, 300], [950, 800]], False),
                   ("market-ring", "Market Sprint", [[950, 800], [1150, 650], [1200, 400], [950, 250], [700, 450], [700, 750], [950, 800]], True),
                   ("oasis-link", "Oasis Road", [[-950, 950], [-500, 700], [-50, 450], [350, 100], [700, 300]], False),
                   ("ridge-road", "Ridge Road", [[-1000, -700], [-500, -900], [0, -1150], [500, -900], [950, -900]], False)],
        "races": [("dunes-grand", "Golden Dunes Rally", "dune-loop", "circuit", "medium", 1), ("dunes-climb", "King of the Crest", "crest-climb", "hillclimb", "hard", 1),
                  ("dunes-downhill", "Sphinx Plunge", "sphinx-run", "downhill", "hard", 1), ("dunes-market", "Market Scramble", "market-ring", "circuit", "easy", 3)],
        "ramps": [("oasis-double", -350, 650, 2.4, 90, 18, 7), ("market-table", 820, 600, 0.6, 100, 24, 9)],
        "zones": [("soft-sand", -500, -200, 260, "sand", 0.74, 0.03), ("oasis-mud", 150, 380, 80, "mud", 0.72, 0.025)],
    },
    {
        "id": "autumnridge", "name": "Autumn Ridge", "tagline": "Gold leaves, fast trails.", "theme": "alpine", "seed": 3307,
        "size": 3400, "baseHeight": 50, "cliff": [280, 560],
        "palette": {"sky": "#d9c9ad", "low": "#7a5a2c", "high": "#e3c088", "trail": "#a98a62", "water": "#3f7f8f", "accent": "#ff9a3c"},
        "look": {"autumn": True, "sky": {"sun": [26, 210], "turbidity": 5, "rayleigh": 1.8, "mie": 0.008, "exposure": 1.35, "fog": 0.3, "fogColor": "#d6c3a1", "sunColor": "#ffdcae"},
                 "grass": [[118, 104, 40], [214, 170, 72]], "rock": [[84, 76, 68], [160, 150, 132]]},
        "terrain": {"noise": 8, "scale": 240, "hills": [[700, -900, 470, 720, 700], [-950, -800, 330, 640, 660], [1150, 650, 240, 500, 600], [-1100, 650, 110, 480, 480], [0, -1350, 180, 820, 480]],
                    "lake": {"position": [-150, 300], "radius": [320, 220], "level": 55, "depth": 24}},
        "spots": [("lodge", "Maple Lodge", -1100, 1100, "camp", "Shared spawn at the old hunting lodge."),
                  ("summit", "Red Oak Summit", 700, -950, "lookout", "The top of the ridge, above the trees."),
                  ("falls", "Copper Falls", -950, -850, "tower", "A fire tower over the waterfall."),
                  ("mill", "Old Sawmill", 1150, 650, "yard", "Logs, ramps and a quick sprint."),
                  ("lake", "Lakeside Dock", -150, 650, "dock", "The jetty on the lake."),
                  ("cabin", "Hollow Cabin", -300, -600, "cabin", "A quiet cabin in the woods.")],
        "routes": [("ridge-loop", "Autumn Ridge Loop", [[-1100, 1100], [-1400, 500], [-1400, -200], [-1200, -900], [-600, -1300], [100, -1350], [800, -1350], [1300, -900], [1450, -200], [1400, 450], [1150, 650], [700, 1150], [0, 1350], [-600, 1300], [-1100, 1100]], True),
                   ("summit-climb", "Red Oak Climb", [[-150, 650], [350, 700], [550, 250], [300, -200], [650, -600], [700, -950]], False),
                   ("falls-run", "Falls Descent", [[-950, -850], [-1150, -400], [-850, 0], [-1100, 450], [-1100, 1100]], False),
                   ("mill-ring", "Sawmill Sprint", [[1150, 650], [1350, 500], [1300, 250], [1050, 200], [900, 450], [950, 750], [1150, 650]], True),
                   ("lake-link", "Lakeshore Trail", [[-1100, 1100], [-650, 900], [-150, 650], [400, 750], [900, 600], [1150, 650]], False),
                   ("cabin-cut", "Cabin Cut", [[-950, -850], [-600, -750], [-300, -600], [100, -750], [450, -850], [700, -950]], False)],
        "races": [("ridge-grand", "Autumn Ridge Endurance", "ridge-loop", "circuit", "medium", 1), ("ridge-climb", "King of Red Oak", "summit-climb", "hillclimb", "hard", 1),
                  ("ridge-downhill", "Falls Freefall", "falls-run", "downhill", "hard", 1), ("ridge-mill", "Sawmill Scramble", "mill-ring", "circuit", "easy", 3)],
        "ramps": [("lodge-double", -700, 950, 2.0, 90, 18, 7), ("mill-table", 1000, 450, 0.3, 100, 24, 9)],
        "zones": [("leaf-mud", -1150, -150, 180, "mud", 0.74, 0.02), ("lake-mud", -150, 520, 90, "mud", 0.72, 0.025)],
    },
    {
        "id": "canyonrun", "name": "Canyon Run", "tagline": "Mind the drop.", "theme": "desert", "seed": 8861,
        "size": 3600, "baseHeight": 60, "cliff": [320, 540],
        "palette": {"sky": "#e9c3a3", "low": "#9a4a34", "high": "#e3a77a", "trail": "#d7a477", "water": "#3b8e8a", "accent": "#ff6a3c"},
        "look": {"sky": {"sun": [44, 160], "turbidity": 6, "rayleigh": 2.2, "mie": 0.007, "exposure": 1.1, "fog": 0.36, "fogColor": "#e8c2a0"},
                 "rock": [[118, 46, 40], [214, 120, 86]], "dirt": [[160, 92, 62], [222, 160, 116]]},
        "terrain": {"noise": 10, "scale": 270, "hills": [[-1100, -1050, 280, 700, 660], [1050, -1000, 330, 680, 640], [1150, 900, 220, 560, 560], [-1150, 750, 150, 500, 500], [0, -1400, 160, 760, 420]],
                    "river": {"x": 0, "amplitude": 160, "wavelength": 520, "width": 130, "depth": 70, "level": 12}},
        "spots": [("outpost", "Red Rock Outpost", -1100, 1100, "camp", "Shared spawn on the west rim."),
                  ("butte", "Thunder Butte", -1100, -1050, "lookout", "The top of the west butte."),
                  ("bridge", "Old Rail Bridge", -400, 0, "checkpoint", "On the edge of the canyon: look down."),
                  ("arch", "Window Arch", 1050, -1000, "ruin", "A stone arch on the east butte."),
                  ("mine", "Copper Mine", 1150, 900, "yard", "Mine works on the east rim."),
                  ("station", "Ranger Station", 450, 300, "cabin", "A ranger cabin across the canyon.")],
        "routes": [("rim-loop", "Canyon Rim Loop", [[-1100, 1100], [-1450, 500], [-1500, -300], [-1250, -1150], [-600, -1450], [0, -1400], [650, -1450], [1250, -1150], [1500, -300], [1450, 500], [1150, 900], [600, 1400], [-200, 1450], [-800, 1350], [-1100, 1100]], True),
                   ("butte-climb", "Thunder Butte Climb", [[-1100, 1100], [-900, 600], [-1150, 100], [-800, -300], [-1200, -700], [-1100, -1050]], False),
                   ("arch-run", "Window Arch Descent", [[1050, -1000], [1350, -600], [1000, -200], [1300, 300], [1150, 900]], False),
                   ("mine-ring", "Mine Sprint", [[1150, 900], [1350, 750], [1400, 500], [1150, 400], [950, 600], [950, 850], [1150, 900]], True),
                   ("canyon-cross", "Canyon Crossing", [[-1100, 1100], [-700, 600], [-400, 0], [50, 150], [450, 300], [950, 600]], False),
                   ("north-rim", "North Rim", [[-1200, -700], [-600, -950], [0, -1400], [600, -950], [1050, -1000]], False)],
        "races": [("canyon-grand", "Canyon Rim Rally", "rim-loop", "circuit", "medium", 1), ("canyon-climb", "King of Thunder Butte", "butte-climb", "hillclimb", "hard", 1),
                  ("canyon-downhill", "Arch Dive", "arch-run", "downhill", "hard", 1), ("canyon-mine", "Mine Scramble", "mine-ring", "circuit", "easy", 3)],
        "ramps": [("canyon-kicker", -250, 850, 1.9, 110, 22, 11), ("mine-table", 1000, 700, 0.5, 100, 24, 9)],
        "zones": [("rim-sand", -800, -300, 220, "sand", 0.78, 0.025), ("mine-gravel", 1150, 800, 120, "gravel", 0.8, 0.02)],
    },
]


def build(w):
    sx = w["size"]
    spots = [{"id": i, "name": n, "position": [x, z], "kind": k, "radius": 24, "about": a} for i, n, x, z, k, a in w["spots"]]
    first = spots[0]
    # face the spawn towards the middle of the map
    heading = round(math.atan2(-first["position"][0], -first["position"][1]), 6)
    px, pz = first["position"]
    pads = [{"id": f"spawn-{k + 1}", "position": [px - 24 + 5 * (k % 3), pz - 18 - 6 * (k // 3)], "heading": heading} for k in range(6)]
    routes = [{"id": i, "name": n, "points": p, "width": 14, "shoulder": 20, **({"closed": True} if c else {})} for i, n, p, c in w["routes"]]
    races = [{"id": i, "name": n, "route": r, "type": t, "difficulty": d, "laps": laps, "players": [1, 6], "gateRadius": 22, "countdown": 5, "medalSeconds": None,
              "description": "Follow the ordered gates."} for i, n, r, t, d, laps in w["races"]]
    by = {s["id"]: s for s in spots}
    at = lambda sid, dx=0, dz=0: [by[sid]["position"][0] + dx, by[sid]["position"][1] + dz]
    ids = [s["id"] for s in spots]
    interactions = [
        {"id": "board", "name": f"{first['name']} race board", "position": at(ids[0], 40), "kind": "race-board", "radius": 18, "event": "race.offer", "about": "Choose a mini race and invite nearby friends.", "cooldownSeconds": 10},
        {"id": "jam", "name": f"{by[ids[4]]['name']} trick jam", "position": at(ids[4], -50, -20), "kind": "trick-zone", "radius": 18, "event": "trick.land", "about": "Share a two-minute trick score with friends.", "cooldownSeconds": 10},
        {"id": "camera", "name": f"{by[ids[1]]['name']} photo perch", "position": at(ids[1]), "kind": "photo", "radius": 18, "event": "photo.capture", "about": "Get the whole group into a summit picture.", "cooldownSeconds": 10},
    ]
    quests = [
        {"id": f"{w['id']}-welcome", "name": f"Welcome to {w['name']}", "start": ids[0], "players": [1, 6],
         "steps": [{"event": "zone.enter", "target": ids[2], "count": 1}, {"event": "zone.enter", "target": ids[4], "count": 1}, {"event": "zone.enter", "target": ids[0], "count": 1}],
         "reward": {"type": "cosmetic-token", "amount": 1}, "repeatable": True},
        {"id": f"{w['id']}-summit", "name": "Top of the World", "start": ids[0], "players": [1, 6],
         "steps": [{"event": "zone.enter", "target": ids[1], "count": 1}, {"event": "photo.capture", "target": "camera", "count": 1}],
         "reward": {"type": "cosmetic-token", "amount": 1}, "repeatable": True},
    ]
    return {
        "schemaVersion": 1, "id": w["id"], "name": w["name"], "tagline": w["tagline"], "theme": w["theme"], "seed": w["seed"],
        "size": [sx, sx], "baseHeight": w["baseHeight"], "spawn": first["position"], "spawnHeading": heading,
        "palette": w["palette"], "look": w["look"], "terrain": w["terrain"],
        "regions": [{"name": s["name"], "position": s["position"]} for s in spots],
        "routes": routes, "spots": spots, "races": races, "interactions": interactions,
        "ramps": [{"id": i, "position": [x, z], "heading": hd, "length": ln, "width": wd, "height": ht} for i, x, z, hd, ln, wd, ht in w["ramps"]],
        "surfaceZones": [{"id": i, "position": [x, z], "radius": r, "surface": s, "grip": g, "roll": ro} for i, x, z, r, s, g, ro in w["zones"]],
        "quests": quests,
        "coordinateSystem": {"units": "metres", "horizontal": ["x", "z"], "up": "y", "heading": "radians: 0 points +z; positive rotates towards +x"},
        "status": "Made by tools/make_worlds.py.",
        "boundary": {"softMargin": 100, "policy": "warn-and-respawn", "respawn": "last-safe-pad", "cliffWidth": w["cliff"][0], "cliffHeight": w["cliff"][1], "sceneryApron": 1600},
        "spawnPads": pads,
        "safePads": [{"id": s["id"], "position": s["position"], "radius": 32, "riderPosition": [s["position"][0] - 24, s["position"][1] - 18]} for s in spots],
    }


if __name__ == "__main__":
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for w in WORLDS:
        (OUT / f"{w['id']}.json").write_text(json.dumps(build(w), indent=2) + "\n")
        entry = {"id": w["id"], "name": w["name"], "file": f"{w['id']}.json", "areaKm2": round(w["size"] ** 2 / 1e6, 2)}
        manifest["worlds"] = [x for x in manifest["worlds"] if x["id"] != w["id"]] + [entry]
        print("wrote", w["id"])
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
