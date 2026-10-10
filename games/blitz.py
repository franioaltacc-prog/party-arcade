import random

from .base import Game, num

INTRO = 2.5         # seconds the round title card is shown before the challenge
RESULT_PAUSE = 4.5  # seconds between rounds

ODD_PAIRS = [("😀", "😃"), ("🐶", "🐱"), ("🍎", "🍅"), ("🌕", "🌝"), ("🐸", "🐢"), ("⚽", "🏀"),
             ("😺", "😸"), ("🍩", "🥯"), ("🐝", "🪲"), ("🌲", "🌳"), ("🎃", "🍊"), ("🐧", "🐦"),
             ("👻", "💀"), ("🍓", "🍒"), ("🚗", "🚕"), ("🦊", "🐯"), ("🌸", "🌺"), ("❄️", "⭐")]
COUNT_SETS = [("🍕", ["🍔", "🌭", "🍟"]), ("🐸", ["🐢", "🦎", "🐍"]), ("⭐", ["✨", "🌟", "💫"]),
              ("🦄", ["🐴", "🦓", "🐎"]), ("🍩", ["🍪", "🥯", "🧁"]), ("👾", ["🤖", "👽", "🛸"])]
COLORS = {"RED": "#f43f5e", "BLUE": "#3b82f6", "GREEN": "#22c55e", "YELLOW": "#facc15",
          "PURPLE": "#a855f7", "ORANGE": "#fb923c", "PINK": "#ec4899"}
TYPE_WORDS = ["banana", "rocket", "pickle", "galaxy", "tornado", "penguin", "waffle", "volcano",
              "zombie", "unicorn", "spaghetti", "dinosaur", "jellyfish", "pizza", "skateboard",
              "lightning", "pancake", "octopus", "marshmallow", "noodle", "astronaut", "hamster",
              "trampoline", "cactus", "dragon", "kangaroo", "popcorn", "burrito", "snowman", "wizard"]
SIMON_COLORS = ["#f43f5e", "#3b82f6", "#22c55e", "#facc15"]

ROUND_INFO = {
    "reaction": ("⚡ Reaction", "Tap the moment it turns GREEN. Too early = zero!"),
    "mash": ("👊 Button Mash", "Tap as FAST as you can for 5 seconds!"),
    "math": ("🧮 Quick Math", "Solve it. Fastest correct answer wins."),
    "odd": ("🔍 Odd One Out", "Find the emoji that is different!"),
    "color": ("🎨 Color Trap", "Tap the COLOR of the word — not what it says!"),
    "count": ("🔢 Count Fast", "Count the target emoji before it disappears!"),
    "type": ("⌨️ Speed Type", "Type the word as fast as you can!"),
    "simon": ("🧠 Memory Lights", "Watch the pattern, then repeat it!"),
}


def gen_round(kind, rnd):
    """Returns (data_for_clients, solution, time_limit_seconds)."""
    if kind == "reaction":
        delay = round(rnd.uniform(1.6, 4.8), 2)
        return {"delay": delay}, None, delay + 2.5
    if kind == "mash":
        return {"duration": 5}, None, 5.6
    if kind == "math":
        op = rnd.choice("+-x")
        if op == "+":
            a, b = rnd.randint(12, 89), rnd.randint(12, 89)
            ans = a + b
        elif op == "-":
            a, b = rnd.randint(30, 99), rnd.randint(5, 29)
            ans = a - b
        else:
            a, b = rnd.randint(3, 12), rnd.randint(3, 12)
            ans = a * b
        opts = {ans}
        while len(opts) < 4:
            opts.add(ans + rnd.choice([-10, -2, -1, 1, 2, 10, rnd.randint(-6, 6) or 3]))
        opts = list(opts)
        rnd.shuffle(opts)
        sym = {"+": "+", "-": "−", "x": "×"}[op]
        return {"q": f"{a} {sym} {b}", "options": opts}, opts.index(ans), 10
    if kind == "odd":
        base, odd = rnd.choice(ODD_PAIRS)
        if rnd.random() < 0.5:
            base, odd = odd, base
        cols = rnd.choice([6, 7, 8])
        n = cols * cols
        idx = rnd.randrange(n)
        grid = [odd if i == idx else base for i in range(n)]
        return {"grid": grid, "cols": cols}, idx, 12
    if kind == "color":
        names = list(COLORS)
        word = rnd.choice(names)
        ink = rnd.choice([c for c in names if c != word])
        opts = rnd.sample([c for c in names if c not in (word, ink)], 2) + [word, ink]
        rnd.shuffle(opts)
        return {"word": word, "ink": COLORS[ink], "options": opts,
                "palette": {k: COLORS[k] for k in opts}}, opts.index(ink), 7
    if kind == "count":
        target, others = rnd.choice(COUNT_SETS)
        count = rnd.randint(5, 13)
        total = 30
        grid = [target] * count + [rnd.choice(others) for _ in range(total - count)]
        rnd.shuffle(grid)
        opts = {count}
        while len(opts) < 4:
            opts.add(max(1, count + rnd.choice([-3, -2, -1, 1, 2, 3])))
        opts = sorted(opts)
        return {"grid": grid, "target": target, "show": 3.2, "options": opts}, opts.index(count), 10
    if kind == "type":
        word = rnd.choice(TYPE_WORDS)
        return {"word": word}, word, 12
    if kind == "simon":
        length = rnd.randint(4, 6)
        seq = [rnd.randrange(4) for _ in range(length)]
        return {"seq": seq, "colors": SIMON_COLORS, "step": 0.6}, seq, length * 0.6 + 10
    raise ValueError(kind)


class Blitz(Game):
    key = "blitz"
    max_players = 12

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"rounds": 8}
        self.scores = {}
        self.round = None
        self.round_no = 0
        self.timer = None
        self.last_kind = None
        self.final = None

    def listed(self):
        return self.phase in ("lobby", "over")

    def state_for(self, m):
        r = self.round
        return {"phase": self.phase, "settings": self.settings, "scores": self.scores,
                "round": {k: r[k] for k in ("n", "total", "kind", "title", "help", "data", "limit")} if r else None,
                "final": self.final}

    def on_message(self, m, t, msg):
        if t == "settings" and self.is_host(m) and self.phase != "playing":
            rounds = int(num(msg.get("rounds"), 8, 3, 20))
            self.settings["rounds"] = rounds
            self.broadcast("settings", settings=self.settings)
        elif t == "start" and self.is_host(m) and self.phase != "playing":
            self.start()
        elif t == "answer" and self.phase == "playing" and self.round and self.round["open"]:
            r = self.round
            if msg.get("n") != r["n"] or m.uid not in self.scores or m.uid in r["answers"]:
                return
            r["answers"][m.uid] = {"ms": int(num(msg.get("ms"), 99999, 0, 99999)), "value": msg.get("value")}
            waiting = [u for u in self.scores
                       if u not in r["answers"] and self.room.members.get(u) and self.room.members[u].online]
            if not waiting:
                self.room.cancel(self.timer)
                self.timer = self.room.later(0.6, self.end_round)

    def on_join(self, m, rejoin):
        if self.phase == "playing" and m.uid not in self.scores:
            self.scores[m.uid] = 0
            self.broadcast("scores", scores=self.scores)

    def start(self):
        self.phase = "playing"
        self.final = None
        self.tainted = False
        self.scores = {u.uid: 0 for u in self.room.online_members()}
        self.round_no = 0
        self.last_kind = None
        self.broadcast("begin", scores=self.scores, total=self.settings["rounds"])
        self.room.cancel(self.timer)
        self.timer = self.room.later(1.0, self.next_round)

    def next_round(self):
        if self.phase != "playing":
            return
        self.round_no += 1
        total = self.settings["rounds"]
        if self.round_no > total:
            return self.finish()
        kinds = [k for k in ROUND_INFO if k != self.last_kind]
        kind = random.choice(kinds)
        self.last_kind = kind
        data, solution, limit = gen_round(kind, random)
        title, help_text = ROUND_INFO[kind]
        self.round = {"n": self.round_no, "total": total, "kind": kind, "title": title, "help": help_text,
                      "data": data, "limit": limit, "solution": solution, "answers": {}, "open": True}
        self.broadcast("round", round=self.state_for(None)["round"], intro=INTRO)
        self.room.cancel(self.timer)
        self.timer = self.room.later(INTRO + limit + 1.5, self.end_round)

    def judge(self, r, a):
        kind, sol, v = r["kind"], r["solution"], a["value"]
        if kind == "reaction":
            return isinstance(v, (int, float)) and v >= 0
        if kind == "mash":
            return isinstance(v, (int, float)) and v > 0
        if kind == "type":
            return isinstance(v, str) and v.strip().lower() == sol
        if kind == "simon":
            return v == sol
        return v == sol

    def end_round(self):
        r = self.round
        if not r or not r["open"]:
            return
        r["open"] = False
        rows = []
        for uid, a in r["answers"].items():
            rows.append({"id": uid, "ms": a["ms"], "value": a["value"], "ok": self.judge(r, a), "points": 0})
        if r["kind"] == "mash":
            for row in rows:
                row["value"] = int(num(row["value"], 0, 0, 150))
            rows.sort(key=lambda x: (-x["value"], x["ms"]))
        elif r["kind"] == "reaction":
            for row in rows:
                row["ms"] = int(num(row["value"], 99999, -1, 99999)) if row["ok"] else 99999
            rows.sort(key=lambda x: (not x["ok"], x["ms"]))
        else:
            rows.sort(key=lambda x: (not x["ok"], x["ms"]))
        ladder = [100, 75, 60, 50]
        place = 0
        for row in rows:
            if row["ok"]:
                row["points"] = ladder[place] if place < len(ladder) else 40
                place += 1
                self.scores[row["id"]] = self.scores.get(row["id"], 0) + row["points"]
        self.broadcast("roundResult", n=r["n"], kind=r["kind"], results=rows,
                       solution=r["solution"], scores=self.scores)
        self.room.cancel(self.timer)
        self.timer = self.room.later(RESULT_PAUSE, self.next_round)

    def finish(self):
        self.phase = "over"
        self.round = None
        ranking = []
        for uid, pts in sorted(self.scores.items(), key=lambda kv: -kv[1]):
            mm = self.room.members.get(uid)
            ranking.append({"id": uid, "points": pts, "name": mm.name if mm else "Gone",
                            "avatar": mm.avatar if mm else "👻", "color": mm.color if mm else "#888888"})
        self.final = ranking
        self.broadcast("final", ranking=ranking)
        self.record_ranking(ranking, "blitz")

    def on_admin(self, m, action, msg):
        if self.phase != "playing":
            return None
        if action == "skip" and self.round and self.round["open"]:
            self.end_round()
            return "⏭️ Round skipped."
        if action == "points" and m.uid in self.scores:
            self.scores[m.uid] += 500
            self.broadcast("scores", scores=self.scores)
            return "💯 +500 points."
        if action == "end":
            self.room.cancel(self.timer)
            self.finish()
            return "🏁 Game ended."
        return None
