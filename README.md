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
ban/unban, reset password, give XP, set stats, reset stats, make admin, delete) and a 🛡️ cheat button in every
online game (casino coins, Family Life money/stats/time skip, Neon Dash god mode, Doodle word peek, Blitz points…).
A game where an admin used a cheat doesn't count for anyone's stats or leaderboards.

## Games
- **Online:** Neon Dash (mini Geometry Dash race), Family Life (multiplayer BitLife with siblings), Doodle Guess, Impostor, Minesweeper (Race / Battle), Party Blitz, Connect 4
- **Solo:** Neon Dash practice, Minesweeper (Easy / Medium / Hard), Snake, 2048, Memory Flip
- **Fun:** Spin the Wheel, Would You Rather (global votes), Magic 8-Ball
- **Casino Night (fake coins only):** every match everyone starts with the same coins; most coins at the end wins.
  - VS HOUSE: Roulette, Lucky Dice, Blackjack, Slots. VS PLAYERS: Texas Hold'em, Coinflip, High Card and Dice duels.
  - Host settings: starting coins, win condition (time / rounds / first to a target), min/max bet, allowed games, comeback coins.
  - All cards, spins and rolls happen on the server. Disconnected players auto-stand/fold and keep their seat and coins for 60s.

## Minesweeper
- **Solo** (`/games/mines?solo=1`): classic Easy 9×9, Medium 16×16, Hard 30×16; the first click is always safe. Medium and Hard times have leaderboards.
- **Race**: everyone gets the same board (with a free opening); fastest clear wins; mines add a time penalty.
- **Battle**: one shared board; each opened square is a point; mines cost 10 points and stun you for 3s.
- The board lives on the server and flags are private, so nobody can peek.

## Credits
`/credits` lists who made the site (made by Franio & Claude, ideas by Franio, Jan & Claude, design by Claude, and the rest),
the tools and fonts used, and the games that inspired ours — plus a movie-style "Roll the credits" button.

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
