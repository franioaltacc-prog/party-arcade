"""Motocross: 2–6 riders race the same track at once.

Everyone presses Ready in the lobby; when the whole room is ready the race starts after a 3-2-1
countdown. Each browser rides its own bike (public/js/games/moto/) and sends where it is (in 3D, and how far
along the track) a few times a second; the server passes that on so everyone sees the others as see-through bikes, keeps the live
order, checks finish times, decides the places and saves the results. The tracks are data
(public/js/games/moto/tracks.json), so a track added there can be raced here too."""
import json
import random
import time
from pathlib import Path

from ..base import Game, num

TRACKS_FILE = Path(__file__).resolve().parents[2] / "public" / "js" / "games" / "moto" / "tracks.json"


def load_tracks():
    try:
        tracks = json.loads(TRACKS_FILE.read_text(encoding="utf-8"))["tracks"]
    except (OSError, ValueError, KeyError):
        return {}
    return {t["id"]: t for t in tracks if t.get("robot")}


TRACKS = load_tracks()
MIN_PLAYERS = 2
COUNTDOWN = 4.0        # seconds from "go" to the gate dropping (the clients show 3-2-1)
HURRY_SECONDS = 30     # once someone finishes, the others have this long
FASTEST = 0.7          # nobody beats the robot rider's time by more than 30%


class Moto(Game):
    key = "moto"
    max_players = 6

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"track": next(iter(TRACKS), "desert")}
        self.ready = {}
        self.race = None
        self.results = None
        self.wins = {}
        self.end_timer = None
        self.start_timer = None
        self.hurry_at = None

    def listed(self):
        return self.phase in ("lobby", "results")

    # -- state -----------------------------------------------------------------
    def race_public(self):
        if not self.race:
            return None
        r = self.race
        return {"id": r["id"], "track": r["track"], "elapsed": time.time() - r["start"], "runners": r["runners"]}

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "ready": self.ready, "race": self.race_public(),
                "results": self.results, "wins": self.wins, "min": MIN_PLAYERS}

    def push_lobby(self):
        self.broadcast("lobby", settings=self.settings, ready=self.ready, phase=self.phase)

    # -- messages --------------------------------------------------------------
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase != "racing":
            tr = msg.get("track")
            if tr == "random" or tr in TRACKS:
                self.settings["track"] = tr
            self.push_lobby()
        elif t == "ready" and self.phase in ("lobby", "results") and m.plays:
            self.ready[m.uid] = bool(msg.get("ready"))
            self.push_lobby()
            self.maybe_start()
        elif t == "start" and host and self.phase in ("lobby", "results"):
            # the host can start once everyone has readied up (the race also starts by itself then)
            if not self.maybe_start():
                m.send("error", msg=self.not_ready_reason())
        elif t == "stop" and host and self.phase == "racing":
            self.end()
        elif t == "pos" and self.phase == "racing":
            self.position(m, msg)
        elif t == "finish" and self.phase == "racing":
            self.finish(m, msg)

    def restart(self, host):
        """The room voted "play again": that counts as everyone readying up, so the next race starts."""
        if self.phase not in ("lobby", "results"):
            return
        for u in self.riders():
            self.ready[u.uid] = True
        self.push_lobby()
        if not self.maybe_start():
            host.send("error", msg=self.not_ready_reason())

    def riders(self):
        return [u for u in self.room.players_now() if u.online]

    def not_ready_reason(self):
        riders = self.riders()
        if len(riders) < MIN_PLAYERS:
            return f"You need at least {MIN_PLAYERS} riders to race (or ride solo)!"
        waiting = [u.name for u in riders if not self.ready.get(u.uid)]
        return "Waiting for " + ", ".join(waiting[:3]) + (" and more" if len(waiting) > 3 else "") + " to get ready."

    def maybe_start(self):
        riders = self.riders()
        if self.phase in ("lobby", "results") and len(riders) >= MIN_PLAYERS and all(self.ready.get(u.uid) for u in riders):
            self.start()
            return True
        return False

    def restart(self, host):
        """Party mode and the "play again?" vote skip the ready-up."""
        if self.phase != "racing" and len(self.riders()) >= MIN_PLAYERS:
            self.start()

    def start(self):
        track = self.settings["track"]
        if track == "random" or track not in TRACKS:
            track = random.choice(list(TRACKS))
        self.phase = "racing"
        self.results = None
        self.tainted = False
        self.ready = {}
        runners = {u.uid: {"done": False, "time": None, "place": None, "x": 0.0, "cp": -1, "crashes": 0, "flips": 0}
                   for u in self.riders()}
        self.race = {"id": (self.race["id"] + 1) if self.race else 1, "track": track,
                     "start": time.time() + COUNTDOWN, "runners": runners, "finished": 0}
        self.broadcast("start", race=self.race_public(), countdown=COUNTDOWN)
        self.room.cancel(self.end_timer)
        self.end_timer = self.room.later(COUNTDOWN + TRACKS[track]["robot"] * 4 + 60, self.end)
        self.hurry_at = None

    def position(self, m, msg):
        run = self.race["runners"].get(m.uid)
        if not run or run["done"]:
            return
        run["x"] = round(num(msg.get("x"), run["x"], -50, 5000), 1)
        run["cp"] = int(num(msg.get("cp"), run["cp"], -1, 50))
        # x: how far along the track; px/pz/h: where the bike is (seen from above) and which way it points;
        # the rest is its pose: height, pitch, rider, suspension, lean, roll and speed
        out = {k: round(num(msg.get(k), 0, -1e4, 1e4), 3) for k in ("px", "pz", "h", "ro", "y", "a", "rx", "ry", "c0", "c1", "l", "s")}
        out["x"] = run["x"]
        out["r"] = int(num(msg.get("r"), 1700, 0, 16000))
        out["th"] = round(num(msg.get("th"), 0, 0, 1), 2)
        out["k"] = 1 if msg.get("k") else 0
        out["b"] = 1 if msg.get("b") else 0
        rg = msg.get("rg")
        if out["k"] and isinstance(rg, list) and len(rg) == 4:
            out["rg"] = [round(num(v, 0, -1e4, 1e4), 2) for v in rg]
        self.room.broadcast("g:pos", exclude=m.uid, id=m.uid, **out)

    def finish(self, m, msg):
        r = self.race
        run = r["runners"].get(m.uid)
        if not run or run["done"]:
            return
        track = TRACKS[r["track"]]
        ms = int(num(msg.get("time"), 0, 0, 3_600_000))
        raced = time.time() - r["start"]
        cps = int(num(msg.get("cp"), -1, -1, 50))
        # a time faster than anyone can ride, or longer than the race has been on, isn't real (a shorter one is
        # fine: a browser that paused in the background stops the bike and its clock together)
        if ms < track["robot"] * FASTEST * 1000 or ms / 1000 > raced + 3 or ms / 1000 < raced - 120 or cps < 0:
            self.send(m, "toast", text="That time didn't look right, so it doesn't count 🤔")
            return
        r["finished"] += 1
        run.update(done=True, x=run["x"], place=r["finished"], time=ms,
                   crashes=int(num(msg.get("crashes"), 0, 0, 999)), flips=int(num(msg.get("flips"), 0, 0, 60)))
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
        self.ready.pop(m.uid, None)
        if self.phase == "racing" and self.everyone_done():
            self.room.cancel(self.end_timer)
            self.end_timer = self.room.later(1.0, self.end)
        elif self.phase in ("lobby", "results"):
            self.push_lobby()
            self.maybe_start()

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
        rows.sort(key=lambda r: (not r["done"], r["place"] or 0, -r["x"]))
        self.results = {"track": self.race["track"], "rows": rows}
        self.broadcast("results", results=self.results, wins=self.wins)
        self.push_lobby()
        self.save_results(rows)

    def save_results(self, rows):
        n = len(rows)
        self.finished([[r["id"]] for r in rows])
        track = TRACKS[self.race["track"]]
        for r in rows:
            won = n >= 2 and r["done"] and r["place"] == 1
            stats = {"moto.races": ("add", 1)}
            if r["flips"]:
                stats["moto.flips"] = ("add", r["flips"])
            if won:
                stats["moto.wins"] = ("add", 1)
            if r["done"]:
                stats["moto.finishes"] = ("add", 1)
                stats[f"moto{track['id']}.best"] = ("min", r["time"])
                if n >= 2 and r["place"] <= 3:
                    stats["moto.podiums"] = ("add", 1)
                detail = f"#{r['place']} of {n} · {r['time'] / 1000:.2f}s · {track['name']}"
            else:
                detail = f"Didn't finish · {track['name']}"
            outcome = "win" if won else ("loss" if n >= 2 else "play")
            self.record(r["id"], outcome, stats, detail, xp=40 if won else 20 if r["done"] else 12)

    def on_admin(self, m, action, msg):
        if action == "end" and self.phase == "racing":
            self.end()
            return "🏁 Race ended."
        return None
