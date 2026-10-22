"""Motocross: 2–6 riders race the same track at once (or ride a free-ride world together).

Everyone presses Ready in the lobby; when the whole room is ready the race starts after a 3-2-1
countdown. Each browser rides its own bike (public/js/games/moto/) and sends where it is (in 3D, and how far
along the track) a few times a second; the server passes that on so everyone sees the others as see-through bikes, keeps the live
order, checks finish times, decides the places and saves the results. The tracks are data
(public/js/games/moto/tracks.json), so a track added there can be raced here too.

Free ride together: the host picks a world and everyone rides it at once, on their bike or in their supercar, with
no race and no end. People can hop in and out while it's on (and someone joining the room rides straight in);
the host ends it, or it ends when the last rider leaves."""
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
WORLD_DIR = TRACKS_FILE.parent / "open-world"


def load_challenges():
    """The open-world challenges, with the start-to-finish distance of the races (for checking times)."""
    try:
        data = json.loads((WORLD_DIR / "challenges.json").read_text(encoding="utf-8"))["challenges"]
    except (OSError, ValueError, KeyError):
        return {}
    out = {}
    for c in data:
        try:
            if c["kind"] == "race":
                world = json.loads((WORLD_DIR / (c["world"] + ".json")).read_text(encoding="utf-8"))
                pads = {p["id"]: p["position"] for p in world["safePads"]}
                (ax, az), (bx, bz) = pads[c["from"]], pads[c["to"]]
                c = {**c, "dist": ((ax - bx) ** 2 + (az - bz) ** 2) ** 0.5}
            out[c["id"]] = c
        except (OSError, ValueError, KeyError):
            continue
    return out


CHALLENGES = load_challenges()


def load_worlds():
    try:
        return [w["id"] for w in json.loads((WORLD_DIR / "manifest.json").read_text(encoding="utf-8"))["worlds"]]
    except (OSError, ValueError, KeyError):
        return []


WORLDS = load_worlds()
TOP_SCORE = {"air": 30.0, "flips": 80, "speed": 420.0, "tricks": 3000}   # more than anyone can do with the stock engine
FASTEST_MS = 105.0     # nobody crosses a challenge course quicker than this many metres a second
MIN_PLAYERS = 2
COUNTDOWN = 4.0        # seconds from "go" to the gate dropping (the clients show 3-2-1)
HURRY_SECONDS = 30     # once someone finishes, the others have this long
FASTEST = 0.7          # nobody beats the robot rider's time by more than 30%


def clean_style(st):
    """Someone's bike style, rider, rider kit, helmet and race number, tidied up (the browser draws whatever ids it knows)."""
    st = st if isinstance(st, dict) else {}
    out = {}
    for k in ("model", "rider", "kit", "helmet", "car", "paint"):   # (car and paint: the free-ride supercar)
        v = str(st.get(k) or "")[:12]
        if v.isalnum() and v.isascii():
            out[k] = v.lower()
    n = st.get("number")
    if isinstance(n, int) and not isinstance(n, bool) and 0 <= n <= 99:
        out["number"] = n
    return out


class Moto(Game):
    key = "moto"
    max_players = 6

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"track": next(iter(TRACKS), "desert"), "mode": "race", "challenge": next(iter(CHALLENGES), ""),
                         "world": WORLDS[0] if WORLDS else ""}
        self.ready = {}
        self.styles = {}   # uid -> how their bike and rider look (bike style, kit, helmet, number): looks only
        self.race = None
        self.results = None
        self.wins = {}
        self.end_timer = None
        self.start_timer = None
        self.hurry_at = None

    def listed(self):
        return self.phase in ("lobby", "results") or self.free_ride()   # (a free ride can be hopped into)

    def free_ride(self):
        return self.phase == "racing" and bool(self.race) and bool(self.race.get("free"))

    def min_players(self):
        return 1 if self.settings.get("mode") == "free" else MIN_PLAYERS   # (start riding, friends join in)

    # -- state -----------------------------------------------------------------
    def race_public(self):
        if not self.race:
            return None
        r = self.race
        out = {"id": r["id"], "track": r["track"], "elapsed": time.time() - r["start"], "runners": r["runners"]}
        if r.get("challenge"):
            out.update(challenge=r["challenge"], kind=r["kind"], limit=r["limit"])
        if r.get("free"):
            out.update(free=r["free"], kind="free")
        return out

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "ready": self.ready, "race": self.race_public(),
                "results": self.results, "wins": self.wins, "styles": self.styles, "min": self.min_players()}

    def push_lobby(self):
        self.broadcast("lobby", settings=self.settings, ready=self.ready, phase=self.phase, styles=self.styles, min=self.min_players())

    # -- messages --------------------------------------------------------------
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase != "racing":
            tr = msg.get("track")
            if tr == "random" or tr in TRACKS:
                self.settings["track"] = tr
            if msg.get("mode") in ("race", "challenge", "free"):
                self.settings["mode"] = msg["mode"]
            if msg.get("challenge") in CHALLENGES:
                self.settings["challenge"] = msg["challenge"]
            if msg.get("world") in WORLDS:
                self.settings["world"] = msg["world"]
            self.push_lobby()
        elif t == "ready" and self.phase in ("lobby", "results") and m.plays:
            self.ready[m.uid] = bool(msg.get("ready"))
            self.push_lobby()
            self.maybe_start()
        elif t == "start" and host and self.phase in ("lobby", "results"):
            # the host can start once everyone has readied up (the race also starts by itself then)
            if not self.maybe_start():
                m.send("error", msg=self.not_ready_reason())
        elif t == "style":
            self.styles[m.uid] = clean_style(msg.get("style"))
            self.push_lobby()
        elif t == "stop" and host and self.phase == "racing":
            self.end_free() if self.free_ride() else self.end()
        elif t == "pos" and self.phase == "racing":
            self.position(m, msg)
        elif t == "hop" and self.free_ride() and m.plays:   # hop into the free ride that's on
            self.hop_in(m)
        elif t == "part" and self.free_ride():               # ...and back out to the room
            self.hop_out(m)
        elif t == "finish" and self.phase == "racing":
            self.finish(m, msg)
        elif t == "score" and self.phase == "racing":
            self.score(m, msg)

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
        if len(riders) < self.min_players():
            return f"You need at least {MIN_PLAYERS} riders to race (or ride solo)!"
        waiting = [u.name for u in riders if not self.ready.get(u.uid)]
        return "Waiting for " + ", ".join(waiting[:3]) + (" and more" if len(waiting) > 3 else "") + " to get ready."

    def maybe_start(self):
        riders = self.riders()
        if self.phase in ("lobby", "results") and len(riders) >= self.min_players() and all(self.ready.get(u.uid) for u in riders):
            self.start()
            return True
        return False

    def restart(self, host):
        """Party mode and the "play again?" vote skip the ready-up."""
        if self.phase != "racing" and len(self.riders()) >= self.min_players():
            self.start()

    def start(self):
        if self.settings.get("mode") == "free" and self.settings.get("world") in WORLDS:
            self.start_free(self.settings["world"])
            return
        if self.settings.get("mode") == "challenge" and self.settings.get("challenge") in CHALLENGES:
            self.start_challenge(CHALLENGES[self.settings["challenge"]])
            return
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

    def start_challenge(self, c):
        """Everyone rides the same open-world challenge at once: a race to a finish pad, or the best
        score (longest jump, most flips, top speed) before the time runs out."""
        self.phase = "racing"
        self.results = None
        self.tainted = False
        self.ready = {}
        runners = {u.uid: {"done": False, "time": None, "place": None, "x": 0.0, "cp": -1, "crashes": 0, "flips": 0, "score": None}
                   for u in self.riders()}
        self.race = {"id": (self.race["id"] + 1) if self.race else 1, "track": None, "challenge": c["id"], "kind": c["kind"],
                     "limit": c["limit"], "start": time.time() + COUNTDOWN, "runners": runners, "finished": 0}
        self.broadcast("start", race=self.race_public(), countdown=COUNTDOWN)
        self.room.cancel(self.end_timer)
        self.end_timer = self.room.later(COUNTDOWN + c["limit"] + 2, self.end)
        self.hurry_at = None

    def start_free(self, world):
        """Everyone rides the same free-ride world, for as long as they like."""
        self.phase = "racing"
        self.results = None
        self.ready = {}
        runners = {u.uid: {"done": False, "time": None, "place": None, "x": 0.0, "cp": -1, "crashes": 0, "flips": 0}
                   for u in self.riders()}
        self.race = {"id": (self.race["id"] + 1) if self.race else 1, "track": None, "free": world,
                     "start": time.time(), "runners": runners, "finished": 0}
        self.broadcast("start", race=self.race_public(), countdown=0)
        self.room.cancel(self.end_timer)
        self.hurry_at = None

    def hop_in(self, m):
        runners = self.race["runners"]
        if m.uid not in runners:
            runners[m.uid] = {"done": False, "time": None, "place": None, "x": 0.0, "cp": -1, "crashes": 0, "flips": 0}
            self.broadcast("hop", id=m.uid)
        self.send(m, "start", race=self.race_public(), countdown=0)

    def hop_out(self, m):
        if self.race["runners"].pop(m.uid, None) is not None:
            self.broadcast("part", id=m.uid)
        if not any((mm := self.room.members.get(uid)) and mm.online for uid in self.race["runners"]):
            self.end_free()

    def end_free(self):
        """The free ride is over: everyone goes back to the room."""
        if not self.free_ride():
            return
        self.phase = "lobby"
        self.race = None
        self.broadcast("freeEnd")
        self.push_lobby()

    def score(self, m, msg):
        """A rider's best so far in a timed challenge (kept if it's better and believable)."""
        r = self.race
        run = r["runners"].get(m.uid)
        kind = r.get("kind")
        if not run or kind not in TOP_SCORE or time.time() < r["start"] or time.time() > r["start"] + r["limit"] + 3:
            return
        v = num(msg.get("score"), -1)
        if v <= 0 or v > TOP_SCORE[kind]:   # (more than the stock engine can do: not believable)
            return
        v = int(v) if kind in ("flips", "tricks") else round(v, 2)
        if run["score"] is None or v > run["score"]:
            run["score"] = v
            if kind == "flips":
                run["flips"] = v
            self.broadcast("score", id=m.uid, score=v)

    def position(self, m, msg):
        run = self.race["runners"].get(m.uid)
        if not run or run["done"]:
            return
        run["x"] = round(num(msg.get("x"), run["x"], -50, 5000), 1)
        run["cp"] = int(num(msg.get("cp"), run["cp"], -1, 50))
        # x: how far along the track; px/pz/h: where the bike is (seen from above) and which way it points;
        # the rest is its pose: height, pitch, rider, suspension, lean, roll and speed
        out = {k: round(num(msg.get(k), 0, -1e4, 1e4), 3) for k in ("px", "pz", "h", "ro", "y", "a", "rx", "ry", "c0", "c1", "l", "s")}
        if self.race.get("free") and msg.get("v") == 1:   # (in the supercar: its steering and the other two springs)
            out["v"] = 1
            for k in ("st", "c2", "c3"):
                out[k] = round(num(msg.get(k), 0, -2, 2), 3)
        out["x"] = run["x"]
        out["r"] = int(num(msg.get("r"), 1700, 0, 16000))
        out["th"] = round(num(msg.get("th"), 0, 0, 1), 2)
        out["k"] = 1 if msg.get("k") else 0
        out["b"] = 1 if msg.get("b") else 0
        # an air trick: which one (-1 none), how far into its pose, the whip and the 360 so far
        out["tk"] = int(num(msg.get("tk"), -1, -1, 7))
        for k, top in (("tp", 1), ("wh", 1), ("sp", 6.3)):
            out[k] = round(num(msg.get(k), 0, 0, top), 2)
        rg = msg.get("rg")
        if out["k"] and isinstance(rg, list) and len(rg) == 4:
            out["rg"] = [round(num(v, 0, -1e4, 1e4), 2) for v in rg]
        self.room.broadcast("g:pos", exclude=m.uid, id=m.uid, **out)

    def finish(self, m, msg):
        r = self.race
        run = r["runners"].get(m.uid)
        if not run or run["done"]:
            return
        ms = int(num(msg.get("time"), 0, 0, 3_600_000))
        raced = time.time() - r["start"]
        if r.get("challenge"):
            c = CHALLENGES.get(r["challenge"], {})
            fake = c.get("kind") != "race" or ms < c.get("dist", 0) / FASTEST_MS * 1000 or ms / 1000 > raced + 3 or ms / 1000 < raced - 120
        else:
            track = TRACKS[r["track"]]
            cps = int(num(msg.get("cp"), -1, -1, 50))
            # a time faster than anyone can ride, or longer than the race has been on, isn't real (a shorter one is
            # fine: a browser that paused in the background stops the bike and its clock together)
            fake = ms < track["robot"] * FASTEST * 1000 or ms / 1000 > raced + 3 or ms / 1000 < raced - 120 or cps < 0
        if fake:
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
        if self.free_ride():
            self.hop_out(m)
        elif self.phase == "racing" and self.everyone_done():
            self.room.cancel(self.end_timer)
            self.end_timer = self.room.later(1.0, self.end)
        elif self.phase in ("lobby", "results"):
            self.push_lobby()
            self.maybe_start()

    on_leave = on_offline

    def end(self):
        if self.free_ride():
            self.end_free()
            return
        if self.phase != "racing":
            return
        self.room.cancel(self.end_timer)
        self.phase = "results"
        rows = []
        for uid, run in self.race["runners"].items():
            mm = self.room.members.get(uid)
            rows.append({"id": uid, "name": mm.name if mm else "Gone", "avatar": mm.avatar if mm else "👻",
                         "color": mm.color if mm else "#888888", **run})
        kind = self.race.get("kind")
        if kind in TOP_SCORE:   # timed challenges: the best score wins (no score = last)
            rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0)))
            place = 0
            for i, r in enumerate(rows):
                if r["score"] is not None:
                    place = i + 1 if i == 0 or r["score"] != rows[i - 1]["score"] else place
                    r.update(done=True, place=place)
        else:
            rows.sort(key=lambda r: (not r["done"], r["place"] or 0, -r["x"]))
        self.results = {"track": self.race["track"], "challenge": self.race.get("challenge"), "kind": kind, "rows": rows}
        self.broadcast("results", results=self.results, wins=self.wins)
        self.push_lobby()
        self.save_results(rows)

    def save_results(self, rows):
        n = len(rows)
        self.finished([[r["id"]] for r in rows])
        if self.race.get("challenge"):
            self.save_challenge(rows)
            return
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

    def save_challenge(self, rows):
        c = CHALLENGES.get(self.race["challenge"], {"name": "Challenge"})
        n = len(rows)
        unit = {"race": lambda r: f"{r['time'] / 1000:.2f}s", "air": lambda r: f"{r['score']:.2f}s of air",
                "flips": lambda r: f"{r['score']} flips", "speed": lambda r: f"{r['score']:.0f} km/h",
                "tricks": lambda r: f"{r['score']} trick points"}.get(c.get("kind"), lambda r: "")
        for r in rows:
            won = n >= 2 and r["done"] and r["place"] == 1
            stats = {"moto.challenges": ("add", 1)}
            if won:
                stats["moto.cwins"] = ("add", 1)
            detail = f"#{r['place']} of {n} · {unit(r)} · {c['name']}" if r["done"] else f"Didn't finish · {c['name']}"
            self.record(r["id"], "win" if won else ("loss" if n >= 2 else "play"), stats, detail, xp=40 if won else 20 if r["done"] else 12)

    def on_admin(self, m, action, msg):
        if action == "end" and self.free_ride():
            self.end_free()
            return "🏁 Free ride ended."
        if action == "end" and self.phase == "racing":
            self.end()
            return "🏁 Race ended."
        return None
