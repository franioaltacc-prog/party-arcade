"""Impostor: everyone gets the secret word except the impostor(s), who only get
the category (or nothing). Players give one clue each, discuss, then vote.
A caught impostor gets one guess at the word to steal the win.

Everything secret stays on the server: the impostor's client never receives the word.
Words live in words.json (re-read at the start of every game).
"""
import json
import random
import time
import traceback
import unicodedata
from pathlib import Path

from ..base import Game, num

WORDS_FILE = Path(__file__).with_name("words.json")
MIN_PLAYERS = 3
MAX_SEATS = 10
ROLE_TIME = 5
GUESS_TIME = 30
REVEAL_TIME = 10
CANCEL_TIME = 4

CHOICES = {
    "rounds": (3, 5, 8, 10),
    "clueRounds": (1, 2, 3),
    "clueTime": (15, 30, 45, 60),
    "discussTime": (30, 60, 90, 120),
    "voteTime": (20, 30, 45, 60),
}
POINTS = {"correct_vote": 100, "crew_win": 50, "impostor_survive": 250, "impostor_guess": 200}

_words_cache = {}


def load_words():
    """Read the word lists; keep the last good copy if the file has a mistake."""
    global _words_cache
    try:
        data = json.loads(WORDS_FILE.read_text(encoding="utf-8"))
        cats = {}
        for key, cat in data.items():
            if key.startswith("_") or not isinstance(cat, dict):
                continue
            words = [str(w).strip() for w in cat.get("words", []) if str(w).strip()]
            if words:
                cats[key] = {"name": str(cat.get("name") or key), "emoji": str(cat.get("emoji") or "🎲"), "words": words}
        if cats:
            _words_cache = cats
    except Exception:
        print("⚠️  Problem in games/impostor/words.json:")
        traceback.print_exc()
    return _words_cache


def norm(text):
    """lowercase, no accents, only letters/numbers and single spaces"""
    text = unicodedata.normalize("NFKD", str(text or "").lower())
    text = "".join(ch if ch.isalnum() else " " for ch in text if not unicodedata.combining(ch))
    return " ".join(text.split())


def forms(token):
    """A word plus its simple singular forms (pizzas -> pizza, berries -> berry)."""
    out = {token}
    if len(token) > 4 and token.endswith("ies"):
        out.add(token[:-3] + "y")
    if len(token) > 3 and token.endswith("es"):
        out.add(token[:-2])
    if len(token) > 3 and token.endswith("s"):
        out.add(token[:-1])
    return out


def leaks(clue, word):
    """Does the clue give away the secret word (or a plural / part of it)?"""
    c, w = norm(clue), norm(word)
    if not w:
        return False
    if w.replace(" ", "") in c.replace(" ", ""):
        return True
    word_parts = {f for tok in w.split() if len(tok) >= 3 for f in forms(tok)}
    clue_parts = {f for tok in c.split() for f in forms(tok)}
    return bool(word_parts & clue_parts)


def same_word(guess, word):
    g, w = norm(guess).replace(" ", ""), norm(word).replace(" ", "")
    return bool(g) and (g == w or bool(forms(g) & forms(w)))


class Impostor(Game):
    key = "impostor"
    max_players = 16          # up to 10 play, the rest spectate

    def __init__(self, room):
        super().__init__(room)
        self.cats = load_words()
        self.settings = {"rounds": 5, "clueRounds": 2, "clueTime": 30, "discussTime": 60, "voteTime": 30,
                         "categories": {k: True for k in self.cats}, "twoImpostors": False, "impostorCategory": True}
        self.players = []         # seats in the current game
        self.names = {}           # uid -> (name, avatar, color) so leavers still show in results
        self.points = {}
        self.round = 0
        self.r = None             # the current round
        self.timer = None
        self.ends = 0.0
        self.total = 0
        self.final = None
        self.round_stats = {}
        self.used = set()

    # ------------------------------------------------------------------ helpers
    def listed(self):
        return self.phase in ("lobby", "over")

    def member(self, uid):
        return self.room.members.get(uid)

    def online(self, uid):
        mm = self.member(uid)
        return bool(mm and mm.online)

    def online_players(self):
        return [u for u in self.players if self.online(u)]

    def pinfo(self, uid):
        mm = self.member(uid)
        if mm:
            self.names[uid] = (mm.name, mm.avatar, mm.color)
        name, avatar, color = self.names.get(uid, ("Gone", "👻", "#888888"))
        return {"id": uid, "name": name, "avatar": avatar, "color": color, "online": bool(mm and mm.online),
                "points": self.points.get(uid, 0)}

    def turn(self):
        r = self.r
        if not r or self.phase != "clue" or r["turn"] >= len(r["order"]):
            return None
        return r["order"][r["turn"]]

    def set_timer(self, seconds, fn, *args):
        self.room.cancel(self.timer)
        self.total = seconds
        self.ends = time.time() + seconds
        self.timer = self.room.later(seconds, fn, *args)

    def stop_timer(self):
        self.room.cancel(self.timer)
        self.timer = None
        self.ends = 0
        self.total = 0

    def stat(self, uid, key, n=1):
        s = self.round_stats.setdefault(uid, {})
        s[key] = s.get(key, 0) + n

    # ------------------------------------------------------------------ state
    def state_for(self, m):
        uid = m.uid if m else None
        r = self.r
        in_game = self.phase not in ("lobby", "over")
        st = {
            "phase": self.phase, "settings": self.settings, "round": self.round,
            "categories": [{"key": k, "name": c["name"], "emoji": c["emoji"], "n": len(c["words"])} for k, c in self.cats.items()],
            "players": [self.pinfo(u) for u in self.players] if in_game or self.final else [],
            "spectator": in_game and uid not in self.players,
            "left": round(max(0.0, self.ends - time.time()), 2) if self.ends else None, "total": self.total,
            "final": self.final, "r": None,
        }
        if not r or not in_game:
            return st
        reveal = self.phase == "reveal"
        imp = uid in r["impostors"]
        seated = uid in r["order"]
        role = "impostor" if imp else "crew" if seated else "spectator"
        show_cat = not imp or self.settings["impostorCategory"] or reveal
        st["r"] = {
            "n": r["n"], "order": r["order"], "turn": self.turn(), "clueRound": r["clue_round"],
            "clueRounds": r["clue_rounds"], "clues": r["clues"], "role": role, "impCount": len(r["impostors"]),
            "word": r["word"] if (not imp or reveal) else None,
            "category": {"name": r["cat_name"], "emoji": r["cat_emoji"]} if show_cat else None,
            "voted": list(r["votes"]) if self.phase == "vote" else None,
            "myVote": r["votes"].get(uid),
            "votes": r["votes"] if self.phase in ("guess", "reveal") else None,
            "tally": r["tally"] if self.phase in ("guess", "reveal") else None,
            "out": r["out"] if self.phase in ("guess", "reveal") else None,
            "impostors": r["impostors"] if reveal else None,
            "guess": r["guess"] if reveal else None, "guessOk": r["guess_ok"] if reveal else None,
            "winner": r["winner"] if reveal else None, "gained": r["gained"] if reveal else None,
            "cancelled": r.get("cancelled", False),
        }
        return st

    def push(self):
        for mm in list(self.room.members.values()):
            mm.send("g:state", state=self.state_for(mm))

    # ------------------------------------------------------------------ messages
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase in ("lobby", "over"):
            self.update_settings(msg)
        elif t == "start" and host and self.phase in ("lobby", "over"):
            self.start(m)
        elif t == "end" and host and self.phase not in ("lobby", "over"):
            self.finish()
        elif t == "clue" and self.phase == "clue" and self.turn() == m.uid:
            self.submit_clue(m, msg.get("text"))
        elif t == "vote" and self.phase == "vote":
            self.vote(m, msg.get("target"))
        elif t == "guess" and self.phase == "guess" and self.r and self.r["out"] == m.uid:
            self.submit_guess(m, msg.get("text"))
        elif t == "skipDiscussion" and host and self.phase == "discuss":
            self.room.system("⏩ The host started the vote early.")
            self.start_vote()

    def update_settings(self, msg):
        s = self.settings
        for key, options in CHOICES.items():
            if key in msg:
                v = int(num(msg.get(key), s[key]))
                if v in options:
                    s[key] = v
        for key in ("twoImpostors", "impostorCategory"):
            if key in msg:
                s[key] = bool(msg[key])
        cats = msg.get("categories")
        if isinstance(cats, dict):
            new = dict(s["categories"])
            for k, v in cats.items():
                if k in self.cats:
                    new[k] = bool(v)
            if any(new.get(k) for k in self.cats):
                s["categories"] = new
        self.push()

    def on_chat(self, m, entry):
        """Chat rules: spectators only talk to spectators, nobody chats during clues
        (your message *is* your clue on your turn), a caught impostor's message is their guess."""
        if self.phase in ("lobby", "over"):
            return False
        if m.uid not in self.players or (self.r and m.uid not in self.r["order"]):
            entry = {**entry, "spec": True}
            for mm in list(self.room.members.values()):
                if mm.uid not in self.players or (self.r and mm.uid not in self.r["order"]):
                    mm.send("chat", **entry)
            return True
        if self.phase in ("role", "clue"):
            if self.phase == "clue" and self.turn() == m.uid:
                self.submit_clue(m, entry["text"])
            else:
                m.send("g:toast", text="🤫 Chat is off while clues are given — wait for the discussion!", bad=True)
            return True
        if self.phase == "guess" and self.r and m.uid == self.r["out"]:
            self.submit_guess(m, entry["text"])
            return True
        return False

    # ------------------------------------------------------------------ flow
    def start(self, m):
        online = [mm.uid for mm in self.room.members.values() if mm.plays]
        if len(online) < MIN_PLAYERS:
            m.send("error", msg=f"Impostor needs at least {MIN_PLAYERS} players! Invite more friends 🕵️")
            return
        self.cats = load_words()
        for k in self.cats:
            self.settings["categories"].setdefault(k, True)
        self.tainted = False
        self.players = online[:MAX_SEATS]
        self.points = {u: 0 for u in self.players}
        self.round_stats = {}
        self.round = 0
        self.final = None
        self.used = set()
        self.next_round()

    def next_round(self):
        self.stop_timer()
        self.round += 1
        if self.round > self.settings["rounds"]:
            self.finish()
            return
        # newcomers get a seat at the start of a round
        self.players = [u for u in self.players if self.member(u)]
        for mm in self.room.members.values():
            if mm.online and mm.uid not in self.players and len(self.players) < MAX_SEATS:
                self.players.append(mm.uid)
                self.points.setdefault(mm.uid, 0)
        seated = self.online_players()
        if len(seated) < MIN_PLAYERS:
            self.room.system(f"😢 Not enough players left (need {MIN_PLAYERS}).")
            self.finish()
            return
        enabled = [k for k in self.cats if self.settings["categories"].get(k, True)] or list(self.cats)
        cat_key = random.choice(enabled)
        cat = self.cats[cat_key]
        pool = [w for w in cat["words"] if (cat_key, w) not in self.used] or cat["words"]
        word = random.choice(pool)
        self.used.add((cat_key, word))
        count = 2 if self.settings["twoImpostors"] and len(seated) >= 7 else 1
        order = seated[:]
        random.shuffle(order)
        self.r = {"n": self.round, "word": word, "cat_name": cat["name"], "cat_emoji": cat["emoji"],
                  "impostors": random.sample(seated, count), "order": order, "turn": 0, "clue_round": 1,
                  "clue_rounds": self.settings["clueRounds"], "clues": {u: [] for u in order}, "votes": {},
                  "tally": {}, "out": None, "guess": None, "guess_ok": None, "winner": None, "gained": {}}
        for u in self.r["impostors"]:
            self.stat(u, "imp_rounds")
        self.phase = "role"
        self.set_timer(ROLE_TIME, self.start_clues)
        self.push()

    def start_clues(self):
        if self.phase != "role":
            return
        self.phase = "clue"
        self.r["turn"] = 0
        self.r["clue_round"] = 1
        self.room.system(f"🗝️ Round {self.round}: give your clues! One word or a short phrase each.")
        self.begin_turn()

    def begin_turn(self):
        uid = self.turn()
        if uid is None:
            return
        wait = self.settings["clueTime"] if self.online(uid) else min(6, self.settings["clueTime"])
        self.set_timer(wait, self.clue_timeout)
        self.push()

    def submit_clue(self, m, text):
        r = self.r
        clue = " ".join(str(text or "").split())[:30]
        if not clue:
            return
        if m.uid not in r["impostors"] and leaks(clue, r["word"]):
            m.send("g:toast", text="🚫 Your clue can't contain the secret word! Try something sneakier.", bad=True)
            return
        r["clues"][m.uid].append(clue)
        self.room.broadcast("chat", **{"from": m.info(), "text": clue, "clue": True, "ts": int(time.time() * 1000)})
        self.advance()

    def clue_timeout(self):
        if self.phase != "clue":
            return
        uid = self.turn()
        if uid is not None:
            self.r["clues"][uid].append(None)
            name = self.pinfo(uid)["name"]
            self.room.system(f"⏰ {name} ran out of time (no clue)")
        self.advance()

    def advance(self):
        r = self.r
        r["turn"] += 1
        if r["turn"] >= len(r["order"]):
            if r["clue_round"] < r["clue_rounds"]:
                r["clue_round"] += 1
                r["turn"] = 0
            else:
                self.start_discuss()
                return
        self.begin_turn()

    def start_discuss(self):
        self.phase = "discuss"
        self.room.system("💬 Discussion time! Who's the impostor? 🕵️")
        self.set_timer(self.settings["discussTime"], self.start_vote)
        self.push()

    def start_vote(self):
        if self.phase != "discuss":
            return
        self.phase = "vote"
        self.r["votes"] = {}
        self.set_timer(self.settings["voteTime"], self.reveal_votes)
        self.push()

    def voters(self):
        return [u for u in self.r["order"] if self.online(u)]

    def vote(self, m, target):
        r = self.r
        if m.uid not in r["order"]:
            return
        if target != "skip" and (target not in r["order"] or target == m.uid):
            return
        r["votes"][m.uid] = target
        if all(u in r["votes"] for u in self.voters()):
            self.set_timer(0.8, self.reveal_votes)
        self.push()

    def reveal_votes(self):
        if self.phase != "vote":
            return
        r = self.r
        tally = {}
        for target in r["votes"].values():
            tally[target] = tally.get(target, 0) + 1
        r["tally"] = tally
        out = None
        if tally:
            top = max(tally.values())
            leaders = [t for t, n in tally.items() if n == top]
            if len(leaders) == 1 and leaders[0] != "skip":
                out = leaders[0]
        r["out"] = out
        if out and out in r["impostors"]:
            self.phase = "guess"
            self.set_timer(GUESS_TIME if self.online(out) else 6, self.guess_timeout)
            self.room.system(f"🎯 {self.pinfo(out)['name']} was voted out… and they ARE an impostor! One last guess at the word…")
            self.push()
        else:
            self.end_round()

    def submit_guess(self, m, text):
        r = self.r
        guess = " ".join(str(text or "").split())[:40]
        if not guess or r["guess"] is not None:
            return
        r["guess"] = guess
        r["guess_ok"] = same_word(guess, r["word"])
        self.end_round()

    def guess_timeout(self):
        if self.phase == "guess":
            self.r["guess_ok"] = False
            self.end_round()

    def end_round(self):
        r = self.r
        caught = r["out"] in r["impostors"]
        r["winner"] = "impostor" if (not caught or r["guess_ok"]) else "crew"
        gained = {}
        for uid in r["order"]:
            pts = 0
            if uid in r["impostors"]:
                if r["winner"] == "impostor":
                    pts = POINTS["impostor_guess"] if uid == r["out"] else POINTS["impostor_survive"]
                    self.stat(uid, "imp_wins")
                if uid != r["out"]:
                    self.stat(uid, "survived")
            else:
                if r["votes"].get(uid) in r["impostors"]:
                    pts += POINTS["correct_vote"]
                    self.stat(uid, "correct_votes")
                if r["winner"] == "crew":
                    pts += POINTS["crew_win"]
            gained[uid] = pts
            self.points[uid] = self.points.get(uid, 0) + pts
        r["gained"] = gained
        names = " & ".join(self.pinfo(u)["name"] for u in r["impostors"])
        verdict = "🎉 The crew caught the impostor!" if r["winner"] == "crew" else "🕵️ The impostor wins this round!"
        self.room.system(f"{verdict} The impostor was {names} · the word was “{r['word']}”.")
        self.phase = "reveal"
        self.set_timer(REVEAL_TIME, self.next_round)
        self.push()

    def cancel_round(self, why):
        self.room.system(why)
        self.r["cancelled"] = True
        self.r["winner"] = None
        self.phase = "reveal"
        self.set_timer(CANCEL_TIME, self.next_round)
        self.push()

    def finish(self):
        self.stop_timer()
        self.phase = "over"
        ranking = [self.pinfo(u) for u in sorted(self.points, key=lambda u: -self.points[u])]
        self.final = ranking
        self.r = None
        self.broadcast("final", ranking=ranking)
        self.push()
        extra = {uid: {f"impostor.{k}": ("add", n) for k, n in s.items()} for uid, s in self.round_stats.items()}
        self.record_ranking(ranking, "impostor", extra=extra)

    # ------------------------------------------------------------------ people coming and going
    def on_join(self, m, rejoin):
        if self.phase == "clue" and self.turn() == m.uid and rejoin:
            self.set_timer(self.settings["clueTime"], self.clue_timeout)
        self.push()

    def on_offline(self, m):
        if self.phase == "clue" and self.turn() == m.uid:
            self.set_timer(min(6, max(1, self.ends - time.time())), self.clue_timeout)
        elif self.phase == "vote" and self.r and all(u in self.r["votes"] for u in self.voters()) and self.r["votes"]:
            self.set_timer(0.8, self.reveal_votes)
        self.push()

    def on_leave(self, m):
        r = self.r
        if self.phase in ("lobby", "over") or not r:
            self.push()
            return
        if m.uid in r["order"] and self.phase not in ("reveal",):
            if m.uid in r["impostors"]:
                self.cancel_round(f"🏃 {m.name} left — they were the impostor! This round doesn't count.")
                return
            if self.phase == "clue" and self.turn() == m.uid:
                self.clue_timeout()
        if len(self.online_players()) < MIN_PLAYERS and self.phase != "over":
            self.room.system(f"😢 Not enough players left (need {MIN_PLAYERS}).")
            self.finish()
            return
        self.on_offline(m)

    # ------------------------------------------------------------------ admin
    def on_admin(self, m, action, msg):
        r = self.r
        live = self.phase not in ("lobby", "over") and r
        if action == "reveal" and live:
            names = " & ".join(self.pinfo(u)["name"] for u in r["impostors"])
            return f"🔎 Impostor: {names} · Word: {r['word'].upper()} ({r['cat_name']})"
        if action == "skip" and live:
            step = {"role": self.start_clues, "clue": self.clue_timeout, "discuss": self.start_vote,
                    "vote": self.reveal_votes, "guess": self.guess_timeout, "reveal": self.next_round}.get(self.phase)
            if step:
                step()
                return "⏭️ Skipped ahead."
        if action == "end" and live:
            self.finish()
            return "🏁 Game ended."
        return None
