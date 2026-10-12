"""Billiards online: websocket bots play real frames against the server.

The bots pick their shots with games/pool_core.py (the same code the server runs), so they can
predict every result exactly and check the server's replies bit for bit."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, itertools, math, random, time
from wsbot import WS
from accbot import check
from games import pool_core as pc
import tournaments

U = str(random.randint(1000, 9999))
rng = random.Random(int(U))
rid = itertools.count(1)


class Bot:
    """A websocket client that keeps every message it gets and the latest game state."""

    def __init__(self, uid, name):
        self.uid, self.name = uid, name
        self.log, self.state, self.code, self.token = [], None, None, None

    async def connect(self, token=None):
        self.ws = WS()
        await self.ws.connect(self.uid, self.name)
        self.task = asyncio.create_task(self.pump())
        if token:     # a browser coming back sends its login token with hello
            self.token = token
            self.send("hello", id=self.uid, name=self.name, token=token)
            await self.wait_for("auth:state", cond=lambda m: m.get("user"))
        return await self.wait_for("welcome")

    async def pump(self):
        while True:
            m = await self.ws.inbox.get()
            self.log.append(m)
            if m["t"] in ("g:state", "g:shot", "room:joined"):
                self.state = m["state"]
            if m["t"] == "room:joined":
                self.code = m["code"]

    def close(self):
        self.task.cancel()
        self.ws.task.cancel()
        self.ws.w.close()

    def send(self, t, **data):
        self.ws.send({"t": t, **data})

    def mark(self):
        return len(self.log)

    def since(self, k, t):
        return [m for m in self.log[k:] if m["t"] == t]

    async def wait_for(self, t, since=0, cond=lambda m: True, timeout=8):
        end = time.time() + timeout
        while time.time() < end:
            for m in self.log[since:]:
                if m["t"] == t and cond(m):
                    return m
            await asyncio.sleep(0.02)
        return None

    async def until(self, fn, timeout=8):
        end = time.time() + timeout
        while time.time() < end:
            if self.state is not None and fn(self.state):
                return self.state
            await asyncio.sleep(0.02)
        return None

    async def req(self, t, **data):
        r = next(rid)
        k = self.mark()
        self.send(t, rid=r, **data)
        return await self.wait_for("res", k, lambda m: m.get("rid") == r) or {"ok": False, "error": "no reply"}


# ------------------------------------------------------------------ shot planning
def legal_targets(F):
    balls = [b for b in F["balls"] if b[0] != 0]
    if F["mode"] == "9ball":
        low = min(b[0] for b in balls)
        return [b for b in balls if b[0] == low]
    if F["isBreak"]:
        return balls
    g = F["groups"][F["turn"]]
    if F["open"]:
        left = [b for b in balls if b[0] != 8]
    else:
        left = [b for b in balls if pc.group_of(b[0]) == g]
    return left or [b for b in balls if b[0] == 8]


def placements(F):
    cue = next(b for b in F["balls"] if b[0] == 0)
    out = [(cue[1], cue[2])]
    if F["inHand"]:
        tries = 0
        while len(out) < 6 and tries < 200:
            tries += 1
            x = rng.uniform(pc.R, pc.HEAD_X if F["kitchen"] else pc.W - pc.R)
            y = rng.uniform(pc.R, pc.H - pc.R)
            if pc.valid_placement(F, x, y):
                out.append((x, y))
    return out


def score(F, res):
    r = res["result"]
    me = F["turn"]
    if r["over"]:
        return 1000 if r["winner"] == me else -1000
    s = -100 if r["foul"] else 0
    if r["again"]:
        s += 50 + 5 * len([i for i in r["potted"] if i])
    return s - res["sim"]["dur"] * 2


def plan(F, limit=70):
    """-> (score, angle, power, cx, cy, result): the best of a few ghost-ball shots, played out exactly."""
    cands = []
    for (px, py) in placements(F):
        for t in legal_targets(F):
            cands.append((math.atan2(t[2] - py, t[1] - px), 0.55 if not F["isBreak"] else 1.0, px, py))
            if F["isBreak"]:
                continue
            for p in pc.POCKETS:
                dx, dy = p["x"] - t[1], p["y"] - t[2]
                d = math.sqrt(dx * dx + dy * dy)
                gx, gy = t[1] - dx / d * pc.D, t[2] - dy / d * pc.D
                ax, ay = gx - px, gy - py
                la = math.sqrt(ax * ax + ay * ay)
                if la < 1e-6 or (ax * dx + ay * dy) / (la * d) < 0.3:
                    continue     # too thin a cut
                for power in (0.3, 0.6):
                    cands.append((math.atan2(ay, ax), power, px, py))
    if F["isBreak"]:
        cands = [(a + rng.uniform(-0.02, 0.02), 1.0, x, y) for (a, _, x, y) in cands[:1]] * 4
    if len(cands) > limit:
        cands = rng.sample(cands, limit)
    best = None
    for (a, p, x, y) in cands:
        shot = pc.make_shot(F, a, p, 0, 0, x, y)
        res = pc.apply_shot(F, shot)
        s = score(F, res)
        if best is None or s > best[0]:
            best = (s, a, p, x, y, res["result"])
    return best


def foul_shot(F):
    """A feather-light shot that touches nothing (a 'no ball hit' foul) -> angle or None."""
    for k in range(32):
        a = k * math.pi / 16
        res = pc.apply_shot(F, pc.make_shot(F, a, 0.02))
        if res["result"]["reason"] == "nohit":
            return a
    return None


# ------------------------------------------------------------------ helpers
def seat_bot(bots, st):
    uid = st["seats"][st["frame"]["turn"]]
    return next(b for b in bots if b.uid == uid)


async def aiming(bot, timeout=20):
    return await bot.until(lambda s: s["phase"] in ("aiming", "over", "lobby") and not s["busy"], timeout)


async def take_shot(bots, watcher, a, p, cx=None, cy=None, label=None):
    """The current shooter plays (a, p); checks the server's g:shot against pool_core. -> g:shot message."""
    st = watcher.state
    F = st["frame"]
    shooter = seat_bot(bots, st)
    k = watcher.mark()
    msg = {"a": a, "p": p, "sx": 0, "sy": 0}
    if cx is not None and F["inHand"]:
        msg.update(cx=cx, cy=cy)
    shooter.send("g:shoot", **msg)
    shot = await watcher.wait_for("g:shot", k, timeout=10)
    if not shot:
        check(False, f"no g:shot for {label or 'a shot'}")
        return None
    mine = pc.apply_shot(F, pc.make_shot(F, a, p, 0, 0, cx, cy))
    same = (shot["before"] == F["balls"] and shot["after"] == mine["frame"]["balls"] and shot["result"] == mine["result"]
            and shot["state"]["frame"] == mine["frame"] and pc.simulate(shot["before"], shot["shot"])["balls"] == mine["sim"]["balls"])
    if not same:
        print("INFO mismatch", shot["before"] == F["balls"], shot["after"] == mine["frame"]["balls"], shot["result"] == mine["result"],
              shot["state"]["frame"] == mine["frame"])
        print("INFO", shot["shot"], pc.make_shot(F, a, p, 0, 0, cx, cy), msg)
    if not same or label:
        check(same, label or f"shot {shot['shotNo']} matches pool_core bit for bit")
    take_shot.mismatch += 0 if same else 1
    return shot
take_shot.mismatch = 0


async def play_frame(bots, watcher, max_shots=90, on_shot=None):
    """Plays the current frame to the end with planned shots. -> state after it."""
    for n in range(max_shots):
        st = await aiming(watcher)
        if not st or st["phase"] != "aiming":
            return st
        F = st["frame"]
        best = await asyncio.to_thread(plan, F)
        _, a, p, x, y, _ = best
        if on_shot and await on_shot(n, st):
            continue
        shot = await take_shot(bots, watcher, a, p, x, y)
        if not shot:
            return None
        await watcher.until(lambda s: s["shotNo"] >= shot["shotNo"] and s["phase"] != "rolling", shot["dur"] + 5)
    return watcher.state


async def profile(bot, name):
    r = await bot.req("profile:get", name=name)
    return (r.get("profile") or {})


# ------------------------------------------------------------------ the test
async def main():
    check("billiards" in tournaments.GAMES and tournaments.GAMES["billiards"]["race"] == 1, "tournament settings for billiards")
    A, B, C, D = Bot(f"plA{U}xx", "PoolA"), Bot(f"plB{U}xx", "PoolB"), Bot(f"plC{U}xx", "Watcher"), Bot(f"plD{U}xx", "Waiter")
    for b in (A, B, C, D):
        await b.connect()
    nameA, nameB = "PoolA" + U, "PoolB" + U
    for b, nm in ((A, nameA), (B, nameB)):
        r = await b.req("auth:signup", name=nm, password="pool-pass-123")
        assert r["ok"], r
        b.token = r["token"]
    A.send("room:create", game="billiards")
    await A.wait_for("room:joined")
    code = A.code
    B.send("room:join", code=code, game="billiards")
    C.send("room:join", code=code, game="billiards", watch=True)
    await B.wait_for("room:joined"); await C.wait_for("room:joined")
    D.send("room:join", code=code, game="billiards")
    await D.wait_for("room:joined")
    st = await A.until(lambda s: D.uid in s["waiting"])
    check(st and st["phase"] == "lobby" and st["seats"] == [A.uid, B.uid], "lobby: the first two players get the seats")
    check(st and st["waiting"] == [D.uid] and C.uid not in st["waiting"], "the extra player waits, the watcher doesn't")
    check(st and st["frame"] is None and st["clockLeft"] is None, "no frame in the lobby")

    # settings: host only
    B.send("g:settings", mode="9ball", race=5, clock=0)
    await asyncio.sleep(0.3)
    check(A.state["settings"] == {"mode": "8ball", "race": 1, "clock": 45}, "non-host settings are ignored")
    A.send("g:settings", mode="8ball", race=1, clock=30)
    st = await C.until(lambda s: s["settings"]["clock"] == 30)
    check(st is not None, "host changes the settings (everyone sees them)")
    A.send("g:settings", mode="snooker", race=4, clock=-5)
    await asyncio.sleep(0.3)
    check(A.state["settings"] == {"mode": "8ball", "race": 1, "clock": 30}, "bad settings are ignored")
    B.send("g:start")
    await asyncio.sleep(0.3)
    check(A.state["phase"] == "lobby", "non-host can't start")

    # start: a racked 8-ball frame and a running shot clock
    A.send("g:start")
    st = await C.until(lambda s: s["phase"] == "aiming")
    F = st["frame"] if st else None
    check(st and F["isBreak"] and F["inHand"] and F["kitchen"] and len(F["balls"]) == 16 and st["frameNo"] == 1, "match started: racked 8-ball frame")
    check(st and 29 <= st["clockLeft"] <= 30, f"shot clock running ({st and st['clockLeft']}s)")
    breaker = seat_bot((A, B), st)
    other = B if breaker is A else A

    # wrong player
    k = C.mark(); ko = other.mark()
    other.send("g:shoot", a=0, p=1, sx=0, sy=0)
    await asyncio.sleep(0.5)
    check(not C.since(k, "g:shot") and other.since(ko, "g:toast"), "a shot from the wrong player is rejected")
    k = other.mark()
    C.send("g:shoot", a=0, p=1)
    await asyncio.sleep(0.3)
    check(not C.since(k, "g:shot"), "the watcher can't shoot")

    # aim relay (rate limited) and a reconnect mid-match
    k = C.mark()
    for i in range(10):
        breaker.send("g:aim", a=0.01 * i, p=0.5, sx=0, sy=0.2)
    await asyncio.sleep(0.4)
    aims = C.since(k, "g:aim")
    check(1 <= len(aims) < 10 and aims[0]["id"] == breaker.uid, f"aim is relayed, rate-limited ({len(aims)} of 10)")
    k = breaker.mark()
    other.send("g:aim", a=1, p=1)
    await asyncio.sleep(0.2)
    check(not breaker.since(k, "g:aim"), "aim from the non-shooter isn't relayed")
    await asyncio.sleep(1.5)
    kc = C.mark()
    other.close()
    await asyncio.sleep(0.5)
    o2 = Bot(other.uid, other.name)
    await o2.connect(other.token)
    o2.send("room:join", code=code, game="billiards")
    j = await o2.wait_for("room:joined")
    check(j and j["state"]["phase"] == "aiming" and j["state"]["frame"] == F, "rejoin mid-match gets the full state")
    check(j and j["state"]["clockLeft"] is not None and j["state"]["clockLeft"] < 28.5, f"clockLeft counts down ({j and j['state']['clockLeft']}s)")
    check(await o2.wait_for("g:state") is not None, "rejoin also gets a g:state")
    if other is A:
        A = o2
    else:
        B = o2
    other = o2
    bots = (A, B)

    # timeout on the break: the opponent breaks from the kitchen
    t = await C.wait_for("g:toast", kc, lambda m: "out of time" in m["text"], timeout=32)
    st = await C.until(lambda s: s["phase"] == "aiming" and s["frame"]["turn"] != F["turn"])
    check(t is not None and st and st["last"]["result"]["reason"] == "timeout", "the shot clock runs out")
    check(st and st["frame"]["inHand"] and st["frame"]["kitchen"] and st["frame"]["isBreak"] and st["clockLeft"] > 28,
          "timeout on the break: the other player breaks from the kitchen, fresh clock")
    breaker, other = other, breaker

    # the break, then shooting while the balls roll
    st = C.state
    best = await asyncio.to_thread(plan, st["frame"])
    shot = await take_shot(bots, C, best[1], best[2], label="the break matches pool_core bit for bit")
    check(shot and shot["state"]["phase"] == "rolling" and shot["state"]["rollLeft"] > 0 and shot["dur"] > 0, "g:shot: phase rolling with rollLeft")
    check(shot and shot["shooter"] == breaker.uid and shot["seat"] == st["frame"]["turn"], "g:shot names the shooter")
    shooter_now = seat_bot(bots, shot["state"])
    k = shooter_now.mark()
    shooter_now.send("g:shoot", a=1, p=1)
    await asyncio.sleep(0.3)
    check(any("stop" in m["text"] for m in shooter_now.since(k, "g:toast")) and C.state["shotNo"] == shot["shotNo"],
          "shooting while the balls roll is rejected")
    C.close()
    C = Bot(C.uid, "Watcher")
    await C.connect()
    C.send("room:join", code=code, game="billiards")
    j = await C.wait_for("room:joined")
    check(j and (j["state"]["phase"] != "rolling" or j["state"]["rollLeft"] > 0), "a watcher rejoining while the balls roll gets rollLeft")

    # a deliberate foul -> ball in hand for the other player
    async def foul_once(n, st):
        if foul_once.done or st["frame"]["isBreak"]:
            return False
        a = foul_shot(st["frame"])
        if a is None:
            return False
        foul_once.done = True
        me = seat_bot(bots, st)
        shot = await take_shot(bots, C, a, 0.02, label="a foul shot matches pool_core")
        await C.until(lambda s: s["phase"] == "aiming" and s["shotNo"] == shot["shotNo"], shot["dur"] + 5)
        s2 = C.state
        check(shot["result"]["foul"] and shot["result"]["reason"] == "nohit", "no ball hit is a foul")
        check(s2["frame"]["inHand"] and not s2["frame"]["kitchen"] and s2["seats"][s2["frame"]["turn"]] != me.uid, "foul: ball in hand anywhere for the opponent")
        F2 = s2["frame"]
        them = seat_bot(bots, s2)
        k = C.mark()
        good = placements(F2)[-1]
        them.send("g:place", x=good[0], y=good[1])
        await asyncio.sleep(0.3)
        ball = next(b for b in F2["balls"] if b[0] != 0)
        them.send("g:place", x=ball[1], y=ball[2])
        await asyncio.sleep(0.3)
        pl = C.since(k, "g:place")
        check(len(pl) == 1 and pl[0]["id"] == them.uid, "cue-ball drag is relayed, an invalid spot isn't")
        k = C.mark(); kt = them.mark()
        them.send("g:shoot", a=0, p=0.5, cx=ball[1], cy=ball[2])
        await asyncio.sleep(0.4)
        check(not C.since(k, "g:shot") and them.since(kt, "g:toast"), "shooting from an invalid cue-ball spot is rejected")
        return True
    foul_once.done = False

    st = await play_frame(bots, C, on_shot=foul_once)
    check(foul_once.done, "the foul test ran")
    check(st and st["phase"] == "over" and st["matchWinner"] in (A.uid, B.uid), f"8-ball frame played to the end ({C.state['shotNo']} shots)")
    check(take_shot.mismatch == 0, "every shot matched pool_core bit for bit")
    if not st or st["phase"] != "over":
        print("FAILED:", check.failed + 1)
        return
    winner = st["matchWinner"]
    check(st["scores"][winner] == 1 and st["frame"]["over"] and st["last"]["result"]["over"], f"race to 1 won ({st['frame']['reason']})")
    await asyncio.sleep(1.0)
    pa, pb = (await profile(A, nameA)).get("stats", {}), (await profile(A, nameB)).get("stats", {})
    wa = winner == A.uid
    check(pa.get("pool.games") == 1 and pb.get("pool.games") == 1, f"stats saved for both players {pa} {pb}")
    check(pa.get("pool.wins" if wa else "pool.losses") == 1 and pb.get("pool.losses" if wa else "pool.wins") == 1, "win / loss counted")
    recent = (await profile(A, nameA if wa else nameB)).get("recent", [])
    check(recent and recent[0]["game"] == "billiards" and recent[0]["detail"].startswith("Won 1–0 · 8-ball"), f"match detail {recent[:1]}")
    check(pa.get("pool.frames", 0) + pb.get("pool.frames", 0) == 1, "frames won saved")

    # rematch (race to 2 this time)
    A.send("g:settings", race=2)
    await C.until(lambda s: s["settings"]["race"] == 2)
    C.send("g:rematch")
    await asyncio.sleep(0.3)
    check(C.state["phase"] == "over", "a watcher can't ask for a rematch")
    B.send("g:rematch")
    st = await C.until(lambda s: s["phase"] == "aiming" and s["frameNo"] == 1 and s["matchWinner"] is None)
    check(st and st["scores"] == {A.uid: 0, B.uid: 0} and st["frame"]["isBreak"], "rematch: a fresh match, scores reset")

    # admin cheats taint the match
    r = await A.req("admin:cheat", action="hand")
    check(not r["ok"], "non-admins can't cheat")
    r = await A.req("admin:unlock", code="test-admin-code-123")
    check(r["ok"], "admin unlocked")
    r = await A.req("admin:cheat", action="hand")
    st = await C.until(lambda s: s["frame"] and s["frame"]["turn"] == s["seats"].index(A.uid) and s["frame"]["inHand"] and not s["frame"]["kitchen"])
    check(r["ok"] and st is not None, f"cheat: ball in hand ({r.get('text') or r.get('error')})")
    r = await A.req("admin:cheat", action="clear")
    st = await C.until(lambda s: len(s["frame"]["balls"]) == 9)
    mine = st and st["frame"]["groups"][st["seats"].index(A.uid)]
    check(r["ok"] and st and not any(pc.group_of(b[0]) == mine for b in st["frame"]["balls"]), f"cheat: my group cleared ({mine})")
    r = await A.req("admin:cheat", action="nonsense")
    check(not r["ok"], "unknown cheat rejected")
    breaker1 = C.state["frame"]["breaker"]
    r = await A.req("admin:cheat", action="win")
    st = await C.until(lambda s: s["phase"] == "frameover")
    check(r["ok"] and st and st["scores"][A.uid] == 1 and 3 < st["nextLeft"] <= 4 and st["matchWinner"] is None, "cheat: win the frame -> frame over, 1-0")
    st = await C.until(lambda s: s["phase"] == "aiming" and s["frameNo"] == 2, 6)
    check(st and st["frame"]["breaker"] == 1 - breaker1 and st["frame"]["isBreak"], "next frame after the pause; the other player breaks")
    r = await A.req("admin:cheat", action="win")
    st = await C.until(lambda s: s["phase"] == "over")
    check(r["ok"] and st and st["matchWinner"] == A.uid and st["scores"][A.uid] == 2, "cheat: second frame wins the match 2-0")
    await asyncio.sleep(0.8)
    pa2 = (await profile(A, nameA)).get("stats", {})
    check(pa2.get("pool.games") == 1, "a cheated match isn't saved")

    # winner stays on: the waiting player takes the loser's seat
    A.send("g:settings", race=1)
    await C.until(lambda s: s["settings"]["race"] == 1)
    B.send("g:swap")
    await asyncio.sleep(0.3)
    check(C.state["phase"] == "over", "only the host can swap")
    A.send("g:swap")
    st = await C.until(lambda s: s["phase"] == "aiming" and D.uid in s["seats"])
    check(st and A.uid in st["seats"] and st["waiting"] == [B.uid], "swap: winner stays on, the loser waits")
    check(st and st["frame"]["turn"] == st["seats"].index(D.uid), "the challenger breaks")
    A.send("g:settings", mode="9ball")
    await asyncio.sleep(0.3)
    check(C.state["settings"]["mode"] == "8ball", "settings are locked during a match")
    r = await A.req("admin:cheat", action="win")
    check(r["ok"] and await C.until(lambda s: s["phase"] == "over") is not None, f"cheat win ends the swapped match ({r.get('text') or r.get('error')})")

    # a 9-ball match (no shot clock), saved for A
    A.send("g:settings", mode="9ball", race=1, clock=0)
    await C.until(lambda s: s["settings"]["mode"] == "9ball")
    A.send("g:start")
    st = await C.until(lambda s: s["phase"] == "aiming" and s["frame"]["mode"] == "9ball")
    check(st and len(st["frame"]["balls"]) == 10 and st["clockLeft"] is None and set(st["seats"]) == {A.uid, D.uid},
          "9-ball match: 10 balls, no shot clock")
    st = await play_frame((A, B, D), C)
    check(st and st["phase"] == "over" and st["frame"]["reason"] == "nine", f"9-ball frame played to the end ({C.state['shotNo']} shots)")
    check(take_shot.mismatch == 0, "every 9-ball shot matched pool_core")
    await asyncio.sleep(1.0)
    pa3 = (await profile(A, nameA)).get("stats", {})
    rec = (await profile(A, nameA)).get("recent", [])
    check(pa3.get("pool.games") == 2 and rec and "9-ball" in rec[0]["detail"], f"9-ball match saved ({rec[:1]})")

    # a seated player leaving goes back to the lobby; the waiting player takes the seat
    A.send("g:start")
    await C.until(lambda s: s["phase"] == "aiming")
    k = C.mark()
    D.send("room:leave")
    st = await C.until(lambda s: s["phase"] == "lobby")
    check(st and set(st["seats"]) == {A.uid, B.uid} and st["frame"] is None, "a player leaving mid-match: back to the lobby, the waiting player sits down")
    check(await C.wait_for("g:toast", k, lambda m: "left" in m["text"]) is not None, "everyone is told why")
    for b in (A, B, C, D):
        b.close()

    # a tournament match room starts by itself with the tournament settings
    T = [Bot(f"plT{i}{U}x", f"Tour{i}") for i in range(3)]
    for b in T:
        await b.connect()
    T[0].send("room:create", game="billiards")
    await T[0].wait_for("room:joined")
    for b in T[1:]:
        b.send("room:join", code=T[0].code, game="billiards")
        await b.wait_for("room:joined")
    T[0].send("tour:start", game="billiards")
    got = await asyncio.gather(*[b.wait_for("tour:match", timeout=12) for b in T])
    pair = [b for b, m in zip(T, got) if m]
    check(len(pair) == 2 and got[T.index(pair[0])]["code"] == got[T.index(pair[1])]["code"], "tournament: two players get a billiards match")
    if len(pair) == 2:
        mcode = got[T.index(pair[0])]["code"]
        for b in pair:
            b.send("room:join", code=mcode, game="billiards")
        st = await pair[0].until(lambda s: s["phase"] == "aiming", 15)
        if not st:
            print("INFO", pair[0].state, [m for m in pair[0].log if m["t"] in ("chat", "error", "g:toast")][-6:])
        check(st and set(st["seats"]) == {pair[0].uid, pair[1].uid} and st["settings"] == {"mode": "8ball", "race": 1, "clock": 45},
              "tournament match starts by itself with the tournament settings")
    print("FAILED:", check.failed)
    for b in T:
        b.close()


asyncio.run(main())
