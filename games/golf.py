import random
import time

from .base import Game, num

# course id -> (name, par of each hole) — must match public/js/games/golf-core.js (tests/golftest.js checks)
COURSES = {"classic": ("Classic Meadow", [2, 3, 3, 3, 3, 3, 3, 3, 4]),
           "spooky": ("Spooky Hollow", [2, 3, 3, 3, 3, 3, 3, 3, 4])}
MAX_STROKES = 8
COUNTDOWN = 3.0
HURRY_SECONDS = 45
BETWEEN = 7.0          # the scorecard shows this long before the next hole
HOLE_LIMIT = 300       # no hole goes on longer than this
STROKE_SECONDS = 0.8   # nobody plays a stroke faster than this (the ball has to roll and stop)


class Golf(Game):
    """Mini Golf: everyone plays the same hole at the same time and sees the others as ghost
    balls. Each browser runs its own ball; the server relays positions, checks the scores and
    keeps the scorecard. Lowest total wins."""

    key = "golf"
    max_players = 8

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"course": "classic", "holes": 9}
        self.round = None
        self.results = None
        self.wins = {}
        self.timer = None
        self.hurry_at = None

    def listed(self):
        return self.phase in ("lobby", "results")

    # -- what the browsers see -------------------------------------------------
    def round_public(self):
        r = self.round
        if not r:
            return None
        return {"id": r["id"], "course": r["course"], "holes": r["holes"], "hole": r["hole"], "stage": r["stage"],
                "elapsed": round(time.time() - r["start"], 2), "pars": COURSES[r["course"]][1][:r["holes"]],
                "hurry": round(self.hurry_at - time.time(), 1) if self.hurry_at else None,
                "players": {u: {"scores": p["scores"], "how": p["how"], "s": p["s"], "pos": p["pos"],
                                "done": p["scores"][r["hole"]] is not None} for u, p in r["players"].items()}}

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "round": self.round_public(),
                "results": self.results, "wins": self.wins}

    # -- messages ----------------------------------------------------------------
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase != "playing":
            c = msg.get("course")
            if c in COURSES or c == "random":
                self.settings["course"] = c
            n = msg.get("holes")
            if n in (3, 6, 9):
                self.settings["holes"] = n
            self.broadcast("settings", settings=self.settings)
        elif t == "start" and host and self.phase != "playing":
            self.start()
        elif t == "pos" and self.phase == "playing":
            r = self.round
            p = r["players"].get(m.uid)
            if not p or r["stage"] != "play" or p["scores"][r["hole"]] is not None:
                return
            p["s"] = int(num(msg.get("s"), 0, 0, MAX_STROKES))
            p["pos"] = [round(num(msg.get("x"), 0, -50, 100), 2), round(num(msg.get("y"), 0, -5, 20), 2), round(num(msg.get("z"), 0, -50, 100), 2)]
            self.room.broadcast("g:pos", exclude=m.uid, id=m.uid, x=p["pos"][0], y=p["pos"][1], z=p["pos"][2], s=p["s"],
                                moving=bool(msg.get("moving")))
        elif t == "holed" and self.phase == "playing":
            self.holed(m, msg)

    def start(self):
        course = self.settings["course"]
        if course == "random":
            course = random.choice(list(COURSES))
        n = self.settings["holes"]
        players = {u.uid: {"scores": [None] * n, "how": [None] * n, "s": 0, "pos": None} for u in self.room.players_now()}
        if not players:
            return
        self.phase = "playing"
        self.results = None
        self.tainted = False
        self.round = {"id": (self.round["id"] + 1) if self.round else 1, "course": course, "holes": n, "hole": -1,
                      "stage": "card", "start": time.time(), "players": players}
        self.broadcast("start", round=self.round_public())
        self.next_hole()

    def next_hole(self):
        r = self.round
        if self.phase != "playing" or not r:
            return
        r["hole"] += 1
        r["stage"] = "play"
        r["start"] = time.time() + COUNTDOWN
        for p in r["players"].values():
            p["s"] = 0
            p["pos"] = None
        self.hurry_at = None
        self.room.cancel(self.timer)
        self.timer = self.room.later(COUNTDOWN + HOLE_LIMIT, self.end_hole)
        self.broadcast("hole", hole=r["hole"], countdown=COUNTDOWN, round=self.round_public())
        if self.everyone_done():     # nobody here to play it
            self.room.cancel(self.timer)
            self.timer = self.room.later(COUNTDOWN + 1, self.end_hole)

    def holed(self, m, msg, cheat=False):
        r = self.round
        p = r["players"].get(m.uid)
        i = r["hole"]
        if not p or r["stage"] != "play" or msg.get("hole") != i or p["scores"][i] is not None:
            return False
        strokes = msg.get("strokes")
        picked = bool(msg.get("picked"))
        played = time.time() - r["start"]
        ok = isinstance(strokes, int) and not isinstance(strokes, bool) and 1 <= strokes <= MAX_STROKES
        if ok and picked and strokes != MAX_STROKES:
            ok = False
        if ok and not cheat and played < STROKE_SECONDS * strokes:
            ok = False       # faster than the ball could have rolled
        if not ok:
            self.send(m, "toast", text="That score didn't look right, so it doesn't count 🤔")
            return False
        p["scores"][i] = strokes
        p["how"][i] = "picked" if picked else ("ace" if strokes == 1 else "holed")
        p["s"] = strokes
        self.broadcast("done", id=m.uid, hole=i, strokes=strokes, picked=picked)
        if self.everyone_done():
            self.room.cancel(self.timer)
            self.timer = self.room.later(1.5, self.end_hole)
        elif self.hurry_at is None:
            self.hurry_at = time.time() + HURRY_SECONDS
            self.room.cancel(self.timer)
            self.timer = self.room.later(HURRY_SECONDS, self.end_hole)
            self.broadcast("hurry", seconds=HURRY_SECONDS)
        return True

    def everyone_done(self):
        r = self.round
        for uid, p in r["players"].items():
            mm = self.room.members.get(uid)
            if mm and mm.online and p["scores"][r["hole"]] is None:
                return False
        return True

    def on_offline(self, m):
        if self.phase == "playing" and self.round and self.round["stage"] == "play" and self.everyone_done():
            self.room.cancel(self.timer)
            self.timer = self.room.later(1.0, self.end_hole)

    on_leave = on_offline

    def end_hole(self):
        r = self.round
        if self.phase != "playing" or not r or r["stage"] != "play":
            return
        self.room.cancel(self.timer)
        i = r["hole"]
        for p in r["players"].values():
            if p["scores"][i] is None:
                p["scores"][i] = MAX_STROKES
                p["how"][i] = "dnf"
        r["stage"] = "card"
        self.hurry_at = None
        last = i + 1 >= r["holes"]
        self.broadcast("holeEnd", hole=i, last=last, next=None if last else BETWEEN, round=self.round_public())
        if last:
            self.timer = self.room.later(3.0, self.end_game)
        else:
            self.timer = self.room.later(BETWEEN, self.next_hole)

    def end_game(self):
        r = self.round
        if self.phase != "playing" or not r:
            return
        self.room.cancel(self.timer)
        self.phase = "results"
        name, pars = COURSES[r["course"]]
        par = sum(pars[:r["holes"]])
        rows = []
        for uid, p in r["players"].items():
            mm = self.room.members.get(uid)
            scores = [s if s is not None else MAX_STROKES for s in p["scores"]]
            rows.append({"id": uid, "name": mm.name if mm else "Gone", "avatar": mm.avatar if mm else "👻",
                         "color": mm.color if mm else "#888888", "scores": scores, "how": p["how"],
                         "total": sum(scores), "par": sum(scores) - par,
                         "aces": sum(1 for h in p["how"] if h == "ace"),
                         "holed": sum(1 for h in p["how"] if h in ("ace", "holed"))})
        rows.sort(key=lambda x: (x["total"], -x["aces"]))
        place = 0
        for k, row in enumerate(rows):
            if k == 0 or row["total"] != rows[k - 1]["total"]:
                place = k + 1
            row["place"] = place
        self.results = {"course": r["course"], "holes": r["holes"], "pars": pars[:r["holes"]], "rows": rows}
        top = [x for x in rows if x["place"] == 1]
        if len(rows) >= 2 and len(top) == 1:
            self.wins[top[0]["id"]] = self.wins.get(top[0]["id"], 0) + 1
        self.broadcast("results", results=self.results, wins=self.wins)
        self.save_results(rows, r, name)

    def save_results(self, rows, r, name):
        n = len(rows)
        self.finished(self.groups_by(rows, "total"))
        top = [x for x in rows if x["place"] == 1]
        for row in rows:
            if n < 2:
                outcome = "play"
            elif row["place"] == 1:
                outcome = "win" if len(top) == 1 else "draw"
            else:
                outcome = "loss"
            stats = {"golf.games": ("add", 1), "golf.holes": ("add", row["holed"])}
            if outcome == "win":
                stats["golf.wins"] = ("add", 1)
            if row["aces"]:
                stats["golf.aces"] = ("add", row["aces"])
            if r["holes"] == 9:
                stats["golf.best"] = ("min", row["total"])
                if r["course"] == "spooky" and all(h in ("ace", "holed", "picked") for h in row["how"]):
                    stats["golf.spooky_done"] = ("add", 1)
            diff = row["par"]
            vs = "E" if diff == 0 else f"{diff:+d}"
            detail = f"#{row['place']} of {n} · {row['total']} strokes ({vs}) · {name} · {r['holes']} holes"
            self.record(row["id"], outcome, stats, detail)

    def restart(self, host):
        if self.phase != "playing":
            self.start()

    def on_admin(self, m, action, msg):
        r = self.round
        if action == "ace" and self.phase == "playing" and r and r["stage"] == "play":
            p = r["players"].get(m.uid)
            if p and p["scores"][r["hole"]] is None:
                self.send(m, "ace", hole=r["hole"])
                self.holed(m, {"hole": r["hole"], "strokes": 1}, cheat=True)
                return "⛳ Hole in one! What a shot."
        if action == "end" and self.phase == "playing" and r and r["stage"] == "play":
            self.end_hole()
            return "🏁 Hole ended."
        return None
