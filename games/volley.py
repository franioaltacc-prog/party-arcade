"""Screen Volley: one volleyball court spread over two screens standing side by side.

Each screen runs the ball itself while the ball is on it (so hits have no lag) and tells the other screen
when and where the ball will come over the net *before* it gets there (public/js/games/volley-core.js).
The server keeps the score and decides who owns the ball: only the screen that has the ball may pass it on
("cross") or lose it ("drop"). Screens on the same Wi-Fi also try a direct connection to each other (WebRTC);
the server only passes their connection details along ("rtc")."""
import math
import time

from .base import Game, num

SIDES = ("left", "right")
TARGETS = (5, 7, 11)
LIVES = 3                 # keep-it-up mode: drops before the game ends
SERVE_DELAY = 1.6         # seconds between a point and the next serve
LOST_AFTER = 8.0          # the screen with the ball went quiet this long: the ball is lost


def now_ms():
    return time.time() * 1000


class Volley(Game):
    key = "volley"
    max_players = 12      # two players (left and right screen), everyone else watches

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"mode": "versus", "target": 7}
        self.sides = {"left": None, "right": None}
        self.reset()
        self.final = None
        self.watchdog = None
        self.serve_timer = None

    def reset(self):
        self.score = {"left": 0, "right": 0}
        self.owner = None        # side the ball is on
        self.epoch = 0           # goes up every serve and every time the ball crosses
        self.rally = 0           # crossings this rally
        self.best_rally = 0
        self.passes = 0          # keep-it-up: crossings in the whole game
        self.lives = LIVES
        self.heard = 0           # last time the owner's screen spoke up
        self.serving = "left"
        self.pending = []        # a drop that arrived before the cross that made its sender the owner

    def listed(self):
        return self.phase in ("lobby", "over") and None in self.sides.values()

    def side_of(self, uid):
        return next((s for s, u in self.sides.items() if u == uid), None)

    def other(self, side):
        return "right" if side == "left" else "left"

    # -- state ---------------------------------------------------------------
    def public(self):
        return {"phase": self.phase, "settings": self.settings, "sides": self.sides, "score": self.score,
                "owner": self.owner, "epoch": self.epoch, "rally": self.rally, "best": self.best_rally,
                "passes": self.passes, "lives": self.lives, "final": self.final}

    def state_for(self, m):
        return self.public()

    def push(self):
        self.broadcast("state", **self.public())

    # -- messages ------------------------------------------------------------
    def on_message(self, m, t, msg):
        if t == "sync":
            m.send("g:sync", c=msg.get("c"), s=now_ms())
        elif t == "side" and self.phase in ("lobby", "over"):
            want = msg.get("side")
            mine = self.side_of(m.uid)
            if want in SIDES and m.plays and self.sides[want] in (None, m.uid):
                if mine:
                    self.sides[mine] = None
                self.sides[want] = m.uid
            elif want is None and mine:
                self.sides[mine] = None
            self.push()
        elif t == "settings" and self.is_host(m) and self.phase in ("lobby", "over"):
            if msg.get("mode") in ("versus", "coop"):
                self.settings["mode"] = msg["mode"]
            target = int(num(msg.get("target"), self.settings["target"]))
            if target in TARGETS:
                self.settings["target"] = target
            self.push()
        elif t == "start" and self.is_host(m) and self.phase in ("lobby", "over"):
            if None in self.sides.values():
                m.send("error", msg="You need a player on the left screen and one on the right!")
                return
            self.start()
        elif t == "cross":
            self.cross(m, msg)
        elif t == "drop":
            self.drop(m, msg)
        elif t == "hb":
            if self.phase == "playing" and self.side_of(m.uid) == self.owner and msg.get("epoch") == self.epoch:
                self.heard = time.time()
        elif t == "rtc":
            # pass connection details to the other screen (only between the two players)
            side = self.side_of(m.uid)
            data = msg.get("data")
            if side and isinstance(data, dict) and len(str(data)) < 20000:
                other = self.sides[self.other(side)]
                if other:
                    self.room.send(other, "g:rtc", data=data)

    def start(self):
        self.reset()
        self.final = None
        self.tainted = False
        self.phase = "playing"
        self.push()
        self.serve("left")
        self.room.cancel(self.watchdog)
        self.watchdog = self.room.later(2, self.watch)

    def serve(self, side, delay=SERVE_DELAY):
        self.serving = side
        self.owner = side
        self.epoch += 1
        self.rally = 0
        self.pending = []
        at = now_ms() + delay * 1000
        self.heard = time.time() + delay + 4   # the ball floats for a moment before anyone touches it
        self.broadcast("serve", side=side, epoch=self.epoch, at=at, score=self.score, lives=self.lives)

    def cross(self, m, msg):
        """The screen with the ball says it will come over the net at server time `at`."""
        side = self.side_of(m.uid)
        if self.phase != "playing" or side != self.owner or msg.get("epoch") != self.epoch:
            return
        at = num(msg.get("at"), now_ms())
        ball = {k: num(msg.get(k), 0.0, -50, 50) for k in ("y", "vx", "vy", "a", "spin")}
        ball["d"] = num(msg.get("d"), 0.0, 0, 0.2)
        # Open sky: a lob can cross above either screen. Keep a generous finite bound
        # (ordinary capped hits peak less than 3 court-heights above the view).
        if not -4 <= ball["y"] < 0.7 or math.hypot(ball["vx"], ball["vy"]) > 6:
            return
        at = min(max(at, now_ms() - 2000), now_ms() + 3000)
        self.epoch += 1
        self.owner = self.other(side)
        self.rally += 1
        self.best_rally = max(self.best_rally, self.rally)
        if self.settings["mode"] == "coop":
            self.passes += 1
        self.heard = max(time.time(), at / 1000) + 1
        receiver = self.sides[self.owner]
        if receiver:
            self.room.send(receiver, "g:cross", epoch=self.epoch, at=at, **ball)
        self.broadcast("rally", owner=self.owner, epoch=self.epoch, rally=self.rally, passes=self.passes)
        held, self.pending = self.pending, []
        for uid, e in held:
            mm = self.room.members.get(uid)
            if mm:
                self.drop(mm, {"epoch": e})

    def drop(self, m, msg):
        """The ball hit the floor on this screen (or the screen gave up on it)."""
        side = self.side_of(m.uid)
        if self.phase != "playing" or not side:
            return
        e = msg.get("epoch")
        if side != self.owner or e != self.epoch:
            # the cross that gave this screen the ball may still be on its way here: wait for it
            if e == self.epoch + 1 and side == self.other(self.owner):
                self.pending.append((m.uid, e))
            return
        self.lose_ball(side)

    def lose_ball(self, side):
        self.owner = None
        if self.settings["mode"] == "versus":
            winner = self.other(side)
            self.score[winner] += 1
            self.broadcast("point", side=winner, lost=side, score=self.score, rally=self.rally)
            if self.score[winner] >= self.settings["target"]:
                return self.finish()
            self.serve(winner)
        else:
            self.lives -= 1
            self.broadcast("point", lost=side, lives=self.lives, rally=self.rally, passes=self.passes)
            if self.lives <= 0:
                return self.finish()
            self.serve(self.other(self.serving))

    def watch(self):
        """If the screen with the ball goes quiet (closed, asleep, lost its connection), that ball is lost."""
        if self.phase != "playing":
            return
        if self.owner and time.time() - self.heard > LOST_AFTER:
            self.room.system("🏐 The ball got lost on one of the screens!")
            self.lose_ball(self.owner)
        if self.phase == "playing":
            self.watchdog = self.room.later(2, self.watch)

    def finish(self, forfeit=None):
        self.room.cancel(self.watchdog)
        self.phase = "over"
        self.owner = None
        left, right = self.sides["left"], self.sides["right"]
        coop = self.settings["mode"] == "coop"
        names = {s: (self.room.members[u].name if u in self.room.members else "?") for s, u in self.sides.items() if u}
        if coop:
            self.final = {"mode": "coop", "passes": self.passes, "best": self.best_rally, "names": names}
        else:
            if forfeit:
                win = self.other(forfeit)
            else:
                win = "left" if self.score["left"] > self.score["right"] else "right"
            self.final = {"mode": "versus", "winner": win, "score": dict(self.score), "best": self.best_rally,
                          "names": names, "forfeit": forfeit}
        self.push()
        if not left or not right:
            return
        if coop:
            for uid in (left, right):
                self.record(uid, "play", {"volley.coop_best": ("max", self.passes), "volley.best_rally": ("max", self.best_rally)},
                            f"Keep it up: {self.passes} passes")
            self.finished([[left, right]])
        else:
            win = self.final["winner"]
            wu, lu = self.sides[win], self.sides[self.other(win)]
            s = f"{self.score[win]}–{self.score[self.other(win)]}"
            self.record(wu, "win", {"volley.wins": ("add", 1), "volley.points": ("add", self.score[win]),
                                    "volley.best_rally": ("max", self.best_rally)}, f"Won {s}" + (" (forfeit)" if forfeit else ""))
            self.record(lu, "loss", {"volley.points": ("add", self.score[self.other(win)]),
                                     "volley.best_rally": ("max", self.best_rally)}, f"Lost {s}")
            self.finished([[wu], [lu]])

    def on_leave(self, m):
        side = self.side_of(m.uid)
        if not side:
            return
        if self.phase == "playing":
            self.room.system(f"🏐 {m.name} left the court.")
            self.finish(forfeit=side)   # (while they still have their seat, so the result is saved for both)
        self.sides[side] = None
        self.push()

    def on_admin(self, m, action, msg):
        side = self.side_of(m.uid)
        if action == "point" and self.phase == "playing" and side and self.settings["mode"] == "versus":
            self.owner = None
            self.score[side] += 1
            self.broadcast("point", side=side, lost=self.other(side), score=self.score, rally=self.rally)
            if self.score[side] >= self.settings["target"]:
                self.finish()
            else:
                self.serve(side)
            return "🏐 +1 point."
        if action == "end" and self.phase == "playing":
            self.finish()
            return "🏁 Game ended."
        return None
