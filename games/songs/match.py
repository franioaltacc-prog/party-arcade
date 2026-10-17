"""Song Rush answer checking: forgiving about capitals, accents, punctuation, "the", "feat." bits and small typos."""
import re
import unicodedata

NO_SPLIT = {"earth, wind & fire", "kool & the gang", "tegan and sara", "simon & garfunkel"}


def words(s):
    """'Señorita (feat. X)!' -> 'senorita feat x'"""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ").replace("$", "s").replace("+", " and ")
    s = re.sub(r"['’`]", "", s)          # don't -> dont
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def squash(s):
    return words(s).replace(" ", "")


def _variants(name):
    """One answer written a few acceptable ways."""
    out = {name}
    no_brackets = re.sub(r"\s*[\(\[][^)\]]*[\)\]]\s*", " ", name).strip()
    if no_brackets:
        out.add(no_brackets)
    for v in list(out):
        w = words(v)
        if w.startswith("the ") and len(w) > 6:
            out.add(w[4:])
    return {squash(v) for v in out if squash(v)}


def title_answers(song):
    out = _variants(song["t"])
    for alt in song.get("also", ()):
        out |= _variants(alt)
    return out


def artist_names(artist):
    if artist.lower() in NO_SPLIT:
        return [artist]
    parts = re.split(r"\s*(?:&|,|\bfeat\.?|\bx\b)\s*", artist)
    names = [artist] + [p for p in parts if len(squash(p)) >= 3] if len(parts) > 1 else [artist]
    return names


def movie_variants(movie):
    short = re.split(r":", movie)[0]
    return _variants(movie) | _variants(short) | _variants(re.sub(r"\bmovie\b", "", short, flags=re.I))


def movie_counts(song):
    """Soundtrack songs: the movie is the second answer, unless it's (nearly) the song's own name
    ("Footloose" from Footloose), which would give two answers for one guess. Then it's the singer."""
    movie = song.get("m")
    if not movie:
        return False
    titles = title_answers(song)
    return not any(distance(v, t, typos_allowed(len(t))) <= typos_allowed(len(t)) for v in movie_variants(movie) for t in titles)


def who_answers(song):
    """The second answer: the artist, or the movie for soundtrack songs (either one counts)."""
    out = set()
    for name in artist_names(song["a"]) + list(song.get("who", ())):
        out |= _variants(name)
    movie = song.get("m")
    if movie and movie_counts(song):
        out |= movie_variants(movie)
    return {a for a in out if a}


def typos_allowed(n):
    return 0 if n <= 4 else 1 if n <= 8 else 2 if n <= 14 else 3


def distance(a, b, cap):
    """Edit distance, giving up (returns cap + 1) once it's clearly more than cap."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        best = cur[0]
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            best = min(best, cur[j])
        if best > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def is_match(guess, answers):
    g = squash(guess)
    if not g:
        return False
    return any(distance(g, a, typos_allowed(len(a))) <= typos_allowed(len(a)) for a in answers)


def is_close(guess, answers):
    """Nearly right: a couple more typos than allowed, or most of the start of a long answer."""
    g = squash(guess)
    if len(g) < 3:
        return False
    for a in answers:
        cap = typos_allowed(len(a)) + 2
        if len(a) >= 5 and distance(g, a, cap) <= cap:
            return True
        if len(a) >= 8 and len(g) >= max(4, len(a) // 2) and a.startswith(g):
            return True
    return False


def check(guess, song, need_title=True, need_who=True):
    """What a guess gets right: a set with "t" (title) and/or "a" (artist or movie).
    A guess can name both, e.g. "shake it off taylor swift" or "shake it off by taylor swift"."""
    titles, whos = title_answers(song), who_answers(song)
    got = set()
    if need_title and is_match(guess, titles):
        got.add("t")
    if need_who and is_match(guess, whos):
        got.add("a")
    if got:
        return got
    w = words(guess).split()
    if len(w) < 2 or len(w) > 16:
        return got
    for i in range(1, len(w)):
        left, right = w[:i], w[i:]
        if right and right[0] == "by":
            right = right[1:]
        if left and left[-1] == "by":
            left = left[:-1]
        if not left or not right:
            continue
        lj, rj = " ".join(left), " ".join(right)
        for first, second in ((lj, rj), (rj, lj)):
            t_ok = is_match(first, titles)
            a_ok = is_match(second, whos)
            if t_ok and a_ok:
                return {k for k, need in (("t", need_title), ("a", need_who)) if need}
    return got


def mask(text, shown=()):
    """'Shake It Off' -> 'S____ __ O__' with the letters at the `shown` positions visible."""
    return "".join(ch if (i in shown or not ch.isalnum()) else "_" for i, ch in enumerate(text))


def first_letters(text):
    return {i for i, ch in enumerate(text) if ch.isalnum() and (i == 0 or not text[i - 1].isalnum() and text[i - 1] != "'")}
