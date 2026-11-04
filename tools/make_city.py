"""Make Driftvvd's city world (public/js/games/moto/open-world/city.json) and its manifest entry:  python3 tools/make_city.py

The city itself (streets, blocks, buildings, lights, parked cars) is laid out in the browser from "features.city"
(open-world/city.mjs, cityLayout): this only gives the grid's numbers, the plaza and the roundabouts. The rest of the
world file is make_worlds.py's, so it rides like every other world."""
import json
from pathlib import Path

from make_worlds import OUT, build

PITCH = 120   # metres between one street and the next

CITY = {
    "id": "city", "name": "Downtown", "tagline": "A city to drift: blocks, boulevards, roundabouts and a huge car park.", "theme": "alpine", "seed": 7311,
    "hidden": True,   # (only Driftvvd drives it: its buildings are boxes, solid to the drift car)
    "size": 1440, "baseHeight": 10, "cliff": [120, 260], "rise": 0.6, "buildings": False,
    "palette": {"sky": "#b9cde0", "low": "#7d8086", "high": "#9a9ca0", "trail": "#5a5d62", "water": "#3f8f95", "accent": "#ffcc33"},
    "look": {"flora": [], "paved": True, "city": True,
             "sky": {"sun": [38, 125], "turbidity": 3.5, "rayleigh": 1.4, "mie": 0.006, "exposure": 1.25, "fog": 0.35, "fogColor": "#c4cfdb", "sunColor": "#fff1d8"},
             "grass": [[120, 122, 124], [150, 151, 152]], "dirt": [[108, 108, 110], [140, 140, 142]]},
    "terrain": {"noise": 0, "scale": 220, "crags": False, "hills": []},
    # (id, name, x, z, kind, about): the first is where you start
    "spots": [("carpark", "The Car Park", 240, 240, "camp", "A huge open car park: the place to practise your drifts."),
              ("downtown", "Downtown", 0, 0, "lookout", "Where the two boulevards cross, under the towers."),
              ("west-round", "West Roundabout", -240, -240, "checkpoint", "Round and round: hold the drift all the way."),
              ("east-round", "East Roundabout", 240, -240, "checkpoint", "The other roundabout."),
              ("old-town", "Old Town", -300, 300, "checkpoint", "Narrow blocks and tight corners.")],
    "riderOffset": [0, -30],
    "routes": [], "races": [], "ramps": [], "zones": [],
    "features": {"city": {"pitch": PITCH, "lines": 4, "road": 22, "boulevard": 34, "boulevards": [0], "sidewalk": 4, "extent": 600,
                          "plaza": [120, 120, 360, 360], "roundabouts": [[-240, -240, 10], [240, -240, 10]], "seed": 7311}},
}

if __name__ == "__main__":
    w = build(CITY)
    w["spawnHeading"] = 0.0   # (facing up the car park)
    for p in w["spawnPads"]:
        p["heading"] = 0.0
    (OUT / "city.json").write_text(json.dumps(w, indent=2) + "\n")
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    entry = {"id": "city", "name": CITY["name"], "file": "city.json", "areaKm2": round(CITY["size"] ** 2 / 1e6, 2), "hidden": True, "gaps": 0, "pools": 0}
    manifest["worlds"] = [x for x in manifest["worlds"] if x["id"] != "city"] + [entry]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print("wrote city")
