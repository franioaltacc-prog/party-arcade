import random
import time

from .base import Game, num

MODES = ("ffa", "teams")
SIZES = ("small", "medium", "large")
STYLES = ("continents", "islands", "pangaea")
LEVELS = ("easy", "medium", "hard")
BUILDINGS = ("city", "post", "silo", "port")
MOVES = ("spawn", "attack", "boat", "build", "nuke", "warship", "ally", "unally", "decline")
TICK = 0.1                 # seconds per simulation step
MAX_TICKS = 60 * 60 * 10   # games stop after an hour
EMPTY_GRACE = 60           # end a game when no player has been online this long
MOVES_PER_SECOND = 20


class Front(Game):
    """Front Wars: every browser runs the same simulation (public/js/games/front-core.js).
    The server only collects everyone's moves and sends them out 10 times a second as
    numbered "turns" (lockstep), keeps a log so people can rejoin, and saves results."""

    key = "front"
    max_players = 8

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"mode": "ffa", "teams": 2, "bots": 8, "difficulty": "medium", "size": "medium", "style": "continents"}
        self.picks = {}      # uid -> team number (teams mode)
        self.match = None    # the game being played (or just finished)
        self.results = None
        self.timer = None
        self.n = 0           # last turn sent
        self.queue = []      # moves waiting for the next turn: [player id, move]
        self.log = []        # every turn that had moves: [n, moves]
        self.pid = {}        # uid -> player id in the simulation
        self.reports = {}    # uid -> (winner key, report) when browsers say the game is over
        self.hashes = {}     # turn -> {uid: state fingerprint}
        self.rate = {}       # uid -> (second, moves sent in it)
        self.empty_since = None
        self.t0 = 0.0

    def listed(self):
        return self.phase == "lobby"

    def lobby_state(self):
        return {"phase": self.phase, "settings": self.settings, "picks": self.picks, "results": self.results}

    def state_for(self, m):
        st = self.lobby_state()
        if self.match and self.phase == "playing":
            st["match"] = self.match
            st["n"] = self.n
            st["turns"] = self.log
        return st

    def push_state(self):
        self.broadcast("state", state=self.lobby_state())

    # -- lobby ---------------------------------------------------------------
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase == "lobby":
            s = self.settings
            if msg.get("mode") in MODES:
                s["mode"] = msg["mode"]
            if "teams" in msg:
                s["teams"] = int(num(msg.get("teams"), 2, 2, 4))
            if "bots" in msg:
                s["bots"] = int(num(msg.get("bots"), 8, 0, 40))
            if msg.get("difficulty") in LEVELS:
                s["difficulty"] = msg["difficulty"]
            if msg.get("size") in SIZES:
                s["size"] = msg["size"]
            if msg.get("style") in STYLES:
                s["style"] = msg["style"]
            self.picks = {u: min(k, s["teams"]) for u, k in self.picks.items()}
            self.push_state()
        elif t == "team" and self.phase == "lobby":
            self.picks[m.uid] = int(num(msg.get("team"), 1, 1, self.settings["teams"]))
            self.push_state()
        elif t == "start" and host and self.phase == "lobby":
            self.start(m)
        elif t == "stop" and host and self.phase == "playing":
            self.room.system("🛑 The host ended the game.")
            self.stop()
        elif t == "do" and self.phase == "playing":
            self.move(m, msg.get("it"))
        elif t == "hash" and self.phase == "playing":
            self.check_hash(m, msg)
        elif t == "over" and self.phase == "playing":
            self.report(m, msg)

    def start(self, m):
        humans = self.room.online_members()[:self.max_players]
        s = dict(self.settings)
        if len(humans) + s["bots"] < 2:
            m.send("chat", sys=True, text="🤖 Add some bots (or friends) first — you need someone to fight!")
            return
        if s["mode"] == "teams":
            teams = {self.picks.get(u.uid, 0) for u in humans}
            if s["bots"] == 0 and len(teams - {0}) < 2 and len(humans) < 2:
                m.send("chat", sys=True, text="👥 Teams need players on at least two sides.")
                return
        self.pid = {u.uid: i + 1 for i, u in enumerate(humans)}
        self.match = {
            "id": (self.match["id"] + 1) if self.match else 1,
            "seed": random.randrange(1, 2 ** 31),
            "settings": s,
            "humans": [{"uid": u.uid, "name": u.name, "avatar": u.avatar, "color": u.color,
                        "team": self.picks.get(u.uid, 0) if s["mode"] == "teams" else 0} for u in humans],
        }
        self.phase = "playing"
        self.results = None
        self.tainted = False
        self.n = 0
        self.queue = []
        self.log = []
        self.reports = {}
        self.hashes = {}
        self.empty_since = None
        self.broadcast("start", match=self.match)
        self.t0 = time.monotonic()
        self.room.cancel(self.timer)
        self.timer = self.room.later(TICK, self.turn)

    # -- the game loop ---------------------------------------------------------
    def turn(self):
        if self.phase != "playing":
            return
        self.n += 1
        moves, self.queue = self.queue, []
        if moves:
            self.log.append([self.n, moves])
        self.broadcast("turn", n=self.n, i=moves)
        if self.n >= MAX_TICKS:
            self.room.system("⏰ An hour is up — the game is over.")
            self.stop()
            return
        online = any(u.online for u in self.room.members.values() if u.uid in self.pid)
        if online:
            self.empty_since = None
        elif self.empty_since is None:
            self.empty_since = time.monotonic()
        elif time.monotonic() - self.empty_since > EMPTY_GRACE:
            self.stop()
            return
        # stay on a steady 10-per-second beat, even if one turn was late
        delay = self.t0 + (self.n + 1) * TICK - time.monotonic()
        self.timer = self.room.later(max(0.0, delay), self.turn)

    def move(self, m, it):
        p = self.pid.get(m.uid)
        if not p or not isinstance(it, dict) or it.get("k") not in MOVES:
            return
        sec = int(time.monotonic())
        last, count = self.rate.get(m.uid, (sec, 0))
        count = count + 1 if last == sec else 1
        self.rate[m.uid] = (sec, count)
        if count > MOVES_PER_SECOND:
            return
        k = it["k"]
        clean = {"k": k, "t": int(num(it.get("t"), -1, -1, 1_000_000))}
        if k in ("attack", "boat"):
            clean["r"] = int(num(it.get("r"), 20, 1, 100))
        if k == "build":
            if it.get("b") not in BUILDINGS:
                return
            clean["b"] = it["b"]
        if k in ("ally", "unally", "decline"):   # alliances: p = the other player
            clean = {"k": k, "p": int(num(it.get("p"), 0, 0, 200))}
        self.queue.append([p, clean])

    def check_hash(self, m, msg):
        """Every browser sends a fingerprint of its game now and then. They should all match."""
        n = int(num(msg.get("n"), 0, 0, MAX_TICKS))
        if m.uid not in self.pid or n > self.n:
            return
        seen = self.hashes.setdefault(n, {})
        seen[m.uid] = int(num(msg.get("h"), 0, 0, 2 ** 32))
        for old in [k for k in self.hashes if k < n - 600]:
            del self.hashes[old]
        values = list(seen.values())
        if len(values) >= 2 and len(set(values)) > 1:
            counts = {v: values.count(v) for v in set(values)}
            best = max(counts, key=counts.get)
            for uid, v in seen.items():
                if v != best:
                    self.room.send(uid, "g:desync", n=n)
            print(f"  ⚠️ Front Wars room {self.room.code}: out of sync at turn {n}: {counts}")

    # -- the end -------------------------------------------------------------------
    def report(self, m, msg):
        """A browser saw someone win. Save the result once more than half the players online agree."""
        if m.uid not in self.pid:
            return
        w = msg.get("w")
        if not isinstance(w, dict):
            return
        if "team" in w:
            key = ("team", int(num(w.get("team"), 0, 0, 4)))
        elif isinstance(w.get("players"), list):   # an alliance won together
            key = ("players", tuple(sorted({int(num(x, 0, 0, 200)) for x in w["players"][:20]})))
        else:
            key = ("player", int(num(w.get("player"), 0, 0, 200)))
        shares = msg.get("shares") if isinstance(msg.get("shares"), dict) else {}
        self.reports[m.uid] = (key, {
            "winner": {key[0]: list(key[1]) if key[0] == "players" else key[1]},
            "tick": int(num(msg.get("tick"), 0, 0, MAX_TICKS)),
            "shares": {str(int(num(k, 0, 0, 200))): round(num(v, 0, 0, 1), 4) for k, v in list(shares.items())[:80]},
            "names": [str(x)[:40] for x in (msg.get("names") or [])[:60]] if isinstance(msg.get("names"), list) else [],
        })
        online = [u for u in self.room.online_members() if u.uid in self.pid]
        agree = [r for k, r in self.reports.values() if k == key]
        if len(agree) * 2 > max(1, len(online)):   # more than half of the players online
            self.finish(agree[0])

    def finish(self, rep):
        self.room.cancel(self.timer)
        self.phase = "lobby"   # back to the lobby (with the results) so the host can start again
        s = self.match["settings"]
        winner = rep["winner"]
        humans = self.match["humans"]
        total = len(humans) + s["bots"]
        rows = []
        for i, h in enumerate(humans):
            p = i + 1
            won = winner.get("player") == p or (winner.get("team") and winner.get("team") == h["team"]) or p in winner.get("players", [])
            rows.append({"id": h["uid"], "name": h["name"], "avatar": h["avatar"], "color": h["color"], "team": h["team"],
                         "won": bool(won), "share": rep["shares"].get(str(p), 0)})
        names = rep["names"]
        who = lambda p: humans[p - 1]["name"] if p <= len(humans) else (names[p - 1] if p - 1 < len(names) else "A bot")
        if "players" in winner:
            win_name = " & ".join(who(p).replace("🤖 ", "") for p in winner["players"][:4]) + (" (alliance)" if len(winner["players"]) > 1 else "")
        elif "player" in winner and winner["player"] > len(humans):
            names = rep["names"]
            idx = winner["player"] - 1
            win_name = names[idx] if idx < len(names) else "A bot"
        elif "player" in winner:
            win_name = humans[winner["player"] - 1]["name"]
        else:
            win_name = f"Team {['Red', 'Blue', 'Green', 'Yellow'][max(0, min(3, winner['team'] - 1))]}"
        minutes = rep["tick"] / 600
        self.results = {"winner": winner, "name": win_name, "rows": rows, "minutes": round(minutes, 1),
                        "bots": s["bots"], "mode": s["mode"]}
        self.broadcast("over", results=self.results)
        self.push_state()
        for r in rows:
            outcome = ("win" if r["won"] else "loss") if total >= 2 else "play"
            stats = {}
            if r["won"]:
                stats["front.wins"] = ("add", 1)
                if s["mode"] == "teams":
                    stats["front.team_wins"] = ("add", 1)
            if r["share"] > 0:
                stats["front.best"] = ("max", round(r["share"] * 100))
            what = f"{len(humans)} player{'s' if len(humans) != 1 else ''} + {s['bots']} bots · {s['size']}"
            detail = (f"🏆 Won in {minutes:.0f} min · {what}" if r["won"]
                      else f"Lost to {win_name} · {what}")
            self.record(r["id"], outcome, stats, detail, xp=60 if r["won"] else 20)

    def stop(self):
        """End the game without a result (host stopped it, or everyone left)."""
        self.room.cancel(self.timer)
        self.phase = "lobby"
        self.match = None
        self.broadcast("stopped")
        self.push_state()

    def on_leave(self, m):
        self.picks.pop(m.uid, None)
        if self.phase == "lobby":
            self.push_state()

    # -- admin ---------------------------------------------------------------
    def on_admin(self, m, action, msg):
        p = self.pid.get(m.uid)
        if self.phase != "playing" or not p:
            return None
        if action in ("troops", "gold"):
            self.queue.append([p, {"k": "cheat", "c": action}])
            return "💪 +50,000 troops!" if action == "troops" else "💰 +100,000 gold!"
        if action == "end":
            self.room.system("🛑 An admin ended the game.")
            self.stop()
            return "🏁 Game ended."
        return None
