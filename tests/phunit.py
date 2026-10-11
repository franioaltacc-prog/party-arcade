"""In-process tests for games/prophunt.py rules, with a fake room."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import sys, math, random, time
from games import prophunt as P

failed = 0
def check(cond, label):
    global failed
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


class M:
    def __init__(self, uid, watching=False):
        self.uid, self.name, self.avatar, self.color = uid, uid.upper(), "🙂", "#fff"
        self.watching = watching
        self.client = object()
        self.account = None
        self.inbox = []
    @property
    def online(self): return self.client is not None
    @property
    def plays(self): return self.client is not None and not self.watching
    def send(self, t, **d): self.inbox.append((t, d))
    def got(self, t): return [d for tt, d in self.inbox if tt == t]
    def last(self, t):
        g = self.got(t)
        return g[-1] if g else None


class Hub:
    def __init__(self): self.records = []
    def record(self, room, uid, game, outcome, stats=None, detail="", xp=None, totals=True): self.records.append((uid, outcome, stats))


class Room:
    def __init__(self, ms):
        self.members = {m.uid: m for m in ms}
        self.host = ms[0].uid
        self.hub = Hub()
        self.timers = []
        self.sys = []
        self.over = []
    def players_now(self): return [m for m in self.members.values() if m.plays]
    def broadcast(self, t, exclude=None, **d):
        for m in self.members.values():
            if m.uid != exclude: m.send(t, **d)
    def system(self, text): self.sys.append(text)
    def later(self, delay, fn, *a):
        h = [delay, fn, a]; self.timers.append(h); return h
    def cancel(self, h):
        if h in self.timers: self.timers.remove(h)
    def game_over(self, groups): self.over.append(groups)


ms = [M("a"), M("b"), M("c"), M("w", watching=True)]
room = Room(ms)
g = P.PropHunt(room)
g.rng.seed(5)
A, B, C, W = ms
g.on_message(A, "settings", {"hide": 15, "time": 90, "cycles": 1})
g.on_message(B, "start", {})
check(g.phase == "lobby", "only the host can start")
g.on_message(A, "start", {})
check(g.phase == "hiding" and g.total == 3, f"started: 3 players -> 3 rounds ({g.total})")
check("w" not in g.ps, "the watcher isn't in the round")
k = g.r["killer"]
hiders = [u for u in g.ps if u != k]
K = room.members[k]; H1 = room.members[hiders[0]]; H2 = room.members[hiders[1]]
rd = A.last("g:round")
check(rd and rd["round"]["killer"] == k and rd["round"]["map"]["props"], "everyone gets the round with the map")
check(W.last("g:round")["you"] is None and K.last("g:round")["you"]["role"] == "killer", "you: killer / watcher get the right role")
town = g.town
cx, cy = g.r["map"]["spawn"]
for uid, p in g.ps.items():
    check(not town.blocked(p["x"], p["y"], P.PLAYER_R), f"{uid} spawns in a free spot")

# blind during hiding
g.snapshots(time.time())
ke = K.last("g:snap")["e"]
check(all(e[0] == k or g.ps[e[0]]["role"] == "killer" for e in ke) and not any(e[0] in hiders for e in ke), "killer sees no hiders while hiding")
check(not any(e[0] in hiders for e in W.last("g:snap")["e"]), "watcher (killer's view) sees no hiders either")
he = H1.last("g:snap")["e"]
check(any(e[0] == k for e in he), "hiders can see the killer near them")

# killer can't move while hiding
kx, ky = g.ps[k]["x"], g.ps[k]["y"]
g.on_message(K, "pos", {"x": kx + 10, "y": ky, "a": 1.0})
check(g.ps[k]["x"] == kx and abs(g.ps[k]["a"] - 1.0) < 1e-9, "killer frozen while hiding (aim still updates)")

# teleport is clamped
p1 = g.ps[H1.uid]
p1["t"] = time.time() - 0.05
x0, y0 = p1["x"], p1["y"]
g.on_message(H1, "pos", {"x": x0 + 900, "y": y0})
d = math.hypot(p1["x"] - x0, p1["y"] - y0)
check(d < 40 and H1.last("g:fix"), f"teleport clamped to {d:.1f}px and corrected")

# walking through a wall is refused
wall = next(w for w in town.walls if w[2] < 30 and w[3] > 150 and w[0] > 100)   # a vertical wall
wx, wy, ww, wh = wall
p1["x"], p1["y"] = wx - 22, wy + wh / 2
if town.blocked(p1["x"], p1["y"]):
    p1["x"] -= 10
p1["t"] = time.time() - 0.2
H1.inbox.clear()
g.on_message(H1, "pos", {"x": wx + ww + 22, "y": wy + wh / 2})
check(p1["x"] < wx and H1.last("g:fix"), "can't walk through a wall")

# visibility: inside a building is hidden from the killer outside
room_i, (bx, by, bw, bh, _) = next((i, r) for i, r in enumerate(town.rooms) if not town.blocked(r[0] + r[2] / 2, r[1] + r[3] / 2, P.PLAYER_R))
g.phase = "hunting"
g.ps[k]["x"], g.ps[k]["y"] = bx - 120, by + bh / 2
if town.blocked(g.ps[k]["x"], g.ps[k]["y"]):
    g.ps[k]["x"], g.ps[k]["y"] = bx + bw / 2, by - 100
p1["x"], p1["y"] = bx + bw / 2, by + bh / 2
p2 = g.ps[H2.uid]
p2["x"], p2["y"] = g.ps[k]["x"] + 60, g.ps[k]["y"] + 0.0
K.inbox.clear()
g.snapshots(time.time())
ke = {e[0]: e for e in K.last("g:snap")["e"]}
check(H1.uid not in ke, "killer outside can't see a hider inside a building")
check(H2.uid in ke, "killer sees a hider standing next to him")
g.ps[k]["x"], g.ps[k]["y"] = bx + bw / 2 + 40, by + bh / 2
if town.blocked(g.ps[k]["x"], g.ps[k]["y"]):
    g.ps[k]["x"] -= 80
K.inbox.clear(); g.snapshots(time.time())
ke = {e[0]: e for e in K.last("g:snap")["e"]}
check(town.room_of(g.ps[k]["x"], g.ps[k]["y"]) == room_i and H1.uid in ke, "inside the same building the killer can see them")
p2["x"], p2["y"] = bx + bw / 2 + 2000, by
K.inbox.clear(); g.snapshots(time.time())
check(H2.uid not in {e[0] for e in K.last("g:snap")["e"]}, "too far away = not sent")

# disguise
near = [i for i, (kind, px, py, pr) in enumerate(town.props) if pr <= P.MAX_DISGUISE_R]
i = near[0]
kind, px, py, pr = town.props[i]
p2["x"], p2["y"] = px + pr + P.PLAYER_R + 300, py
g.on_message(H2, "disguise", {"i": i})
check(p2["prop"] is None and H2.last("g:toast"), "too far to copy a prop")
p2["x"], p2["y"] = px + pr + P.PLAYER_R + 20, py
p2["disguised_at"] = 0
g.on_message(H2, "disguise", {"i": i})
check(p2["prop"] == kind and H2.last("g:disguised")["prop"] == kind, f"disguised as {kind}")
fountain = next(j for j, pp in enumerate(town.props) if pp[0] == "fountain")
p2["disguised_at"] = 0
p2["x"], p2["y"] = cx + 70, cy
g.on_message(H2, "disguise", {"i": fountain})
check(p2["prop"] == kind, "can't become the (too big) fountain")
g.on_message(K, "disguise", {"i": i})
check("prop" not in g.ps[k] or not g.ps[k]["prop"], "the killer can't disguise")

# snapshot shows the disguise as a prop
g.ps[k]["x"], g.ps[k]["y"] = p2["x"] - 150, p2["y"]
if town.blocked(g.ps[k]["x"], g.ps[k]["y"]):
    g.ps[k]["x"], g.ps[k]["y"] = p2["x"], p2["y"] - 150
K.inbox.clear(); g.snapshots(time.time())
ke = {e[0]: e for e in K.last("g:snap")["e"]}
check(ke.get(H2.uid, [None] * 4)[3] == kind, "killer sees the hider as the prop")

# shooting: a wall in the way stops the bullet
g.ps[k].update(ammo=P.MAG, reload_at=None, shot=0.0)
wx, wy, ww, wh = wall
g.ps[k]["x"], g.ps[k]["y"] = wx - 60, wy + wh / 2
p1["x"], p1["y"], p1["alive"], p1["prop"] = wx + ww + 60, wy + wh / 2, True, None
p1["hist"] = []
K.inbox.clear()
g.on_message(K, "shoot", {"a": 0.0})
shot = K.last("g:shot")
check(shot and shot["hit"] == "wall" and p1["alive"], "walls stop bullets")
check(K.last("g:ammo")["ammo"] == P.MAG - 1, "a shot uses a bullet")
g.on_message(K, "shoot", {"a": 0.0})
check(g.ps[k]["ammo"] == P.MAG - 1, "can't fire faster than the gun allows")

# a clear shot catches; hiders shoot nothing
def clear_line():
    """Put the killer and H1 in the open plaza with a clear line."""
    for ang in range(0, 360, 15):
        a = math.radians(ang)
        kx, ky = cx + math.cos(a) * 120, cy + math.sin(a) * 120
        hx, hy = cx + math.cos(a) * 200, cy + math.sin(a) * 200
        if town.blocked(kx, ky, 20) or town.blocked(hx, hy, 20):
            continue
        dx, dy = (hx - kx), (hy - ky); dd = math.hypot(dx, dy); dx /= dd; dy /= dd
        if any((P.ray_circle(kx, ky, dx, dy, ppx, ppy, ppr) or 1e9) < dd for _, ppx, ppy, ppr in town.props):
            continue
        return kx, ky, hx, hy, math.atan2(dy, dx)
kx, ky, hx, hy, ang = clear_line()
g.ps[k].update(x=kx, y=ky, shot=0.0)
p1.update(x=hx, y=hy)
g.on_message(H1, "shoot", {"a": ang + math.pi})
check(p1["alive"] and g.ps[k]["ammo"] == P.MAG - 1, "hiders can't shoot")
for m in ms: m.inbox.clear()
g.on_message(K, "shoot", {"a": ang})
check(not p1["alive"] and g.r["caught"] == [H1.uid], "a clear shot catches the hider")
cg = A.last("g:caught")
check(cg and cg["pts"] == 1 and cg["left"] == 1 and g.scores[H1.uid] == 1, "first one caught gets 1 point")
check(g.phase == "hunting", "round goes on while someone is still hiding")

# lag: a hider who just moved can still be hit where the killer saw them
p2.update(alive=True, prop=None, x=hx, y=hy)
p2["hist"] = [(time.time() - 0.1, hx, hy)]
p2["x"], p2["y"] = hx + 60, hy + 60
g.ps[k]["shot"] = 0.0
# spectator chat
for m in ms: m.inbox.clear()
handled = g.on_chat(H1, {"from": {}, "text": "they're behind the car!"})
check(handled and W.got("chat") and H1.got("chat") and not H2.got("chat") and not K.got("chat"), "caught players only chat with watchers")
check(not g.on_chat(H2, {"from": {}, "text": "hi"}), "alive players chat normally")
g.on_message(K, "shoot", {"a": ang})
check(not p2["alive"], "a shot where the hider was a moment ago still counts")
check(g.phase == "roundover", "everyone caught ends the round")
last = A.last("g:roundover")["last"]
check(last["why"] == "all" and last["gained"][k] == 10 and last["gained"][H2.uid] == 2, f"killer +10 for catching everyone, 2nd caught +2: {last['gained']}")

# next round: the next killer in the rotation
room.timers.clear()
g.next_round()
check(g.round_no == 2 and g.r["killer"] == g.order[1] and g.r["killer"] != k, "the killer rotates")
check(set(g.ps) == {"a", "b", "c"}, "same players")
k2 = g.r["killer"]
K2 = room.members[k2]
others = [u for u in g.ps if u != k2]
# time runs out with one caught, one survivor
g.phase = "hunting"
g.catch(others[0])
check(g.phase == "hunting", "one caught, one left")
g.end_round("time")
last = A.last("g:roundover")["last"]
check(last["why"] == "time" and last["gained"][k2] == 2 and last["gained"][others[1]] == 3 and last["gained"][others[0]] == 1,
      f"time up: killer 2 per catch, survivor gets 3 (players in the round): {last['gained']}")

# round 3: the killer leaves
room.timers.clear()
g.next_round()
k3 = g.r["killer"]
check(k3 not in (k, k2), "third player is the killer in round 3")
g.phase = "hunting"
g.on_leave(room.members[k3])
check(g.phase == "roundover" and A.last("g:roundover")["last"]["why"] == "killer" and A.last("g:roundover")["last"]["gained"][k3] == 0, "killer leaving ends the round with no killer points")

room.timers.clear()
g.next_round()     # no round 4 -> finish
check(g.phase == "over" and A.last("g:over"), "after everyone was killer once, the game ends")
rk = A.last("g:over")["ranking"]
check(rk == sorted(rk, key=lambda r: -r["points"]), "final ranking sorted by points")
check(room.over and room.over[-1], "the room hears the game finished (votes / party points)")
recs = {u: s for u, o, s in room.hub.records}
check(recs[k].get("prophunt.catches") == ("add", 2) and recs[k].get("prophunt.aces") == ("add", 1), f"killer stats: {recs[k]}")
check(recs[others[1]].get("prophunt.survived") == ("add", 1), "survivor stat")
check(g.listed(), "listed again after the game")

# restart works (the vote's "play again")
g.restart(A)
check(g.phase == "hiding" and g.round_no == 1, "play again starts a new game")
g.on_message(A, "end", {})
check(g.phase == "over", "host can end the game")

# 2 players is enough; 1 is not
room2 = Room([M("x"), M("y")])
g2 = P.PropHunt(room2)
g2.on_message(room2.members["x"], "start", {})
check(g2.phase == "hiding" and len(g2.ps) == 2, "2 players can play")
room3 = Room([M("solo")])
g3 = P.PropHunt(room3)
g3.on_message(room3.members["solo"], "start", {})
check(g3.phase == "lobby" and room3.members["solo"].last("g:toast"), "1 player can't start")

# admin cheats
check(g2.on_admin(room2.members["x"], "xray", {}) and "x" in g2.xray, "xray cheat")
check(g2.on_admin(room2.members["x"], "skip", {}) and g2.phase == "roundover", "skip cheat")

# speed: 10 players, 300 snapshot rounds
ms10 = [M(f"p{i}") for i in range(10)]
r10 = Room(ms10)
g10 = P.PropHunt(r10)
g10.on_message(ms10[0], "start", {})
g10.phase = "hunting"
t0 = time.time()
for _ in range(150):
    g10.snapshots(time.time())
    for m in ms10[1:]:
        p = g10.ps[m.uid]; p["t"] = time.time() - 0.05
        g10.on_message(m, "pos", {"x": p["x"] + 6, "y": p["y"] + 3})
dt = time.time() - t0
check(dt < 1.5, f"10 players, 10 s of play takes {dt:.2f}s of CPU")
print("FAILED:", failed)
