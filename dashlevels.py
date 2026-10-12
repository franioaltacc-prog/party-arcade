"""Neon Dash community levels: levels players build in the editor, post, and admins approve.

The tables live in the accounts database (see SCHEMA in accounts.py) and every query goes
through its q()/many() helpers, so this works with SQLite and Turso alike.

* Posting needs an account, and each player can post 3 levels in any 24 hours (admins are
  exempt). Every post counts, even if it's rejected or deleted later: rows are only marked,
  never removed, until the account itself is deleted.
* New levels are "pending": only their creator and admins can see them until an admin
  approves (or rejects) them. Approved levels can be unlisted again.
* The server checks the level's shape and limits (the browser's DashCore.checkLevel does the
  same). It can't run the game's physics, so the creator's recorded verify run is stored with
  the level and the admin's preview plays it back in the real game.
"""
import json
import math
import re
import time

from accounts import UPSERT, AuthError

POSTS_PER_DAY = 3
DAY = 86400
MAX_DATA = 100 * 1024         # bytes of level JSON (5000 objects fit)
MAX_REPLAY = 64 * 1024        # bytes of recorded inputs
LIMITS = {"len": (30, 800), "rows": 14, "objs": 5000, "zones": 40, "zone_w": (6, 200), "ceil": (3, 14),
          "gap": (2.5, 8), "path": 40, "name": 32, "desc": 140}
OBJ_TYPES = set("#^vopbr=_")
ZONE_MODES = ("ship", "ufo", "ball", "wave")
THEMES = ("easy", "normal", "hard", "insane")
SPEED, SUB = 10.4, 1 / 240    # the game's speed (blocks/s) and physics substep: a full run takes len / (SPEED * SUB) substeps
STATUSES = ("pending", "approved", "rejected", "deleted", "unlisted")
SORTS = {"new": "d.reviewed DESC, d.id DESC", "plays": "d.plays DESC, d.id DESC", "likes": "d.likes DESC, d.id DESC"}
PREVIEW_COLS = 120            # the browser's mini preview strip shows the start of the level

# the tables (dash_levels, dash_likes) are created with the rest of the database: see SCHEMA in accounts.py,
# and Accounts.wipe() removes a deleted account's levels and likes


def now():
    return int(time.time())


def clean_text(value, limit):
    text = "".join(ch for ch in str(value or "") if ch.isprintable())
    return " ".join(text.split())[:limit]


def is_int(v, lo, hi):
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def is_num(v, lo, hi):
    # the range check comes first: math.isfinite can't take a huge int (OverflowError); NaN fails the range check
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi and (isinstance(v, int) or math.isfinite(v))


def check_level(d):
    """A clean copy of a level from the editor, or AuthError saying what's wrong (same rules as DashCore.checkLevel)."""
    bad = AuthError
    if not isinstance(d, dict):
        raise bad("That isn't a Neon Dash level.")
    if not isinstance(d.get("name"), str) or not isinstance(d.get("desc", ""), str):
        raise bad("The name and description must be text.")
    name = clean_text(d.get("name"), 200)
    desc = clean_text(d.get("desc"), 1000)
    if not name or len(name) > LIMITS["name"]:
        raise bad(f"Give your level a name (up to {LIMITS['name']} characters).")
    if len(desc) > LIMITS["desc"]:
        raise bad(f"The description can be up to {LIMITS['desc']} characters.")
    if d.get("theme") not in THEMES:
        raise bad("Unknown colour theme.")
    if not isinstance(d.get("music", True), bool):
        raise bad("Music is on or off.")
    n = d.get("len")
    lo, hi = LIMITS["len"]
    if not is_int(n, lo, hi):
        raise bad(f"Levels are {lo}–{hi} blocks long.")
    objs, zones = d.get("objs"), d.get("zones", [])
    if not isinstance(objs, list) or len(objs) > LIMITS["objs"]:
        raise bad(f"Levels can have up to {LIMITS['objs']} objects.")
    if not isinstance(zones, list) or len(zones) > LIMITS["zones"]:
        raise bad(f"Levels can have up to {LIMITS['zones']} mode zones.")
    seen, clean_objs = set(), []
    for o in objs:
        if not (isinstance(o, list) and len(o) == 3 and isinstance(o[0], str) and o[0] in OBJ_TYPES
                and is_int(o[1], 0, n - 1) and is_int(o[2], 0, LIMITS["rows"] - 1)):
            raise bad("The level has a broken object.")
        if (o[1], o[2]) in seen:
            raise bad("Two objects are in the same spot.")
        seen.add((o[1], o[2]))
        clean_objs.append([o[0], o[1], o[2]])
    clean_zones, end = [], 0
    for z in zones:
        if not isinstance(z, list) or len(z) < 4:
            raise bad("The level has a broken mode zone.")
    for z in sorted(zones, key=lambda z: z[1] if is_int(z[1], 0, 10 ** 6) else 0):
        mode, x0, w, ceil = z[0], z[1], z[2], z[3]
        if not (isinstance(mode, str) and mode in ZONE_MODES and is_int(x0, 1, n) and is_int(w, *LIMITS["zone_w"])
                and is_int(ceil, *LIMITS["ceil"]) and x0 + w <= n):
            raise bad("The level has a broken mode zone.")
        if x0 < end:
            raise bad("Two mode zones overlap.")
        end = x0 + w
        out = [mode, x0, w, ceil]
        if len(z) > 4:
            if mode != "wave" or len(z) != 6:
                raise bad("Only wave zones can have a zigzag.")
            gap, path = z[4], z[5]
            if not is_num(gap, *LIMITS["gap"]) or gap > ceil or not isinstance(path, list) or len(path) > LIMITS["path"]:
                raise bad("A wave zigzag is broken.")
            last, pts = 0, []
            for p in path:
                if not (isinstance(p, list) and len(p) == 2 and is_num(p[0], last + 0.01, w - 0.01) and is_num(p[1], gap / 2, ceil - gap / 2)):
                    raise bad("A wave zigzag is broken.")
                last = p[0]
                pts.append([p[0], p[1]])
            if pts:
                out += [gap, pts]
        clean_zones.append(out)
    level = {"v": 1, "name": name, "desc": desc, "theme": d["theme"], "music": d.get("music", True) is not False,
             "len": n, "objs": clean_objs, "zones": clean_zones}
    if len(json.dumps(level, separators=(",", ":"), ensure_ascii=False).encode()) > MAX_DATA:
        raise bad("That level is too big to post.")
    return level


def run_ticks(n):
    """Substeps a full run of a level `n` blocks long takes (same sum as DashCore.runTicks)."""
    x, k = 0.0, 0
    while x < n:
        x += SPEED * SUB
        k += 1
    return k


def check_replay(r, level):
    """The verify run: {"e": [substep numbers where the button goes down, up, ...], "n": substeps to the finish}."""
    if not isinstance(r, dict):
        raise AuthError("Beat your level in verify mode before posting it.")
    e, n = r.get("e"), r.get("n")
    full = run_ticks(level["len"])
    if not is_int(n, 1, 10 ** 6) or abs(n - full) > 3:
        raise AuthError("That verify run doesn't reach the end of the level. Verify it again.")
    if not isinstance(e, list) or len(e) > 20000 or any(not is_int(t, 0, n) for t in e) or any(b < a for a, b in zip(e, e[1:])):
        raise AuthError("That verify run is broken. Verify the level again.")
    out = {"e": e, "n": n}
    if len(json.dumps(out, separators=(",", ":")).encode()) > MAX_REPLAY:
        raise AuthError("That verify run is too long to post.")
    return out


def preview_of(level):
    """The bit of a level the community cards draw: its start, its zones and its size."""
    return {"len": level["len"], "theme": level["theme"], "n": len(level["objs"]),
            "o": [o for o in level["objs"] if o[1] < PREVIEW_COLS],
            "z": [z[:4] for z in level["zones"] if z[1] < PREVIEW_COLS]}


def wait_text(seconds):
    seconds = max(60, int(seconds))
    h, m = divmod(math.ceil(seconds / 60), 60)
    return f"{h} h {m} min" if h else f"{m} min"


class DashLevels:
    def __init__(self, accounts):
        self.acc = accounts

    # -- the creator ------------------------------------------------------------
    async def quota(self, user):
        """How many posts this player has left right now, and when the next one frees up."""
        if user["admin"]:
            return {"limit": POSTS_PER_DAY, "left": POSTS_PER_DAY, "wait": 0, "admin": True}
        t = now()
        rows = (await self.acc.q("SELECT created FROM dash_levels WHERE user_id = ? AND created > ? ORDER BY created",
                                 user["id"], t - DAY))["rows"]
        left = max(0, POSTS_PER_DAY - len(rows))
        wait = rows[0]["created"] + DAY - t if not left and rows else 0
        return {"limit": POSTS_PER_DAY, "left": left, "wait": max(0, wait), "admin": False}

    async def post(self, user, raw_level, raw_replay):
        level = check_level(raw_level)
        replay = check_replay(raw_replay, level)
        if self.acc.limited(f"dashpost:{user['id']}", 1, 5):
            raise AuthError("Slow down a little 🙂")
        self.acc.hit(f"dashpost:{user['id']}")
        t = now()
        limit = 10 ** 9 if user["admin"] else POSTS_PER_DAY
        data = json.dumps(level, separators=(",", ":"), ensure_ascii=False)
        # the limit check and the insert are one statement, so two posts at the same moment can't both slip through
        res = await self.acc.q(
            "INSERT INTO dash_levels (user_id, name, descr, data, replay, preview, status, created) "
            "SELECT ?, ?, ?, ?, ?, ?, 'pending', ? WHERE (SELECT COUNT(*) FROM dash_levels WHERE user_id = ? AND created > ?) < ?",
            user["id"], level["name"], level["desc"], data, json.dumps(replay, separators=(",", ":")),
            json.dumps(preview_of(level), separators=(",", ":"), ensure_ascii=False), t, user["id"], t - DAY, limit)
        if not res["changes"]:
            q = await self.quota(user)
            raise AuthError(f"You've posted {POSTS_PER_DAY} levels today — you can post again in {wait_text(q['wait'])}.")
        await self.bump(user["id"], {"dash.levels_posted": ("add", 1)})
        q = await self.quota(user)
        return {"id": res["id"], "status": "pending", **q}

    async def mine(self, user_id):
        rows = (await self.acc.q("SELECT id, name, descr, preview, status, reason, created, reviewed, plays, likes FROM dash_levels "
                                 "WHERE user_id = ? AND status != 'deleted' ORDER BY id DESC LIMIT 100", user_id))["rows"]
        return [self.card(r) for r in rows]

    async def delete(self, user_id, level_id):
        res = await self.acc.q("UPDATE dash_levels SET status = 'deleted' WHERE id = ? AND user_id = ? AND status != 'deleted'",
                               level_id, user_id)
        if not res["changes"]:
            raise AuthError("That level is already gone.")

    # -- everyone ---------------------------------------------------------------
    async def get(self, level_id, viewer=None):
        """A level with its data. Pending / rejected / unlisted ones only for their creator and admins."""
        rows = (await self.acc.q("SELECT d.*, u.name AS by_name, u.avatar, u.color, u.banned FROM dash_levels d "
                                 "JOIN users u ON u.id = d.user_id WHERE d.id = ?", level_id))["rows"]
        r = rows[0] if rows else None
        admin = bool(viewer and viewer.get("admin"))
        mine = bool(r and viewer and viewer["id"] == r["user_id"])
        public = bool(r and r["status"] == "approved" and not r["banned"])
        if not r or not (public or admin or (mine and r["status"] != "deleted")):
            raise AuthError("That level isn't available.")
        out = self.card(r)
        out["data"] = json.loads(r["data"])
        out["replay"] = json.loads(r["replay"]) if r["replay"] else None
        out["mine"] = mine
        return out

    async def browse(self, sort="new", text="", by=None, offset=0, me=None, limit=24):
        """Approved levels, newest / most played / most liked, matching a name or creator."""
        order = SORTS.get(sort, SORTS["new"])
        where, args = ["d.status = 'approved'", "u.banned = 0"], []
        if by:
            where.append("u.name_key = ?")
            args.append(str(by).strip().lower()[:16])
        text = str(text or "").strip().lower()[:32]
        if text:
            like = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where.append("(LOWER(d.name) LIKE ? ESCAPE '\\' OR u.name_key LIKE ? ESCAPE '\\')")
            args += [like, like]
        offset = int(offset) if is_num(offset, 0, 10_000) else 0
        rows = (await self.acc.q(f"SELECT d.id, d.user_id, d.name, d.descr, d.preview, d.status, d.reason, d.created, d.reviewed, d.plays, d.likes, "
                                 f"u.name AS by_name, u.avatar, u.color FROM dash_levels d JOIN users u ON u.id = d.user_id "
                                 f"WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ? OFFSET ?", *args, limit + 1, offset))["rows"]
        more = len(rows) > limit
        cards = [self.card(r) for r in rows[:limit]]
        if me and cards:
            ids = [c["id"] for c in cards]
            liked = (await self.acc.q(f"SELECT level_id FROM dash_likes WHERE user_id = ? AND level_id IN ({','.join('?' * len(ids))})", me, *ids))["rows"]
            got = {r["level_id"] for r in liked}
            for c in cards:
                c["liked"] = c["id"] in got
        return {"levels": cards, "more": more}

    async def like(self, user_id, level_id, on=True):
        rows = (await self.acc.q("SELECT user_id, status FROM dash_levels WHERE id = ?", level_id))["rows"]
        if not rows or rows[0]["status"] != "approved":
            raise AuthError("That level isn't available.")
        if rows[0]["user_id"] == user_id:
            raise AuthError("You can't like your own level 🙂")
        change = ("INSERT OR IGNORE INTO dash_likes (user_id, level_id) VALUES (?, ?)" if on
                  else "DELETE FROM dash_likes WHERE user_id = ? AND level_id = ?")
        res = await self.acc.many([
            (change, (user_id, level_id)),
            ("UPDATE dash_levels SET likes = (SELECT COUNT(*) FROM dash_likes WHERE level_id = ?) WHERE id = ?", (level_id, level_id)),
            ("SELECT likes FROM dash_levels WHERE id = ?", (level_id,)),
        ])
        return {"likes": res[2]["rows"][0]["likes"], "liked": bool(on)}

    async def play(self, who, level_id, ip="?"):
        """Count a play when a run (or a race) starts: once per player per level every 10 minutes, and 40 an hour.
        A guest's id comes from their own device, so guests are also capped per address (a few per level, for
        a party sharing one wifi), and every address at most 8 per level, so new ids or accounts can't pile plays up."""
        acc = self.acc
        keys = [(f"dashplay:{who}:{level_id}", 1, 600), (f"dashplay:{who}", 40, 3600), (f"dashplay-ip:{ip}:{level_id}", 8, 600)]
        if not who.startswith("acct:"):
            keys += [(f"dashplay-guest:{ip}:{level_id}", 3, 600), (f"dashplay-guest:{ip}", 60, 3600)]
        if any(acc.limited(*k) for k in keys):
            return {"counted": False}
        res = await acc.q("UPDATE dash_levels SET plays = plays + 1 WHERE id = ? AND status = 'approved'", level_id)
        if res["changes"]:
            for k in keys:
                acc.hit(k[0])
        return {"counted": bool(res["changes"])}

    # -- admins -----------------------------------------------------------------
    async def queue(self, status="pending"):
        status = status if status in STATUSES else "pending"
        order = "d.id ASC" if status == "pending" else "d.reviewed DESC, d.id DESC"
        rows = (await self.acc.q("SELECT d.id, d.user_id, d.name, d.descr, d.preview, d.status, d.reason, d.created, d.reviewed, d.plays, d.likes, "
                                 "u.name AS by_name, u.avatar, u.color, r.name AS reviewer_name FROM dash_levels d JOIN users u ON u.id = d.user_id "
                                 f"LEFT JOIN users r ON r.id = d.reviewer WHERE d.status = ? ORDER BY {order} LIMIT 100", status))["rows"]
        counts = (await self.acc.q("SELECT status, COUNT(*) AS n FROM dash_levels GROUP BY status"))["rows"]
        return {"levels": [{**self.card(r), "reviewer": r.get("reviewer_name")} for r in rows],
                "counts": {r["status"]: r["n"] for r in counts}}

    async def review(self, admin, level_id, action, reason=""):
        """approve / reject a pending level, unlist an approved one, or list an unlisted one again."""
        moves = {"approve": (("pending", "rejected", "unlisted"), "approved"), "reject": (("pending",), "rejected"),
                 "unlist": (("approved",), "unlisted")}
        if action not in moves:
            raise AuthError("Unknown action.")
        allowed, new = moves[action]
        rows = (await self.acc.q("SELECT id, user_id, name, status, reviewed FROM dash_levels WHERE id = ?", level_id))["rows"]
        if not rows:
            raise AuthError("That level is gone.")
        r = rows[0]
        if r["status"] not in allowed:
            raise AuthError(f"That level is {r['status']} already.")
        reason = clean_text(reason, 200)
        res = await self.acc.q("UPDATE dash_levels SET status = ?, reason = ?, reviewed = ?, reviewer = ? WHERE id = ? AND status = ?",
                               new, reason, now(), admin["id"], level_id, r["status"])
        if not res["changes"]:
            raise AuthError("Someone else just reviewed that level.")
        if new == "approved" and r["status"] in ("pending", "rejected"):   # first approval (unlisted ones were approved before)
            await self.bump(r["user_id"], {"dash.levels_approved": ("add", 1)})
        return {"id": r["id"], "user_id": r["user_id"], "name": r["name"], "status": new, "reason": reason}

    # -- helpers ------------------------------------------------------------------
    async def bump(self, user_id, ops):
        """Change a player's stats without it counting as a game (no match row, no XP)."""
        stmts = [(f"INSERT INTO stats (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = {UPSERT[op]}",
                  (user_id, key, value)) for key, (op, value) in ops.items()]
        await self.acc.many(stmts)
        self.acc.board_cache.clear()

    @staticmethod
    def card(r):
        try:
            preview = json.loads(r.get("preview") or "{}")
        except ValueError:
            preview = {}
        out = {"id": r["id"], "name": r["name"], "desc": r.get("descr", ""), "status": r["status"], "created": r["created"],
               "reviewed": r.get("reviewed") or 0, "plays": r.get("plays", 0), "likes": r.get("likes", 0), "preview": preview}
        if r["status"] in ("rejected", "unlisted") and r.get("reason"):
            out["reason"] = r["reason"]
        if "by_name" in r:
            out["by"] = {"name": r["by_name"], "avatar": r["avatar"], "color": r["color"]}
        return out


def level_id(value):
    """A level id from a request, or AuthError."""
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not re.match(r"^\d{1,12}$", str(value)):
        raise AuthError("Pick a level.")
    return int(value)
