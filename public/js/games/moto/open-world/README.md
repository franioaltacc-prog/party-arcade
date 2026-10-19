# Motocross open-world map pack

Built for Party Arcade, 19 October 2026. Start with `CLAUDE-HANDOFF.md` when connecting the mechanics.

Three actual procedural 3D landscapes, with authored trail networks, sculpted hills, flatter trail beds, safe meeting pads, tabletop jumps, scenery and destination buildings. **v3.3.1: these worlds are rideable, with six gears and rechargeable turbo** from the Free ride menu in `/games/moto`. `/games/moto-worlds` remains an inspection preview. Free ride uses the existing bike and camera; the flag button starts mini races, and R returns to a safe pad. Online free ride and quests are not implemented yet.

| World | Size | Elevation range (approx.) | Character |
| --- | --- | --- | --- |
| Redrock Frontier | 3.6 × 3.6 km / 12.96 km² | 880 m including cliffs | Desert hills, canyon river, quarry, high mesa, survey camp |
| Pinecrest Highlands | 3.2 × 3.2 km / 10.24 km² | 1,030 m including cliffs | Mountain switchbacks, lake circuit, timber mill, summit observatory, ridge cabin |
| Frostpeak Expedition | 4 × 4 km / 16 km² | 1,100 m including cliffs | Snowy mountain expedition, frozen basin, rescue cabin and snowcat depot |

Each world has **4 race definitions, 6 quest definitions, 8 interaction locations, 6 destinations, 6 rider spawn pads and 2 terrain-built jump features**. There are 7 connected trails in Redrock and 8 each in Pinecrest and Frostpeak. Mini-race timing, ordered gates and local best times are implemented. Quest/event state, rewards and multiplayer free ride remain future work.

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
- `terrain.mjs`: deterministic, DOM-free ground sampler, surfaces, route helpers and gates. Used by the bike ground adapter and both renderers.
- `ride-world.mjs`: riding scene, particles, soft contact shadow and the cached, budgeted moving ground patch.
- `render-policy.mjs`: quality-dependent far terrain, scenery and near-detail update budgets.
- `trials.mjs`: fixed-step gate crossings, laps and mini-race timing.
- `materials.mjs`: four seamless 1024² procedural texture atlases, multi-scale triplanar projection, derivative bump relief and slope/altitude material blending.
- `world.mjs`: three.js terrain, instanced scenery and landmark builder. Uses the same height sampler as above.
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

The 34 checks cover all three worlds' scale, deterministic finite heights, normals, high terrain, bounds, connected trails, destination access, dry authored water crossings, safe pads, trail grades, quest references race gates, and the continuous cliff perimeter. They include a short bike ride and safe reset on each actual map. They do not exhaustively prove every jump, multiplayer behavior or performance on low-end phones. The default inspection mesh has ~524,000 triangles plus the mountain apron. Riding uses 96/128/192 far subdivisions, frustum-cullable terrain/scenery chunks and a detailed patch within 48–64 m of the bike. Patch updates are budgeted and cached; far shading and contact shadows reduce GPU load. Add `&perf=1` to the ride URL for visible performance diagnostics.

Free-ride tuning lives in `MotoCore.P.FREE_*`: six gears, ~314 km/h on a long flat trail, ~344 km/h with turbo, stronger braking and upright landing impact absorption. Space/Shift/gamepad A uses turbo; release to recharge. Actual speed varies with terrain and run-up. Mini-race best keys are now `moto_world_best_v2_<world>_<race>`; older records remain stored separately. Normal race tuning is unchanged.

## Cliff borders and materials (visual upgrade)

All maps now rise into a continuous ring of high cliffs over the outermost 95 metres. The cliff rise is included in `heightAt()`, not just scenery, so the bike adapter samples the same barrier it sees. Its top varies naturally; the minimum cliff rise at the edge exceeds 80% of the configured 680 m / 820 m height. A matching mountain apron continues 1.6 km outside the playable boundary to hide the terrain cut-off from normal ground-level views. The apron is scenery outside the playable area; it does not expand the world bounds. Flying the inspection camera beyond the apron can still reveal its far edge.

`boundary.cliffWidth`, `cliffHeight` and `sceneryApron` control this. Trails remain inside the cliff toe. Elevation-range labels include the border cliffs. Apron inner-edge resolution matches the ground mesh to prevent cracks.

The ground now uses generated albedo/height textures for dirt, grass, fractured rock and snow, blended by trail coverage, slope and altitude. Two rotated tile scales reduce repetition, larger-scale variation breaks up uniform colours, anisotropic mip filtering improves grazing angles and derivative bump relief adds close-up lighting detail. Triplanar sampling projects textures onto cliff sides without stretching. They are procedural textures, not downloaded photographic scans. Ground geometry has increased from 320 to 512 subdivisions per side. Scenery uses layered pine crowns and branched cacti instead of single-cone placeholders.

Frostpeak is snow-covered throughout, with an ice basin. The frozen lake's central collision height is the ice level rather than the underwater lake bed. Mini races are rideable; quests and multiplayer free ride remain definitions awaiting integration.
