"""Motocross against a real server: solo best times per track (and impossible ones turned away),
flips, the leaderboards, bike paint jobs, and an online race: ready-up, the countdown, positions passed on,
finish times checked, places and the saved results."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, json, random, time
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

    # bike paint jobs are rewards you wear: finishing tracks and races unlocks more
    r = await req(a, "account:look", look={"bike": "chrome"})
    check(not r["ok"], "a locked paint job can't be worn")
    r = await req(a, "account:look", look={"bike": "camo"})
    check(r["ok"] and r["user"]["look"].get("bike") == "camo", "finishing Desert Dunes unlocks Desert Camo")
    r = await req(a, "account:look", look={"bike": "orange"})
    check(r["ok"], "finishing any track unlocks Sunset Orange")
    r = await req(a, "account:look", look={"bike": "factory"})
    check(r["ok"] and r["user"]["look"].get("bike") == "factory", "the factory bike is free")

    # ---------------------------------------------------------------- an online race
    nb = "MotoB" + U
    b = await player("mbotB" + U + "x", nb)
    a.send({"t": "room:create", "game": "moto"}); j = await a.wait("room:joined")
    check(j["state"]["phase"] == "lobby" and j["state"]["min"] == 2, "a new room waits in the lobby")
    b.send({"t": "room:join", "code": j["code"], "game": "moto"}); jb = await b.wait("room:joined")
    pa = next(p for p in jb["players"] if p["id"] == a.uid)
    check(pa.get("bike") == "factory", "the others can see which bike you ride")
    await asyncio.sleep(0.2)
    # bike styles (looks only) are passed on, tidied up
    a.send({"t": "g:style", "style": {"model": "retro", "rider": "mx", "kit": "galaxy", "helmet": "<b>x", "number": 77}})
    lob = await b.wait("g:lobby")
    check(lob["styles"].get(a.uid) == {"model": "retro", "rider": "mx", "kit": "galaxy", "number": 77}, f"a rider's bike style reaches the others ({lob['styles'].get(a.uid)})")
    b.send({"t": "g:settings", "track": "snow"}); a.send({"t": "g:settings", "track": "desert"})
    await asyncio.sleep(0.3)
    lob = [m for m in a.drain() if m["t"] == "g:lobby"]
    check(lob and lob[-1]["settings"]["track"] == "desert", "only the host picks the track")
    a.send({"t": "g:start"}); await asyncio.sleep(0.3)
    errs = [m for m in a.drain() if m["t"] == "error"]
    check(errs and "Waiting for" in errs[-1]["msg"], "the host can't start before everyone is ready")
    a.send({"t": "g:ready", "ready": True}); await asyncio.sleep(0.3)
    check(not [m for m in b.drain() if m["t"] == "g:start"], "one rider ready isn't enough")
    b.send({"t": "g:ready", "ready": True})
    st = await a.wait("g:start")
    race = st["race"]
    check(race["track"] == "desert" and set(race["runners"]) == {a.uid, b.uid} and st["countdown"] >= 3, "everyone ready: a 3-2-1 countdown on the desert track")
    t0 = time.time()
    b.drain()
    # positions are passed on to the other rider
    a.send({"t": "g:pos", "x": 40.5, "px": 70.5, "pz": -3.25, "h": 0.4, "ro": -0.2, "y": 0.6, "a": 0.1, "rx": -0.1, "ry": 0.4,
            "c0": 0.07, "c1": 0.08, "l": 0.2, "s": 55, "r": 9000, "th": 1, "cp": -1, "tk": 0, "tp": 0.8, "wh": 0, "sp": 1.5})
    p = await b.wait("g:pos")
    check(p["id"] == a.uid and p["x"] == 40.5 and p["px"] == 70.5 and p["pz"] == -3.25 and p["h"] == 0.4 and p["ro"] == -0.2
          and p["r"] == 9000 and not p["k"], "a rider's position (in 3D) reaches the others")
    check(p["tk"] == 0 and p["tp"] == 0.8 and p["sp"] == 1.5, "their air trick (a Superman, mid-360) reaches the others too")
    a.send({"t": "g:pos", "x": 1e9, "y": "up", "a": 0, "rx": 0, "ry": 0, "c0": 0, "c1": 0, "l": 0, "s": 0, "tk": 99, "tp": 5})
    p = await b.wait("g:pos")
    check(p["x"] <= 5000 and p["y"] == 0 and p["tk"] == 7 and p["tp"] == 1, "nonsense positions (and tricks) are tamed")
    # a finish time that's too fast is turned away
    a.drain()
    a.send({"t": "g:finish", "time": 20000, "cp": 2, "crashes": 0, "flips": 1})
    toast = await a.wait("g:toast")
    check("didn't look right" in toast["text"], "an impossible finish time doesn't count")
    # a real one (after the race has really been going that long)
    real = 39.0
    await asyncio.sleep(max(0, t0 + st["countdown"] + real - time.time()))
    a.send({"t": "g:finish", "time": int(real * 1000), "cp": 2, "crashes": 1, "flips": 2})
    f = await b.wait("g:finish")
    check(f["id"] == a.uid and f["place"] == 1, "A crosses the line first")
    hurry = await b.wait("g:hurry")
    check(hurry["seconds"] == 30, "the others get 30 seconds to finish")
    a.send({"t": "g:stop"})
    res = await b.wait("g:results")
    rows = res["results"]["rows"]
    check(rows[0]["id"] == a.uid and rows[0]["done"] and rows[1]["id"] == b.uid and not rows[1]["done"], "results: A won, B didn't finish")
    await asyncio.sleep(0.5)
    sa, sb = await stats(a, na), await stats(b, nb)
    check(sa.get("moto.wins") == 1 and sa.get("moto.races") == 1 and sa.get("moto.podiums") == 1 and sa.get("motodesert.best") == 39000,
          f"A's win and best time are saved ({sa.get('moto.wins')}, {sa.get('motodesert.best')})")
    check(sa.get("moto.flips") == 65, f"flips from the race add up ({sa.get('moto.flips')})")
    check(sb.get("moto.races") == 1 and not sb.get("moto.wins") and not sb.get("motodesert.best"), "B's race counts, with no time")
    # after the race: ready again for the next one
    lob = [m for m in getattr(b, "pushed", []) + b.drain() if m["t"] == "g:lobby"]
    check(lob and lob[-1]["phase"] == "results" and not any(lob[-1]["ready"].values()), "after the race everyone readies up again")
    # everyone voting "play again" starts the next race
    a.send({"t": "room:vote", "choice": "again"}); b.send({"t": "room:vote", "choice": "again"})
    st2 = await a.wait("g:start")
    check(st2["race"]["track"] == "desert" and set(st2["race"]["runners"]) == {a.uid, b.uid}, "voting “play again” starts the next race")
    a.send({"t": "g:stop"}); await a.wait("g:results")

    # ---------------------------------------------------------------- challenges: the room rides an open-world challenge
    b.send({"t": "g:settings", "mode": "challenge", "challenge": "pine-flips"})   # (not the host: ignored)
    a.send({"t": "g:settings", "mode": "challenge", "challenge": "red-big-air"})
    await asyncio.sleep(0.3)
    lob = [m for m in a.drain() if m["t"] == "g:lobby"]
    check(lob and lob[-1]["settings"]["mode"] == "challenge" and lob[-1]["settings"]["challenge"] == "red-big-air", "the host switches the room to a challenge")
    a.send({"t": "g:ready", "ready": True}); b.send({"t": "g:ready", "ready": True})
    st3 = await a.wait("g:start")
    race = st3["race"]
    check(race.get("challenge") == "red-big-air" and race.get("kind") == "air" and race.get("limit") == 90 and set(race["runners"]) == {a.uid, b.uid},
          "everyone ready: the Big Air challenge starts for both")
    await asyncio.sleep(st3["countdown"] + 0.2)
    b.drain()
    a.send({"t": "g:score", "score": 2.5}); s1 = await b.wait("g:score")
    check(s1["id"] == a.uid and s1["score"] == 2.5, "a rider's best jump reaches the others")
    await asyncio.sleep(0.2); a.drain()
    a.send({"t": "g:score", "score": 1.0}); b.send({"t": "g:score", "score": 999}); await asyncio.sleep(0.3)
    check(not [m for m in a.drain() if m["t"] == "g:score"], "a worse score isn't kept and an impossible one is ignored")
    b.send({"t": "g:score", "score": 3.1}); s2 = await a.wait("g:score")
    check(s2["id"] == b.uid and s2["score"] == 3.1, "a better jump takes the lead")
    a.send({"t": "g:finish", "time": 5000}); toast = await a.wait("g:toast")
    check("didn't look right" in toast["text"], "a timed challenge has no finish line to cross")
    a.send({"t": "g:stop"})
    res = await b.wait("g:results")
    rr = res["results"]
    check(rr.get("challenge") == "red-big-air" and rr["rows"][0]["id"] == b.uid and rr["rows"][0]["place"] == 1 and rr["rows"][1]["place"] == 2,
          "challenge results: the longest jump wins")
    await asyncio.sleep(0.5)
    sa, sb = await stats(a, na), await stats(b, nb)
    check(sa.get("moto.challenges") == 1 and sb.get("moto.cwins") == 1, f"challenges and wins are saved ({sa.get('moto.challenges')}, {sb.get('moto.cwins')})")
    # a race challenge: a time faster than anyone could ride the course is turned away
    a.send({"t": "g:settings", "challenge": "frost-downhill"}); await asyncio.sleep(0.2)
    a.send({"t": "g:ready", "ready": True}); b.send({"t": "g:ready", "ready": True})
    st4 = await a.wait("g:start")
    check(st4["race"].get("challenge") == "frost-downhill" and st4["race"].get("kind") == "race", "the downhill race challenge starts")
    a.drain()
    a.send({"t": "g:finish", "time": 3000}); toast = await a.wait("g:toast")
    check("didn't look right" in toast["text"], "a downhill time faster than possible doesn't count")
    a.send({"t": "g:stop"}); await a.wait("g:results")

    # ---------------------------------------------------------------- free ride together: no race, hop in and out
    a.send({"t": "g:settings", "mode": "free", "world": "frostpeak"}); await asyncio.sleep(0.3)
    lob = [m for m in a.drain() if m["t"] == "g:lobby"]
    check(lob and lob[-1]["settings"]["mode"] == "free" and lob[-1]["settings"]["world"] == "frostpeak" and lob[-1]["min"] == 1,
          "the host switches the room to a free ride on Frostpeak (one rider is enough)")
    a.send({"t": "g:settings", "world": "atlantis"}); await asyncio.sleep(0.2)
    lob = [m for m in a.drain() if m["t"] == "g:lobby"]
    check(not lob or lob[-1]["settings"]["world"] == "frostpeak", "an unknown world can't be picked")
    a.send({"t": "g:style", "style": {"model": "retro", "car": "aventador", "paint": "verde"}}); await asyncio.sleep(0.2)
    a.send({"t": "g:ready", "ready": True}); b.send({"t": "g:ready", "ready": True})
    st5 = await a.wait("g:start")
    check(st5["race"].get("free") == "frostpeak" and st5["race"].get("kind") == "free" and set(st5["race"]["runners"]) == {a.uid, b.uid},
          "everyone ready: the free ride starts for both")
    b.drain()
    a.send({"t": "g:pos", "x": 12, "px": 5, "pz": 6, "h": 1, "ro": 0.3, "y": 400, "a": 0.2, "c0": 0.1, "c1": 0.12, "s": 80,
            "v": 1, "st": 0.5, "c2": 0.13, "c3": 9})
    p = await b.wait("g:pos")
    check(p["v"] == 1 and p["st"] == 0.5 and p["c2"] == 0.13 and p["c3"] == 2 and p["ro"] == 0.3, "a supercar's pose (steering, all four springs) reaches the others")
    b.send({"t": "g:style", "style": {"model": "mx4", "mtb": "tyax"}})
    st_ = await a.wait("g:lobby")
    b.send({"t": "g:pos", "x": 3, "px": 1, "pz": 2, "h": 0.5, "y": 300, "a": 0.1, "c0": 0.1, "c1": 0.1, "s": 30, "th": 1, "v": 2})
    p = await a.wait("g:pos")
    check(p.get("v") == 2 and p["th"] == 1 and st_["styles"].get(b.uid, {}).get("mtb") == "tyax",
          "a mountain bike rides the free ride with the dirt bikes: the others see it (and which one), pedalling")
    nc = "MotoC" + U
    c = await player("mbotC" + U + "x", nc)
    c.send({"t": "room:join", "code": j["code"], "game": "moto"}); jc = await c.wait("room:joined")
    check(jc["state"]["phase"] == "racing" and jc["state"]["race"].get("free") == "frostpeak", "someone joining the room sees the free ride that's on")
    check(jc["state"]["styles"].get(a.uid, {}).get("car") == "aventador", "and which supercar the others drive")
    c.send({"t": "g:hop"})
    sc = await c.wait("g:start"); hop = await a.wait("g:hop")
    check(c.uid in sc["race"]["runners"] and hop["id"] == c.uid, "they hop straight in, and the others hear about it")
    b.send({"t": "g:part"}); part = await a.wait("g:part")
    check(part["id"] == b.uid, "a rider going back to the room leaves the ride")
    b.send({"t": "g:stop"}); await asyncio.sleep(0.3)
    check(not [m for m in a.drain() if m["t"] == "g:freeEnd"], "only the host can end the free ride")
    a.send({"t": "g:stop"}); await c.wait("g:freeEnd")
    lob = await c.wait("g:lobby")
    check(lob["phase"] == "lobby", "the host ends it: everyone is back in the room")
    a.send({"t": "g:ready", "ready": True}); b.send({"t": "g:ready", "ready": True}); c.send({"t": "g:ready", "ready": True})
    await a.wait("g:start")
    a.send({"t": "g:part"}); b.send({"t": "g:part"}); c.send({"t": "g:part"})
    await a.wait("g:freeEnd")
    check(True, "the free ride ends by itself when the last rider leaves")
    c.send({"t": "room:leave"})
    a.send({"t": "room:leave"}); b.send({"t": "room:leave"}); await asyncio.sleep(0.2)
    print("FAILED:", check.failed)

asyncio.run(main())
