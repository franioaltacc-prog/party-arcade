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
Game state lives in memory, so a restart or redeploy resets open rooms.
To update the site, upload the changed files to GitHub — Render redeploys automatically.

## Games
- **Online:** Neon Dash (mini Geometry Dash race), Family Life (multiplayer BitLife with siblings), Doodle Guess, Party Blitz, Connect 4
- **Solo:** Neon Dash practice, Snake, 2048, Memory Flip
- **Fun:** Spin the Wheel, Would You Rather (global votes), Magic 8-Ball
- **Casino Night (fake coins only):** every match everyone starts with the same coins; most coins at the end wins.
  - VS HOUSE: Roulette, Lucky Dice, Blackjack, Slots. VS PLAYERS: Texas Hold'em, Coinflip, High Card and Dice duels.
  - Host settings: starting coins, win condition (time / rounds / first to a target), min/max bet, allowed games, comeback coins.
  - All cards, spins and rolls happen on the server. Disconnected players auto-stand/fold and keep their seat and coins for 60s.

## Family Life: adding events and actions
Everything lives in `games/life/data/*.json`. The files are re-read at the start of every game, so you don't need to restart.
- `events.json`: yearly events with choices. `ages`, `cond`, optional `sib` (twin/older/younger/any → `{sib}` in text), outcomes with weight `w` and effects `fx`.
- `family_events.json`: shared events (divorce, moving, pets, inheritance…).
- `actions.json`: solo actions. `sibling_actions.json`: sibling-to-sibling actions (`consent: true` = target gets Accept/Decline). `group_actions.json`: voted actions, with `rule` set to unanimous or majority.
- Conditions and weights are small expressions such as `age >= 18 and money > 500`, `100 - looks` or `rand(3, 8)`. Effects include `health happy smarts looks money fame karma`, `rel_parents`, `sib_rel`, `partner`, `marry`, `kid`, `pet`, `jail`, `ach`, and `log` (a Family Log line).
- Typos in expressions are printed when the server starts.

## Project layout
- `server.py`: HTTP + WebSocket server and rooms
- `games/`: one module per online game (server side)
- `games/casino/`: casino server. `match.py` runs the match (coins, scores, win conditions); every game is its own module
  built on the shared bases in `tables.py`: `HouseTable` (vs house), `PlayersTable` (vs players) and `RoundTable` (shared betting round).
  To add a game: subclass one of them, decorate it with `@register`, import it in `match.py`, and add a matching
  `public/js/games/casino/<key>.js` that calls `Casino.register('<key>', { mount, update })`.
- `public/`: the website (shared `css/style.css`, `js/core.js`, `js/lobby.js`, plus one page per game)
