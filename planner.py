"""The update calendar (/calendar): what's coming to Party Arcade and when, plus the calendar team's
announcements and group chat.

Admins give people a role in the admin panel (see ROLES in accounts.py):
* testers see the rows a developer marked "testers can see this", and can't change anything;
* developers and admins see every row and add, change, move and delete them.
Everyone with a role (the team) reads the announcements and uses the group chat. Developers and admins post
announcements. You can delete your own messages and announcements; admins can delete anyone's.
Neither role gets the admin panel, cheats or XP tools, and every request re-checks the role in the database.

The tables (plans, team_chat, team_news) live in the accounts database: see SCHEMA in accounts.py.
"""
import datetime
import re
import time

from accounts import AuthError, parse_look, role_of

KINDS = ("big", "small", "fix", "event")
STATUSES = ("idea", "planned", "building", "shipped", "skipped")
MAX_ROWS = 500
CHAT_KEEP = 300       # team chat messages kept (older ones are removed)
CHAT_SHOWN = 100      # messages sent when someone opens the chat
NEWS_SHOWN = 30       # announcements sent when someone opens the calendar


def now():
    return int(time.time())


def one_line(v, n):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def clean_day(v):
    """A real YYYY-MM-DD date, or '' for "no date yet"."""
    v = str(v or "").strip()
    if not v:
        return ""
    try:
        datetime.date.fromisoformat(v)
    except ValueError:
        raise AuthError("That date doesn't look right.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        raise AuthError("That date doesn't look right.")
    return v


def clean_item(data):
    title = one_line(data.get("title"), 120)
    if not title:
        raise AuthError("Give the update a name.")
    day = clean_day(data.get("day"))
    kind = data.get("kind") if data.get("kind") in KINDS else "small"
    status = data.get("status") if data.get("status") in STATUSES else ("planned" if day else "idea")
    version = re.sub(r"^[vV]", "", one_line(data.get("version"), 20))
    notes = re.sub(r"[^\S\n]+", " ", str(data.get("notes") or "").replace("\r", "")).strip()[:2000]
    return {"title": title, "day": day, "kind": kind, "status": status, "version": version, "notes": notes,
            "testers": 1 if data.get("testers") else 0}


class Planner:
    def __init__(self, accounts):
        self.acc = accounts

    async def list(self, user):
        """The rows this person may see, dated ones first."""
        role = role_of(user)
        full = role in ("developer", "admin")
        where = "" if full else "WHERE p.testers = 1"
        res = await self.acc.q("SELECT p.*, u.name AS by_name FROM plans p LEFT JOIN users u ON u.id = p.by_user "
                               f"{where} ORDER BY p.day = '', p.day, p.id")
        return {"role": role, "canEdit": full, "items": [self.row(r, full) for r in res["rows"]]}

    @staticmethod
    def row(r, full):
        out = {"id": r["id"], "title": r["title"], "day": r["day"], "kind": r["kind"], "status": r["status"],
               "version": r["version"], "notes": r["notes"], "testers": bool(r["testers"])}
        if full:
            out.update(by=r["by_name"] or "", updated=r["updated"])
        return out

    async def save(self, user, data):
        """Add a row (no id) or change one. Returns its id."""
        item = clean_item(data)
        pid = data.get("id")
        t = now()
        if pid is not None:
            if not isinstance(pid, int) or isinstance(pid, bool):
                raise AuthError("Unknown update.")
            res = await self.acc.q("UPDATE plans SET title = ?, day = ?, kind = ?, status = ?, version = ?, notes = ?, testers = ?, updated = ? "
                                   "WHERE id = ?", *item.values(), t, pid)
            if not res["changes"]:
                raise AuthError("Someone deleted that update.")
            return pid
        count = (await self.acc.q("SELECT COUNT(*) AS n FROM plans"))["rows"][0]["n"]
        if count >= MAX_ROWS:
            raise AuthError(f"The calendar is full ({MAX_ROWS} updates). Delete some old ones first.")
        res = await self.acc.q("INSERT INTO plans (title, day, kind, status, version, notes, testers, by_user, created, updated) "
                               "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", *item.values(), user["id"], t, t)
        return res["id"]

    async def delete(self, user, pid):
        if not isinstance(pid, int) or isinstance(pid, bool):
            raise AuthError("Unknown update.")
        await self.acc.q("DELETE FROM plans WHERE id = ?", pid)
        return pid

    # -- the team: announcements and group chat ---------------------------------
    @staticmethod
    def person(r):
        look = parse_look(r.get("look"))
        return {"id": r["user_id"], "name": r["name"] or "", "avatar": r["avatar"] or "👻", "color": r["color"] or "#888888",
                "admin": bool(r["admin"]), **{k: look[k] for k in ("aura", "anim") if look.get(k)}}

    def entry(self, r):
        return {"id": r["id"], "text": r["text"], "ts": r["ts"], "by": self.person(r)}

    async def rows(self, table, where, *args, limit=1):
        res = await self.acc.q(f"SELECT t.*, u.name, u.avatar, u.color, u.admin, l.data AS look FROM {table} t "
                               f"LEFT JOIN users u ON u.id = t.user_id LEFT JOIN looks l ON l.user_id = t.user_id "
                               f"{where} ORDER BY t.id DESC LIMIT ?", *args, limit)
        return [self.entry(r) for r in reversed(res["rows"])]

    async def team(self, user):
        """What the team page needs: recent chat, recent announcements, and who may post announcements."""
        return {"chat": await self.rows("team_chat", "", limit=CHAT_SHOWN),
                "news": await self.rows("team_news", "", limit=NEWS_SHOWN),
                "canAnnounce": role_of(user) in ("developer", "admin"), "me": user["id"], "admin": bool(user["admin"])}

    async def say(self, user, text):
        text = re.sub(r"\s+", " ", "".join(ch for ch in str(text or "") if ch.isprintable() or ch.isspace())).strip()[:300]
        if not text:
            raise AuthError("Type a message first.")
        res = await self.acc.q("INSERT INTO team_chat (user_id, text, ts) VALUES (?, ?, ?)", user["id"], text, now())
        await self.acc.q("DELETE FROM team_chat WHERE id <= ?", res["id"] - CHAT_KEEP)
        return (await self.rows("team_chat", "WHERE t.id = ?", res["id"]))[0]

    async def announce(self, user, text):
        lines = ["".join(ch for ch in line if ch.isprintable()).strip() for line in str(text or "").replace("\r", "").split("\n")]
        text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()[:600]
        if not text:
            raise AuthError("Write the announcement first.")
        res = await self.acc.q("INSERT INTO team_news (user_id, text, ts) VALUES (?, ?, ?)", user["id"], text, now())
        return (await self.rows("team_news", "WHERE t.id = ?", res["id"]))[0]

    async def unpost(self, user, table, pid):
        """Delete your own message or announcement (admins can delete anyone's)."""
        if not isinstance(pid, int) or isinstance(pid, bool):
            raise AuthError("Unknown message.")
        found = (await self.acc.q(f"SELECT user_id FROM {table} WHERE id = ?", pid))["rows"]
        if not found:
            raise AuthError("That's already gone.")
        if found[0]["user_id"] != user["id"] and not user["admin"]:
            raise AuthError("You can only delete your own.")
        await self.acc.q(f"DELETE FROM {table} WHERE id = ?", pid)
        return pid
