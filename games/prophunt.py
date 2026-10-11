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
MAPS = ("random", "town", "school", "mall", "house")
THEMES = MAPS[1:]

# power-ups: every round each hider gets decoys and a speed burst, the killer a radar and grenades
POWERS = {"hider": {"decoy": 2, "boost": 1}, "killer": {"radar": 1, "grenade": 2}}
BOOST_TIME = 3.0
BOOST = 1.6
GRENADE_RANGE = 430
FUSE = 0.9
BLAST = 100

# every prop and how big it is
RADIUS = {
    # town
    "tree": 34, "pine": 30, "bush": 24, "rock": 24, "car": 34, "barrel": 19, "crate": 21, "trash": 17,
    "cone": 15, "hydrant": 14, "mailbox": 16, "bike": 22, "flower": 16, "fountain": 44,
    # homes
    "chair": 16, "couch": 28, "bed": 30, "plant": 17, "tv": 20, "gift": 18, "toilet": 17, "tub": 28,
    "guitar": 18, "teddy": 17, "basket": 18, "books": 17, "clock": 16,
    # school
    "backpack": 16, "computer": 20, "microscope": 15, "abacus": 17, "palette": 16, "trophy": 15, "cabinet": 20,
    "piano": 24, "flask": 13, "basketball": 14, "bus": 34, "soccer": 14, "slide": 30,
    # mall
    "dress": 17, "shoe": 14, "bag": 16, "cart": 20, "icecream": 14, "pizza": 15, "coffee": 13, "camera": 14,
    "headphones": 14, "balloon": 15, "atm": 18,
    # party house
    "pan": 14, "cake": 16, "drink": 12, "speaker": 17, "disco": 16, "umbrella": 26, "float": 18, "bbq": 16,
}
SETS = {
    "town": {"out": ["tree", "pine", "bush", "rock", "car", "barrel", "crate", "trash", "cone", "hydrant", "mailbox", "bike", "flower"],
             "in": ["chair", "couch", "bed", "plant", "tv", "gift", "toilet", "tub", "guitar", "teddy", "basket", "books", "clock"]},
    "school": {"out": ["tree", "pine", "bush", "bus", "soccer", "slide", "bike", "trash", "cone", "flower", "basketball"],
               "in": ["chair", "books", "backpack", "computer", "microscope", "abacus", "palette", "trophy", "cabinet", "piano", "flask", "plant", "clock", "basketball"],
               "hall": ["plant", "cabinet", "trash", "trophy", "backpack"]},
    "mall": {"out": ["car", "cart", "cone", "tree", "bush", "trash", "barrel"],
             "in": ["dress", "shoe", "bag", "teddy", "gift", "tv", "guitar", "books", "camera", "headphones", "plant", "chair"],
             "hall": ["plant", "couch", "cart", "icecream", "balloon", "atm", "pizza", "coffee", "trash", "bag"]},
    "house": {"out": ["tree", "flower", "bush", "umbrella", "chair", "bbq", "float", "rock", "pine"],
              "in": ["bed", "couch", "tv", "toilet", "tub", "guitar", "teddy", "plant", "chair", "books", "clock", "pan", "cake", "pizza", "drink", "speaker", "disco", "balloon", "gift"],
              "hall": ["plant", "clock", "balloon", "gift", "speaker"]},
}
OUTDOOR = {k: RADIUS[k] for k in SETS["town"]["out"]}
INDOOR = {k: RADIUS[k] for k in SETS["town"]["in"]}


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


# ---------------------------------------------------------------------- the maps
def map_size(n):
    return (2400, 1500) if n <= 4 else (2900, 1800) if n <= 8 else (3200, 2000)


def border(w, h):
    return [[-60, -60, w + 120, 60], [-60, h, w + 120, 60], [-60, 0, 60, h], [w, 0, 60, h]]


def wall_line(walls, x, y, length, horiz, gaps):
    """A wall from (x, y) going right (horiz) or down, leaving door gaps [(start, size)] measured along it."""
    pos = 0
    for gs, gsize in sorted(gaps):
        if gs > pos:
            walls.append([x + pos, y, gs - pos, WALL] if horiz else [x, y + pos, WALL, gs - pos])
        pos = max(pos, gs + gsize)
    if pos < length:
        walls.append([x + pos, y, length - pos, WALL] if horiz else [x, y + pos, WALL, length - pos])


def split(rng, x0, x1, lo, hi):
    """Cut x0..x1 into pieces lo..hi long (hi must be at least 2 * lo)."""
    xs = [x0]
    while x1 - xs[-1] > hi:
        xs.append(xs[-1] + rng.randint(lo, min(hi, x1 - xs[-1] - lo)))
    xs.append(x1)
    return xs


def hallway_building(m, rng, X0, Y0, X1, Y1, CY0, CY1, lo, hi, door_w, outer_doors, color0, hall_kind):
    """Rooms above and below a hallway, inside one outer wall. The hallway's two ends are the main
    entrances, each room has a door onto the hallway, and some have a door outside or to the next room."""
    walls, rooms, doors = m["walls"], m["rooms"], m["doors"]
    m["floors"].append([X0, CY0, X1 - X0, CY1 - CY0, hall_kind])
    for band, (ya, yb) in enumerate(((Y0, CY0), (CY1, Y1))):
        xs = split(rng, X0, X1, lo, hi)
        n = len(xs) - 1
        outs = set(rng.sample(range(n), min(outer_doors, n)))
        outer_gaps, hall_gaps = [], []
        for i in range(n):
            a, b = xs[i], xs[i + 1]
            wdt = b - a
            d = rng.randint(WALL + 24, wdt - WALL - 24 - door_w)
            hall_gaps.append((a - X0 + d, door_w))
            doors.append((a + d + door_w / 2, CY0 if band == 0 else CY1))
            if i in outs:
                d2 = rng.randint(WALL + 24, wdt - WALL - 24 - DOOR)
                outer_gaps.append((a - X0 + d2, DOOR))
                doors.append((a + d2 + DOOR / 2, Y0 if band == 0 else Y1))
            rooms.append([a, ya, wdt, yb - ya, (len(rooms) + color0) % 6])
            if i > 0:       # the wall between this room and the one before (sometimes with a door)
                gaps = []
                if rng.random() < 0.45:
                    g = rng.randint(WALL + 20, (yb - ya) - WALL - 20 - DOOR)
                    gaps.append((g, DOOR))
                    doors.append((a + WALL / 2, ya + g + DOOR / 2))
                wall_line(walls, a, ya, yb - ya, False, gaps)
        if band == 0:
            wall_line(walls, X0, Y0, X1 - X0, True, outer_gaps)
            wall_line(walls, X0, CY0 - WALL, X1 - X0, True, hall_gaps)
        else:
            wall_line(walls, X0, Y1 - WALL, X1 - X0, True, outer_gaps)
            wall_line(walls, X0, CY1, X1 - X0, True, hall_gaps)
    for x in (X0, X1 - WALL):       # the ends of the hallway stay open
        wall_line(walls, x, Y0, Y1 - Y0, False, [(CY0 - Y0, CY1 - CY0)])
        doors.append((x + WALL / 2, (CY0 + CY1) / 2))


def place(m, rng, kinds, count, area, ok=None, spacing=2 * PLAYER_R + 10, door_gap=70):
    """Scatter props in area (x0, y0, x1, y1), never blocking doors or squeezing paths shut."""
    x0, y0, x1, y1 = area
    props, walls, doors = m["props"], m["walls"], m["doors"]
    tries = count * 30
    while count > 0 and tries > 0:
        tries -= 1
        kind = rng.choice(kinds)
        r = RADIUS[kind]
        if x1 - x0 < 2 * r + 2 or y1 - y0 < 2 * r + 2:
            continue
        x, y = rng.uniform(x0 + r, x1 - r), rng.uniform(y0 + r, y1 - r)
        if any(circle_hits_rect(x, y, r + 6, wl) for wl in walls):
            continue
        if any(circle_hits_rect(x, y, r + 2 * PLAYER_R + 8, pl) for pl in m["pools"]):
            continue
        if any((x - px) ** 2 + (y - py) ** 2 < (r + pr + spacing) ** 2 for _, px, py, pr in props):
            continue
        if any((x - dx) ** 2 + (y - dy) ** 2 < (r + door_gap) ** 2 for dx, dy in doors):
            continue
        if ok and not ok(x, y, r):
            continue
        props.append([kind, round(x), round(y), r])
        count -= 1


def outside(m, X0, Y0, X1, Y1, cx, cy, clear=230):
    """For props outdoors: away from the building, the map edge and the spawn spot."""
    gap = 2 * PLAYER_R + 6
    w, h = m["w"], m["h"]

    def ok(x, y, r):
        if X0 - r - gap < x < X1 + r + gap and Y0 - r - gap < y < Y1 + r + gap:
            return False
        if any(circle_hits_rect(x, y, r + gap, room[:4]) for room in m["rooms"]):
            return False
        edge = r + gap + 2
        if x < edge or y < edge or x > w - edge or y > h - edge:
            return False
        return (x - cx) ** 2 + (y - cy) ** 2 >= clear ** 2
    return ok


def fill_rooms(m, rng, kinds):
    for bx, by, bw, bh, _ in m["rooms"]:
        place(m, rng, kinds, int(bw * bh / 24000) + rng.randint(1, 3),
              (bx + WALL + 4, by + WALL + 4, bx + bw - WALL - 4, by + bh - WALL - 4))


def hall_edges(m, rng, kinds, X0, X1, CY0, CY1, cx, cy, count):
    """A few small props along the walls of a hallway (the middle stays clear)."""
    small = [k for k in kinds if RADIUS[k] <= 20]
    away = lambda x, y, r: (x - cx) ** 2 + (y - cy) ** 2 >= 220 ** 2
    for y0 in (CY0 + 4, CY1 - 44):
        place(m, rng, small, count, (X0 + 60, y0, X1 - 60, y0 + 40), ok=away)


def new_map(theme, w, h):
    return {"theme": theme, "w": w, "h": h, "walls": border(w, h), "rooms": [], "doors": [], "floors": [], "pools": [],
            "props": [], "streets": [], "spawn": [round(w / 2), round(h / 2)]}


def make_town(n, rng):
    """A little town: streets, buildings with doors (and sometimes a wall inside), props."""
    cols, rows, cw, ch = (4, 2, 560, 700) if n <= 4 else (5, 3, 560, 620) if n <= 8 else (6, 3, 560, 640)
    w, h = cols * cw, rows * ch
    cx, cy = w / 2, h / 2
    m = new_map("town", w, h)
    walls, rooms, doors = m["walls"], m["rooms"], m["doors"]
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
    m["props"], m["streets"] = props, streets
    return m




def make_school(n, rng):
    """A school: classrooms along a long hallway, a yard and a playground outside."""
    w, h = map_size(n)
    m = new_map("school", w, h)
    cx, cy = w / 2, h / 2
    X0, Y0, X1, Y1 = 250, 230, w - 250, h - 230
    CY0, CY1 = round(cy - 75), round(cy + 75)
    hallway_building(m, rng, X0, Y0, X1, Y1, CY0, CY1, 240, 520, DOOR, 1, 0, "tile")
    m["floors"].insert(0, [60, h - 190, w - 120, 130, "asphalt"])
    m["floors"].insert(0, [60, 60, w - 120, 110, "asphalt"])
    fill_rooms(m, rng, SETS["school"]["in"])
    hall_edges(m, rng, SETS["school"]["hall"], X0, X1, CY0, CY1, cx, cy, 4 + n // 2)
    place(m, rng, SETS["school"]["out"], int(w * h / 60000), (0, 0, w, h), ok=outside(m, X0, Y0, X1, Y1, cx, cy))
    return m


def make_mall(n, rng):
    """A shopping mall: shops around a big hall with a fountain, and a parking lot outside."""
    w, h = map_size(n)
    m = new_map("mall", w, h)
    cx, cy = w / 2, h / 2
    X0, Y0, X1, Y1 = 230, 210, w - 230, h - 210
    CY0, CY1 = Y0 + 250, Y1 - 250
    hallway_building(m, rng, X0, Y0, X1, Y1, CY0, CY1, 230, 470, 130, 1, 2, "mall")
    m["props"].append(["fountain", round(cx), round(cy), RADIUS["fountain"]])
    fill_rooms(m, rng, SETS["mall"]["in"])
    away = lambda x, y, r: (x - cx) ** 2 + (y - cy) ** 2 >= 230 ** 2
    place(m, rng, SETS["mall"]["hall"], int((X1 - X0) * (CY1 - CY0) / 50000), (X0 + WALL + 10, CY0 + 10, X1 - WALL - 10, CY1 - 10), ok=away)
    place(m, rng, SETS["mall"]["out"], int(w * h / 60000), (0, 0, w, h), ok=outside(m, X0, Y0, X1, Y1, cx, cy))
    return m


def make_house(n, rng):
    """A party house: bedrooms, a kitchen, bathrooms along a hallway, and a garden with a pool."""
    w, h = map_size(n)
    m = new_map("house", w, h)
    cx, cy = w / 2, h / 2
    X0, X1 = round(w * 0.16), round(w * 0.84)
    Y0, Y1 = round(h * 0.2), round(h * 0.8)
    CY0, CY1 = round(cy - 65), round(cy + 65)
    hallway_building(m, rng, X0, Y0, X1, Y1, CY0, CY1, 230, 470, DOOR, 1, 4, "wood")
    # the pool, in the garden above or below the house
    pw, ph = 340, min(150, Y0 - 2 * (2 * PLAYER_R + 22))
    px = round(rng.uniform(X0, X1 - pw))
    py = round((Y0 - ph) / 2) if rng.random() < 0.5 else round(Y1 + (h - Y1 - ph) / 2)
    m["pools"].append([px, py, pw, ph])
    fill_rooms(m, rng, SETS["house"]["in"])
    hall_edges(m, rng, SETS["house"]["hall"], X0, X1, CY0, CY1, cx, cy, 3 + n // 2)
    place(m, rng, SETS["house"]["out"], int(w * h / 55000), (0, 0, w, h), ok=outside(m, X0, Y0, X1, Y1, cx, cy))
    return m


BUILDERS = {"town": make_town, "school": make_school, "mall": make_mall, "house": make_house}


def connected(m, step=20):
    """Can you walk from the spawn to (almost) everywhere, and into every room?"""
    t = Town(m)
    W, H = int(m["w"] // step), int(m["h"] // step)
    ok = [[not t.blocked(x * step + step / 2, y * step + step / 2, PLAYER_R + 1) for x in range(W)] for y in range(H)]
    sx, sy = m["spawn"]
    start = None
    for rad in range(0, 300, step):
        for a in range(0, 360, 20):
            gx = int((sx + math.cos(math.radians(a)) * rad) // step)
            gy = int((sy + math.sin(math.radians(a)) * rad) // step)
            if 0 <= gx < W and 0 <= gy < H and ok[gy][gx]:
                start = (gx, gy)
                break
        if start:
            break
    if not start:
        return False
    seen = {start}
    todo = [start]
    while todo:
        x, y = todo.pop()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and ok[ny][nx] and (nx, ny) not in seen:
                seen.add((nx, ny))
                todo.append((nx, ny))
    free = sum(row.count(True) for row in ok)
    if len(seen) < 0.97 * free:
        return False
    for bx, by, bw, bh, _ in m["rooms"]:
        if not any((x, y) in seen for x in range(int(bx // step), int((bx + bw) // step) + 1)
                   for y in range(int(by // step), int((by + bh) // step) + 1)):
            return False
    return True


def make_map(n, rng, theme="town"):
    m = None
    for _ in range(8):
        m = BUILDERS.get(theme, make_town)(n, rng)
        if connected(m):
            break
    m.pop("doors", None)
    return m


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
        for wall in self.walls + m.get("pools", []):     # pools: you can't walk in them, but you can shoot over them
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
        self.settings = {"hide": 20, "time": 120, "cycles": 1, "map": "random"}
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
        self.decoys = {}       # id -> {"owner", "x", "y", "prop"}
        self.bombs = 0         # grenade counter (so an old grenade can't go off in a new round)
        self.last_theme = None

    def listed(self):
        return self.phase in ("lobby", "over")

    # ------------------------------------------------------------------ state
    def round_public(self):
        r = self.r
        if not r:
            return None
        now = time.time()
        return {"n": self.round_no, "total": self.total, "killer": r["killer"], "map": r["map"], "theme": r["map"]["theme"],
                "hide": max(0.0, r["hunt_at"] - now), "left": max(0.0, r["ends"] - now),
                "ping": max(0.0, r["next_ping"] - now), "players": list(self.ps),
                "caught": list(r["caught"]), "alive": self.alive_hiders()}

    def you(self, uid):
        p = self.ps.get(uid)
        if not p:
            return None
        return {"x": p["x"], "y": p["y"], "role": p["role"], "alive": p["alive"], "prop": p["prop"],
                "ammo": p.get("ammo"), "reloading": bool(p.get("reload_at")), "powers": dict(p["powers"]),
                "boost": max(0.0, p["boost_until"] - time.time())}

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
            if msg.get("map") in MAPS:
                self.settings["map"] = msg["map"]
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
        elif t == "power":
            self.power(m, msg)

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
        theme = self.settings["map"]
        if theme not in THEMES:
            theme = self.rng.choice([th for th in THEMES if th != self.last_theme])
        self.last_theme = theme
        town_map = make_map(len(here), self.rng, theme)
        self.town = Town(town_map)
        now = time.time()
        cx, cy = town_map["spawn"]
        self.ps = {}
        for uid in here:
            if uid == killer:
                x, y = self.town.spot_near(cx, cy, self.rng, 70, 90)
            else:
                x, y = self.town.spot_near(cx, cy, self.rng, 90, 210)
            role = "killer" if uid == killer else "hider"
            self.ps[uid] = {"x": x, "y": y, "role": role, "alive": True, "prop": None,
                            "t": now, "hist": [], "disguised_at": 0.0, "powers": dict(POWERS[role]), "boost_until": 0.0, "power_at": 0.0}
        k = self.ps[killer]
        k.update(ammo=MAG, reload_at=None, shot=0.0, a=0.0, off_since=None)
        hide = self.settings["hide"]
        self.r = {"killer": killer, "map": town_map, "hunt_at": now + hide, "ends": now + hide + self.settings["time"],
                  "next_ping": now + hide + PING_EVERY, "warned": False, "caught": [], "gained": {}}
        self.xray = set()
        self.decoys = {}
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

    def ping(self, radar=False):
        spots = []
        for uid in self.alive_hiders():
            p = self.ps[uid]
            a = self.rng.uniform(0, math.tau)
            d = self.rng.uniform(0, PING_SPREAD * 0.8)
            spots.append([round(p["x"] + math.cos(a) * d), round(p["y"] + math.sin(a) * d)])
        self.rng.shuffle(spots)
        for mm in self.watchers_of_killer():
            self.send(mm, "ping", spots=spots, radius=PING_SPREAD, radar=radar)
        for uid in self.alive_hiders():
            self.send_to(uid, "pinged", radar=radar)

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
            for did, d in self.decoys.items():
                if not xray:
                    if blind:
                        continue
                    if (d["x"] - viewer["x"]) ** 2 + (d["y"] - viewer["y"]) ** 2 > VIEW * VIEW:
                        continue
                    if d["room"] is not None and d["room"] != vroom:
                        continue
                # [id, x, y, prop, aim, looks like whom, is a decoy (only hiders and watchers are told)]
                ents.append([did, d["x"], d["y"], d["prop"] or "", None, d["owner"], 0 if mm.uid == r["killer"] else 1])
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
        if now < p["boost_until"] + 0.3:
            speed *= BOOST
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
        popped = None
        for did, d in self.decoys.items():
            t = ray_circle(ox, oy, dx, dy, d["x"], d["y"], RADIUS.get(d["prop"], PLAYER_R) + 2 if d["prop"] else PLAYER_R + 2)
            if t is not None and t < best:
                best, hit, victim, popped = t, "decoy", None, did
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
        if popped:
            self.pop_decoy(popped)
        if victim:
            self.catch(victim)

    # ------------------------------------------------------------------ power-ups
    def power(self, m, msg):
        p = self.ps.get(m.uid)
        kind = msg.get("p")
        if not p or not p["alive"] or self.phase not in ("hiding", "hunting") or kind not in p["powers"]:
            return
        now = time.time()
        if p["powers"][kind] <= 0 or now - p["power_at"] < 0.8:
            return
        if p["role"] == "killer" and self.phase != "hunting":
            return
        if kind == "decoy":
            did = f"~{self.rng.randrange(10 ** 8)}"
            self.decoys[did] = {"owner": m.uid, "x": round(p["x"], 1), "y": round(p["y"], 1), "prop": p["prop"],
                                "room": self.town.room_of(p["x"], p["y"])}
        elif kind == "boost":
            p["boost_until"] = now + BOOST_TIME
        elif kind == "radar":
            self.ping(radar=True)
        elif kind == "grenade":
            tx = num(msg.get("x"), p["x"], -100, self.town.m["w"] + 100)
            ty = num(msg.get("y"), p["y"], -100, self.town.m["h"] + 100)
            dx, dy = tx - p["x"], ty - p["y"]
            d = math.hypot(dx, dy)
            if d < 1:
                return
            dx, dy = dx / d, dy / d
            d = min(d, GRENADE_RANGE)
            for wall in self.town.walls:        # it bounces off the first wall in the way
                t = ray_rect(p["x"], p["y"], dx, dy, wall)
                if t is not None and t < d:
                    d = max(0.0, t - 12)
            x1, y1 = p["x"] + dx * d, p["y"] + dy * d
            self.bombs += 1
            bomb = (self.round_no, self.bombs)
            g = {"x0": round(p["x"]), "y0": round(p["y"]), "x1": round(x1), "y1": round(y1), "fuse": FUSE}
            for mm in self.room.members.values():
                self.send(mm, "grenade", **g)
            self.room.later(FUSE, self.explode, bomb, x1, y1)
        p["powers"][kind] -= 1
        p["power_at"] = now
        self.send(m, "powers", powers=p["powers"], used=kind, boost=BOOST_TIME if kind == "boost" else 0)

    def explode(self, bomb, x, y):
        if self.phase != "hunting" or bomb[0] != self.round_no:
            return
        hits = []
        for uid in self.alive_hiders():
            q = self.ps[uid]
            reach = BLAST + (RADIUS.get(q["prop"], PLAYER_R) if q["prop"] else PLAYER_R)
            dist = math.hypot(q["x"] - x, q["y"] - y)
            if dist > reach:
                continue
            if dist > 1:        # walls protect you from the blast
                dx, dy = (q["x"] - x) / dist, (q["y"] - y) / dist
                if any((t := ray_rect(x, y, dx, dy, wall)) is not None and t < dist - 4 for wall in self.town.walls):
                    continue
            hits.append(uid)
        popped = [did for did, d in self.decoys.items() if math.hypot(d["x"] - x, d["y"] - y) <= BLAST + PLAYER_R]
        self.broadcast("boom", x=round(x), y=round(y), r=BLAST)
        for did in popped:
            self.pop_decoy(did)
        for uid in hits:
            if self.phase == "hunting" and self.ps[uid]["alive"]:
                self.catch(uid)

    def pop_decoy(self, did):
        d = self.decoys.pop(did, None)
        if d:
            self.broadcast("decoy", id=did, x=round(d["x"]), y=round(d["y"]), owner=d["owner"])

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
