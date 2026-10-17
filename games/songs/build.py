"""Build songs.json for Song Rush from playlists.txt.

Every song is looked up in the iTunes Search API (clean versions only), which gives a 30-second preview,
the album cover and an Apple Music link. Run it again after changing playlists.txt:

    python3 games/songs/build.py            # looks up new songs (searches are cached in data/)
    python3 games/songs/build.py --check    # also lists matches worth a second look

Apple allows roughly 20 searches a minute, so a first full build takes a while.
"""
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = ROOT / "data" / "songs_search_cache.json"
OUT = HERE / "songs.json"
SEARCH = "https://itunes.apple.com/search?"
PAUSE = 3.2   # seconds between searches
BAD_WORDS = ("live", "karaoke", "instrumental", "remix", "acoustic", "cover", "tribute", "sped up", "slowed",
             "made famous", "originally performed", "in the style of", "piano version", "demo", "a cappella",
             "extended", "mix", "commentary", "reprise", "medley", "8-bit", "lullaby", "re-recorded", "new version")
OK_WORDS = ("radio edit", "radio mix", "single mix", "original mix", '7" mix', "single version", "album version")   # the versions people know
SMALL = {"the", "and", "a", "of"}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ").replace("$", "s")
    s = re.sub(r"['’`]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def base_title(s):
    """'Señorita (feat. X) - Remastered 2011' -> 'Señorita'."""
    s = re.sub(r"\s*(\((tm|TM)\)|™)", "", s)
    s = re.sub(r"\s*[\(\[][^)\]]*(feat|with|from|remaster|version|edit|mono|stereo|soundtrack|motion picture|mix|official|single)[^)\]]*[\)\]]", "", s, flags=re.I)
    s = re.sub(r"\s+-\s+.*(remaster|version|edit|mono|stereo|from|live|mix).*$", "", s, flags=re.I)
    return s.strip()


def parse(path):
    playlists, cur = [], None
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@"):
            pid, emoji, name, desc = [p.strip() for p in line[1:].split("|")]
            cur = {"id": pid, "emoji": emoji, "name": name, "desc": desc, "songs": []}
            playlists.append(cur)
            continue
        cols = [p.strip() for p in line.split("|")]
        song = {"year": int(cols[0]), "artist": cols[1], "title": cols[2], "movie": None, "also": [], "who": [], "find": None}
        for extra in cols[3:]:
            key, _, val = extra.partition(":")
            key, val = key.strip(), val.strip()
            if key == "movie":
                song["movie"] = val
            elif key in ("also", "who"):
                song[key] = [v.strip() for v in val.split(";") if v.strip()]
            elif key == "find":
                song["find"] = val
            else:
                raise SystemExit(f"Unknown column {key!r} in: {raw}")
        cur["songs"].append(song)
    return playlists


def primary(artist):
    return re.split(r"\s*(?:&|,| feat\.? | x | and )\s*", artist, maxsplit=1)[0]


def score(song, r):
    want_t, want_a = norm(base_title(song["title"])), norm(primary(song["artist"]))
    got_t, got_full = norm(base_title(r.get("trackName", ""))), norm(r.get("trackName", ""))
    got_a = norm(r.get("artistName", ""))
    s = 0
    if got_t == want_t:
        s += 60
    elif got_t.startswith(want_t) or want_t.startswith(got_t):
        s += 25
    elif want_t in got_full:
        s += 10
    else:
        return -999
    if want_a and want_a in got_a:
        s += 40
    elif (set(want_a.split()) & set(got_a.split())) - SMALL:
        s += 12
    elif song["movie"]:
        s += 5   # soundtrack credits vary a lot
    else:
        s -= 30
    text = (r.get("trackName", "") + " " + r.get("collectionName", "")).lower()
    for w in OK_WORDS:
        text = text.replace(w, "")
    mine = song["title"].lower()
    for w in BAD_WORDS:
        if w in text and w not in mine:
            s -= 35
    if "taylor's version" in text and "taylor's version" not in mine:
        s -= 4
    if r.get("collectionArtistName") == "Various Artists":
        s -= 3
    if r.get("trackExplicitness") == "explicit":
        return -999
    if not r.get("previewUrl"):
        return -999
    year = int((r.get("releaseDate") or "9999")[:4])
    s -= max(0, year - song["year"]) * 0.2   # prefer the original release over later reissues
    return s


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.URLError as e:
        if "CERTIFICATE" not in str(e):
            raise
    # this Python has no certificates installed (a fresh python.org install on a Mac): let curl do it
    out = subprocess.run(["curl", "-sSf", "-m", "20", url], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def search(term, cache):
    if term in cache:
        return cache[term]
    q = urllib.parse.urlencode({"term": term, "entity": "song", "limit": 25, "country": "US", "explicit": "No", "media": "music"})
    for attempt in range(5):
        try:
            data = fetch(SEARCH + q)
            break
        except Exception as e:
            print(f"   ...{e}; waiting a minute", flush=True)
            time.sleep(60)
    else:
        raise SystemExit("iTunes search keeps failing")
    cache[term] = data.get("results", [])
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache))
    time.sleep(PAUSE)
    return cache[term]


def main():
    check = "--check" in sys.argv
    playlists = parse(HERE / "playlists.txt")
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    songs, chosen, missing, doubtful = {}, {}, [], []
    total = sum(len(p["songs"]) for p in playlists)
    done = 0
    for pl in playlists:
        ids = []
        for song in pl["songs"]:
            done += 1
            key = (song["artist"].lower(), song["title"].lower())
            if key not in chosen:
                term = song["find"] or f"{primary(song['artist'])} {base_title(song['title'])}"
                print(f"[{done}/{total}] {song['artist']} - {song['title']}", flush=True)
                results = search(term, cache)
                best = max(results, key=lambda r: score(song, r), default=None)
                if not best or score(song, best) < 40:
                    if song["find"] is None:   # a second try with just the title
                        results = search(base_title(song["title"]), cache)
                        best = max(results, key=lambda r: score(song, r), default=None)
                if not best or score(song, best) < 40:
                    missing.append(f"{pl['id']}: {song['artist']} - {song['title']}")
                    chosen[key] = None
                    continue
                chosen[key] = best
                got_year = int(best["releaseDate"][:4])
                if score(song, best) < 70 or abs(got_year - song["year"]) > 1:
                    doubtful.append(f"{song['artist']} - {song['title']} ({song['year']})  ->  {best['artistName']} - "
                                    f"{best['trackName']} [{best['collectionName']}, {got_year}] score {score(song, best):.0f}")
            best = chosen[key]
            if not best:
                continue
            tid = str(best["trackId"])
            entry = songs.setdefault(tid, {
                "t": song["title"], "a": song["artist"], "y": song["year"], "m": None, "also": [], "who": [],
                "p": best["previewUrl"], "art": best.get("artworkUrl100", ""), "url": best.get("trackViewUrl", ""),
                "album": best.get("collectionName", ""), "g": best.get("primaryGenreName", ""),
            })
            if song["movie"]:
                entry["m"] = song["movie"]
            entry["also"] = sorted(set(entry["also"]) | set(song["also"]))
            entry["who"] = sorted(set(entry["who"]) | set(song["who"]))
            if tid not in ids:
                ids.append(tid)
        pl_out = {k: pl[k] for k in ("id", "emoji", "name", "desc")}
        pl_out["songs"] = ids
        pl["out"] = pl_out
    for e in songs.values():
        if not e["m"]:
            del e["m"]
        for k in ("also", "who"):
            if not e[k]:
                del e[k]
    OUT.write_text(json.dumps({"built": time.strftime("%Y-%m-%d"), "playlists": [p["out"] for p in playlists], "songs": songs},
                              ensure_ascii=False, indent=0, sort_keys=False) + "\n")
    print(f"\n{len(songs)} songs in {len(playlists)} playlists -> {OUT.relative_to(ROOT)}")
    for p in playlists:
        print(f"  {p['emoji']} {p['name']}: {len(p['out']['songs'])}")
    if missing:
        print("\nNot found (left out):\n  " + "\n  ".join(missing))
    if check and doubtful:
        print("\nWorth a second look:\n  " + "\n  ".join(doubtful))


if __name__ == "__main__":
    main()
