"""The update calendar (/calendar): what's coming to Party Arcade and when.

Admins give people a role in the admin panel (see ROLES in accounts.py):
* testers see the rows a developer marked "testers can see this", and can't change anything;
* developers and admins see every row and add, change, move and delete them.
Neither role gets the admin panel, cheats or XP tools, and every request re-checks the role in the database.

The table (plans) lives in the accounts database: see SCHEMA in accounts.py.
"""
import datetime
import re
import time

from accounts import AuthError, role_of

KINDS = ("big", "small", "fix", "event")
STATUSES = ("idea", "planned", "building", "shipped", "skipped")
MAX_ROWS = 500


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
