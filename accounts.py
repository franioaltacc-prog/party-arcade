"""Accounts, stats, XP and leaderboards for Party Arcade.

Everything is stored in a SQLite database:

* On your own computer it is the file data/arcade.db (made automatically).
* On hosts that wipe files on every restart (like Render's free plan) set
  TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. The same SQL then runs on a free
  Turso database over HTTPS, so accounts survive restarts and redeploys.

Passwords are hashed with scrypt. Login tokens are random; only their SHA-256
hash is stored. Set ADMIN_CODE to a secret phrase to let you unlock admin
powers on your own account (see README).
"""
import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

NAME_RE = re.compile(r"^[A-Za-z0-9_]{3,16}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
RESERVED = {"admin", "administrator", "guest", "system", "mod", "moderator", "owner", "staff",
            "partyarcade", "null", "undefined", "anonymous", "everyone", "nobody", "server"}
SESSION_DAYS = 180
OUTCOME_XP = {"win": 40, "draw": 20, "loss": 12, "play": 12}
OUTCOMES = set(OUTCOME_XP)

# Leaderboards: key -> (title, stat key or None for XP, "desc"/"asc", value format)
BOARDS = {
    "xp": ("🌟 Top players", None, "desc", "xp"),
    "wins": ("🏆 Most wins", "wins", "desc", "int"),
    "games": ("🎮 Most games played", "games", "desc", "int"),
    "dash": ("🟪 Neon Dash wins", "dash.wins", "desc", "int"),
    "life": ("🏡 Best life score", "life.best", "desc", "int"),
    "life_age": ("🧓 Longest life", "life.oldest", "desc", "years"),
    "doodle": ("🎨 Doodle Guess wins", "doodle.wins", "desc", "int"),
    "blitz": ("⚡ Party Blitz wins", "blitz.wins", "desc", "int"),
    "casino": ("🎰 Casino Night wins", "casino.wins", "desc", "int"),
    "casino_big": ("💰 Biggest casino win", "casino.best_win", "desc", "coins"),
    "c4": ("🔴 Connect 4 wins", "c4.wins", "desc", "int"),
    "impostor": ("🕵️ Impostor wins", "impostor.wins", "desc", "int"),
    "impostor_rounds": ("🎭 Rounds won as the impostor", "impostor.imp_wins", "desc", "int"),
    "mines": ("💣 Minesweeper wins", "mines.wins", "desc", "int"),
    "snake": ("🐍 Snake high score", "snake.best", "desc", "int"),
    "2048": ("🔢 2048 best score", "2048.best", "desc", "int"),
    "memory": ("🃏 Memory Flip fastest (Normal)", "memory.best", "asc", "time"),
    "dash_solo": ("🟦 Dash practice levels beaten", "dashsolo.levels", "desc", "int"),
    "mines_medium": ("💣 Minesweeper fastest (Medium)", "mines_medium.best", "asc", "time"),
    "mines_hard": ("💣 Minesweeper fastest (Hard)", "mines_hard.best", "asc", "time"),
}

# Scores the browser reports for solo games: game -> (stat ops, lowest, highest)
SOLO = {
    "snake": ("snake", 1, 5000),
    "2048": ("2048", 4, 5_000_000),
    "memory": ("memory", 3000, 3_600_000),   # milliseconds
    "dash-solo": ("dashsolo", 1000, 3_600_000),
    "mines-easy": ("mines_easy", 1000, 3_600_000),     # milliseconds; lower is better
    "mines-medium": ("mines_medium", 5000, 3_600_000),
    "mines-hard": ("mines_hard", 20000, 3_600_000),
}
FASTEST = {"memory", "dash-solo", "mines-easy", "mines-medium", "mines-hard"}   # solo games where a lower time wins

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        pw TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '😎',
        color TEXT NOT NULL DEFAULT '#ff4fd8',
        bio TEXT NOT NULL DEFAULT '',
        admin INTEGER NOT NULL DEFAULT 0,
        banned INTEGER NOT NULL DEFAULT 0,
        xp INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL,
        last_seen INTEGER NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created INTEGER NOT NULL,
        expires INTEGER NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)",
    """CREATE TABLE IF NOT EXISTS stats (
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value REAL NOT NULL,
        PRIMARY KEY (user_id, key))""",
    "CREATE INDEX IF NOT EXISTS stats_board ON stats(key, value)",
    """CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        game TEXT NOT NULL,
        outcome TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        xp INTEGER NOT NULL DEFAULT 0,
        ts INTEGER NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS matches_user ON matches(user_id, id)",
    """CREATE TABLE IF NOT EXISTS saved_rooms (
        code TEXT PRIMARY KEY,
        game TEXT NOT NULL,
        host TEXT NOT NULL DEFAULT '',
        banned TEXT NOT NULL DEFAULT '[]',
        saved INTEGER NOT NULL)""",
]
ROOM_KEEP = 600   # seconds a room saved at shutdown can be picked up again

UPSERT = {
    "add": "stats.value + excluded.value",
    "max": "MAX(stats.value, excluded.value)",
    "min": "MIN(stats.value, excluded.value)",
    "set": "excluded.value",
}


class AuthError(Exception):
    """A problem to show the player (wrong password, name taken...)."""


class StoreError(Exception):
    """The database could not be reached."""


def now():
    return int(time.time())


def tidy(v):
    """SQLite REAL columns give 3.0 back for 3; show whole numbers as ints."""
    return int(v) if isinstance(v, float) and v.is_integer() else v


def level_info(xp):
    xp = max(0, int(xp or 0))
    level = int(math.sqrt(xp / 50)) + 1
    return {"level": level, "xp": xp, "from": 50 * (level - 1) ** 2, "to": 50 * level ** 2}


# --------------------------------------------------------------------------
# Password hashing
# --------------------------------------------------------------------------
SCRYPT_N, SCRYPT_R, SCRYPT_P = 1 << 14, 8, 4
_b64 = lambda b: base64.b64encode(b).decode()
_unb64 = lambda s: base64.b64decode(s.encode())


def hash_password(pw):
    salt = secrets.token_bytes(16)
    if hasattr(hashlib, "scrypt"):
        dk = hashlib.scrypt(pw.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, maxmem=64 << 20, dklen=32)
        return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(dk)}"
    rounds = 600_000
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, rounds)
    return f"pbkdf2${rounds}${_b64(salt)}${_b64(dk)}"


def check_password(pw, stored):
    try:
        parts = stored.split("$")
        if parts[0] == "scrypt":
            n, r, p, salt, want = int(parts[1]), int(parts[2]), int(parts[3]), _unb64(parts[4]), _unb64(parts[5])
            got = hashlib.scrypt(pw.encode(), salt=salt, n=n, r=r, p=p, maxmem=64 << 20, dklen=len(want))
        elif parts[0] == "pbkdf2":
            rounds, salt, want = int(parts[1]), _unb64(parts[2]), _unb64(parts[3])
            got = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, rounds)
        else:
            return False
        return hmac.compare_digest(got, want)
    except Exception:
        return False


_DUMMY_HASH = None


def dummy_check(pw):
    """Spend the same time as a real check so logins don't reveal which names exist."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("not-a-real-password")
    check_password(pw, _DUMMY_HASH)


def token_hash(token):
    return hashlib.sha256(str(token).encode()).hexdigest()


# --------------------------------------------------------------------------
# Storage backends: both take a list of (sql, args) and return one result per
# statement: {"rows": [dict...], "changes": int, "id": last insert id}
# --------------------------------------------------------------------------
class SqliteStore:
    kind = "sqlite"

    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.where = str(path)
        self.db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.pool = ThreadPoolExecutor(1, thread_name_prefix="sqlite")

    def _run(self, stmts):
        cur = self.db.cursor()
        many = len(stmts) > 1
        out = []
        try:
            if many:
                cur.execute("BEGIN")
            for sql, args in stmts:
                cur.execute(sql, tuple(args))
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = [dict(zip(cols, r)) for r in cur.fetchall()] if cols else []
                out.append({"rows": rows, "changes": cur.rowcount, "id": cur.lastrowid})
            if many:
                cur.execute("COMMIT")
        except sqlite3.IntegrityError as e:
            if many:
                cur.execute("ROLLBACK")
            raise StoreError("constraint: " + str(e)) from None
        except Exception:
            if many:
                cur.execute("ROLLBACK")
            raise
        return out

    async def run(self, stmts):
        return await asyncio.get_running_loop().run_in_executor(self.pool, self._run, stmts)


class TursoStore:
    kind = "turso"

    def __init__(self, url, token):
        url = url.strip()
        for prefix in ("libsql://", "turso://", "wss://", "ws://"):
            if url.startswith(prefix):
                url = "https://" + url[len(prefix):]
        if not url.startswith(("https://", "http://")):
            url = "https://" + url
        self.where = url.split("//", 1)[1].split("/")[0]
        self.url = url.rstrip("/") + "/v2/pipeline"
        self.token = token.strip()
        self.pool = ThreadPoolExecutor(4, thread_name_prefix="turso")

    @staticmethod
    def _arg(v):
        if v is None:
            return {"type": "null"}
        if isinstance(v, bool):
            return {"type": "integer", "value": str(int(v))}
        if isinstance(v, int):
            return {"type": "integer", "value": str(v)}
        if isinstance(v, float):
            return {"type": "float", "value": v}
        return {"type": "text", "value": str(v)}

    @staticmethod
    def _val(v):
        t = v.get("type")
        if t == "integer":
            return int(v["value"])
        if t == "float":
            return float(v["value"])
        if t == "text":
            return v["value"]
        if t == "blob":
            return base64.b64decode(v.get("base64", ""))
        return None

    def _post(self, body):
        req = urllib.request.Request(self.url, data=json.dumps(body).encode(), method="POST", headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode(errors="replace")
            raise StoreError(f"Turso answered {e.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise StoreError(f"Can't reach Turso: {getattr(e, 'reason', e)}") from None

    def _run(self, stmts):
        requests = [{"type": "execute", "stmt": {"sql": sql, "args": [self._arg(a) for a in args]}} for sql, args in stmts]
        data = self._post({"requests": requests + [{"type": "close"}]})
        out = []
        for res in data.get("results", [])[:len(stmts)]:
            if res.get("type") != "ok":
                msg = (res.get("error") or {}).get("message", "unknown error")
                if "UNIQUE" in msg or "constraint" in msg.lower():
                    raise StoreError("constraint: " + msg)
                raise StoreError("Turso error: " + msg)
            r = res["response"]["result"]
            cols = [c["name"] for c in r.get("cols", [])]
            rows = [{c: self._val(v) for c, v in zip(cols, row)} for row in r.get("rows", [])]
            rid = r.get("last_insert_rowid")
            out.append({"rows": rows, "changes": r.get("affected_row_count", 0), "id": int(rid) if rid is not None else None})
        return out

    async def run(self, stmts):
        return await asyncio.get_running_loop().run_in_executor(self.pool, self._run, stmts)


# --------------------------------------------------------------------------
# Accounts
# --------------------------------------------------------------------------
class Accounts:
    def __init__(self, data_dir):
        url = os.environ.get("TURSO_DATABASE_URL", "").strip()
        token = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
        self.store = TursoStore(url, token) if url and token else SqliteStore(data_dir / "arcade.db")
        self.admin_code = os.environ.get("ADMIN_CODE", "").strip()
        self.ready = False
        self.error = None
        self.attempts = {}
        self.board_cache = {}

    # -- plumbing ----------------------------------------------------------
    async def init(self):
        try:
            await self.store.run([(sql, ()) for sql in SCHEMA])
            await self.store.run([("DELETE FROM sessions WHERE expires < ?", (now(),))])
            self.ready = True
            self.error = None
        except Exception as e:
            self.ready = False
            self.error = str(e)
            raise

    async def q(self, sql, *args):
        if not self.ready:
            try:
                await self.init()
            except Exception:
                raise StoreError(self.error or "database not ready") from None
        return (await self.store.run([(sql, args)]))[0]

    async def many(self, stmts):
        if not self.ready:
            try:
                await self.init()
            except Exception:
                raise StoreError(self.error or "database not ready") from None
        return await self.store.run(stmts)

    # -- rooms kept across restarts ------------------------------------------
    async def save_rooms(self, rooms):
        """rooms: [(code, game, host, banned_list)] from a server that is shutting down."""
        t = now()
        stmts = [("DELETE FROM saved_rooms WHERE saved < ?", (t - ROOM_KEEP,))]
        stmts += [("INSERT OR REPLACE INTO saved_rooms (code, game, host, banned, saved) VALUES (?, ?, ?, ?, ?)",
                   (code, game, host or "", json.dumps(sorted(banned)), t)) for code, game, host, banned in rooms]
        await self.many(stmts)

    async def take_room(self, code):
        """Claim a room saved by the previous server, or None."""
        res = await self.many([
            ("SELECT * FROM saved_rooms WHERE code = ? AND saved >= ?", (code, now() - ROOM_KEEP)),
            ("DELETE FROM saved_rooms WHERE code = ?", (code,)),
        ])
        rows = res[0]["rows"]
        if not rows:
            return None
        r = rows[0]
        try:
            banned = set(json.loads(r["banned"]))
        except ValueError:
            banned = set()
        return {"code": r["code"], "game": r["game"], "host": r["host"] or None, "banned": banned}

    def limited(self, key, limit, window):
        """True if `key` already did something `limit` times in the last `window` seconds."""
        t = time.time()
        hits = [x for x in self.attempts.get(key, []) if t - x < window]
        self.attempts[key] = hits
        if len(self.attempts) > 5000:
            for k in list(self.attempts)[:2500]:
                del self.attempts[k]
        return len(hits) >= limit

    def hit(self, key):
        self.attempts.setdefault(key, []).append(time.time())

    @staticmethod
    def public(u):
        info = level_info(u["xp"])
        return {"id": u["id"], "name": u["name"], "avatar": u["avatar"], "color": u["color"], "bio": u.get("bio", ""),
                "admin": bool(u["admin"]), "banned": bool(u.get("banned")), "created": u["created"],
                "lastSeen": u["last_seen"], **info}

    async def user_by_id(self, uid):
        rows = (await self.q("SELECT * FROM users WHERE id = ?", uid))["rows"]
        return rows[0] if rows else None

    async def user_by_name(self, name):
        rows = (await self.q("SELECT * FROM users WHERE name_key = ?", str(name or "").strip().lower()))["rows"]
        return rows[0] if rows else None

    async def new_session(self, user_id):
        token = secrets.token_urlsafe(32)
        t = now()
        await self.many([
            ("INSERT INTO sessions (token, user_id, created, expires) VALUES (?, ?, ?, ?)",
             (token_hash(token), user_id, t, t + SESSION_DAYS * 86400)),
            ("UPDATE users SET last_seen = ? WHERE id = ?", (t, user_id)),
        ])
        return token

    # -- sign up / log in --------------------------------------------------
    async def signup(self, name, password, avatar, color, ip):
        name = str(name or "").strip()
        password = str(password or "")
        if not NAME_RE.match(name):
            raise AuthError("Usernames are 3–16 letters, numbers or _ (no spaces).")
        if name.lower() in RESERVED:
            raise AuthError("That username is reserved. Pick another one!")
        if len(password) < 6:
            raise AuthError("Your password needs at least 6 characters.")
        if len(password) > 128:
            raise AuthError("That password is too long.")
        if password.lower() == name.lower():
            raise AuthError("Your password can't be your username 😅")
        if self.limited("signup:" + ip, 20, 3600):
            raise AuthError("Too many new accounts from here. Try again later.")
        if await self.user_by_name(name):
            raise AuthError("That username is taken. Try another one!")
        pw = await asyncio.to_thread(hash_password, password)
        avatar = str(avatar or "😎")[:8]
        color = color if COLOR_RE.match(str(color or "")) else "#ff4fd8"
        t = now()
        try:
            res = await self.q("INSERT INTO users (name, name_key, pw, avatar, color, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               name, name.lower(), pw, avatar, color, t, t)
        except StoreError as e:
            if str(e).startswith("constraint"):
                raise AuthError("That username is taken. Try another one!") from None
            raise
        self.hit("signup:" + ip)
        user = await self.user_by_id(res["id"]) if res["id"] else await self.user_by_name(name)
        return user, await self.new_session(user["id"])

    async def login(self, name, password, ip):
        name = str(name or "").strip()
        password = str(password or "")[:128]
        key = name.lower()
        if self.limited("login:" + key, 8, 600) or self.limited("loginip:" + ip, 25, 600):
            raise AuthError("Too many tries. Wait a few minutes and try again.")
        user = await self.user_by_name(name)
        if not user:
            await asyncio.to_thread(dummy_check, password)
            ok = False
        else:
            ok = await asyncio.to_thread(check_password, password, user["pw"])
        if not ok:
            self.hit("login:" + key)
            self.hit("loginip:" + ip)
            raise AuthError("Wrong username or password.")
        if user["banned"]:
            raise AuthError("This account has been banned. 🚫")
        return user, await self.new_session(user["id"])

    async def resume(self, token):
        if not token or len(str(token)) > 100:
            return None
        rows = (await self.q("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?",
                             token_hash(token), now()))["rows"]
        if not rows or rows[0]["banned"]:
            return None
        user = rows[0]
        await self.q("UPDATE users SET last_seen = ? WHERE id = ?", now(), user["id"])
        return user

    async def logout(self, token):
        if token:
            await self.q("DELETE FROM sessions WHERE token = ?", token_hash(token))

    async def update_look(self, user_id, avatar, color, bio):
        user = await self.user_by_id(user_id)
        if not user:
            raise AuthError("Account not found.")
        avatar = str(avatar or user["avatar"])[:8]
        color = color if COLOR_RE.match(str(color or "")) else user["color"]
        bio = " ".join(str(bio if bio is not None else user["bio"]).split())[:140]
        await self.q("UPDATE users SET avatar = ?, color = ?, bio = ? WHERE id = ?", avatar, color, bio, user_id)
        return await self.user_by_id(user_id)

    async def change_password(self, user_id, old, new):
        user = await self.user_by_id(user_id)
        if not user or not await asyncio.to_thread(check_password, str(old or ""), user["pw"]):
            raise AuthError("Your current password is wrong.")
        new = str(new or "")
        if not 6 <= len(new) <= 128:
            raise AuthError("Your new password needs 6–128 characters.")
        pw = await asyncio.to_thread(hash_password, new)
        await self.many([("UPDATE users SET pw = ? WHERE id = ?", (pw, user_id)),
                         ("DELETE FROM sessions WHERE user_id = ?", (user_id,))])
        return await self.new_session(user_id)

    async def delete_account(self, user_id, password):
        user = await self.user_by_id(user_id)
        if not user or not await asyncio.to_thread(check_password, str(password or ""), user["pw"]):
            raise AuthError("Wrong password.")
        await self.wipe(user_id)

    async def wipe(self, user_id):
        await self.many([(f"DELETE FROM {table} WHERE user_id = ?", (user_id,)) for table in ("sessions", "stats", "matches")]
                        + [("DELETE FROM users WHERE id = ?", (user_id,))])
        self.board_cache.clear()

    # -- stats ---------------------------------------------------------------
    async def record(self, user_id, game, outcome, stats=None, detail="", xp=None, totals=True):
        """Save one finished game. stats: {"dash.wins": ("add", 1), "life.best": ("max", 1234)}.
        totals=False keeps it out of the all-games "games"/"wins" counters (solo scores)."""
        outcome = outcome if outcome in OUTCOMES else "play"
        gained = int(OUTCOME_XP[outcome] if xp is None else max(0, min(500, xp)))
        ops = {f"{game}.games": ("add", 1)}
        if totals:
            ops["games"] = ("add", 1)
            if outcome == "win":
                ops["wins"] = ("add", 1)
        ops.update(stats or {})
        stmts = []
        for key, (op, value) in ops.items():
            if op in UPSERT and isinstance(value, (int, float)) and math.isfinite(value):
                stmts.append((f"INSERT INTO stats (user_id, key, value) VALUES (?, ?, ?) "
                              f"ON CONFLICT (user_id, key) DO UPDATE SET value = {UPSERT[op]}", (user_id, key, value)))
        stmts += [
            ("INSERT INTO matches (user_id, game, outcome, detail, xp, ts) VALUES (?, ?, ?, ?, ?, ?)",
             (user_id, game, outcome, str(detail or "")[:120], gained, now())),
            ("UPDATE users SET xp = xp + ?, last_seen = ? WHERE id = ?", (gained, now(), user_id)),
            ("SELECT xp FROM users WHERE id = ?", (user_id,)),
            ("DELETE FROM matches WHERE user_id = ? AND id NOT IN (SELECT id FROM matches WHERE user_id = ? ORDER BY id DESC LIMIT 60)",
             (user_id, user_id)),
        ]
        res = await self.many(stmts)
        after = res[-2]["rows"][0]["xp"] if res[-2]["rows"] else gained
        self.board_cache.clear()
        return gained, after - gained, after

    async def solo(self, user_id, game, value):
        if game not in SOLO:
            raise AuthError("Unknown game.")
        prefix, lo, hi = SOLO[game]
        value = int(value)
        if not lo <= value <= hi:
            raise AuthError("That score doesn't look right 🤔")
        if game == "dash-solo":
            stats = {"dashsolo.levels": ("add", 1), "dashsolo.best": ("min", value)}
        elif game in FASTEST:
            stats = {f"{prefix}.best": ("min", value), f"{prefix}.wins": ("add", 1)}
        else:
            stats = {f"{prefix}.best": ("max", value)}
        before = await self.q("SELECT value FROM stats WHERE user_id = ? AND key = ?", user_id, f"{prefix}.best")
        old = before["rows"][0]["value"] if before["rows"] else None
        gained, xp_before, xp_after = await self.record(user_id, prefix, "play", stats, self.solo_detail(game, value), xp=5, totals=False)
        better = old is None or (value < old if game in FASTEST else value > old)
        return {"best": better, "old": tidy(old), "gained": gained, "before": xp_before, "after": xp_after}

    @staticmethod
    def solo_detail(game, value):
        if game in FASTEST:
            return f"Finished in {value / 1000:.2f}s"
        return f"Scored {value:,}"

    # -- profiles & leaderboards ---------------------------------------------
    async def profile(self, name):
        user = await self.user_by_name(name)
        if not user:
            return None
        res = await self.many([
            ("SELECT key, value FROM stats WHERE user_id = ?", (user["id"],)),
            ("SELECT game, outcome, detail, xp, ts FROM matches WHERE user_id = ? ORDER BY id DESC LIMIT 20", (user["id"],)),
            ("SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND xp > ?", (user["xp"],)),
        ])
        out = self.public(user)
        out["stats"] = {r["key"]: tidy(r["value"]) for r in res[0]["rows"]}
        out["recent"] = res[1]["rows"]
        out["rank"] = res[2]["rows"][0]["n"] + 1 if not user["banned"] else None
        return out

    async def find_players(self, text, sort="active", limit=48):
        """Public player search: anyone can look up players who have an account."""
        text = str(text or "").strip().lower()[:16]
        order = {"active": "last_seen DESC", "new": "created DESC", "level": "xp DESC", "name": "name_key ASC"}.get(sort, "last_seen DESC")
        if text:
            safe = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            res = await self.q(f"SELECT * FROM users WHERE banned = 0 AND name_key LIKE ? ESCAPE '\\' "
                               f"ORDER BY CASE WHEN name_key = ? THEN 0 WHEN name_key LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, {order} LIMIT ?",
                               f"%{safe}%", text, f"{safe}%", limit)
        else:
            res = await self.q(f"SELECT * FROM users WHERE banned = 0 ORDER BY {order} LIMIT ?", limit)
        total = (await self.q("SELECT COUNT(*) AS n FROM users WHERE banned = 0"))["rows"][0]["n"]
        players = []
        for u in res["rows"]:
            info = level_info(u["xp"])
            players.append({"id": u["id"], "name": u["name"], "avatar": u["avatar"], "color": u["color"], "bio": u["bio"],
                            "admin": bool(u["admin"]), "created": u["created"], "lastSeen": u["last_seen"],
                            "level": info["level"], "xp": info["xp"]})
        return players, total

    def boards(self):
        return [{"key": k, "title": v[0], "order": v[2], "format": v[3]} for k, v in BOARDS.items()]

    async def board(self, key, me_id=None):
        if key not in BOARDS:
            raise AuthError("Unknown leaderboard.")
        title, stat, order, fmt = BOARDS[key]
        cached = self.board_cache.get(key)
        if cached and time.time() - cached[0] < 15:
            rows = cached[1]
        else:
            if stat is None:
                res = await self.q("SELECT id, name, avatar, color, xp, xp AS value FROM users "
                                   "WHERE banned = 0 AND xp > 0 ORDER BY xp DESC, id LIMIT 50")
            else:
                direction = "ASC" if order == "asc" else "DESC"
                res = await self.q("SELECT u.id, u.name, u.avatar, u.color, u.xp, s.value FROM stats s "
                                   "JOIN users u ON u.id = s.user_id WHERE s.key = ? AND u.banned = 0 AND s.value > 0 "
                                   f"ORDER BY s.value {direction}, u.id LIMIT 50", stat)
            rows = []
            for i, r in enumerate(res["rows"]):
                rows.append({"rank": i + 1, "id": r["id"], "name": r["name"], "avatar": r["avatar"], "color": r["color"],
                             "level": level_info(r["xp"])["level"], "value": tidy(r["value"])})
            self.board_cache[key] = (time.time(), rows)
        me = None
        if me_id:
            mine = next((r for r in rows if r["id"] == me_id), None)
            if mine:
                me = {"rank": mine["rank"], "value": mine["value"]}
            else:
                if stat is None:
                    u = await self.user_by_id(me_id)
                    value = u["xp"] if u else 0
                    if value > 0:
                        n = (await self.q("SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND xp > ?", value))["rows"][0]["n"]
                        me = {"rank": n + 1, "value": value}
                else:
                    got = (await self.q("SELECT value FROM stats WHERE user_id = ? AND key = ?", me_id, stat))["rows"]
                    if got and got[0]["value"] > 0:
                        value = got[0]["value"]
                        cmp = "<" if order == "asc" else ">"
                        n = (await self.q(f"SELECT COUNT(*) AS n FROM stats s JOIN users u ON u.id = s.user_id "
                                          f"WHERE s.key = ? AND u.banned = 0 AND s.value > 0 AND s.value {cmp} ?", stat, value))["rows"][0]["n"]
                        me = {"rank": n + 1, "value": tidy(value)}
        return {"key": key, "title": title, "order": order, "format": fmt, "rows": rows, "me": me}

    # -- admin -----------------------------------------------------------------
    async def unlock_admin(self, user_id, code):
        if len(self.admin_code) < 8:
            raise AuthError("Admin isn't set up on this server. Set ADMIN_CODE (8+ characters) first.")
        if self.limited(f"admin:{user_id}", 5, 900) or self.limited("admin:all", 30, 900):
            raise AuthError("Too many tries. Wait 15 minutes.")
        if not hmac.compare_digest(str(code or "").encode(), self.admin_code.encode()):
            self.hit(f"admin:{user_id}")
            self.hit("admin:all")
            raise AuthError("That's not the admin code.")
        await self.q("UPDATE users SET admin = 1 WHERE id = ?", user_id)
        return await self.user_by_id(user_id)

    async def require_admin(self, user_id):
        user = await self.user_by_id(user_id) if user_id else None
        if not user or not user["admin"] or user["banned"]:
            raise AuthError("Admins only. 🛡️")
        return user

    async def search(self, text):
        text = str(text or "").strip().lower()[:16]
        like = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        res = await self.q("SELECT * FROM users WHERE name_key LIKE ? ESCAPE '\\' ORDER BY last_seen DESC LIMIT 40", like)
        return [self.public(u) for u in res["rows"]]

    async def count_users(self):
        return (await self.q("SELECT COUNT(*) AS n FROM users"))["rows"][0]["n"]

    async def admin_action(self, actor, name, action, value=None):
        user = await self.user_by_name(name)
        if not user:
            raise AuthError("No account with that name.")
        uid = user["id"]
        if uid == actor["id"] and action in ("ban", "unadmin", "delete", "password"):
            raise AuthError("You can't do that to your own account.")
        if action == "ban":
            await self.many([("UPDATE users SET banned = 1 WHERE id = ?", (uid,)), ("DELETE FROM sessions WHERE user_id = ?", (uid,))])
        elif action == "unban":
            await self.q("UPDATE users SET banned = 0 WHERE id = ?", uid)
        elif action == "admin":
            await self.q("UPDATE users SET admin = 1 WHERE id = ?", uid)
        elif action == "unadmin":
            await self.q("UPDATE users SET admin = 0 WHERE id = ?", uid)
        elif action == "xp":
            amount = int(max(-1_000_000, min(1_000_000, float(value or 0))))
            await self.q("UPDATE users SET xp = MAX(0, xp + ?) WHERE id = ?", amount, uid)
        elif action == "setxp":
            amount = int(max(0, min(100_000_000, float(value or 0))))
            await self.q("UPDATE users SET xp = ? WHERE id = ?", amount, uid)
        elif action == "setlevel":
            level = int(max(1, min(1000, float(value or 1))))
            await self.q("UPDATE users SET xp = ? WHERE id = ?", 50 * (level - 1) ** 2, uid)
        elif action == "reset":
            await self.many([("DELETE FROM stats WHERE user_id = ?", (uid,)), ("DELETE FROM matches WHERE user_id = ?", (uid,)),
                             ("UPDATE users SET xp = 0 WHERE id = ?", (uid,))])
        elif action == "stat":
            key, amount = str((value or {}).get("key", ""))[:40], (value or {}).get("value")
            if not re.match(r"^[a-z0-9_.]+$", key) or not isinstance(amount, (int, float)):
                raise AuthError("Pick a stat and a number.")
            await self.q("INSERT INTO stats (user_id, key, value) VALUES (?, ?, ?) "
                         "ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value", uid, key, float(amount))
        elif action == "logout":
            await self.q("DELETE FROM sessions WHERE user_id = ?", uid)
        elif action == "password":
            new = str(value or "")
            if not 6 <= len(new) <= 128:
                raise AuthError("Passwords need 6–128 characters.")
            pw = await asyncio.to_thread(hash_password, new)
            await self.many([("UPDATE users SET pw = ? WHERE id = ?", (pw, uid)), ("DELETE FROM sessions WHERE user_id = ?", (uid,))])
        elif action == "delete":
            await self.wipe(uid)
            return None
        else:
            raise AuthError("Unknown action.")
        self.board_cache.clear()
        return await self.user_by_id(uid)
