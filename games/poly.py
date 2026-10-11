import random
import time

from .base import Game, num

# track id -> (name, the autopilot's time in seconds, checkpoints) — must match public/js/games/poly-core.js
TRACKS = {1: ("First Lap", 26.9, 4), 2: ("Hill Climb", 26.9, 5), 3: ("Hairpins", 32.9, 5),
          4: ("Big Air", 23.5, 5), 5: ("Sky Highway", 23.6, 5), 6: ("Chaos", 29.7, 6)}
COUNTDOWN = 3.5
HURRY_SECONDS = 30
FASTEST = 0.75       # nobody can beat the autopilot's time by more than this much


class Poly(Game):
    """Poly Racer: everyone drives the same low-poly track at once and sees the others as ghost
    cars. Each browser runs its own car; the server relays positions and decides the places."""

    key = "poly"
    max_players = 10

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"track": 1}
        self.race = None
        self.results = None
        self.wins = {}
        self.end_timer = None
        self.hurry_at = None

    def listed(self):
        return self.phase in ("lobby", "results")

    def race_public(self):
        if not self.race:
            return None
        r = self.race
        return {"id": r["id"], "track": r["track"], "elapsed": time.time() - r["start"], "runners": r["runners"]}

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "race": self.race_public(),
                "results": self.results, "wins": self.wins}

    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase != "racing":
            tr = msg.get("track")
            if tr == "random" or (isinstance(tr, int) and tr in TRACKS):
                self.settings["track"] = tr
            self.broadcast("settings", settings=self.settings)
        elif t == "start" and host and self.phase != "racing":
            self.start()
        elif t == "stop" and host and self.phase == "racing":
            self.end()
        elif t == "pos" and self.phase == "racing":
            run = self.race["runners"].get(m.uid)
            if not run or run["done"]:
                return
            run["p"] = num(msg.get("p"), 0, 0, 1)
            run["cp"] = int(num(msg.get("cp"), 0, 0, 20))
            self.room.broadcast("g:pos", exclude=m.uid, id=m.uid,
                                x=round(num(msg.get("x")), 2), y=round(num(msg.get("y")), 2), z=round(num(msg.get("z")), 2),
                                r=round(num(msg.get("r")), 3), v=round(num(msg.get("v"), 0, -100, 200), 1), p=run["p"])
        elif t == "finish" and self.phase == "racing":
            self.finish(m, msg)

    def start(self):
        track = self.settings["track"]
        if track == "random":
            track = random.choice(list(TRACKS))
        self.phase = "racing"
        self.results = None
        self.tainted = False
        runners = {u.uid: {"done": False, "time": None, "place": None, "p": 0.0, "cp": 0} for u in self.room.players_now()}
        self.race = {"id": (self.race["id"] + 1) if self.race else 1, "track": track,
                     "start": time.time() + COUNTDOWN, "runners": runners, "finished": 0}
        self.broadcast("start", race=self.race_public(), countdown=COUNTDOWN)
        self.room.cancel(self.end_timer)
        self.end_timer = self.room.later(COUNTDOWN + TRACKS[track][1] * 4 + 60, self.end)
        self.hurry_at = None

    def finish(self, m, msg):
        r = self.race
        run = r["runners"].get(m.uid)
        if not run or run["done"]:
            return
        ms = int(num(msg.get("time"), 0, 0, 3_600_000))
        name, author, cps = TRACKS[r["track"]]
        raced = time.time() - r["start"]
        # a time faster than possible, or faster than the race has been going, isn't real
        if ms < author * FASTEST * 1000 or ms / 1000 > raced + 2 or ms / 1000 < raced - 15:
            self.send(m, "toast", text="That time didn't look right, so it doesn't count 🤔")
            return
        r["finished"] += 1
        run.update(done=True, p=1.0, place=r["finished"], time=ms, respawns=int(num(msg.get("respawns"), 0, 0, 999)))
        self.broadcast("finish", id=m.uid, place=run["place"], time=ms)
        if run["place"] == 1:
            self.wins[m.uid] = self.wins.get(m.uid, 0) + 1
        if self.everyone_done():
            self.room.cancel(self.end_timer)
            self.end_timer = self.room.later(1.5, self.end)
        elif self.hurry_at is None:
            self.hurry_at = time.time() + HURRY_SECONDS
            self.room.cancel(self.end_timer)
            self.end_timer = self.room.later(HURRY_SECONDS, self.end)
            self.broadcast("hurry", seconds=HURRY_SECONDS)

    def everyone_done(self):
        for uid, run in self.race["runners"].items():
            mm = self.room.members.get(uid)
            if mm and mm.online and not run["done"]:
                return False
        return True

    def on_offline(self, m):
        if self.phase == "racing" and self.everyone_done():
            self.room.cancel(self.end_timer)
            self.end_timer = self.room.later(1.0, self.end)

    on_leave = on_offline

    def end(self):
        if self.phase != "racing":
            return
        self.room.cancel(self.end_timer)
        self.phase = "results"
        rows = []
        for uid, run in self.race["runners"].items():
            mm = self.room.members.get(uid)
            rows.append({"id": uid, "name": mm.name if mm else "Gone", "avatar": mm.avatar if mm else "👻",
                         "color": mm.color if mm else "#888888", **run})
        rows.sort(key=lambda r: (not r["done"], r["place"] or 0, -r["p"]))
        self.results = {"track": self.race["track"], "rows": rows}
        self.broadcast("results", results=self.results, wins=self.wins)
        self.save_results(rows)

    def save_results(self, rows):
        n = len(rows)
        self.finished([[r["id"]] for r in rows])
        name = TRACKS[self.race["track"]][0]
        for r in rows:
            won = n >= 2 and r["done"] and r["place"] == 1
            stats = {"poly.races": ("add", 1)}
            if won:
                stats["poly.wins"] = ("add", 1)
            if r["done"]:
                stats["poly.finishes"] = ("add", 1)
                if n >= 2 and r["place"] <= 3:
                    stats["poly.podiums"] = ("add", 1)
                detail = f"#{r['place']} of {n} · {r['time'] / 1000:.2f}s · {name}"
            else:
                detail = f"Didn't finish ({round(r['p'] * 100)}%) · {name}"
            outcome = "win" if won else ("loss" if n >= 2 else "play")
            self.record(r["id"], outcome, stats, detail, xp=40 if won else 20 if r["done"] else 12)

    def on_admin(self, m, action, msg):
        if action == "end" and self.phase == "racing":
            self.end()
            return "🏁 Race ended."
        return None
