"""Billiards core: table geometry, deterministic ball physics and the 8-ball / 9-ball rules.

A line-by-line port of public/js/games/pool-core.js that gives bit-identical results for the same
input (Python floats and JS numbers are both IEEE doubles). Keep the two files in sync: same
operation order, same iteration order, only + - * /, sqrt, abs, min/max, comparisons and ceil in
the simulation (no hypot, ** or trig; no sum()). Frame dicts use the same (camelCase) keys as the
JS objects so JSON from either side is interchangeable. Pure stdlib.

make_shot turns the aim angle into vx/vy with its own polynomial sin/cos (sincos below, only + - * /
and floor), so it is bit-identical to the JS makeShot too; still, online clients must replay the
server's shot object (its vx/vy), never a shot they rebuilt themselves.
"""
import math

_sqrt = math.sqrt
_ceil = math.ceil
_floor = math.floor

# ------------------------------------------------------------------ units, table
W = 2.24
H = 1.12
R = 0.028575
D = 2 * R
D2 = D * D
R2 = R * R
HEAD_X = W / 4
FOOT_X = 3 * W / 4
HEAD_SPOT = [W / 4, H / 2]
FOOT_SPOT = [3 * W / 4, H / 2]

# ------------------------------------------------------------------ physics constants
DT = 1 / 400
G = 9.81
MU_S = 0.2
MU_R = 0.024
DRAG = 0.13
SIDE_DECAY = 0.9
E_BALL = 0.95
E_CUSH = 0.87
E_CUSH_DROP = 0.007
E_CUSH_MIN = 0.7
CUSH_T = 0.95
CUSH_K = 0.22
CUSH_SPIN = 0.55
MAX_SPEED = 7
MAX_T = 40
MAX_STEPS = 16000
SUB = 0.4 * R
SLIDE_A = MU_S * G * DT
SLIDE_DU = 3.5 * SLIDE_A
ROLL_DEC = MU_R * G * DT
DRAG_DT = DRAG * DT
SPIN_DEC = SIDE_DECAY * DT
TWO7 = 2 / 7
HALF_E = (1 + E_BALL) / 2
SLIP_EPS2 = 1e-14
SEP2 = (D - 1e-7) * (D - 1e-7)
PLACE2 = (D + 1e-4) * (D + 1e-4)
BREAK_SPEED = 9.5
SHOT_CAP = 20
JAW_E0 = 0.45
JAW_EK = 0.2
JAW_EMAX = 0.9


# ------------------------------------------------------------------ geometry
def _unit(x, y):
    l = _sqrt(x * x + y * y)
    return [x / l, y / l]


SQRT2 = _sqrt(2)
SQRT3 = _sqrt(3)
CORNER_MOUTH = 2.2 * D
SIDE_MOUTH = 2.4 * D
CA = CORNER_MOUTH / SQRT2
SH = SIDE_MOUTH / 2
CJ = _unit(1, 0.78)
SJ = _unit(1, 4)
CJ_LEN = 3.5 * R
SJ_LEN = 2.5 * R
C_OFF = 0.5 * R
C_RAD = 1.8 * R
S_OFF = 1.6 * R
S_RAD = 1.5 * R
CZ = CA + 1.5 * R
SZ = SH + 1.5 * R
OB = 2.5 * R
XHI = W - R
YHI = H - R
RAIL_X1 = W / 2 - SH
RAIL_X2 = W / 2 + SH
RAIL_XE = W - CA
RAIL_YE = H - CA


def _jaw(tx, ty, dx, dy, ln):
    return [tx, ty, tx + dx * ln, ty + dy * ln]


def _corner(cx, cy, sx, sy):
    h_tip = [cx - sx * CA, cy]
    v_tip = [cx, cy - sy * CA]
    p = {"x": cx + sx * C_OFF, "y": cy + sy * C_OFF, "r": C_RAD, "corner": True,
         "mouth": [h_tip, v_tip], "axis": [sx / SQRT2, sy / SQRT2],
         "jaws": [_jaw(h_tip[0], h_tip[1], sx * CJ[0], sy * CJ[1], CJ_LEN),
                  _jaw(v_tip[0], v_tip[1], sx * CJ[1], sy * CJ[0], CJ_LEN)]}
    p["hole"] = C_RAD
    return p


def _side(cy, sy):
    l_tip = [W / 2 - SH, cy]
    r_tip = [W / 2 + SH, cy]
    p = {"x": W / 2, "y": cy + sy * S_OFF, "r": S_RAD, "corner": False,
         "mouth": [l_tip, r_tip], "axis": [0, sy],
         "jaws": [_jaw(l_tip[0], l_tip[1], SJ[0], sy * SJ[1], SJ_LEN),
                  _jaw(r_tip[0], r_tip[1], -SJ[0], sy * SJ[1], SJ_LEN)]}
    p["hole"] = S_RAD
    return p


# pockets clockwise from the top-left: 0 TL, 1 top side, 2 TR, 3 BR, 4 bottom side, 5 BL
POCKETS = [_corner(0, 0, -1, -1), _side(0, -1), _corner(W, 0, 1, -1), _corner(W, H, 1, 1), _side(H, 1), _corner(0, H, -1, 1)]
JAWS = []
JX, JY, JDX, JDY, JL2, JNX, JNY = [], [], [], [], [], [], []
for _p in range(6):
    _P = POCKETS[_p]
    for _k in range(2):
        _s = _P["jaws"][_k]
        JAWS.append(_s)
        _dx = _s[2] - _s[0]
        _dy = _s[3] - _s[1]
        _l = _sqrt(_dx * _dx + _dy * _dy)
        _nx = -_dy / _l
        _ny = _dx / _l
        if (_P["x"] - _s[0]) * _nx + (_P["y"] - _s[1]) * _ny < 0:
            _nx = -_nx
            _ny = -_ny
        JX.append(_s[0]); JY.append(_s[1]); JDX.append(_dx); JDY.append(_dy)
        JL2.append(_dx * _dx + _dy * _dy); JNX.append(_nx); JNY.append(_ny)
PX = [p["x"] for p in POCKETS]
PY = [p["y"] for p in POCKETS]
PR = [p["r"] for p in POCKETS]
PR2 = [p["r"] * p["r"] for p in POCKETS]


def _end(s):
    return [s[2], s[3]]


def _tip(s):
    return [s[0], s[1]]


_PJ = [p["jaws"] for p in POCKETS]
CUSHIONS = [
    [_end(_PJ[0][0]), _tip(_PJ[0][0]), _tip(_PJ[1][0]), _end(_PJ[1][0])],
    [_end(_PJ[1][1]), _tip(_PJ[1][1]), _tip(_PJ[2][0]), _end(_PJ[2][0])],
    [_end(_PJ[2][1]), _tip(_PJ[2][1]), _tip(_PJ[3][1]), _end(_PJ[3][1])],
    [_end(_PJ[3][0]), _tip(_PJ[3][0]), _tip(_PJ[4][1]), _end(_PJ[4][1])],
    [_end(_PJ[4][0]), _tip(_PJ[4][0]), _tip(_PJ[5][0]), _end(_PJ[5][0])],
    [_end(_PJ[5][1]), _tip(_PJ[5][1]), _tip(_PJ[0][1]), _end(_PJ[0][1])],
]
SEGMENTS = [[c[k][0], c[k][1], c[k + 1][0], c[k + 1][1]] for c in CUSHIONS for k in range(3)]
DIAMONDS = ([[k * W / 8, 0] for k in (1, 2, 3, 5, 6, 7)] + [[W, k * H / 4] for k in (1, 2, 3)]
            + [[k * W / 8, H] for k in (7, 6, 5, 3, 2, 1)] + [[0, k * H / 4] for k in (3, 2, 1)])


def _pocket_zone(x, y):
    """The pocket whose jaws a ball at (x, y) may touch, or -1."""
    if x < CZ:
        if y < CZ:
            return 0
        if y > H - CZ:
            return 5
    elif x > W - CZ:
        if y < CZ:
            return 2
        if y > H - CZ:
            return 3
    elif x > W / 2 - SZ and x < W / 2 + SZ:
        if y < R:
            return 1
        if y > YHI:
            return 4
    return -1


def _order_pots(ev, pots):
    """Several balls dropped in one substep: reorder their pot events (in place, in the same event slots)
    so the ball that crossed into its pocket first comes first. pots: [rewind, eventIndex, ...]."""
    n = len(pots) // 2
    order = []
    for a in range(n):
        b = len(order)
        while b > 0 and pots[2 * order[b - 1]] < pots[2 * a]:
            b -= 1
        order.insert(b, a)
    evs = [ev[pots[2 * order[a] + 1]] for a in range(n)]
    for a in range(n):
        ev[pots[2 * a + 1]] = evs[a]


def _num(v):
    """v as a float if it is a finite number (JS: typeof v === 'number' && isFinite(v)), else None.
    A JSON integer too big for a double is Infinity in JS, so it is not a number here either."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) else None


def _fin(v, dflt):
    f = _num(v)
    return dflt if f is None else f


# deterministic sin/cos (only + - * / and floor, identical in pool-core.js): Cody-Waite reduction to
# [-pi/4, pi/4] and Taylor series to x^17 / x^16
TWO_PI_HI = 6.283185307179586
TWO_PI_LO = 2.4492935982947064e-16
HALF_PI_HI = 1.5707963267948966
HALF_PI_LO = 6.123233995736766e-17
S3 = -1 / 6
S5 = 1 / 120
S7 = -1 / 5040
S9 = 1 / 362880
S11 = -1 / 39916800
S13 = 1 / 6227020800
S15 = -1 / 1307674368000
S17 = 1 / 355687428096000
C4 = 1 / 24
C6 = -1 / 720
C8 = 1 / 40320
C10 = -1 / 3628800
C12 = 1 / 479001600
C14 = -1 / 87178291200
C16 = 1 / 20922789888000


def sincos(a):
    """[sin(a), cos(a)], bit-identical to PoolCore.sincos."""
    a = float(a)
    if not (a >= -1e9 and a <= 1e9):
        a = 0.0
    k = float(_floor(a / TWO_PI_HI + 0.5))
    r = (a - k * TWO_PI_HI) - k * TWO_PI_LO
    q = float(_floor(r / HALF_PI_HI + 0.5))
    r = (r - q * HALF_PI_HI) - q * HALF_PI_LO
    z = r * r
    s = r + r * z * (S3 + z * (S5 + z * (S7 + z * (S9 + z * (S11 + z * (S13 + z * (S15 + z * S17)))))))
    c = 1 - 0.5 * z + z * z * (C4 + z * (C6 + z * (C8 + z * (C10 + z * (C12 + z * (C14 + z * C16))))))
    if q == 0:
        return [s, c]
    if q == 1:
        return [c, -s]
    if q == -1:
        return [-c, s]
    return [-s, -c]


def nearest_pocket(x, y):
    best = 0
    bd = -1.0
    for p in range(6):
        dx = x - PX[p]
        dy = y - PY[p]
        d2 = dx * dx + dy * dy
        if bd < 0 or d2 < bd:
            bd = d2
            best = p
    return best


# ------------------------------------------------------------------ simulation
class Sim:
    """A steppable simulation of one shot (see pool-core.js)."""

    def __init__(self, balls, shot, opts=None):
        ids, X, Y = [], [], []
        cue = -1
        for i, b in enumerate(balls):
            if b[0] == 0:
                cue = i
            ids.append(b[0])
            X.append(float(b[1]))
            Y.append(float(b[2]))
        n = len(ids)
        VX = [0.0] * n; VY = [0.0] * n; RX = [0.0] * n; RY = [0.0] * n; S = [0.0] * n
        ON = [True] * n; MOV = [False] * n
        if shot is not None:
            if cue < 0:
                cue = 0
                for arr, v in ((ids, 0), (X, 0.0), (Y, 0.0), (VX, 0.0), (VY, 0.0), (RX, 0.0), (RY, 0.0), (S, 0.0), (ON, True), (MOV, False)):
                    arr.insert(0, v)
            # sanitise: non-finite numbers -> 0 (position -> head spot), spin to [-1, 1], speed to SHOT_CAP
            vx = _fin(shot.get("vx"), 0.0)
            vy = _fin(shot.get("vy"), 0.0)
            if vx > SHOT_CAP:
                vx = float(SHOT_CAP)
            elif vx < -SHOT_CAP:
                vx = float(-SHOT_CAP)
            if vy > SHOT_CAP:
                vy = float(SHOT_CAP)
            elif vy < -SHOT_CAP:
                vy = float(-SHOT_CAP)
            v2 = vx * vx + vy * vy
            if v2 > SHOT_CAP * SHOT_CAP:
                f = SHOT_CAP / _sqrt(v2)
                vx = vx * f
                vy = vy * f
            sx = _fin(shot.get("sx"), 0.0)
            sy = _fin(shot.get("sy"), 0.0)
            if sx > 1:
                sx = 1.0
            elif sx < -1:
                sx = -1.0
            if sy > 1:
                sy = 1.0
            elif sy < -1:
                sy = -1.0
            k = 1.25 * sy
            X[cue] = _fin(shot.get("x"), HEAD_SPOT[0])
            Y[cue] = _fin(shot.get("y"), HEAD_SPOT[1])
            VX[cue] = vx; VY[cue] = vy; RX[cue] = vx * k; RY[cue] = vy * k
            S[cue] = 1.1 * sx * _sqrt(vx * vx + vy * vy)
            MOV[cue] = vx != 0 or vy != 0
        self.n = len(ids)
        self.cue = cue
        self.ids, self.X, self.Y, self.VX, self.VY, self.RX, self.RY, self.S = ids, X, Y, VX, VY, RX, RY, S
        self.ON, self.MOV = ON, MOV
        self.steps = 0
        self.events = []
        rec = (opts or {}).get("record") or 0
        self.record = 1 if rec is True else int(rec)
        self.frames = [] if self.record else None
        self.done = False
        if not any(MOV):
            self._finish()

    def step(self):
        k = len(self.events)
        self.advance(1)
        return self.events[k:]

    def time(self):
        return self.steps * DT

    def state(self):
        return [{"id": self.ids[i], "x": self.X[i], "y": self.Y[i], "vx": self.VX[i], "vy": self.VY[i],
                 "rx": self.RX[i], "ry": self.RY[i], "s": self.S[i], "on": self.ON[i]} for i in range(self.n)]

    def result(self):
        balls = [[self.ids[i], self.X[i], self.Y[i]] for i in range(self.n) if self.ON[i]]
        r = {"balls": balls, "events": self.events, "steps": self.steps, "dur": self.steps * DT}
        if self.frames is not None:
            r["frames"] = self.frames
        return r

    def advance(self, max_steps):
        if self.done:
            return
        X, Y, VX, VY, RX, RY, S = self.X, self.Y, self.VX, self.VY, self.RX, self.RY, self.S
        ON, MOV, ids, ev, N = self.ON, self.MOV, self.ids, self.events, self.n
        sqrt = _sqrt
        cushion = self._cushion
        record = self.record
        steps = self.steps
        cue = self.cue
        pots = []
        act = [i for i in range(N) if ON[i]]
        for _it in range(max_steps):
            m2 = 0.0
            for i in act:
                if MOV[i]:
                    v2 = VX[i] * VX[i] + VY[i] * VY[i]
                    if v2 > m2:
                        m2 = v2
            ns = _ceil(sqrt(m2) * DT / SUB)
            if ns < 1:
                ns = 1
            elif ns > 8:
                ns = 8
            h = DT / ns
            for _sub in range(ns):
                # move
                for i in act:
                    if MOV[i]:
                        X[i] += VX[i] * h
                        Y[i] += VY[i] * h
                # the cue ball first (see pool-core.js)
                start = 0
                if cue >= 0 and MOV[cue]:
                    if act[0] == cue:
                        # the cue ball's row of pairs; _cue_first only when it overlaps a ball (same result as
                        # always calling it, just faster)
                        start = 1
                        xc = X[cue]; yc = Y[cue]
                        for j in act:
                            dx = X[j] - xc
                            if dx >= D or dx <= -D:
                                continue
                            dy = Y[j] - yc
                            if dy >= D or dy <= -D:
                                continue
                            if j != cue and dx * dx + dy * dy < D2:
                                if self._cue_first(act, h, steps, pots, True):
                                    act = [i for i in act if ON[i]]
                                    start = 0
                                break
                    elif self._cue_first(act, h, steps, pots, False):
                        act = [i for i in act if ON[i]]
                # ball-ball, pairs in index order; a pass with a collision gets one more pass (see pool-core.js)
                for _pass in range(2):
                    hits = False
                    na = len(act)
                    for a in range(start if _pass == 0 else 0, na - 1):
                        i = act[a]
                        xi = X[i]; yi = Y[i]; mi = MOV[i]
                        for b in range(a + 1, na):
                            j = act[b]
                            if not mi and not MOV[j]:
                                continue
                            dx = X[j] - xi
                            if dx >= D or dx <= -D:
                                continue
                            dy = Y[j] - yi
                            if dy >= D or dy <= -D:
                                continue
                            d2 = dx * dx + dy * dy
                            if d2 >= D2:
                                continue
                            d = sqrt(d2)
                            nx = 1.0; ny = 0.0
                            if d > 0:
                                nx = dx / d; ny = dy / d
                            wx = VX[j] - VX[i]; wy = VY[j] - VY[i]
                            if wx * nx + wy * ny < 0:
                                qa = wx * wx + wy * wy
                                qb = dx * wx + dy * wy
                                qc = d2 - D2
                                t = (qb + sqrt(qb * qb - qa * qc)) / qa
                                if t > h:
                                    t = h
                                X[i] -= VX[i] * t; Y[i] -= VY[i] * t; X[j] -= VX[j] * t; Y[j] -= VY[j] * t
                                dx = X[j] - X[i]; dy = Y[j] - Y[i]
                                d2 = dx * dx + dy * dy
                                d = sqrt(d2)
                                if d > 0:
                                    nx = dx / d; ny = dy / d
                                un = (VX[j] - VX[i]) * nx + (VY[j] - VY[i]) * ny
                                if un < 0:
                                    k = un * HALF_E
                                    VX[i] += k * nx; VY[i] += k * ny; VX[j] -= k * nx; VY[j] -= k * ny
                                    ev.append(["hit", ids[i], ids[j], steps, -un])
                                    hits = True
                                X[i] += VX[i] * t; Y[i] += VY[i] * t; X[j] += VX[j] * t; Y[j] += VY[j] * t
                                MOV[i] = True; MOV[j] = True; mi = True
                                dx = X[j] - X[i]; dy = Y[j] - Y[i]
                                d2 = dx * dx + dy * dy
                            if d2 < D2:
                                d = sqrt(d2)
                                if d > 0:
                                    o = (D - d) * 0.5 / d
                                    X[i] -= dx * o; Y[i] -= dy * o; X[j] += dx * o; Y[j] += dy * o
                            xi = X[i]; yi = Y[i]
                    if not hits:
                        break
                # cushions, jaws, pockets (only for balls near a rail line)
                for i in act:
                    if not MOV[i]:
                        continue
                    x = X[i]; y = Y[i]
                    if x > R and x < XHI and y > R and y < YHI:
                        continue
                    pt = cushion(i, h, steps)
                    if pt >= 0:
                        pots.append(pt); pots.append(len(ev) - 1)
                if pots:
                    if len(pots) > 2:
                        _order_pots(ev, pots)
                    pots = []
                    act = [i for i in act if ON[i]]
            # friction, once per step
            moving = False
            for i in act:
                if not MOV[i]:
                    continue
                vx = VX[i]; vy = VY[i]; rx = RX[i]; ry = RY[i]
                ux = vx - rx; uy = vy - ry
                u2 = ux * ux + uy * uy
                if u2 > SLIP_EPS2:
                    u = sqrt(u2)
                    if u <= SLIDE_DU:
                        vx = vx - ux * TWO7; vy = vy - uy * TWO7
                        rx = vx; ry = vy
                    else:
                        f = SLIDE_A / u
                        vx = vx - ux * f; vy = vy - uy * f
                        f = f * 2.5
                        rx = rx + ux * f; ry = ry + uy * f
                        vx = vx - vx * DRAG_DT; vy = vy - vy * DRAG_DT
                else:
                    sp = sqrt(vx * vx + vy * vy)
                    dec = ROLL_DEC + DRAG_DT * sp
                    if sp <= dec:
                        vx = 0.0; vy = 0.0
                    else:
                        f = (sp - dec) / sp
                        vx = vx * f; vy = vy * f
                    rx = vx; ry = vy
                s = S[i]
                if s > SPIN_DEC:
                    s = s - SPIN_DEC
                elif s < -SPIN_DEC:
                    s = s + SPIN_DEC
                else:
                    s = 0.0
                if vx == 0 and vy == 0 and rx == 0 and ry == 0:
                    MOV[i] = False
                    s = 0.0
                else:
                    moving = True
                VX[i] = vx; VY[i] = vy; RX[i] = rx; RY[i] = ry; S[i] = s
            steps += 1
            if record and steps % record == 0:
                f = []
                for i in range(N):
                    f.append(X[i]); f.append(Y[i])
                self.frames.append(f)
            if not moving or steps >= MAX_STEPS:
                self.steps = steps
                self._finish()
                return
        self.steps = steps

    def _cue_contacts(self, act, h, ov):
        """The cue ball's contacts with the balls it overlaps and approaches: [index, rewind time, ...];
        the balls it overlaps without approaching go to ov (if ov is a list)."""
        X, Y, VX, VY, c = self.X, self.Y, self.VX, self.VY, self.cue
        xc = X[c]; yc = Y[c]; vxc = VX[c]; vyc = VY[c]
        out = []
        for j in act:
            dx = X[j] - xc
            if dx >= D or dx <= -D:
                continue
            dy = Y[j] - yc
            if dy >= D or dy <= -D:
                continue
            d2 = dx * dx + dy * dy
            if d2 >= D2 or j == c:
                continue
            wx = VX[j] - vxc; wy = VY[j] - vyc
            qb = dx * wx + dy * wy
            if (qb < 0) if d2 > 0 else (wx < 0):
                qa = wx * wx + wy * wy
                t = (qb + _sqrt(qb * qb - qa * (d2 - D2))) / qa
                if t > h:
                    t = h
                out.append(j); out.append(t)
            elif ov is not None:
                ov.append(j)
        return out

    def _cue_first(self, act, h, step, pots, whole):
        """Order the cue ball's contacts within a substep (see pool-core.js). Returns True if it dropped."""
        c = self.cue
        ov = [] if whole else None
        cc = self._cue_contacts(act, h, ov)
        if not cc and not whole:
            return False
        x = self.X[c]; y = self.Y[c]
        if not (x > R and x < XHI and y > R and y < YHI):
            tm = -1.0
            for k in range(1, len(cc), 2):
                if cc[k] > tm:
                    tm = cc[k]
            if cc and self._rail_t(c, h) > tm:
                pt = self._cushion(c, h, step)
                if pt >= 0:
                    pots.append(pt); pots.append(len(self.events) - 1)
                    return True
                ov = [] if whole else None
                cc = self._cue_contacts(act, h, ov)
        if len(cc) < 4 and not whole:
            return False
        order = []
        for k in range(0, len(cc), 2):
            b = len(order)
            while b > 0 and cc[order[b - 1] + 1] < cc[k + 1]:
                b -= 1
            order.insert(b, k)
        for k in order:
            j = cc[k]
            if c < j:
                self._hit(c, j, h, step)
            else:
                self._hit(j, c, h, step)
        if whole:
            X, Y = self.X, self.Y
            for j in ov:
                dx = X[j] - X[c]; dy = Y[j] - Y[c]
                d2 = dx * dx + dy * dy
                if d2 < D2:
                    d = _sqrt(d2)
                    if d > 0:
                        o = (D - d) * 0.5 / d
                        X[c] -= dx * o; Y[c] -= dy * o; X[j] += dx * o; Y[j] += dy * o
        return False

    def _hit(self, i, j, h, step):
        """Balls i < j, if they overlap: collide them if they approach, then push apart (see pool-core.js)."""
        X, Y, VX, VY = self.X, self.Y, self.VX, self.VY
        dx = X[j] - X[i]; dy = Y[j] - Y[i]
        d2 = dx * dx + dy * dy
        if d2 >= D2:
            return
        wx = VX[j] - VX[i]; wy = VY[j] - VY[i]
        qb = dx * wx + dy * wy
        if (qb < 0) if d2 > 0 else (wx < 0):
            qa = wx * wx + wy * wy
            t = (qb + _sqrt(qb * qb - qa * (d2 - D2))) / qa
            if t > h:
                t = h
            X[i] -= VX[i] * t; Y[i] -= VY[i] * t; X[j] -= VX[j] * t; Y[j] -= VY[j] * t
            dx = X[j] - X[i]; dy = Y[j] - Y[i]
            d2 = dx * dx + dy * dy
            d = _sqrt(d2)
            nx = 1.0; ny = 0.0
            if d > 0:
                nx = dx / d; ny = dy / d
            un = (VX[j] - VX[i]) * nx + (VY[j] - VY[i]) * ny
            if un < 0:
                k = un * HALF_E
                VX[i] += k * nx; VY[i] += k * ny; VX[j] -= k * nx; VY[j] -= k * ny
                self.events.append(["hit", self.ids[i], self.ids[j], step, -un])
            X[i] += VX[i] * t; Y[i] += VY[i] * t; X[j] += VX[j] * t; Y[j] += VY[j] * t
            self.MOV[i] = True; self.MOV[j] = True
            dx = X[j] - X[i]; dy = Y[j] - Y[i]
            d2 = dx * dx + dy * dy
        if d2 < D2:
            d = _sqrt(d2)
            if d > 0:
                o = (D - d) * 0.5 / d
                X[i] -= dx * o; Y[i] -= dy * o; X[j] += dx * o; Y[j] += dy * o

    def _bounce(self, i, nx, ny, pen, h, step, jaw=False):
        X, Y, VX, VY = self.X, self.Y, self.VX, self.VY
        vx = VX[i]; vy = VY[i]
        vn = vx * nx + vy * ny
        if vn >= 0:
            X[i] += nx * pen; Y[i] += ny * pen
            return
        sp = -vn
        if jaw:
            e = JAW_E0 + JAW_EK * sp
            if e > JAW_EMAX:
                e = JAW_EMAX
        else:
            e = E_CUSH - E_CUSH_DROP * sp
            if e < E_CUSH_MIN:
                e = E_CUSH_MIN
        t = pen / sp
        if t > h:
            t = h
        X[i] -= vx * t; Y[i] -= vy * t
        tx = -ny; ty = nx
        vt = (vx * tx + vy * ty) * CUSH_T - CUSH_K * self.S[i]
        vn2 = e * sp
        vx = vn2 * nx + vt * tx; vy = vn2 * ny + vt * ty
        rn = self.RX[i] * nx + self.RY[i] * ny
        self.RX[i] -= rn * nx; self.RY[i] -= rn * ny
        self.S[i] = self.S[i] * CUSH_SPIN
        VX[i] = vx; VY[i] = vy
        X[i] += vx * t; Y[i] += vy * t
        self.events.append(["rail", self.ids[i], step, sp])

    def _pot(self, i, p, step):
        self.ON[i] = False; self.MOV[i] = False
        self.VX[i] = 0.0; self.VY[i] = 0.0; self.RX[i] = 0.0; self.RY[i] = 0.0; self.S[i] = 0.0
        self.events.append(["pot", self.ids[i], p, step])

    def _rail_t(self, i, h):
        """How long ago in this substep ball i first touched a rail or jaw it is pressing into (see _railT)."""
        x = self.X[i]; y = self.Y[i]; vx = self.VX[i]; vy = self.VY[i]
        best = -1.0
        if (x >= CA and x <= RAIL_X1) or (x >= RAIL_X2 and x <= RAIL_XE):
            if y < R:
                if vy < 0:
                    t = (R - y) / -vy
                    if t > h:
                        t = h
                    if t > best:
                        best = t
            elif y > YHI:
                if vy > 0:
                    t = (y - YHI) / vy
                    if t > h:
                        t = h
                    if t > best:
                        best = t
        if y >= CA and y <= RAIL_YE:
            if x < R:
                if vx < 0:
                    t = (R - x) / -vx
                    if t > h:
                        t = h
                    if t > best:
                        best = t
            elif x > XHI:
                if vx > 0:
                    t = (x - XHI) / vx
                    if t > h:
                        t = h
                    if t > best:
                        best = t
        p = _pocket_zone(x, y)
        if p >= 0:
            for q in (2 * p, 2 * p + 1):
                u = ((x - JX[q]) * JDX[q] + (y - JY[q]) * JDY[q]) / JL2[q]
                if u < 0:
                    u = 0.0
                elif u > 1:
                    u = 1.0
                ex = x - (JX[q] + JDX[q] * u); ey = y - (JY[q] + JDY[q] * u)
                e2 = ex * ex + ey * ey
                if e2 < R2:
                    e = _sqrt(e2)
                    nx = JNX[q]; ny = JNY[q]
                    if e > 0:
                        nx = ex / e; ny = ey / e
                    vn = vx * nx + vy * ny
                    if vn < 0:
                        t = (R - e) / -vn
                        if t > h:
                            t = h
                        if t > best:
                            best = t
        return best

    def _cushion(self, i, h, step):
        X, Y = self.X, self.Y
        x = X[i]; y = Y[i]
        if y < R:
            if (x >= CA and x <= RAIL_X1) or (x >= RAIL_X2 and x <= RAIL_XE):
                self._bounce(i, 0.0, 1.0, R - y, h, step)
        elif y > YHI:
            if (x >= CA and x <= RAIL_X1) or (x >= RAIL_X2 and x <= RAIL_XE):
                self._bounce(i, 0.0, -1.0, y - YHI, h, step)
        x = X[i]; y = Y[i]
        if x < R:
            if y >= CA and y <= RAIL_YE:
                self._bounce(i, 1.0, 0.0, R - x, h, step)
        elif x > XHI:
            if y >= CA and y <= RAIL_YE:
                self._bounce(i, -1.0, 0.0, x - XHI, h, step)
        x = X[i]; y = Y[i]
        p = _pocket_zone(x, y)
        if p >= 0:
            for q in (2 * p, 2 * p + 1):
                t = ((x - JX[q]) * JDX[q] + (y - JY[q]) * JDY[q]) / JL2[q]
                if t < 0:
                    t = 0.0
                elif t > 1:
                    t = 1.0
                ex = x - (JX[q] + JDX[q] * t); ey = y - (JY[q] + JDY[q] * t)
                e2 = ex * ex + ey * ey
                if e2 < R2:
                    e = _sqrt(e2)
                    nx = JNX[q]; ny = JNY[q]
                    if e > 0:
                        nx = ex / e; ny = ey / e
                    self._bounce(i, nx, ny, R - e, h, step, True)
                    x = X[i]; y = Y[i]
            cx = x - PX[p]; cy = y - PY[p]
            c2 = cx * cx + cy * cy
            if c2 < PR2[p]:
                vx = self.VX[i]; vy = self.VY[i]
                v2 = vx * vx + vy * vy
                t = 0.0
                if v2 > 0:
                    t = (PR[p] - _sqrt(c2)) / _sqrt(v2)
                    if t > h:
                        t = h
                self._pot(i, p, step)
                return t
        if x < -OB or x > W + OB or y < -OB or y > H + OB or (p < 0 and (x < 0 or x > W or y < 0 or y > H)):
            self._pot(i, nearest_pocket(x, y), step)
            return 0.0
        return -1.0

    def _finish(self):
        X, Y, ON, N = self.X, self.Y, self.ON, self.n
        for i in range(N):
            self.VX[i] = 0.0; self.VY[i] = 0.0; self.RX[i] = 0.0; self.RY[i] = 0.0; self.S[i] = 0.0; self.MOV[i] = False
        for _pass in range(12):
            moved = False
            for i in range(N - 1):
                if not ON[i]:
                    continue
                for j in range(i + 1, N):
                    if not ON[j]:
                        continue
                    dx = X[j] - X[i]; dy = Y[j] - Y[i]
                    d2 = dx * dx + dy * dy
                    if d2 < SEP2:
                        d = _sqrt(d2)
                        nx = 1.0; ny = 0.0
                        if d > 0:
                            nx = dx / d; ny = dy / d
                        o = (D - d) * 0.5
                        X[i] -= nx * o; Y[i] -= ny * o; X[j] += nx * o; Y[j] += ny * o
                        moved = True
            for i in range(N):
                if not ON[i]:
                    continue
                x = X[i]; y = Y[i]
                if (x >= CA and x <= RAIL_X1) or (x >= RAIL_X2 and x <= RAIL_XE):
                    if y < R:
                        Y[i] = R; moved = True
                    elif y > YHI:
                        Y[i] = YHI; moved = True
                if y >= CA and y <= RAIL_YE:
                    if x < R:
                        X[i] = R; moved = True
                    elif x > XHI:
                        X[i] = XHI; moved = True
            if not moved:
                break
        self.done = True


def simulate(balls, shot, opts=None, record=None):
    """Simulate a whole shot -> {balls, events, steps, dur} (+ frames with record)."""
    if record is not None:
        opts = dict(opts or {}, record=record)
    sim = Sim(balls, shot, opts)
    sim.advance(MAX_STEPS + 1)
    return sim.result()


# ------------------------------------------------------------------ rules
def group_of(i):
    if 1 <= i <= 7:
        return "solids"
    if 9 <= i <= 15:
        return "stripes"
    return None


def clone_frame(F):
    v = F["visit"]
    return {
        "mode": F["mode"], "balls": [[b[0], b[1], b[2]] for b in F["balls"]], "turn": F["turn"], "breaker": F["breaker"],
        "isBreak": F["isBreak"], "open": F["open"], "groups": [F["groups"][0], F["groups"][1]], "inHand": F["inHand"],
        "kitchen": F["kitchen"], "over": F["over"], "winner": F["winner"], "reason": F["reason"], "shots": F["shots"],
        "visit": {"seat": v["seat"], "potted": list(v["potted"]), "start": _visit_start(F)},
    }


def _visit_start(F):
    """visit.start, or 0 when it is missing or not a finite number (older frames)."""
    s = F["visit"].get("start")
    return s if _num(s) is not None else 0


def _sort_balls(balls):
    balls.sort(key=lambda b: b[0])


RACK_GAP = 1.5e-4
RACK_JIT = 5e-5


def new_frame(mode, breaker, rand):
    """A new racked frame. rand() in [0, 1) picks the rack order and a tiny jitter."""
    RS = D + RACK_GAP
    row_x = RS * SQRT3 / 2
    pos = []
    widths = [1, 2, 3, 2, 1] if mode == "9ball" else [1, 2, 3, 4, 5]
    for k, w in enumerate(widths):
        for j in range(w):
            pos.append([FOOT_X + k * row_x, H / 2 + (2 * j - (w - 1)) * RS * 0.5])
    at = [None] * len(pos)
    if mode == "9ball":
        at[0] = 1
        at[4] = 9
        rest = [2, 3, 4, 5, 6, 7, 8]
    else:
        solid = 1 + int(math.floor(rand() * 7))
        stripe = 9 + int(math.floor(rand() * 7))
        if rand() < 0.5:
            at[10] = solid; at[14] = stripe
        else:
            at[10] = stripe; at[14] = solid
        at[4] = 8
        rest = [i for i in range(1, 16) if i != 8 and i != solid and i != stripe]
    for i in range(len(rest) - 1, 0, -1):
        j = int(math.floor(rand() * (i + 1)))
        rest[i], rest[j] = rest[j], rest[i]
    r = 0
    for k in range(len(pos)):
        if at[k] is None:
            at[k] = rest[r]
            r += 1
    balls = [[0, HEAD_SPOT[0], HEAD_SPOT[1]]]
    for k in range(len(pos)):
        x = pos[k][0] + (rand() - 0.5) * RACK_JIT
        y = pos[k][1] + (rand() - 0.5) * RACK_JIT
        balls.append([at[k], x, y])
    _sort_balls(balls)
    return {
        "mode": "9ball" if mode == "9ball" else "8ball", "balls": balls, "turn": breaker, "breaker": breaker,
        "isBreak": True, "open": True, "groups": [None, None], "inHand": True, "kitchen": True, "over": False,
        "winner": None, "reason": "", "shots": 0, "visit": {"seat": breaker, "potted": [], "start": 0},
    }


def valid_placement(F, x, y):
    """Can the cue ball be placed at (x, y)?"""
    x = _num(x)
    y = _num(y)
    if x is None or y is None:
        return False
    if x < R or x > XHI or y < R or y > YHI:
        return False
    if F["kitchen"] and x > HEAD_X:
        return False
    for b in F["balls"]:
        if b[0] == 0:
            continue
        dx = b[1] - x; dy = b[2] - y
        if dx * dx + dy * dy < PLACE2:
            return False
    for p in range(6):
        dx = x - PX[p]; dy = y - PY[p]
        rr = POCKETS[p]["r"] + R
        if dx * dx + dy * dy < rr * rr:
            return False
    return True


def _cue_of(F):
    for b in F["balls"]:
        if b[0] == 0:
            return b
    return None


def make_shot(F, angle, power, sx=0.0, sy=0.0, cx=None, cy=None):
    """Build a shot {x, y, vx, vy, sx, sy} (see makeShot in pool-core.js)."""
    p = _fin(power, 0.02)
    if p < 0.02:
        p = 0.02
    elif p > 1:
        p = 1.0
    a = _fin(sx, 0.0)
    a = max(-1.0, min(1.0, a))
    b = _fin(sy, 0.0)
    b = max(-1.0, min(1.0, b))
    l2 = a * a + b * b
    if l2 > 1:
        l = _sqrt(l2)
        a = a / l; b = b / l
    cue = _cue_of(F)
    x = cue[1] if cue else HEAD_SPOT[0]
    y = cue[2] if cue else HEAD_SPOT[1]
    if F["inHand"] and valid_placement(F, cx, cy):
        x = _num(cx); y = _num(cy)
    sp = (BREAK_SPEED if F["isBreak"] else MAX_SPEED) * p
    sc = sincos(_fin(angle, 0.0))
    return {"x": float(x), "y": float(y), "vx": sc[1] * sp, "vy": sc[0] * sp, "sx": a, "sy": b}


def _spot_free(balls, x, y):
    for b in balls:
        dx = b[1] - x; dy = b[2] - y
        if dx * dx + dy * dy < PLACE2:
            return False
    return True


def _respot(balls, i):
    y = H / 2
    st = R / 8
    x = FOOT_X
    ok = False
    for k in range(400):
        x = FOOT_X + k * st
        if x > XHI:
            break
        if _spot_free(balls, x, y):
            ok = True
            break
    if not ok:
        for k in range(1, 800):
            x = FOOT_X - k * st
            if x < R:
                break
            if _spot_free(balls, x, y):
                ok = True
                break
    if not ok:
        x = FOOT_X
    balls.append([i, x, y])
    _sort_balls(balls)


def _place_cue(F):
    hx, hy = HEAD_SPOT
    x, y = hx, hy
    if not valid_placement(F, x, y):
        st = R / 2
        found = False
        k = 1
        while k < 400 and not found:
            o = k * st
            for c in ([hx - o, hy], [hx + o, hy], [hx, hy - o], [hx, hy + o]):
                if valid_placement(F, c[0], c[1]):
                    x, y = c
                    found = True
                    break
            k += 1
    F["balls"].append([0, x, y])
    _sort_balls(F["balls"])


def _group_left(balls, g):
    n = 0
    for b in balls:
        if group_of(b[0]) == g:
            n += 1
    return n


def apply_shot(F, shot):
    """Play a shot on frame F -> {frame, sim, result} (see applyShot in pool-core.js)."""
    F2 = clone_frame(F)
    if F["over"]:
        return {"frame": F2, "sim": None, "result": None}
    cue = _cue_of(F)
    x = shot.get("x"); y = shot.get("y")
    if not (F["inHand"] and valid_placement(F, x, y)) and cue:
        x = cue[1]; y = cue[2]
    s = {"x": x, "y": y, "vx": shot.get("vx"), "vy": shot.get("vy"), "sx": shot.get("sx"), "sy": shot.get("sy")}
    sim = simulate([[b[0], b[1], b[2]] for b in F["balls"]], s)
    first = None
    rail_after = False
    potted = []
    for e in sim["events"]:
        k = e[0]
        if k == "hit":
            if first is None and (e[1] == 0 or e[2] == 0):
                first = e[2] if e[1] == 0 else e[1]
        elif k == "rail":
            if first is not None:
                rail_after = True
        elif k == "pot":
            potted.append(e[1])
    obj = [i for i in potted if i != 0]
    scratch = 0 in potted
    me = F["turn"]; op = 1 - F["turn"]
    F2["balls"] = [[b[0], b[1], b[2]] for b in sim["balls"]]
    F2["shots"] = F["shots"] + 1
    foul = False; reason = None; assigned = None; again = False; over = False; winner = None; win = None; runout = False
    if F["mode"] == "9ball":
        lowest = None
        for b in F["balls"]:
            if b[0] != 0 and (lowest is None or b[0] < lowest):
                lowest = b[0]
        if scratch:
            reason = "scratch"
        elif first is None:
            reason = "nohit"
        elif first != lowest:
            reason = "wrong"
        elif not F["isBreak"] and len(obj) == 0 and not rail_after:
            reason = "norail"
        foul = reason is not None
        nine = 9 in obj
        if nine and not foul:
            over = True; winner = me; win = "nine"
        else:
            if nine:
                _respot(F2["balls"], 9)
            again = not foul and len(obj) > 0
    elif F["isBreak"]:
        if scratch:
            reason = "scratch"
        elif first is None:
            reason = "nohit"
        foul = reason is not None
        if 8 in obj:
            _respot(F2["balls"], 8)
        again = not foul and len(obj) > 0
        F2["open"] = True
    else:
        g = F["groups"][me]
        if F["open"]:
            on8 = _group_left(F["balls"], "solids") + _group_left(F["balls"], "stripes") == 0
        else:
            on8 = g is not None and _group_left(F["balls"], g) == 0
        if scratch:
            reason = "scratch"
        elif first is None:
            reason = "nohit"
        elif (first != 8) if on8 else ((first == 8) if F["open"] else (group_of(first) != g)):
            reason = "wrong"
        elif len(obj) == 0 and not rail_after:
            reason = "norail"
        foul = reason is not None
        if 8 in obj:
            over = True
            if on8 and not foul:
                winner = me; win = "eight"
            else:
                winner = op
                win = ("scratch8" if scratch else "foul8") if foul else "early8"
        else:
            if F["open"] and not foul:
                for i in obj:
                    gg = group_of(i)
                    if gg is not None:
                        assigned = gg
                        break
                if assigned is not None:
                    F2["open"] = False
                    F2["groups"][me] = assigned
                    F2["groups"][op] = "stripes" if assigned == "solids" else "solids"
            g2 = F2["groups"][me]
            if not foul and g2 is not None:
                for i in obj:
                    if group_of(i) == g2:
                        again = True
    F2["isBreak"] = False
    vp = (list(F["visit"]["potted"]) + obj) if F["visit"]["seat"] == me else list(obj)
    vstart = _visit_start(F) if F["visit"]["seat"] == me else F["shots"]
    if over:
        F2["over"] = True; F2["winner"] = winner; F2["reason"] = win; F2["inHand"] = False; F2["kitchen"] = False
        F2["visit"] = {"seat": me, "potted": vp, "start": vstart}
        if winner == me:
            if win == "nine":
                runout = vstart == 0
            else:
                g = F2["groups"][me]
                runout = g is not None and 8 in vp
                for i in range(1, 16):
                    if group_of(i) == g and i not in vp:
                        runout = False
        if scratch and not _cue_of(F2):
            _place_cue(F2)
    else:
        if foul:
            F2["turn"] = op; F2["inHand"] = True; F2["kitchen"] = F["mode"] == "8ball" and F["isBreak"] and scratch
        else:
            F2["turn"] = me if again else op; F2["inHand"] = False; F2["kitchen"] = False
        if F2["turn"] == me:
            F2["visit"] = {"seat": me, "potted": vp, "start": vstart}
        else:
            F2["visit"] = {"seat": op, "potted": [], "start": F2["shots"]}
        if scratch:
            _place_cue(F2)
    result = {"foul": foul, "reason": reason, "first": first, "potted": potted, "assigned": assigned, "again": again,
              "over": over, "winner": winner, "win": win, "runout": runout}
    return {"frame": F2, "sim": sim, "result": result}


def timeout_foul(F):
    """The shot clock ran out: foul, the opponent gets ball in hand anywhere. On the break (the rack is still
    intact) the opponent breaks instead, so the ball in hand is in the kitchen; F["breaker"] is left alone."""
    F2 = clone_frame(F)
    if F["over"]:
        return F2
    op = 1 - F["turn"]
    F2["turn"] = op
    F2["inHand"] = True
    F2["kitchen"] = F["isBreak"]
    F2["visit"] = {"seat": op, "potted": [], "start": F["shots"]}
    return F2


# camelCase aliases, so code written against the JS API reads the same
newFrame, validPlacement, makeShot, applyShot, timeoutFoul = new_frame, valid_placement, make_shot, apply_shot, timeout_foul
