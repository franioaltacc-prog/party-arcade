"""1v1 duels: challenge another player for X coins, they accept, the server
decides the winner and the pot moves between the two players."""
import time

from .cards import RNG, new_deck, rank_value, roll_die
from .tables import PlayersTable, register

ACCEPT_WINDOW = 30
REVEAL = 3.2


class DuelTable(PlayersTable):
    """Base for duels. Subclasses only implement play() -> (winner_side, details)
    where winner_side is 0 (challenger) or 1 (opponent)."""

    def __init__(self, match):
        super().__init__(match)
        self.duels = {}
        self.seq = 0
        self.history = []

    def play(self):
        raise NotImplementedError

    def stake_of(self, uid):
        return sum(d["amount"] for d in self.duels.values() if d["status"] == "playing" and uid in (d["from"], d["to"]))

    def summary(self):
        live = sum(1 for d in self.duels.values() if d["status"] in ("pending", "playing"))
        return f"{live} challenge{'s' if live != 1 else ''}" if live else "Challenge a friend"

    def on_message(self, uid, action, msg):
        if action == "challenge":
            self.challenge(uid, msg.get("to"), msg.get("amount"))
        elif action in ("accept", "decline", "cancel"):
            d = self.duels.get(msg.get("id"))
            if not d or d["status"] != "pending":
                return
            if action == "accept" and d["to"] == uid:
                self.accept(d)
            elif action == "decline" and d["to"] == uid:
                self.drop(d, f"{self.name(uid)} declined your {self.title} challenge.")
            elif action == "cancel" and d["from"] == uid:
                self.drop(d, None)

    def challenge(self, uid, to, amount):
        players = self.match.players
        if to == uid or to not in players:
            return
        if players[to]["out"]:
            self.toast(uid, f"{self.name(to)} is out of coins.", True)
            return
        m = self.room.members.get(to)
        if not (m and m.online):
            self.toast(uid, f"{self.name(to)} is offline right now.", True)
            return
        if any(d["status"] == "pending" and {d["from"], d["to"]} == {uid, to} for d in self.duels.values()):
            self.toast(uid, "You already have a challenge waiting with them.", True)
            return
        ok, why, amount = self.match.check_bet(uid, amount)
        if not ok:
            self.toast(uid, why, True)
            return
        if self.match.coins(to) < amount:
            self.toast(uid, f"{self.name(to)} only has {self.match.coins(to):,} coins.", True)
            return
        self.seq += 1
        d = {"id": self.seq, "from": uid, "to": to, "amount": amount, "status": "pending",
             "expires": time.time() + ACCEPT_WINDOW, "result": None}
        d["timer"] = self.later(ACCEPT_WINDOW, self.expire, d["id"])
        self.duels[d["id"]] = d
        self.toast(uid, f"⚔️ Challenge sent to {self.name(to)}!")
        m.send("g:duel_invite", game=self.key, id=d["id"], fromName=self.name(uid), amount=amount,
               title=self.title, emoji=self.emoji)
        self.push()

    def expire(self, did):
        d = self.duels.get(did)
        if d and d["status"] == "pending":
            self.drop(d, f"⌛ {self.name(d['to'])} didn't answer your challenge.")

    def drop(self, d, note):
        self.cancel(d.get("timer"))
        self.duels.pop(d["id"], None)
        if note:
            self.toast(d["from"], note, True)
        self.push()

    def accept(self, d):
        a, b, amt = d["from"], d["to"], d["amount"]
        if self.match.coins(a) < amt or self.match.coins(b) < amt:
            self.drop(d, "Someone doesn't have enough coins anymore — challenge cancelled.")
            return
        self.cancel(d.get("timer"))
        self.match.take(a, amt)
        self.match.take(b, amt)
        side, details = self.play()
        d.update(status="playing", winner=(a, b)[side], result=details, started=time.time())
        self.match.push_scores()
        self.push()
        self.later(REVEAL, self.settle, d["id"])

    def settle(self, did):
        d = self.duels.get(did)
        if not d or d["status"] != "playing":
            return
        a, b, amt, w = d["from"], d["to"], d["amount"], d["winner"]
        self.match.give(w, amt * 2)
        self.match.record(a, self, amt, amt * 2 if w == a else 0)
        self.match.record(b, self, amt, amt * 2 if w == b else 0)
        loser = b if w == a else a
        self.match.post(f"{self.emoji} {self.name(w)} beat {self.name(loser)} in a {amt:,}-coin {self.title}!")
        d["status"] = "done"
        self.duels.pop(did, None)
        self.history = ([{"from": a, "to": b, "amount": amt, "winner": w, "result": d["result"],
                          "fromName": self.name(a), "toName": self.name(b)}] + self.history)[:8]
        self.push()
        self.match.push_scores()
        self.match.round_done(self)

    def on_offline(self, uid):
        for d in list(self.duels.values()):
            if d["status"] == "pending" and uid in (d["from"], d["to"]):
                self.drop(d, None)

    def abort(self):
        super().abort()
        for d in self.duels.values():
            if d["status"] == "playing":
                self.match.give(d["from"], d["amount"])
                self.match.give(d["to"], d["amount"])
        self.duels = {}

    def state_for(self, uid):
        out = []
        for d in self.duels.values():
            if uid in (d["from"], d["to"]) or d["status"] == "playing":
                e = {k: d[k] for k in ("id", "from", "to", "amount", "status")}
                e.update(fromName=self.name(d["from"]), toName=self.name(d["to"]),
                         expiresIn=max(0, round(d["expires"] - time.time())))
                if d["status"] == "playing":
                    e.update(result=d["result"], winner=d["winner"], age=round(time.time() - d["started"], 2))
                out.append(e)
        return {"duels": out, "history": self.history, "reveal": REVEAL}


@register
class Coinflip(DuelTable):
    key = "coinflip"
    title = "Coinflip Duel"
    emoji = "🪙"
    blurb = "50/50. Challenger is heads. Winner takes the pot."
    order = 70

    def play(self):
        side = RNG.choice(["heads", "tails"])
        return (0 if side == "heads" else 1), {"side": side}


@register
class HighCard(DuelTable):
    key = "highcard"
    title = "High Card Duel"
    emoji = "🂡"
    blurb = "Each draws a card. Higher card wins the pot."
    order = 80

    def play(self):
        rounds = []
        while True:
            deck = new_deck()
            a, b = deck.pop(), deck.pop()
            rounds.append([a, b])
            if rank_value(a) != rank_value(b):
                return (0 if rank_value(a) > rank_value(b) else 1), {"rounds": rounds}


@register
class DiceDuel(DuelTable):
    key = "diceduel"
    title = "Dice Duel"
    emoji = "🎯"
    blurb = "Both roll two dice. Higher total wins the pot."
    order = 90

    def play(self):
        rounds = []
        while True:
            a, b = [roll_die(), roll_die()], [roll_die(), roll_die()]
            rounds.append([a, b])
            if sum(a) != sum(b):
                return (0 if sum(a) > sum(b) else 1), {"rounds": rounds}
