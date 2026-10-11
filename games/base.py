import math


def num(value, default=0.0, lo=None, hi=None):
    """Parse a number from client input, clamped and NaN-safe."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(v) or math.isinf(v):
        return default
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


class Game:
    """Base class for a room's game. One instance per room."""

    key = ""
    max_players = 8
    offline_grace = 40  # seconds a disconnected player keeps their seat

    def __init__(self, room):
        self.room = room
        self.phase = "lobby"
        self.tainted = False  # an admin used a cheat: don't save this game's results

    # Shown in "open rooms" and used by quick play.
    def listed(self):
        return self.phase == "lobby"

    def is_host(self, m):
        return m.uid == self.room.host

    def broadcast(self, t, **data):
        self.room.broadcast("g:" + t, **data)

    def send(self, m, t, **data):
        m.send("g:" + t, **data)

    def state_for(self, m):
        return {"phase": self.phase}

    def on_join(self, m, rejoin):
        pass

    def on_offline(self, m):
        pass

    def on_leave(self, m):
        pass

    def on_message(self, m, t, msg):
        pass

    # -- accounts ----------------------------------------------------------
    def record(self, uid, outcome, stats=None, detail="", xp=None):
        """Save a finished game for a logged-in player.
        outcome: "win", "loss", "draw" or "play". stats: {"key": ("add"|"max"|"min"|"set", number)}."""
        if not self.tainted:
            self.room.hub.record(self.room, uid, self.key, outcome, stats, detail, xp)

    def restart(self, host):
        """Everyone voted "play again": same as the host pressing start."""
        self.on_message(host, "start", {})

    def finished(self, groups):
        """The game ended. groups: lists of player ids from first place down (a tie shares a group).
        The room uses this for party points and the "play again?" vote."""
        fn = getattr(self.room, "game_over", None)
        if fn:
            fn([list(g) for g in groups if g])

    @staticmethod
    def groups_by(rows, key, id_key="id"):
        """Rows already sorted best-first -> groups of ids, with equal `key` values sharing a place."""
        groups, last = [], object()
        for r in rows:
            if groups and r[key] == last:
                groups[-1].append(r[id_key])
            else:
                groups.append([r[id_key]])
            last = r[key]
        return groups

    def record_ranking(self, ranking, prefix, unit="pts", value="points", extra=None):
        """Save a points game: the single top scorer wins, a shared top is a draw.
        Playing alone never counts as a win. extra: {uid: {stat: (op, n)}} added per player."""
        n = len(ranking)
        top = ranking[0][value] if ranking else 0
        leaders = [r for r in ranking if r[value] == top]
        for i, r in enumerate(ranking):
            pts = r[value]
            if n < 2:
                outcome = "play"
            elif r[value] == top and top > 0:
                outcome = "win" if len(leaders) == 1 else "draw"
            else:
                outcome = "loss"
            stats = {f"{prefix}.points": ("add", max(0, pts))}
            if pts > 0:
                stats[f"{prefix}.best"] = ("max", pts)
            if outcome == "win":
                stats[f"{prefix}.wins"] = ("add", 1)
            stats.update((extra or {}).get(r["id"], {}))
            self.record(r["id"], outcome, stats, f"#{i + 1} of {n} · {pts:,} {unit}")
        self.finished(self.groups_by(ranking, value))

    def on_chat(self, m, entry):
        """Return True if the game handled this room chat message itself."""
        return False

    def on_admin(self, m, action, msg):
        """Admin cheats. Return a short message if the cheat worked, else None."""
        return None
