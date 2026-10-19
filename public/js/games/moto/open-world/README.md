# Motocross open-world map pack

Built for Party Arcade, 19 October 2026. Start with `CLAUDE-HANDOFF.md` when connecting the mechanics.

Three procedural 3D landscapes, with authored trail networks, sculpted hills, flatter trail beds, safe meeting pads, landforms, jump parks, scenery and destination buildings. **v3.4.0: these worlds are rideable** from the Free ride menu in `/games/moto`. `/games/moto-worlds` remains an inspection preview. Free ride uses the existing bike and camera; the flag button starts mini races, and R returns to a safe pad. Online free ride and quests are not implemented yet.

| World | Size | Elevation range (approx.) | Character |
| --- | --- | --- | --- |
| Redrock Frontier | 3.6 × 3.6 km / 12.96 km² | ~380 m inside the edge | Red sandstone mesas, dune fields, canyon river, quarry, survey camp |
| Pinecrest Highlands | 3.2 × 3.2 km / 10.24 km² | ~520 m inside the edge | Pine forests, rocky crags, lake circuit, timber yard, lookout tower, ridge cabin |
| Frostpeak Expedition | 4 × 4 km / 16 km² | ~760 m inside the edge | Snowy forests, alpine crags, powder moguls, frozen basin, cabin and timber depot |

Each world has **4 race definitions, 6 quest definitions, 8 interaction locations, 6 destinations, 6 rider spawn pads and 2 authored jumps**, plus generated jump parks and trail tabletops. There are 7 connected trails in Redrock and 8 each in Pinecrest and Frostpeak. Mini-race timing, ordered gates and local best times are implemented. Quest/event state, rewards and multiplayer free ride remain future work.

## See the maps

With the normal app running, visit `/games/moto-worlds.html`. Alternatively, from the project root:

```sh
python3 -m http.server 18019 --bind 127.0.0.1 --directory public
```

Then open `http://localhost:18019/games/moto-worlds.html`. A local HTTP server is needed for modules and JSON fetches. The preview uses the same pinned three.js CDN version as Motocross, so it needs internet for three.js. No new packages or build step.

- Choose the world at the top right.
- Explore selects destinations and moves the camera there.
- Races shows the mini-race layouts; “Preview this route” follows the selected trail.
- Quests shows the authored steps and co-op requirements.
- Drag / scroll to orbit / zoom. WASD moves the inspection camera; Q/E down/up; Shift faster. These are **camera controls, not bike physics**.
- Ground view brings the camera down close to the terrain textures.
- Click the overview map to inspect a location. Trail lines can be hidden.

## Files

- `manifest.json`: map catalogue.
- `redrock.json`, `pinecrest.json`, `frostpeak.json`: editable map, race, quest and activity content.
- `terrain.mjs`: deterministic, DOM-free ground sampler, surfaces, route helpers and gates; generated jumps, landforms, edge mountains, building/arch placement and solid obstacles. Used by the bike ground adapter and both renderers.
- `buildings.mjs`: the buildings (cabin, lookout tower, basecamp, quarry/timber yard, ruins, jetty, lookout deck, checkpoint booth), signs, arches, stakes, hay and flags, each merged into one coloured geometry.
- `ride-world.mjs`: riding scene: sky, sun shadows, fog, clouds, particles, the cached, budgeted moving ground patch and the grass and pebbles on it.
- `grounding.mjs`: exact rendered triangle heights for scenery anchors; the collision heightfield remains separate.
- `render-policy.mjs`: quality-dependent far terrain, scenery and near-detail update budgets.
- `trials.mjs`: fixed-step gate crossings, laps and mini-race timing.
- `materials.mjs`: four seamless 1024² procedural texture atlases, multi-scale triplanar projection, derivative bump relief and slope/altitude material blending.
- `world.mjs`: three.js terrain, water, instanced scenery (near and far detail; call `update(cameraPosition)` each frame) and landmark builder. Uses the same height sampler as above.
- `preview.mjs`: inspection UI and camera tour, used by `public/games/moto-worlds.html`.
- `CLAUDE-HANDOFF.md`: exact integration boundaries, APIs, coordinate conversion and suggested next work.
- `tests/motoworldtest.mjs` at the project root: map consistency and terrain checks.

All distances are metres. No downloaded models, textures or audio. Decorative models and terrain are generated from source; everything can be edited in the repo.

## Editing content

Positions are `[x, z]`, centred on the world. Height is generated, not stored in each marker. Do not put `y` into those pairs. Headings in this pack point along +Z at 0 radians and turn towards +X as they increase.

`terrain.hills` entries are `[x, z, height, radiusX, radiusZ]`; hills add together. `noise` controls small unevenness, not mountain height. Routes are polylines in world coordinates; `width` is the full trail width, `shoulder` is extra terrain blending on each side. Trail centres follow the natural terrain; cross-trail slopes are flattened towards the nearest point on the centreline, with continuous blends at intersections. Closed routes repeat their first point at the end. Add intermediate points to shape corners and climbs. Keep nearby trails on similar elevations; no bridges or overhangs are represented by a heightfield.

Safe pads flatten the meeting destinations. The river/lake crossings on authored trails are raised earthen crossings, **not bridges**. Water remains a render surface; the mechanics must decide how riders behave if they leave the trail and enter it. Ramps are continuous ground profiles, including their landing slopes.

Quests refer to existing IDs in `spots`, `interactions` or `races`. A quest's start is a spot ID. `withinSeconds`, `distinctPlayers`, `failOnReset` and `minimumAirSeconds` describe the intended rules; no current module enforces them. Rewards are suggested cosmetic tokens, not hooked into the site's progression system.

## Checks

```sh
node tests/motoworldtest.mjs
```

The 44 checks cover all three worlds' scale, deterministic finite heights, normals, high terrain, bounds, connected trails, destination access, dry authored water crossings, safe pads, trail grades, quest references, race gates, the edge mountains, the jump parks, landforms staying off trails and solid buildings. They include a short bike ride and safe reset on each actual map. They do not exhaustively prove every jump, multiplayer behavior or performance on low-end phones. The default inspection mesh has ~524,000 triangles plus the mountain apron. Riding uses 96/128/192 far subdivisions, frustum-cullable terrain/scenery chunks and a detailed patch within 48–64 m of the bike. Patch updates are budgeted and cached; far shading and contact shadows reduce GPU load. Add `&perf=1` to the ride URL for visible performance diagnostics.

Free-ride tuning lives in `MotoCore.P.FREE_*`: six gears, ~314 km/h on a long flat trail, ~344 km/h with turbo, stronger braking and upright landing impact absorption. Space/Shift/gamepad A uses turbo; release to recharge. Actual speed varies with terrain and run-up. Mini-race best keys are now `moto_world_best_v2_<world>_<race>`; older records remain stored separately. Turning no longer applies a sliding speed penalty in free ride. Normal race tuning is unchanged.

## How the worlds are built (v3.4.0)

`heightAt()` adds, in order: the authored hills, lake and river; trails, safe pads and jumps; theme landforms (Redrock: mesas and dune fields; Pinecrest: rolling hills and rocky crags; Frostpeak: ridges, crags and powder moguls) scaled by a 10 m "wild" mask that is 0 near trails, pads, buildings, jumps and water; then the edge mountains. Inside the edge, `boundary.cliffWidth` metres of foothills rise to roughly 20–40% of `cliffHeight`; the real peaks rise beyond the edge, where the 1.6 km apron shows them. Trails that run near the edge go up valleys between the peaks. Everything is part of `heightAt()`, so the bike rides exactly what is drawn.

Jumps: the authored `ramps`, a tabletop every ~320 m on the straight, flat parts of every trail (2.6–4 m high), and a five-jump "send-it park" (3–10 m tabletops) beside the first spawn pad and one more pad, placed clear of trails, water and buildings. `terrain.parks` and `terrain.ramps` list them; ramps count as trail surface.

Scenery uses the race tracks' models (`makeProps` in `../world.js`, detail 1 near and 0 far), scattered with clustering so forests form groves. Near copies are in 250 m chunks; far copies in 1 km blocks, with each chunk's far copies shrunk to nothing while its near copies show. Copies inside the moving ground patch are re-seated on it when it moves. Grass and pebbles are scattered on the patch itself. Buildings and arches are placed by `terrain.mjs` (clear of trails, ramps and reset spots); cabins, the tower, decks and arch posts are solid (`terrain.obstacleAt`). Trees and rocks are not.

## Materials

The ground uses generated albedo/height textures for dirt, grass, fractured rock and snow, blended by trail coverage, slope and altitude, with triplanar projection on steep faces (no downloaded scans). Redrock's rock and dirt are red sandstone with layered bands on the cliffs; Pinecrest's peaks get snow above ~250–450 m; Frostpeak is snow with blue-grey granite and an ice basin (the frozen lake's collision height is the ice). Trails and jumps are drawn in packed, darker dirt (or packed snow). Mountain faces get broad light and dark patches so they don't read as flat walls.
