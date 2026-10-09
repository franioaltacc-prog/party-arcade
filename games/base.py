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
