from .cards import RNG
from .tables import RoundTable, register

RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
# European wheel order (for the animation on the client)
WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9,
         22, 18, 29, 7, 28, 12, 35, 3, 26]
OUTSIDE = {"red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3"}


@register
class Roulette(RoundTable):
    key = "roulette"
    title = "Roulette"
    emoji = "🎡"
    blurb = "Everyone bets, one shared spin. Numbers pay 35×!"
    order = 10
    bet_window = 15
    anim = 7
    result_pause = 5

    def valid_bet(self, kind, value):
        if kind == "number":
            if isinstance(value, int) and 0 <= value <= 36:
                return value
            return None
        if kind in OUTSIDE:
            return kind
        return None

    def roll(self):
        n = RNG.randint(0, 36)
        return {"number": n, "color": "green" if n == 0 else ("red" if n in RED else "black")}

    def multiplier(self, bet, result):
        n = result["number"]
        k = bet["kind"]
        if k == "number":
            return 36 if bet["value"] == n else 0
        if n == 0:
            return 0
        wins = {
            "red": n in RED, "black": n not in RED, "odd": n % 2 == 1, "even": n % 2 == 0,
            "low": n <= 18, "high": n >= 19,
            "dozen1": n <= 12, "dozen2": 13 <= n <= 24, "dozen3": n >= 25,
        }
        if not wins.get(k):
            return 0
        return 3 if k.startswith("dozen") else 2
