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

## Games
- **Online:** Neon Dash (mini Geometry Dash race), Family Life (multiplayer BitLife with siblings), Doodle Guess, Impostor, Minesweeper (Race / Battle), Front Wars (OpenFront-style territory war: free-for-all with alliances or teams, bots, ports, warships, nukes and replays), Prop Hunt (top-down hide and seek with a killer), Poly Racer (low-poly 3D racing), Billiards (8-ball / 9-ball pool, winner stays on), Flappy Royale (Neon Flappy with everyone flying the same pipes), Mini Golf (3D, everyone on the same hole with ghost balls), Party Blitz, Connect 4
- **Solo:** Mini Golf (Classic Meadow and Spooky Hollow, 9 holes each), Neon Flappy (medals, unlockable birds), Billiards (vs CPU, Speed Clear, practice), Poly Racer time trial, Neon Dash practice, Neon Dash level editor + community levels (beat your level to verify it, then post it: an admin approves it first, 3 posts a day; hosts can race community levels online), Minesweeper (Easy / Medium / Hard), Front Wars vs bots, Slope (3D, three.js), Snake, 2048, Memory Flip
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
Low-poly 3D mini golf (three.js). `public/js/games/golf-core.js` holds both 9-hole courses as data (tile maps plus ramps,
hills, bumpers, blocks, moving obstacles and teleports) and the ball physics in fixed 1/120 s steps on the hole clock,
with no drawing, so the same shots always end in the same place. Drag back from the ball like a slingshot (mouse or
touch), drag elsewhere to look around, 🗺️ / V for the whole hole; ←/→ ↑/↓ and Space on a keyboard. Water, drops and
out of bounds cost a stroke and put you back where you played from (not when a moving obstacle knocks a waiting ball in);
8 strokes and the ball is picked up.
- **Classic Meadow** (windmill, ramp jump, sliding gate, island green, rabbit-hole teleport) and **Spooky Hollow**
  (sliding tombstones, swinging coffin, bat mill, haunted house with a trick door, crypt jump, toxic marsh).
- **Solo** (`/games/golf?solo=1`, or `&course=spooky&hole=6` for one hole): scorecard, best total per course,
  `golf-classic` / `golf-spooky` leaderboards (lowest strokes; a Spooky round also counts as `golf.spooky_done`).
- **Online** (`games/golf.py`, course classic / spooky / random, 3 / 6 / 9 holes): everyone plays the same hole at once;
  each browser runs its own ball and sends its position (drawn as coloured ghost balls) and its strokes. The hole ends
  when everyone is done or 45 s after the first player holes out (the rest get 8). Lowest total wins. The server
  checks strokes (1–8, at least 0.8 s a stroke). Stats: `golf.games/wins/holes/aces/best/spooky_done`. Admin cheats:
  hole in one, end the hole. Also in party mode and tournaments (3 random holes).
- `tests/golftest.js` (`node tests/golftest.js`) solves every hole within par + 1 and fuzzes the physics (no escapes,
  no tunnelling, obstacles never push the ball through a rail); `tests/golfbot.py` plays Mini Golf over websockets.

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

## Themes and Halloween quests
Settings → 🎨 Theme changes the look of the whole site: Neon (default), Midnight, Sunset, Ocean, Forest, Candy and
Retro are free for everyone (guests keep their pick in the browser). Themes are a reward category (`themes` in
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
- Typos in expressions are printed when the server starts.

## Running the tests
```
python3 tests/run_all.py
```
It starts a throwaway server (temporary SQLite database, test admin code `test-admin-code-123`) and runs ~800 checks:
- Websocket bots that play the online games like real players: accounts, friends, invites, votes, party mode, watching,
  Prop Hunt, tournaments, Poly Racer, Minesweeper, Front Wars, Billiards, Flappy Royale, Mini Golf, the Dash level
  editor (posting limit, admin review), themes and Halloween quests, cheats and rewards.
- In-process tests of the Prop Hunt rules and tournament brackets, and the pool physics (Python vs JS, bit for bit).
- If JavaScriptCore (macOS) or Node is installed, an autopilot drives every Poly Racer track, every Neon Flappy
  test level is checked to be flyable and every Mini Golf hole is solved within par + 1.

To run one bot on its own: start a server (`DATA_DIR=/tmp/x ADMIN_CODE=test-admin-code-123 PORT=8012 python3 server.py`),
then `PORT=8012 python3 tests/gamesbot.py`. `accbot` expects a fresh database. The Doodle "show me the word" cheat check
fails now and then (a known flaky test) and is reported as a warning.

## Project layout
- `server.py`: HTTP + WebSocket server and rooms
- `accounts.py`: accounts, sessions, stats, XP and leaderboards (SQLite file or Turso over HTTPS, same SQL)
- `public/js/art.js`: list of Microsoft Fluent 3D emoji (MIT, loaded from the jsDelivr CDN) and Phosphor icons (MIT). `core.js` swaps every emoji on a page for its 3D image and `PA.icon(name)` / `data-icon="name"` add icons
- `games/`: one module per online game (server side)
- `games/casino/`: casino server. `match.py` runs the match (coins, scores, win conditions); every game is its own module
  built on the shared bases in `tables.py`: `HouseTable` (vs house), `PlayersTable` (vs players) and `RoundTable` (shared betting round).
  To add a game: subclass one of them, decorate it with `@register`, import it in `match.py`, and add a matching
  `public/js/games/casino/<key>.js` that calls `Casino.register('<key>', { mount, update })`.
- `public/`: the website (shared `css/style.css`, `js/core.js`, `js/lobby.js`, plus one page per game)
