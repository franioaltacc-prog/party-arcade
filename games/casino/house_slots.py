import time

from .cards import RNG
from .tables import HouseTable, register

SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"]
WEIGHTS = [5, 4, 3, 2, 1.2, 0.8]
THREE = {"🍒": 6, "🍋": 10, "🔔": 20, "⭐": 40, "💎": 100, "7️⃣": 250}
TWO_CHERRIES = 1.5


@register
class Slots(HouseTable):
    key = "slots"
    title = "Slots"
    emoji = "🎰"
    blurb = "Your own machine. Quick spins, big jackpots."
    personal = True
    order = 40

    def __init__(self, match):
        super().__init__(match)
        self.last = {}
        self.busy = {}
        self.pending = {}

    def stake_of(self, uid):
        return self.pending.get(uid, 0)

    def abort(self):
        super().abort()
        for uid, amount in self.pending.items():
            self.match.give(uid, amount)
        self.pending = {}

    def paytable(self):
        rows = [{"combo": [s, s, s], "mult": m} for s, m in sorted(THREE.items(), key=lambda kv: -kv[1])]
        rows.append({"combo": ["🍒", "🍒", "❔"], "mult": TWO_CHERRIES})
        return rows

    def state_for(self, uid):
        return {"last": self.last.get(uid), "paytable": self.paytable()}

    def summary(self):
        return "Your own machine"

    def on_message(self, uid, action, msg):
        if action != "spin":
            return
        now = time.time()
        if now - self.busy.get(uid, 0) < 1.4:
            return  # one spin at a time
        ok, why, amount = self.match.check_bet(uid, msg.get("amount"))
        if not ok:
            self.toast(uid, why, True)
            return
        self.busy[uid] = now
        self.match.take(uid, amount)
        self.pending[uid] = amount
        reels = RNG.choices(SYMBOLS, weights=WEIGHTS, k=3)
        if reels[0] == reels[1] == reels[2]:
            mult = THREE[reels[0]]
        elif reels.count("🍒") == 2:
            mult = TWO_CHERRIES
        else:
            mult = 0
        win = int(amount * mult)
        result = {"reels": reels, "amount": amount, "mult": mult, "win": win, "id": int(now * 1000)}
        self.last[uid] = result
        m = self.room.members.get(uid)
        if m:
            m.send("g:slots", **result)
        # reveal after the reels stop spinning on the client
        self.later(1.3, self.finish_spin, uid, amount, win)

    def finish_spin(self, uid, amount, win):
        self.pending.pop(uid, None)
        if win:
            self.match.give(uid, win)
        self.match.record(uid, self, amount, win)
        self.match.push_scores()
