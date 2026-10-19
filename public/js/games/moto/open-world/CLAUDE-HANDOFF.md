# Handoff to Claude: integrate the Motocross worlds

## User intent

The user asked for BIG open-world maps with high hills, mini races, quests and activities with friends, saved into the project so they can develop the mechanics with Claude. This pack supplies the landscapes, authored content, shared height/surface APIs and a working inspection preview. It does not replace the existing race game, modify accounts or deploy anything.

## What is already built

Open `/games/moto-worlds.html` locally first. Switch between Redrock Frontier, Pinecrest Highlands and Frostpeak Expedition; use Explore, Races, Quests and the route tour. No bike mechanics are being simulated in that preview.

- Redrock: 12.96 km², high desert summits, a river canyon crossed by raised dirt trails, quarry activity yard and basecamp. Grand Tour, Copper Crown hillclimb, Eagle Dive downhill, Quarry Scramble circuit.
- Pinecrest: 10.24 km², roughly 500 m of elevation variation, alpine lake, forest pass, observatory summit and ridge cabin. Endurance loop, Cloudbreak hillclimb, Lakeside Dash, Timberline downhill.
- Each has six quests including exploration, delivery, co-op relay, group photo, trick session and race passport. Locations and ordered steps are authored in JSON.
- Every destination is accessible from the trail network. Six spawn positions per world. Flatter safe zones, water-aware trail grades, two sculpted tabletop jump areas per map.

## Integration API

```js
import {buildOpenWorld} from './open-world/world.mjs';
import {buildTerrain, routeLength, routePoint} from './open-world/terrain.mjs';

const definition = await fetch('/js/games/moto/open-world/redrock.json').then(r => r.json());
const built = buildOpenWorld(definition, {resolution: 512, scenery: 2400});
scene.add(built.group);
const ground = built.terrain; // Or buildTerrain(definition) without THREE/DOM.
const y = ground.heightAt(x, z);
const normal = ground.normalAt(x, z); // {x,y,z}, normalized
const surface = ground.surfaceAt(x, z); // {kind,grip,roll}
const safe = ground.nearestSafePad(x, z); // {id,position,radius,height}
const valid = ground.inBounds(x, z, definition.boundary.softMargin);
const gates = ground.gatesFor('red-climb'); // ordered {index,x,y,z,heading,radius}
// Later: scene.remove(built.group); built.dispose();
```

`buildOpenWorld` returns `{group, terrain, routes, minHeight, maxHeight, dispose}`. `routes` is the visual guide-line group; set `visible=false` for gameplay. The heightfield includes the ramps; don't add a second ramp collider on top. Terrain isn't tied to a race or checkpoint progression. Positions don't change if you switch quest/race selection.

### Important coordinate difference

Pack coordinates: `position=[x,z]`; +Y up; heading 0 points +Z, positive turns towards +X. Current `MotoCore` uses heading 0 along +X (`px + cos(h)*d`, `pz + sin(h)*d`). To use a map heading in that core:

```js
bike.h = Math.PI / 2 - mapHeading;
```

Don't apply this conversion to x/z, normals or positions. `routePoint(route, distance)` returns this pack's heading convention. Race gates' headings are their forward normals, not visual arch yaw for the core.

### Bike ground adapter is required

The current `public/js/games/moto/core.js` is still a corridor-racing engine: `slice()` samples a track via `locate()`, steering consults `bermAt()`, `step()` enforces `P.FENCE=11.5`, and checkpoint/finish detection uses distance along one course. **Do not just increase the fence limit or feed these JSON files into `MotoCore.build()`**; they use a different schema.

Create a world mode / adapter that samples `heightAt(px + cos(h)*d, pz + sin(h)*d)` for the wheel slice. Preserve the existing suspension, tyres, rider and air controls, but replace the `locate`-based ground/surface sampling, track fence, track progress and finish behavior in that mode. Use sampled ground normals to drive bank/steering support. Existing races must continue using their original path.

The renderer overview samples every ~6–8 m. It is fine for inspection but can smooth narrow jump lips compared with the authoritative sampler. For riding, add high-resolution chunks around players (roughly 1–2 m near wheels) with distance LOD and stitch edges. Call the same sampler everywhere. The map is a single-valued heightfield: there are no caves, tunnels, bridges or multi-level collision decks.

## Gameplay hooks to implement

1. **Free roam.** Shared room `worldId`, synchronized rider poses and spawn/safe pad resets. Keep world bounds separate from race limits. Implement water behavior and slow warning/respawn near the outer edge. `boundary.policy` is only a policy hint.
2. **Mini races.** Board interaction offers four races without closing the world. Start near the route's first gate; use ready-up/countdown. `gatesFor()` resamples the route at <=110 m spacing. Pass gates in order, in the forward direction, with a swept position check so high speed doesn't skip gates. Closed races finish at their repeated first point. Respect laps. Free-roam riders can continue exploring while other riders race.
3. **Quests.** State should be authoritative, per rider or party as appropriate: `offered → active → step index → complete`. Feed semantic events `{event,target,playerId,serverTime,...}` into the ordered step definitions. Record acceptance before progress; don't hand out rewards just for opening the preview. In co-op relays, distinct player IDs are required and the deadline starts on the first switch activation. Delivery resets should clear carried cargo. Suggested token rewards need a real progression decision.
4. **Social activities.** Proximity prompts at each interaction. Trick zones count clean landings inside radius, group photo zones need an actual capture/presence mechanic, switches and beacons need feedback. Radius and cooldown values are content suggestions. Content includes race boards, relay masts, partner switches, pickup crates, delivery stations, photo perches and trick zones.
5. **Collision.** Terrain collision is provided by the sampler. Trees, rocks, buildings, arches, decks and poles are **visual-only scenery** right now; choose suitable collision proxies or explicitly non-solid scenery before riding. Props are excluded from trails/safe pads where possible. Decks are not rideable surfaces yet. Avoid building a collider for each rendered tree on every frame.
6. **Balance.** Ride every course and tune width, corner points, ramp profile and grip. `medalSeconds=null` intentionally: no invented medal/anti-cheat time is connected to existing Motocross records. The old robot times and score validators do not apply to these worlds. Scope leaderboard keys by world + race version, and validate server-side movement, gate order and progress before awarding race records.

### Event target references

- `zone.enter` targets `spots` (and the standalone discovery beacon interaction where used).
- `race.finish` targets `races`.
- Other events target `interactions`: `supply.collect`, `supply.deliver`, `relay.activate`, `photo.capture`, `trick.land`.
- A step's `count` is required occurrences. `minimumAirSeconds` applies to each clean trick landing.
- `failOnReset=true` invalidates that delivery attempt. `distinctPlayers=true` compares the second relay activation to the first.

## Verification and remaining work

Run `node tests/motoworldtest.mjs`. The 30 checks validate references, connectivity, bounds, terrain, surface normals, dry trail crossings, safe pads, trail grades and race gate positions. Browser preview verified all three worlds, quest/race panels, map switching and route touring. No integration tests can validate finished riding or quests yet because those systems are not connected.

Files added only: `public/js/games/moto/open-world/`, `public/games/moto-worlds.html`, `tests/motoworldtest.mjs`. No changes to existing bike mechanics, menus, room protocol, accounts, game version or deployment. Keep this scope clear when continuing with the user.

Suggested next prompt: “Read public/js/games/moto/open-world/CLAUDE-HANDOFF.md, inspect all three worlds in the preview, then add a Motocross Free Roam mode using these terrain and activity definitions. Start by adapting the existing bike ground sampling and world camera; preserve the existing races. Then connect multiplayer rooms, mini-race gates and quests. Test rideability and balance with the actual bike before publishing.”

## Follow-up: Frostpeak, cliff borders and terrain materials

The user requested a separate snow world, high cliff borders to conceal the void and better textures. Added `frostpeak.json` (16 km²) with its own connected eight-trail layout, four mini races, six quests, frozen basin and snow-covered landscape. It is listed in `manifest.json` and selectable in the same preview.

All world JSONs now have `boundary.cliffWidth=95`, `cliffHeight` of 680 or 820 m and `sceneryApron=1600`. `terrain.cliffRise(x,z)` is added by `heightAt` at the outer edge; it remains in the collision sampler. The 1.6 km scenery apron begins at the same boundary heights and uses the same perimeter resolution as the ground. **Keep the bounds check**: the tall cliffs are a natural obstacle, but there is no server hard-stop or anti-teleport rule in this pack yet. The apron is outside playable bounds. Elevation stats include the cliff ring.

`materials.mjs` creates dirt, grass, rock and snow albedo/relief atlases at 1024², with multi-scale triplanar projection and derivative bump lighting via `MeshStandardMaterial.onBeforeCompile`. The terrain geometry supplies `color` and `trailWeight` attributes. Preserve these attributes in future chunks/LOD. Material projection uses world metres; keeping a consistent world transform is essential. Build/dispose materials once per world rather than per terrain chunk. Atlas textures are generated locally; no texture asset downloads. Three.js remains pinned to r170.

Frostpeak's lake is tagged `frozen: true`: the central heightfield is raised to the ice surface. It is no longer a deep water collision bed. Surface zones still need physics integration. Default renderer resolution is 512, adding roughly 524k terrain triangles plus the apron. The inspector uses logarithmic depth to preserve precision around large cliffs and the thin ice plane. Reassess mobile performance with the actual bike mode.

Tests now total 30 checks across three worlds, including perimeter cliff heights, the apron sampler, frozen lake collision height and route grades. The existing free-roam integration limitations still apply.
