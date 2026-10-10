import random
import time

from .base import Game, num

WORDS = """apple banana pizza burger taco donut cookie cake icecream popcorn sandwich carrot pineapple
watermelon cheese egg bacon pancake hotdog cupcake cat dog fish bird turtle frog snake shark whale
octopus spider butterfly bee elephant giraffe lion monkey penguin rabbit horse cow pig chicken duck
owl bat dinosaur dragon unicorn robot alien ghost zombie vampire wizard pirate ninja mermaid astronaut
king queen princess superhero clown cowboy house castle tent bridge tower lighthouse school hospital
car bus train airplane rocket boat bicycle skateboard helicopter tractor submarine sun moon star cloud
rainbow lightning tornado volcano mountain island beach desert forest river waterfall snowman tree
flower cactus mushroom leaf pumpkin guitar drum piano trumpet microphone headphones camera phone laptop
television clock lamp chair bed door window key lock umbrella glasses hat crown shoe sock backpack
balloon kite gift candle book pencil scissors hammer ladder bucket toilet bathtub toothbrush soccer
basketball trophy medal dice puzzle sword shield bow treasure map compass anchor magnet bomb fire
ice snowflake skeleton tooth eye nose ear hand foot heart brain muscle sneeze yawn dance sleep swim
fishing camping birthday wedding party homework vacation selfie""".split()

DRAW_PAD = 4.0  # seconds between turns


def mask_word(word, revealed):
    return " ".join(ch if (i in revealed or not ch.isalpha()) else "_" for i, ch in enumerate(word))


def close_enough(a, b):
    """True when a is one edit away from b (typo)."""
    if abs(len(a) - len(b)) > 1 or a == b:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    if len(a) > len(b):
        a, b = b, a
    for i in range(len(b)):
        if a == b[:i] + b[i + 1:]:
            return True
    return False


class Doodle(Game):
    key = "doodle"
    max_players = 12

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"rounds": 3, "drawTime": 80}
        self.scores = {}
        self.order = []
        self.turn_idx = -1
        self.round_no = 0
        self.drawer = None
        self.word = None
        self.choices = []
        self.revealed = set()
        self.guessed = []
        self.strokes = []
        self.ends_at = 0
        self.timer = None
        self.hint_timers = []
        self.used_words = set()
        self.final = None

    def listed(self):
        return self.phase in ("lobby", "over")

    # -- state -------------------------------------------------------------
    def turn_info(self, m=None):
        info = {"drawer": self.drawer, "round": self.round_no, "rounds": self.settings["rounds"],
                "hint": mask_word(self.word, self.revealed) if self.word else None,
                "remaining": max(0, self.ends_at - time.time()) if self.phase == "drawing" else None,
                "guessed": self.guessed}
        if m is not None and self.word and (m.uid == self.drawer or m.uid in self.guessed):
            info["word"] = self.word
        if m is not None and self.phase == "choosing" and m.uid == self.drawer:
            info["choices"] = self.choices
        return info

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "scores": self.scores,
                "turn": self.turn_info(m), "strokes": self.strokes if self.phase == "drawing" else [],
                "final": self.final}

    # -- messages ----------------------------------------------------------
    def on_message(self, m, t, msg):
        if t == "settings" and self.is_host(m) and self.phase in ("lobby", "over"):
            rounds = int(num(msg.get("rounds"), 3, 1, 6))
            draw_time = int(num(msg.get("drawTime"), 80, 30, 180))
            self.settings.update(rounds=rounds, drawTime=draw_time)
            self.broadcast("settings", settings=self.settings)
        elif t == "start" and self.is_host(m) and self.phase in ("lobby", "over"):
            if len(self.room.online_members()) < 2:
                m.send("error", msg="You need at least 2 players for Doodle Guess!")
                return
            self.start()
        elif t == "pick" and self.phase == "choosing" and m.uid == self.drawer:
            i = msg.get("i")
            if isinstance(i, int) and 0 <= i < len(self.choices):
                self.begin_drawing(self.choices[i])
        elif t == "draw" and self.phase == "drawing" and m.uid == self.drawer:
            segs = msg.get("segs")
            if not isinstance(segs, list):
                return
            clean = []
            for s in segs[:200]:
                if isinstance(s, list) and len(s) == 7 and all(isinstance(v, (int, float)) for v in s):
                    clean.append([int(v) for v in s])
            if clean and len(self.strokes) < 30000:
                self.strokes.extend(clean)
                self.room.broadcast("g:draw", exclude=m.uid, segs=clean)
        elif t == "undo" and self.phase == "drawing" and m.uid == self.drawer:
            if self.strokes:
                last_id = self.strokes[-1][6]
                self.strokes = [s for s in self.strokes if s[6] != last_id]
                self.broadcast("redraw", strokes=self.strokes)
        elif t == "clear" and self.phase == "drawing" and m.uid == self.drawer:
            self.strokes = []
            self.broadcast("redraw", strokes=[])
        elif t == "guess":
            self.guess(m, msg)

    def guess(self, m, msg):
        text = " ".join(str(msg.get("text") or "").split())[:80]
        if not text:
            return
        entry = {"id": m.uid, "name": m.name, "avatar": m.avatar, "color": m.color, "text": text}
        if self.phase != "drawing" or m.uid == self.drawer or m.uid in self.guessed:
            # Drawer and players who already guessed only chat among themselves
            if self.phase == "drawing" and (m.uid == self.drawer or m.uid in self.guessed):
                for uid in [self.drawer, *self.guessed]:
                    self.room.send(uid, "g:chat", **entry, secret=True)
            else:
                self.broadcast("chat", **entry)
            return
        attempt = text.lower().strip()
        if attempt == self.word:
            remaining = max(0, self.ends_at - time.time())
            points = 50 + int(250 * remaining / self.settings["drawTime"]) + (50 if not self.guessed else 0)
            self.guessed.append(m.uid)
            self.scores[m.uid] = self.scores.get(m.uid, 0) + points
            self.scores[self.drawer] = self.scores.get(self.drawer, 0) + 40
            self.broadcast("correct", id=m.uid, name=m.name, avatar=m.avatar, points=points,
                           scores=self.scores, guessed=self.guessed)
            m.send("g:word", word=self.word)
            guessers = [u for u in self.scores if u != self.drawer and self.online(u)]
            if all(u in self.guessed for u in guessers):
                self.end_turn()
        else:
            if close_enough(attempt, self.word):
                m.send("g:close", text=text)
            self.broadcast("chat", **entry)

    def online(self, uid):
        mm = self.room.members.get(uid)
        return bool(mm and mm.online)

    # -- flow --------------------------------------------------------------
    def start(self):
        self.final = None
        self.tainted = False
        self.scores = {u.uid: 0 for u in self.room.online_members()}
        self.order = list(self.scores)
        random.shuffle(self.order)
        self.turn_idx = -1
        self.round_no = 1
        self.used_words = set()
        self.next_turn()

    def on_join(self, m, rejoin):
        if self.phase in ("choosing", "drawing", "reveal") and m.uid not in self.scores:
            self.scores[m.uid] = 0
            self.order.append(m.uid)
            self.broadcast("scores", scores=self.scores)

    def on_leave(self, m):
        if m.uid == self.drawer and self.phase in ("choosing", "drawing"):
            self.room.system("✏️ The artist left — skipping turn")
            self.end_turn()

    def next_turn(self):
        self.clear_timers()
        while True:
            self.turn_idx += 1
            if self.turn_idx >= len(self.order):
                self.turn_idx = 0
                self.round_no += 1
                if self.round_no > self.settings["rounds"]:
                    return self.finish()
            uid = self.order[self.turn_idx]
            if self.online(uid):
                break
            if not any(self.online(u) for u in self.order):
                return self.finish()
        self.drawer = uid
        self.word = None
        self.revealed = set()
        self.guessed = []
        self.strokes = []
        pool = [w for w in WORDS if w not in self.used_words] or WORDS
        self.choices = random.sample(pool, 3)
        self.phase = "choosing"
        self.broadcast("choosing", turn=self.turn_info(), scores=self.scores)
        self.room.send(uid, "g:choose", words=self.choices)
        self.timer = self.room.later(15, lambda: self.phase == "choosing" and self.begin_drawing(random.choice(self.choices)))

    def begin_drawing(self, word):
        self.clear_timers()
        self.word = word
        self.used_words.add(word)
        self.phase = "drawing"
        dt = self.settings["drawTime"]
        self.ends_at = time.time() + dt
        for m in self.room.members.values():
            m.send("g:drawing", turn=self.turn_info(m))
        letters = [i for i, ch in enumerate(word) if ch.isalpha()]
        random.shuffle(letters)
        hints = min(len(letters) - 1, 1 + len(word) // 4)
        for k in range(max(0, hints)):
            at = dt * (0.45 + 0.4 * k / max(1, hints))
            self.hint_timers.append(self.room.later(at, self.reveal_letter, letters[k]))
        self.timer = self.room.later(dt, self.end_turn)

    def reveal_letter(self, i):
        if self.phase != "drawing":
            return
        self.revealed.add(i)
        for m in self.room.members.values():
            if m.uid != self.drawer and m.uid not in self.guessed:
                m.send("g:hint", hint=mask_word(self.word, self.revealed))

    def end_turn(self):
        if self.phase not in ("choosing", "drawing"):
            return
        self.clear_timers()
        self.phase = "reveal"
        self.broadcast("reveal", word=self.word or "(no word)", scores=self.scores,
                       drawer=self.drawer, guessed=self.guessed)
        self.timer = self.room.later(DRAW_PAD, self.next_turn)

    def finish(self):
        self.clear_timers()
        self.phase = "over"
        self.drawer = None
        self.word = None
        ranking = []
        for uid, pts in sorted(self.scores.items(), key=lambda kv: -kv[1]):
            mm = self.room.members.get(uid)
            ranking.append({"id": uid, "points": pts, "name": mm.name if mm else "Gone",
                            "avatar": mm.avatar if mm else "👻", "color": mm.color if mm else "#888888"})
        self.final = ranking
        self.broadcast("final", ranking=ranking)
        self.record_ranking(ranking, "doodle")

    def on_admin(self, m, action, msg):
        playing = self.phase in ("choosing", "drawing", "reveal")
        if action == "word" and self.phase == "drawing":
            return f"🤫 The word is: {self.word.upper()}"
        if action == "skip" and self.phase in ("choosing", "drawing"):
            self.end_turn()
            return "⏭️ Turn skipped."
        if action == "points" and playing and m.uid in self.scores:
            self.scores[m.uid] += 500
            self.broadcast("scores", scores=self.scores)
            return "💯 +500 points."
        if action == "end" and playing:
            self.finish()
            return "🏁 Game ended."
        return None

    def clear_timers(self):
        self.room.cancel(self.timer)
        self.timer = None
        for h in self.hint_timers:
            self.room.cancel(h)
        self.hint_timers = []
