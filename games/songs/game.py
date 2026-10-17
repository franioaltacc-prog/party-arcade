"""Song Rush: a song starts playing and everyone races to name it.

Type mode: type the title and the artist (or the movie, for soundtrack songs) — the faster, the more points.
Pick mode: choose the right song out of four. Previews and covers come from iTunes (see build.py)."""
import json
import random
import time
from pathlib import Path

from ..base import Game, num
from . import match

DATA = json.loads((Path(__file__).parent / "songs.json").read_text())
SONGS = DATA["songs"]
PLAYLISTS = {p["id"]: p for p in DATA["playlists"]}
for _s in SONGS.values():
    _s["mc"] = match.movie_counts(_s)   # the movie is the second answer
PLAYLISTS["mix"] = {"id": "mix", "emoji": "🎲", "name": "Everything", "desc": "Songs from every playlist, all mixed up.",
                    "songs": list(dict.fromkeys(s for p in DATA["playlists"] for s in p["songs"]))}
ORDER = ["mix"] + [p["id"] for p in DATA["playlists"]]

COUNTDOWN = 3.0          # "get ready" before each song: the song downloads meanwhile
REVEAL = 7.0             # seconds showing the answer
MODES = ("type", "pick")
TIMES = (15, 20, 30)
ROUNDS = (5, 10, 15, 20)
GUESS_GAP = 0.35         # seconds between guesses (no spamming the whole playlist)
BROKEN = set()           # songs whose preview wouldn't load for anyone: skipped from now on


def art(url, size=600):
    return url.replace("100x100bb", f"{size}x{size}bb") if url else ""


def song_public(sid):
    s = SONGS[sid]
    return {"id": sid, "t": s["t"], "a": s["a"], "y": s["y"], "m": s.get("m"), "album": s.get("album", ""),
            "art": art(s.get("art", "")), "url": s.get("url", "")}


class SongRush(Game):
    key = "songs"
    max_players = 16

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"playlist": "mix", "rounds": 10, "time": 20, "mode": "type"}
        self.scores, self.streaks, self.correct = {}, {}, {}
        self.queue, self.recent = [], []
        self.n = 0
        self.sid = None
        self.options = []          # pick mode: song ids, one of them right
        self.known = {}            # uid -> set of "t"/"a" this round
        self.picks = {}            # uid -> (option index, points)
        self.earned = {}           # uid -> {"t": pts, "a": pts}
        self.failed = set()
        self.hint = 0
        self.shown = set()         # title letters showing
        self.starts_at = self.ends_at = 0
        self.last_guess = {}
        self.timer = None
        self.hint_timers = []
        self.final = None

    def listed(self):
        return self.phase in ("lobby", "over")

    # -- state ---------------------------------------------------------------
    def song(self):
        return SONGS[self.sid] if self.sid else None

    def who_text(self, s):
        return s["m"] if s["mc"] else s["a"]

    def round_public(self, m=None):
        s = self.song()
        if not s:
            return None
        info = {"n": self.n, "rounds": len(self.queue), "url": s["p"], "mode": self.settings["mode"],
                "left": max(0.0, self.ends_at - time.time()) if self.phase == "playing" else None,
                "startsIn": max(0.0, self.starts_at - time.time()) if self.phase == "ready" else None,
                "time": self.settings["time"]}
        if self.settings["mode"] == "type":
            info["hints"] = self.hints_public()
            info["movie"] = s["mc"]
        elif self.phase in ("playing", "reveal"):
            info["options"] = [{"t": SONGS[o]["t"], "a": SONGS[o]["a"]} for o in self.options]
        if m is not None:
            mine = self.known.get(m.uid, set())
            if "t" in mine:
                info["title"] = s["t"]
            if "a" in mine:
                info["who"] = self.who_text(s)
            if m.uid in self.picks:
                info["picked"] = self.picks[m.uid][0]
        info["solved"] = {u: "".join(sorted(k)) for u, k in self.known.items() if k}
        info["answered"] = list(self.picks)
        return info

    def hints_public(self):
        s = self.song()
        out = {"title": match.mask(s["t"], self.shown)}
        if self.hint >= 1:
            out["year"] = s["y"]
            out["genre"] = s.get("g") or None
        if self.hint >= 2:
            who = self.who_text(s)
            out["who"] = match.mask(who, match.first_letters(who))
        return out

    def state_for(self, m):
        return {"phase": self.phase, "settings": self.settings, "scores": self.scores, "streaks": self.streaks,
                "round": self.round_public(m), "final": self.final,
                "reveal": self.reveal_public() if self.phase == "reveal" else None,
                "playlists": [{"id": p, "emoji": PLAYLISTS[p]["emoji"], "name": PLAYLISTS[p]["name"],
                               "desc": PLAYLISTS[p]["desc"], "count": len(PLAYLISTS[p]["songs"])} for p in ORDER]}

    # -- messages ------------------------------------------------------------
    def on_message(self, m, t, msg):
        if t == "settings" and self.is_host(m) and self.phase in ("lobby", "over"):
            s = self.settings
            if msg.get("playlist") in PLAYLISTS:
                s["playlist"] = msg["playlist"]
            if msg.get("mode") in MODES:
                s["mode"] = msg["mode"]
            r = int(num(msg.get("rounds"), s["rounds"]))
            s["rounds"] = r if r in ROUNDS else s["rounds"]
            tm = int(num(msg.get("time"), s["time"]))
            s["time"] = tm if tm in TIMES else s["time"]
            self.broadcast("settings", settings=s)
        elif t == "start" and self.is_host(m) and self.phase in ("lobby", "over"):
            if not self.room.players_now():
                return
            self.start()
        elif t == "guess":
            self.guess(m, msg)
        elif t == "pick":
            self.pick(m, msg)
        elif t == "bad":
            self.bad(m, msg)

    def can_play(self, m):
        return m.plays and m.uid in self.scores

    def guess(self, m, msg):
        text = " ".join(str(msg.get("text") or "").split())[:80]
        if not text:
            return
        entry = {"id": m.uid, "name": m.name, "avatar": m.avatar, "color": m.color, "text": text}
        if self.phase != "playing" or self.settings["mode"] != "type" or not self.can_play(m):
            self.chat(m, entry)
            return
        now = time.time()
        if now - self.last_guess.get(m.uid, 0) < GUESS_GAP:
            m.send("g:slow")
            return
        self.last_guess[m.uid] = now
        s = self.song()
        mine = self.known.setdefault(m.uid, set())
        got = match.check(text, s, "t" not in mine, "a" not in mine) - mine
        if got:
            self.score(m, got)
            return
        missing = []
        if "t" not in mine:
            missing.append(("t", match.title_answers(s)))
        if "a" not in mine:
            missing.append(("a", match.who_answers(s)))
        for what, answers in missing:
            if match.is_close(text, answers):
                m.send("g:close", text=text, what=what)
                return   # close guesses stay private: they'd give the answer away
        self.chat(m, entry)

    def chat(self, m, entry):
        """Players who know part of the answer only chat with players who know at least as much."""
        if self.phase != "playing":
            self.broadcast("chat", **entry)
            return
        mine = self.known.get(m.uid, set())
        secret = bool(mine)
        for mm in list(self.room.members.values()):
            if mine <= self.known.get(mm.uid, set()):
                mm.send("g:chat", **entry, secret=secret)

    def score(self, m, got):
        s = self.song()
        left = max(0.0, self.ends_at - time.time())
        frac = left / self.settings["time"]
        mine = self.known[m.uid]
        earned = self.earned.setdefault(m.uid, {})
        pts = 0
        first = False
        if "t" in got:
            first = not any("t" in k for u, k in self.known.items() if u != m.uid)
            streak = self.streaks.get(m.uid, 0) + 1
            self.streaks[m.uid] = streak
            earned["t"] = 100 + round(400 * frac) + (50 if first else 0) + min(200, 50 * (streak - 1))
            pts += earned["t"]
            self.correct[m.uid] = self.correct.get(m.uid, 0) + 1
        if "a" in got:
            earned["a"] = 50 + round(200 * frac)
            pts += earned["a"]
        mine |= got
        self.scores[m.uid] = self.scores.get(m.uid, 0) + pts
        what = "".join(sorted(mine))
        self.broadcast("got", id=m.uid, name=m.name, avatar=m.avatar, got="".join(sorted(got)), solved=what, pts=pts,
                       first=first, streak=self.streaks.get(m.uid, 0), scores=self.scores)
        m.send("g:answer", title=s["t"] if "t" in mine else None, who=self.who_text(s) if "a" in mine else None,
               got="".join(sorted(got)), pts=pts, streak=self.streaks.get(m.uid, 0))
        self.maybe_done()

    def pick(self, m, msg):
        if self.phase != "playing" or self.settings["mode"] != "pick" or not self.can_play(m) or m.uid in self.picks:
            return
        i = msg.get("i")
        if not isinstance(i, int) or not 0 <= i < len(self.options):
            return
        ok = self.options[i] == self.sid
        left = max(0.0, self.ends_at - time.time())
        pts = 0
        if ok:
            first = not any(self.options[j] == self.sid for j, _ in self.picks.values())
            streak = self.streaks.get(m.uid, 0) + 1
            self.streaks[m.uid] = streak
            pts = 100 + round(500 * left / self.settings["time"]) + (50 if first else 0) + min(200, 50 * (streak - 1))
            self.correct[m.uid] = self.correct.get(m.uid, 0) + 1
        else:
            self.streaks[m.uid] = 0
        self.picks[m.uid] = (i, pts)
        self.broadcast("answered", id=m.uid)
        self.maybe_done()

    def bad(self, m, msg):
        """A player's browser couldn't load this song. If nobody can, skip it."""
        if self.phase not in ("ready", "playing") or msg.get("n") != self.n or not self.can_play(m):
            return
        self.failed.add(m.uid)
        if all(u in self.failed for u in self.active()):
            BROKEN.add(self.sid)
            self.room.system("😵 That song wouldn't load. Skipping it!")
            self.end_round(skipped=True)

    def active(self):
        return [u for u in self.scores if self.online(u)]

    def online(self, uid):
        mm = self.room.members.get(uid)
        return bool(mm and mm.plays)

    def maybe_done(self):
        players = self.active()
        if self.settings["mode"] == "pick":
            done = all(u in self.picks for u in players)
        else:
            done = all(self.known.get(u) == {"t", "a"} for u in players)
        if players and done:
            self.room.cancel(self.timer)
            self.timer = self.room.later(1.0, self.end_round)

    # -- flow ----------------------------------------------------------------
    def start(self):
        self.clear_timers()
        self.final = None
        self.tainted = False
        players = self.room.players_now()
        self.scores = {u.uid: 0 for u in players}
        self.streaks = {u.uid: 0 for u in players}
        self.correct = {u.uid: 0 for u in players}
        pool = [s for s in PLAYLISTS[self.settings["playlist"]]["songs"] if s not in BROKEN]
        fresh = [s for s in pool if s not in self.recent]
        random.shuffle(fresh)
        rest = [s for s in pool if s in self.recent]
        random.shuffle(rest)
        self.queue = (fresh + rest)[:self.settings["rounds"]]
        self.recent = (self.recent + self.queue)[-150:]
        self.n = 0
        self.next_round()

    def on_join(self, m, rejoin):
        if self.phase in ("ready", "playing", "reveal") and m.uid not in self.scores and not m.watching:
            self.scores[m.uid] = 0
            self.streaks[m.uid] = 0
            self.correct[m.uid] = 0
            self.broadcast("scores", scores=self.scores, streaks=self.streaks)

    def on_leave(self, m):
        if self.phase == "playing":
            self.maybe_done()

    def next_round(self):
        self.clear_timers()
        if self.n >= len(self.queue) or not self.active():
            return self.finish()
        self.sid = self.queue[self.n]
        self.n += 1
        self.known, self.picks, self.earned, self.failed = {}, {}, {}, set()
        self.hint = 0
        self.shown = set()
        self.options = []
        if self.settings["mode"] == "pick":
            self.options = self.decoys(self.sid) + [self.sid]
            random.shuffle(self.options)
        self.phase = "ready"
        self.starts_at = time.time() + COUNTDOWN
        for mm in list(self.room.members.values()):
            mm.send("g:round", round=self.round_public(mm), scores=self.scores, streaks=self.streaks)
        self.timer = self.room.later(COUNTDOWN, self.play)

    def decoys(self, sid):
        """Three other songs for pick mode: same playlist, different artists, from around the same time."""
        s = SONGS[sid]
        pool = [o for o in PLAYLISTS[self.settings["playlist"]]["songs"] if o != sid]
        if len(pool) < 6:
            pool = [o for o in SONGS if o != sid]
        random.shuffle(pool)
        pool.sort(key=lambda o: abs(SONGS[o]["y"] - s["y"]) > 12)
        out, artists, titles = [], {match.squash(s["a"])}, {match.squash(s["t"])}
        for o in pool:
            a, t = match.squash(SONGS[o]["a"]), match.squash(SONGS[o]["t"])
            if a in artists or t in titles:
                continue
            out.append(o)
            artists.add(a)
            titles.add(t)
            if len(out) == 3:
                break
        return out

    def play(self):
        if self.phase != "ready":
            return
        self.phase = "playing"
        dt = self.settings["time"]
        self.ends_at = time.time() + dt
        for mm in list(self.room.members.values()):
            mm.send("g:play", round=self.round_public(mm))
        if self.settings["mode"] == "type":
            for k, at in enumerate((0.3, 0.55, 0.78), 1):
                self.hint_timers.append(self.room.later(dt * at, self.give_hint, k))
        self.timer = self.room.later(dt, self.end_round)

    def give_hint(self, level):
        """1: year and genre. 2: first letter of each word, and the artist's (or movie's) initials. 3: more letters."""
        if self.phase != "playing":
            return
        s = self.song()
        self.hint = min(level, 2)
        if level >= 2:
            self.shown |= match.first_letters(s["t"])
        if level >= 3:
            rest = [i for i, ch in enumerate(s["t"]) if ch.isalnum() and i not in self.shown]
            random.shuffle(rest)
            self.shown |= set(rest[:len(rest) // 3])
        self.broadcast("hint", level=level, hints=self.hints_public())

    def reveal_public(self):
        s = self.song()
        if not s:
            return None
        results = {}
        for uid in self.scores:
            e = self.earned.get(uid, {})
            r = {"t": e.get("t", 0), "a": e.get("a", 0)}
            if uid in self.picks:
                i, pts = self.picks[uid]
                r.update(pick=i, ok=self.options[i] == self.sid, t=pts)
            results[uid] = r
        nxt = self.queue[self.n] if self.n < len(self.queue) else None
        return {"song": song_public(self.sid), "results": results, "answer": self.options.index(self.sid) if self.options else None,
                "n": self.n, "rounds": len(self.queue), "next": SONGS[nxt]["p"] if nxt else None}

    def end_round(self, skipped=False):
        if self.phase not in ("ready", "playing"):
            return
        self.clear_timers()
        if self.settings["mode"] == "type":
            for uid in self.scores:
                if "t" not in self.known.get(uid, set()):
                    self.streaks[uid] = 0
        else:   # picks score now, so nobody can tell who was right from the scores while the song plays
            for uid in self.scores:
                if uid in self.picks:
                    self.scores[uid] += self.picks[uid][1]
                else:
                    self.streaks[uid] = 0
        self.phase = "reveal"
        self.broadcast("reveal", reveal=self.reveal_public(), scores=self.scores, streaks=self.streaks, skipped=skipped)
        self.timer = self.room.later(2.0 if skipped else REVEAL, self.next_round)

    def finish(self):
        self.clear_timers()
        self.phase = "over"
        self.sid = None
        ranking = []
        for uid, pts in sorted(self.scores.items(), key=lambda kv: -kv[1]):
            mm = self.room.members.get(uid)
            ranking.append({"id": uid, "points": pts, "correct": self.correct.get(uid, 0), "name": mm.name if mm else "Gone",
                            "avatar": mm.avatar if mm else "👻", "color": mm.color if mm else "#888888"})
        self.final = {"ranking": ranking, "rounds": len(self.queue), "playlist": self.settings["playlist"],
                      "songs": [song_public(s) for s in self.queue[:self.n]]}
        self.broadcast("final", final=self.final)
        extra = {r["id"]: {"songs.correct": ("add", r["correct"])} for r in ranking}
        for r in ranking:
            if self.queue and r["correct"] == len(self.queue) and len(self.queue) >= 10:
                extra[r["id"]]["songs.perfect"] = ("add", 1)
        self.record_ranking(ranking, "songs", extra=extra)

    def on_admin(self, m, action, msg):
        playing = self.phase in ("ready", "playing", "reveal")
        if action == "answer" and self.phase in ("ready", "playing"):
            s = self.song()
            return f"🤫 It's “{s['t']}” by {s['a']}" + (f" (from {s['m']})" if s.get("m") else "")
        if action == "points" and playing and m.uid in self.scores:
            self.scores[m.uid] += 500
            self.broadcast("scores", scores=self.scores, streaks=self.streaks)
            return "💯 +500 points."
        if action == "skip" and self.phase in ("ready", "playing"):
            self.end_round()
            return "⏭️ Song skipped."
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
