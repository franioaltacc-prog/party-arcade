"""No-limit Texas Hold'em played with everyone's match coins."""
import time

from ..base import num
from .cards import best_hand, hand_name, new_deck
from .tables import PlayersTable, register

TURN = 25
SHOWDOWN = 7
SEATS = 6
STREETS = ["preflop", "flop", "turn", "river"]


@register
class Poker(PlayersTable):
    key = "poker"
    title = "Texas Hold'em"
    emoji = "♠️"
    blurb = "Real poker against your friends. Blinds, raises and all-ins."
    order = 60

    def __init__(self, match):
        super().__init__(match)
        self.seats = [None] * SEATS
        self.button = -1
        self.hand = None
        self.hand_no = 0
        self.next_timer = None
        self.turn_timer = None
        self.away = set()
        self.leaving = set()

    @property
    def bb(self):
        return max(2, int(self.match.settings["minBet"]))

    @property
    def sb(self):
        return max(1, self.bb // 2)

    def seated(self):
        return [u for u in self.seats if u]

    def summary(self):
        n = len(self.seated())
        if self.hand and not self.hand["over"]:
            return f"Hand #{self.hand_no} · {n} seated"
        return f"{n}/{SEATS} seated" if n else "Open seats"

    def stake_of(self, uid):
        if self.hand and not self.hand["over"] and uid in self.hand["players"]:
            return self.hand["players"][uid]["total"]
        return 0

    def online(self, uid):
        m = self.room.members.get(uid)
        return bool(m and m.online)

    # ------------------------------------------------------------- seating
    def on_message(self, uid, action, msg):
        if action == "sit":
            self.sit(uid)
        elif action == "leave":
            self.stand_up(uid)
        elif action in ("fold", "check", "call", "raise", "allin"):
            self.act(uid, action, msg.get("amount"))

    def sit(self, uid):
        if uid in self.seats:
            return
        p = self.match.players.get(uid)
        if not p or p["out"]:
            self.toast(uid, "You're out of coins — you can only watch. 👀", True)
            return
        if p["coins"] < self.bb:
            self.toast(uid, f"You need at least {self.bb} coins (the big blind) to sit down.", True)
            return
        if None not in self.seats:
            self.toast(uid, "The table is full! 🪑", True)
            return
        self.seats[self.seats.index(None)] = uid
        self.leaving.discard(uid)
        self.push()
        self.maybe_start()

    def stand_up(self, uid):
        if uid not in self.seats:
            return
        h = self.hand
        if h and not h["over"] and uid in h["players"] and not h["players"][uid]["folded"]:
            self.leaving.add(uid)
            self.fold(uid)
        else:
            self.seats[self.seats.index(uid)] = None
            self.push()

    def on_offline(self, uid):
        self.away.add(uid)
        h = self.hand
        if h and not h["over"] and h["to_act"] == uid:
            self.auto_act(self.hand_no, uid)

    def on_online(self, uid):
        self.away.discard(uid)
        self.push()

    def on_leave(self, uid):
        self.away.discard(uid)
        self.stand_up(uid)

    def eligible(self):
        out = []
        for i, u in enumerate(self.seats):
            p = self.match.players.get(u) if u else None
            if p and not p["out"] and p["coins"] >= self.bb and u not in self.away:
                out.append(i)
        return out

    def maybe_start(self, delay=3):
        if self.hand or self.next_timer or self.match.phase != "playing":
            return
        if len(self.eligible()) >= 2:
            self.next_timer = self.later(delay, self.start_hand)
            self.push()

    # ------------------------------------------------------------- a hand
    def start_hand(self):
        self.next_timer = None
        if self.hand or self.match.phase != "playing":
            return
        idx = self.eligible()
        if len(idx) < 2:
            self.push()
            return
        self.hand_no += 1
        self.button = next((i for i in idx if i > self.button), idx[0])
        b = idx.index(self.button)
        order_idx = idx[b + 1:] + idx[:b + 1]
        deck = new_deck()
        players = {}
        for i in order_idx:
            u = self.seats[i]
            players[u] = {"seat": i, "cards": [deck.pop(), deck.pop()], "bet": 0, "total": 0,
                          "folded": False, "allin": False, "acted": False, "last": ""}
        order = [self.seats[i] for i in order_idx]
        self.hand = {"players": players, "order": order, "deck": deck, "board": [], "street": "preflop",
                     "current": 0, "min_raise": self.bb, "to_act": None, "deadline": 0, "over": False,
                     "winners": [], "shown": False}
        sb_u, bb_u = (order[1], order[0]) if len(order) == 2 else (order[0], order[1])
        self.commit(sb_u, self.sb)
        players[sb_u]["last"] = f"Small blind {self.sb}"
        self.commit(bb_u, self.bb)
        players[bb_u]["last"] = f"Big blind {self.bb}"
        self.hand["current"] = max(p["bet"] for p in players.values())
        first = self.next_from(bb_u, lambda q: not q["folded"] and not q["allin"])
        if first is None or len([u for u in order if not players[u]["allin"]]) < 2 and self.everyone_matched():
            self.push()
            self.later(1.2, self.next_street)
        else:
            self.set_turn(first)
        self.match.push_scores()
        self.push()

    def everyone_matched(self):
        h = self.hand
        return all(p["folded"] or p["allin"] or p["bet"] >= h["current"] for p in h["players"].values())

    def commit(self, uid, amount):
        p = self.hand["players"][uid]
        amount = max(0, min(int(amount), self.match.coins(uid)))
        self.match.take(uid, amount)
        p["bet"] += amount
        p["total"] += amount
        if self.match.coins(uid) == 0:
            p["allin"] = True
        return amount

    def next_from(self, after, pred):
        order = self.hand["order"]
        start = order.index(after) if after in order else -1
        for k in range(1, len(order) + 1):
            u = order[(start + k) % len(order)]
            if pred(self.hand["players"][u]):
                return u
        return None

    def set_turn(self, uid):
        h = self.hand
        h["to_act"] = uid
        h["deadline"] = time.time() + TURN
        self.cancel(self.turn_timer)
        self.turn_timer = self.later(TURN, self.timeout, self.hand_no, uid)
        if uid in self.away or not self.online(uid):
            self.later(0.8, self.auto_act, self.hand_no, uid)

    def timeout(self, hand_no, uid):
        if self.hand and self.hand_no == hand_no and self.hand["to_act"] == uid and not self.hand["over"]:
            self.toast(uid, "⏰ Time's up — auto-acted for you.", True)
            self.auto_act(hand_no, uid)

    def auto_act(self, hand_no, uid):
        h = self.hand
        if not h or self.hand_no != hand_no or h["to_act"] != uid or h["over"]:
            return
        p = h["players"][uid]
        self.act(uid, "check" if h["current"] - p["bet"] <= 0 else "fold", None)

    def fold(self, uid):
        h = self.hand
        p = h["players"][uid]
        p["folded"] = True
        p["last"] = "Fold"
        if h["to_act"] == uid:
            p["acted"] = True
            self.cancel(self.turn_timer)
            self.advance(uid)
        else:
            active = [u for u in h["order"] if not h["players"][u]["folded"]]
            if len(active) == 1:
                self.win_by_fold(active[0])
            else:
                self.push()

    def act(self, uid, action, amount):
        h = self.hand
        if not h or h["over"] or h["to_act"] != uid:
            return
        p = h["players"][uid]
        to_call = h["current"] - p["bet"]
        coins = self.match.coins(uid)
        if action == "fold":
            return self.fold(uid)
        if action == "check":
            if to_call > 0:
                self.toast(uid, "You can't check — call, raise or fold.", True)
                return
            p["last"] = "Check"
        elif action == "call":
            if to_call <= 0:
                p["last"] = "Check"
            else:
                put = self.commit(uid, to_call)
                p["last"] = "All-in" if p["allin"] else f"Call {put}"
        else:
            max_to = p["bet"] + coins
            target = max_to if action == "allin" else int(num(amount, 0, 0, 10 ** 12))
            target = min(target, max_to)
            if target <= h["current"]:
                return self.act(uid, "call", None)
            min_to = h["current"] + h["min_raise"]
            if target < min_to and target < max_to:
                self.toast(uid, f"The minimum raise is to {min_to}.", True)
                return
            self.commit(uid, target - p["bet"])
            raised_by = p["bet"] - h["current"]
            h["min_raise"] = max(h["min_raise"], raised_by)
            h["current"] = p["bet"]
            for u, q in h["players"].items():
                if u != uid and not q["folded"] and not q["allin"]:
                    q["acted"] = False
            p["last"] = "All-in!" if p["allin"] else f"Raise to {p['bet']}"
        p["acted"] = True
        self.cancel(self.turn_timer)
        self.match.push_scores()
        self.advance(uid)

    def advance(self, last):
        h = self.hand
        active = [u for u in h["order"] if not h["players"][u]["folded"]]
        if len(active) == 1:
            return self.win_by_fold(active[0])

        def needs(q):
            return not q["folded"] and not q["allin"] and (not q["acted"] or q["bet"] < h["current"])

        nxt = self.next_from(last, needs)
        if nxt is None:
            return self.next_street()
        self.set_turn(nxt)
        self.push()

    def next_street(self):
        h = self.hand
        if not h or h["over"]:
            return
        for q in h["players"].values():
            q["bet"] = 0
            q["acted"] = False
        h["current"] = 0
        h["min_raise"] = self.bb
        h["to_act"] = None
        i = STREETS.index(h["street"]) if h["street"] in STREETS else 3
        if i >= 3:
            return self.showdown()
        h["street"] = STREETS[i + 1]
        deck = h["deck"]
        h["board"] += [deck.pop() for _ in range(3 if h["street"] == "flop" else 1)]
        can_act = [u for u in h["order"] if not h["players"][u]["folded"] and not h["players"][u]["allin"]]
        if len(can_act) <= 1:
            self.push()
            self.later(1.4, self.next_street)
            return
        first = self.next_from(h["order"][-1], lambda q: not q["folded"] and not q["allin"])
        self.set_turn(first)
        self.push()

    def win_by_fold(self, uid):
        h = self.hand
        pot = sum(q["total"] for q in h["players"].values())
        self.finish([{"uid": uid, "amount": pot, "hand": None}], showdown=False)

    def showdown(self):
        h = self.hand
        h["street"] = "showdown"
        active = [u for u in h["order"] if not h["players"][u]["folded"]]
        scores = {u: best_hand(h["players"][u]["cards"] + h["board"]) for u in active}
        contribs = {u: q["total"] for u, q in h["players"].items()}
        levels = sorted({v for v in contribs.values() if v > 0})
        prev = 0
        awards = {}
        for lvl in levels:
            amount = sum(min(c, lvl) - min(c, prev) for c in contribs.values())
            prev = lvl
            eligible = [u for u in active if contribs[u] >= lvl] or active
            best = max(scores[u][0] for u in eligible)
            winners = [u for u in h["order"] if u in eligible and scores[u][0] == best]
            share, rem = divmod(amount, len(winners))
            for k, w in enumerate(winners):
                awards[w] = awards.get(w, 0) + share + (rem if k == 0 else 0)
        h["hands"] = {u: hand_name(scores[u][0]) for u in active}
        self.finish([{"uid": u, "amount": a, "hand": hand_name(scores[u][0]), "best": scores[u][1]}
                     for u, a in awards.items() if a > 0], showdown=True)

    def finish(self, winners, showdown):
        h = self.hand
        h["over"] = True
        h["to_act"] = None
        h["shown"] = showdown
        self.cancel(self.turn_timer)
        for w in winners:
            self.match.give(w["uid"], w["amount"])
        h["winners"] = winners
        for u, q in h["players"].items():
            back = sum(w["amount"] for w in winners if w["uid"] == u)
            self.match.record(u, self, q["total"], back)
        self.push()
        self.match.push_scores()
        self.match.round_done(self)
        self.later(SHOWDOWN, self.clear_hand)

    def clear_hand(self):
        self.hand = None
        for u in list(self.leaving):
            if u in self.seats:
                self.seats[self.seats.index(u)] = None
        self.leaving.clear()
        for i, u in enumerate(self.seats):
            if not u:
                continue
            p = self.match.players.get(u)
            if not p or p["out"] or p["coins"] < self.bb:
                self.seats[i] = None
                self.toast(u, "You can't cover the big blind, so you left the poker table. 🪑", True)
        self.push()
        self.maybe_start(2)

    def abort(self):
        super().abort()
        h = self.hand
        if h and not h["over"]:
            for u, q in h["players"].items():
                self.match.give(u, q["total"])
        self.hand = None
        self.next_timer = None

    # ------------------------------------------------------------- state
    def state_for(self, uid):
        h = self.hand
        seats = []
        for i, u in enumerate(self.seats):
            if not u:
                seats.append(None)
                continue
            pp = self.match.players.get(u, {})
            e = {"id": u, "name": self.name(u), "coins": pp.get("coins", 0), "away": u in self.away,
                 "button": i == self.button and bool(h)}
            if h and u in h["players"]:
                q = h["players"][u]
                show = u == uid or (h["over"] and h["shown"] and not q["folded"])
                e.update(inHand=True, bet=q["bet"], total=q["total"], folded=q["folded"], allin=q["allin"],
                         last=q["last"], cards=q["cards"] if show else ([] if q["folded"] else ["??", "??"]),
                         handName=h.get("hands", {}).get(u) if h["over"] and h["shown"] else None)
            seats.append(e)
        hand = None
        if h:
            me = h["players"].get(uid)
            opts = None
            if me and h["to_act"] == uid and not h["over"]:
                coins = self.match.coins(uid)
                to_call = h["current"] - me["bet"]
                opts = {"toCall": max(0, min(to_call, coins)), "canCheck": to_call <= 0,
                        "minRaiseTo": min(h["current"] + h["min_raise"], me["bet"] + coins),
                        "maxRaiseTo": me["bet"] + coins, "current": h["current"], "myBet": me["bet"]}
            hand = {"no": self.hand_no, "board": h["board"], "street": h["street"],
                    "pot": sum(q["total"] for q in h["players"].values()), "current": h["current"],
                    "toAct": h["to_act"], "turnLeft": max(0, round(h["deadline"] - time.time(), 1)) if h["to_act"] else None,
                    "over": h["over"], "opts": opts,
                    "winners": [{"uid": w["uid"], "name": self.name(w["uid"]), "amount": w["amount"], "hand": w.get("hand"),
                                 "best": w.get("best")} for w in h["winners"]]}
        return {"seats": seats, "hand": hand, "sb": self.sb, "bb": self.bb, "seated": uid in self.seats,
                "turn": TURN, "starting": bool(self.next_timer)}
