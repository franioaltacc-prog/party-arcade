import asyncio
import random
import time
import traceback

from . import pool_core as pc
from .base import Game, num

MODES = ("8ball", "9ball")
RACES = (1, 2, 3, 5)          # frames to win the match
CLOCKS = (0, 30, 45, 60)      # shot clock in seconds (0 = off)
MODE_NAME = {"8ball": "8-ball", "9ball": "9-ball"}
ROLL_EXTRA = 0.6              # the table stays "rolling" this much longer than the simulation
FRAME_PAUSE = 4.0             # seconds between frames
RELAY_GAP = 0.05              # aim / cue-ball drags are relayed at most 20 times a second per player
NO_RESULT = {"foul": False, "reason": None, "first": None, "potted": [], "assigned": None, "again": False,
             "over": False, "winner": None, "win": None, "runout": False}


def _play(frame, shot):
    """Runs in a worker thread: a break takes ~40 ms of pure Python, too long to block the event loop."""
    t0 = time.perf_counter()
    res = pc.apply_shot(frame, shot)
    res["ms"] = (time.perf_counter() - t0) * 1000
    return res


class Billiards(Game):
    """Billiards (8-ball / 9-ball): two seats like Connect 4, everyone else watches.

    The server is the authority: it turns the shooter's aim into a shot (the only trig is here),
    simulates it with games/pool_core.py and sends the shot plus the result. Browsers replay it
    with PoolCore.Sim (pool-core.js), which gives bit-identical results, then snap to the state."""

    key = "billiards"
    max_players = 12   # two seats, everyone else spectates

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"mode": "8ball", "race": 1, "clock": 45}
        self.seats = [None, None]
        self.queue = []            # players waiting for a seat, longest-waiting first
        self.frame = None          # pool_core frame (None in the lobby)
        self.scores = {}           # uid -> frames won this match
        self.runs = {}             # uid -> run-outs this match
        self.frame_no = 0
        self.shot_no = 0
        self.starter = None        # seat that breaks the first frame of the match
        self.last = None           # {result, shooter, seat, shotNo}: the last shot (or timeout)
        self.match_winner = None
        self.timer = None          # shot clock, end of rolling or the next frame: one at a time
        self.clock_at = None       # when the shot clock runs out
        self.until = None          # when rolling / the frame-over pause ends
        self.turn_id = 0
        self.pending = None        # token of a shot being simulated in a worker thread
        self.relay_at = {}

    def listed(self):
        return self.phase == "lobby"

    # -- what the browsers see -------------------------------------------------
    def waiting(self):
        """Players without a seat, longest-waiting first (watchers don't count)."""
        out = []
        for u in self.queue + list(self.room.members):
            mm = self.room.members.get(u)
            if mm and mm.plays and u not in self.seats and u not in out:
                out.append(u)
        return out

    def state_for(self, m):
        now = time.time()
        clock = None
        if self.phase == "aiming" and self.clock_at and not self.pending:
            clock = round(max(0.0, self.clock_at - now), 1)
        left = round(max(0.0, self.until - now), 2) if self.until and self.phase in ("rolling", "frameover") else 0
        return {"phase": self.phase, "seats": self.seats, "settings": self.settings, "frame": self.frame,
                "scores": self.scores, "runs": self.runs, "frameNo": self.frame_no, "shotNo": self.shot_no,
                "clockLeft": clock, "rollLeft": left if self.phase == "rolling" else 0,
                "nextLeft": left if self.phase == "frameover" else 0, "busy": bool(self.pending),
                "last": self.last, "matchWinner": self.match_winner, "waiting": self.waiting()}

    def push(self):
        self.broadcast("state", state=self.state_for(None))

    def name(self, uid):
        mm = self.room.members.get(uid)
        return mm.name if mm else "Someone"

    # -- timers ------------------------------------------------------------------
    def cancel_timer(self):
        self.room.cancel(self.timer)
        self.timer = None

    def begin_aim(self):
        """The shooter (frame["turn"]) may aim now; start the shot clock."""
        self.cancel_timer()
        self.phase = "aiming"
        self.until = None
        self.turn_id += 1
        secs = self.settings["clock"]
        if secs:
            self.clock_at = time.time() + secs
            self.timer = self.room.later(secs, self.on_clock, self.turn_id)
        else:
            self.clock_at = None
        self.push()

    def on_clock(self, turn_id):
        if self.phase != "aiming" or self.pending or turn_id != self.turn_id or not self.frame:
            return
        seat = self.frame["turn"]
        uid = self.seats[seat]
        self.frame = pc.timeout_foul(self.frame)
        self.last = {"result": dict(NO_RESULT, foul=True, reason="timeout"), "shooter": uid, "seat": seat, "shotNo": self.shot_no}
        self.broadcast("toast", text=f"⏰ {self.name(uid)} ran out of time: ball in hand!")
        self.begin_aim()

    # -- the match ---------------------------------------------------------------
    def fill_seats(self):
        for i in (0, 1):
            mm = self.room.members.get(self.seats[i]) if self.seats[i] else None
            if self.seats[i] and (mm is None or mm.watching):
                self.seats[i] = None    # left, or just watching now
        for i in (0, 1):
            if self.seats[i] is None:
                w = self.waiting()
                if w:
                    self.seats[i] = w[0]
        self.queue = [u for u in self.queue if u not in self.seats]

    def start_match(self, starter=None):
        self.fill_seats()
        if None in self.seats or not all(self.room.members[u].online for u in self.seats):
            return False
        if starter is None:
            starter = random.randrange(2) if self.starter is None else 1 - self.starter
        self.starter = starter
        self.scores = {u: 0 for u in self.seats}
        self.runs = {u: 0 for u in self.seats}
        self.match_winner = None
        self.frame_no = 0
        self.tainted = False
        self.next_frame()
        return True

    def next_frame(self, frame_no=None):
        if frame_no is not None and (self.phase != "frameover" or frame_no != self.frame_no):
            return
        breaker = self.starter if self.frame_no % 2 == 0 else 1 - self.starter
        self.frame_no += 1
        self.frame = pc.new_frame(self.settings["mode"], breaker, random.random)
        self.last = None
        self.pending = None
        self.begin_aim()

    def to_lobby(self):
        self.cancel_timer()
        self.pending = None
        self.phase = "lobby"
        self.frame = None
        self.last = None
        self.clock_at = self.until = None
        self.match_winner = None
        self.scores, self.runs = {}, {}
        self.frame_no = 0
        self.fill_seats()

    def shoot(self, m, msg):
        if self.pending:
            return
        F = self.frame
        seat = F["turn"]
        if self.seats[seat] != m.uid:
            if m.uid in self.seats:
                self.send(m, "toast", text="It's not your turn 🙂")
            return
        a = num(msg.get("a"), 0.0, -1000, 1000)
        p = num(msg.get("p"), 0.5, 0, 1)
        sx = num(msg.get("sx"), 0.0, -1, 1)
        sy = num(msg.get("sy"), 0.0, -1, 1)
        cx = cy = None
        if F["inHand"] and msg.get("cx") is not None and msg.get("cy") is not None:
            cx = num(msg.get("cx"), -1.0, -1, 4)
            cy = num(msg.get("cy"), -1.0, -1, 3)
            if not pc.valid_placement(F, cx, cy):
                self.send(m, "toast", text="The cue ball can't go there.")
                return
        shot = pc.make_shot(F, a, p, sx, sy, cx, cy)
        before = [[b[0], b[1], b[2]] for b in F["balls"]]
        token = self.pending = object()
        self.cancel_timer()
        self.clock_at = None
        fut = asyncio.get_running_loop().run_in_executor(None, _play, pc.clone_frame(F), shot)
        fut.add_done_callback(lambda f: self.shot_done(token, f, seat, m.uid, before, shot))

    def shot_done(self, token, fut, seat, uid, before, shot):
        """Back on the event loop with the simulated shot. Anything may have changed meanwhile."""
        if token is not self.pending or self.room.game is not self:
            return
        self.pending = None
        try:
            res = fut.result()
        except Exception:
            traceback.print_exc()
            self.begin_aim()
            return
        if self.phase != "aiming" or not self.frame or self.seats[seat] != uid:
            return
        if res["ms"] > 250:
            print(f"  🎱 slow shot: {res['ms']:.0f} ms")
        self.frame = res["frame"]
        self.shot_no += 1
        result = res["result"]
        dur = res["sim"]["dur"]
        self.last = {"result": result, "shooter": uid, "seat": seat, "shotNo": self.shot_no}
        self.phase = "rolling"
        self.until = time.time() + dur + ROLL_EXTRA
        self.timer = self.room.later(dur + ROLL_EXTRA, self.end_roll, self.shot_no)
        self.broadcast("shot", shotNo=self.shot_no, shooter=uid, seat=seat, before=before, shot=shot,
                       after=self.frame["balls"], dur=dur, result=result, state=self.state_for(None))

    def end_roll(self, shot_no):
        if self.phase != "rolling" or shot_no != self.shot_no:
            return
        if self.frame["over"]:
            self.frame_done()
        else:
            self.begin_aim()

    def frame_done(self):
        self.cancel_timer()
        self.clock_at = None
        uid = self.seats[self.frame["winner"]]
        self.scores[uid] = self.scores.get(uid, 0) + 1
        if self.last and (self.last.get("result") or {}).get("runout"):
            self.runs[uid] = self.runs.get(uid, 0) + 1
        if self.scores[uid] >= self.settings["race"]:
            self.phase = "over"
            self.until = None
            self.match_winner = uid
            self.push()
            self.save_results()
        else:
            self.phase = "frameover"
            self.until = time.time() + FRAME_PAUSE
            self.timer = self.room.later(FRAME_PAUSE, self.next_frame, self.frame_no)
            self.push()

    def save_results(self):
        win = self.match_winner
        lose = self.seats[1] if self.seats[0] == win else self.seats[0]
        if not win or not lose:
            return
        w, l = self.scores.get(win, 0), self.scores.get(lose, 0)
        mode = MODE_NAME[self.frame["mode"] if self.frame else self.settings["mode"]]
        for uid, outcome, mine, theirs in ((win, "win", w, l), (lose, "loss", l, w)):
            stats = {"pool.games": ("add", 1), "pool.wins" if outcome == "win" else "pool.losses": ("add", 1)}
            if mine:
                stats["pool.frames"] = ("add", mine)
            if self.runs.get(uid):
                stats["pool.runs"] = ("add", self.runs[uid])
            self.record(uid, outcome, stats, f"{'Won' if outcome == 'win' else 'Lost'} {mine}–{theirs} · {mode}")
        self.finished([[win], [lose]])

    def restart(self, host):
        """Everyone voted "play again": a rematch with the same two players."""
        if self.phase == "over":
            self.start_match()

    # -- messages ----------------------------------------------------------------
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t in ("aim", "place"):
            self.relay(m, t, msg)
        elif t == "shoot":
            if self.phase == "aiming":
                self.shoot(m, msg)
            elif m.uid in self.seats and self.phase == "rolling":
                self.send(m, "toast", text="Wait for the balls to stop 🎱")
        elif t == "settings" and host and self.phase in ("lobby", "over"):
            s = self.settings
            if msg.get("mode") in MODES:
                s["mode"] = msg["mode"]
            race, clock = msg.get("race"), msg.get("clock")
            if isinstance(race, int) and not isinstance(race, bool) and race in RACES:
                s["race"] = race
            if isinstance(clock, int) and not isinstance(clock, bool) and clock in CLOCKS:
                s["clock"] = clock
            self.push()
        elif t == "start" and host and self.phase in ("lobby", "over"):
            if not self.start_match():
                self.send(m, "toast", text="You need two players to start (watchers don't count).")
                self.push()
        elif t == "rematch" and self.phase == "over" and m.uid in self.seats:
            if not self.start_match():
                self.send(m, "toast", text="Your opponent isn't here right now.")
        elif t == "swap" and host and self.phase == "over":
            self.swap(m)

    def relay(self, m, t, msg):
        F = self.frame
        if self.phase != "aiming" or self.pending or not F or self.seats[F["turn"]] != m.uid:
            return
        now = time.monotonic()
        if now - self.relay_at.get((m.uid, t), 0.0) < RELAY_GAP:
            return
        self.relay_at[(m.uid, t)] = now
        if t == "aim":
            self.room.broadcast("g:aim", exclude=m.uid, id=m.uid, a=num(msg.get("a"), 0.0, -1000, 1000),
                                p=num(msg.get("p"), 0.0, 0, 1), sx=num(msg.get("sx"), 0.0, -1, 1), sy=num(msg.get("sy"), 0.0, -1, 1))
        elif F["inHand"]:
            x, y = num(msg.get("x"), -1.0, -1, 4), num(msg.get("y"), -1.0, -1, 3)
            if pc.valid_placement(F, x, y):
                self.room.broadcast("g:place", exclude=m.uid, id=m.uid, x=x, y=y)

    def swap(self, m):
        """Winner stays on: the longest-waiting player takes the loser's seat."""
        w = self.waiting()
        if not w:
            self.send(m, "toast", text="Nobody is waiting to play.")
            return
        win = self.match_winner if self.match_winner in self.seats else None
        i = 1 - self.seats.index(win) if win else 1
        loser = self.seats[i]
        self.seats[i] = w[0]
        self.queue = [u for u in self.queue if u != w[0] and u != loser] + ([loser] if loser else [])
        self.room.system(f"🔄 {self.name(w[0])} takes on {self.name(win) if win else 'the table'}!")
        if not self.start_match(starter=i):
            self.push()

    # -- people coming and going -------------------------------------------------
    def on_join(self, m, rejoin):
        if m.uid not in self.seats and m.uid not in self.queue and not m.watching:
            self.queue.append(m.uid)
        if self.phase == "lobby":
            self.fill_seats()
        self.push()

    def on_offline(self, m):
        if m.uid in self.seats:
            self.push()     # their seat (and shot clock) stays for offline_grace seconds

    def on_leave(self, m):
        self.queue = [u for u in self.queue if u != m.uid]
        self.relay_at = {k: v for k, v in self.relay_at.items() if k[0] != m.uid}
        if m.uid in self.seats:
            self.seats[self.seats.index(m.uid)] = None
            if self.phase != "lobby":
                self.broadcast("toast", text=f"{m.name} left the table: back to the lobby.")
            self.to_lobby()
        self.push()

    # -- admin cheats --------------------------------------------------------------
    def on_admin(self, m, action, msg):
        if self.phase != "aiming" or self.pending or m.uid not in self.seats or not self.frame:
            return None
        me = self.seats.index(m.uid)
        F = self.frame
        if action not in ("hand", "clear", "win"):
            return None
        self.tainted = True
        if F["turn"] != me:
            F["turn"] = me
            F["visit"] = {"seat": me, "potted": [], "start": F["shots"]}
        if action == "hand":
            F["inHand"], F["kitchen"] = True, False
            self.begin_aim()
            return "✋ Ball in hand: put it anywhere."
        if action == "clear":
            if F["mode"] == "9ball":
                F["balls"] = [b for b in F["balls"] if b[0] in (0, 9)]
            else:
                if F["open"] or not F["groups"][me]:
                    F["open"] = False
                    F["groups"] = ["solids", "stripes"] if me == 0 else ["stripes", "solids"]
                g = F["groups"][me]
                F["balls"] = [b for b in F["balls"] if pc.group_of(b[0]) != g]
            F["isBreak"] = F["kitchen"] = False
            self.begin_aim()
            return f"🧹 Cleared the table: just the {9 if F['mode'] == '9ball' else 8} left!"
        F["over"], F["winner"], F["reason"] = True, me, "cheat"
        F["inHand"] = F["kitchen"] = False
        self.last = {"result": dict(NO_RESULT, over=True, winner=me, win="cheat"), "shooter": m.uid, "seat": me, "shotNo": self.shot_no}
        self.frame_done()
        return "🏆 Frame won. Obviously."
