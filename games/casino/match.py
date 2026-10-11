"""Casino Night: a match where everyone starts with the same fake coins and
tries to finish with the most. Coins are never real money and can't be bought."""
import copy
import time

from ..base import Game, num
from .tables import TABLES
from . import house_blackjack, house_dice, house_roulette, house_slots, players_duels, players_poker  # noqa: F401 (register tables)

COMEBACK_COINS = 100
DEFAULTS = {
    "startCoins": 1000,
    "winMode": "time",      # time | rounds | target
    "minutes": 10,
    "rounds": 30,
    "target": 10000,
    "minBet": 10,
    "maxBet": 1000,
    "comeback": True,
    "games": {},
}


class Casino(Game):
    key = "casino"
    max_players = 6
    offline_grace = 60

    def __init__(self, room):
        super().__init__(room)
        self.settings = copy.deepcopy(DEFAULTS)
        self.settings["games"] = {k: True for k in TABLES}
        self.players = {}
        self.tables = {}
        self.make_tables()
        self.feed = []
        self.rounds = 0
        self.started = 0
        self.ends_at = None
        self.end_timer = None
        self.results = None
        self._scores_pending = False

    def make_tables(self):
        for t in self.tables.values():
            t.abort()
        self.tables = {k: cls(self) for k, cls in sorted(TABLES.items(), key=lambda kv: kv[1].order)}

    def listed(self):
        return self.phase in ("lobby", "over")

    # ------------------------------------------------------------- coins
    def name(self, uid):
        m = self.room.members.get(uid)
        if m:
            return m.name
        p = self.players.get(uid)
        return p["name"] if p else "Someone"

    def coins(self, uid):
        p = self.players.get(uid)
        return p["coins"] if p else 0

    def check_bet(self, uid, amount):
        """Validate a bet. Returns (ok, message, amount)."""
        if self.phase != "playing":
            return False, "The match hasn't started yet.", 0
        p = self.players.get(uid)
        if not p:
            return False, "You're spectating this match. Join the next one! 👀", 0
        if p["out"]:
            return False, "You're out of coins — you're spectating now. 👀", 0
        amount = int(num(amount, 0, 0, 10 ** 12))
        lo, hi = self.settings["minBet"], self.settings["maxBet"]
        if amount < lo:
            return False, f"Minimum bet is {lo:,} coins.", 0
        if hi and amount > hi:
            return False, f"Maximum bet is {hi:,} coins.", 0
        if amount > p["coins"]:
            return False, f"You only have {p['coins']:,} coins. 💸", 0
        return True, "", amount

    def take(self, uid, amount):
        p = self.players.get(uid)
        if not p or amount <= 0:
            return 0
        amount = min(amount, p["coins"])
        p["coins"] -= amount
        return amount

    def give(self, uid, amount):
        p = self.players.get(uid)
        if p and amount > 0:
            p["coins"] += int(amount)

    def stake_total(self, uid):
        return sum(t.stake_of(uid) for t in self.tables.values())

    def record(self, uid, table, staked, returned):
        """Called once per finished bet/hand/duel for each player involved."""
        p = self.players.get(uid)
        if not p or self.phase != "playing":
            return
        net = int(returned) - int(staked)
        p["played"] += 1
        p["games"][table.key] = p["games"].get(table.key, 0) + 1
        if net > p["bestWin"]["amount"]:
            p["bestWin"] = {"amount": net, "game": table.title}
        if net < 0 and -net > p["worstLoss"]["amount"]:
            p["worstLoss"] = {"amount": -net, "game": table.title}
        if net > 0 and (net >= 500 or (staked and returned >= staked * 10)) and table.mode == "house":
            self.post(f"🎉 {self.name(uid)} won {net:,} on {table.title}!")
        # check after the table has finished clearing this round's stakes
        self.room.later(0.05, self.after_coins, uid)

    def after_coins(self, uid):
        p = self.players.get(uid)
        if not p or self.phase != "playing":
            return
        target = self.settings["target"]
        if self.settings["winMode"] == "target" and p["coins"] >= target:
            self.later_finish(f"🏆 {self.name(uid)} reached {target:,} coins!")
            return
        if p["coins"] <= 0 and not p["out"] and self.stake_total(uid) == 0:
            if self.settings["comeback"] and not p["comebackUsed"]:
                p["comebackUsed"] = True
                p["coins"] += COMEBACK_COINS
                self.post(f"🪙 {self.name(uid)} went broke and grabbed {COMEBACK_COINS} comeback coins!")
                self.toast(uid, f"🪙 You got {COMEBACK_COINS} comeback coins! Make them count.")
            else:
                p["out"] = True
                self.post(f"💀 {self.name(uid)} is out of coins!")
                self.toast(uid, "💀 You're out of coins — you can keep watching and chatting.", True)
                self.check_last_standing()
        self.push_scores()

    def check_last_standing(self):
        alive = [u for u, p in self.players.items() if not p["out"]]
        if len(self.players) > 1 and len(alive) <= 1:
            who = self.name(alive[0]) if alive else "Nobody"
            self.later_finish(f"🏆 {who} is the last player standing!")
        elif len(self.players) == 1 and not alive:
            self.later_finish("💀 You ran out of coins!")

    def round_done(self, table):
        if self.phase != "playing":
            return
        self.rounds += 1
        if self.settings["winMode"] == "rounds" and self.rounds >= self.settings["rounds"]:
            self.later_finish(f"🏁 All {self.settings['rounds']} rounds have been played!")
        self.push_scores()

    def later_finish(self, reason):
        if getattr(self, "_finishing", False):
            return
        self._finishing = True
        self.room.later(1.5, self.finish, reason)

    # ------------------------------------------------------------- feed & pushes
    def post(self, text):
        item = {"text": text, "ts": int(time.time() * 1000)}
        self.feed.append(item)
        del self.feed[:-40]
        self.broadcast("feed", item=item)

    def toast(self, uid, text, bad=False):
        m = self.room.members.get(uid)
        if m:
            m.send("g:toast", text=text, bad=bad)

    def scoreboard(self):
        rows = []
        for uid, p in self.players.items():
            m = self.room.members.get(uid)
            rows.append({"id": uid, "name": m.name if m else p["name"], "avatar": m.avatar if m else p["avatar"],
                         "color": m.color if m else p["color"], "coins": p["coins"], "out": p["out"],
                         "online": bool(m and m.online), "left": m is None, "viewing": p.get("viewing"),
                         "inPlay": self.stake_total(uid), "played": p["played"]})
        rows.sort(key=lambda r: (-(r["coins"] + r["inPlay"]), r["name"]))
        return rows

    def match_info(self):
        return {"rounds": self.rounds, "endsIn": max(0, round(self.ends_at - time.time())) if self.ends_at else None,
                "elapsed": round(time.time() - self.started) if self.started else 0}

    def push_scores(self):
        if self._scores_pending:
            return
        self._scores_pending = True

        def send():
            self._scores_pending = False
            summaries = {k: t.summary() for k, t in self.tables.items()}
            self.broadcast("scores", scores=self.scoreboard(), info=self.match_info(), summaries=summaries)

        self.room.later(0.05, send)

    def push_table(self, table):
        for m in list(self.room.members.values()):
            if m.online:
                m.send("g:table", game=table.key, state=table.state_for(m.uid), summary=table.summary())

    def push_all(self):
        for m in list(self.room.members.values()):
            if m.online:
                m.send("g:state", state=self.state_for(m))

    def state_for(self, m):
        uid = m.uid if m else None
        allowed = [k for k, on in self.settings["games"].items() if on and k in self.tables]
        return {
            "phase": self.phase, "settings": self.settings,
            "games": [self.tables[k].info() for k in self.tables],
            "allowed": allowed,
            "scores": self.scoreboard(), "info": self.match_info(), "feed": self.feed[-30:],
            "me": self.players.get(uid), "spectator": self.phase == "playing" and uid not in self.players,
            "tables": {k: self.tables[k].state_for(uid) for k in allowed} if self.phase == "playing" else {},
            "summaries": {k: t.summary() for k, t in self.tables.items()},
            "results": self.results,
        }

    # ------------------------------------------------------------- messages
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase != "playing":
            self.update_settings(msg)
            self.push_all()
        elif t == "start" and host and self.phase != "playing":
            self.start()
        elif t == "end" and host and self.phase == "playing":
            self.finish("⏹️ The host ended the match.")
        elif t == "kick" and host:
            uid = msg.get("uid")
            if uid and uid != m.uid and uid in self.room.members:
                name = self.name(uid)
                self.room.kick(uid)
                self.post(f"👢 {name} was removed by the host.")
                self.push_all()
        elif t == "view":
            p = self.players.get(m.uid)
            if p and msg.get("game") in self.tables:
                p["viewing"] = msg["game"]
                self.push_scores()
        elif t == "tbl" and self.phase == "playing":
            table = self.tables.get(msg.get("game"))
            if not table or not self.settings["games"].get(table.key):
                return
            table.on_message(m.uid, msg.get("a"), msg)

    def update_settings(self, msg):
        s = self.settings
        if "startCoins" in msg:
            s["startCoins"] = int(num(msg["startCoins"], 1000, 100, 1_000_000))
        if msg.get("winMode") in ("time", "rounds", "target"):
            s["winMode"] = msg["winMode"]
        if "minutes" in msg:
            s["minutes"] = int(num(msg["minutes"], 10, 1, 120))
        if "rounds" in msg:
            s["rounds"] = int(num(msg["rounds"], 30, 5, 500))
        if "target" in msg:
            s["target"] = int(num(msg["target"], 10000, 200, 100_000_000))
        if "minBet" in msg:
            s["minBet"] = int(num(msg["minBet"], 10, 1, 100_000))
        if "maxBet" in msg:
            s["maxBet"] = int(num(msg["maxBet"], 1000, 0, 100_000_000))
        if s["maxBet"] and s["maxBet"] < s["minBet"]:
            s["maxBet"] = s["minBet"]
        if "comeback" in msg:
            s["comeback"] = bool(msg["comeback"])
        games = msg.get("games")
        if isinstance(games, dict):
            for k, v in games.items():
                if k in self.tables:
                    s["games"][k] = bool(v)
            if not any(s["games"].values()):
                s["games"]["slots"] = True
        if s["winMode"] == "target" and s["target"] <= s["startCoins"]:
            s["target"] = s["startCoins"] * 5

    # ------------------------------------------------------------- match flow
    def start(self):
        self.make_tables()
        self.room.cancel(self.end_timer)
        self._finishing = False
        self.phase = "playing"
        self.tainted = False
        self.results = None
        self.rounds = 0
        self.feed = []
        self.started = time.time()
        self.players = {}
        for m in self.room.players_now():
            self.players[m.uid] = {"name": m.name, "avatar": m.avatar, "color": m.color,
                                   "coins": self.settings["startCoins"], "out": False, "comebackUsed": False,
                                   "played": 0, "games": {}, "bestWin": {"amount": 0, "game": None},
                                   "worstLoss": {"amount": 0, "game": None}, "viewing": None}
        self.ends_at = None
        if self.settings["winMode"] == "time":
            self.ends_at = time.time() + self.settings["minutes"] * 60
            self.end_timer = self.room.later(self.settings["minutes"] * 60, self.finish, "⏰ Time's up!")
        self.post(f"🎲 The match has started! Everyone gets {self.settings['startCoins']:,} coins. Good luck!")
        self.push_all()

    def finish(self, reason):
        if self.phase != "playing":
            return
        self.room.cancel(self.end_timer)
        for t in self.tables.values():
            t.abort()
        self.phase = "over"
        ranking = sorted(self.players.items(), key=lambda kv: -kv[1]["coins"])
        rows = []
        for uid, p in ranking:
            m = self.room.members.get(uid)
            rows.append({"id": uid, "name": m.name if m else p["name"], "avatar": m.avatar if m else p["avatar"],
                         "color": m.color if m else p["color"], "coins": p["coins"], "played": p["played"],
                         "bestWin": p["bestWin"], "worstLoss": p["worstLoss"], "out": p["out"], "games": p["games"]})

        def top(key, sub=None):
            if not rows:
                return None
            best = max(rows, key=lambda r: r[key][sub] if sub else r[key])
            value = best[key][sub] if sub else best[key]
            if not value:
                return None
            return {"id": best["id"], "name": best["name"], "avatar": best["avatar"], "color": best["color"],
                    "value": value, "game": best[key].get("game") if sub else None}

        self.results = {"reason": reason, "ranking": rows, "winner": rows[0] if rows else None,
                        "biggestWin": top("bestWin", "amount"), "biggestLoss": top("worstLoss", "amount"),
                        "mostPlayed": top("played"), "rounds": self.rounds,
                        "duration": round(time.time() - self.started)}
        self.post(f"🏁 Match over! {reason}")
        self.broadcast("over", reason=reason)
        self.push_all()
        self.make_tables()
        self.save_results(rows)

    def save_results(self, rows):
        # this class has its own record() for bets, so call the account one directly
        n = len(rows)
        Game.finished(self, Game.groups_by(rows, "coins"))
        for i, r in enumerate(rows):
            tied = n >= 2 and rows[0]["coins"] == rows[1]["coins"]
            if n < 2:
                outcome = "play"
            elif i == 0 or (tied and r["coins"] == rows[0]["coins"]):
                outcome = "draw" if tied else "win"
            else:
                outcome = "loss"
            stats = {"casino.best_coins": ("max", r["coins"]), "casino.best_win": ("max", r["bestWin"]["amount"]),
                     "casino.bets": ("add", r["played"])}
            if outcome == "win":
                stats["casino.wins"] = ("add", 1)
            Game.record(self, r["id"], outcome, stats, f"#{i + 1} of {n} · 🪙 {r['coins']:,} coins")

    def on_admin(self, m, action, msg):
        p = self.players.get(m.uid)
        if action == "end" and self.phase == "playing":
            self.later_finish("🛡️ An admin ended the match.")
            return "🏁 Ending the match."
        if not p or self.phase != "playing":
            return None
        if action == "coins":
            p["out"] = False
            self.give(m.uid, 10_000)
            self.push_scores()
            return "🪙 +10,000 coins."
        if action == "rich":
            p["out"] = False
            self.give(m.uid, 1_000_000)
            self.push_scores()
            return "💎 +1,000,000 coins."
        if action == "broke":
            p["coins"] = 0
            self.after_coins(m.uid)
            self.push_scores()
            return "💸 You're broke now. Enjoy!"
        return None

    # ------------------------------------------------------------- connections
    def on_join(self, m, rejoin):
        if self.phase == "playing":
            for t in self.tables.values():
                t.on_online(m.uid)
        self.push_all()

    def on_offline(self, m):
        for t in self.tables.values():
            t.on_offline(m.uid)
        self.push_scores()

    def on_leave(self, m):
        for t in self.tables.values():
            t.on_leave(m.uid)
        if self.phase == "playing" and m.uid in self.players:
            p = self.players[m.uid]
            if not p["out"]:
                self.post(f"👋 {p['name']} left the casino with {p['coins']:,} coins.")
        self.push_all()
