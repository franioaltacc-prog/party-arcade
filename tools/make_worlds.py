"""Writes the extra Motocross free-ride worlds (public/js/games/moto/open-world/<id>.json) from short specs:
spots (the places, each with a safe pad), hills, trails between the spots and mini races on those trails.
Everything else in a world file (pads, interaction points, quests…) follows the same pattern as the first three.
It also gives every world (the first three included, see EXTRAS) its gap jumps and pools ("features"):
  gaps:  {id, kind: lava | water | ice | chasm, route, at (0..1 along it), side (±1), gap (m), height, width}
         placed beside that point of the trail, on the nearest clear, flattish ground (terrain.mjs)
  pools: {id, kind: lava | tar | water, position, radius: [rx, rz], turn, trail (how far from trails)}
Run: python3 tools/make_worlds.py"""
import json
import math
from pathlib import Path


def spiral(cx, cz, r0, r1, a0, turns, n, start=None, end=None):
    """Trail points winding round (cx, cz) from radius r0 at angle a0 to radius r1 (a gentle climb up a cone)."""
    pts = [] if start is None else [start]
    for i in range(n + 1):
        t = i / n
        a = a0 + turns * 2 * math.pi * t
        r = r0 + (r1 - r0) * t
        pts.append([round(cx + math.cos(a) * r), round(cz + math.sin(a) * r)])
    return pts + ([] if end is None else [end])


def gap(i, kind, route, at, side, length, height=3.2, width=24, bike=False):
    # (sizes are given small and scaled up: the free-ride bike flies a long way; bike=True: a mountain bike's gap, as given)
    if bike:
        return {"id": i, "kind": kind, "route": route, "at": at, "side": side, "gap": length, "height": height, "width": width}
    return {"id": i, "kind": kind, "route": route, "at": at, "side": side, "gap": round(length * 1.8), "height": round(height * 1.15, 1), "width": width + 4}


def pool(i, kind, x, z, rx, rz, turn=0.0, trail=30):
    return {"id": i, "kind": kind, "position": [x, z], "radius": [rx, rz], "turn": turn, "trail": trail}


OUT = Path(__file__).resolve().parent.parent / "public" / "js" / "games" / "moto" / "open-world"


def scarp_z(x, w):
    """Where Sheerwall's cliff face runs (its middle) at x."""
    sc = w["terrain"]["scarp"]
    return sc["z"] + math.sin(x / sc["wavelength"]) * sc["amplitude"]


def cliff_road(xs, s0, s1, scarp):
    """A road cut into the cliff face: along it from west to east, from s0 metres off the face's middle (- = up on top)
    to s1 (+ = down below)."""
    return [[x, round(scarp["z"] + math.sin(x / scarp["wavelength"]) * scarp["amplitude"] + s0 + (s1 - s0) * (x - xs[0]) / (xs[-1] - xs[0]))] for x in xs]


SHEERWALL_SCARP = {"z": -150, "amplitude": 140, "wavelength": 640, "height": 420, "edge": 160}

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
        "features": {"gaps": [gap("oasis-gap", "water", "oasis-link", 0.3, 1, 24), gap("dune-gap", "water", "dune-loop", 0.62, -1, 30, 3.6),
                              gap("ridge-chasm", "chasm", "ridge-road", 0.55, 1, 26)],
                     "pools": [pool("tar-pit", "tar", -400, -650, 40, 28, 0.6), pool("market-tar", "tar", 600, 650, 30, 22)]},
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
        "features": {"gaps": [gap("creek-gap", "water", "ridge-loop", 0.08, 1, 24), gap("mill-gap", "water", "lake-link", 0.75, -1, 28, 3.4),
                              gap("oak-chasm", "chasm", "summit-climb", 0.3, -1, 26), gap("falls-gap", "water", "falls-run", 0.5, -1, 30, 3.6)]},
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
        "features": {"gaps": [gap("slot-canyon", "chasm", "rim-loop", 0.12, -1, 26), gap("rim-chasm", "chasm", "butte-climb", 0.5, -1, 32, 3.8),
                              gap("arch-chasm", "chasm", "arch-run", 0.45, 1, 28), gap("mine-gap", "water", "mine-ring", 0.4, -1, 22, 3)],
                     "pools": [pool("outpost-tar", "tar", -700, 1250, 32, 24, 0.4)]},
    },
    {
        "id": "magmaisle", "name": "Magma Isle", "tagline": "The floor is lava. Really.", "theme": "desert", "seed": 6661,
        "size": 3400, "baseHeight": 40, "cliff": [300, 520],
        "palette": {"sky": "#b98a74", "low": "#2c2624", "high": "#6e625c", "trail": "#8a7466", "water": "#ff5a1a", "accent": "#ff4a1a"},
        "look": {"flora": ["rock", "deadtree", "shrub"],
                 "sky": {"sun": [18, 235], "turbidity": 14, "rayleigh": 3.2, "mie": 0.03, "mieG": 0.9, "exposure": 1.15, "fog": 0.46, "fogColor": "#9a7262", "sunColor": "#ffb08a"},
                 "rock": [[30, 28, 30], [92, 84, 82]], "dirt": [[70, 58, 52], [138, 116, 100]], "grass": [[64, 60, 44], [112, 104, 70]]},
        "terrain": {"noise": 9, "scale": 240, "hills": [[200, -250, 360, 620, 620], [1100, -1050, 150, 420, 420], [-1050, -950, 140, 480, 460], [1150, 950, 70, 420, 380], [-300, 900, 40, 500, 380]],
                    "lake": {"position": [200, -250], "radius": [150, 130], "level": 318, "depth": 18, "lava": True},
                    "river": {"x": -700, "amplitude": 110, "wavelength": 560, "width": 70, "depth": 26, "level": 22, "lava": True}},
        "spots": [("camp", "Ash Camp", -1100, 1050, "camp", "Shared spawn, a safe way from the lava."),
                  ("rim", "Crater Rim", 200, -470, "lookout", "Look down into the lava lake. Don't fall in."),
                  ("springs", "Hot Springs", -250, 700, "checkpoint", "Steam vents and a jump park."),
                  ("obsidian", "Obsidian Temple", 1100, -1050, "ruin", "Black glass ruins on the small cone."),
                  ("works", "Lava Works", 1100, 800, "yard", "A foundry yard with a quick sprint."),
                  ("ember", "Ember Tower", -1050, -950, "tower", "A watchtower over the lava river.")],
        "routes": [("fire-ring", "Ring of Fire", [[-1100, 1050], [-1400, 450], [-1400, -300], [-1150, -1000], [-500, -1350], [200, -1300], [800, -1350], [1300, -950], [1400, -200], [1350, 450], [1100, 800], [500, 1250], [-300, 1300], [-1100, 1050]], True),
                   ("crater-climb", "Crater Climb", spiral(200, -250, 640, 225, math.radians(60), 1.3, 14, start=[-250, 700], end=[200, -470]), False),
                   ("lava-run", "Lava River Run", [[-1050, -950], [-900, -500], [-1050, -100], [-850, 350], [-1100, 1050]], False),
                   ("works-ring", "Foundry Sprint", [[1100, 800], [1300, 650], [1300, 400], [1050, 350], [850, 550], [900, 800], [1100, 800]], True),
                   ("springs-link", "Springs Road", [[-1100, 1050], [-700, 850], [-250, 700], [400, 750], [850, 550]], False),
                   ("temple-road", "Temple Road", [[1350, 450], [1150, 0], [1250, -500], [1100, -1050]], False)],
        "races": [("magma-grand", "Ring of Fire Rally", "fire-ring", "circuit", "medium", 1), ("magma-climb", "King of the Crater", "crater-climb", "hillclimb", "hard", 1),
                  ("magma-downhill", "Lava River Rush", "lava-run", "downhill", "hard", 1), ("magma-works", "Foundry Scramble", "works-ring", "circuit", "easy", 3)],
        "ramps": [("springs-double", -600, 820, 2.1, 90, 18, 7), ("works-table", 950, 600, 0.6, 100, 24, 9)],
        "zones": [("ash-flats", 600, 400, 220, "sand", 0.8, 0.025), ("cinder", -300, -800, 160, "gravel", 0.8, 0.02)],
        "features": {"gaps": [gap("lava-leap", "lava", "springs-link", 0.35, 1, 26), gap("magma-gap", "lava", "fire-ring", 0.05, -1, 30, 3.6),
                              gap("east-lava", "lava", "fire-ring", 0.62, -1, 28), gap("temple-lava", "lava", "temple-road", 0.5, -1, 32, 3.8),
                              gap("north-lava", "lava", "fire-ring", 0.38, -1, 24), gap("cinder-chasm", "chasm", "fire-ring", 0.3, -1, 26)],
                     "pools": [pool("pool-1", "lava", 300, 1000, 45, 30, 0.5), pool("pool-2", "lava", 900, 150, 38, 26, 1.1), pool("pool-3", "lava", -350, -650, 50, 32, 0.2),
                               pool("pool-4", "lava", 700, -800, 40, 28, 2.0), pool("pool-5", "lava", -800, 300, 30, 22, 0.8), pool("pool-6", "lava", 1250, -450, 34, 24),
                               pool("pool-7", "lava", -150, 1150, 28, 20, 1.4), pool("pool-8", "lava", 400, -1100, 36, 26, 0.3)]},
    },
    {
        "id": "emeraldbay", "name": "Emerald Bay", "tagline": "Sun, sand and splashdowns.", "theme": "alpine", "seed": 4242,
        "size": 3200, "baseHeight": 30, "cliff": [280, 480],
        "palette": {"sky": "#bfe6ff", "low": "#6aa34a", "high": "#e8d9a8", "trail": "#e0c98e", "water": "#25c4c4", "accent": "#ffcc33"},
        "look": {"flora": ["broadleaf", "shrub", "rock", "log"],
                 "sky": {"sun": [55, 140], "turbidity": 3, "rayleigh": 1.2, "mie": 0.004, "exposure": 1.25, "fog": 0.2, "fogColor": "#c6ecf4", "sunColor": "#fff4dc"},
                 "grass": [[72, 140, 58], [156, 204, 92]], "dirt": [[200, 176, 124], [244, 226, 176]], "rock": [[118, 112, 100], [206, 198, 178]]},
        "terrain": {"noise": 8, "scale": 230, "hills": [[-950, -950, 260, 600, 560], [950, -900, 210, 560, 600], [1050, 900, 160, 480, 480], [-1100, 600, 90, 460, 460], [0, -1250, 120, 700, 360]],
                    "lake": {"position": [0, 200], "radius": [430, 300], "level": 26, "depth": 22}},
        "spots": [("shack", "Surf Shack", -1100, 1050, "camp", "Shared spawn on the beach."),
                  ("peak", "Parrot Peak", -950, -950, "lookout", "The highest hill on the bay."),
                  ("harbour", "Harbour", 0, 650, "dock", "Boats, a jetty and the bay."),
                  ("ruins", "Coral Ruins", 950, -900, "ruin", "Old walls on the eastern hill."),
                  ("yard", "Banana Yard", 1050, 900, "yard", "Crates, ramps and a sprint."),
                  ("light", "Lighthouse", 0, -1250, "tower", "The lighthouse on the north point.")],
        "routes": [("bay-loop", "Round the Bay", [[-1100, 1050], [-1350, 450], [-1350, -300], [-1100, -1000], [-500, -1300], [0, -1250], [600, -1300], [1100, -1000], [1350, -300], [1300, 450], [1050, 900], [500, 1250], [-300, 1300], [-1100, 1050]], True),
                   ("peak-climb", "Parrot Peak Climb", [[-1100, 1050], [-850, 550], [-1100, 50], [-750, -350], [-1150, -650], [-950, -950]], False),
                   ("ruins-run", "Ruins Descent", [[950, -900], [1250, -500], [900, -100], [1200, 350], [1050, 900]], False),
                   ("yard-ring", "Banana Sprint", [[1050, 900], [1250, 750], [1300, 500], [1050, 400], [850, 600], [850, 850], [1050, 900]], True),
                   ("shore-road", "Shore Road", [[-1100, 1050], [-600, 750], [0, 650], [550, 700], [1050, 900]], False),
                   ("light-road", "Lighthouse Road", [[-1150, -650], [-600, -800], [0, -1250], [600, -850], [950, -900]], False)],
        "races": [("bay-grand", "Round the Bay Rally", "bay-loop", "circuit", "medium", 1), ("bay-climb", "King of Parrot Peak", "peak-climb", "hillclimb", "hard", 1),
                  ("bay-downhill", "Ruins Plunge", "ruins-run", "downhill", "hard", 1), ("bay-yard", "Banana Scramble", "yard-ring", "circuit", "easy", 3)],
        "ramps": [("shack-double", -750, 900, 2.2, 90, 18, 7), ("yard-table", 900, 700, 0.6, 100, 24, 9)],
        "zones": [("beach-sand", -150, 1180, 200, "sand", 0.78, 0.025), ("jungle-mud", 600, -500, 150, "mud", 0.74, 0.02)],
        "features": {"gaps": [gap("lagoon-gap", "water", "shore-road", 0.25, 1, 26), gap("reef-gap", "water", "bay-loop", 0.55, -1, 30, 3.6),
                              gap("creek-leap", "water", "bay-loop", 0.88, -1, 24), gap("light-gap", "water", "light-road", 0.6, -1, 28, 3.4),
                              gap("ruins-chasm", "chasm", "ruins-run", 0.5, 1, 26)],
                     "pools": [pool("rock-pool", "water", 700, -150, 34, 24, 0.7), pool("jungle-pool", "water", -500, -500, 30, 22, 1.2)]},
    },
    {
        # Unrevvd's bike park: a forested mountain with a long climb, a flow trail, a rock garden and a jump garden
        "id": "wildwood", "name": "Wildwood Bike Park", "tagline": "Earn the climb. Send the descent.", "theme": "alpine", "seed": 7717, "bike": True,
        "size": 2400, "baseHeight": 40, "cliff": [240, 420],
        "palette": {"sky": "#cfe3d6", "low": "#4f7a3a", "high": "#c8d6a0", "trail": "#9a7350", "water": "#3f8f95", "accent": "#39d98a"},
        "look": {"flora": ["pine", "broadleaf", "rock", "shrub", "log"],
                 "sky": {"sun": [38, 150], "turbidity": 4, "rayleigh": 1.6, "mie": 0.006, "exposure": 1.25, "fog": 0.28, "fogColor": "#cfe0d4", "sunColor": "#fff1d6"},
                 "grass": [[62, 112, 46], [140, 178, 84]], "dirt": [[120, 86, 58], [184, 146, 104]]},
        "terrain": {"noise": 7, "scale": 220, "hills": [[0, -350, 230, 520, 480], [-750, 650, 40, 420, 380], [800, 650, 60, 420, 380], [-850, -650, 90, 380, 360]],
                    "lake": {"position": [-650, 250], "radius": [170, 120], "level": 46, "depth": 10}},
        "spots": [("trailhead", "Trailhead", -700, 800, "camp", "Shared spawn: bike racks, trail maps and the start of the climb."),
                  ("summit", "Summit Hut", 0, -350, "lookout", "The top of the mountain. Every trail goes down from here."),
                  ("garden", "Jump Garden", 600, 750, "yard", "Dirt jumps and a quick loop."),
                  ("lake", "Wildwood Lake", -650, 470, "dock", "A jetty on the lake at the bottom of the rock garden."),
                  ("mill", "Old Mill", 820, -180, "cabin", "A cabin halfway down the east side."),
                  ("tower", "Fire Tower", -850, -650, "tower", "A fire lookout on the west ridge.")],
        "routes": [("climb", "The Grind", spiral(0, -350, 470, 120, math.radians(120), 1.25, 16, start=[-700, 800], end=[0, -350]), False),
                   ("flow", "Flow Line", [[0, -350], [250, -180], [120, 20], [380, 200], [160, 400], [-150, 520], [-450, 700], [-700, 800]], False),
                   ("rock-garden", "Rock Garden", [[0, -350], [-180, -170], [-330, 20], [-500, 200], [-650, 470]], False),
                   ("valley-loop", "Valley Loop", [[-700, 800], [-1000, 400], [-1000, -200], [-850, -650], [-350, -900], [300, -900], [820, -650], [1000, -180], [1000, 300], [600, 750], [0, 950], [-700, 800]], True),
                   ("east-descent", "Mill Run", [[0, -350], [380, -380], [820, -180], [880, 220], [600, 750]], False),
                   ("jump-loop", "Jump Garden Loop", [[600, 750], [820, 640], [860, 450], [660, 400], [460, 560], [600, 750]], True),
                   ("tower-link", "Ridge Trail", [[-850, -650], [-450, -520], [0, -350]], False)],
        "races": [("wild-flow", "Flow Line", "flow", "downhill", "medium", 1), ("wild-climb", "The Grind", "climb", "hillclimb", "hard", 1),
                  ("wild-rock", "Rock Garden", "rock-garden", "downhill", "hard", 1), ("wild-jumps", "Jump Garden Laps", "jump-loop", "circuit", "easy", 3)],
        "ramps": [("trail-double", -480, 760, 2.0, 40, 12, 2.4), ("garden-table", 760, 560, 0.6, 46, 14, 3)],
        "zones": [("lake-mud", -650, 380, 70, "mud", 0.72, 0.025), ("root-mud", -260, -60, 110, "mud", 0.78, 0.02)],
        "features": {"gaps": [gap("creek-gap", "water", "valley-loop", 0.15, 1, 7, 2.0, 14, bike=True), gap("rock-drop", "chasm", "valley-loop", 0.45, -1, 8, 2.2, 14, bike=True),
                              gap("mill-gap", "water", "valley-loop", 0.7, -1, 8, 2.2, 14, bike=True)],
                     "pools": [pool("bog", "water", 350, 1000, 30, 22, 0.4)]},
    },
    {
        # the Timber Run's own little world (challenge only: not in free ride): a narrow, steep gully packed with solid
        # pines, rocks, stumps and fallen logs, with a few kickers; banks and mountains either side keep you in it
        "id": "timberchute", "name": "Timber Chute", "tagline": "Through the trees. Don't touch them.", "theme": "alpine", "seed": 4411,
        "size": [220, 640], "baseHeight": 40, "cliff": [50, 160], "hidden": True, "buildings": False, "pad": 8, "riderOffset": [0, 0],
        "palette": {"sky": "#c4d6cc", "low": "#3f6a33", "high": "#8fae6a", "trail": "#7a5a3e", "water": "#3f8f95", "accent": "#39d98a"},
        "look": {"flora": [],
                 "sky": {"sun": [44, 160], "turbidity": 4, "rayleigh": 1.6, "mie": 0.006, "exposure": 1.2, "fog": 1.6, "fogColor": "#b9cbbf", "sunColor": "#fff1d6"},
                 "grass": [[52, 92, 40], [112, 146, 70]], "dirt": [[96, 70, 48], [150, 116, 82]]},
        # one long slope down to the south, a gully down the middle of it
        "terrain": {"noise": 3, "scale": 90, "hills": [[0, -330, 170, 620, 620], [0, 0, -16, 34, 5000]]},
        "spots": [("top", "Chute Top", 0, -262, "lookout", "The top of the Timber Chute."),
                  ("bottom", "Chute Bottom", 0, 262, "checkpoint", "The bottom of the Timber Chute.")],
        "gauntlets": [{"id": "timber-run", "from": [0, -258], "to": [0, 250], "width": 64, "fringe": 45, "gap": 5.6, "trees": 1150,
                       "rocks": 70, "stumps": 30, "logs": 18, "jumps": 6, "ferns": 420, "bushes": 1100, "branches": 120}],
        "routes": [], "races": [], "ramps": [], "zones": [], "features": {},
    },
    {
        # the Frozen Run's world: the same kind of gully (a different one) in deep snow, still snowing
        "id": "frostchute", "name": "Frost Chute", "tagline": "Snow on the trees. Ice in your veins.", "theme": "snow", "seed": 5521,
        "size": [220, 640], "baseHeight": 40, "cliff": [50, 160], "hidden": True, "buildings": False, "pad": 8, "riderOffset": [0, 0],
        "palette": {"sky": "#a8bed0", "low": "#b9c8d6", "high": "#ffffff", "trail": "#8d9fae", "water": "#6391aa", "accent": "#8ce5ff"},
        "look": {"flora": [],
                 "sky": {"sun": [16, 200], "turbidity": 3, "rayleigh": 1.4, "mie": 0.005, "exposure": 1.15, "fog": 2.4, "fogColor": "#ccd5e3", "sunColor": "#fff2e6"},
                 "photo": {"snow": ["/models/nature/snow-ground.jpg", "/models/nature/snow-ground-height.jpg", 245]}},
        "terrain": {"noise": 3, "scale": 90, "hills": [[0, -330, 170, 620, 620], [0, 0, -16, 34, 5000]]},
        "spots": [("top", "Chute Top", 0, -262, "lookout", "The top of the Frost Chute."),
                  ("bottom", "Chute Bottom", 0, 262, "checkpoint", "The bottom of the Frost Chute.")],
        "gauntlets": [{"id": "frost-run", "from": [0, -258], "to": [0, 250], "width": 64, "fringe": 45, "gap": 5.6, "trees": 1150,
                       "rocks": 70, "stumps": 30, "logs": 18, "jumps": 6, "bushes": 1100, "branches": 60}],
        "routes": [], "races": [], "ramps": [], "zones": [], "features": {},
    },
    {
        # the Night Run's world: another gully, at night. Black fog, the lamp on your bike and a few lanterns
        "id": "nightchute", "name": "Midnight Chute", "tagline": "Lamp on. Nerves off.", "theme": "alpine", "seed": 6607,
        "size": [220, 640], "baseHeight": 40, "cliff": [50, 160], "hidden": True, "buildings": False, "pad": 8, "riderOffset": [0, 0],
        "palette": {"sky": "#0b1020", "low": "#1d2c22", "high": "#3c5236", "trail": "#3a2c20", "water": "#1d3d44", "accent": "#ffb35c"},
        "look": {"flora": [], "night": True,
                 "sky": {"sun": [40, 150], "exposure": 2.2, "fog": 17, "fogColor": "#05070c", "sunColor": "#8ea6e0", "sunI": 0.22,
                         "hemi": ["#2c3a58", "#0b0d0a", 0.3], "envI": 0},
                 "grass": [[52, 92, 40], [112, 146, 70]], "dirt": [[96, 70, 48], [150, 116, 82]]},
        "terrain": {"noise": 3, "scale": 90, "hills": [[0, -330, 170, 620, 620], [0, 0, -16, 34, 5000]]},
        "spots": [("top", "Chute Top", 0, -262, "lookout", "The top of the Midnight Chute."),
                  ("bottom", "Chute Bottom", 0, 262, "checkpoint", "The bottom of the Midnight Chute.")],
        "gauntlets": [{"id": "night-run", "from": [0, -258], "to": [0, 250], "width": 64, "fringe": 45, "gap": 5.6, "trees": 1100,
                       "rocks": 70, "stumps": 30, "logs": 18, "jumps": 6, "ferns": 420, "bushes": 1100, "branches": 120, "lanterns": 28}],
        "routes": [], "races": [], "ramps": [], "zones": [], "features": {},
    },
    # the Autumn Run's world: golden aspens (and a few pines) dropping their leaves
    {
        "id": "autumnchute", "name": "Autumn Chute", "tagline": "Gold leaves. Hard trunks.", "theme": "alpine", "seed": 5113,
        "size": [220, 640], "baseHeight": 40, "cliff": [50, 160], "hidden": True, "buildings": False, "pad": 8, "riderOffset": [0, 0],
        "palette": {"sky": "#e6c79a", "low": "#8a5a24", "high": "#d9a24a", "trail": "#7a5a3e", "water": "#3f8f95", "accent": "#ff9a3c"},
        "look": {"flora": [], "autumn": True,
                 "sky": {"sun": [32, 220], "turbidity": 6, "rayleigh": 1.8, "mie": 0.008, "exposure": 1.15, "fog": 1.5, "fogColor": "#d8c3a1", "sunColor": "#ffd9a8"},
                 "grass": [[86, 84, 38], [150, 128, 64]], "dirt": [[96, 66, 40], [150, 108, 70]]},
        "terrain": {"noise": 3, "scale": 90, "hills": [[0, -330, 170, 620, 620], [0, 0, -16, 34, 5000]]},
        "spots": [("top", "Chute Top", 0, -262, "lookout", "The top of the Autumn Chute."),
                  ("bottom", "Chute Bottom", 0, 262, "checkpoint", "The bottom of the Autumn Chute.")],
        "gauntlets": [{"id": "autumn-run", "from": [0, -258], "to": [0, 250], "width": 64, "fringe": 45, "gap": 5.6, "trees": 1150,
                       "rocks": 70, "stumps": 30, "logs": 18, "jumps": 6, "aspens": 0.65, "ferns": 320, "bushes": 1100, "branches": 160}],
        "routes": [], "races": [], "ramps": [], "zones": [], "features": {},
    },
    # the Fog Run's world: the fog rolls in and out (a hundred metres one moment, five the next)
    {
        "id": "fogchute", "name": "Fog Chute", "tagline": "Now you see it. Now you don't.", "theme": "alpine", "seed": 6271,
        "size": [220, 640], "baseHeight": 40, "cliff": [50, 160], "hidden": True, "buildings": False, "pad": 8, "riderOffset": [0, 0],
        "palette": {"sky": "#c4cacd", "low": "#3f6a33", "high": "#8fae6a", "trail": "#7a5a3e", "water": "#3f8f95", "accent": "#c9d6dd"},
        "look": {"flora": [], "fogPulse": [2.5, 45, 18],
                 "sky": {"sun": [26, 180], "turbidity": 8, "rayleigh": 1.2, "mie": 0.01, "exposure": 1.0, "fog": 1.0, "fogColor": "#c4cacd", "sunColor": "#f2f0ea"},
                 "grass": [[52, 92, 40], [112, 146, 70]], "dirt": [[96, 70, 48], [150, 116, 82]]},
        "terrain": {"noise": 3, "scale": 90, "hills": [[0, -330, 170, 620, 620], [0, 0, -16, 34, 5000]]},
        "spots": [("top", "Chute Top", 0, -262, "lookout", "The top of the Fog Chute."),
                  ("bottom", "Chute Bottom", 0, 262, "checkpoint", "The bottom of the Fog Chute.")],
        "gauntlets": [{"id": "fog-run", "from": [0, -258], "to": [0, 250], "width": 64, "fringe": 45, "gap": 5.6, "trees": 1150,
                       "rocks": 70, "stumps": 30, "logs": 18, "jumps": 6, "ferns": 420, "bushes": 1100, "branches": 120}],
        "routes": [], "races": [], "ramps": [], "zones": [], "features": {},
    },
    # the Storm Run's world: rain, lightning, and the ground turned to slippery mud
    {
        "id": "stormchute", "name": "Storm Chute", "tagline": "Hold on. It's slippery.", "theme": "alpine", "seed": 7369,
        "size": [220, 640], "baseHeight": 40, "cliff": [50, 160], "hidden": True, "buildings": False, "pad": 8, "riderOffset": [0, 0],
        "palette": {"sky": "#4d565e", "low": "#22381c", "high": "#4e6638", "trail": "#4a3626", "water": "#2c4f55", "accent": "#7fb2ff"},
        "look": {"flora": [], "storm": True, "mud": True,
                 "sky": {"sun": [34, 200], "turbidity": 10, "rayleigh": 3, "mie": 0.02, "exposure": 0.75, "fog": 3.2, "fogColor": "#4d565e", "sunColor": "#a7b0bd", "sunI": 0.9,
                         "hemi": ["#6b7785", "#20251c", 0.55]},
                 "grass": [[34, 56, 28], [78, 98, 52]], "dirt": [[58, 42, 30], [96, 74, 54]]},
        "terrain": {"noise": 3, "scale": 90, "hills": [[0, -330, 170, 620, 620], [0, 0, -16, 34, 5000]]},
        "spots": [("top", "Chute Top", 0, -262, "lookout", "The top of the Storm Chute."),
                  ("bottom", "Chute Bottom", 0, 262, "checkpoint", "The bottom of the Storm Chute.")],
        "gauntlets": [{"id": "storm-run", "from": [0, -258], "to": [0, 250], "width": 64, "fringe": 45, "gap": 5.6, "trees": 1150,
                       "rocks": 70, "stumps": 30, "logs": 18, "jumps": 6, "ferns": 420, "bushes": 1100, "branches": 160}],
        "routes": [], "races": [], "ramps": [], "zones": [], "features": {},
    },
    {
        # Forest Tag's little world (rooms only): a flat wood with a clearing in the middle, trees all round
        "id": "tagwood", "name": "Tag Wood", "tagline": "You're it.", "theme": "alpine", "seed": 8123,
        "size": [240, 240], "baseHeight": 40, "cliff": [40, 60], "hidden": True, "buildings": False, "pad": 10, "riderOffset": [0, 0],
        "palette": {"sky": "#c4d6cc", "low": "#3f6a33", "high": "#8fae6a", "trail": "#7a5a3e", "water": "#3f8f95", "accent": "#ff5fd2"},
        "look": {"flora": [],
                 "sky": {"sun": [44, 160], "turbidity": 4, "rayleigh": 1.6, "mie": 0.006, "exposure": 1.2, "fog": 1.4, "fogColor": "#b9cbbf", "sunColor": "#fff1d6"},
                 "grass": [[52, 92, 40], [112, 146, 70]], "dirt": [[96, 70, 48], [150, 116, 82]]},
        "terrain": {"noise": 2, "scale": 70, "hills": [[0, 0, -5, 120, 120]]},
        "spots": [("clearing", "The Clearing", 0, 0, "checkpoint", "The middle of Tag Wood."),
                  ("north", "North Edge", 0, -96, "lookout", "The north edge of Tag Wood.")],
        "gauntlets": [{"id": "tag-wood", "from": [0, -100], "to": [0, 100], "width": 170, "fringe": 10, "gap": 6.5, "trees": 520,
                       "rocks": 24, "stumps": 18, "logs": 8, "jumps": 3, "ferns": 300, "bushes": 500, "branches": 80}],
        "routes": [], "races": [], "ramps": [], "zones": [], "features": {},
    },
    {
        # a 420 m wall of red rock across the middle: race a friend from the top to the valley floor
        "id": "sheerwall", "name": "Sheerwall Mesa", "tagline": "One way down. Make it quick.", "theme": "desert", "seed": 9137,
        "size": 3600, "baseHeight": 30, "cliff": [300, 520],
        "palette": {"sky": "#e8c7a4", "low": "#a85a3a", "high": "#e9b483", "trail": "#d9a77a", "water": "#3b8e8a", "accent": "#ff6a3c"},
        "look": {"sky": {"sun": [32, 200], "turbidity": 6, "rayleigh": 2.4, "mie": 0.008, "exposure": 1.1, "fog": 0.3, "fogColor": "#e6c3a0"},
                 "rock": [[126, 52, 40], [222, 132, 92]], "dirt": [[168, 98, 64], [228, 166, 120]]},
        "terrain": {"noise": 9, "scale": 260, "hills": [[-1000, -1150, 60, 500, 400], [1000, -1100, 80, 520, 420], [900, 1000, 90, 480, 420], [-1050, 950, 50, 460, 420]],
                    "scarp": SHEERWALL_SCARP},
        "spots": [("camp", "Valley Camp", -1100, 1100, "camp", "Shared spawn at the foot of the cliff."),
                  ("top", "Cliff Top", 0, -380, "lookout", "The edge of the mesa. It's a long way down."),
                  ("eagle", "Eagle Point", -1150, -950, "tower", "A watchtower on the far side of the mesa."),
                  ("river", "Valley Floor", 0, 650, "checkpoint", "Right under the cliff: the finish of the Big Drop."),
                  ("ranch", "Dust Ranch", 1100, 900, "yard", "A ranch yard with a quick sprint."),
                  ("ruins", "Mesa Ruins", 1100, -1050, "ruin", "Old stone walls up on top.")],
        "routes": [("cliff-road", "Cliff Road", [[-1450, -560]] + cliff_road(list(range(-1350, 1351, 150)), -120, 120, SHEERWALL_SCARP) + [[1450, 450]], False),
                   ("mesa-loop", "Mesa Loop", [[-1450, -560], [-1300, -1150], [-700, -1400], [0, -1300], [700, -1400], [1300, -1150], [1400, -560], [700, -700], [0, -650], [-700, -720], [-1450, -560]], True),
                   ("top-link", "Cliff Top Trail", [[0, -650], [0, -380]], False),
                   ("valley-loop", "Valley Loop", [[-1100, 1100], [-1450, 450], [-800, 330], [0, 400], [800, 330], [1450, 450], [1100, 900], [400, 1350], [-400, 1350], [-1100, 1100]], True),
                   ("camp-road", "Camp Road", [[-1100, 1100], [-600, 800], [0, 650], [600, 750], [1100, 900]], False),
                   ("eagle-link", "Eagle Trail", [[-1300, -1150], [-1150, -950]], False)],
        "races": [("sheer-descent", "Cliff Road Descent", "cliff-road", "downhill", "hard", 1), ("sheer-mesa", "Mesa Rally", "mesa-loop", "circuit", "medium", 1),
                  ("sheer-valley", "Valley Loop", "valley-loop", "circuit", "easy", 2), ("sheer-camp", "Camp Road Sprint", "camp-road", "circuit", "easy", 1)],
        "ramps": [("camp-double", -700, 950, 2.2, 90, 18, 7), ("ranch-table", 950, 700, 0.6, 100, 24, 9)],
        "zones": [("valley-dust", 500, 900, 200, "sand", 0.78, 0.025), ("mesa-gravel", -400, -1000, 150, "gravel", 0.8, 0.02)],
        "features": {"gaps": [gap("mesa-chasm", "chasm", "mesa-loop", 0.3, 1, 30, 3.6), gap("valley-chasm", "chasm", "valley-loop", 0.55, -1, 26)],
                     "pools": [pool("ranch-tar", "tar", 700, 1150, 32, 24, 0.4)]},
    },
]


def build(w):
    sx, sz = w["size"] if isinstance(w["size"], list) else (w["size"], w["size"])
    pad, (ox, oz) = w.get("pad", 32), w.get("riderOffset", [-24, -18])
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
        {"id": "jam", "name": f"{by[ids[min(4, len(ids) - 1)]]['name']} trick jam", "position": at(ids[min(4, len(ids) - 1)], -50, -20), "kind": "trick-zone", "radius": 18, "event": "trick.land", "about": "Share a two-minute trick score with friends.", "cooldownSeconds": 10},
        {"id": "camera", "name": f"{by[ids[1]]['name']} photo perch", "position": at(ids[1]), "kind": "photo", "radius": 18, "event": "photo.capture", "about": "Get the whole group into a summit picture.", "cooldownSeconds": 10},
    ]
    quests = [
        {"id": f"{w['id']}-welcome", "name": f"Welcome to {w['name']}", "start": ids[0], "players": [1, 6],
         "steps": [{"event": "zone.enter", "target": ids[min(2, len(ids) - 1)], "count": 1}, {"event": "zone.enter", "target": ids[min(4, len(ids) - 1)], "count": 1}, {"event": "zone.enter", "target": ids[0], "count": 1}],
         "reward": {"type": "cosmetic-token", "amount": 1}, "repeatable": True},
        {"id": f"{w['id']}-summit", "name": "Top of the World", "start": ids[0], "players": [1, 6],
         "steps": [{"event": "zone.enter", "target": ids[1], "count": 1}, {"event": "photo.capture", "target": "camera", "count": 1}],
         "reward": {"type": "cosmetic-token", "amount": 1}, "repeatable": True},
    ]
    return {
        "schemaVersion": 1, "id": w["id"], "name": w["name"], "tagline": w["tagline"], "theme": w["theme"], "seed": w["seed"],
        "size": [sx, sz], "baseHeight": w["baseHeight"], "spawn": first["position"], "spawnHeading": heading,
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
        "safePads": [{"id": s["id"], "position": s["position"], "radius": pad, "riderPosition": [s["position"][0] + ox, s["position"][1] + oz]} for s in spots],
        "features": w.get("features", {}),
        **({"bike": True} if w.get("bike") else {}),
        **({"gauntlets": w["gauntlets"]} if w.get("gauntlets") else {}),
        **({"hidden": True} if w.get("hidden") else {}),
        **({"buildings": False} if w.get("buildings") is False else {}),
    }


# gap jumps and pools for the first three worlds (their files are hand-made, so only "features" is replaced)
EXTRAS = {
    "redrock": {"gaps": [gap("frontier-chasm", "chasm", "frontier-loop", 0.15, 1, 26), gap("mesa-chasm", "chasm", "mesa-run", 0.5, -1, 30, 3.6),
                         gap("wash-gap", "water", "wash-link", 0.5, 1, 24)],
                "pools": [pool("quarry-tar", "tar", 900, 350, 36, 26, 0.5), pool("ruins-tar", "tar", -150, -650, 30, 22, 1.2)]},
    "pinecrest": {"gaps": [gap("creek-gap", "water", "lake-loop", 0.5, -1, 24), gap("timber-gap", "water", "timber-run", 0.5, -1, 28, 3.4),
                           gap("ridge-chasm", "chasm", "summit-climb", 0.35, 1, 26)],
                  "pools": [pool("bog", "water", -1250, -300, 34, 24, 0.4)]},
    "frostpeak": {"gaps": [gap("crevasse-1", "ice", "frost-summit-climb", 0.5, 1, 24), gap("crevasse-2", "ice", "frost-timber-run", 0.1, -1, 28, 3.4),
                           gap("crevasse-3", "ice", "frost-lake-loop", 0.7, -1, 30, 3.6), gap("frost-chasm", "chasm", "frost-ridge-link", 0.5, -1, 26)]},
}


if __name__ == "__main__":
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for w in WORLDS:
        (OUT / f"{w['id']}.json").write_text(json.dumps(build(w), indent=2) + "\n")
        size = w["size"] if isinstance(w["size"], list) else [w["size"], w["size"]]
        entry = {"id": w["id"], "name": w["name"], "file": f"{w['id']}.json", "areaKm2": round(size[0] * size[1] / 1e6, 2), **({"bike": True} if w.get("bike") else {}),
                 **({"hidden": True} if w.get("hidden") else {})}   # (hidden: only a challenge rides it, never free ride)
        manifest["worlds"] = [x for x in manifest["worlds"] if x["id"] != w["id"]] + [entry]
        print("wrote", w["id"])
    for wid, feats in EXTRAS.items():
        f = OUT / f"{wid}.json"
        d = json.loads(f.read_text())
        d["features"] = feats
        f.write_text(json.dumps(d, indent=2) + "\n")
        print("features for", wid)
    # (the world picker shows how many gap jumps and pools each world has)
    for entry in manifest["worlds"]:
        feats = json.loads((OUT / entry["file"]).read_text()).get("features", {})
        entry["gaps"] = len(feats.get("gaps", []))
        entry["pools"] = len(feats.get("pools", []))
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
