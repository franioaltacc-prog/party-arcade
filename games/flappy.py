"""Flappy Royale (Neon Flappy online).

Everyone flies the same seeded level at the same moment. Each browser runs its own bird and sends
its height ~15 times a second (relayed to the others as ghost birds) and, when it crashes, its
score and how long it flew. Last bird flying wins the round; places go by score, then flight time.
A game is 1, 3 or 5 rounds; each round's places turn into points.

The pipes come at a fixed rate, so the server knows the best score anyone could have after
t seconds — the same numbers as public/js/games/flappy-core.js (keep them in sync)."""
import math
import random
import time

from .base import Game, num

# must match P in public/js/games/flappy-core.js
V0, VMAX, ACC = 165, 215, 1.0
SPACING, FIRST, RAMP_AT = 230, 460, 20
TR = (FIRST + RAMP_AT * SPACING) / V0       # when the bird reaches pipe 20 and starts speeding up
TA = (VMAX - V0) / ACC

ROUNDS = (1, 3, 5)
COUNTDOWN = 3.0
CAP = 150            # a round ends after this many seconds of flying, even if birds are still up
ROUND_GAP = 6.0      # seconds of results between rounds
STALE = 6.0          # a bird we haven't heard from for this long has crashed
SLACK = 1.5          # seconds of network delay we forgive
POINTS = (5, 3, 2)   # round places -> points (everyone else who flew gets 1)
SKINS = ("classic", "robot", "ghost", "golden")


def bird_x(t):
    """The bird's world x after flying t seconds."""
    if t <= 0:
        return 0.0
    if t <= TR:
        return V0 * t
    u = min(t - TR, TA)
    x = V0 * TR + V0 * u + 0.5 * ACC * u * u
    if t - TR > TA:
        x += VMAX * (t - TR - TA)
    return x


def passed(t):
    """The best possible score after flying t seconds."""
    x = bird_x(t)
    return 0 if x < FIRST else math.floor((x - FIRST) / SPACING) + 1


class Flappy(Game):
    key = "flappy"
    max_players = 12

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"rounds": 3}
        self.settings_now = dict(self.settings)   # the settings of the game being played
        self.round = None        # {"n", "seed", "start", "runners": {uid: run}}
        self.totals = {}         # uid -> points this game
        self.best = {}           # uid -> best round score this game
        self.round_rows = None   # the last round's results
        self.results = None      # the whole game's results
        self.timer = None
        self.ticker = None
        self.game_id = 0

    def listed(self):
        return self.phase in ("lobby", "results")

    # ------------------------------------------------------------------ state
    def elapsed(self):
        return time.time() - self.round["start"] if self.round else 0.0

    def look(self, uid):
        mm = self.room.members.get(uid)
        return {"name": mm.name if mm else "Gone", "avatar": mm.avatar if mm else "👻", "color": mm.color if mm else "#888888"}

    def runners_public(self):
        return {uid: {"alive": r["alive"], "score": r["score"], "ft": round(r["t"], 2), "skin": r["skin"]}
                for uid, r in self.round["runners"].items()}

    def round_public(self):
        if not self.round:
            return None
        r = self.round
        return {"n": r["n"], "rounds": self.settings_now["rounds"], "seed": r["seed"], "elapsed": round(self.elapsed(), 3),
                "cap": CAP, "runners": self.runners_public(), "over": r["over"]}

    def standings(self):
        rows = [{"id": uid, **self.look(uid), "points": pts, "best": self.best.get(uid, 0)} for uid, pts in self.totals.items()]
        rows.sort(key=lambda r: (-r["points"], -r["best"]))
        return rows

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "round": self.round_public(),
                "standings": self.standings() if self.totals else [], "roundRows": self.round_rows,
                "results": self.results, "gameId": self.game_id}

    # ------------------------------------------------------------------ messages
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase != "playing":
            rounds = num(msg.get("rounds"), -1)
            if rounds in ROUNDS:            # 3, 3.0, "3.0" and "1e0" are fine; 3.5 is not
                self.settings["rounds"] = int(rounds)
            self.broadcast("settings", settings=self.settings)
        elif t == "start" and host and self.phase != "playing":
            self.start()
        elif t == "stop" and host and self.phase == "playing":
            self.end_game()
        elif t == "pos" and self.phase == "playing" and self.round and not self.round["over"]:
            self.pos(m, msg)
        elif t == "die" and self.phase == "playing" and self.round and not self.round["over"]:
            self.die(m, msg)

    def pos(self, m, msg):
        run = self.round["runners"].get(m.uid)
        if not run or not run["alive"]:
            return
        el = self.elapsed()
        if el < -0.5:
            return
        run["seen"] = time.time()
        run["score"] = int(num(msg.get("s"), 0, 0, passed(el + SLACK)))
        run["t"] = max(0.0, min(el + SLACK, num(msg.get("ft"), 0, 0, CAP + 5)))
        if msg.get("k") in SKINS:
            run["skin"] = msg["k"]
        self.room.broadcast("g:pos", exclude=m.uid, id=m.uid, y=round(num(msg.get("y"), 270, -60, 600), 1),
                            v=round(num(msg.get("v"), 0, -900, 900)), s=run["score"], ft=round(run["t"], 2), k=run["skin"])

    def die(self, m, msg):
        run = self.round["runners"].get(m.uid)
        if not run or not run["alive"]:
            return
        el = self.elapsed()
        score = num(msg.get("score"), -1)
        flew = num(msg.get("ft"), -1)
        # a flight longer than the round has been going, or more pipes than anyone could pass in it, isn't real
        if score < 0 or score != int(score) or flew < 0 or flew > el + SLACK or score > passed(flew + 0.25):
            self.send(m, "toast", text="That score didn't look right, so it doesn't count 🤔")
            return
        self.crash(m.uid, int(score), min(flew, el + SLACK))

    def crash(self, uid, score, flew):
        run = self.round["runners"][uid]
        run.update(alive=False, score=score, t=round(flew, 3), seen=time.time())
        self.best[uid] = max(self.best.get(uid, 0), score)
        self.broadcast("die", id=uid, score=score, ft=run["t"])
        alive = [u for u, r in self.round["runners"].items() if r["alive"]]
        if not alive:
            self.room.cancel(self.timer)
            self.timer = self.room.later(1.0, self.end_round)
        elif len(alive) == 1 and len(self.round["runners"]) >= 2 and not self.round.get("last"):
            self.round["last"] = alive[0]
            self.broadcast("last", id=alive[0])

    # ------------------------------------------------------------------ flow
    def start(self):
        if not self.room.players_now():
            return
        self.tainted = False
        self.game_id += 1
        self.settings_now = dict(self.settings)
        self.totals, self.best = {}, {}
        self.results = None
        self.round_rows = None
        self.round = None
        self.phase = "playing"
        self.start_round(1)

    def start_round(self, n):
        players = self.room.players_now()
        if not players:
            self.end_game()
            return
        now = time.time()
        runners = {}
        for mm in players:
            self.totals.setdefault(mm.uid, 0)
            runners[mm.uid] = {"alive": True, "score": 0, "t": 0.0, "seen": now + COUNTDOWN, "skin": "classic", "god": False, "place": None}
        self.round = {"n": n, "seed": random.randrange(1, 2 ** 31), "start": now + COUNTDOWN, "runners": runners, "over": False}
        self.round_rows = None
        self.broadcast("round", round=self.round_public(), countdown=COUNTDOWN, standings=self.standings())
        self.room.cancel(self.timer)
        self.timer = self.room.later(COUNTDOWN + CAP, self.end_round)
        self.room.cancel(self.ticker)
        self.ticker = self.room.later(1.0, self.tick)

    def tick(self):
        """Once a second: birds we stopped hearing from (closed the tab, lost connection) have crashed."""
        if self.phase != "playing" or not self.round or self.round["over"]:
            return
        now = time.time()
        for uid, run in list(self.round["runners"].items()):
            mm = self.room.members.get(uid)
            if run["alive"] and (not mm or not mm.online or now - run["seen"] > STALE):
                self.crash(uid, run["score"], run["t"])
        if self.round and not self.round["over"]:
            self.ticker = self.room.later(1.0, self.tick)

    def end_round(self):
        if self.phase != "playing" or not self.round or self.round["over"]:
            return
        r = self.round
        r["over"] = True
        self.room.cancel(self.timer)
        self.room.cancel(self.ticker)
        el = min(self.elapsed(), CAP)
        for uid, run in r["runners"].items():
            if run["alive"]:      # still flying at the end: their last reported score
                run["score"] = min(run["score"], passed(el + SLACK))
                run["t"] = round(el, 3)
                self.best[uid] = max(self.best.get(uid, 0), run["score"])
        rows = [{"id": uid, **self.look(uid), "score": run["score"], "ft": run["t"], "alive": run["alive"]}
                for uid, run in r["runners"].items()]
        rows.sort(key=lambda x: (-x["score"], -x["ft"]))
        groups = self.groups_by([{**x, "k": (x["score"], x["ft"])} for x in rows], "k")
        place = 1
        for g in groups:
            pts = POINTS[place - 1] if place <= len(POINTS) else 1
            for row in rows:
                if row["id"] in g:
                    row["place"], row["points"] = place, pts
                    self.totals[row["id"]] = self.totals.get(row["id"], 0) + row["points"]
            place += len(g)
        self.round_rows = rows
        last = r["n"] >= self.settings_now["rounds"]
        self.broadcast("roundover", n=r["n"], rows=rows, standings=self.standings(), next=None if last else ROUND_GAP)
        if last:
            self.timer = self.room.later(ROUND_GAP / 2, self.end_game)
        else:
            self.timer = self.room.later(ROUND_GAP, self.start_round, r["n"] + 1)

    def end_game(self):
        if self.phase != "playing":
            return
        self.room.cancel(self.timer)
        self.room.cancel(self.ticker)
        if self.round and not self.round["over"]:
            self.round["over"] = True
        self.phase = "results"
        rows = self.standings()
        self.results = {"rows": rows, "rounds": self.round["n"] if self.round else 0}
        self.broadcast("results", results=self.results)
        self.save_results(rows)

    def save_results(self, rows):
        n = len(rows)
        if not n:
            return
        top = rows[0]["points"]
        leaders = [r for r in rows if r["points"] == top]
        groups = self.groups_by(rows, "points")
        for i, r in enumerate(rows):
            if n < 2:
                outcome = "play"
            elif r["points"] == top and top > 0:
                outcome = "win" if len(leaders) == 1 else "draw"
            else:
                outcome = "loss"
            stats = {"flappy.games": ("add", 1)}
            if outcome == "win":
                stats["flappy.wins"] = ("add", 1)
            if r["best"] > 0:
                stats["flappy.best_online"] = ("max", r["best"])
            place = 1 + sum(1 for x in rows if x["points"] > r["points"])
            detail = f"#{place} of {n} · {r['points']} pts · best {r['best']} pipe{'s' if r['best'] != 1 else ''}"
            self.record(r["id"], outcome, stats, detail, xp=40 if outcome == "win" else 20 if outcome == "draw" else 12)
        self.finished(groups)

    # ------------------------------------------------------------------ people coming and going
    def on_offline(self, m):
        if self.phase == "playing" and self.round and not self.round["over"]:
            run = self.round["runners"].get(m.uid)
            if run and run["alive"]:
                self.crash(m.uid, run["score"], run["t"])

    def on_leave(self, m):
        self.on_offline(m)
        if self.phase == "playing" and not self.room.players_now():
            self.end_game()

    # ------------------------------------------------------------------ admin
    def on_admin(self, m, action, msg):
        if self.phase != "playing" or not self.round:
            return None
        if action == "god":
            run = self.round["runners"].get(m.uid)
            if not run or not run["alive"] or self.round["over"]:
                return None
            run["god"] = True
            self.send(m, "god")
            return "😇 God mode: you can't crash this round."
        if action == "end":
            if self.round["over"]:
                return None
            self.end_round()
            return "🏁 Round ended."
        return None
