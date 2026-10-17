"""In-process tests for Song Rush (games/songs): answer checking, the song list, scoring, hints, pick mode, with a fake room."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import random
from games.songs import game as G, match as X

failed = 0


def check(cond, label):
    global failed
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


class M:
    def __init__(self, uid, watching=False):
        self.uid, self.name, self.avatar, self.color = uid, uid.upper(), "🙂", "#fff"
        self.watching = watching
        self.client = object()
        self.account = None
        self.inbox = []
    online = property(lambda self: self.client is not None)
    plays = property(lambda self: self.client is not None and not self.watching)
    def send(self, t, **d): self.inbox.append((t, d))
    def got(self, t): return [d for tt, d in self.inbox if tt == t]


class Hub:
    def __init__(self): self.records = []
    def record(self, room, uid, game, outcome, stats=None, detail="", xp=None): self.records.append((uid, game, outcome, stats))


class Room:
    def __init__(self, ms):
        self.members = {m.uid: m for m in ms}
        self.host = ms[0].uid
        self.hub = Hub()
        self.timers = []
        self.over = None
    def players_now(self): return [m for m in self.members.values() if m.plays]
    def broadcast(self, t, exclude=None, **d):
        for m in self.members.values():
            if m.uid != exclude: m.send(t, **d)
    def send(self, uid, t, **d):
        if uid in self.members: self.members[uid].send(t, **d)
    def system(self, text): self.broadcast("chat", sys=True, text=text)
    def later(self, delay, fn, *a):
        h = [delay, fn, a]; self.timers.append(h); return h
    def cancel(self, h):
        if h in self.timers: self.timers.remove(h)
    def game_over(self, groups): self.over = groups


class Clock:
    now = 1000.0
    def time(self): return self.now


clock = Clock()
G.time = clock   # the game reads time.time() through this


def song(t, a, m=None, also=(), who=()):
    return {"t": t, "a": a, "m": m, "also": list(also), "who": list(who)}


# ------------------------------------------------------------------ answer checking
s = song("Shake It Off", "Taylor Swift")
check(X.check("shake it off", s) == {"t"}, "exact title")
check(X.check("SHAKE IT OF", s) == {"t"}, "a typo is fine")
check(X.check("shakeitoff!!", s) == {"t"}, "spaces and punctuation don't matter")
check(X.check("taylor swift", s) == {"a"}, "artist")
check(X.check("tayler swift", s) == {"a"}, "artist with a typo")
check(X.check("shake it off taylor swift", s) == {"t", "a"}, "title and artist in one go")
check(X.check("taylor swift - shake it off", s) == {"t", "a"}, "artist then title")
check(X.check("shake it off by taylor swift", s) == {"t", "a"}, "'title by artist'")
check(X.check("shake it off taylor swift", s, need_title=False) == {"a"}, "only what's still needed is counted")
check(X.check("shake", s) == set() and X.check("shake it off ariana grande", s) == set(), "half a title or a wrong artist doesn't count")
check(X.check("blank space", s) == set(), "another song doesn't count")
check(X.is_close("shake it", X.title_answers(s)) and not X.is_close("bad guy", X.title_answers(s)), "'so close' for nearly-right guesses only")
s = song("Señorita", "Shawn Mendes & Camila Cabello", also=["senorita"])
check(X.check("senorita", s) == {"t"} and X.check("camila cabello", s) == {"a"} and X.check("shawn mendes", s) == {"a"}, "accents, and either artist of a duet")
s = song("(I Can't Get No) Satisfaction", "The Rolling Stones")
check(X.check("satisfaction", s) == {"t"} and X.check("i cant get no satisfaction", s) == {"t"}, "the bit in brackets is optional")
check(X.check("rolling stones", s) == {"a"} and X.check("the rolling stones", s) == {"a"}, "'the' is optional")
s = song("Let It Go", "Idina Menzel", m="Frozen")
check(X.check("frozen", s) == {"a"} and X.check("idina menzel", s) == {"a"} and X.check("let it go", s) == {"t"}, "movie songs: the movie or the singer")
s = song("Peaches", "Jack Black", m="The Super Mario Bros. Movie")
check(X.check("super mario bros", s) == {"a"} and X.check("the super mario bros movie", s) == {"a"}, "a movie without 'the' or 'movie'")
s = song("Hold My Hand", "Lady Gaga", m="Top Gun: Maverick")
check(X.check("top gun maverick", s) == {"a"} and X.check("top gun", s) == {"a"}, "a movie's name before the colon")
s = song("Footloose", "Kenny Loggins", m="Footloose")
check(X.check("footloose", s) == {"t"} and X.check("kenny loggins", s) == {"a"} and not X.movie_counts(s), "when the song is named after its movie, the second answer is the singer")
s = song("The Greatest Show", "Hugh Jackman", m="The Greatest Showman")
check(X.check("the greatest show", s) == {"t"} and not X.movie_counts(s), "…also when the names are nearly the same")
s = song("TT", "TWICE")
check(X.check("tt", s) == {"t"} and X.check("t", s) == set() and X.check("ttt", s) == set(), "short titles have to be exact")
s = song("Y.M.C.A.", "Village People", also=["ymca"])
check(X.check("ymca", s) == {"t"} and X.check("Y.M.C.A", s) == {"t"}, "dots in a title")
s = song("September", "Earth, Wind & Fire")
check(X.check("earth wind and fire", s) == {"a"} and X.check("earth", s) == set(), "band names with & aren't split up")
s = song("7 rings", "Ariana Grande", also=["seven rings"])
check(X.check("seven rings", s) == {"t"} and X.check("7 rings", s) == {"t"}, "extra ways to write a title")
s = song("Bye Bye Bye", "*NSYNC", who=["nsync"])
check(X.check("nsync", s) == {"a"} and X.check("n sync", s) == {"a"}, "symbols in a band name")
check(X.mask("Don't Stop", X.first_letters("Don't Stop")) == "D__'_ S___", "masks keep spaces and punctuation, first letters only after a space")
check(X.mask("AC/DC", set()) == "__/__", "masks hide letters and digits")
check(X.check("x" * 80, song("Hello", "Adele")) == set(), "a silly long guess is fine")

# ------------------------------------------------------------------ the song list
songs, pls = G.SONGS, G.PLAYLISTS
check(len(songs) >= 300, f"{len(songs)} songs")
check(all(len(p["songs"]) >= 20 for p in pls.values()), "every playlist has at least 20 songs: " + ", ".join(f"{p['id']} {len(p['songs'])}" for p in pls.values()))
check(len(pls["mix"]["songs"]) == len(set(pls["mix"]["songs"])) == len(songs), "the mix has every song once")
check(all(len(p["songs"]) == len(set(p["songs"])) for p in pls.values()), "no song twice in a playlist")
check(all(v["p"].startswith("https://audio-ssl.itunes.apple.com/") for v in songs.values()), "every song has an iTunes preview")
check(all(v.get("art", "").startswith("https://") and "100x100bb" in v["art"] for v in songs.values()), "every song has a cover")
check(all(v.get("url", "").startswith("https://music.apple.com/") for v in songs.values()), "every song links to Apple Music")
check(all(1950 <= v["y"] <= 2026 for v in songs.values()), "years look right")
bad = [v["t"] for v in songs.values() if X.check(v["t"], v) != {"t"} or X.check(v["a"], v) != {"a"} or (v.get("m") and v["mc"] and X.check(v["m"], v) != {"a"})]
check(not bad, f"every song can be named by its own title and artist {bad[:5]}")
clash = [v["t"] for v in songs.values() if X.check(v["t"], v, need_title=False) & {"a"}]
check(not clash, f"no title also counts as its artist {clash[:5]}")

# ------------------------------------------------------------------ a game in type mode
a, b, c, w = M("a"), M("b"), M("c"), M("w", watching=True)
room = Room([a, b, c, w])
g = G.SongRush(room)
g.on_message(b, "settings", {"rounds": 5})
check(g.settings["rounds"] == 10, "only the host changes settings")
g.on_message(a, "settings", {"playlist": "nope", "rounds": 7, "time": 99, "mode": "sing"})
check(g.settings == {"playlist": "mix", "rounds": 10, "time": 20, "mode": "type"}, "bad settings are ignored")
g.on_message(a, "settings", {"playlist": "80s", "rounds": 5, "time": 20, "mode": "type"})
check(g.settings["playlist"] == "80s" and g.settings["rounds"] == 5, "settings change")
g.on_message(a, "start", {})
check(g.phase == "ready" and len(g.queue) == 5 and len(set(g.queue)) == 5 and all(q in pls["80s"]["songs"] for q in g.queue), "5 different songs from the playlist")
check("w" not in g.scores and set(g.scores) == {"a", "b", "c"}, "watchers don't play")
r = a.got("g:round")[-1]["round"]
check(r["url"] == songs[g.sid]["p"] and "title" not in r and "options" not in r, "the round sends the song but not the answer")
check(not any(ch.isalnum() for ch in r["hints"]["title"]), "the title starts fully hidden")
g.on_message(a, "guess", {"text": "early"})
check(not g.known.get("a"), "no guessing during the countdown")
g.play()
check(g.phase == "playing" and len(g.hint_timers) == 3, "the song plays with three hints coming")
S = songs[g.sid]
clock.now += 2
g.on_message(a, "guess", {"text": S["t"]})
check(g.known["a"] == {"t"} and a.got("g:answer")[-1]["title"] == S["t"], "A names the song")
pa = g.scores["a"]
check(pa == g.earned["a"]["t"] and pa > 450, f"fast + first = lots of points ({pa})")
clock.now += 0.1
g.on_message(a, "guess", {"text": S["a"]})
check("g:slow" in [t for t, _ in a.inbox] and g.known["a"] == {"t"}, "guessing too fast is refused")
clock.now += 8
g.on_message(b, "guess", {"text": S["t"]})
check(g.earned["b"]["t"] < g.earned["a"]["t"] - 150, "slower = fewer points, no first bonus")
n_chat, n_c = len(b.got("g:chat")), len(c.got("g:chat"))
g.on_message(a, "guess", {"text": "this one is easy"})
check(len(b.got("g:chat")) == n_chat + 1 and b.got("g:chat")[-1]["secret"], "players who know the title chat together")
check(len(c.got("g:chat")) == n_c, "…and players who don't, don't see it")
g.on_message(c, "guess", {"text": "no idea lol"})
check(a.got("g:chat")[-1]["text"] == "no idea lol" and w.got("g:chat")[-1]["text"] == "no idea lol", "everyone sees guesses from players who know nothing")
clock.now += 0.5
close = next((S["t"][:k] for k in range(len(S["t"]) - 1, 3, -1) if not X.is_match(S["t"][:k], X.title_answers(S))
              and not X.is_match(S["t"][:k], X.who_answers(S)) and X.is_close(S["t"][:k], X.title_answers(S))), None)
if close:
    before = len(a.got("g:chat"))
    g.on_message(c, "guess", {"text": close})
    check(c.got("g:close") and len(a.got("g:chat")) == before, "close guesses are private")
clock.now += 0.5
g.on_message(w, "guess", {"text": S["t"]})
check("w" not in g.known or not g.known["w"], "watchers can't score")
g.on_message(a, "guess", {"text": S["a"]})
g.on_message(b, "guess", {"text": S["a"]})
clock.now += 0.5
g.on_message(c, "guess", {"text": f"{S['t']} by {S['a']}"})
check(all(g.known[u] == {"t", "a"} for u in "abc"), "everyone got both")
check(any(t[0] == 1.0 for t in room.timers), "the round ends a second after everyone got it")
g.end_round()
rv = a.got("g:reveal")[-1]
check(g.phase == "reveal" and rv["reveal"]["song"]["t"] == S["t"] and rv["reveal"]["song"]["art"].endswith("600x600bb.jpg"), "the reveal shows the song and a big cover")
check(rv["reveal"]["next"] == songs[g.queue[1]]["p"], "the reveal tells browsers which song to load next")
check(g.streaks == {"a": 1, "b": 1, "c": 1}, "streaks count up")

# round 2: hints, then only A gets it; streak bonus
g.next_round(); g.play()
S2 = songs[g.sid]
g.give_hint(1)
hint = a.got("g:hint")[-1]["hints"]
check(hint["year"] == S2["y"] and "who" not in hint, "hint 1: the year")
g.give_hint(2)
hint = a.got("g:hint")[-1]["hints"]
check(hint["who"] and hint["title"][0] == S2["t"][0], "hint 2: first letters and the artist's initials")
g.give_hint(3)
check(g.shown > X.first_letters(S2["t"]) or len([ch for ch in S2["t"] if ch.isalnum()]) <= len(X.first_letters(S2["t"])) + 2, "hint 3: more letters")
clock.now += 15
g.on_message(a, "guess", {"text": S2["t"]})
check(g.earned["a"]["t"] >= 100 + 50, f"the streak adds a bonus ({g.earned['a']['t']})")
g.end_round()
check(g.streaks == {"a": 2, "b": 0, "c": 0}, "missing a song ends the streak")

# a song nobody can load is skipped
g.next_round()
bad_sid = g.sid
for m in (a, b):
    g.on_message(m, "bad", {"n": g.n})
check(g.phase == "ready", "one player's broken song doesn't skip it")
g.on_message(c, "bad", {"n": g.n})
check(g.phase == "reveal" and bad_sid in G.BROKEN and a.got("g:reveal")[-1]["skipped"], "a song nobody can load is skipped")
G.BROKEN.discard(bad_sid)

# late joiner, admin cheat, finish
d = M("d")
room.members["d"] = d
g.on_join(d, False)
check("d" in g.scores, "someone who joins mid-game can play")
g.next_round()
check("It's" in g.on_admin(a, "answer", {}) and songs[g.sid]["t"] in g.on_admin(a, "answer", {}), "admin cheat shows the answer")
g.play(); g.end_round()
g.next_round(); g.play(); g.end_round()
g.next_round()
check(g.phase == "over" and room.over, "the game ends after the last song")
fin = a.got("g:final")[-1]["final"]
check(fin["ranking"][0]["id"] == "a" and len(fin["songs"]) == 5, "final ranking and the list of songs played")
recs = {uid: (outcome, stats) for uid, _, outcome, stats in room.hub.records}
check(recs["a"][0] == "win" and recs["a"][1]["songs.correct"] == ("add", 2) and recs["b"][0] == "loss", f"results are saved {recs['a']}")

# ------------------------------------------------------------------ pick mode
a, b = M("a"), M("b")
room = Room([a, b])
g = G.SongRush(room)
g.on_message(a, "settings", {"playlist": "kpop", "mode": "pick", "rounds": 5, "time": 15})
g.on_message(a, "start", {})
check("options" not in a.got("g:round")[-1]["round"], "the choices only show when the song starts")
g.play()
opts = a.got("g:play")[-1]["round"]["options"]
check(len(opts) == 4 and len({o["t"] for o in opts}) == 4 and len({X.squash(o["a"]) for o in opts}) == 4, "four different songs by four different artists")
right = g.options.index(g.sid)
wrong = (right + 1) % 4
clock.now += 3
g.on_message(b, "pick", {"i": wrong})
g.on_message(b, "pick", {"i": right})
check(g.picks["b"] == (wrong, 0), "one pick each, a wrong one scores nothing")
check(not any(t[0] == 1.0 for t in room.timers), "the round waits for everyone")
g.on_message(a, "pick", {"i": right})
check(g.picks["a"][1] > 300 and g.scores["a"] == 0, "a right pick scores (shown at the reveal)")
check(any(t[0] == 1.0 for t in room.timers), "everyone picked: the round ends")
g.end_round()
rv = a.got("g:reveal")[-1]["reveal"]
check(g.scores["a"] == g.picks["a"][1] and g.scores["b"] == 0, "pick points are added at the reveal")
check(rv["answer"] == right and rv["results"]["a"]["ok"] and not rv["results"]["b"]["ok"], "the reveal shows who was right")
check(g.streaks == {"a": 1, "b": 0}, "pick streaks")
check(all(len(set(g.decoys(s)) | {s}) == 4 for s in random.sample(pls["kpop"]["songs"], 10)), "decoys are always three other songs")

print("FAILED:", failed)
