import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, json, random, re, shutil, subprocess, time
from wsbot import WS
from accbot import req, check
from games import flappy as F
U = str(random.randint(1000, 9999))
ROOT = _os.path.dirname(_HERE)


async def wait_for(ws, t, timeout=5, pred=None):
    end = time.time() + timeout
    while True:
        m = await asyncio.wait_for(ws.inbox.get(), max(0.01, end - time.time()))
        if m["t"] == t and (pred is None or pred(m)):
            return m


async def none_of(ws, t, wait=0.6):
    """True if no message of type t arrives within `wait` seconds."""
    try:
        await wait_for(ws, t, wait)
        return False
    except asyncio.TimeoutError:
        return True


def same_numbers_as_the_browser():
    """games/flappy.py must use the same level numbers as public/js/games/flappy-core.js."""
    src = open(_os.path.join(ROOT, "public/js/games/flappy-core.js")).read()
    P = {k: float(v) for k, v in re.findall(r"^\s+([A-Z_0-9]+):\s*(-?[\d.]+),", src, re.M)}
    ok = all(P[k] == v for k, v in (("V0", F.V0), ("VMAX", F.VMAX), ("ACC", F.ACC), ("SPACING", F.SPACING),
                                     ("FIRST", F.FIRST), ("RAMP_AT", F.RAMP_AT)))
    check(ok, "the server's level numbers match flappy-core.js")
    if shutil.which("node"):
        times = [0, 1, 2.79, 2.8, 10, 30.6, 30.7, 45, 80.7, 81, 120, 150]
        js = ("require('./public/js/games/flappy-core.js'); const C = globalThis.FlappyCore;"
              f"console.log(JSON.stringify({json.dumps(times)}.map((t) => [C.passed(t), +C.X(t).toFixed(6)])));")
        out = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True, text=True, timeout=30).stdout)
        mine = [[F.passed(t), round(F.bird_x(t), 6)] for t in times]
        check(out == mine, f"passed(t) and X(t) agree with the browser: {mine[-1]}")


async def main():
    same_numbers_as_the_browser()
    ida, idb, idw = "fa" + U + "xx", "fb" + U + "xx", "fw" + U + "xx"
    a, b, w = WS(), WS(), WS()
    await a.connect(ida, "Ann"); await b.connect(idb, "Bob"); await w.connect(idw, "Wat")
    for x in (a, b, w): await x.wait("welcome")
    r = await req(a, "auth:signup", name="FlapAnn" + U, password="flap-pass-1"); check(r["ok"], "signup A")
    r = await req(b, "auth:signup", name="FlapBob" + U, password="flap-pass-2"); check(r["ok"], "signup B")

    a.send({"t": "room:create", "game": "flappy"}); j = await a.wait("room:joined")
    check(j["state"]["settings"]["rounds"] == 3 and j["state"]["phase"] == "lobby", "new room: lobby, 3 rounds")
    b.send({"t": "room:join", "code": j["code"], "game": "flappy"}); await b.wait("room:joined")
    w.send({"t": "room:join", "code": j["code"], "game": "flappy", "watch": True}); await w.wait("room:joined")

    # settings: only the host, only 1 / 3 / 5
    b.send({"t": "g:settings", "rounds": 1})
    check(await none_of(a, "g:settings"), "only the host changes settings")
    a.send({"t": "g:settings", "rounds": 7}); a.send({"t": "g:settings", "rounds": 1})
    st = await wait_for(b, "g:settings", pred=lambda m: m["settings"]["rounds"] == 1)
    check(st["settings"] == {"rounds": 1}, "host picks 1 round (7 is ignored)")

    b.send({"t": "g:start"})
    check(await none_of(a, "g:round"), "only the host starts")
    a.send({"t": "g:start"})
    rd = await wait_for(b, "g:round")
    R = rd["round"]
    check(set(R["runners"]) == {ida, idb} and R["n"] == 1 and R["rounds"] == 1 and isinstance(R["seed"], int) and rd["countdown"] == 3,
          "round 1 starts with a seed for the two players (the watcher isn't flying)")
    t0 = time.time() + rd["countdown"]
    await asyncio.sleep(rd["countdown"] + 0.3)

    # positions are relayed (to the other player and the watcher), with the skin
    a.send({"t": "g:pos", "y": 250.5, "v": -530, "s": 0, "ft": 0.3, "k": "robot"})
    p = await wait_for(b, "g:pos")
    check(p["id"] == ida and p["y"] == 250.5 and p["v"] == -530 and p["k"] == "robot" and p["s"] == 0, "positions are relayed")
    p = await wait_for(w, "g:pos")
    check(p["id"] == ida, "the watcher sees the birds too")
    a.send({"t": "g:pos", "y": 250, "v": 0, "s": 40, "ft": 0.5, "k": "hacker"})
    p = await wait_for(b, "g:pos")
    check(p["s"] == 0 and p["k"] == "robot", f"an impossible live score is clamped, unknown skins ignored (s={p['s']})")

    # impossible crashes are refused
    a.send({"t": "g:die", "score": 50, "ft": 1.0})
    tst = await wait_for(a, "g:toast")
    check("didn't look right" in tst["text"], "more pipes than possible in that time is refused")
    a.send({"t": "g:die", "score": 0, "ft": 90})
    tst = await wait_for(a, "g:toast")
    check(tst is not None, "a flight longer than the round so far is refused")
    a.send({"t": "g:die", "score": 1.5, "ft": 0.5})
    tst = await wait_for(a, "g:toast")
    check(tst is not None, "a broken score is refused")

    # Bob crashes after the first pipe, Ann is the last bird flying
    await asyncio.sleep(max(0, t0 + 3.6 - time.time()))
    b.send({"t": "g:die", "score": F.passed(3.5), "ft": 3.5})
    d = await wait_for(w, "g:die")
    check(d["id"] == idb and d["score"] == 1 and d["ft"] == 3.5, f"a believable crash counts: {d}")
    last = await wait_for(a, "g:last")
    check(last["id"] == ida, "Ann is the last bird flying")
    b.send({"t": "g:die", "score": 1, "ft": 3.6})
    check(await none_of(w, "g:die", 0.4), "you can only crash once")
    await asyncio.sleep(max(0, t0 + 5.2 - time.time()))
    a.send({"t": "g:die", "score": F.passed(5.0), "ft": 5.0})
    ro = await wait_for(w, "g:roundover", 4)
    rows = ro["rows"]
    check([x["id"] for x in rows] == [ida, idb] and [x["place"] for x in rows] == [1, 2] and [x["points"] for x in rows] == [5, 3]
          and ro["next"] is None, f"round results: places by score, points 5 / 3, last round: {[(x['name'], x['score'], x['points']) for x in rows]}")
    res = await wait_for(a, "g:results", 6)
    rr = res["results"]["rows"]
    check(rr[0]["id"] == ida and rr[0]["points"] == 5 and rr[0]["best"] == 2 and rr[1]["best"] == 1, "game results: Ann wins")
    vote = await wait_for(a, "room:vote", pred=lambda m: m["vote"])
    check(vote["vote"]["kind"] == "next", "play-again vote after the game")
    await asyncio.sleep(0.8)
    sa = (await req(a, "profile:get", name="FlapAnn" + U))["profile"]["stats"]
    sb = (await req(a, "profile:get", name="FlapBob" + U))["profile"]["stats"]
    check(sa.get("flappy.games") == 1 and sa.get("flappy.wins") == 1 and sa.get("flappy.best_online") == 2,
          f"winner's stats saved: {[(k, v) for k, v in sa.items() if k.startswith('flappy')]}")
    check(sb.get("flappy.games") == 1 and not sb.get("flappy.wins") and sb.get("flappy.best_online") == 1,
          f"loser's stats saved: {[(k, v) for k, v in sb.items() if k.startswith('flappy')]}")

    # a 3-round game: someone leaving mid-round crashes; the next round goes on without them
    a.send({"t": "g:settings", "rounds": 3}); await wait_for(a, "g:settings", pred=lambda m: m["settings"]["rounds"] == 3)
    a.send({"t": "g:start"})
    rd = await wait_for(w, "g:round", 6)
    check(rd["round"]["rounds"] == 3 and rd["standings"] and all(x["points"] == 0 for x in rd["standings"]), "a new game starts from 0 points")
    await asyncio.sleep(rd["countdown"] + 0.5)
    b.send({"t": "room:leave"})
    d = await wait_for(w, "g:die", 3)
    check(d["id"] == idb, "leaving mid-round counts as a crash")
    a.send({"t": "g:die", "score": 0, "ft": 0.6})
    ro = await wait_for(w, "g:roundover", 4)
    check(ro["n"] == 1 and ro["next"] == F.ROUND_GAP and ro["rows"][0]["id"] == ida, "round 1 over, round 2 coming")
    rd = await wait_for(w, "g:round", F.ROUND_GAP + 2)
    check(rd["round"]["n"] == 2 and set(rd["round"]["runners"]) == {ida}, "round 2 is only for the players still here")

    # a bird that goes quiet has crashed
    await asyncio.sleep(rd["countdown"])
    a.send({"t": "g:pos", "y": 200, "v": 0, "s": 0, "ft": 0.1})
    d = await wait_for(w, "g:die", F.STALE + 3)
    check(d["id"] == ida, "a bird we stop hearing from crashes")
    ro = await wait_for(w, "g:roundover", 4)

    # admin cheats: god mode for this round (the game won't count), end the round
    rd = await wait_for(w, "g:round", F.ROUND_GAP + 2)
    r = await req(a, "admin:unlock", code="test-admin-code-123"); check(r["ok"], "admin unlock")
    r = await req(a, "admin:cheat", action="god")
    check(r["ok"] and "God" in r["text"], f"god cheat: {r.get('text') or r.get('error')}")
    got = any(m["t"] == "g:god" for m in getattr(a, "pushed", [])) or bool(await wait_for(a, "g:god", 2))
    check(got, "the browser is told to turn god mode on")
    r = await req(a, "admin:cheat", action="nonsense"); check(not r["ok"], "unknown cheat refused")
    r = await req(a, "admin:cheat", action="end"); check(r["ok"], "end cheat")
    ro = await wait_for(w, "g:roundover", 4)
    check(ro["n"] == 3 and ro["next"] is None, "the last round ended")
    res = await wait_for(w, "g:results", 6)
    check(res["results"]["rounds"] == 3 and res["results"]["rows"][0]["id"] == ida, "3-round game results")
    await asyncio.sleep(0.8)
    sa = (await req(a, "profile:get", name="FlapAnn" + U))["profile"]["stats"]
    check(sa.get("flappy.games") == 1, "a game with a cheat isn't saved")

    # someone joining sees the results
    c = WS(); await c.connect("fc" + U + "xx", "Cat"); await c.wait("welcome")
    c.send({"t": "room:join", "code": j["code"], "game": "flappy"}); jj = await c.wait("room:joined")
    check(jj["state"]["phase"] == "results" and jj["state"]["results"]["rows"], "people joining later see the results")
    print("FAILED:", check.failed)

asyncio.run(main())
