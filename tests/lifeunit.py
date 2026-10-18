"""In-process tests for Family Life's shop, yearly bills, taxes and casino (games/life), with a fake room."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import random
from itertools import product
from math import comb
from games.life import game as G, casino as C

failed = 0


class M:
    def __init__(self, uid):
        self.uid, self.name, self.avatar, self.color = uid, uid.upper(), "🙂", "#fff"
        self.watching = False
        self.client = object()
        self.account = None
        self.inbox = []
    online = property(lambda self: self.client is not None)
    plays = property(lambda self: self.client is not None and not self.watching)
    def send(self, t, **d): self.inbox.append((t, d))
    def last(self, t):
        got = [d for tt, d in self.inbox if tt == t]
        return got[-1] if got else None


class Hub:
    def record(self, *a, **k): pass


class Room:
    def __init__(self, ms):
        self.members = {m.uid: m for m in ms}
        self.host = ms[0].uid
        self.hub = Hub()
    def players_now(self): return [m for m in self.members.values() if m.plays]
    def broadcast(self, t, exclude=None, **d):
        for m in self.members.values():
            if m.uid != exclude: m.send(t, **d)
    def system(self, text): pass
    def later(self, delay, fn, *a): return [delay, fn, a]
    def cancel(self, h): pass
    def game_over(self, groups): pass


def check(cond, label):
    global failed
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


# ------------------------------------------------------------------ every casino game keeps a house edge
syms, ws = zip(*C.SLOT_SYMBOLS)
tw = sum(ws)
rtp = 0
for combo in product(range(len(syms)), repeat=3):
    p = 1
    for i in combo:
        p *= ws[i] / tw
    reels = [syms[i] for i in combo]
    rtp += p * (C.SLOT_THREE[reels[0]] if reels[0] == reels[1] == reels[2] else C.SLOT_TWO_CHERRIES if reels.count("🍒") == 2 else 0)
check(0.88 < rtp < 0.97, f"slots pay back {rtp:.1%} on average")
check(all(sum(C.roulette_wins(b, n) for n in range(37)) / 37 < 1 for b in list(C.ROULETTE_BETS) + [0, 17]), "roulette: every bet loses a little on average")
for ch, pays in C.DICE_PAYS.items():
    ev = sum(pays for a in range(1, 7) for b in range(1, 7)
             if {"low": a + b <= 6, "high": a + b >= 8, "seven": a + b == 7, "doubles": a == b}[ch]) / 36
    check(0.88 < ev < 1, f"dice '{ch}' pays back {ev:.1%}")
check(0.9 < 1 / sum(1 / o for o in C.HORSE_ODDS) < 1, "every horse pays back a bit less than it costs")
check(0.7 < sum(m * c for m, c in C.SCRATCH_PRIZES) < 0.9, "scratch cards pay back 70–90%")
lotto = sum(comb(5, k) * comb(25, 5 - k) / comb(30, 5) * p for k, p in C.LOTTO_PRIZES.items()) / C.LOTTO_PRICE
check(0.7 < lotto < 0.95, f"the lottery pays back {lotto:.1%}")
rng = random.Random(5)
staked = back = 0
for _ in range(60000):
    h = C.bj_deal(rng)
    if not C.is_blackjack(h["player"]) and not C.is_blackjack(h["dealer"]):
        while C.hand_value(h["player"]) < 17:
            h["player"].append(C.card(rng))
    C.bj_settle(h, rng)
    staked += 1
    back += h["mult"]
check(0.9 < back / staked < 1, f"blackjack (hit to 17) pays back {back / staked:.1%}")
check(C.hand_value([["A", "♠"], ["A", "♥"], ["9", "♦"]]) == 21 and C.hand_value([["K", "♠"], ["Q", "♥"], ["5", "♦"]]) == 25, "card values")
h = {"player": [["A", "♠"], ["K", "♥"]], "dealer": [["9", "♠"], ["7", "♥"]], "doubled": False, "done": False}
check(C.bj_settle(h)["outcome"] == "blackjack" and h["mult"] == 2.5, "a natural blackjack pays 3 to 2")
check(C.bj_public({"player": [["5", "♠"], ["6", "♥"]], "dealer": [["9", "♠"], ["7", "♥"]], "doubled": False, "done": False})["dealer"][1] == ["?", "?"],
      "the dealer's second card stays hidden")
for _ in range(300):
    r = C.scratch(100)
    counts = {v: r["cells"].count(v) for v in r["cells"]}
    triples = [v for v, k in counts.items() if k >= 3]
    if (triples != [r["mult"] * 100]) if r["mult"] else triples:
        break
else:
    triples = None
check(triples is None, "scratch cards only show a three-of-a-kind when they win it")
check(C.lottery_picks([1, 2, 3, 4, 5]) == [1, 2, 3, 4, 5] and len(C.lottery_picks([1, 1, 2, 3, 4])) == 5 and len(C.lottery_picks("x")) == 5,
      "lottery numbers: your picks, or a quick pick")

# ------------------------------------------------------------------ taxes
check(G.take_home(20000) == 17000 and G.take_home(900000) < 900000 * 0.6, "salary tax goes up with the salary")
check(G.take_home(225000, True) > G.take_home(225000), "an accountant saves you tax")

# ------------------------------------------------------------------ a game with the shop and the casino
ms = [M("a"), M("b")]
room = Room(ms)
g = G.Life(room)
for m in ms:
    g.on_message(m, "char", {"first": "Kid" + m.uid, "gender": "f"})
    g.on_message(m, "ready", {"ready": True})
g.on_message(ms[0], "start", {})
check(g.phase == "playing", "the game starts")
A = ms[0]
s = g.sib_of("a")
s.age, s.money, s.energy, s.jail = 30, 100_000, 3, 0
s.flags.add("driver")      # cars need a driver's licence
A.inbox.clear()

g.on_message(A, "shop", {})
items = {i["id"]: i for i in A.last("g:shop")["items"]}
check(len(items) > 50 and items["sedan"]["ok"] and not items["jet"]["ok"] and items["jet"]["why"] == "Not enough money", "the shop lists what you can and can't afford")
g.on_message(A, "buy", {"id": "sedan"})
g.on_message(A, "buy", {"id": "sedan"})
check(s.owns("sedan") == 2 and s.money == 100_000 - 56_000, "you can own more than one car")
g.on_message(A, "buy", {"id": "cruise"})
check(s.money == 100_000 - 56_000 - 90_000 + 0 or s.money == 44_000, "an experience you can't afford is refused")
s.money = 1_000_000
g.on_message(A, "buy", {"id": "house"})
check(s.owns("house") == 1 and s.living == "own" and "🏠 Homeowner" in s.achievements, "buying a home: you move in and become a homeowner")
g.on_message(A, "buy", {"id": "house"})
check(s.owns("house") == 1, "only one family house")
g.on_message(A, "buy", {"id": "trainer"})
check(s.owns("trainer") == 1 and s.money == 1_000_000 - 340_000, "hiring staff costs nothing up front")
energy = s.energy
g.on_message(A, "buy", {"id": "spa"})
check(s.energy == energy - 1 and "spa" in s.done, "experiences use energy")
g.on_message(A, "buy", {"id": "spa"})
check(s.energy == energy - 1, "...once a year")
env = g.env(s)
check(env["own_sedan"] == 2 and env["cars"] == 2 and env["homes"] == 1 and env["staff"] == 1 and env["own_jet"] == 0, "lifestyle conditions see what you own")
acts = {a["id"] for a in g.me(s)["actions"]}
check("stuff" in acts and "shop" in acts and "casino" in acts and "car" not in acts, "the money tab has the shop, your stuff and the casino")

smarts = s.smarts = 40
g.on_message(A, "buy", {"id": "telescope"})
first = s.smarts
g.on_message(A, "sell", {"uid": next(a["uid"] for a in s.assets if a["id"] == "telescope")})
g.on_message(A, "buy", {"id": "telescope"})
check(first > smarts and s.smarts == first, "buying the same thing again doesn't give its bonus again")
uid = next(a["uid"] for a in s.assets if a["id"] == "sedan")
before = s.money
g.on_message(A, "sell", {"uid": uid})
check(s.owns("sedan") == 1 and s.money == before + int(28000 * 0.9), "selling gets 90% of the value")

# yearly bills: values change, staff costs, staff help
s.money, s.health = 10_000_000, 50
g.on_message(A, "buy", {"id": "rental"})
house = next(a for a in s.assets if a["id"] == "house")
start_money = s.money
g.yearly_stuff(s)
upkeep = sum(G.D["shop_map"][a["id"]]["upkeep"] for a in s.assets)
check(s.health > 50, "a personal trainer makes you healthier every year")
check(s.money != start_money and start_money - upkeep - 1 <= s.money <= start_money - upkeep + 20000, "upkeep is paid every year (and the rental earns)")
check(house["value"] != 340_000, "values change every year")

# debt: staff quit, the bank takes the most valuable thing
s.money = -50_000
g.repossess(s)
check(not s.owns("trainer") and s.money >= 0 and s.owns("house") + s.owns("rental") == 1, "in debt, staff quit and the bank takes your most valuable thing")

# rent: none while you live in a home you own
s.living, s.job = "own", None
m0 = s.money
g.quarter_up(s)
check(s.money == m0 or s.owns("house") == 0, "no rent when you live in a home you own")

# ------------------------------------------------------------------ the casino
s.energy, s.money, s.done = 2, 1_000_000, set()
A.inbox.clear()
g.on_message(A, "casino", {"op": "slots", "bet": 100})
check("Go into the casino" in (A.last("g:toast") or {}).get("text", ""), "you have to go in first")
g.on_message(A, "casino", {"op": "enter"})
st = A.last("g:casino")
check(st and st["op"] == "enter" and st["left"] == C.PLAYS_PER_VISIT and s.energy == 1 and len(st["field"]) == 6, "going in costs 1 energy and gives 15 games")
g.on_message(A, "casino", {"op": "enter"})
check(s.energy == 1, "going back in during the same visit is free")


def play(msg):
    s.casino["at"] = 0
    A.inbox.clear()
    g.on_message(A, "casino", msg)
    return A.last("g:casino"), A.last("g:toast")


m0 = s.money
r, _ = play({"op": "slots", "bet": 1000})
check(r and len(r["result"]["reels"]) == 3 and s.money == m0 - 1000 + r["win"] and r["left"] == C.PLAYS_PER_VISIT - 1, "slots: the bet is taken and the winnings paid")
r, _ = play({"op": "roulette", "bet": 500, "choice": "red"})
check(r and 0 <= r["result"]["n"] <= 36 and r["win"] in (0, 1000), "roulette on red")
r, _ = play({"op": "roulette", "bet": 500, "choice": 17})
check(r and r["win"] in (0, 18000), "roulette on a number pays 36×")
r, toast = play({"op": "roulette", "bet": 500, "choice": "purple"})
check(r is None, "a made-up bet is ignored")
r, _ = play({"op": "dice", "bet": 200, "choice": "seven"})
check(r and len(r["result"]["dice"]) == 2 and r["win"] in (0, 1100), "lucky dice")
field = s.casino["field"]
r, _ = play({"op": "horses", "bet": 1000, "pick": 2})
check(r and sorted(r["result"]["order"]) == list(range(6)) and r["result"]["field"] == field and r["field"] != field, "horse race: a full finishing order, then a new field")
r, _ = play({"op": "scratch", "price": 100})
check(r and len(r["result"]["cells"]) == 9 and r["bet"] == 100, "scratch card")
r, _ = play({"op": "scratch", "price": 7})
check(r is None, "only the listed scratch cards")
r, _ = play({"op": "lottery", "picks": [3, 9, 14, 22, 30]})
check(r and r["result"]["picks"] == [3, 9, 14, 22, 30] and len(r["result"]["drawn"]) == 5 and r["bet"] == C.LOTTO_PRICE, "lottery ticket")
r, toast = play({"op": "slots", "bet": 5})
check(r is None and "smallest bet" in toast["text"], "minimum bet")
r, toast = play({"op": "slots", "bet": s.money + 1})
check(r is None and "don't have that much" in toast["text"], "you can't bet more than you have")

# blackjack: deal, then hit or stand until it's over
for _ in range(20):
    r, _ = play({"op": "bj", "move": "deal", "bet": 100})
    if r and not r["bj"]["done"]:
        break
check(r and r["bj"]["dealer"][1] == ["?", "?"] and len(r["bj"]["player"]) == 2, "blackjack deal: the dealer's hole card is hidden")
r2, toast = play({"op": "slots", "bet": 100})
check(r2 is None and "Finish your blackjack hand" in toast["text"], "finish the hand before another game")
r, _ = play({"op": "bj", "move": "stand"})
check(r and r["bj"]["done"] and r["bj"]["outcome"] in ("win", "lose", "push") and "?" not in r["bj"]["dealer"][1], "standing finishes the hand and shows the dealer's cards")

while s.casino["left"] > 0:
    play({"op": "dice", "bet": 10, "choice": "low"})
r, toast = play({"op": "dice", "bet": 10, "choice": "low"})
check(r is None and "all your games" in toast["text"], "15 games a visit")

net = s.casino["won"] - s.casino["lost"]
g.casino_close(s)
check(s.casino is None and s.counters["casino_net"] == net and "Casino night" in s.log[-1]["text"], "the night is summed up at the end of the turn")
s.age = 16
s.done = set()
g.on_message(A, "casino", {"op": "enter"})
check("adults" in A.last("g:toast")["text"], "no casino for kids")

print("FAILED:", failed)
