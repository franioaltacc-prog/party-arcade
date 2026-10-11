import random
import time

from .base import Game, num

DIFFICULTIES = ("easy", "normal", "hard", "insane")
LENGTHS = ("short", "medium", "long")
TIME_LIMIT = {"short": 150, "medium": 210, "long": 300}
HURRY_SECONDS = 40
COUNTDOWN = 3.5


class Dash(Game):
    """Neon Dash race: every client simulates the same seeded level; the
    server relays ghost positions and decides placements."""

    key = "dash"
    max_players = 12

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"difficulty": "normal", "length": "medium", "checkpoints": True, "modes": True}
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
        return {"id": r["id"], "seed": r["seed"], "settings": r["settings"],
                "elapsed": time.time() - r["start"], "runners": r["runners"]}

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "race": self.race_public(),
                "results": self.results, "wins": self.wins}

    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase != "racing":
            if msg.get("difficulty") in DIFFICULTIES:
                self.settings["difficulty"] = msg["difficulty"]
            if msg.get("length") in LENGTHS:
                self.settings["length"] = msg["length"]
            if "checkpoints" in msg:
                self.settings["checkpoints"] = bool(msg["checkpoints"])
            if "modes" in msg:
                self.settings["modes"] = bool(msg["modes"])
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
            run["attempts"] = int(num(msg.get("a"), 1, 1, 9999))
            self.room.broadcast("g:pos", exclude=m.uid, id=m.uid,
                                x=round(num(msg.get("x")), 3), y=round(num(msg.get("y")), 3),
                                r=round(num(msg.get("r")), 1), d=bool(msg.get("d")),
                                p=run["p"], a=run["attempts"],
                                m=msg.get("m") if msg.get("m") in ("cube", "ship", "ufo", "ball", "wave") else "cube",
                                g=-1 if msg.get("g") == -1 else 1)
        elif t == "finish" and self.phase == "racing":
            self.finish(m, msg)

    def start(self):
        self.phase = "racing"
        self.results = None
        self.tainted = False
        runners = {u.uid: {"done": False, "time": None, "place": None, "p": 0.0, "attempts": 1}
                   for u in self.room.players_now()}
        self.race = {"id": (self.race["id"] + 1) if self.race else 1,
                     "seed": random.randrange(1, 2 ** 31), "settings": dict(self.settings),
                     "start": time.time() + COUNTDOWN, "runners": runners, "finished": 0}
        self.broadcast("start", race=self.race_public(), countdown=COUNTDOWN)
        self.room.cancel(self.end_timer)
        self.end_timer = self.room.later(COUNTDOWN + TIME_LIMIT[self.settings["length"]], self.end)
        self.hurry_at = None

    def finish(self, m, msg):
        run = self.race["runners"].get(m.uid)
        if not run or run["done"]:
            return
        self.race["finished"] += 1
        run.update(done=True, p=1.0, place=self.race["finished"],
                   time=int(num(msg.get("time"), 0, 0, 3_600_000)),
                   attempts=int(num(msg.get("attempts"), 1, 1, 9999)))
        self.broadcast("finish", id=m.uid, place=run["place"], time=run["time"], attempts=run["attempts"])
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
            rows.append({"id": uid, "name": mm.name if mm else "Gone",
                         "avatar": mm.avatar if mm else "👻", "color": mm.color if mm else "#888888",
                         **run})
        rows.sort(key=lambda r: (not r["done"], r["place"] or 0, -r["p"]))
        self.results = rows
        self.broadcast("results", results=rows, wins=self.wins)
        self.save_results(rows)

    def save_results(self, rows):
        n = len(rows)
        self.finished([[r["id"]] for r in rows])
        level = f"{self.race['settings']['difficulty']} {self.race['settings']['length']}"
        for r in rows:
            won = n >= 2 and r["done"] and r["place"] == 1
            stats = {"dash.races": ("add", 1)}
            if won:
                stats["dash.wins"] = ("add", 1)
            if r["done"]:
                stats["dash.finishes"] = ("add", 1)
                if n >= 2 and r["place"] <= 3:
                    stats["dash.podiums"] = ("add", 1)
                detail = f"#{r['place']} of {n} · {r['time'] / 1000:.2f}s · {level}"
            else:
                detail = f"Didn't finish ({round(r['p'] * 100)}%) · {level}"
            outcome = "win" if won else ("loss" if n >= 2 else "play")
            self.record(r["id"], outcome, stats, detail, xp=40 if won else 20 if r["done"] else 12)

    def on_admin(self, m, action, msg):
        if action == "god":
            return "😇 God mode: spikes can't hurt you this race."
        if action == "skip":
            return "⏩ Skipping you to the finish line!"
        return None
