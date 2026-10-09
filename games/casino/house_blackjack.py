import time

from .cards import bj_total, is_blackjack, new_deck
from .tables import HouseTable, register

BET_WINDOW = 12
TURN = 20
RESULT = 6


@register
class Blackjack(HouseTable):
    key = "blackjack"
    title = "Blackjack"
    emoji = "🃏"
    blurb = "Beat the dealer to 21. Hit, stand or double down."
    order = 30

    def __init__(self, match):
        super().__init__(match)
        self.phase = "idle"
        self.round = 0
        self.shoe = new_deck(6)
        self.bets = {}
        self.hands = {}
        self.dealer = []
        self.deadline = 0
        self.turn_timers = {}
        self.turn_deadline = {}

    # ---------------------------------------------------------- helpers
    def draw(self):
        if len(self.shoe) < 52:
            self.shoe = new_deck(6)
        return self.shoe.pop()

    def remaining(self, t=None):
        t = self.deadline if t is None else t
        return max(0.0, round(t - time.time(), 1))

    def stake_of(self, uid):
        if self.phase == "betting":
            return self.bets.get(uid, 0)
        if self.phase in ("playing", "dealer") and uid in self.hands:
            return self.hands[uid]["bet"]
        return 0

    def summary(self):
        if self.phase == "betting":
            return f"Betting · {int(self.remaining())}s"
        if self.phase in ("playing", "dealer"):
            return f"{len(self.hands)} playing"
        return "Open"

    # ---------------------------------------------------------- messages
    def on_message(self, uid, action, msg):
        if action == "bet":
            self.bet(uid, msg.get("amount"))
        elif action == "clear" and self.phase == "betting" and uid in self.bets:
            self.match.give(uid, self.bets.pop(uid))
            self.match.push_scores()
            self.push()
        elif action in ("hit", "stand", "double") and self.phase == "playing":
            self.act(uid, action)

    def bet(self, uid, amount):
        if self.phase not in ("idle", "betting"):
            self.toast(uid, "A hand is being played — bet on the next one! ⏳", True)
            return
        if uid in self.bets:
            self.toast(uid, "You already placed your bet for this hand.", True)
            return
        ok, why, amount = self.match.check_bet(uid, amount)
        if not ok:
            self.toast(uid, why, True)
            return
        self.match.take(uid, amount)
        self.bets[uid] = amount
        if self.phase == "idle":
            self.phase = "betting"
            self.round += 1
            self.hands = {}
            self.dealer = []
            self.deadline = time.time() + BET_WINDOW
            self.later(BET_WINDOW, self.deal)
        self.match.push_scores()
        self.push()

    def deal(self):
        if self.phase != "betting":
            return
        if not self.bets:
            self.phase = "idle"
            self.push()
            return
        self.phase = "playing"
        self.hands = {uid: {"cards": [self.draw(), self.draw()], "bet": amt, "done": False, "result": None,
                            "doubled": False, "payout": 0} for uid, amt in self.bets.items()}
        self.bets = {}
        self.dealer = [self.draw(), self.draw()]
        if is_blackjack(self.dealer):
            for h in self.hands.values():
                h["done"] = True
            self.dealer_play()
            return
        for uid, h in self.hands.items():
            if is_blackjack(h["cards"]):
                h["done"] = True
            else:
                self.start_turn(uid)
                m = self.room.members.get(uid)
                if not (m and m.online):
                    h["done"] = True
        self.push()
        self.check_all_done()

    def start_turn(self, uid):
        self.cancel(self.turn_timers.get(uid))
        self.turn_deadline[uid] = time.time() + TURN
        self.turn_timers[uid] = self.later(TURN, self.timeout, uid)

    def timeout(self, uid):
        h = self.hands.get(uid)
        if self.phase == "playing" and h and not h["done"]:
            h["done"] = True
            self.toast(uid, "⏰ Too slow — you stood automatically.", True)
            self.push()
            self.check_all_done()

    def act(self, uid, action):
        h = self.hands.get(uid)
        if not h or h["done"]:
            return
        if action == "hit":
            h["cards"].append(self.draw())
            total = bj_total(h["cards"])[0]
            if total >= 21:
                h["done"] = True
        elif action == "stand":
            h["done"] = True
        elif action == "double":
            if len(h["cards"]) != 2:
                return
            if self.match.coins(uid) < h["bet"]:
                self.toast(uid, "Not enough coins to double down 💸", True)
                return
            self.match.take(uid, h["bet"])
            h["bet"] *= 2
            h["doubled"] = True
            h["cards"].append(self.draw())
            h["done"] = True
            self.match.push_scores()
        if not h["done"]:
            self.start_turn(uid)
        self.push()
        self.check_all_done()

    def on_offline(self, uid):
        h = self.hands.get(uid)
        if self.phase == "playing" and h and not h["done"]:
            h["done"] = True
            self.push()
            self.check_all_done()

    def check_all_done(self):
        if self.phase == "playing" and all(h["done"] for h in self.hands.values()):
            for t in self.turn_timers.values():
                self.cancel(t)
            self.turn_timers = {}
            self.later(0.8, self.dealer_play)
            self.phase = "dealer"
            self.push()

    def dealer_play(self):
        self.phase = "dealer"
        anyone_alive = any(bj_total(h["cards"])[0] <= 21 and not is_blackjack(h["cards"]) for h in self.hands.values())
        if anyone_alive and not is_blackjack(self.dealer):
            while True:
                total, soft = bj_total(self.dealer)
                if total < 17:
                    self.dealer.append(self.draw())
                else:
                    break
        self.settle()

    def settle(self):
        d_total = bj_total(self.dealer)[0]
        d_bj = is_blackjack(self.dealer)
        for uid, h in self.hands.items():
            total = bj_total(h["cards"])[0]
            bet = h["bet"]
            if is_blackjack(h["cards"]) and not h["doubled"]:
                res, pay = ("push", bet) if d_bj else ("blackjack", int(bet * 2.5))
            elif total > 21:
                res, pay = "bust", 0
            elif d_bj:
                res, pay = "lose", 0
            elif d_total > 21 or total > d_total:
                res, pay = "win", bet * 2
            elif total == d_total:
                res, pay = "push", bet
            else:
                res, pay = "lose", 0
            h["result"] = res
            h["payout"] = pay
            if pay:
                self.match.give(uid, pay)
            self.match.record(uid, self, bet, pay)
        self.phase = "results"
        self.deadline = time.time() + RESULT
        self.push()
        self.match.push_scores()
        self.later(RESULT, self.reset)
        self.match.round_done(self)

    def reset(self):
        if self.phase != "results":
            return
        self.phase = "idle"
        self.push()

    def abort(self):
        super().abort()
        for uid, amt in self.bets.items():
            self.match.give(uid, amt)
        if self.phase in ("playing", "dealer"):
            for uid, h in self.hands.items():
                self.match.give(uid, h["bet"])
        self.bets = {}
        self.hands = {}
        self.phase = "idle"

    # ---------------------------------------------------------- state
    def state_for(self, uid):
        reveal = self.phase in ("dealer", "results")
        dealer = self.dealer if reveal else (self.dealer[:1] + ["??"] if self.dealer else [])
        hands = {}
        for u, h in self.hands.items():
            total, soft = bj_total(h["cards"])
            hands[u] = {"cards": h["cards"], "bet": h["bet"], "done": h["done"], "total": total, "soft": soft,
                        "result": h["result"], "payout": h["payout"], "doubled": h["doubled"],
                        "bj": is_blackjack(h["cards"]),
                        "turnLeft": self.remaining(self.turn_deadline.get(u, 0)) if not h["done"] and self.phase == "playing" else None}
        mine = self.hands.get(uid)
        return {"phase": self.phase, "round": self.round, "remaining": self.remaining() if self.phase in ("betting", "results") else None,
                "dealer": dealer, "dealerTotal": bj_total(self.dealer)[0] if reveal and self.dealer else (bj_total(self.dealer[:1])[0] if self.dealer else 0),
                "hands": hands, "bets": self.bets, "myBet": self.bets.get(uid),
                "canDouble": bool(mine and not mine["done"] and len(mine["cards"]) == 2 and self.match.coins(uid) >= mine["bet"]),
                "turn": TURN}
