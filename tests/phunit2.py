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



import math, time
ms = [M("a"), M("b"), M("c")]
room = Room(ms)
g = P.PropHunt(room)
A, B, C = ms
g.on_message(A, "settings", {"map": "school", "hide": 15})
check(g.settings["map"] == "school", "map setting")
g.on_message(A, "settings", {"map": "moon"})
check(g.settings["map"] == "school", "unknown maps are ignored")
g.on_message(A, "start", {})
check(g.r["map"]["theme"] == "school" and A.last("g:round")["round"]["theme"] == "school", "the round uses the chosen map")
k = g.r["killer"]; K = room.members[k]
hid = [u for u in g.ps if u != k]; H1 = room.members[hid[0]]; H2 = room.members[hid[1]]
check(A.last("g:round")["you"]["powers"] in ({"decoy": 2, "boost": 1}, {"radar": 1, "grenade": 2}), "you: power-ups in the round message")
town = g.town
# killer can't use powers while hiding; hiders can't use killer powers
g.on_message(K, "power", {"p": "radar"})
check(g.ps[k]["powers"]["radar"] == 1, "no killer powers while the hiders hide")
g.on_message(H1, "power", {"p": "grenade", "x": 0, "y": 0})
check("grenade" not in g.ps[H1.uid]["powers"], "hiders don't have grenades")
# decoy
p1 = g.ps[H1.uid]
g.on_message(H1, "power", {"p": "decoy"})
check(len(g.decoys) == 1 and g.ps[H1.uid]["powers"]["decoy"] == 1 and H1.last("g:powers")["used"] == "decoy", "decoy placed")
g.on_message(H1, "power", {"p": "decoy"})
check(len(g.decoys) == 1, "power-ups have a short cooldown")
p1["power_at"] = 0
g.on_message(H1, "power", {"p": "decoy"})
p1["power_at"] = 0
g.on_message(H1, "power", {"p": "decoy"})
check(len(g.decoys) == 2 and p1["powers"]["decoy"] == 0, "only 2 decoys")
# killer sees the decoy (once hunting, and when near)
g.phase = "hunting"
cx, cy = g.r["map"]["spawn"]
g.ps[k]["x"], g.ps[k]["y"] = p1["x"] + 100, p1["y"]
if town.blocked(g.ps[k]["x"], g.ps[k]["y"]):
    g.ps[k]["x"], g.ps[k]["y"] = p1["x"] - 100, p1["y"]
p1["x"] += 2000      # the real hider walked far away
K.inbox.clear(); H2.inbox.clear()
g.snapshots(time.time())
kd = [e for e in K.last("g:snap")["e"] if e[0].startswith("~")]
check(kd and kd[0][5] == H1.uid and kd[0][6] == 0, "the killer sees the decoy as the hider (not told it's a decoy)")
hd = [e for e in H2.last("g:snap")["e"] if e[0].startswith("~")]
check(all(e[6] == 1 for e in hd), "hiders are told it's a decoy")
# shoot the decoy
did, d = next(iter(g.decoys.items()))
g.ps[k].update(ammo=6, reload_at=None, shot=0.0)
ang = math.atan2(d["y"] - g.ps[k]["y"], d["x"] - g.ps[k]["x"])
for m in ms: m.inbox.clear()
g.on_message(K, "shoot", {"a": ang})
shot = K.last("g:shot")
check(shot["hit"] == "decoy" and did not in g.decoys and A.last("g:decoy")["owner"] == H1.uid and p1["alive"], "shooting a decoy pops it, nobody is caught")
# speed burst lets you move faster
p2 = g.ps[H2.uid]
spot = None
for ang2 in range(0, 360, 10):
    a = math.radians(ang2)
    x0, y0 = cx + math.cos(a) * 150, cy + math.sin(a) * 150
    if all(not town.blocked(x0 + math.cos(a) * s_, y0 + math.sin(a) * s_, 20) for s_ in range(0, 80, 4)):
        spot = (x0, y0, a); break
x0, y0, a = spot
p2.update(x=x0, y=y0, t=time.time() - 0.1, prop=None)
g.on_message(H2, "pos", {"x": x0 + math.cos(a) * 70, "y": y0 + math.sin(a) * 70})
slow = math.hypot(p2["x"] - x0, p2["y"] - y0)
g.on_message(H2, "power", {"p": "boost"})
check(H2.last("g:powers")["boost"] == P.BOOST_TIME, "speed burst")
p2.update(x=x0, y=y0, t=time.time() - 0.1)
g.on_message(H2, "pos", {"x": x0 + math.cos(a) * 70, "y": y0 + math.sin(a) * 70})
fast = math.hypot(p2["x"] - x0, p2["y"] - y0)
check(fast > slow + 5, f"boosted moves are allowed further ({slow:.0f} -> {fast:.0f} px)")
# radar
for m in ms: m.inbox.clear()
nxt = g.r["next_ping"]
g.on_message(K, "power", {"p": "radar"})
check(K.last("g:ping") and K.last("g:ping")["radar"] and g.r["next_ping"] == nxt and H2.last("g:pinged")["radar"], "radar pings now without moving the 30 s timer")
# grenade: a hider in the open gets caught, one behind a wall doesn't
g.ps[k]["power_at"] = 0
kx, ky = x0, y0
g.ps[k]["x"], g.ps[k]["y"] = kx, ky
p2.update(x=x0 + math.cos(a) * 60, y=y0 + math.sin(a) * 60, alive=True, prop=None)
p1.update(x=x0 + 3000, y=y0, alive=True)
for m in ms: m.inbox.clear()
g.on_message(K, "power", {"p": "grenade", "x": p2["x"], "y": p2["y"]})
gr = A.last("g:grenade")
check(gr and abs(gr["x1"] - p2["x"]) < 2 and room.timers, "grenade thrown")
delay, fn, args = room.timers[-1]
check(abs(delay - P.FUSE) < 1e-9, "it goes off after the fuse")
fn(*args)
check(not p2["alive"] and A.last("g:boom") and A.last("g:caught")["id"] == H2.uid, "the blast catches a hider next to it")
check(p1["alive"], "far away hiders are fine")
# a wall protects you
wall = next(w for w in town.walls if w[2] < 30 and w[3] > 200 and 300 < w[0] < town.m["w"] - 300)
wx, wy, ww, wh = wall
p1.update(x=wx + ww + 30, y=wy + wh / 2, alive=True)
g.ps[k]["power_at"] = 0
g.ps[k]["x"], g.ps[k]["y"] = wx - 200, wy + wh / 2
check(g.ps[k]["powers"]["grenade"] == 1, "one grenade left")
g.on_message(K, "power", {"p": "grenade", "x": wx - 40, "y": wy + wh / 2})
delay, fn, args = room.timers[-1]
fn(*args)
check(p1["alive"], "a wall between you and the blast keeps you safe")
g.ps[k]["power_at"] = 0
g.on_message(K, "power", {"p": "grenade", "x": wx - 40, "y": wy + wh / 2})
check(g.ps[k]["powers"]["grenade"] == 0 and len(room.timers) and room.timers[-1][2] == args, "only 2 grenades")
# grenade can't fly through walls
g.ps[k]["powers"]["grenade"] = 1; g.ps[k]["power_at"] = 0
for m in ms: m.inbox.clear()
g.on_message(K, "power", {"p": "grenade", "x": wx + 200, "y": wy + wh / 2})
gr = A.last("g:grenade")
check(gr["x1"] < wx, f"a grenade thrown at a wall lands in front of it ({gr['x1']} < {wx})")
# an old grenade can't go off in the next round
delay, fn, args = room.timers[-1]
g.end_round("skip")
room.timers.clear()
g.next_round()
g.phase = "hunting"
alive_before = len(g.alive_hiders())
fn(*args)
check(len(g.alive_hiders()) == alive_before, "last round's grenade does nothing in the new round")
check(not g.decoys, "decoys are cleared each round")
check(all(p["powers"] == P.POWERS[p["role"]] for p in g.ps.values()), "powers refill every round")
# random maps rotate themes
g2 = P.PropHunt(Room([M("x"), M("y")]))
themes = []
for _ in range(6):
    g2.room.timers.clear()
    if g2.phase in ("lobby", "over"):
        g2.on_message(g2.room.members["x"], "start", {})
    else:
        g2.end_round("skip"); g2.room.timers.clear(); g2.next_round()
    if g2.r: themes.append(g2.r["map"]["theme"])
check(all(a_ != b_ for a_, b_ in zip(themes, themes[1:])), f"mixed maps never repeat back to back: {themes}")
print("FAILED:", failed)
