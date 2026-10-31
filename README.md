# 🕹️ Party Arcade

A website full of games to play with your friends. No installs needed, only Python 3.

## Run it
```bash
python3 server.py
```
Open http://localhost:8000. Friends on the same Wi-Fi use the "Friends on Wi-Fi" address the server prints.
There's nothing to install: the server uses only Python's standard library (3.9+).

## Put it online (play with friends anywhere)
**Render (free):** upload this folder to a GitHub repo, then on render.com: New → Web Service → connect the repo and set
- Language: Python 3 · Branch: main · Root Directory: *(leave empty)*
- Build command: `pip install -r requirements.txt` · Start command: `python3 server.py` · Instance type: Free

Render sets `PORT` for you and gives you a public `https://….onrender.com` link (WebSockets work over `wss://`).
On the free plan the site sleeps after 15 minutes with no visitors and takes about a minute to wake up.
Game state lives in memory. On a redeploy the server saves each open room's code and host to the database, and players are put back into the same room automatically (a round in progress starts over from the room's lobby). To keep accounts, see the Turso steps below.
To update the site, upload the changed files to GitHub — Render redeploys automatically.

## Accounts, stats and leaderboards
Players can **sign up / log in** (username + password, no email) or **play as a guest**. Logged-in players get:
XP and levels, saved stats for every online game (saved when a game finishes), match history, achievements,
a public profile (`/profile?u=Name`), **leaderboards** (`/leaderboards`), and anyone can search for players at `/players`. Solo high scores (Snake, 2048,
Memory Flip on Normal, Dash practice) are saved too. Passwords are hashed with scrypt; only a hash of each login token is stored.
Wins only count when at least 2 people played.

**Where accounts are saved.** By default in `data/arcade.db` (a SQLite file). That's perfect on your own computer,
but **Render's free plan wipes files on every restart/redeploy**, so online you need a free database:
1. Make a free account at [turso.tech](https://turso.tech) (you can sign in with GitHub) and create a database.
2. Copy its **URL** (`libsql://…turso.io`) and create a **token** for it.
3. On Render → your service → **Environment**, add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, then save (Render redeploys).
4. Check `https://<your-site>/api/health` — it should say `"storage": "turso", "accounts": true`.

**Admin.** Add an environment variable `ADMIN_CODE` (a secret phrase, 8+ characters — never put it in the code or on GitHub).
Then log in with your normal account, open `/admin` and type the code once: your account becomes an admin.
Admins get the admin panel (online players, live rooms with kick/close, announcements, account search with
ban/unban, reset password, give XP, set stats, reset stats, make admin, delete, the Neon Dash level queue) and a 🛡️ cheat button in every
online game (casino coins, Family Life money/stats/time skip, Neon Dash god mode, Doodle word peek, Blitz points…).
A game where an admin used a cheat doesn't count for anyone's stats or leaderboards.

**Roles: testers and developers.** In `/admin`, a player's Actions → 🎭 Set role picks Player, Tester, Developer
or Admin (the `roles` table; admins are still `users.admin`). Testers and developers get **no** admin panel, cheats or
XP/stat tools, and no name tag: only admins show one (🛡️). Other players never see someone's role (it's only in your
own account data and in the admin panel). Both roles get the **update calendar** at `/calendar` (in the account menu):
- **Developers** (and admins) see every row and add, change, drag to another day and delete updates, in a month
  calendar, an ideas shelf (no date yet) or a spreadsheet view. Ticking 🧪 *Testers* on an update shares it with testers.
- **Testers** see only the shared rows, read-only: a sneak peek at what's coming.

The server checks the role on every request (`planner.py`, `plans` table, at most 500 rows), and open calendars reload
live when anything changes.

The calendar page is also the **team's home**: everyone with a role reads the 📣 **announcements** at the top and talks
in the 💬 **Team chat** tab (unread badge, the last 300 messages are kept, 8 messages per 10 s). Developers and admins
post announcements (up to 600 characters, line breaks kept), and team members who are on another page get a pop-up.
You can delete your own messages and announcements; admins can delete anyone's. Deleting an account deletes its chat
messages; its announcements and calendar rows stay without a name (`team_chat`, `team_news` tables).

## Games
- **Online:** Revvd (motocross: realistic 3D dirt bikes, 2–6 riders, ready-up and a start gate), Song Rush (name the song from a 30-second preview), Screen Volley (two laptops side by side, one ball), Neon Dash (mini Geometry Dash race), Family Life (multiplayer BitLife with siblings), Doodle Guess, Impostor, Minesweeper (Race / Battle), Front Wars (OpenFront-style territory war: free-for-all with alliances or teams, bots, ports, warships, nukes and replays), Prop Hunt (top-down hide and seek with a killer), Poly Racer (low-poly 3D racing), Billiards (8-ball / 9-ball pool, winner stays on), Flappy Royale (Neon Flappy with everyone flying the same pipes), Mini Golf (3D, everyone on the same hole with ghost balls), Party Blitz, Connect 4
- **Solo:** Revvd time trial (three tracks, medals, unlockable paint jobs), Mini Golf (Classic Meadow and Spooky Hollow, 9 holes each), Neon Flappy (medals, unlockable birds), Billiards (vs CPU, Speed Clear, practice), Poly Racer time trial, Neon Dash practice, Neon Dash level editor + community levels (beat your level to verify it, then post it: an admin approves it first, 3 posts a day; hosts can race community levels online), Minesweeper (Easy / Medium / Hard), Front Wars vs bots, Slope (3D, three.js), Snake, 2048, Memory Flip
- **Fun:** Spin the Wheel, Would You Rather (global votes), Magic 8-Ball
- **Casino Night (fake coins only):** every match everyone starts with the same coins; most coins at the end wins.
  - VS HOUSE: Roulette, Lucky Dice, Blackjack, Slots. VS PLAYERS: Texas Hold'em, Coinflip, High Card and Dice duels.
  - Host settings: starting coins, win condition (time / rounds / first to a target), min/max bet, allowed games, comeback coins.
  - All cards, spins and rolls happen on the server. Disconnected players auto-stand/fold and keep their seat and coins for 60s.

## Friends, party mode, votes and watching
- **Friends** (accounts only): the 👥 button in every top bar opens your friends list. Add people by name or with
  “➕ Add friend” on their profile; adding someone who already asked you accepts it. Friends show who's online, what
  they're playing (rooms, and solo games via the `page` sent in `hello`), with one-click **Join** / **👀 Watch** links.
  Stored in the `friends` table: a `req` row is a request, accepted friends have an `ok` row each way.
- **Invites:** in a room, “📨 Invite friends” (or 📨 next to a friend in the 👥 list) sends an online friend a pop-up with
  Join / Watch / Not now (`friends:invite`, limited to one per friend every 15 s). “Not now” tells the inviter.
- **Watching:** `/games/<game>?room=CODE&watch=1` joins as a watcher. Watchers are in the room and chat but games
  pick their players from `room.players_now()`, which skips them. “✋ Join in” turns a watcher into a player (games
  that allow joining mid-round add them right away). Full rooms can still be watched (up to 20 extra people).
  The home page lists open rooms and **📺 Live games** (rooms where a game is running).
- **Home page catalogue** (`public/js/hub.js`): `GAMES` has one entry per game, with its `modes` (online / solo
  links; the first is where the tile itself goes), `cats` (which category chips it's under) and an optional `spot`
  (the line under its name in the featured slideshow; `FEATURED` picks which games are in it, in order). The search
  box matches titles, taglines and categories (press `/`). The chosen chip and the last 6 games played ("Jump back
  in") are kept in localStorage (`pa_cat`, `pa_recent`). Every card and slide shows a real in-game picture,
  `public/assets/shots/<game>.webp` (1280×720) and `<game>-sm.webp` (640×360), listed in `SHOTS`; a game without
  one falls back to its drawn art in `ART`. **The pictures are taken by `tools/game_shots.py`** (with the server
  running): it drives a headless Chrome through `tools/cdp.py` (DevTools protocol, standard library only), with a
  recipe per game that gets it to a good moment, opening extra tabs as extra players for the multiplayer games.
  Run it again after a game changes: `python3 tools/game_shots.py golf moto`.
- **Play-again vote:** when a game ends (`Game.finished(groups)`, called by every online game), players vote
  🔁 again or 🎮 new game for 20 s; “new” starts a second vote on which game, and the whole room moves there with the
  same code (`room:goto`). The host pressing start still works and ends the vote.
- **Party mode:** the host picks 2–8 games. Each game's places turn into party points (10, 7, 5, 3, then 1), the room
  moves to the next game 10 s later, and the final standings are saved as a `party` game (it doesn't add to the
  all-games totals, since those games were already counted). Hosts can also **🔀 switch game** at any time.

## Prop Hunt
A top-down hide-and-seek shooter in a randomly generated town (`games/prophunt.py`, `public/js/games/prophunt.js`).
- Each round one player is the killer (it rotates, everyone gets 1 or 2 turns). The killer is blind for the hiding time
  (15/20/30 s), then hunts for 1:30–4 min with a gun (6 shots, reload). Every 30 s the killer gets a ping: circles
  roughly around each hider.
- Hiders press E next to a prop to turn into it, or hide inside buildings: roofs hide the inside from anyone outside.
- Points: the 1st caught gets 1, the 2nd 2…; surviving = number of players in the round; the killer gets 2 per catch
  (up to 8), or 10 for catching everyone. Caught players watch the killer and only chat with other watchers.
- Maps: 🏙️ town, 🏫 school (classrooms along a hallway), 🛍️ mall (shops around a hall, parking outside) and
  🏠 party house (rooms, a hallway, a garden with a pool you can't walk through), or a mix. Every generated map is
  checked to be fully walkable and regenerated if not (`connected()`).
- Power-ups each round: hiders get 2 🪞 decoys (a fake copy that looks just like you to the killer) and a ⚡ 3 s speed
  burst; the killer gets a 📡 radar (an extra ping) and 2 💣 grenades (thrown where you aim, blast radius 100, walls
  protect you). Keys 1 and 2, or the buttons.
- Anti-cheat: browsers send positions, the server checks speed and walls, does all hit detection (with a little lag
  allowance), and only sends each player the people they could see (nobody behind roofs or past 560 px).
  Maps are tested to always connect every building (`make_map`).

## Poly Racer
Our own low-poly 3D racer in the style of PolyTrack (three.js). `public/js/games/poly-core.js` has the tracks, the car
physics and an autopilot, with no drawing, so it also runs outside the browser. `poly.js` draws it, and `games/poly.py`
runs online races (each browser drives its own car; the server relays positions and decides places).
- **Tracks** are tiny programs: `F40` straight, `L90r30` / `R45r60` turns (angle, radius), `U30h6` / `D30h6` hills,
  `K12h3` kicker ramp, `J18` gap to jump (`J18h-4` lands lower), `B20` boost pad, `C` checkpoint, `W0`/`W1` walls off/on,
  `w5` road half-width. The end is the finish line.
- **Adding a track:** add it to `TRACKS` in `poly-core.js`, drive it with the autopilot (`PolyCore.simulate(track)`) to
  check it can be finished and to set the medal times (author = autopilot, gold +4%, silver +18%, bronze +40%), then add it
  to `TRACKS` in `games/poly.py`, `SOLO` and `BOARDS` in `accounts.py`.
- Solo times are saved per track (`poly1.best`…); times more than 25% faster than the author time are refused, and online
  finish times must match how long the race has actually been going.

## Revvd (the motocross game)
**v3.4.0: Free ride worlds.** Choose **Free ride** in `/games/moto`, then Redrock Frontier (12.96 km²),
Pinecrest Highlands (10.24 km²) or Frostpeak Expedition (16 km²). All three use the actual bike,
chase camera, keyboard/touch/gamepad controls and speed/turbo HUD. Six open-world gears build to about
314 km/h on flat trail terrain; turbo reaches about 344 km/h with enough run-up. Hold **Space / Shift**
(or gamepad A) for turbo, then release to recharge. There is no timer until you start a mini race.
Free-ride steering keeps momentum through turns. Press **R** for the nearest safe pad; the **flag button**
offers four races per world. Ride through the ordered gate arches (jumping over one counts) and finish
every lap. Best times are saved in localStorage per world/race, separately from the online leaderboards.
Each world has a send-it jump park (five tabletops) beside the camp and another pad, and tabletops along
the straight trails. Cabins, the lookout tower, decks and arch posts are solid (you crash into them).

**v3.5.0: Coins, engines and challenges.** Free ride has gold coins along every trail (2 each) and in the air
over every jump (5 each); they come back after 2 minutes. Riding (1 coin per 250 m), flips (5 each), big air,
mini races (30, 50 for a new best) and challenges earn more. Coins buy faster **free-ride engines** in the
garage (⚡ Engine tab): `public/js/games/moto/coins.js` lists them with their power / drag / turbo / gearing
multipliers, which `MotoCore.groundTrack(terrain, spawn, engine)` passes to the physics. Races and challenges
always get `engine = null` (stock). Coins and engines are kept in this browser (`moto_coins_v1`), like the
free-ride records; `tests/mototest.js` checks each engine is faster and that its listed top speeds are true.

**Challenges** (`open-world/challenges.json`, read by the client and `games/moto/game.py`): `race` (first to
a finish pad, any line), `air` (longest single jump), `flips` (most flips landed) and `speed` (top speed
on your wheels) in one of the worlds. Solo, your best is kept on this device (`moto_ch_best_<id>`). In a room
the host switches 🏁 Track race / 🎯 Challenge (`g:settings` `{mode, challenge}`); everyone starts in their own
lane, sees the others, and sends `g:finish` (races) or `g:score` (timed ones, best so far; the server keeps
the best, ignores impossible ones and broadcasts it). Results go to `moto.challenges` / `moto.cwins` stats.
In a challenge a crash puts you back where you last were on your wheels (not at a safe pad).

**v3.6.0: More worlds, air tricks and model bikes.** Three more free-ride worlds — Golden Dunes (a sunset dune
sea with an oasis), Autumn Ridge (orange and gold woods round a lake) and Canyon Run (a deep river canyon with a
kicker over it) — written by `tools/make_worlds.py` from short specs (spots, hills, trails, races). A world file
can carry a `look`: its own sky (`sky`: sun, haze, exposure, fog), ground colours (`rock` / `dirt` / `grass`) and
`autumn` (leaves and grass turn gold and red). **Air tricks** (`MotoCore.TRICKS`): hold 1–6 for Superman,
No-Hander, Can-Can, Nac-Nac, Heel Clicker and Cliffhanger, Z to whip, tap X for a 360 (gamepad X / Y / bumpers / B,
touch ★ and ↻). A trick counts once it's done but only if you land it; touching down mid-trick is a bail. Tricks
and flips in one jump make a combo (points, nitro, free-ride coins); the `tricks` challenge kind scores them.
**Flips** are now counted as the bike's turn in the air less the change of slope from takeoff to landing, so a
backflip off a kicker onto a steep downslope counts (it used to be missed). **Model bikes**: the Stark Varg and Hill
Racer in the garage are glTF files (`public/models/moto`, CC BY 4.0, credited on `/credits`). `bike.js` loads one
when it's picked, fits it onto the physics frame (its axles on the physics axles, wheels resized and spinning,
the rider's hands and feet on its own bars and pegs) and draws the Factory 450 until it has loaded. The Stark
Varg was cut from a million triangles to 90 000 by merging nearby points (vertex clustering). **Model rider**:
the default rider (Garage → Rider: Mystery Biker) is a rigged glTF character (`public/models/moto/rider.glb`, "80's
mystery biker" by thomasdonovan26, CC BY 4.0, packed with `tools/pack_rider.py`: no clips or shape keys, 512 px
JPEG textures). It has no animations: `poseBike` works out the same hips, shoulders, head, grips and pegs as for the
drawn rider and turns its skeleton's bones towards them (spine and neck aimed, arms and legs by two-bone IK with the
model's own bone lengths and hinges that only bend the right way, feet flat on the pegs, fingers curled round the
grips), so tricks and the crash ragdoll work unchanged. The MX Racer is the drawn rider, and the one in kit colours.

**v3.8.0: Magma Isle, Emerald Bay and gap jumps.** Two more worlds: Magma Isle (a volcano island: a lava lake in
the crater, a lava river, lava pools) and Emerald Bay (a lagoon in green hills). A lake or river can be `"lava":
true`; `look.flora` keeps only some kinds of scenery. Every world file has `features` (`tools/make_worlds.py`
writes them, including for the first three worlds): **gaps** (lava, water, ice or chasm; anchored to a point
beside a trail, then placed by `terrain.mjs` on the nearest clear ground with a straight-slope fit: run-in, a 23°
kicker, the pit and a long landing) and **pools** (lava, tar, water). `terrain.featureAt` shapes the ground,
`hazardAt` says what fluid is there (deep lake and river water too) and `boostAt` finds the boost pads laid on
the trails' straights. In `core.js` a bike that sinks into a hazard crashes (`hazard` event, with the gap's
`retry` spot); boost pads push you along (`pad` event). After a free-ride crash you go back to the gap's run-in, or
where you were riding a few seconds before (R and the world edge still go to a safe pad). Hoops over every gap and
the biggest park jumps pay 15 coins. The world test checks that every feature is placed, no trail runs through
one, full throttle from the run-in clears every gap and rolling up slowly drops you in. Jumps are much smaller than
the coarse ground's cells, so `world.mjs` gives every tabletop, gap and pool its own always-drawn piece of ground
(3–5 m spacing, cut away by the coarse material's hole where the detailed patch is) and pushes the coarse ground
under the pits down; `ride-world.update(point, dt, camera, ahead)` centres the detailed patch up to 30 m ahead of a
fast bike. **Steering**: the front end of the drawn bikes (bars, clamps, fork tubes, mudguard, plate) is its own
group turning on the fork axis with the front wheel and fork legs (`s.st`, shown a little more than the physics'
angle at speed); the hands follow the grips. Model bikes turn just their front wheel. Leaning pivots on the tyres'
contact (`poseBike` moves the bike so the ground point stays put). **Maps** (`moto/map.js`): the minimap is a round,
heading-up view round you over a top-down picture of the world (drawn by `map.js` from the terrain: a rough 128²
straight away, then a sharp 512² a few rows a frame), with arrows on the rim to your waypoint, a challenge finish
or the next mini-race gate; in races it's the track. M or a tap opens the big map (drag, wheel / pinch zoom), where
places, gap jumps, pools, parks and mini-race starts can be set as the waypoint (a beam, and the distance on the HUD)
or ridden to (fast travel: solo free ride only). Lakes have a shore (`terrain.rawHeight` keeps the ground just
outside a lake above its water, and `shore()`, the last step of `heightAt`, does the same for every lake and river bank)
and `tintAt` colours ground under water.
**Supercar** (free ride on your own, `prefs.vehicle = 'car'`): `moto/car.js` is a raycast-style car on the world's
ground (four springs along the ground's normal, pitch and roll from their forces, grip-limited steering, a
handbrake that lets the tail out, seven automatic gears, turbo, air pitch on Q / E, crashes on its roof, in a hazard,
into a building or off the world). It keeps the bike's field names (`px`, `pz`, `y`, `h`, `vx`, `wh`, `crashed`…), so
`game.js` drives it as `R.V` with the same camera, coins, hazards, respawns and map. `moto/car-model.js` builds the
car: the Revuelto (ALIEEEN) or Aventador (Arion Digital) model files (CC BY, `public/models/moto`, packed with
`tools/pack_rider.py`), fitted by their `Wheel_*` nodes onto the physics axles (each wheel on its own pivot, the
Revuelto's `Body` material repainted), or the wedge built from code (also shown while a file loads).

`MotoCore.groundTrack(terrain, spawn)` is the free-ride adapter: `slice()` samples world-space ground
along the bike's heading; it bypasses track berms, fences, wrong-way checks and track-based finish
logic. Track racing keeps its existing progression and room protocol. The high cliff perimeter is
part of the heightfield; going out of bounds resets to a safe pad. Spawn pads face the outbound trail
and sit clear of buildings. World headings convert with `Math.PI / 2 - mapHeading`; positions stay x/z.

`open-world/terrain.mjs` builds the height in layers: the authored hills, lake and river (the trails
follow these), then trails, pads and jumps, then theme landforms (mesas and dunes, forested hills, crags)
only where a 10 m "wild" mask says it's well away from trails, pads, buildings, jumps and water, then
foothills up to the world's edge with the big peaks beyond it. Building and start-arch positions are
worked out there too, because the solid ones are obstacles in `core.js`.
`open-world/world.mjs` draws it: the ground in tiles, water, scenery from the race tracks' models
(`makeProps` in `world.js`, at a lighter detail level) instanced in 250 m chunks with cheap far copies
in 1 km blocks, buildings from `open-world/buildings.mjs`, signs, arches, stakes and hay. Call
`update(cameraPosition)` every frame to swap near and far copies.
`open-world/ride-world.mjs` adds the race tracks' sky, sun shadows (medium/high quality) and fog, clouds,
particles, a moving 1 m terrain patch round the bike (built a little each frame) and grass and pebbles
scattered on it. Scenery on the patch is re-seated on it when it moves.
Append `&perf=1` to a free-ride URL for the visible FPS/CPU/triangle/draw-call meter.
`open-world/trials.mjs` handles fixed-step gate sweeps, laps and timing.
The `/games/moto-worlds` inspection preview still works. Quest definitions and co-op activities still
need mechanics; online free ride is future work. Trees and rocks are not solid.

Handling settings live in `MotoCore.P`: firmer clutch engagement and faster throttle response,
shorter shifts, lower rolling/aero drag, less restrictive suspension damping and more balanced
front/rear braking. Camera FOV/follow rates, subtle shake, sound load response and gamepad dead zones
are tunable there too. The engine sound follows real rpm with an additional acceleration/load response.
`tests/mototest.js` checks the adapter, safe resets, ordered race gates, high-speed turbo/braking,
big-jump landings and frame-rate consistency;
`node tests/motoworldtest.mjs` also rides the actual three world heightfields. Robot reference times
in `tracks.json` remain unchanged by the free-ride speed tuning (50.16 / 53.05 / 51.20 seconds).

A realistic 3D dirt bike game in the style of Cork7 (`/games/moto`), in its own folders: `games/moto/` (the server)
and `public/js/games/moto/` (everything in the browser). No extra packages: three.js comes from jsDelivr (ES modules
with an import map), everything else is drawn and synthesised in code (no model, image or sound files).
- **Controls:** W / ↑ gas, S / ↓ brake (held when stopped: back up), A D / ← → steer, Q lean back, E lean forward,
  Space nitro, R back to the checkpoint, C camera, M mute. Phones get on-screen buttons; gamepads work (triggers, left
  stick steers, right stick leans).
- **`core.js`** is the physics, with no drawing, so it also runs in the tests. You ride anywhere in 3D: the bike has a
  position seen from above (`px`, `pz`) and a heading. Steering uses bike geometry (the bars turn less the faster you
  go) and tyre grip (too fast for a turn and you slide wide and scrub off speed; going round a berm gives more grip),
  and the bike leans into turns at tan(lean) = sideways acceleration / gravity. Up and down is a full model in the
  bike's upright plane, which turns with it: each step `slice()` samples the ground along the way the bike points
  (x = odometer, y = height), and a frame on a fork and a shock, two wheels with slip-based tyre grip, a 5-speed gearbox
  with a rev limiter, brakes, nitro, and a rider on springy legs ride over it. Leaning moves the rider's weight on the
  ground and spins the bike in the air; with no lean held in the air the rider levels the bike for the landing. A
  small "rider instinct" stops held-gas wheelies and hard-braking stoppies from looping over. Crashes (body or head on
  the ground, or upside down) send you back to the last checkpoint after ~2.3 s. Clean landings (+ more for big air and
  perfect angles) and flips (+30% each) fill the nitro. Fixed 1/120 s steps with 8 substeps.
- **The ground** is one function, `heightAt(T, s, u)` (s = metres along the track, u = metres right of its middle):
  the riding surface follows the track's profile and is banked in the corners, jumps get dirt sides, and hills rise
  further out. The 3D world draws exactly this, so the wheels sit on what you see. `locate()` turns a point seen from
  above into (s, u). Past the tape (u beyond 5.2 m) the ground is rough and slow; a barrier at 11.5 m stops shortcuts.
  Checkpoints (in order) and the finish go by s, and a WRONG WAY sign shows when you turn round.
- **`bike.js`** builds the bike and rider from code and poses them from the physics every frame (fork, swingarm, shock,
  spinning wheels, the rider's arms and legs reaching the bars and pegs). `makeBike({ livery, model, kit, helmet, number })`:
  the paint job (`LIVERIES`, unlocked as rewards), the bike style (`MODELS`: Factory 450, 250 Two-Stroke, Enduro, Retro 70s,
  E-Moto), the rider kit (`KITS`), the helmet (`HELMETS`) and the race number. Styles, kits, helmets and numbers are free
  and only looks (the physics never sees them); they're kept in `moto_prefs` and sent to the room with `g:style`, so the
  others see them in the start gate and on their ghosts. **`world.js`** builds the world around a track:
  a Sky shader per theme (desert midday, forest overcast, snow dusk), sun shadows, fog, terrain with sculpted jumps and
  banked berms, ruts, puddles, scenery (boulders, pines, leafy trees, saguaro and barrel cacti, bushes, grass, dead trees,
  logs and snowbanks, each made from shapes that are lumped, cut and coloured per vertex, then instanced with a random
  tint), tyre stacks, banners, the start gate with its pen and billboard, the arches, and particles. **`sound.js`** synthesises the engine
  from the revs. **`game.js`** is the page: the 3D scene behind the menus (your bike, or everyone's in a room, parked in
  the start gate under a slowly drifting camera), controls (keyboard, touch buttons, gamepads), the chase/side/close
  cameras, the HUD, solo time trials and online races. **`menus.js`** draws the menus inside the game window, like
  Cork7: the main menu (solo or online, your rider licence, the garage), the tracks, racing online (create a room, quick
  play, join with a code), the room (riders, ready-up, the track, chat and the room tools), the garage (paint jobs shown
  on the 3D bike, locked ones too), leaderboards and controls. The site's top bar is hidden on this page; its account
  and friends buttons move into the game's.
- **Tracks are data**: `public/js/games/moto/tracks.json`. Each one has an `id`, `name`, `emoji`, `theme` (`desert`,
  `forest` or `snow`), `grip` (1 = hard dirt), `roll` (extra rolling resistance, like sand), `about`, `robot` (see below)
  and a `course`: a list of pieces laid end to end, all sizes in metres:
  - `flat L` · `bumps L H` (small random bumps) · `roller L H` / `rollers L H N` (smooth humps) · `whoops L H N`
  - `up L H` / `down L H` (change the height) · `dip L D` · `drop H` (ride off a ledge)
  - `kicker L H` (a ramp with free air after it) · `double L H G` (takeoff L long with its lip H high, a gap of G to the
    top of the landing) · `table L H T` (a tabletop with a T-long top) · `stepup L H` (land on top of a step)
  - `turn A R` (a bermed corner of A degrees, radius R; negative A turns left)
  - `mud L` / `ice L` (slippery patches) · `start` · `cp` (a checkpoint) · `finish`
- **Adding a track:** add it to `tracks.json` with `"robot": 0`, run `jsc tests/mototest.js`: the robot rider rides it
  (from the start and from every checkpoint, which must work too) and prints its time; put that time in `robot`. That's
  all: the server, leaderboards (`moto_<id>`), solo scores (`moto-<id>`) and online races pick it up by themselves. The
  medal times are the robot's time +6% (gold), +20% (silver), +45% (bronze). If the robot crashes, make the jumps a little
  gentler or give the checkpoint a longer run-up. (Profiles show tracks they don't know by their id.)
- **Online** (`games/moto/game.py`): 2–6 riders; the host picks the track, everyone presses Ready and the race starts
  by itself after a 3-2-1 countdown, everyone side by side in the start gate (party mode and "play again" skip the
  ready-up). Each browser rides its own bike and sends its 3D position, heading and pose ~12 times a second; the others
  are drawn as see-through bikes (in their paint job's colour, or their player colour) 130 ms in the past so they move
  smoothly, with name tags and their engines. Places go by who crosses the
  line first; once someone finishes, the rest have 30 s. Finish times faster than 70% of the robot's time, or longer than
  the race has been on, are refused. Spectators follow the leader. Admin cheat: end the race.
- **Saved:** solo `moto<id>.best` (fastest ms) and `moto<id>.wins` (finishes), `moto.finishes`, `moto.flips`; online also
  `moto.races`, `moto.wins`, `moto.podiums` and the track's best time. Leaderboards `moto` (wins), `moto_flips` and one per
  track. **Paint jobs** (`bikes` in `public/data/unlocks.json`, the `bike` look slot) unlock like the other rewards, and
  others see yours in races. Local best times and settings are kept in the browser (`moto_best_<id>`, `moto_prefs`).
- `tests/mototest.js` checks the bike (standing still, top speed, gears, brakes, wheelies, crashes, a backflip filling the
  nitro, steering, sliding wide, the barrier, slow ground off the track, backing up, wrong way, wheels on the drawn
  ground) and has the robot (which steers along its line) ride every track; `tests/motobot.py` tests solo scores, paint
  jobs and an online race.
  On localhost, `window.__moto.advance(seconds, controls)` drives the game by hand and `window.__moto.drawMenu()` draws
  one frame of the menu scene (the browser pane used for testing barely runs animation frames).

**v3.14.0: Unrevvd (mountain bikes) and the Big Drop.** The 🚵 **Unrevvd** tab is Revvd on mountain bikes: free ride
(the new Wildwood Bike Park, plus every other world), seven Unrevvd challenges (`"vehicle": "mtb"` in
`challenges.json`), its own coins and upgrades, and riding free with dirt bikes in a room.
- **Physics:** `MotoCore.groundTrack(terrain, spawn, null, mtb)` with `mtb` = `{ power, drag }`
  multipliers (`{}` = stock). The rider's legs push the back wheel with up to `P.MTB.FMAX` newtons and no more than
  `P.MTB.POWER` watts (about 47 km/h on the flat, 33 km/h up a 20% hill with the climbing boost `P.MTB.CLIMB`, 85 km/h coasting down a steep one), with its
  own air drag. No nitro. Leaning back on the ground pulls a wheelie the rider balances (`P.MTB.WHEELIE`, v3.14.1). Same
  frame, suspension, tricks and crashes as the dirt bike.
- **Coins:** `coins.js` keeps two wallets: Revvd's (`moto_coins_v1`, `ENGINES`) and Unrevvd's (`MTB`, `mtb_coins_v1`,
  `MTB_PARTS`); `tests/mototest.js` checks the mountain bike's speeds and each upgrade's listed top speeds.
- **Bikes:** `public/models/mtb/downhill.glb` and `tyax.glb` (CC BY, see the credits), made with
  `tools/split_bike.py` (bakes, turns the bike to face +Z, splits the wheels and cranks into their own parts, merges
  close vertices) and then `tools/pack_rider.py` (smaller textures). In `bike.js` their `FILES` entries also give the
  bottom bracket, a pedal, the saddle and a bigger rider (`rider: 1.1–1.2`): the cranks turn round the bottom bracket,
  the feet follow the pedals, and the rider sits on the saddle while pedalling and stands up on level pedals to coast.
- **Multiplayer:** in a free ride each rider picks 🏍️ / 🚵 / 🏎️ in the room; a mountain bike's `g:pos` has `v: 2` and
  its model is the `mtb` style key. Unrevvd challenges are ridden by everyone on mountain bikes.
- **Worlds:** `tools/make_worlds.py` writes **Wildwood Bike Park** (`"bike": true`; a forested mountain with a long
  climb, a flow trail, a rock garden, a jump garden and bike-sized gap jumps) and **Sheerwall Mesa**: a 420 m cliff
  (`terrain.scarp` in `terrain.mjs`: a wall across the map, the high ground to the north) with a road cut down its
  face. Its challenge, **The Big Drop** (dirt bikes), races from the Cliff Top to the valley floor: take the road, or
  ride off the edge (the free-ride landing absorbs an upright landing).
- **The Timber Run (v3.15.0, own map in v3.16.0):** a world can have `gauntlets` (`{id, from, to, width, fringe, gap,
  trees, rocks, stumps, logs, jumps, ferns, bushes, branches, lanterns}`; `terrain.mjs` places them from the world's seed): a corridor packed with
  solid trees (hit radius = the trunk; `gap` = closest two trunks), rocks, stumps and fallen logs (`obstacleAt`: jump
  high enough and you clear the low ones), with small kickers down it. `core.js` checks the front wheel, both bar ends,
  the middle and the rear wheel against them (`obstacleHit`). The run is in its own small world, **Timber Chute**
  (`timberchute.json`, 220 × 640 m: a steep gully; `"hidden": true` in the manifest keeps it out of free ride, rooms
  and links, `"buildings": false`, small safe pads). It's drawn with real models (`open-world/nature.mjs`,
  `public/models/nature/`): ez-tree pines (`tools/pack_trees.py`; near and far versions, in 30 m slices) and Poly Haven
  scans of mossy rocks, a stump, a log and ferns (`tools/pack_nature.py` shrinks them); without the models it falls
  back to the scenery models. Its challenge (`"cam": "first"`) is ridden in first person (also the fourth camera on C):
  the camera sits behind the rider's hands, measured in the bike's own frame (so it turns over in a flip, and stays on
  the bar when a trick lets go), with the near plane cutting away the rider's own back. After a crash you restart on a
  clear line (`clearOfTrees` in `game.js`).
- **Frozen Run and Night Run (v3.17.0):** two more hidden gullies built the same way. **Frost Chute** (`frostchute.json`,
  theme `snow`): `gauntletScenery(..., {snow: true})` puts snow on everything that faces up (`snowy()` in `nature.mjs`)
  and the ground is a Poly Haven snow photo (`"look": {"photo": {"snow": [colour, height, brightness]}}`, loaded over the
  made-up texture in `materials.mjs`). **Midnight Chute** (`nightchute.json`, `"look": {"night": true}`): no sky or sun,
  stars, thick black fog, a lamp on the bike (`world.lamp`, aimed in `game.js`) and glowing lanterns (`"lanterns"` in a
  gauntlet; the nearest four are real lights). Gauntlets can also have `bushes` (ez-tree bushes in thickets round the
  trees, fewer on lower quality) and `branches`; they're only drawn, you ride through them. Leaf textures that Poly Haven
  ships as colour + alpha are joined by `tools/png_alpha.py`.
- **More chutes (v3.18.0):** `chutes.js` holds the extras. Every race challenge has medal times (`"medals"` in
  `challenges.json`, else a share of its limit), a best-time board (`mch-<id>` solo scores, `mch_<id>` boards in
  `accounts.py`) and ghosts: a run is recorded at 8 frames a second as position messages (`ghostRecorder`), your best is
  kept in the browser and the fastest on the board in the `ghosts` table (`ghost:get` / `ghost:put`: only kept if it's
  the time you saved, and faster than the one there). Ghosts are drawn like other riders, by the challenge clock.
  `chuteRun` watches near misses (`obstaclesNear` in `terrain.mjs`: +3 coins within half a metre, and how close the next
  tree is for the heartbeat), bushes you ride through and the trail stats. New worlds: **Autumn Chute** (`"aspens"` in a
  gauntlet: that share of the trees are ez-tree aspens with slimmer trunks, `loadAspens`; `"autumn"` tints leaves per
  tree and drops leaves), **Fog Chute** (`"fogPulse"`), **Storm Chute** (`"storm"`: rain, lightning `onLightning`, and
  `"mud"`: less grip) and **Tag Wood**. The **Daily Chute** is a chute's look with a seed from the date (`dailyChute`; one
  board a day, `mch-daily`), the **Downhill World Cup** (`CUP`) rides five in a row (`mch-cup`). **Lantern Hunt** (kind
  `lanterns`: collect them, most wins) and **Forest Tag** (kind `tag`, rooms only: the server picks who's it and checks a
  `g:tag` against where both riders last were, with 3 s before you can tag back; least time being it wins).
  **Carvvd** (snowboards, its own tab and logo: the `snow` screens in `menus.js`): challenges with `"board": true` and a
  free ride on Frostpeak (`startFree(w, { board: true })`, `?board=1`). `boardify` in `bike.js` hides the bike, puts a
  board (your colour, `BOARDS` in `game.js`) under the rider and turns them sideways; the physics is the mountain bike's
  with almost no pedal power, so a board only really goes downhill (pick starts with no climbs).
  Unrevvd's riders and the snowboarder are Quaternius CC0 characters (`public/models/riders/`, packed by
  `tools/pack_character.py`, which drops their animations). `RIDER_FILES` in `bike.js`: their bones are renamed to the
  Character Creator names the posing uses, re-hung (thighs off the hips, feet off the shins, the "body" bone under the
  hips) and given toes; the snowboarder is recoloured and gets a beanie and goggles (`winterGear`). On the board the
  rider is posed by `poseSnowboarder` (`bike.js`): bent knees, leaning into carves, looking over the front shoulder, the
  back foot pushing along when slow with the gas held, a speed tuck, a tuck in the air and grabs for the trick keys
  (`GRABS`; their names are `BOARD_TRICKS` in `game.js`). On a snow world each board cuts a groove behind it
  (`snowtrail.js`, a strip of short pieces laid on the ground, shared by every rider), and carving throws powder off
  its edge; the snow ground glitters close up (`materials.mjs`). On the snow maps it snows (`flakes` in
  `ride-world.mjs`), the grooves fill in over `FILL` seconds, snow settles on riders (`snowCover`: their own copies of
  their materials, `cover` building up in `settle` in `game.js`, knocked off by a crash) and lies on the buildings and
  signs (`coverShader`, `cover.js`). Tyre tracks too, on any ground, in `tracks.js` (`createTracks`: grooves for boards
  and skis, prints for wheels, fading or snowed over). Mud builds up in the same shader (`coverModel`).
  Skis: `boardify(m, color, 'skis')` (`skify`, `poseSkier`, poles in the rider's own space). Spins on a board: `b.board`
  in `core.js` (any half turn; odd ones revert on the snow). Powder: `BOARD_FREE.powder` (free ride only). Weather:
  `WEATHER` in `game.js`, `look.weather` in the world (`ride-world.mjs`; a blizzard's `wind` is `windStep`).
  Parks (`features.parks` in `tools/make_worlds.py`, shaped by `terrain.mjs`'s `parkShape`, drawn by
  `open-world/parks.mjs`): halfpipe and rail garden (Carvvd; rails are solid only to ride on: `railAt` / `rideAt`, and
  `parkStep` in `game.js` locks you on and scores the slide, and turns you round in the air out of the pipe), pump track
  and dirt jumps (Unrevvd), hill climb and the freestyle arena (Revvd; `judge`). Chairlifts: `features.lifts`
  (`startLift` / `liftFrame`, `seatRider`). Powder Peak Resort (`powderpeak`): `look.forest`, `pisteClear`,
  `solidForest` (`terrain.addSolids`), `treeLine`, and runs with a `piste` colour (marker poles in `parks.mjs`).
  Twilight Slope (`twilight`): one floodlit run at dusk. `features.forest` places real solid spruces either side and
  all over the hill (`terrain.forestTrees`; spruces from `public/models/nature/spruces.glb`, `loadSpruces`), drawn
  by `forestScenery` in `nature.mjs` (full trees close by, simpler ones further, painted cards far off);
  `look.floodlights` and `features.lodge` in `open-world/slope.mjs`; `look.dusk`; `look.corridor` (how far off the
  run you may go: `offSlope` in `game.js`, `terrain.trailNearest`); `terrain.crags: false` and `boundary.rise`.
  Wavvd (jet skis, `R.water`): a world with `"sea"` (Azure Bay, `azurebay`): `terrain.mjs` keeps the seabed as
  `bedAt`, `heightAt` is the calm surface and `rideAt` the Gerstner waves (`waveAt`, the wall clock `waveTime`);
  `open-world/ocean.mjs` draws the same waves on the graphics card (see-through by depth from a seabed picture, sky
  reflection, foam, wakes from `wake()`), buoys, piers and the lighthouse; seabed caustics and sand in `materials.mjs`.
  The jet ski is `jetskify` in `bike.js` (the dirt bike's physics with the `JETSKI` engine in `game.js`). Wavvd's
  challenges have `"water": true` (kept out of the Weekly Challenge's pick, client and server). Wakeboarding:
  `tow.js` (a boat on a loop pulls you on a rope; its wake ridges go into `rideAt` through `terrain.setSeaExtra`).
  The newer modes (`R.veh`, a challenge's `"vehicle"`; menus: `NEWER` and `newerHub` in `menus.js`): Sledvvd
  (`sled`: `sledify`, the dirt bike's physics with `SLED`), Drivvd (`buggy`: `car.js` `setSpec('buggy')`, the
  buggy built in `car-model.js`), Skyvvd (`wing`: `wing.js`, its own flight physics, drawn and followed like a car;
  the flyer and parachute in `car-model.js`) and Grindvvd (`skate`: `skateify`, the mountain bike's physics with
  `SKATE`, on Concrete Coast, `skateplaza`, a `"paved"` world). Their model files: `public/models/moto/buggy.glb`, `parachute.glb` (`preloadExtra` in `car-model.js`; the buggy's wheels are found by position and put on springs in `fitBuggy`) and `skateboard.glb` (`preloadSkateboard` in `bike.js`); the wingsuit's flyer is your rider in its T-pose (`makeWingsuit` in `game.js`). The menus: one Modes tab (`MODES`, `modeKey` in `menus.js`). Challenges newer than the Weekly pool carry `"since"`
  (kept out of it). Gate courses: a challenge's `"gates"` ([x, z, radius, height?], `gateStep`). The sky for free
  ride: `SKIES` / `applySky` in `game.js`. Career: `career.js` (worked out from medals and bests). Today's challenge:
  `todaysChallenge` in `chutes.js`. Friends' ghosts: `ghost:friends` and the `my_ghosts` table in `accounts.py`.
  Challenges: `park` (start at a park; laps: `lapStep`), `avalanche` (`avalanche.js`, `avalancheStep`), `judges`, and
  the room-only Lantern Relay (`kind: relay`: teams, `g:pass`, the team finishes together; `games/moto/game.py`).
  The Weekly Challenge: `weeklyChallenge` in `chutes.js` and `weekly_challenge` in `accounts.py` (the same pick).
  Photo mode and replays: `studio.js` (the replay is the last minute of `R.rec`). Gear (`Coins.LAMP`, `Coins.CAM`) only
  changes the lamp and the first-person look, so it's allowed in challenges. Tests: `tests/chutebot.py`.

## Billiards
Top-down pool with real physics (spin, banks, kisses, rattling jaws). `public/js/games/pool-core.js` is the table, the
physics and the 8-ball / 9-ball rules with no drawing; `games/pool_core.py` is a line-by-line Python port that gives
**bit-identical** results (only `+ - * / sqrt`, no trig inside the simulation, same order of operations;
`tests/poolunit.py` cross-checks hundreds of shots against node).
- **Online** (`games/billiards.py`): two seats like Connect 4, everyone else watches. The host picks 8-ball or 9-ball,
  a race to 1/2/3/5 frames and a 30/45/60 s shot clock (or none). The server is the authority: it turns the shooter's
  aim into a shot, simulates it (in a worker thread, a break is ~40 ms of Python) and sends the shot and the result;
  browsers replay it with the same core, so everyone sees exactly the same thing. Fouls give ball in hand, running out
  of time is a foul, the breaker alternates each frame. When the match is over: rematch, or the host swaps in the
  longest-waiting player for the loser (winner stays on). Stats: `pool.games/wins/losses/frames/runs`.
- **Solo** (`/games/billiards?solo=1`): vs CPU (Easy / Medium / Hard, `poolcpu.wins`, best level), Speed Clear (pot
  all 15 as fast as you can, a scratch adds 10 s, `poolspeed.best` leaderboard) and free practice.

## Neon Flappy
Tap to flap through glowing neon pipes (a spooky look during the Halloween event). `public/js/games/flappy-core.js` is
the level (pipes from a seed) and the bird's physics in fixed 1/120 s steps, with no drawing, so it plays the same at any
refresh rate; the bird's x depends only on time, which is what lets the server check scores.
- **Solo** (`/games/flappy?solo=1`): medals at 10 / 20 / 30 / 50 pipes, birds unlocked by your best score,
  `flappy.best` leaderboard.
- **Flappy Royale** (`games/flappy.py`, 1 / 3 / 5 rounds): everyone gets the same seed and flies at the same time, seeing
  the others as ghost birds; places by score then flight time give 5 / 3 / 2 / 1 points. The server rejects scores that
  are more than the flight time allows, and a bird that goes quiet for 6 s counts as crashed. Stats:
  `flappy.games/wins/best_online`. Admin cheats: god mode, end the round.
- `tests/flappytest.js` (`node tests/flappytest.js`) proves every test level can be flown deep into the hard part;
  `tests/flappybot.py` plays Flappy Royale over websockets.

## Mini Golf
Low-poly 3D mini golf (three.js). `public/js/games/golf-core.js` holds the six 9-hole courses as data (tile maps plus
ramps, hills, bumpers, blocks, moving obstacles, speed pads and teleports), the random course maker, and the ball physics
in fixed 1/120 s steps on the hole clock, with no drawing, so the same shots always end in the same place. Drag back from
the ball like a slingshot (mouse or touch), drag elsewhere to look around, 🗺️ / V for the whole hole; ←/→ ↑/↓ and Space
on a keyboard. Water / lava, drops and out of bounds cost a stroke and put you back where you played from (not when a
moving obstacle knocks a waiting ball in); 8 strokes and the ball is picked up. Sand is slow, ice (`i` tiles) is
slippery, and a speed pad pushes the ball along its arrow (each pad once a shot).
- **Classic Meadow** (windmill, ramp jump, sliding gate, island green, rabbit-hole teleport), **Spooky Hollow**
  (sliding tombstones, swinging coffin, bat mill, haunted house with a trick door, crypt jump, toxic marsh),
  **Cactus Canyon** (sand alleys, mesas, mine carts, oasis, canyon leap, mine-shaft shortcut), **Frosty Peaks** (ice,
  snowman slalom, spinning ice rink, crevasse, sliding glaciers, mountain pass), **Tropical Cove** (island hopping,
  beach balls, crabs, swinging logs, surf boosts, jump to Treasure Island) and **Volcano Isle** (lava, fire spinner,
  boost vents, magma gates, crater cup, summit). Each course has its own look in `THEMES` in `golf.js`.
- **Random courses** (`generate(seed)`): a course is a number. The pars come from the seed alone (`genPar`, copied
  exactly as `gen_par` in `games/golf.py` with the same 32-bit hash), then each hole grows from it: a lane with up to
  three turns, sized round one big idea (windmill, gate, jump, bridge, spinner, ice, speed pads, a climb…) plus a few
  smaller things, in one of the six looks. Only whole-number maths picks the shape, so every browser builds the same
  holes. Solo: 🎲 on the course menu, or `?solo=1&course=gen-123456`; the end card shows the code to share.
- **Solo** (`/games/golf?solo=1`, or `&course=spooky&hole=6` for one hole): scorecard, best total per course,
  `golf-<course>` leaderboards (lowest strokes; a Spooky round also counts as `golf.spooky_done`). Random courses have
  no best or leaderboard.
- **Online** (`games/golf.py`, course classic / spooky / desert / frost / beach / volcano, `random` = one of those,
  `gen` = a new random course every game (`gen-<seed>`), 3 / 6 / 9 holes): everyone plays the same hole at once;
  each browser runs its own ball and sends its position (drawn as coloured ghost balls) and its strokes. The hole ends
  when everyone is done or 45 s after the first player holes out (the rest get 8). Lowest total wins. The server
  checks strokes (1–8, at least 0.8 s a stroke). Stats: `golf.games/wins/holes/aces/best/spooky_done` (`best` only on
  the six fixed courses). Admin cheats: hole in one, end the hole. Also in party mode and tournaments (3 random holes).
- `tests/golftest.js` (`node tests/golftest.js`) solves every hole within par + 1 and fuzzes the physics (no escapes,
  no tunnelling, obstacles never push the ball through a rail), for the fixed courses and a spread of random ones, then
  solves a hundred-odd more random holes; `tests/golfbot.py` plays Mini Golf over websockets and checks that the
  server's random-course pars match the browser's.

## Song Rush
A song plays and everyone races to name it (`games/songs/`, `public/js/games/songs.js`, 1–16 players, party mode too).
- **Type it:** guesses go through the chat. The server checks them (`games/songs/match.py`): capitals, accents,
  punctuation, a leading "the", anything in brackets and small typos don't matter, and a guess can name the title and the
  artist at once ("shake it off by taylor swift"). For movie songs the second answer is the movie (the singer also
  counts). Close guesses get a private "so close!" and aren't shown to anyone. Once you know part of the answer, your
  chat only goes to players who know at least as much. Hints at 30 / 55 / 78 % of the time: the year and genre, then
  first letters and the artist's initials, then more letters (the title's blanks show from the start).
- **Pick from 4:** three decoys from the same playlist by other artists, from around the same years. Points are added
  at the reveal, so nobody can tell who was right while the song plays.
- Points: title 100 + up to 400 for speed, +50 for the first one, +50 per song in a row (streak, up to +200); artist or
  movie 50 + up to 200. Settings: playlist, mode, 5/10/15/20 songs, 15/20/30 s. A song nobody's browser can load is
  skipped. Stats: `songs.games/wins/points/best/correct/perfect`; leaderboards `songs` and `songs_correct`. Admin
  cheats: show the answer, +500 points, skip the song, end the game.
- **Songs:** `games/songs/playlists.txt` lists them (`year | artist | title`, plus optional `movie:`, `also:` for other
  ways to write the title, `who:` for the artist and `find:` search words). `python3 games/songs/build.py --check`
  looks each one up in the iTunes Search API (clean versions only, about 20 searches a minute, cached in `data/`) and
  writes `games/songs/songs.json` with the 30-second preview, cover and Apple Music link; `--check` lists matches worth
  a second look. The server never calls Apple: browsers download the previews straight from Apple's CDN, decode them
  with Web Audio (so everyone starts together and the equalizer is real) and fall back to an `<audio>` element.

## Screen Volley
One volleyball court spread over two screens standing side by side (`games/volley.py`, `public/js/games/volley-core.js`,
`public/js/games/volley.js`). Players pick the LEFT or RIGHT screen; everyone else watches.
- **Courts in "heights":** each screen's court is 1 high and width/height wide, so screens of any size line up; the net
  stands on the seam (the left screen's right edge, the right screen's left edge). `volley-core.js` holds the physics
  (fixed 1/120 s steps, the same on every screen): gravity, walls, the net and the hand (the cursor or a finger).
  Clicking does not grab the ball; move or flick the hand to hit it. Smashes near the net are slowed down so a ball
  always takes at least 0.24 s to go over.
  The hand is swept along its whole path (`VolleyCore.sweep`: it meets the ball where it first touches it, so a fast
  flick can't jump over it), and its speed is smoothed over ~30 ms unless it's clearly fast (over 2.5 heights/s). Gentle touches pass on 45% of the hand's speed with almost no bounce, rising (squared) to 100% for full swipes
  (4 heights/s); the top of the hand is a flat, cupped palm, so a ball that lands gently rests there, slides to the
  middle and can be balanced and carried. Tune it in `VolleyCore.C`.
- **Open sky:** there is no ceiling bounce. Above-screen balls have a marker at their horizontal position, a rising/falling
  arrow, height and a return countdown calculated with the real physics. Incoming high passes get a warning too.
- **The ball lives on one screen at a time.** That screen runs it, so hits have no lag. When the ball is about to go over
  (within the "lead time": the time a message takes plus a margin), the screen works out exactly when and where it will
  cross (`VolleyCore.predict`), sends that in advance, and from then on the ball can't be touched. The other screen
  shows a warning on its net and takes over at that moment (server time, synced with `g:sync` pings); a late message
  just makes the ball come in a little late, never in the middle of the screen.
- **Server:** keeps score, decides who owns the ball (`epoch` goes up every serve and crossing; only the owner may `cross`
  or `drop`; a drop that overtakes its cross is held until the cross arrives), relays `rtc` messages, and gives the ball
  away if the screen that has it goes quiet for 8 s. Versus to 5/7/11 (the scorer serves) or keep-it-up (3 drops, counts
  passes). Leaving mid-game loses. Stats `volley.games/wins/points/best_rally/coop_best`; leaderboards `volley`,
  `volley_rally`. Admin cheats: +1 point, end the game.
- **Direct connection:** the two screens try WebRTC with no ICE servers, so it only connects on the same local network
  (nobody's public address is shared). The left screen offers every 10 s until it works; the 📶 sign shows the ping and
  "direct" or "via server". Same `cross` message both ways, de-duplicated by epoch.
- **Practice:** `/games/volley?solo=1` plays against a robot with its own invisible court (shown small in the corner).
  Pick Easy, Medium or Hard before playing or from the court's difficulty selector (changing it starts a new match).
  The choice is remembered in your browser; `&difficulty=hard` also works. `volley-ai.js` controls reaction delay,
  hand speed, aim error, mistakes and return selection; Hard prefers quicker attacking shots.
- `tests/volleytest.js` checks the physics (prediction = reality step for step, nothing gets through the net, mirror
  symmetry, seamless hand-offs, fast swipes); `tests/volleybot.py` plays it over websockets. `?debug=1` exposes `window.VB`.

## Tournaments
`tournaments.py`. In any room the host presses “🏆 Start a tournament” and picks Connect 4, Billiards, Neon Dash, Minesweeper,
Party Blitz, Prop Hunt or Mini Golf (3–16 players; watchers don't count). Everyone goes to the live bracket at
`/tournament?id=XXXXX` (byes when the numbers don't fill the bracket). Each round, every match gets its own room with
quick settings and both players are sent there; it starts once both are in, a no-show after 45 s or leaving for 25 s
loses, ties are replayed twice then decided by a coin flip. Anyone else joining a match room can only watch. The
champion gets `tour.wins` (the “Cup winner” achievement and the Trophy aura); tournaments live in memory only.

## Limited-time events
Events are in `public/data/unlocks.json` → `"events"`: an id, name, emoji, `from` and `until` (UTC days; `until` is
the first day it's over) and `track` (event stat → normal stat). While an event is on, every saved game also adds to
`ev.<event id>.<name>` (e.g. `ev.halloween26.games`). Give achievements and rewards `"event": "<id>"` and a rule on
those stats: players keep what they earned, and rewards nobody can get any more are hidden once the event is over.
The home page shows a banner with your progress while an event runs.

## News strip
`NEWS` in `public/js/core.js` puts a short message under the top bar on every page except the games: a title,
a line of text and a hint, with a countdown to `day` ("in 6 days", "tomorrow!", then the `today` title on the day),
or with `until` instead a plain message (and optional `links: [[href, label], …]` buttons) that shows up to that day.
It disappears by itself after that day, and × hides it for good (remembered per `id`, so give a new message a new
id). Set `NEWS = null` when there's nothing to announce.

## Themes and Halloween quests
Settings → 🎨 Theme changes the look of the whole site: Arcade Blue (the default since v3.4.1), Neon (the original
pink and purple), Midnight, Sunset, Ocean, Forest, Candy and Retro are free for everyone (guests keep their pick in the browser). Themes are a reward category (`themes` in
`unlocks.json`, look slot `theme`), so a logged-in player's theme follows their account and the server checks it
like auras. The 🎃 **Halloween theme** (fog, bats, a moon, a spooky font) belongs to the `halloween26` event and is only
unlocked by finishing **all 8 Halloween quests** at `/quests` (quests are event achievements; a rule like
`{"achs": [...]}` needs all of them, a `"stat"` list is summed, and `max` stats are tracked as a max during the
event). Earn it before the event ends and it's yours forever. Less motion turns the ambience off.

## Neon Dash level editor and community levels
`/games/dash?editor=1` (or 🛠️ Level editor on the Neon Dash screen): build a level with every block, spike, orb,
pad and Ship / UFO / Ball / Wave zone, playtest it in the real engine, keep drafts in the browser and share them as
`ND1.…` codes. To post a level you must beat it from the start in one run ("verify"); that run's inputs are saved
with it. Every account can post **3 levels per rolling 24 hours** (every post counts, approved, rejected or deleted;
admins are exempt). New levels stay hidden until an admin approves them in `/admin` → 🟪 Dash levels, where the
creator's verify run can be watched. Approved levels show up in 🌐 Community levels (search, sort, likes, plays) and
hosts can race them online. Stored in the `dash_levels` and `dash_likes` tables (`dashlevels.py`).

## Minesweeper
- **Solo** (`/games/mines?solo=1`): classic Easy 9×9, Medium 16×16, Hard 30×16; the first click is always safe. Medium and Hard times have leaderboards.
- **Race**: everyone gets the same board (with a free opening); fastest clear wins; mines add a time penalty.
- **Battle**: one shared board; each opened square is a point; mines cost 10 points and stun you for 3s.
- The board lives on the server and flags are private, so nobody can peek.

## Credits
`/credits` lists who made the site (made by Franio & Claude, ideas by Franio, Jan & Claude, design by Claude, and the rest),
the tools and fonts used, and the games that inspired ours — plus a movie-style "Roll the credits" button.

## Privacy policy, versions and the changelog
- `/privacy` is the privacy policy (`public/privacy.html`, plain HTML). Parts still to fill in are
  marked like `<mark class="todo">[...]</mark>` and show up highlighted in yellow. Update the
  "Last updated" date at the top whenever you change it.
- Every page's footer shows the version and links to the privacy policy and `/changelog`.
- **Releasing an update:** bump `VERSION` at the top of `public/js/core.js`, and add an entry at the top of
  the list in `public/js/changelog.js` (big new things = next minor version like 2.11.0, small fixes = 2.10.1).
- Players can delete their own account (Account → Delete my account, password needed); it removes the
  account, stats, match history and friends list.

## Impostor: adding words
Everyone gets the secret word except the impostor (who only sees the category, if the host allows it). Each player gives
one clue per clue round in the chat, then everyone discusses and votes. A caught impostor gets one guess at the word.
3–10 players; extra people (and anyone joining mid-round) spectate with their own chat. Word picking, roles, clue checks
(clues can't contain the word or its plural), votes and points all happen on the server.
Word lists live in `games/impostor/words.json`: add words to a category or add a new category
(`"key": {"name": "…", "emoji": "…", "words": [...]}`). The file is re-read at the start of every game.

## Family Life: adding events and actions
Everything lives in `games/life/data/*.json`. The files are re-read at the start of every game, so you don't need to restart.
- `events.json`: yearly events with choices. `ages`, `cond`, optional `sib` (twin/older/younger/any → `{sib}` in text), outcomes with weight `w` and effects `fx`.
- `family_events.json`: shared events (divorce, moving, pets, inheritance…).
- `actions.json`: solo actions. `sibling_actions.json`: sibling-to-sibling actions (`consent: true` = target gets Accept/Decline). `group_actions.json`: voted actions, with `rule` set to unanimous or majority.
- Conditions and weights are small expressions such as `age >= 18 and money > 500`, `100 - looks` or `rand(3, 8)`. Effects include `health happy smarts looks money fame karma`, `rel_parents`, `sib_rel`, `partner`, `marry`, `kid`, `pet`, `jail`, `ach`, and `log` (a Family Log line).
- `shop.json`: the 🛍️ Shop (vehicles, homes, investments, luxury things, staff, experiences). Each item has a `price`,
  yearly `upkeep`, `growth` (% its value changes every birthday), and optionally `income` (rentals and businesses, can be
  negative), `bust` (yearly chance a business goes under), `fx` when you buy it, `yearly` effects (staff), `home`, `max`
  and `once`. You can own several of most things; selling gets 90% of today's value. Lifestyle actions in `actions.json`
  (`cat: "rich"`) use `own_<item id>` in their `cond` (e.g. `own_yacht or own_superyacht`).
- Every birthday your stuff changes value, pays its upkeep and earns its income (one 🧾 line in your life story). If you
  end up in debt, staff you can't pay quit and the bank takes your most valuable things (at 70%).
- Salaries are taxed in brackets (15% up to $20k … 45% above $400k); an 🧮 accountant saves 20% of the tax.
- 🎰 Casino (`games/life/casino.py`): one visit costs 1 energy and gives 15 games of slots, roulette, blackjack, lucky
  dice, horse racing, scratch cards and the lottery. The server decides every game and the browser animates it
  (`public/js/games/life-casino.js`); your new balance only shows once the reels stop or the horses finish. Every game
  has a house edge (slots ~94%, roulette 97%, dice 92–96%, horses 94%, blackjack ~97–99%, scratch 80%, lottery 84%),
  checked in `tests/lifeunit.py`.
- Actions show up in tabs by `cat`: activities, school, friends, hobbies, fun, health, career, family (🏠 Home), love,
  kids, money, travel, rich (💎 Lifestyle), fame (needs ⭐), risky (🦹 Crime) and jail. `pick` adds random words to the
  text (`{"color": ["red", "blue"]}` → `{color}`), `let` computes numbers (shown as money).
- **Flags** (`habits.json`): licences (🚗 driver, ⛵ boater, 🛩️ pilot), school clubs and teams, diets, memberships, side
  projects (YouTube, podcast, band, author, brand…) and habits or addictions. Switch them on with `{"flag": "name"}` and
  off with `{"unflag": ...}`; expressions see `f_<name>`. Each can have `yearly` effects, a yearly `cost`, an `until` age
  (school clubs end at 18) and a yearly `fade` chance (addictions wear off). Cars need `f_driver`, small boats `f_boater`,
  planes `f_pilot` (shop `cond` + `need`), and jobs can ask for a `flag` or a minimum `fame`.
- **Friends**: `{"friend": true}` makes a new one, `friend_rel` changes how close you are with one (`{friend}` in the
  text is that friend), `unfriend` ends it. Friends you never see drift apart; expressions see `friends`/`best_friend`.
- Other effects: `emigrate` / `home_city` (move abroad and back), `job` (straight into a job, e.g. joining the army),
  `adopt`, `home_grow` (% on your homes' value), `count` (counters, seen as `c_<name>`). Majors in `names.json` are
  `[title, emoji, smarts needed, years, cost a year]`; trade schools and grad schools (`bachelors`, `trade_degrees`,
  `grad_degrees` in expressions) open more of the 86 jobs.
- `tests/lifecontent.py` tries every action, every event choice, every habit, shop item and job with random people and
  plays whole lives, and fails on any expression error or on a flag that's checked but never set.
- Typos in expressions are printed when the server starts.

## Running the tests
```
python3 tests/run_all.py
```
It starts a throwaway server (temporary SQLite database, test admin code `test-admin-code-123`) and runs ~1,100 checks:
- Websocket bots that play the online games like real players: accounts, friends, invites, votes, party mode, watching,
  Prop Hunt, tournaments, Poly Racer, Minesweeper, Front Wars, Billiards, Flappy Royale, Mini Golf, the Dash level
  editor (posting limit, admin review), themes and Halloween quests, cheats and rewards, roles and the update calendar, the Family Life shop and casino,
  Song Rush (both modes, scoring, private chat once you know the answer), Screen Volley (serves, passes, points, forfeits)
  and Revvd (solo times, paint jobs, ready-up, positions, finish checks, results).
- In-process tests of the Prop Hunt rules and tournament brackets, the pool physics (Python vs JS, bit for bit), and
  Song Rush's answer checking, song list, hints and scoring, and Screen Volley's physics.
- If JavaScriptCore (macOS) or Node is installed, an autopilot drives every Poly Racer track, every Neon Flappy
  test level is checked to be flyable, every Mini Golf hole is solved within par + 1, and a robot rider rides every
  Revvd track from the start and from every checkpoint.

To run one bot on its own: start a server (`DATA_DIR=/tmp/x ADMIN_CODE=test-admin-code-123 PORT=8012 python3 server.py`),
then `PORT=8012 python3 tests/gamesbot.py`. `accbot` expects a fresh database. The Doodle "show me the word" cheat check
fails now and then (a known flaky test) and is reported as a warning.

## Project layout
- `server.py`: HTTP + WebSocket server and rooms
- `accounts.py`: accounts, sessions, roles, stats, XP and leaderboards (SQLite file or Turso over HTTPS, same SQL)
- `planner.py`: the update calendar for testers and developers (`/calendar`), plus the team's announcements and chat
- `public/js/art.js`: list of Microsoft Fluent 3D emoji (MIT, loaded from the jsDelivr CDN) and Phosphor icons (MIT). `core.js` swaps every emoji on a page for its 3D image and `PA.icon(name)` / `data-icon="name"` add icons
- `games/`: one module per online game (server side)
- `games/songs/`: Song Rush: the game, answer checking, the playlists and the iTunes build script
- `games/volley.py` + `public/js/games/volley-core.js`: Screen Volley's server and its shared ball physics
- `games/moto/` + `public/js/games/moto/`: Revvd (motocross): the online races, and the physics, 3D world, bike, sound and tracks
- `games/casino/`: casino server. `match.py` runs the match (coins, scores, win conditions); every game is its own module
  built on the shared bases in `tables.py`: `HouseTable` (vs house), `PlayersTable` (vs players) and `RoundTable` (shared betting round).
  To add a game: subclass one of them, decorate it with `@register`, import it in `match.py`, and add a matching
  `public/js/games/casino/<key>.js` that calls `Casino.register('<key>', { mount, update })`.
- `public/`: the website (shared `css/style.css`, `js/core.js`, `js/lobby.js`, plus one page per game)
