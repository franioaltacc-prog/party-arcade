"""Motocross against a real server: solo best times per track (and impossible ones turned away),
flips and the leaderboards."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, json, random
from wsbot import WS
from accbot import req, check

U = str(random.randint(1000, 9999))
TRACKS = json.load(open(_os.path.join(_os.path.dirname(_HERE), "public", "js", "games", "moto", "tracks.json")))["tracks"]


async def player(uid, name):
    w = WS(); await w.connect(uid, name)
    w.uid = (await w.wait("welcome"))["id"]
    r = await req(w, "auth:signup", name=name, password="pass" + name + "x")
    assert r["ok"], r
    return w


async def stats(w, name):
    return (await req(w, "profile:get", name=name))["profile"]["stats"]


async def solo(w, game, ms, **extra):
    await asyncio.sleep(4.1)   # (the server allows one solo score every 4 seconds)
    return await req(w, "stats:solo", game=game, value=ms, **({"extra": extra} if extra else {}))


async def main():
    na = "MotoA" + U
    a = await player("mbotA" + U + "x", na)
    desert = next(t for t in TRACKS if t["id"] == "desert")
    fastest = int(desert["robot"] * 0.7 * 1000)

    # solo time trials
    r = await solo(a, "moto-desert", fastest - 500)
    check(not r["ok"], "a desert time faster than possible is turned away")
    r = await solo(a, "moto-desert", 71234, flips=2)
    check(r["ok"] and r["best"], "a real desert time is saved as a best")
    r = await solo(a, "moto-desert", 75000, flips=1)
    check(r["ok"] and not r["best"], "a slower time isn't a new best")
    st = await stats(a, na)
    check(st.get("motodesert.best") == 71234 and st.get("motodesert.wins") == 2, f"best time and finishes per track ({st.get('motodesert.best')}, {st.get('motodesert.wins')})")
    check(st.get("moto.finishes") == 2 and st.get("moto.flips") == 3, f"finishes and flips add up ({st.get('moto.finishes')}, {st.get('moto.flips')})")
    r = await solo(a, "moto-snow", 80000, flips=999)
    st = await stats(a, na)
    check(r["ok"] and st.get("moto.flips") == 63, f"flips are capped per ride ({st.get('moto.flips')})")
    r = await solo(a, "moto-mars", 80000)
    check(not r["ok"], "an unknown track is turned away")

    # leaderboards: one per track, plus wins and flips
    r = await req(a, "lb:boards")
    keys = {b["key"] for b in r["boards"]}
    check({"moto", "moto_flips"} <= keys and all(f"moto_{t['id']}" in keys for t in TRACKS), "every track has a leaderboard")
    r = await req(a, "lb:get", board="moto_desert")
    rows = r["board"]["rows"]
    check(rows and rows[0]["name"] == na and rows[0]["value"] == 71234, "the desert board shows the best time")

    a.send({"t": "room:leave"}); await asyncio.sleep(0.1)
    print("FAILED:", check.failed)

asyncio.run(main())
