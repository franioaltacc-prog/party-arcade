"""Motocross: 2–6 riders race the same track at once (or ride a free-ride world together).

Everyone presses Ready in the lobby; when the whole room is ready the race starts after a 3-2-1
countdown. Each browser rides its own bike (public/js/games/moto/) and sends where it is (in 3D, and how far
along the track) a few times a second; the server passes that on so everyone sees the others as see-through bikes, keeps the live
order, checks finish times, decides the places and saves the results. The tracks are data
(public/js/games/moto/tracks.json), so a track added there can be raced here too.

Free ride together: the host picks a world and everyone rides it at once, on their dirt bike, mountain bike or supercar, with
no race and no end. People can hop in and out while it's on (and someone joining the room rides straight in);
the host ends it, or it ends when the last rider leaves."""
import json
import math
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
            if c["kind"] in ("race", "relay") and "from" in c:
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
        # (a hidden world is only for its challenge: never a room's free ride)
        return [w["id"] for w in json.loads((WORLD_DIR / "manifest.json").read_text(encoding="utf-8"))["worlds"] if not w.get("hidden")]
    except (OSError, ValueError, KeyError):
        return []


WORLDS = load_worlds()
TOP_SCORE = {"air": 30.0, "flips": 80, "speed": 420.0, "tricks": 8000, "lanterns": 40}   # more than anyone can do with the stock engine
TAG_REACH = 4.5        # Forest Tag: how close (m) "it" has to be to tag someone (a little more than the browser asks for: lag)
TAG_IMMUNE = 3.0       # ...and the seconds before the new "it" can tag anyone (no tagging straight back)
PASS_REACH = 5.0       # Lantern Relay: how close (m) you have to be to hand the lantern to your teammate
FASTEST_MS = 105.0     # nobody crosses a challenge course quicker than this many metres a second
MIN_PLAYERS = 2
COUNTDOWN = 4.0        # seconds from "go" to the gate dropping (the clients show 3-2-1)
HURRY_SECONDS = 30     # once someone finishes, the others have this long
FASTEST = 0.7          # nobody beats the robot rider's time by more than 30%


def clean_style(st):
    """Someone's bike style, rider, rider kit, helmet and race number, tidied up (the browser draws whatever ids it knows)."""
    st = st if isinstance(st, dict) else {}
    out = {}
    for k in ("model", "rider", "kit", "helmet", "car", "paint", "mtb", "mrider", "cgear"):   # (car and paint: the free-ride supercar; mtb, mrider: the mountain bike and its rider)
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
            if r["kind"] == "tag":
                out.update(it=r["it"], itTimes=self.it_times())
            if r["kind"] == "relay":
                out.update(teams=r["teams"], carrier=r["carrier"], leg=r["leg"])
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
        elif t == "tag" and self.phase == "racing":
            self.tag(m, msg)
        elif t == "pass" and self.phase == "racing":
            self.pass_lantern(m, msg)

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
        if c["kind"] == "relay":   # Lantern Relay: two teams (one, riding alone), each passing its lantern down the chute
            ids = list(runners)
            teams = {str(t): ids[t::2] for t in range(2 if len(ids) > 1 else 1)}
            self.race.update(teams=teams, carrier={t: v[0] for t, v in teams.items()}, leg={t: 0 for t in teams}, team_place=0)
        if c["kind"] == "tag":   # Forest Tag: someone starts as "it"
            self.race.update(it=random.choice(list(runners)) if runners else None, it_since=self.race["start"], it_time={uid: 0.0 for uid in runners},
                             immune=self.race["start"] + TAG_IMMUNE)
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
        v = int(v) if kind in ("flips", "tricks", "lanterns") else round(v, 2)
        if run["score"] is None or v > run["score"]:
            run["score"] = v
            if kind == "flips":
                run["flips"] = v
            self.broadcast("score", id=m.uid, score=v)

    def it_times(self, now=None):
        """Forest Tag: how long (s) each rider has been "it" so far."""
        r = self.race
        out = dict(r["it_time"])
        if r.get("it") in out:
            out[r["it"]] += max(0.0, min(now or time.time(), r["start"] + r["limit"]) - max(r["it_since"], r["start"]))
        return {k: round(v, 1) for k, v in out.items()}

    def tag(self, m, msg):
        """Forest Tag: "it" rode into someone (checked against where both of them last said they were)."""
        r = self.race
        now = time.time()
        target = msg.get("id")
        if r.get("kind") != "tag" or m.uid != r.get("it") or target == m.uid or target not in r["runners"] or now < r["immune"] or now > r["start"] + r["limit"]:
            return
        a, b = r["runners"][m.uid], r["runners"][target]
        if "px" not in a or "px" not in b or math.hypot(a["px"] - b["px"], a["pz"] - b["pz"]) > TAG_REACH:
            return
        r["it_time"] = {k: v for k, v in self.it_times(now).items()}
        r.update(it=target, it_since=now, immune=now + TAG_IMMUNE)
        self.broadcast("tag", it=target, by=m.uid, itTimes=r["it_time"])

    def team_of(self, uid):
        return next((t for t, v in self.race.get("teams", {}).items() if uid in v), None)

    def pass_lantern(self, m, msg):
        """Lantern Relay: the carrier rode up to the next rider in their team (checked against where both last said
        they were), who takes the lantern on."""
        r = self.race
        t = self.team_of(m.uid)
        if r.get("kind") != "relay" or t is None or r["carrier"][t] != m.uid or time.time() < r["start"]:
            return
        team, leg = r["teams"][t], r["leg"][t]
        target = msg.get("id")
        if leg + 1 >= len(team) or team[leg + 1] != target:
            return
        a, b = r["runners"][m.uid], r["runners"][target]
        if "px" not in a or "px" not in b or math.hypot(a["px"] - b["px"], a["pz"] - b["pz"]) > PASS_REACH:
            return
        r["carrier"][t], r["leg"][t] = target, leg + 1
        self.broadcast("relay", team=t, carrier=target, by=m.uid, leg=leg + 1)

    def relay_finish(self, m, msg):
        """Lantern Relay: the last rider of a team brought the lantern to the bottom: the whole team is done."""
        r = self.race
        t = self.team_of(m.uid)
        if t is None or r["carrier"][t] != m.uid or r["leg"][t] != len(r["teams"][t]) - 1 or r["runners"][m.uid]["done"]:
            return
        ms = int(num(msg.get("time"), 0, 0, 3_600_000))
        raced = time.time() - r["start"]
        c = CHALLENGES.get(r["challenge"], {})
        if ms < c.get("dist", 0) / FASTEST_MS * 1000 or ms / 1000 > raced + 3 or ms / 1000 < raced - 120:
            self.send(m, "toast", text="That time didn't look right, so it doesn't count 🤔")
            return
        r["team_place"] += 1
        for uid in r["teams"][t]:
            r["runners"][uid].update(done=True, place=r["team_place"], time=ms)
            r["finished"] += 1
            self.broadcast("finish", id=uid, place=r["team_place"], time=ms)
        if r["team_place"] == 1:
            for uid in r["teams"][t]:
                self.wins[uid] = self.wins.get(uid, 0) + 1
        if self.everyone_done():
            self.room.cancel(self.end_timer)
            self.end_timer = self.room.later(1.5, self.end)

    def position(self, m, msg):
        run = self.race["runners"].get(m.uid)
        if not run or run["done"]:
            return
        run["x"] = round(num(msg.get("x"), run["x"], -50, 5000), 1)
        run["px"], run["pz"] = num(msg.get("px"), 0, -1e4, 1e4), num(msg.get("pz"), 0, -1e4, 1e4)   # (where they are: for Forest Tag)
        run["cp"] = int(num(msg.get("cp"), run["cp"], -1, 50))
        # x: how far along the track; px/pz/h: where the bike is (seen from above) and which way it points;
        # the rest is its pose: height, pitch, rider, suspension, lean, roll and speed
        out = {k: round(num(msg.get(k), 0, -1e4, 1e4), 3) for k in ("px", "pz", "h", "ro", "y", "a", "rx", "ry", "c0", "c1", "l", "s")}
        if self.race.get("free") and msg.get("v") == 1:   # (in the supercar: its steering and the other two springs)
            out["v"] = 1
            for k in ("st", "c2", "c3"):
                out[k] = round(num(msg.get(k), 0, -2, 2), 3)
        elif (self.race.get("free") or CHALLENGES.get(self.race.get("challenge"), {}).get("vehicle") == "mtb") and msg.get("v") == 2:
            out["v"] = 2   # (on a mountain bike: free ride, or an Unrevvd challenge)
        out["x"] = run["x"]
        out["r"] = int(num(msg.get("r"), 1700, 0, 16000))
        out["th"] = round(num(msg.get("th"), 0, 0, 1), 2)
        out["k"] = 1 if msg.get("k") else 0
        out["b"] = 1 if msg.get("b") else 0
        # an air trick: which one (-1 none), how far into its pose, the whip and the 360 so far
        out["tk"] = int(num(msg.get("tk"), -1, -1, 7))
        for k, top in (("tp", 1), ("wh", 1), ("sp", 12.6)):   # (sp: a snowboard's spin goes up to a 720)
            out[k] = round(num(msg.get(k), 0, 0, top), 2)
        rg = msg.get("rg")
        if out["k"] and isinstance(rg, list) and len(rg) == 4:
            out["rg"] = [round(num(v, 0, -1e4, 1e4), 2) for v in rg]
        self.room.broadcast("g:pos", exclude=m.uid, id=m.uid, **out)

    def finish(self, m, msg):
        r = self.race
        if r.get("kind") == "relay":
            self.relay_finish(m, msg)
            return
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
        r = self.race
        if self.phase == "racing" and r and r.get("kind") == "relay" and (t := self.team_of(m.uid)) is not None and r["carrier"][t] == m.uid:
            team, leg = r["teams"][t], r["leg"][t]   # (the carrier left: the next rider in their team takes the lantern)
            if leg + 1 < len(team):
                r["carrier"][t], r["leg"][t] = team[leg + 1], leg + 1
                self.broadcast("relay", team=t, carrier=team[leg + 1], by=None, leg=leg + 1)
        if self.phase == "racing" and r and r.get("kind") == "tag" and r.get("it") == m.uid:   # ("it" left: someone else is it)
            others = [uid for uid in r["runners"] if uid != m.uid and (mm := self.room.members.get(uid)) and mm.online]
            if others:
                now = time.time()
                r["it_time"] = self.it_times(now)
                r.update(it=random.choice(others), it_since=now, immune=now + TAG_IMMUNE)
                self.broadcast("tag", it=r["it"], by=None, itTimes=r["it_time"])
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
        if kind == "tag":   # Forest Tag: the least time being "it" wins
            times = self.it_times()
            for r in rows:
                r["score"] = times.get(r["id"], 0.0)
            rows.sort(key=lambda r: r["score"])
            for i, r in enumerate(rows):
                r.update(done=True, place=i + 1 if i == 0 or r["score"] != rows[i - 1]["score"] else rows[i - 1]["place"])
        elif kind in TOP_SCORE:   # timed challenges: the best score wins (no score = last)
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
        unit = {"race": lambda r: f"{r['time'] / 1000:.2f}s", "relay": lambda r: f"{r['time'] / 1000:.2f}s as a team", "air": lambda r: f"{r['score']:.2f}s of air",
                "flips": lambda r: f"{r['score']} flips", "speed": lambda r: f"{r['score']:.0f} km/h",
                "tricks": lambda r: f"{r['score']} trick points", "lanterns": lambda r: f"{r['score']} lanterns",
                "tag": lambda r: f"{r['score']:.1f}s being it"}.get(c.get("kind"), lambda r: "")
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
