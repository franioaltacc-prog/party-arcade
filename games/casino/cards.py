"""Cards, dice and hand evaluation. All randomness uses SystemRandom so
results can't be predicted by players."""
import itertools
import random

RNG = random.SystemRandom()
SUITS = "♠♥♦♣"
RANKS = "23456789TJQKA"
HAND_NAMES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush",
              "Full house", "Four of a kind", "Straight flush"]


def new_deck(decks=1):
    cards = [r + s for r in RANKS for s in SUITS] * decks
    RNG.shuffle(cards)
    return cards


def rank_value(card):
    return RANKS.index(card[0]) + 2


def roll_die():
    return RNG.randint(1, 6)


# ---------------------------------------------------------------- blackjack
def bj_total(cards):
    """Returns (total, soft) for a blackjack hand."""
    total, aces = 0, 0
    for c in cards:
        r = c[0]
        if r == "A":
            aces += 1
            total += 11
        elif r in "TJQK":
            total += 10
        else:
            total += int(r)
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total, aces > 0


def is_blackjack(cards):
    return len(cards) == 2 and bj_total(cards)[0] == 21


# ---------------------------------------------------------------- poker
def _eval5(cards):
    ranks = sorted((rank_value(c) for c in cards), reverse=True)
    suits = [c[1] for c in cards]
    flush = len(set(suits)) == 1
    uniq = sorted(set(ranks), reverse=True)
    straight_high = 0
    if len(uniq) == 5:
        if uniq[0] - uniq[4] == 4:
            straight_high = uniq[0]
        elif uniq == [14, 5, 4, 3, 2]:
            straight_high = 5
    counts = sorted(((ranks.count(r), r) for r in uniq), reverse=True)
    if straight_high and flush:
        return (8, straight_high)
    if counts[0][0] == 4:
        return (7, counts[0][1], counts[1][1])
    if counts[0][0] == 3 and counts[1][0] == 2:
        return (6, counts[0][1], counts[1][1])
    if flush:
        return (5, *ranks)
    if straight_high:
        return (4, straight_high)
    if counts[0][0] == 3:
        return (3, counts[0][1], *[r for c, r in counts[1:]])
    if counts[0][0] == 2 and counts[1][0] == 2:
        return (2, counts[0][1], counts[1][1], counts[2][1])
    if counts[0][0] == 2:
        return (1, counts[0][1], *[r for c, r in counts[1:]])
    return (0, *ranks)


def best_hand(cards):
    """Best 5-card score from 5-7 cards. Returns (score_tuple, best_five)."""
    best = None
    for combo in itertools.combinations(cards, 5):
        score = _eval5(combo)
        if best is None or score > best[0]:
            best = (score, list(combo))
    return best


def hand_name(score):
    return HAND_NAMES[score[0]]
