"""Unit tests for the Billiards core (games/pool_core.py + public/js/games/pool-core.js).

Geometry, pocketing, physics feel (distances, follow/draw/stun, the 30-degree rule, side spin,
jaw rattles), a random stress test (nothing leaves the table, nothing ends overlapping), every
8-ball / 9-ball rule on hand-made positions, Python speed, and a JS-vs-Python check that both
cores give bit-identical results (skipped with a WARN line if node isn't installed)."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]
import json, math, random, shutil, statistics, subprocess, time
from games import pool_core as PC

failed = 0
def check(cond, label):
    global failed
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failed += 1

def info(text):
    print("INFO " + text)

W, H, R, D = PC.W, PC.H, PC.R, PC.D


# ------------------------------------------------------------------ helpers
def unit(x, y):
    l = math.hypot(x, y)
    return x / l, y / l

def mouth_target(p):
    P = PC.POCKETS[p]
    (x1, y1), (x2, y2) = P["mouth"]
    ax, ay = P["axis"]
    return (x1 + x2) / 2 + ax * R, (y1 + y2) / 2 + ay * R

def along(p, dist):
    """The point `dist` back from pocket p's mouth along its axis."""
    tx, ty = mouth_target(p)
    ax, ay = PC.POCKETS[p]["axis"]
    return tx - ax * dist, ty - ay * dist

def ghost(ox, oy, tx, ty):
    ux, uy = unit(tx - ox, ty - oy)
    return ox - ux * D, oy - uy * D

def frame(mode="8ball", balls=(), **kw):
    F = {"mode": mode, "balls": [list(b) for b in balls], "turn": 0, "breaker": 0, "isBreak": False, "open": True,
         "groups": [None, None], "inHand": False, "kitchen": False, "over": False, "winner": None, "reason": "",
         "shots": 5, "visit": {"seat": 0, "potted": [], "start": 5}}
    F.update(kw)
    F["balls"].sort(key=lambda b: b[0])
    return F

def cue_of(F):
    return next(b for b in F["balls"] if b[0] == 0)

def aim(F, x, y, power, sx=0.0, sy=0.0):
    c = cue_of(F)
    return PC.make_shot(F, math.atan2(y - c[2], x - c[1]), power, sx, sy)

def pot_shot(F, bid, p, power, sx=0.0, sy=0.0):
    """Aim the cue at the ghost-ball position that sends ball `bid` into pocket p."""
    b = next(b for b in F["balls"] if b[0] == bid)
    gx, gy = ghost(b[1], b[2], *mouth_target(p))
    return aim(F, gx, gy, power, sx, sy)

def pots(sim):
    return [(e[1], e[2]) for e in sim["events"] if e[0] == "pot"]

def ids_on(F):
    return sorted(b[0] for b in F["balls"])

def in_bounds(x, y):
    if R - 1e-9 <= x <= W - R + 1e-9 and R - 1e-9 <= y <= H - R + 1e-9:
        return True
    p = PC.nearest_pocket(x, y)
    return math.hypot(x - PC.PX[p], y - PC.PY[p]) < PC.POCKETS[p]["r"] + 3 * R

def overlaps(balls):
    bad = 0
    for i in range(len(balls)):
        for j in range(i + 1, len(balls)):
            if math.hypot(balls[i][1] - balls[j][1], balls[i][2] - balls[j][2]) < D - 1e-6:
                bad += 1
    return bad

def random_layout(rs, n, kitchen_cue=False):
    F = frame(balls=[])
    balls = []
    while len(balls) < n:
        x, y = rs.uniform(R, W - R), rs.uniform(R, H - R)
        if PC.valid_placement({"balls": balls, "kitchen": False}, x, y):
            balls.append([len(balls) + 1, x, y])
    while True:
        x, y = rs.uniform(R, W - R), rs.uniform(R, H - R)
        if PC.valid_placement({"balls": balls, "kitchen": kitchen_cue}, x, y):
            break
    F["balls"] = [[0, x, y]] + balls
    return F


# ------------------------------------------------------------------ geometry
check(len(PC.POCKETS) == 6 and len(PC.JAWS) == 12 and len(PC.SEGMENTS) == 18 and len(PC.CUSHIONS) == 6 and len(PC.DIAMONDS) == 18,
      "6 pockets, 12 jaws, 6 cushions = 18 segments, 18 diamonds")
cm = [math.dist(*P["mouth"]) / D for P in PC.POCKETS]
check(all(abs(m - 2.2) < 1e-9 for m in cm[0::3] + cm[2::3]) and abs(cm[1] - 2.4) < 1e-9 and abs(cm[4] - 2.4) < 1e-9,
      f"corner mouths 2.2 ball diameters, side mouths 2.4 ({', '.join(f'{m:.2f}' for m in cm)})")
check(abs(PC.HEAD_X - W / 4) < 1e-12 and PC.FOOT_SPOT == [3 * W / 4, H / 2] and PC.HEAD_SPOT == [W / 4, H / 2], "head string and spots")
sym = True
for a, b, fx, fy in ((0, 2, True, False), (0, 5, False, True), (0, 3, True, True), (1, 4, False, True)):
    A, B = PC.POCKETS[a], PC.POCKETS[b]
    mx = (lambda v: W - v) if fx else (lambda v: v)
    my = (lambda v: H - v) if fy else (lambda v: v)
    sym &= abs(mx(A["x"]) - B["x"]) < 1e-12 and abs(my(A["y"]) - B["y"]) < 1e-12 and A["r"] == B["r"]
    ja = sorted((round(mx(s[0]), 12), round(my(s[1]), 12), round(mx(s[2]), 12), round(my(s[3]), 12)) for s in A["jaws"])
    jb = sorted((round(s[0], 12), round(s[1], 12), round(s[2], 12), round(s[3], 12)) for s in B["jaws"])
    sym &= ja == jb
check(sym, "pockets and jaws are mirror-symmetric")
on_lines = all((abs(s[1]) < 1e-12 and abs(s[3]) < 1e-12) or (abs(s[1] - H) < 1e-12 and abs(s[3] - H) < 1e-12)
               or (abs(s[0]) < 1e-12 and abs(s[2]) < 1e-12) or (abs(s[0] - W) < 1e-12 and abs(s[2] - W) < 1e-12)
               for s in PC.SEGMENTS[1::3])
behind = all(all((x <= 1e-12 or x >= W - 1e-12 or y <= 1e-12 or y >= H - 1e-12) for x, y in (s[:2], s[2:])) for s in PC.JAWS)
check(on_lines and behind, "rails lie on the cushion lines and every jaw runs back behind them")
ca = math.degrees(math.atan2(abs(PC.JAWS[0][3] - PC.JAWS[0][1]), abs(PC.JAWS[0][2] - PC.JAWS[0][0])))
sa = math.degrees(math.atan2(abs(PC.JAWS[2][3] - PC.JAWS[2][1]), abs(PC.JAWS[2][2] - PC.JAWS[2][0])))
check(30 < ca < 50 and 65 < sa < 85, f"corner jaws ~{ca:.0f} deg off the rail, side jaws steeper ~{sa:.0f} deg")
# a ball frozen to both cushion lines next to a pocket is never inside a capture circle, and every capture
# circle reaches past the rail lines
ok = True
for P in PC.POCKETS:
    for x in (R, W / 2, W - R):
        for y in (R, H - R):
            if math.hypot(x - P["x"], y - P["y"]) < P["r"]:
                ok = False
check(ok, "no capture circle reaches a ball touching the cushion lines")
check(all(P["hole"] == P["r"] for P in PC.POCKETS), "pockets expose a drawing radius equal to the capture radius (what you see is where it drops)")


# ------------------------------------------------------------------ pocketing
for p in range(6):
    o = along(p, 0.3)
    c = along(p, 0.75)
    F = frame(balls=[[0, *c], [1, *o]])
    s = PC.simulate(F["balls"], pot_shot(F, 1, p, 0.3, sy=-0.3))
    check((1, p) in pots(s) and all(b != 0 for b, _ in pots(s)), f"straight shot pots the ball in pocket {p}")
for p in (0, 1, 3):
    for cut in (30, 50):
        o = along(p, 0.35)
        ax, ay = PC.POCKETS[p]["axis"]
        gx, gy = ghost(*o, *mouth_target(p))
        a = math.atan2(-ay, -ax) + math.radians(cut if p != 3 else -cut)
        c = (gx + math.cos(a) * 0.5, gy + math.sin(a) * 0.5)
        F = frame(balls=[[0, *c], [1, *o]])
        s = PC.simulate(F["balls"], aim(F, gx, gy, 0.35, sy=0.2))
        check((1, p) in pots(s), f"{cut} deg cut aimed at the ghost ball goes in pocket {p}")
# rolling along a rail into a corner, and past a side pocket
F = frame(balls=[[0, 0.9, R]])
s = PC.simulate(F["balls"], PC.make_shot(F, math.pi, 0.12, 0, 0.8))
check(pots(s) == [(0, 0)], "a ball frozen to the rail rolls into the corner pocket")
F = frame(balls=[[0, 0.9, R + 0.004]])
s = PC.simulate(F["balls"], PC.make_shot(F, math.pi - 0.004, 0.15, 0, 0.8))
check(pots(s) == [(0, 0)], "a ball rolling just off the rail (drifting into it) still drops in the corner")
F = frame(balls=[[0, 0.6, H - R]])
s = PC.simulate(F["balls"], PC.make_shot(F, 0.0, 0.2, 0, 0.8))
check(not any(p == 4 for _, p in pots(s)), "a ball frozen to the rail rolls past the side pocket")
# jaws: scan aims at the corner pocket from the open table; near the axis it drops, aimed at a jaw it
# bounces off, and somewhere in between a ball gets into the jaws and rattles back out
res = []
for k in range(-40, 41):
    off = k * 0.0015
    tx, ty = mouth_target(0)
    sx, sy = 0.5, 0.42
    F = frame(balls=[[0, sx, sy]])
    sim = PC.Sim(F["balls"], aim(F, tx + off, ty - off, 0.35, sy=0.8))
    inside = False
    while not sim.done:
        sim.step()
        if sim.ON[0] and sim.X[0] + sim.Y[0] < PC.CA - 0.002:
            inside = True
    potted = not sim.ON[0]
    res.append((off, potted, inside, sum(1 for e in sim.events if e[0] == "rail" and e[2] < 400)))
check(all(r[1] for r in res if abs(r[0]) < 0.004), "aimed at the middle of the corner pocket it drops")
check(not res[0][1] and not res[-1][1] and res[0][3] > 0 and res[-1][3] > 0, "aimed at a jaw tip it bounces off")
rattles = [r for r in res if r[2] and not r[1]]
check(len(rattles) > 0, f"a ball can rattle in the jaws and stay out ({len(rattles)} of {len(res)} aims)")
info(f"corner pocket accepts {sum(r[1] for r in res)}/{len(res)} aims across +-6 cm")
check(any(r[1] and r[3] > 0 for r in res), "a ball can hit a jaw and still drop")


# ------------------------------------------------------------------ physics feel
def path_len(power, sy=0.0):
    sim = PC.Sim([[0, 0.3, H / 2]], {"x": 0.3, "y": H / 2, "vx": PC.MAX_SPEED * power, "vy": 0.0, "sx": 0.0, "sy": sy})
    L = 0.0
    px, py = sim.X[0], sim.Y[0]
    while not sim.done:
        sim.step()
        L += math.hypot(sim.X[0] - px, sim.Y[0] - py)
        px, py = sim.X[0], sim.Y[0]
    return L / W, sim.time()
lens = {p: path_len(p) for p in (0.05, 0.25, 0.5, 1.0)}
info("cue ball alone, center hit: " + ", ".join(f"power {p}: {l:.2f} table lengths in {t:.1f}s" for p, (l, t) in lens.items()))
check(1.5 <= lens[0.5][0] <= 2.1, f"a medium shot travels 1.5-2 table lengths ({lens[0.5][0]:.2f})")
check(3.4 <= lens[1.0][0] <= 5.2, f"a full power shot travels ~4 table lengths ({lens[1.0][0]:.2f})")
check(lens[0.05][0] < 0.12 and lens[0.05][1] < 2.5, "a soft shot dies naturally")

def roll_after_hit(sy, power, gap):
    cx = 1.2 - gap
    sim = PC.Sim([[0, cx, H / 2], [1, 1.2, H / 2]], {"x": cx, "y": H / 2, "vx": PC.MAX_SPEED * power, "vy": 0.0, "sx": 0.0, "sy": sy})
    hit = False
    while not sim.done:
        ev = sim.step()
        hit = hit or any(e[0] == "hit" for e in ev)
        if hit and abs(sim.VX[0] - sim.RX[0]) < 1e-12:
            return sim.VX[0]
    return 0.0
fol, stun, drw = roll_after_hit(1, 0.5, 0.5), roll_after_hit(-0.2, 0.5, 0.3), roll_after_hit(-1, 0.5, 0.5)
info(f"cue ball speed once rolling again after a full hit: follow {fol:+.2f}, stun {stun:+.2f}, draw {drw:+.2f} m/s")
check(fol > 0.6, "follow: the cue ball rolls on through")
check(abs(stun) < 0.15, "stun: the cue ball stops dead")
check(drw < -0.6, "draw: the cue ball comes back")

def deflection(power):
    sim = PC.Sim([[0, 0.4, H / 2], [1, 1.4, H / 2 + R]], {"x": 0.4, "y": H / 2, "vx": PC.MAX_SPEED * power, "vy": 0.0, "sx": 0.0, "sy": 0.8})
    hit = False
    while not sim.done:
        ev = sim.step()
        hit = hit or any(e[0] == "hit" for e in ev)
        if hit and math.hypot(sim.VX[0] - sim.RX[0], sim.VY[0] - sim.RY[0]) < 1e-12:
            return math.degrees(math.atan2(-sim.VY[0], sim.VX[0]))
    return None
defl = [deflection(p) for p in (0.15, 0.3, 0.5)]
info("rolling cue ball, half-ball hit, final deflection: " + ", ".join(f"{d:.1f} deg" for d in defl))
check(all(d is not None and 27 <= d <= 37 for d in defl), "the 30-degree rule holds for a rolling cue ball")

def rebound(sx):
    s = PC.simulate([[0, 0.6, 0.8]], {"x": 0.6, "y": 0.8, "vx": 2.5, "vy": -2.5, "sx": sx, "sy": 0.0}, record=1)
    k = next(e for e in s["events"] if e[0] == "rail")[2]
    (x1, y1), (x2, y2) = s["frames"][k + 1][:2], s["frames"][k + 40][:2]
    return math.degrees(math.atan2(y2 - y1, x2 - x1))
rb = {sx: rebound(sx) for sx in (-1, 0, 1)}
info("45 deg into a rail, rebound angle off the rail: " + ", ".join(f"side {sx:+d}: {a:.1f}" for sx, a in rb.items()))
check(rb[1] < rb[0] - 5 and rb[-1] > rb[0] + 5, "side spin changes the cushion rebound angle (running english widens it)")

def straight(spin):
    s = PC.simulate([[0, 0.6, H / 2]], {"x": 0.6, "y": H / 2, "vx": -2.0, "vy": 0.0, "sx": spin, "sy": 0.0}, record=1)
    k = next(e for e in s["events"] if e[0] == "rail")[2]
    return s["frames"][k + 80][1] - s["frames"][k + 1][1]
# shooting at the left rail (facing -x) the shooter's right is -y
check(straight(1) < -0.02 and straight(-1) > 0.02 and abs(straight(0)) < 1e-9, "straight into a rail: right english brings it back to the right, left english to the left")

breaks = []
for seed in range(6):
    rs = random.Random(seed)
    F = PC.new_frame("8ball", 0, rs.random)
    cy = H / 2 + (seed - 2.5) * 0.03
    F["balls"][0][2] = cy
    sh = PC.make_shot(F, math.atan2(H / 2 - cy, PC.FOOT_X - PC.HEAD_X), 1.0, 0, 0, PC.HEAD_X - 0.01, cy)
    t0 = time.perf_counter()
    s = PC.simulate(F["balls"], sh)
    ms = (time.perf_counter() - t0) * 1000
    obj = [b for b in s["balls"] if b[0] != 0]
    xs = [b[1] for b in obj]; ys = [b[2] for b in obj]
    railed = len({e[1] for e in s["events"] if e[0] == "rail" and e[1] != 0})
    breaks.append((ms, s["dur"], len(pots(s)), max(xs) - min(xs), max(ys) - min(ys), railed, overlaps(s["balls"])))
info("full power breaks: " + "; ".join(f"{b[0]:.0f}ms {b[1]:.1f}s pots {b[2]} spread {b[3]:.2f}x{b[4]:.2f}m {b[5]} to a rail" for b in breaks))
check(all(b[3] > 0.9 and b[4] > 0.55 and b[5] >= 4 for b in breaks), "a full power break scatters the rack")
check(sum(b[2] for b in breaks) >= 2, "breaks pocket balls now and then")
check(all(b[6] == 0 for b in breaks), "nothing overlaps after a break")
break_ms = max(b[0] for b in breaks)
info(f"Python full power break: {statistics.median(b[0] for b in breaks):.0f} ms median, {break_ms:.0f} ms worst")
check(break_ms < 150, f"a full power break simulates in under 150 ms in Python ({break_ms:.0f} ms)")


# ------------------------------------------------------------------ stress
rs = random.Random(42)
bad_bounds = bad_overlap = bad_events = bad_step = 0
times = []
for n in range(150):
    F = random_layout(rs, rs.randint(1, 15))
    c = cue_of(F)
    sh = {"x": c[1], "y": c[2], "vx": 0.0, "vy": 0.0, "sx": rs.uniform(-1, 1), "sy": rs.uniform(-1, 1)}
    a, sp = rs.uniform(0, 2 * math.pi), PC.MAX_SPEED * rs.uniform(0.05, 1)
    sh["vx"], sh["vy"] = math.cos(a) * sp, math.sin(a) * sp
    if n < 40:
        sim = PC.Sim(F["balls"], sh)
        while not sim.done:
            sim.step()
            for i in range(sim.n):
                if sim.ON[i] and not in_bounds(sim.X[i], sim.Y[i]):
                    x, y = sim.X[i], sim.Y[i]
                    if not (-PC.OB <= x <= W + PC.OB and -PC.OB <= y <= H + PC.OB):
                        bad_step += 1
        s = sim.result()
    else:
        t0 = time.perf_counter()
        s = PC.simulate(F["balls"], sh)
        times.append((time.perf_counter() - t0) * 1000)
    bad_bounds += sum(1 for b in s["balls"] if not in_bounds(b[1], b[2]))
    bad_overlap += overlaps(s["balls"])
    potted = [e[1] for e in s["events"] if e[0] == "pot"]
    if len(potted) != len(set(potted)) or len(potted) + len(s["balls"]) != len(F["balls"]) or s["steps"] > PC.MAX_STEPS:
        bad_events += 1
    if any(not math.isfinite(v) for b in s["balls"] for v in b[1:]):
        bad_events += 1
check(bad_step == 0, "random stress: no ball ever gets beyond the rails while on the table")
check(bad_bounds == 0, f"random stress: every ball ends on the table ({bad_bounds} bad)")
check(bad_overlap == 0, f"random stress: no balls end overlapping ({bad_overlap} bad)")
check(bad_events == 0, "random stress: events and ball counts add up")
times.sort()
med, p90 = statistics.median(times), times[int(len(times) * 0.9)]
info(f"Python random shots: median {med:.1f} ms, 90th percentile {p90:.1f} ms, worst {times[-1]:.1f} ms")
check(med < 60, f"a typical shot simulates in under 60 ms in Python ({med:.1f} ms)")


# ------------------------------------------------------------------ rules: setup helpers
rs = random.Random(7)
F0 = PC.new_frame("8ball", 1, rs.random)
check(len(F0["balls"]) == 16 and ids_on(F0) == list(range(16)), "8-ball rack: cue + 15 balls")
check(F0["isBreak"] and F0["inHand"] and F0["kitchen"] and F0["turn"] == 1 and F0["breaker"] == 1 and F0["open"],
      "new frame: breaker to shoot, ball in hand in the kitchen")
check(cue_of(F0)[1:] == PC.HEAD_SPOT, "cue ball on the head spot")
rk = {b[0]: b for b in F0["balls"] if b[0]}
apex = min(rk.values(), key=lambda b: b[1])
back = sorted((b for b in rk.values() if b[1] > PC.FOOT_X + 3.4 * D), key=lambda b: b[2])
mid = min(rk.values(), key=lambda b: math.hypot(b[1] - (PC.FOOT_X + 2 * (D + PC.RACK_GAP) * math.sqrt(3) / 2), b[2] - H / 2))
check(abs(apex[1] - PC.FOOT_X) < 1e-4 and abs(apex[2] - H / 2) < 1e-4, "apex ball on the foot spot")
check(mid[0] == 8, "the 8 is in the middle of the rack")
check(len(back) == 5 and {PC.group_of(back[0][0]), PC.group_of(back[-1][0])} == {"solids", "stripes"}, "a solid and a stripe in the back corners")
check(overlaps(F0["balls"]) == 0, "no balls overlap in the rack")
orders = {tuple(b[0] for b in sorted(PC.new_frame("8ball", 0, random.Random(s).random)["balls"], key=lambda b: (round(b[1], 3), b[2]))) for s in range(10)}
check(len(orders) > 5, "the rack order is random")
F9 = PC.new_frame("9ball", 0, random.Random(3).random)
r9 = {b[0]: b for b in F9["balls"]}
check(ids_on(F9) == list(range(10)), "9-ball rack: cue + 9 balls")
check(min(r9.values(), key=lambda b: b[1] if b[0] else 9)[0] == 1 and abs(r9[1][1] - PC.FOOT_X) < 1e-4, "9-ball: the 1 on the foot spot")
check(abs(r9[9][1] - (PC.FOOT_X + 2 * (D + PC.RACK_GAP) * math.sqrt(3) / 2)) < 1e-4 and abs(r9[9][2] - H / 2) < 1e-4, "9-ball: the 9 in the middle")

# placement + shot building
Fp = frame(balls=[[0, 1.0, 0.5], [1, 0.4, 0.5]], inHand=True, kitchen=True)
check(PC.valid_placement(Fp, 0.3, 0.3), "valid placement in the kitchen")
check(not PC.valid_placement(Fp, 0.8, 0.3), "kitchen: can't place past the head string")
check(not PC.valid_placement(Fp, 0.4 + D, 0.5) and PC.valid_placement(Fp, 0.4 + D + 2e-4, 0.5), "can't place overlapping a ball")
check(PC.valid_placement(Fp, R, 0.5) and not PC.valid_placement(Fp, R - 1e-4, 0.5), "must be inside the cushions by a radius")
check(not PC.valid_placement(Fp, R, R) and not PC.valid_placement(Fp, None, 0.5), "can't place in a pocket mouth / without a number")
Fp["kitchen"] = False
check(PC.valid_placement(Fp, 1.5, 0.8), "ball in hand anywhere")
sh = PC.make_shot(Fp, 0.0, 5, 3, 3, 0.3, 0.3)
check(sh["x"] == 0.3 and sh["y"] == 0.3 and abs(sh["vx"] - PC.MAX_SPEED) < 1e-12 and abs(sh["sx"] ** 2 + sh["sy"] ** 2 - 1) < 1e-12,
      "makeShot: ball in hand position, power clamped to 1, spin clamped to the ball")
sh = PC.make_shot(Fp, math.pi / 2, 0, 0, 0, 0.4, 0.5)
check(sh["x"] == 1.0 and abs(sh["vy"] - PC.MAX_SPEED * 0.02) < 1e-12, "makeShot: invalid placement keeps the cue ball, power at least 0.02")
Fp["inHand"] = False
check(PC.make_shot(Fp, 0, 0.5, 0, 0, 0.3, 0.3)["x"] == 1.0, "makeShot: no ball in hand, no moving the cue ball")


# ------------------------------------------------------------------ rules: 8-ball
crafted = []          # (frame, shot) pairs, replayed in JS too
def play(F, shot):
    crafted.append((F, shot))
    o = PC.apply_shot(F, shot)
    return o["frame"], o["result"]

# break: no hit
F = PC.new_frame("8ball", 0, random.Random(1).random)
F2, r = play(F, PC.make_shot(F, math.pi, 0.15))
check(r["foul"] and r["reason"] == "nohit" and F2["turn"] == 1 and F2["inHand"] and not F2["kitchen"] and not F2["isBreak"],
      "8-ball break that hits nothing: foul, ball in hand anywhere")
# break: a real break
sh = PC.make_shot(F, 0.0, 1.0, 0, -0.2)
F2, r = play(F, sh)
check(not F2["isBreak"] and F2["open"] and F2["groups"] == [None, None] and F2["shots"] == 1 and r["first"] is not None,
      f"8-ball break: table stays open (potted {r['potted']}, {'again' if r['again'] else 'turn over'})")
check(r["again"] == (bool([i for i in r["potted"] if i]) and not r["foul"]), "8-ball break: shooter continues if a ball dropped and no foul")
# break scratch -> kitchen
F = frame(balls=[[0, *along(0, 0.4)], [1, 1.7, 0.56], [9, 1.75, 0.6]], isBreak=True)
F2, r = play(F, aim(F, *mouth_target(0), 0.3))
check(r["reason"] == "scratch" and F2["turn"] == 1 and F2["inHand"] and F2["kitchen"] and cue_of(F2)[1] <= PC.HEAD_X,
      "8-ball break scratch: opponent gets ball in hand in the kitchen")
# 8 on the break is respotted, counts as a pocketed ball
F = frame(balls=[[0, *along(1, 0.7)], [8, *along(1, 0.3)], [3, 1.0, 0.9], [12, 0.5, 0.3]], isBreak=True)
F2, r = play(F, pot_shot(F, 8, 1, 0.3, sy=-0.4))
e8 = next((b for b in F2["balls"] if b[0] == 8), None)
check(8 in r["potted"] and e8 and abs(e8[1] - PC.FOOT_X) < 1e-12 and abs(e8[2] - H / 2) < 1e-12 and not r["foul"] and r["again"]
      and not r["over"] and F2["open"], "8 on the break: respotted on the foot spot, shooter continues")
F = frame(balls=[[0, *along(1, 0.7)], [8, *along(1, 0.3)], [5, PC.FOOT_X, H / 2], [12, 0.5, 0.3]], isBreak=True)
F2, r = play(F, pot_shot(F, 8, 1, 0.3, sy=-0.4))
e8 = next((b for b in F2["balls"] if b[0] == 8), None)
check(8 in r["potted"] and e8 and PC.FOOT_X + D < e8[1] < PC.FOOT_X + D + R and abs(e8[2] - H / 2) < 1e-12,
      "8 on the break with the foot spot taken: respotted right behind it")
# open table
F = frame(balls=[[0, 0.6, 0.56], [8, 1.12, 0.56], [1, 0.3, 0.2], [9, 0.3, 0.9]])
F2, r = play(F, aim(F, 1.12, 0.56, 0.25))
check(r["foul"] and r["reason"] == "wrong" and r["first"] == 8 and F2["turn"] == 1 and F2["inHand"] and not F2["kitchen"],
      "open table: hitting the 8 first is a foul, ball in hand anywhere")
F = frame(balls=[[0, *along(3, 0.8)], [11, *along(3, 0.3)], [1, 0.3, 0.2], [8, 0.5, 0.9]], visit={"seat": 0, "potted": [], "start": 5})
F2, r = play(F, pot_shot(F, 11, 3, 0.3, sy=-0.4))
check(r["assigned"] == "stripes" and F2["groups"] == ["stripes", "solids"] and not F2["open"] and r["again"] and F2["turn"] == 0
      and F2["visit"]["potted"] == [11], "open table: first ball potted decides the groups, shooter continues")
# assigned groups
F = frame(balls=[[0, 0.6, 0.56], [10, 1.12, 0.56], [1, 0.3, 0.2], [8, 0.5, 0.9]], open=False, groups=["solids", "stripes"])
F2, r = play(F, aim(F, 1.12, 0.56, 0.3))
check(r["reason"] == "wrong" and F2["turn"] == 1 and F2["inHand"], "hitting an opponent's ball first is a foul")
F = frame(balls=[[0, 1.1, 0.56], [2, 1.2, 0.56], [8, 0.3, 0.2], [12, 0.3, 0.9]], open=False, groups=["solids", "stripes"])
F2, r = play(F, aim(F, 1.2, 0.56, 0.05))
check(r["reason"] == "norail" and r["first"] == 2 and F2["turn"] == 1 and F2["inHand"], "nothing potted and no rail after contact: foul")
F2, r = play(F, aim(F, 1.2, 0.56, 0.3))
check(not r["foul"] and not r["again"] and F2["turn"] == 1 and not F2["inHand"] and F2["visit"] == {"seat": 1, "potted": [], "start": 6},
      "legal miss: the turn passes, no ball in hand")
F = frame(balls=[[0, *along(5, 0.8)], [4, *along(5, 0.3)], [8, 1.2, 0.3], [12, 1.5, 0.9], [3, 1.7, 0.2]], open=False,
          groups=["solids", "stripes"], visit={"seat": 0, "potted": [1, 2], "start": 3})
F2, r = play(F, pot_shot(F, 4, 5, 0.3, sy=-0.4))
check(r["potted"] == [4] and r["again"] and F2["turn"] == 0 and F2["visit"] == {"seat": 0, "potted": [1, 2, 4], "start": 3},
      "pot your own ball: shooter continues and the visit adds up")
F = frame(balls=[[0, *along(5, 0.8)], [12, *along(5, 0.3)], [8, 1.2, 0.3], [3, 1.7, 0.2]], open=False, groups=["solids", "stripes"])
F2, r = play(F, pot_shot(F, 12, 5, 0.3, sy=-0.4))
check(r["reason"] == "wrong" and 12 not in ids_on(F2) and F2["turn"] == 1, "balls pocketed on a foul stay down")
F = frame(balls=[[0, *along(0, 0.5)], [3, *along(0, 0.25)], [8, 1.2, 0.3], [12, 1.7, 0.9]], open=False, groups=["solids", "stripes"])
F2, r = play(F, pot_shot(F, 3, 0, 0.5, sy=1))
check(r["reason"] == "scratch" and 3 not in ids_on(F2) and 0 in ids_on(F2) and F2["turn"] == 1 and F2["inHand"] and not F2["kitchen"],
      "scratch: foul, the potted ball stays down, the cue ball comes back for the opponent's ball in hand")
# on the 8
Fon = dict(open=False, groups=["solids", "stripes"])
F = frame(balls=[[0, 0.6, 0.56], [10, 1.12, 0.56], [8, 0.3, 0.2], [12, 1.7, 0.9]], **Fon)
F2, r = play(F, aim(F, 1.12, 0.56, 0.3))
check(r["reason"] == "wrong" and not r["over"], "on the 8: the 8 must be hit first")
F = frame(balls=[[0, *along(1, 0.7)], [8, *along(1, 0.3)], [10, 1.7, 0.9], [12, 0.3, 0.9]], **Fon)
F2, r = play(F, pot_shot(F, 8, 1, 0.3, sy=-0.4))
check(r["over"] and r["winner"] == 0 and r["win"] == "eight" and F2["over"] and F2["winner"] == 0 and F2["reason"] == "eight",
      "on the 8: pocketing it wins the frame")
check(not r["runout"], "not a run-out without the whole group in the visit")
F = frame(balls=[[0, *along(1, 0.7)], [8, *along(1, 0.3)], [10, 1.7, 0.9]], visit={"seat": 0, "potted": [1, 2, 3, 4, 5, 6, 7], "start": 1}, **Fon)
F2, r = play(F, pot_shot(F, 8, 1, 0.3, sy=-0.4))
check(r["win"] == "eight" and r["runout"], "all 7 + the 8 in one visit is a run-out")
F = frame(balls=[[0, *along(0, 0.45)], [8, *along(0, 0.25)], [10, 1.7, 0.9]], **Fon)
F2, r = play(F, pot_shot(F, 8, 0, 0.6, sy=1))
check(r["over"] and r["winner"] == 1 and r["win"] == "scratch8" and r["foul"], "on the 8: pocketing it with a scratch loses")
F = frame(balls=[[0, *along(1, 0.7)], [8, *along(1, 0.3)], [10, 1.7, 0.9], [2, 0.3, 0.3]], **Fon)
F2, r = play(F, pot_shot(F, 8, 1, 0.3, sy=-0.4))
check(r["over"] and r["winner"] == 1 and r["win"] == "foul8" and r["reason"] == "wrong", "the 8 potted on a foul (not on it, hit it first) loses")
ax, ay = PC.POCKETS[1]["axis"]
F = frame(balls=[[0, *along(1, 0.8)], [8, *along(1, 0.2)], [2, *along(1, 0.2 + D + 0.004)], [10, 1.7, 0.9]], **Fon)
F2, r = play(F, aim(F, *along(1, 0.2 + 2 * D + 0.004), 0.4, sy=-0.3))
check(r["first"] == 2 and not r["foul"] and r["over"] and r["winner"] == 1 and r["win"] == "early8", "pocketing the 8 early (legal hit) loses")
# timeouts
F = frame(balls=[[0, 0.6, 0.56], [1, 1.0, 0.5]], turn=1, shots=9, visit={"seat": 1, "potted": [3], "start": 7})
F2 = PC.timeout_foul(F)
check(F2["turn"] == 0 and F2["inHand"] and not F2["kitchen"] and F2["visit"] == {"seat": 0, "potted": [], "start": 9} and F2["shots"] == 9,
      "timeout: foul, opponent gets ball in hand anywhere")
crafted_timeouts = [F]
F = PC.new_frame("8ball", 0, random.Random(5).random)
F2 = PC.timeout_foul(F)
check(F2["turn"] == 1 and F2["breaker"] == 0 and F2["inHand"] and F2["kitchen"] and F2["isBreak"] and F2["visit"] == {"seat": 1, "potted": [], "start": 0},
      "timeout on the break: the opponent breaks from the kitchen (F.breaker unchanged)")
crafted_timeouts.append(F)
check(PC.apply_shot(dict(F2, over=True), PC.make_shot(F2, 0, 0.5))["result"] is None, "no shots after the frame is over")

# ------------------------------------------------------------------ rules: 9-ball
F = frame("9ball", balls=[[0, 0.6, 0.56], [3, 1.12, 0.56], [2, 0.3, 0.2], [9, 1.7, 0.9]])
F2, r = play(F, aim(F, 1.12, 0.56, 0.3))
check(r["reason"] == "wrong" and F2["turn"] == 1 and F2["inHand"] and not F2["kitchen"], "9-ball: the lowest ball must be hit first")
F = frame("9ball", balls=[[0, *along(1, 0.8)], [9, *along(1, 0.2)], [2, *along(1, 0.2 + D + 0.004)], [5, 1.7, 0.9]])
F2, r = play(F, aim(F, *along(1, 0.2 + 2 * D + 0.004), 0.4, sy=-0.3))
check(r["first"] == 2 and r["over"] and r["winner"] == 0 and r["win"] == "nine" and not r["runout"], "9-ball: a combination on the 9 wins")
F = frame("9ball", balls=[[0, *along(1, 0.8)], [9, *along(1, 0.2)], [4, *along(1, 0.2 + D + 0.004)], [2, 1.7, 0.9]])
F2, r = play(F, aim(F, *along(1, 0.2 + 2 * D + 0.004), 0.4, sy=-0.3))
n9 = next((b for b in F2["balls"] if b[0] == 9), None)
check(r["reason"] == "wrong" and 9 in r["potted"] and n9 and abs(n9[1] - PC.FOOT_X) < 1e-12 and not r["over"] and F2["turn"] == 1 and F2["inHand"],
      "9-ball: the 9 pocketed on a foul is respotted")
F = frame("9ball", balls=[[0, *along(3, 0.8)], [2, *along(3, 0.3)], [5, 0.4, 0.3], [9, 1.2, 0.9]])
F2, r = play(F, pot_shot(F, 2, 3, 0.3, sy=-0.4))
check(r["potted"] == [2] and r["again"] and F2["turn"] == 0, "9-ball: any ball pocketed legally, shooter continues")
F = frame("9ball", balls=[[0, 1.1, 0.56], [2, 1.2, 0.56], [9, 0.3, 0.2]])
F2, r = play(F, aim(F, 1.2, 0.56, 0.05))
check(r["reason"] == "norail", "9-ball: no rail after contact is a foul")
F = frame("9ball", balls=[[0, *along(0, 0.4)], [1, 1.7, 0.56], [9, 1.75, 0.6]], isBreak=True)
F2, r = play(F, aim(F, *mouth_target(0), 0.3))
check(r["reason"] == "scratch" and F2["inHand"] and not F2["kitchen"], "9-ball break scratch: ball in hand anywhere")
F = frame("9ball", balls=[[0, *along(1, 0.8)], [9, *along(1, 0.2)], [1, *along(1, 0.2 + D + 0.004)], [5, 1.7, 0.9]],
          isBreak=True, shots=0, visit={"seat": 0, "potted": [], "start": 0})
F2, r = play(F, aim(F, *along(1, 0.2 + 2 * D + 0.004), 0.4, sy=-0.3))
check(r["win"] == "nine" and r["winner"] == 0 and r["runout"], "9-ball: the 9 on the break wins (break-and-run)")
F = PC.new_frame("9ball", 1, random.Random(11).random)
F2, r = play(F, PC.make_shot(F, 0.0, 1.0, 0, -0.1))
check(r["first"] == 1 and not F2["isBreak"], f"9-ball break hits the 1 first ({r['potted']} {r['reason']})")


# ------------------------------------------------------------------ regressions (verifier findings)
regress = []
# makeShot uses its own polynomial sin/cos: accurate, and bit-identical across languages (cross-check below)
mx = max(max(abs(PC.sincos(a)[0] - math.sin(a)), abs(PC.sincos(a)[1] - math.cos(a))) for a in [k * 0.001 - 20 for k in range(40001)])
check(mx < 1e-15, f"sincos matches math.sin/cos to {mx:.1e}")
# junk input never raises in Python and stays cheap (JS does the same, see the cross-check cases)
Fj = frame(balls=[[0, 0.5, 0.56], [1, 1.5, 0.56]], inHand=True)
ok = True
try:
    ok &= PC.valid_placement(Fj, 10 ** 400, 0.5) is False and PC.valid_placement(Fj, 0.5, -10 ** 400) is False
    ok &= PC.make_shot(Fj, 10 ** 400, 10 ** 400, 10 ** 400, 0, 10 ** 400, 0.5)["vx"] == PC.MAX_SPEED * 0.02
    ok &= PC.simulate(Fj["balls"], {"x": 0.5, "y": 0.56, "vx": 1e200, "vy": 0, "sx": 0, "sy": 0})["steps"] < PC.MAX_STEPS
except (OverflowError, ValueError) as e:
    ok = False
    info(f"raised {e!r}")
check(ok, "huge integers and velocities: no OverflowError, placement refused, angle 0 / power 0.02, speed capped")
t0 = time.perf_counter()
o = PC.apply_shot(Fj, {"x": 0.5, "y": 0.56, "vx": float("nan"), "vy": 0, "sx": float("inf"), "sy": 0})
ms = (time.perf_counter() - t0) * 1000
check(o["sim"]["steps"] == 0 and all(math.isfinite(v) for b in o["frame"]["balls"] for v in b[1:]) and ms < 20,
      f"a NaN velocity is a zero-speed shot: no 40 s run, no NaN in the frame ({ms:.1f} ms)")
o = PC.apply_shot(Fj, {"x": 0.5, "y": 0.56, "vx": 50.0, "vy": 0, "sx": 0, "sy": 0})
check(o["sim"]["steps"] < PC.MAX_STEPS and len(o["sim"]["balls"]) + len(pots(o["sim"])) == 2, "a 50 m/s shot is capped and simulates normally")
# the drawn hole is the capture circle: a ball resting on a pocket lip has its centre outside the hole
lip = 0
for k in range(400):
    rr = random.Random(k)
    p = k % 6
    tx, ty = mouth_target(p)
    c = along(p, rr.uniform(0.15, 0.6))
    sp = rr.uniform(0.25, 0.7)
    a = math.atan2(ty - c[1], tx - c[0]) + rr.uniform(-0.12, 0.12)
    sim = PC.simulate([[0, *c]], {"x": c[0], "y": c[1], "vx": math.cos(a) * sp, "vy": math.sin(a) * sp, "sx": 0, "sy": 0.8})
    for b in sim["balls"]:
        Pq = PC.POCKETS[PC.nearest_pocket(b[1], b[2])]
        if math.hypot(b[1] - Pq["x"], b[2] - Pq["y"]) < Pq["hole"]:
            lip += 1
check(lip == 0, f"no ball comes to rest with its centre over a drawn hole ({lip} of 400 slow pocket shots)")
# pocket jaws: soft hits die in the jaws and drop, hard hits rattle out more
def jaw_sweep(speed):
    ok = 0
    for k in range(-30, 31):
        off = k * 0.0012
        tx, ty = mouth_target(0)
        F = frame(balls=[[0, 0.5, 0.42]])
        dx, dy = tx + off - 0.5, ty - off - 0.42
        l = math.hypot(dx, dy)
        s = PC.simulate(F["balls"], {"x": 0.5, "y": 0.42, "vx": dx / l * speed, "vy": dy / l * speed, "sx": 0, "sy": 0.8})
        ok += any(e[0] == "pot" and e[1] == 0 and e[2] == 0 for e in s["events"])
    return ok
acc = [jaw_sweep(v) for v in (1.0, 3.0, 6.5)]
check(acc[0] > acc[1] > acc[2], f"corner pocket gets tighter with speed: {acc[0]}/{acc[1]}/{acc[2]} of 61 aims drop at 1/3/6.5 m/s")
# the break is played at BREAK_SPEED and pots about a ball
bp = []
for seed in range(24):
    rr = random.Random(100 + seed)
    F = PC.new_frame("8ball", 0, rr.random)
    cx, cy = PC.HEAD_X - 0.05 - rr.random() * 0.2, 0.2 + rr.random() * 0.72
    apex = min((b for b in F["balls"] if b[0]), key=lambda b: b[1])
    sh = PC.make_shot(F, math.atan2(apex[2] - cy, apex[1] - cx) + (rr.random() - 0.5) * 0.01, 1.0, 0, (rr.random() - 0.5) * 0.4, cx, cy)
    bp.append(len([e for e in PC.simulate(F["balls"], sh)["events"] if e[0] == "pot" and e[1] != 0]))
check(abs(math.hypot(sh["vx"], sh["vy"]) - PC.BREAK_SPEED) < 1e-9 and statistics.mean(bp) >= 0.7,
      f"full power break at {PC.BREAK_SPEED} m/s pots {statistics.mean(bp):.2f} balls on average")
# the cue ball reaching two balls in one substep: the one it reached first is `first`
for off in (0.0005, 0.004, 0.008):
    c12 = 1.0 - math.sqrt(D * D - R * R)
    x3 = c12 + off + math.sqrt(D * D - (R + 1e-3) ** 2)
    F = frame(balls=[[0, 0.5, 0.5], [3, x3, 0.5 - R - 1e-3], [12, 1.0, 0.5 + R], [8, 0.3, 1.0]], open=False, groups=["stripes", "solids"])
    sh = {"x": 0.5, "y": 0.5, "vx": 4.5, "vy": 0.0, "sx": 0.0, "sy": 0.0}
    F2, r = play(F, sh)
    hits = [e for e in PC.simulate(F["balls"], sh)["events"] if e[0] == "hit"]
    check(r["first"] == 12 and r["reason"] is None and hits[0][2] == 12 and hits[0][4] > hits[1][4],
          f"split hit: ball 12 reached {off * 1000:.1f} mm of travel before ball 3 is the first ball (and takes the full hit)")
    regress.append((F, sh))
# a cushion the cue ball reached before its first contact, in the same substep, is not 'a rail after contact'
F = frame(balls=[[0, 0.52, 0.108575], [3, 0.6573149936531555, 0.030574999999999998], [8, 1.6, 0.9], [12, 1.8, 0.3]], open=False,
          groups=["solids", "stripes"])
sh = {"x": 0.52, "y": 0.108575, "vx": 0.6363961030678927, "vy": -0.6363961030678927, "sx": 0, "sy": -0.5}
F2, r = play(F, sh)
ev = [e[0] for e in PC.simulate(F["balls"], sh)["events"]][:2]
check(r["reason"] == "norail" and ev == ["rail", "hit"], f"rail then ball in one substep: the rail comes first and no rail after contact is a foul ({ev})")
regress.append((F, sh))
# two pots in one substep come out in the order the balls dropped
ev = [["pot", 5, 0, 9], ["hit", 1, 2, 9, 1.0], ["pot", 7, 3, 9]]
PC._order_pots(ev, [0.0001, 0, 0.0002, 2])
check(ev == [["pot", 7, 3, 9], ["hit", 1, 2, 9, 1.0], ["pot", 5, 0, 9]], "pots in one substep are ordered by when they dropped")
# visit.start null / missing is treated as 0 in both languages
F = frame("9ball", balls=[[0, *along(1, 0.7)], [9, *along(1, 0.3)]], shots=6, visit={"seat": 0, "potted": [1, 2], "start": None})
F2, r = play(F, pot_shot(F, 9, 1, 0.35, sy=-0.3))
check(r["win"] == "nine" and r["runout"] and F2["visit"]["start"] == 0, "visit.start null counts as 0")
regress.append((F, pot_shot(F, 9, 1, 0.35, sy=-0.3)))
# an open table with only the 8 left: the 8 is the ball on, and potting it legally wins
F = frame(balls=[[0, *along(1, 0.7)], [8, *along(1, 0.3)]], open=True)
F2, r = play(F, pot_shot(F, 8, 1, 0.35, sy=-0.3))
check(not r["foul"] and r["win"] == "eight" and r["winner"] == 0 and not r["runout"], "open table with only the 8 left: potting it legally wins")
regress.append((F, pot_shot(F, 8, 1, 0.35, sy=-0.3)))
F = frame(balls=[[0, *along(1, 0.7)], [8, *along(1, 0.3)], [11, 1.8, 0.9]], open=True)
F2, r = play(F, pot_shot(F, 8, 1, 0.35, sy=-0.3))
check(r["reason"] == "wrong" and r["win"] == "foul8", "open table with group balls left: the 8 first is still a foul")
regress.append((F, pot_shot(F, 8, 1, 0.35, sy=-0.3)))
# 9-ball: a break-and-run by the player who broke after the opponent's break timeout is a run-out
F = PC.timeout_foul(PC.new_frame("9ball", 0, random.Random(3).random))
F["balls"] = [[0, *along(1, 0.8)], [9, *along(1, 0.2)], [1, *along(1, 0.2 + D + 0.004)], [5, 1.7, 0.9]]
F2, r = play(F, aim(F, *along(1, 0.2 + 2 * D + 0.004), 0.4, sy=-0.3))
check(r["win"] == "nine" and r["winner"] == 1 and r["runout"] and F2["breaker"] == 0, "9-ball: break-and-run after a break timeout counts for the player who broke")
regress.append((F, aim(F, *along(1, 0.2 + 2 * D + 0.004), 0.4, sy=-0.3)))


# ------------------------------------------------------------------ JS vs Python, bit for bit
def canon(v):
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        return "0.0" if f == 0 else repr(f)
    if isinstance(v, dict):
        return {k: canon(x) for k, x in sorted(v.items())}
    if isinstance(v, (list, tuple)):
        return [canon(x) for x in v]
    return repr(v)

def list_rand(vals):
    it = iter(vals)
    return lambda: next(it)

def step_all(balls, shot):
    sim = PC.Sim(balls, shot)
    events = []
    while not sim.done:
        events += sim.step()
    r = sim.result()
    return {"balls": r["balls"], "events": events, "steps": r["steps"], "dur": r["dur"]}

def run_py(c):
    t = c["t"]
    if t == "geom":
        return {"W": W, "H": H, "R": R, "D": D, "HEAD_X": PC.HEAD_X, "FOOT_X": PC.FOOT_X, "HEAD_SPOT": PC.HEAD_SPOT, "FOOT_SPOT": PC.FOOT_SPOT,
                "DT": PC.DT, "MAX_SPEED": PC.MAX_SPEED, "BREAK_SPEED": PC.BREAK_SPEED, "SHOT_CAP": PC.SHOT_CAP, "CORNER_MOUTH": PC.CORNER_MOUTH, "SIDE_MOUTH": PC.SIDE_MOUTH,
                "POCKETS": PC.POCKETS, "JAWS": PC.JAWS, "CUSHIONS": PC.CUSHIONS, "SEGMENTS": PC.SEGMENTS, "DIAMONDS": PC.DIAMONDS,
                "CONST": {k: getattr(PC, k) for k in ("G", "MU_S", "MU_R", "DRAG", "SIDE_DECAY", "E_BALL", "E_CUSH", "E_CUSH_DROP",
                                                       "E_CUSH_MIN", "CUSH_T", "CUSH_K", "CUSH_SPIN", "SUB", "RACK_GAP", "RACK_JIT",
                                                       "JAW_E0", "JAW_EK", "JAW_EMAX")}}
    if t == "sim":
        return PC.simulate(c["balls"], c["shot"], c.get("opts"))
    if t == "step":
        return step_all(c["balls"], c["shot"])
    if t == "frame":
        return PC.new_frame(c["mode"], c["breaker"], list_rand(c["rands"]))
    if t == "apply":
        o = PC.apply_shot(c["frame"], c["shot"])
        return {"frame": o["frame"], "result": o["result"], "sim": o["sim"]}
    if t == "seq":
        F = PC.new_frame(c["mode"], c["breaker"], list_rand(c["rands"]))
        out = [F]
        for s in c["shots"]:
            o = PC.apply_shot(F, s)
            out.append({"frame": o["frame"], "result": o["result"], "sim": o["sim"]})
            F = o["frame"]
        return out
    if t == "timeout":
        return PC.timeout_foul(c["frame"])
    if t == "valid":
        return [PC.valid_placement(c["frame"], p[0], p[1]) for p in c["pts"]]
    if t == "shot":
        return [PC.make_shot(c["frame"], *a) for a in c["args"]]
    raise ValueError(t)

def random_shot(rs, F):
    cx = cy = None
    if F["inHand"]:
        for _ in range(200):
            x, y = rs.uniform(R, (PC.HEAD_X if F["kitchen"] else W - R)), rs.uniform(R, H - R)
            if PC.valid_placement(F, x, y):
                cx, cy = x, y
                break
    c = cue_of(F)
    px, py = (cx, cy) if cx is not None else (c[1], c[2])
    objs = [b for b in F["balls"] if b[0] != 0]
    if objs and rs.random() < 0.7:
        b = rs.choice(objs)
        ang = math.atan2(b[2] - py, b[1] - px) + rs.gauss(0, 0.03)
    else:
        ang = rs.uniform(-math.pi, math.pi)
    return PC.make_shot(F, ang, rs.uniform(0.05, 1.0), rs.uniform(-1, 1), rs.uniform(-1, 1), cx, cy)

rs = random.Random(2024)
cases = [{"t": "geom"}, {"t": "valid", "frame": frame(balls=[[0, 0.3, 0.3]]), "pts": [[10 ** 400, 0.5], [0.3, -10 ** 400], [10 ** 20, 0.5]]},
         {"t": "sim", "balls": [[0, 0.5, 0.56], [1, 1.5, 0.56]], "shot": {"x": 0.5, "y": 0.56, "vx": 1e200, "vy": -1e200, "sx": 1e300, "sy": -5}},
         {"t": "sim", "balls": [[0, 0.5, 0.56], [1, 1.5, 0.56]], "shot": {"x": 10 ** 400, "y": 0.56, "vx": 10 ** 400, "vy": 3, "sx": "a", "sy": None}}]
for n in range(160):                       # random racks, breaks at all powers / spins
    mode = "9ball" if n % 3 == 0 else "8ball"
    rands = [rs.random() for _ in range(60)]
    cases.append({"t": "frame", "mode": mode, "breaker": n % 2, "rands": rands})
    F = PC.new_frame(mode, n % 2, list_rand(rands))
    cy = H / 2 + rs.uniform(-0.25, 0.25)
    cx = rs.uniform(0.2, PC.HEAD_X - 0.01)
    ang = math.atan2(H / 2 - cy, PC.FOOT_X - cx) + rs.gauss(0, 0.01)
    shot = PC.make_shot(F, ang, rs.uniform(0.02, 1.0) if n % 4 else 1.0, rs.uniform(-1, 1), rs.uniform(-1, 1), cx, cy)
    cases.append({"t": "sim", "balls": F["balls"], "shot": shot, "opts": {"record": 50} if n % 10 == 0 else None})
for n in range(70):                        # whole frames: break + follow-up shots through applyShot
    mode = "9ball" if n % 2 else "8ball"
    rands = [rs.random() for _ in range(60)]
    F = PC.new_frame(mode, n % 2, list_rand(rands))
    shots = []
    for k in range(rs.randint(2, 5)):
        if F["over"]:
            break
        s = random_shot(rs, F)
        if k == 0:
            s = PC.make_shot(F, rs.gauss(0, 0.01), rs.uniform(0.5, 1.0), rs.uniform(-0.5, 0.5), rs.uniform(-0.5, 0.5))
        shots.append(s)
        F = PC.apply_shot(F, s)["frame"]
        if rs.random() < 0.1:
            cases.append({"t": "timeout", "frame": F})
    cases.append({"t": "seq", "mode": mode, "breaker": n % 2, "rands": rands, "shots": shots})
for n in range(40):                        # random layouts, random shots, and the steppable Sim
    F = random_layout(rs, rs.randint(1, 15))
    s = random_shot(rs, F)
    cases.append({"t": "sim", "balls": F["balls"], "shot": s})
    if n % 4 == 0:
        cases.append({"t": "step", "balls": F["balls"], "shot": s})
for F, s in crafted:                       # every hand-made rules position above
    cases.append({"t": "apply", "frame": F, "shot": s})
for F in crafted_timeouts:
    cases.append({"t": "timeout", "frame": F})
for F, s in regress:                       # the regression positions below
    cases.append({"t": "apply", "frame": F, "shot": s})
for n in range(12):                        # makeShot (own sin/cos) on random and awkward angles
    F = random_layout(rs, 6, kitchen_cue=True)
    F["inHand"] = n % 2 == 0
    F["isBreak"] = n % 3 == 0
    args = [[rs.uniform(-7, 7), rs.uniform(-0.2, 1.2), rs.uniform(-1.5, 1.5), rs.uniform(-1.5, 1.5),
             rs.uniform(0, PC.HEAD_X), rs.uniform(0, H)] for _ in range(100)]
    args += [[a, 1, 0, 0, None, None] for a in (0, 0.0, -0.0, math.pi, -math.pi, math.pi / 2, -math.pi / 2, math.pi / 4, 3 * math.pi / 4,
                                                 2 * math.pi, 1e6, -1e6, 1e15, 1e300, -2.2973572091724623, 10 ** 30)]
    args += [[0.3, 10 ** 400, 10 ** 400, -10 ** 400, 10 ** 400, 0.5], [10 ** 400, 0.5, 0, 0, None, None], [True, False, None, "x", 0.3, 0.3]]
    cases.append({"t": "shot", "frame": F, "args": args})
for n in range(10):
    F = random_layout(rs, 8, kitchen_cue=True)
    F["kitchen"] = n % 2 == 0
    cases.append({"t": "valid", "frame": F, "pts": [[rs.uniform(-0.05, W + 0.05), rs.uniform(-0.05, H + 0.05)] for _ in range(30)]})
n_sims = sum(1 for c in cases if c["t"] in ("sim", "step", "apply")) + sum(len(c["shots"]) for c in cases if c["t"] == "seq")
info(f"{len(cases)} cross-check cases ({n_sims} simulated shots)")

t0 = time.perf_counter()
py_out = [run_py(json.loads(json.dumps(c))) for c in cases]
py_s = time.perf_counter() - t0
info(f"Python ran them in {py_s:.1f}s")
# the steppable Sim agrees with simulate() in Python
same_step = all(canon(py_out[i]) == canon({k: v for k, v in run_py(dict(c, t="sim")).items() if k != "frames"})
                for i, c in enumerate(cases) if c["t"] == "step")
check(same_step, "Python: stepping a Sim gives the same shot as simulate()")

node = shutil.which("node")
if not node:
    print("WARN node not found: skipped the JS-vs-Python determinism check")
else:
    t0 = time.perf_counter()
    out = subprocess.run([node, _os.path.join(_HERE, "poolcases.js")], input=json.dumps({"cases": cases}),
                         capture_output=True, text=True, timeout=600)
    js_s = time.perf_counter() - t0
    try:
        js_out = json.loads(out.stdout)
    except ValueError:
        js_out = None
    check(js_out is not None and len(js_out) == len(cases), "node ran the cases" + ("" if js_out else ": " + out.stderr[-400:]))
    if js_out:
        info(f"node ran them in {js_s:.1f}s")
        errs = [o["error"] for o in js_out if isinstance(o, dict) and "error" in o]
        check(not errs, "no JS errors" + (": " + errs[0][:300] if errs else ""))
        bad = [i for i in range(len(cases)) if canon(py_out[i]) != canon(js_out[i])]
        kinds = {}
        for i in bad:
            kinds[cases[i]["t"]] = kinds.get(cases[i]["t"], 0) + 1
        check(not bad, f"JS and Python agree bit for bit on all {len(cases)} cases" + (f" (differ: {kinds}, first #{bad[0]})" if bad else ""))
        if bad:
            a, b = canon(py_out[bad[0]]), canon(js_out[bad[0]])
            sa, sb = json.dumps(a), json.dumps(b)
            k = next((k for k in range(min(len(sa), len(sb))) if sa[k] != sb[k]), 0)
            print("      python: ..." + sa[max(0, k - 200):k + 120])
            print("      js:     ..." + sb[max(0, k - 200):k + 120])

print("FAILED:", failed)
