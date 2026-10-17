"""Song Rush against a real server: a game in type mode and one in pick mode, with two players."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, json, random
from wsbot import WS
from accbot import req, check

U = str(random.randint(1000, 9999))
SONGS = json.load(open(_os.path.join(_os.path.dirname(_HERE), "games", "songs", "songs.json")))["songs"]
BY_URL = {v["p"]: v for v in SONGS.values()}


async def player(uid, name):
    w = WS(); await w.connect(uid, name)
    w.uid = (await w.wait("welcome"))["id"]
    r = await req(w, "auth:signup", name=name, password="pass" + name + "x")
    assert r["ok"], r
    return w


async def stats(w, name):
    return (await req(w, "profile:get", name=name))["profile"]["stats"]


def chats(w, text):
    return [m for m in w.drain() if m["t"] == "g:chat" and m.get("text") == text]


async def main():
    na, nb = "SongA" + U, "SongB" + U
    a, b = await player("sbotA" + U + "x", na), await player("sbotB" + U + "x", nb)
    a.send({"t": "room:create", "game": "songs"}); j = await a.wait("room:joined")
    check(j["state"]["phase"] == "lobby" and len(j["state"]["playlists"]) >= 10, "the lobby lists the playlists")
    b.send({"t": "room:join", "code": j["code"], "game": "songs"}); await b.wait("room:joined")
    await asyncio.sleep(0.2)

    # junk messages don't break anything
    for msg in ({"t": "g:pick", "i": "x"}, {"t": "g:guess", "text": {"a": 1}}, {"t": "g:settings", "rounds": "lots"}, {"t": "g:bad", "n": None}):
        a.send(msg)
    b.send({"t": "g:start"})
    await asyncio.sleep(0.3)
    a.drain()
    a.send({"t": "g:settings", "playlist": "2010s", "rounds": 5, "time": 15, "mode": "type"})
    s = await a.wait("g:settings"); check(s["settings"]["playlist"] == "2010s" and s["settings"]["rounds"] == 5, "host sets up the game")
    check(not [m for m in b.drain() if m["t"] == "g:round"], "only the host can start")

    a.send({"t": "g:start"})
    for i in range(5):
        r = (await a.wait("g:round", timeout=15))["round"]
        song = BY_URL.get(r["url"])
        check(song is not None and "title" not in r, f"type round {i + 1}: a song from the list, answer hidden")
        await a.wait("g:play", timeout=6); await b.wait("g:play", timeout=6)
        b.send({"t": "g:guess", "text": "definitely not it"})
        await asyncio.sleep(0.1)
        a.send({"t": "g:guess", "text": song["t"].upper()})
        ans = await a.wait("g:answer")
        check(ans["title"] == song["t"] and ans["pts"] > 0, f"A names the song (+{ans['pts']})")
        if i == 0:
            await asyncio.sleep(0.4); a.drain(); b.drain()
            a.send({"t": "g:guess", "text": "psst secret"})
            b.send({"t": "g:guess", "text": "help me"})
            await asyncio.sleep(0.3)
            check(not chats(b, "psst secret"), "B can't read what A says after A got the song")
            check(chats(a, "help me"), "A can read B's guesses")
        await asyncio.sleep(0.4)
        a.send({"t": "g:guess", "text": song.get("m") or song["a"]})
        b.send({"t": "g:guess", "text": f"{song['t']} by {song['a']}"})
        rv = (await a.wait("g:reveal", timeout=6))["reveal"]
        check(rv["song"]["t"] == song["t"] and rv["results"][a.uid]["t"] > rv["results"][b.uid]["t"], "the round ends early and A, who was faster, got more")
    fin = (await a.wait("g:final", timeout=20))["final"]
    check(fin["ranking"][0]["name"] == na and len(fin["songs"]) == 5, "A wins the type-mode game")
    await asyncio.sleep(0.6)
    st = await stats(a, na)
    check(st.get("songs.games") == 1 and st.get("songs.wins") == 1 and st.get("songs.correct") == 5, f"A's stats {st}")
    st = await stats(b, nb)
    check(st.get("songs.games") == 1 and not st.get("songs.wins") and st.get("songs.correct") == 5, f"B's stats {st}")

    # pick mode
    a.send({"t": "g:settings", "playlist": "90s", "rounds": 5, "time": 15, "mode": "pick"}); await a.wait("g:settings")
    a.send({"t": "g:start"})
    for i in range(5):
        r = (await a.wait("g:round", timeout=15))["round"]
        song = BY_URL[r["url"]]
        opts = (await a.wait("g:play", timeout=6))["round"]["options"]
        right = next(k for k, o in enumerate(opts) if o["t"] == song["t"] and o["a"] == song["a"])
        b.send({"t": "g:pick", "i": (right + 1) % 4})
        await asyncio.sleep(0.2)
        a.send({"t": "g:pick", "i": right})
        rv = (await a.wait("g:reveal", timeout=6))["reveal"]
        check(rv["answer"] == right and rv["results"][a.uid]["ok"] and not rv["results"][b.uid]["ok"], f"pick round {i + 1}: A right, B wrong")
    fin = (await a.wait("g:final", timeout=20))["final"]
    check(fin["ranking"][0]["name"] == na and fin["ranking"][1]["points"] == 0, "A wins the pick-mode game, B scores nothing")
    await asyncio.sleep(0.6)
    st = await stats(a, na)
    check(st.get("songs.games") == 2 and st.get("songs.wins") == 2 and st.get("songs.correct") == 10, f"A's stats after two games {st}")
    a.send({"t": "room:leave"}); b.send({"t": "room:leave"}); await asyncio.sleep(0.2)
    print("FAILED:", check.failed)

asyncio.run(main())
