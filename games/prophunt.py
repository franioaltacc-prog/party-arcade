"""Prop Hunt: top-down hide and seek with a killer.

Each round one player is the killer (it rotates). Everyone else hides: they can turn into a
prop (a barrel, a tree, a couch...) or sneak into a building. The killer is blind for the first
seconds, then hunts with a gun that aims all the way round. Every 30 seconds the killer gets a
ping showing roughly where the hiders are. Caught hiders watch the killer until the round ends.

Browsers send their own positions, but the server checks every move against the walls and a
speed limit, does all the shooting, and only tells each player about the people they could
really see, so a modified page can't see through roofs or across the map."""
import math
import random
import time

from .base import Game, num

TICK = 1 / 15           # snapshots per second
VIEW = 560              # how far anyone can see
PLAYER_R = 18
MOVE_R = 15             # the server's (slightly forgiving) collision size for movement checks
HIDER_SPEED = 250
KILLER_SPEED = 275
DISGUISED = 0.8         # props move a bit slower
GUN_RANGE = 720
SHOT_GAP = 0.4
MAG = 6
RELOAD = 2.2
PING_EVERY = 30
PING_WARN = 3
PING_SPREAD = 150
ROUND_PAUSE = 8
KILLER_GONE = 10        # seconds the killer can be offline before the round ends
WALL = 18
DOOR = 84
REACH = 80              # how close you must be to a prop to copy it
MAX_DISGUISE_R = 34
KILLER_ALL = 10         # killer catches everyone
KILLER_EACH = 2         # otherwise per catch...
KILLER_MAX_PARTIAL = 8  # ...up to this

HIDE_TIMES = (15, 20, 30)
ROUND_TIMES = (90, 120, 180, 240)
CYCLES = (1, 2)

OUTDOOR = {"tree": 34, "pine": 30, "bush": 24, "rock": 24, "car": 34, "barrel": 19, "crate": 21, "trash": 17,
           "cone": 15, "hydrant": 14, "mailbox": 16, "bike": 22, "flower": 16}
INDOOR = {"chair": 16, "couch": 28, "bed": 30, "plant": 17, "tv": 20, "gift": 18, "toilet": 17, "tub": 28,
          "guitar": 18, "teddy": 17, "basket": 18, "books": 17, "clock": 16}
RADIUS = {**OUTDOOR, **INDOOR, "fountain": 44}


# ---------------------------------------------------------------------- geometry
def circle_hits_rect(x, y, r, rect):
    rx, ry, rw, rh = rect
    nx = min(max(x, rx), rx + rw)
    ny = min(max(y, ry), ry + rh)
    return (x - nx) ** 2 + (y - ny) ** 2 < r * r


def ray_circle(ox, oy, dx, dy, cx, cy, r):
    """Distance along a ray (unit direction) to a circle, or None."""
    fx, fy = ox - cx, oy - cy
    b = fx * dx + fy * dy
    c = fx * fx + fy * fy - r * r
    disc = b * b - c
    if disc < 0:
        return None
    s = math.sqrt(disc)
    t = -b - s
    if t < 0:
        t = -b + s
    return t if t >= 0 else None


def ray_rect(ox, oy, dx, dy, rect):
    rx, ry, rw, rh = rect
    t0, t1 = -1e9, 1e9
    for o, d, lo, hi in ((ox, dx, rx, rx + rw), (oy, dy, ry, ry + rh)):
        if abs(d) < 1e-9:
            if o < lo or o > hi:
                return None
        else:
            a, b = (lo - o) / d, (hi - o) / d
            if a > b:
                a, b = b, a
            t0, t1 = max(t0, a), min(t1, b)
            if t0 > t1:
                return None
    if t1 < 0:
        return None
    return max(0.0, t0)


# ---------------------------------------------------------------------- the map
def make_map(n, rng):
    """A little town: streets, buildings with doors (and sometimes a wall inside), props."""
    cols, rows, cw, ch = (4, 2, 560, 700) if n <= 4 else (5, 3, 560, 620) if n <= 8 else (6, 3, 560, 640)
    w, h = cols * cw, rows * ch
    cx, cy = w / 2, h / 2
    walls = [[-60, -60, w + 120, 60], [-60, h, w + 120, 60], [-60, 0, 60, h], [w, 0, 60, h]]
    rooms, doors = [], []
    pad = 80
    streets = [[0, r * ch - pad + 20, w, 2 * pad - 40] for r in range(1, rows)] + \
              [[c * cw - pad + 20, 0, 2 * pad - 40, h] for c in range(1, cols)]
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * cw, r * ch
            if x0 < cx < x0 + cw and y0 < cy < y0 + ch:
                continue                                    # the middle square is the town plaza
            if rng.random() < 0.15:
                continue                                    # a park instead of a building
            for _ in range(15):                             # keep clear of the plaza in the middle
                bw = rng.randint(280, cw - 2 * pad)
                bh = rng.randint(250, ch - 2 * pad)
                bx = x0 + pad + rng.random() * (cw - 2 * pad - bw)
                by = y0 + pad + rng.random() * (ch - 2 * pad - bh)
                if not (bx < cx + 210 and bx + bw > cx - 210 and by < cy + 210 and by + bh > cy - 210):
                    break
            else:
                continue
            bx, by = round(bx), round(by)
            sides = rng.sample(["top", "bottom", "left", "right"], 2)
            gaps_x = []     # doors on the top and bottom walls (an inside wall must not cut through them)
            for side in ("top", "bottom", "left", "right"):
                horiz = side in ("top", "bottom")
                length = bw if horiz else bh
                if side in sides:
                    d = rng.randint(WALL + 26, length - WALL - 26 - DOOR)
                    parts = [(0, d), (d + DOOR, length - d - DOOR)]
                    if horiz:
                        gaps_x.append((bx + d, bx + d + DOOR))
                    doors.append((bx + d + DOOR / 2, by + (0 if side == "top" else bh)) if horiz
                                 else (bx + (0 if side == "left" else bw), by + d + DOOR / 2))
                else:
                    parts = [(0, length)]
                for start, size in parts:
                    if horiz:
                        walls.append([bx + start, by if side == "top" else by + bh - WALL, size, WALL])
                    else:
                        walls.append([bx if side == "left" else bx + bw - WALL, by + start, WALL, size])
            if bw >= 380 and rng.random() < 0.7:                # split the inside into two rooms
                for _ in range(10):
                    mx = round(bx + bw * rng.uniform(0.42, 0.58))
                    if all(mx + WALL + 2 * PLAYER_R + 12 < g0 or mx - 2 * PLAYER_R - 12 > g1 for g0, g1 in gaps_x):
                        break
                else:
                    mx = None
            else:
                mx = None
            if mx is not None:
                gap = rng.randint(WALL + 20, bh - WALL - 20 - DOOR)
                walls.append([mx, by, WALL, gap])
                walls.append([mx, by + gap + DOOR, WALL, bh - gap - DOOR])
                doors.append((mx + WALL / 2, by + gap + DOOR / 2))
            rooms.append([bx, by, bw, bh, len(rooms) % 6])

    props = [["fountain", round(cx), round(cy), RADIUS["fountain"]]]

    def free(x, y, r, inside):
        if any(circle_hits_rect(x, y, r + 6, wall) for wall in walls):
            return False
        if any((x - px) ** 2 + (y - py) ** 2 < (r + pr + 2 * PLAYER_R + 10) ** 2 for _, px, py, pr in props):
            return False
        if any((x - dx) ** 2 + (y - dy) ** 2 < (r + 70) ** 2 for dx, dy in doors):
            return False
        if not inside:
            # always leave a gap a player fits through, next to buildings and along the edge of the map
            if any(circle_hits_rect(x, y, r + 2 * PLAYER_R + 6, room[:4]) for room in rooms):
                return False
            edge = r + 2 * PLAYER_R + 8
            if x < edge or y < edge or x > w - edge or y > h - edge:
                return False
            if (x - cx) ** 2 + (y - cy) ** 2 < 230 ** 2:
                return False
        return True

    for bx, by, bw, bh, _ in rooms:
        want = int(bw * bh / 24000) + rng.randint(1, 3)
        for _ in range(want * 25):
            if want <= 0:
                break
            kind = rng.choice(list(INDOOR))
            r = INDOOR[kind]
            x = rng.uniform(bx + WALL + r + 4, bx + bw - WALL - r - 4)
            y = rng.uniform(by + WALL + r + 4, by + bh - WALL - r - 4)
            if free(x, y, r, True):
                props.append([kind, round(x), round(y), r])
                want -= 1
    want = int(w * h / 40000)
    kinds = list(OUTDOOR)
    for _ in range(want * 30):
        if want <= 0:
            break
        kind = rng.choice(kinds)
        r = OUTDOOR[kind]
        x, y = rng.uniform(r + 10, w - r - 10), rng.uniform(r + 10, h - r - 10)
        if free(x, y, r, False):
            props.append([kind, round(x), round(y), r])
            want -= 1
    return {"w": w, "h": h, "walls": walls, "rooms": rooms, "props": props, "streets": streets, "spawn": [round(cx), round(cy)]}


GRID = 160


class Town:
    """Collision and visibility questions about one map (walls and props are kept in a grid,
    so a check only looks at the things nearby)."""

    def __init__(self, m):
        self.m = m
        self.walls = m["walls"]
        self.props = m["props"]
        self.rooms = m["rooms"]
        self.cells = {}
        pad = 60   # bigger than anything we check with
        for wall in self.walls:
            x, y, w, h = wall
            self._add(("w", wall), x - pad, y - pad, x + w + pad, y + h + pad)
        for prop in self.props:
            _, x, y, r = prop
            self._add(("p", prop), x - r - pad, y - r - pad, x + r + pad, y + r + pad)

    def _add(self, item, x0, y0, x1, y1):
        for gx in range(int(max(0, x0) // GRID), int(max(0, min(x1, self.m["w"])) // GRID) + 1):
            for gy in range(int(max(0, y0) // GRID), int(max(0, min(y1, self.m["h"])) // GRID) + 1):
                self.cells.setdefault((gx, gy), []).append(item)

    def blocked(self, x, y, r=MOVE_R):
        if x < 0 or y < 0 or x > self.m["w"] or y > self.m["h"]:
            return True
        for kind, it in self.cells.get((int(x // GRID), int(y // GRID)), ()):
            if kind == "w":
                if circle_hits_rect(x, y, r, it):
                    return True
            elif (x - it[1]) ** 2 + (y - it[2]) ** 2 < (r + it[3] - 3) ** 2:
                return True
        return False

    def room_of(self, x, y):
        for i, (bx, by, bw, bh, _) in enumerate(self.rooms):
            if bx <= x <= bx + bw and by <= y <= by + bh:
                return i
        return None

    def spot_near(self, x, y, rng, lo=70, hi=190):
        for _ in range(200):
            a = rng.uniform(0, math.tau)
            d = rng.uniform(lo, hi)
            px, py = x + math.cos(a) * d, y + math.sin(a) * d
            if not self.blocked(px, py, PLAYER_R + 4):
                return round(px), round(py)
            hi += 2
        return round(x), round(y + 120)


class PropHunt(Game):
    key = "prophunt"
    max_players = 10

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"hide": 20, "time": 120, "cycles": 1}
        self.scores = {}
        self.order = []
        self.round_no = 0
        self.total = 0
        self.r = None          # this round
        self.ps = {}           # uid -> player in this round
        self.town = None
        self.tick_timer = None
        self.next_timer = None
        self.final = None
        self.last = None       # the last round's summary
        self.tally = {}        # uid -> {"catches", "survived", "aces"} for stats
        self.xray = set()
        self.rng = random.Random()

    def listed(self):
        return self.phase in ("lobby", "over")

    # ------------------------------------------------------------------ state
    def round_public(self):
        r = self.r
        if not r:
            return None
        now = time.time()
        return {"n": self.round_no, "total": self.total, "killer": r["killer"], "map": r["map"],
                "hide": max(0.0, r["hunt_at"] - now), "left": max(0.0, r["ends"] - now),
                "ping": max(0.0, r["next_ping"] - now), "players": list(self.ps),
                "caught": list(r["caught"]), "alive": self.alive_hiders()}

    def you(self, uid):
        p = self.ps.get(uid)
        if not p:
            return None
        return {"x": p["x"], "y": p["y"], "role": p["role"], "alive": p["alive"], "prop": p["prop"],
                "ammo": p.get("ammo"), "reloading": bool(p.get("reload_at"))}

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "scores": self.scores, "round": self.round_public(),
                "you": self.you(m.uid) if m else None, "final": self.final, "last": self.last}

    def alive_hiders(self):
        return [uid for uid, p in self.ps.items() if p["role"] == "hider" and p["alive"]]

    # ------------------------------------------------------------------ messages
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase in ("lobby", "over"):
            if int(num(msg.get("hide"), 0)) in HIDE_TIMES:
                self.settings["hide"] = int(msg["hide"])
            if int(num(msg.get("time"), 0)) in ROUND_TIMES:
                self.settings["time"] = int(msg["time"])
            if int(num(msg.get("cycles"), 0)) in CYCLES:
                self.settings["cycles"] = int(msg["cycles"])
            self.broadcast("settings", settings=self.settings)
        elif t == "start" and host and self.phase in ("lobby", "over"):
            self.start(m)
        elif t == "end" and host and self.phase not in ("lobby", "over"):
            self.finish()
        elif t == "pos":
            self.move(m, msg)
        elif t == "shoot":
            self.shoot(m, msg)
        elif t == "reload":
            p = self.ps.get(m.uid)
            if p and p["role"] == "killer" and not p["reload_at"] and p["ammo"] < MAG and self.phase == "hunting":
                p["reload_at"] = time.time() + RELOAD
                m.send("g:ammo", ammo=p["ammo"], reloading=True)
        elif t == "disguise":
            self.disguise(m, msg)

    # ------------------------------------------------------------------ flow
    def start(self, m):
        players = [x.uid for x in self.room.players_now()]
        if len(players) < 2:
            m.send("g:toast", text="You need at least 2 players (1 killer + 1 hider) 🙂")
            return
        self.rng.shuffle(players)
        self.order = players
        self.total = len(players) * self.settings["cycles"]
        self.round_no = 0
        self.scores = {uid: 0 for uid in players}
        self.tally = {}
        self.final = None
        self.last = None
        self.tainted = False
        self.next_round()

    def next_round(self):
        self.room.cancel(self.next_timer)
        self.round_no += 1
        if self.round_no > self.total:
            return self.finish()
        here = {x.uid for x in self.room.players_now()}
        killer = None
        for k in range(len(self.order)):
            uid = self.order[(self.round_no - 1 + k) % len(self.order)]
            if uid in here:
                killer = uid
                break
        if killer is None or len(here) < 2:
            return self.finish()
        if killer != self.order[(self.round_no - 1) % len(self.order)]:
            # the planned killer left: their turn goes to the next person, so shift the rotation
            i = self.order.index(killer)
            j = (self.round_no - 1) % len(self.order)
            self.order[i], self.order[j] = self.order[j], self.order[i]
        for uid in here:
            self.scores.setdefault(uid, 0)
        town_map = make_map(len(here), self.rng)
        self.town = Town(town_map)
        now = time.time()
        cx, cy = town_map["spawn"]
        self.ps = {}
        for uid in here:
            if uid == killer:
                x, y = self.town.spot_near(cx, cy, self.rng, 70, 90)
            else:
                x, y = self.town.spot_near(cx, cy, self.rng, 90, 210)
            self.ps[uid] = {"x": x, "y": y, "role": "killer" if uid == killer else "hider", "alive": True, "prop": None,
                            "t": now, "hist": [], "disguised_at": 0.0}
        k = self.ps[killer]
        k.update(ammo=MAG, reload_at=None, shot=0.0, a=0.0, off_since=None)
        hide = self.settings["hide"]
        self.r = {"killer": killer, "map": town_map, "hunt_at": now + hide, "ends": now + hide + self.settings["time"],
                  "next_ping": now + hide + PING_EVERY, "warned": False, "caught": [], "gained": {}}
        self.xray = set()
        self.phase = "hiding"
        for mm in self.room.members.values():
            mm.send("g:round", round=self.round_public(), you=self.you(mm.uid), scores=self.scores)
        killer_m = self.room.members.get(killer)
        self.room.system(f"🔫 Round {self.round_no}/{self.total}: {killer_m.name if killer_m else '?'} is the killer! Hiders, hide!")
        self.room.cancel(self.tick_timer)
        self.tick_timer = self.room.later(TICK, self.tick)

    def tick(self):
        if self.phase not in ("hiding", "hunting"):
            return
        now = time.time()
        r = self.r
        if self.phase == "hiding" and now >= r["hunt_at"]:
            self.phase = "hunting"
            self.broadcast("hunt", left=self.settings["time"])
        if self.phase == "hunting":
            if now >= r["ends"]:
                return self.end_round("time")
            k = self.ps[r["killer"]]
            km = self.room.members.get(r["killer"])
            if not km or not km.online:
                k["off_since"] = k["off_since"] or now
                if now - k["off_since"] > KILLER_GONE:
                    return self.end_round("killer")
            else:
                k["off_since"] = None
        # schedule the next tick first, so one bad snapshot can never freeze the round
        self.tick_timer = self.room.later(TICK, self.tick)
        if self.phase == "hunting":
            k = self.ps[r["killer"]]
            if k["reload_at"] and now >= k["reload_at"]:
                k["reload_at"] = None
                k["ammo"] = MAG
                self.send_to(r["killer"], "ammo", ammo=MAG, reloading=False)
            if not r["warned"] and now >= r["next_ping"] - PING_WARN:
                r["warned"] = True
                for uid in self.alive_hiders():
                    self.send_to(uid, "pingsoon", seconds=PING_WARN)
            if now >= r["next_ping"]:
                r["next_ping"] += PING_EVERY
                r["warned"] = False
                self.ping()
        self.snapshots(now)

    def send_to(self, uid, t, **data):
        m = self.room.members.get(uid)
        if m:
            self.send(m, t, **data)

    def watchers_of_killer(self):
        """Everyone who sees the game through the killer's eyes: the killer, caught hiders, watchers."""
        out = []
        for mm in self.room.members.values():
            p = self.ps.get(mm.uid)
            if not (p and p["role"] == "hider" and p["alive"]):
                out.append(mm)
        return out

    def ping(self):
        spots = []
        for uid in self.alive_hiders():
            p = self.ps[uid]
            a = self.rng.uniform(0, math.tau)
            d = self.rng.uniform(0, PING_SPREAD * 0.8)
            spots.append([round(p["x"] + math.cos(a) * d), round(p["y"] + math.sin(a) * d)])
        self.rng.shuffle(spots)
        for mm in self.watchers_of_killer():
            self.send(mm, "ping", spots=spots, radius=PING_SPREAD)
        for uid in self.alive_hiders():
            self.send_to(uid, "pinged")

    def snapshots(self, now):
        r = self.r
        killer = self.ps[r["killer"]]
        rooms = {uid: self.town.room_of(p["x"], p["y"]) for uid, p in self.ps.items()}
        left = (r["hunt_at"] if self.phase == "hiding" else r["ends"]) - now
        for mm in self.room.members.values():
            if not mm.online:
                continue
            me = self.ps.get(mm.uid)
            viewer_uid = mm.uid if (me and me["role"] == "hider" and me["alive"]) else r["killer"]
            viewer = self.ps[viewer_uid]
            blind = viewer_uid == r["killer"] and self.phase == "hiding"
            vroom = rooms[viewer_uid]
            xray = mm.uid in self.xray
            ents = []
            for uid, q in self.ps.items():
                if uid == mm.uid or not q["alive"]:
                    continue
                if not xray and uid != viewer_uid:
                    if blind and q["role"] == "hider":
                        continue
                    if (q["x"] - viewer["x"]) ** 2 + (q["y"] - viewer["y"]) ** 2 > VIEW * VIEW:
                        continue
                    if rooms[uid] is not None and rooms[uid] != vroom:
                        continue
                e = [uid, round(q["x"], 1), round(q["y"], 1), q["prop"] or ""]
                if q["role"] == "killer":
                    e.append(round(q.get("a", 0), 2))
                ents.append(e)
            data = {"e": ents, "ph": self.phase, "tl": round(max(0.0, left), 1), "alive": len(self.alive_hiders())}
            if me and me["role"] == "killer":
                data["ammo"] = me["ammo"]
            self.send(mm, "snap", **data)

    # ------------------------------------------------------------------ actions
    def move(self, m, msg):
        p = self.ps.get(m.uid)
        if not p or not p["alive"] or self.phase not in ("hiding", "hunting"):
            return
        if p["role"] == "killer":
            p["a"] = num(msg.get("a"), p.get("a", 0), -10, 10)
            if self.phase == "hiding":
                return
        now = time.time()
        dt = min(0.5, max(0.0, now - p["t"]))
        p["t"] = now
        x = num(msg.get("x"), p["x"], -50, self.town.m["w"] + 50)
        y = num(msg.get("y"), p["y"], -50, self.town.m["h"] + 50)
        speed = (KILLER_SPEED if p["role"] == "killer" else HIDER_SPEED) * (DISGUISED if p["prop"] else 1)
        limit = speed * dt * 1.4 + 12
        dx, dy = x - p["x"], y - p["y"]
        d = math.hypot(dx, dy)
        fix = False
        if d > limit:
            dx, dy = dx / d * limit, dy / d * limit
            d = limit
            fix = True
        steps = max(1, int(d / 8))
        nx, ny = p["x"], p["y"]
        for i in range(1, steps + 1):
            tx, ty = p["x"] + dx * i / steps, p["y"] + dy * i / steps
            if self.town.blocked(tx, ty):
                fix = True
                break
            nx, ny = tx, ty
        p["hist"].append((now, p["x"], p["y"]))
        if len(p["hist"]) > 12:
            del p["hist"][0]
        p["x"], p["y"] = nx, ny
        if fix:
            self.send(m, "fix", x=round(nx, 1), y=round(ny, 1))

    def disguise(self, m, msg):
        p = self.ps.get(m.uid)
        if not p or p["role"] != "hider" or not p["alive"] or self.phase not in ("hiding", "hunting"):
            return
        now = time.time()
        if now - p["disguised_at"] < 0.6:
            return
        i = msg.get("i")
        if i is None:
            p["prop"] = None
        else:
            if not isinstance(i, int) or not 0 <= i < len(self.town.props):
                return
            kind, px, py, pr = self.town.props[i]
            if pr > MAX_DISGUISE_R or math.hypot(px - p["x"], py - p["y"]) > REACH + pr + PLAYER_R:
                self.send(m, "toast", text="Get closer to it first!")
                return
            p["prop"] = kind
        p["disguised_at"] = now
        self.send(m, "disguised", prop=p["prop"])

    def shoot(self, m, msg):
        r = self.r
        p = self.ps.get(m.uid)
        if self.phase != "hunting" or not p or p["role"] != "killer":
            return
        now = time.time()
        if now - p["shot"] < SHOT_GAP or p["reload_at"] or p["ammo"] <= 0:
            return
        a = num(msg.get("a"), p.get("a", 0), -10, 10)
        p["a"] = a
        dx, dy = math.cos(a), math.sin(a)
        ox, oy = p["x"] + dx * (PLAYER_R + 4), p["y"] + dy * (PLAYER_R + 4)
        best, hit = GUN_RANGE, None
        for wall in self.town.walls:
            t = ray_rect(ox, oy, dx, dy, wall)
            if t is not None and t < best:
                best, hit = t, "wall"
        for _, px, py, pr in self.town.props:
            t = ray_circle(ox, oy, dx, dy, px, py, pr)
            if t is not None and t < best:
                best, hit = t, "prop"
        victim = None
        for uid in self.alive_hiders():
            q = self.ps[uid]
            rr = (RADIUS.get(q["prop"], PLAYER_R) if q["prop"] else PLAYER_R) + 4
            # where they are now, and where they were a moment ago (what the killer's screen showed)
            spots = [(q["x"], q["y"])] + [(hx, hy) for ht, hx, hy in q["hist"] if now - ht <= 0.25]
            for hx, hy in spots:
                t = ray_circle(ox, oy, dx, dy, hx, hy, rr)
                if t is not None and t < best:
                    best, hit, victim = t, "hider", uid
        p["shot"] = now
        p["ammo"] -= 1
        if p["ammo"] <= 0:
            p["reload_at"] = now + RELOAD
        x1, y1 = ox + dx * best, oy + dy * best
        shot = {"x0": round(ox), "y0": round(oy), "x1": round(x1), "y1": round(y1), "hit": hit}
        for mm in self.room.members.values():
            q = self.ps.get(mm.uid)
            if q and q["role"] == "hider" and q["alive"]:
                near = min((ox - q["x"]) ** 2 + (oy - q["y"]) ** 2, (x1 - q["x"]) ** 2 + (y1 - q["y"]) ** 2)
                if near > (VIEW + 100) ** 2:
                    continue
            self.send(mm, "shot", **shot)
        self.send(m, "ammo", ammo=p["ammo"], reloading=bool(p["reload_at"]))
        if victim:
            self.catch(victim)

    def catch(self, uid):
        r = self.r
        q = self.ps[uid]
        q["alive"] = False
        r["caught"].append(uid)
        pts = len(r["caught"])
        r["gained"][uid] = pts
        self.scores[uid] = self.scores.get(uid, 0) + pts
        mm = self.room.members.get(uid)
        km = self.room.members.get(r["killer"])
        self.tally.setdefault(r["killer"], {}).setdefault("catches", 0)
        self.tally[r["killer"]]["catches"] += 1
        left = len(self.alive_hiders())
        self.broadcast("caught", id=uid, name=mm.name if mm else "?", avatar=mm.avatar if mm else "👻",
                       killer=km.name if km else "?", prop=q["prop"], x=round(q["x"]), y=round(q["y"]),
                       pts=pts, left=left, scores=self.scores)
        if left == 0:
            self.end_round("all")

    def end_round(self, why):
        if self.phase not in ("hiding", "hunting"):
            return
        r = self.r
        self.room.cancel(self.tick_timer)
        self.phase = "roundover"
        everyone = len(self.ps)
        survivors = self.alive_hiders()
        killer = r["killer"]
        if why == "killer":
            kpts = 0
        elif not survivors:
            kpts = KILLER_ALL
            self.tally.setdefault(killer, {}).setdefault("aces", 0)
            self.tally[killer]["aces"] += 1
        else:
            kpts = min(KILLER_MAX_PARTIAL, KILLER_EACH * len(r["caught"]))
        r["gained"][killer] = kpts
        self.scores[killer] = self.scores.get(killer, 0) + kpts
        for uid in survivors:
            r["gained"][uid] = everyone
            self.scores[uid] = self.scores.get(uid, 0) + everyone
            if why == "time":       # really outlasted the killer (not just the killer leaving)
                t = self.tally.setdefault(uid, {})
                t["survived"] = t.get("survived", 0) + 1
        names = {uid: (self.room.members[uid].name if uid in self.room.members else "?") for uid in self.ps}
        self.last = {"n": self.round_no, "total": self.total, "why": why, "killer": killer, "caught": list(r["caught"]),
                     "survivors": survivors, "gained": r["gained"], "names": names, "next": ROUND_PAUSE,
                     "final": self.round_no >= self.total,
                     "props": {uid: p["prop"] for uid, p in self.ps.items() if p["prop"]},
                     "spots": {uid: [round(p["x"]), round(p["y"])] for uid, p in self.ps.items() if p["alive"] and p["role"] == "hider"}}
        self.broadcast("roundover", last=self.last, scores=self.scores)
        self.room.cancel(self.next_timer)
        self.next_timer = self.room.later(ROUND_PAUSE, self.next_round)

    def finish(self):
        self.room.cancel(self.tick_timer)
        self.room.cancel(self.next_timer)
        if self.phase in ("lobby", "over"):
            return
        self.phase = "over"
        self.r = None
        self.ps = {}
        rows = []
        for uid, pts in self.scores.items():
            mm = self.room.members.get(uid)
            rows.append({"id": uid, "name": mm.name if mm else "Gone", "avatar": mm.avatar if mm else "👻",
                         "color": mm.color if mm else "#888888", "points": pts})
        rows.sort(key=lambda x: -x["points"])
        self.final = rows
        self.broadcast("over", ranking=rows, scores=self.scores)
        if rows:
            extra = {}
            for uid, t in self.tally.items():
                extra[uid] = {f"prophunt.{k}": ("add", v) for k, v in t.items() if v}
            self.record_ranking(rows, "prophunt", extra=extra)

    # ------------------------------------------------------------------ people coming and going
    def on_join(self, m, rejoin):
        p = self.ps.get(m.uid)
        if p:
            p["t"] = time.time()

    def on_leave(self, m):
        p = self.ps.get(m.uid)
        if not p or self.phase not in ("hiding", "hunting"):
            return
        if p["role"] == "killer":
            self.room.system("🏃 The killer left, so this round is over.")
            self.end_round("killer")
        elif p["alive"]:
            p["alive"] = False
            if not self.alive_hiders():
                self.end_round("all")

    def on_chat(self, m, entry):
        """While hunting, caught players and watchers only talk to each other (no telling where people hide!)."""
        if self.phase not in ("hiding", "hunting"):
            return False
        p = self.ps.get(m.uid)
        if p and p["alive"]:
            return False
        entry = {**entry, "spec": True}
        for mm in self.room.members.values():
            q = self.ps.get(mm.uid)
            if not (q and q["alive"]):
                mm.send("chat", **entry)
        return True

    def on_admin(self, m, action, msg):
        if action == "xray" and self.phase in ("hiding", "hunting"):
            self.xray.add(m.uid)
            return "🔎 X-ray: you can see everyone this round."
        if action == "skip" and self.phase in ("hiding", "hunting"):
            self.end_round("skip")
            return "⏭️ Round skipped."
        if action == "end" and self.phase not in ("lobby", "over"):
            self.finish()
            return "🏁 Game ended."
        return None
