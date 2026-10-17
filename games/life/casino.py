"""Family Life casino: every game is decided here, and the browser only animates the result.

Each function takes the bet (and the player's pick) and returns a dict for the browser plus `mult`: what the
bet pays back (0 = lost, 1 = money back, 2 = doubled...). Every game keeps a house edge, so on average the
casino wins; the expected return of each game is checked in tests/lifeunit.py.
"""
import random

MIN_BET = 10
MAX_BET = 10_000_000
PLAYS_PER_VISIT = 15

# ------------------------------------------------------------------ slots (returns ~94%, three 7s = 1 in 120,000)
SLOT_SYMBOLS = [("🍒", 28), ("🍋", 22), ("🍊", 18), ("🍇", 13), ("🔔", 8), ("⭐", 5), ("💎", 3), ("7️⃣", 2)]
SLOT_THREE = {"🍒": 8, "🍋": 12, "🍊": 18, "🍇": 30, "🔔": 80, "⭐": 200, "💎": 600, "7️⃣": 3000}
SLOT_TWO_CHERRIES = 2
_SYM, _W = zip(*SLOT_SYMBOLS)


def slots(rng=random):
    reels = rng.choices(_SYM, weights=_W, k=3)
    if reels[0] == reels[1] == reels[2]:
        mult = SLOT_THREE[reels[0]]
    elif reels.count("🍒") == 2:
        mult = SLOT_TWO_CHERRIES
    else:
        mult = 0
    return {"reels": reels, "mult": mult, "jackpot": reels == ["7️⃣"] * 3}


# ------------------------------------------------------------------ roulette (European: returns 97.3%)
WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22,
         18, 29, 7, 28, 12, 35, 3, 26]
REDS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
ROULETTE_BETS = ("red", "black", "odd", "even", "low", "high", "zero")


def color_of(n):
    return "green" if n == 0 else "red" if n in REDS else "black"


def roulette_wins(choice, n):
    if isinstance(choice, int):
        return 36 if choice == n else 0
    if n == 0:
        return 36 if choice == "zero" else 0
    ok = {"red": n in REDS, "black": n not in REDS, "odd": n % 2 == 1, "even": n % 2 == 0,
          "low": n <= 18, "high": n >= 19, "zero": False}[choice]
    return 2 if ok else 0


def roulette(choice, rng=random):
    n = rng.randrange(37)
    return {"n": n, "color": color_of(n), "slot": WHEEL.index(n), "mult": roulette_wins(choice, n)}


def roulette_choice(v):
    """'red'... or a number 0-36; None if it isn't a bet."""
    if isinstance(v, str) and v in ROULETTE_BETS:
        return v
    if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 36:
        return v
    return None


# ------------------------------------------------------------------ lucky dice (returns 92-96%)
DICE_PAYS = {"low": 2.3, "high": 2.3, "seven": 5.5, "doubles": 5.5}


def dice(choice, rng=random):
    a, b = rng.randint(1, 6), rng.randint(1, 6)
    total = a + b
    ok = {"low": total <= 6, "high": total >= 8, "seven": total == 7, "doubles": a == b}[choice]
    return {"dice": [a, b], "total": total, "mult": DICE_PAYS[choice] if ok else 0}


# ------------------------------------------------------------------ horse racing (returns ~94%)
HORSE_NAMES = ["Thunder Hooves", "Lucky Biscuit", "Midnight Express", "Sir Gallops-a-Lot", "Pickle Rick", "Glitter Bomb",
               "Rocket Sauce", "Noodle Legs", "Disco Danny", "Hay Girl", "Neigh Sayer", "Usain Colt", "Mane Event",
               "Holy Cow", "Turbo Turnip", "Princess Sprinkles", "Big Chungus", "Cinnamon Roll"]
HORSE_ODDS = [2.5, 4, 5.5, 8, 14, 30]       # what a winning bet pays back on each horse
HORSE_COLORS = ["#f43f5e", "#3b82f6", "#facc15", "#22c55e", "#a855f7", "#fb923c"]


def horse_field(rng=random):
    names = rng.sample(HORSE_NAMES, len(HORSE_ODDS))
    odds = HORSE_ODDS[:]
    rng.shuffle(odds)
    return [{"name": n, "odds": o, "color": HORSE_COLORS[i]} for i, (n, o) in enumerate(zip(names, odds))]


def horse_race(field, pick, rng=random):
    """The finishing order (lane numbers): each horse wins with a chance a bit below its odds."""
    left = list(range(len(field)))
    order = []
    while left:
        i = rng.choices(left, weights=[1 / field[j]["odds"] for j in left])[0]
        order.append(i)
        left.remove(i)
    return {"order": order, "winner": order[0], "mult": field[pick]["odds"] if order[0] == pick else 0}


# ------------------------------------------------------------------ scratch cards (returns ~80%)
SCRATCH_PRICES = [10, 100, 1000, 10000]
SCRATCH_PRIZES = [(1, 0.12), (2, 0.07), (5, 0.025), (20, 0.006), (100, 0.001), (5000, 0.00004)]   # (× price, chance)


def scratch(price, rng=random):
    """A 3×3 card of prize amounts: three of the same amount wins it."""
    roll, prize = rng.random(), 0
    for mult, chance in reversed(SCRATCH_PRIZES):
        if roll < chance:
            prize = mult
            break
        roll -= chance
    values = [m for m, _ in SCRATCH_PRIZES]
    cells = [prize] * 3 if prize else []
    counts = {v: cells.count(v) for v in values}
    while len(cells) < 9:          # fill up with amounts that can't make another three of a kind
        v = rng.choice(values)
        if counts[v] < 2 and v != prize:
            cells.append(v)
            counts[v] += 1
    rng.shuffle(cells)
    return {"cells": [c * price for c in cells], "mult": prize, "price": price}


# ------------------------------------------------------------------ lottery (returns ~83%)
LOTTO_PRICE = 20
LOTTO_POOL = 30
LOTTO_PRIZES = {5: 2_000_000, 4: 1_000, 3: 50, 2: 5}


def lottery(picks, rng=random):
    drawn = rng.sample(range(1, LOTTO_POOL + 1), 5)
    hits = len(set(picks) & set(drawn))
    prize = LOTTO_PRIZES.get(hits, 0)
    return {"drawn": drawn, "picks": picks, "hits": hits, "prize": prize, "mult": prize / LOTTO_PRICE}


def lottery_picks(v, rng=random):
    """5 different numbers from 1-30, or a quick pick."""
    if isinstance(v, list) and len(v) == 5 and all(isinstance(x, int) and not isinstance(x, bool) and 1 <= x <= LOTTO_POOL for x in v) \
            and len(set(v)) == 5:
        return sorted(v)
    return sorted(rng.sample(range(1, LOTTO_POOL + 1), 5))


# ------------------------------------------------------------------ blackjack (returns ~99% with good play)
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUITS = ["♠", "♥", "♦", "♣"]


def card(rng=random):
    return [rng.choice(RANKS), rng.choice(SUITS)]


def hand_value(cards):
    total, aces = 0, 0
    for rank, _ in cards:
        if rank == "A":
            aces += 1
            total += 11
        else:
            total += 10 if rank in ("J", "Q", "K") else int(rank)
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def is_blackjack(cards):
    return len(cards) == 2 and hand_value(cards) == 21


def bj_deal(rng=random):
    return {"player": [card(rng), card(rng)], "dealer": [card(rng), card(rng)], "doubled": False, "done": False}


def bj_settle(h, rng=random):
    """Finish the hand: the dealer draws to 17 (standing on soft 17). Sets h['mult'] and h['outcome']."""
    p = hand_value(h["player"])
    if p > 21:
        h.update(done=True, mult=0, outcome="bust")
        return h
    if is_blackjack(h["player"]):
        if is_blackjack(h["dealer"]):
            h.update(done=True, mult=1, outcome="push")
        else:
            h.update(done=True, mult=2.5, outcome="blackjack")
        return h
    if not is_blackjack(h["dealer"]):
        while hand_value(h["dealer"]) < 17:
            h["dealer"].append(card(rng))
    d = hand_value(h["dealer"])
    if is_blackjack(h["dealer"]) or (d <= 21 and d > p):
        h.update(done=True, mult=0, outcome="lose")
    elif d > 21 or p > d:
        h.update(done=True, mult=2, outcome="win")
    else:
        h.update(done=True, mult=1, outcome="push")
    return h


def bj_public(h):
    """What the player may see: the dealer's second card stays face down until the hand is over."""
    dealer = h["dealer"] if h["done"] else [h["dealer"][0], ["?", "?"]]
    out = {"player": h["player"], "dealer": dealer, "pv": hand_value(h["player"]), "done": h["done"], "doubled": h["doubled"]}
    out["dv"] = hand_value(h["dealer"]) if h["done"] else hand_value([h["dealer"][0]])
    if h["done"]:
        out.update(outcome=h["outcome"], mult=h["mult"])
    return out
