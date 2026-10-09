from .cards import roll_die
from .tables import RoundTable, register

# total returned per coin (stake included) for an exact sum
EXACT = {2: 31, 3: 16, 4: 11, 5: 8, 6: 6, 8: 6, 9: 8, 10: 11, 11: 16, 12: 31}


@register
class Dice(RoundTable):
    key = "dice"
    title = "Lucky Dice"
    emoji = "🎲"
    blurb = "Two dice, one shared roll. High, low, lucky 7 or an exact total."
    order = 20
    bet_window = 12
    anim = 3.5
    result_pause = 4

    def valid_bet(self, kind, value):
        if kind in ("low", "high", "seven", "doubles"):
            return kind
        if kind == "sum" and isinstance(value, int) and value in EXACT:
            return value
        return None

    def roll(self):
        a, b = roll_die(), roll_die()
        return {"dice": [a, b], "total": a + b}

    def multiplier(self, bet, result):
        a, b = result["dice"]
        t = result["total"]
        k = bet["kind"]
        if k == "low":
            return 2 if t <= 6 else 0
        if k == "high":
            return 2 if t >= 8 else 0
        if k == "seven":
            return 5 if t == 7 else 0
        if k == "doubles":
            return 5 if a == b else 0
        if k == "sum":
            return EXACT.get(bet["value"], 0) if t == bet["value"] else 0
        return 0
