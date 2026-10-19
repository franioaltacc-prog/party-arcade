# Motocross worlds: v3.3.0 handoff

The three worlds are now rideable in **Motocross → Free ride**. `/games/moto-worlds` remains the inspection tool. Read the adjacent README for authoring details.

## Implemented

- `MotoCore.groundTrack(terrain,spawn)` wraps the world heightfield. Free bikes use world-space samples in `slice`, normal-based landing prediction and safe-pad resets. They bypass corridor fences, track berms, wrong-way checks and track-based checkpoints/finish. Original race progression and online messages are unchanged.
- World positions are `[x,z]`, metres, +Y up. Pack heading 0 is +Z; core heading 0 is +X. **Only headings** convert: `bike.h=Math.PI/2-mapHeading`.
- `game.js` / `menus.js` provide the world picker, existing camera/HUD, keyboard/touch/gamepad controls, R reset and mini-race chooser. Free riding has no timer. The chooser pauses riding. Direct URL: `/games/moto?free=1&world=frostpeak` (also redrock / pinecrest).
- `trials.mjs` resamples each authored race with `ground.gatesFor(race.id)` — pass the **race ID**, despite each race referencing a route. Swept gate-plane checks enforce forward direction, radius and vertical proximity. Gate zero starts the clock; all subsequent gates/laps are required. Crashing/resetting cancels an attempt. Completion returns to free riding. Local records use `moto_world_best_v1_<world>_<race>`; no open-world times enter server leaderboards.
- `ride-world.mjs` supplies the scene contract for existing game rendering. A 144 m moving mesh at 1 m spacing replaces coarse ground near the bike. Its outer 8 m strip matches coarse triangles. `materials.mjs` exposes a hole uniform on the coarse material; near/far layers share textures but have separate materials. Preserve `color` and `trailWeight` attributes and the shared sampler in future LOD changes.
- Spawns sit clear of buildings and face trails. `safePads[].position` is the centre of a flat meeting area; `riderPosition` is the clear reset position inside it. `nearestSafePad` returns the latter as `position`, with the nearest trail heading. Don't flatten terrain around riderPosition a second time.
- The cliff ring is included in the collision sampler. The 1.6 km apron is scenery outside playable bounds. Free-riding out of bounds triggers a safe reset; the apron does not enlarge the world. Cliff-face scenery scattering is suppressed to avoid floating trees/rocks.
- Handling tuning in `MotoCore.P`: clutch launch engagement, throttle response, shorter gear changes, drag, suspension damping and balanced braking. Camera response/FOV, subtle shake, progressive gamepad dead zones and engine load response are also tunable there. Physics remains fixed at 1/120 s with eight substeps. Gravity and air-control behavior remain grounded.

## Remaining work

1. **Quests.** JSON steps remain content definitions. Acceptance, progress, delivery cargo, relay deadlines/distinct players, photo presence and cosmetic rewards are not hooked up. Do not award rewards merely from marker presence.
2. **Online free ride.** Solo free ride is implemented. Rooms, authoritative world IDs, rider replication, party quest state and concurrent mini races need a separate protocol extension. Preserve existing online race validation.
3. **Scenery collision.** Buildings, trees, rocks, decks and poles are visual scenery. Heightfield ramps and cliffs are rideable/collidable terrain; props are not physical obstacles yet. Add coarse collision proxies intentionally rather than one collider per rendered branch.
4. **Water behavior.** Frostpeak's frozen central basin has a real ice-height ground surface. Other lakes/river are rendered water over a lower terrain bed; swimming/drowning/reset rules are not implemented. Authored race routes avoid submerged crossings.
5. **Balance/performance.** All routes need longer human playtests, jump-speed tuning and low-end phone profiling. The inspector defaults to 512 subdivisions; riding uses quality-dependent coarse terrain plus its local patch. Texture projection assumes consistent world transforms. Raise record-key version if a course changes significantly.

## Verification

- `jsc tests/mototest.js`: bike behavior, adapter on a hill, safe pad/bounds resets, swept gate ordering/laps, 30/144 fps consistency, every original track and checkpoint with zero robot crashes. Reference times: Desert 50.16 s, Forest 53.05 s, Snow 51.20 s.
- `node tests/motoworldtest.mjs`: 33 map/terrain checks, including actual short bike rides and resets in all three world files.
- `python3 tests/run_all.py`: full server/bot/game suite, including online Motocross.
- Browser checks use normal menu controls and keyboard input, not the localhost debug helpers.

No new packages, npm or build step. three.js remains pinned to r170 via the existing import map. No credentials or output media belong in release commits.
