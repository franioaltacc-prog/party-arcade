"""Shared base classes for casino games.

To add a game: subclass HouseTable (you vs the house) or PlayersTable (coins
move between players), give it a unique `key`, decorate it with @register and
import its module in match.py. The match takes care of coins, scores and the
lobby; your table only has to handle its own messages and state.
"""
import time

TABLES = {}


def register(cls):
    TABLES[cls.key] = cls
    return cls


class Table:
    key = ""
    title = ""
    emoji = "🎲"
    mode = "house"          # "house" or "players"
    blurb = ""
    personal = False        # True = every player has their own private game (slots)
    order = 50

    def __init__(self, match):
        self.match = match
        self.room = match.room
        self.timers = []

    # ---------------------------------------------------------- hooks
    def state_for(self, uid):
        return {}

    def on_message(self, uid, action, msg):
        pass

    def stake_of(self, uid):
        """Coins this player currently has at risk on this table."""
        return 0

    def summary(self):
        """Tiny status shown in the game menu, e.g. 'Betting · 8s'."""
        return ""

    def on_offline(self, uid):
        pass

    def on_online(self, uid):
        pass

    def on_leave(self, uid):
        self.on_offline(uid)

    def abort(self):
        """Match is ending: refund anything still in play and stop timers."""
        self.cancel_all()

    # ---------------------------------------------------------- helpers
    def later(self, delay, fn, *args):
        handle = self.room.later(delay, fn, *args)
        self.timers.append(handle)
        return handle

    def cancel(self, handle):
        if handle:
            self.room.cancel(handle)

    def cancel_all(self):
        for h in self.timers:
            self.room.cancel(h)
        self.timers = []

    def push(self):
        self.match.push_table(self)

    def toast(self, uid, text, bad=False):
        self.match.toast(uid, text, bad)

    def name(self, uid):
        return self.match.name(uid)

    def info(self):
        return {"key": self.key, "title": self.title, "emoji": self.emoji, "mode": self.mode,
                "blurb": self.blurb, "personal": self.personal}


class HouseTable(Table):
    mode = "house"


class PlayersTable(Table):
    mode = "players"


class RoundTable(HouseTable):
    """A shared betting round: first bet opens a betting window, then one
    shared result (spin/roll) is revealed to everyone at the same time."""

    bet_window = 15
    anim = 5
    result_pause = 5

    def __init__(self, match):
        super().__init__(match)
        self.phase = "idle"
        self.round = 0
        self.bets = {}
        self.deadline = 0
        self.result = None
        self.last_result = None
        self.history = []
        self.payouts = {}
        self.last_bet = {}

    # subclasses implement these
    def valid_bet(self, kind, value):
        raise NotImplementedError

    def roll(self):
        raise NotImplementedError

    def multiplier(self, bet, result):
        """Total returned per coin (stake included). 0 = lost."""
        raise NotImplementedError

    def remaining(self):
        return max(0.0, round(self.deadline - time.time(), 1)) if self.phase != "idle" else None

    def stake_of(self, uid):
        if self.phase in ("betting", "resolving"):
            return sum(b["amount"] for b in self.bets.get(uid, []))
        return 0

    def summary(self):
        if self.phase == "betting":
            return f"Betting · {int(self.remaining() or 0)}s"
        if self.phase == "resolving":
            return "Rolling…"
        return "Open"

    def on_message(self, uid, action, msg):
        if action == "bet":
            self.place(uid, msg.get("kind"), msg.get("value"), msg.get("amount"))
        elif action == "clear":
            self.clear(uid)

    def place(self, uid, kind, value, amount):
        if self.phase not in ("idle", "betting"):
            self.toast(uid, "Bets are closed — wait for the next round! ⏳", True)
            return
        value = self.valid_bet(kind, value)
        if value is None:
            return
        now = time.time()
        if now - self.last_bet.get(uid, 0) < 0.25:
            return  # double click guard
        ok, why, amount = self.match.check_bet(uid, amount)
        if not ok:
            self.toast(uid, why, True)
            return
        self.last_bet[uid] = now
        self.match.take(uid, amount)
        mine = self.bets.setdefault(uid, [])
        for b in mine:
            if b["kind"] == kind and b["value"] == value:
                b["amount"] += amount
                break
        else:
            mine.append({"kind": kind, "value": value, "amount": amount})
        if self.phase == "idle":
            self.phase = "betting"
            self.round += 1
            self.payouts = {}
            self.deadline = now + self.bet_window
            self.later(self.bet_window, self.close_bets)
        self.match.push_scores()
        self.push()

    def clear(self, uid):
        if self.phase != "betting" or uid not in self.bets:
            return
        refund = sum(b["amount"] for b in self.bets.pop(uid))
        self.match.give(uid, refund)
        self.match.push_scores()
        self.push()

    def close_bets(self):
        if self.phase != "betting":
            return
        if not self.bets:
            self.phase = "idle"
            self.push()
            return
        self.phase = "resolving"
        self.result = self.roll()
        self.deadline = time.time() + self.anim
        self.push()
        self.later(self.anim, self.settle)

    def settle(self):
        if self.phase != "resolving":
            return
        self.payouts = {}
        for uid, bets in self.bets.items():
            staked = sum(b["amount"] for b in bets)
            returned = 0
            for b in bets:
                returned += int(b["amount"] * self.multiplier(b, self.result))
            if returned:
                self.match.give(uid, returned)
            self.payouts[uid] = {"staked": staked, "returned": returned}
            self.match.record(uid, self, staked, returned)
        self.last_result = self.result
        self.history = ([self.result] + self.history)[:12]
        self.phase = "results"
        self.deadline = time.time() + self.result_pause
        self.push()
        self.match.push_scores()
        self.later(self.result_pause, self.reset_round)
        self.match.round_done(self)

    def reset_round(self):
        if self.phase != "results":
            return
        self.phase = "idle"
        self.bets = {}
        self.result = None
        self.push()

    def abort(self):
        super().abort()
        if self.phase in ("betting", "resolving"):
            for uid, bets in self.bets.items():
                self.match.give(uid, sum(b["amount"] for b in bets))
        self.phase = "idle"
        self.bets = {}

    def state_for(self, uid):
        others = {}
        for u, bets in self.bets.items():
            others[u] = {"total": sum(b["amount"] for b in bets), "bets": bets}
        return {"phase": self.phase, "round": self.round, "remaining": self.remaining(),
                "result": self.result if self.phase in ("resolving", "results") else None,
                "last": self.last_result, "history": self.history, "bets": others,
                "mine": self.bets.get(uid, []), "payouts": self.payouts if self.phase == "results" else {},
                "anim": self.anim, "window": self.bet_window}
