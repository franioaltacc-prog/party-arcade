import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, random, time
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))


async def wait_for(ws, t, timeout=5, pred=None):
    end = time.time() + timeout
    while True:
        m = await asyncio.wait_for(ws.inbox.get(), max(0.01, end - time.time()))
        if m["t"] == t and (pred is None or pred(m)):
            return m


async def nothing(ws, t, secs, pred=None):
    """True if no message of type t (matching pred) arrives within secs."""
    try:
        await wait_for(ws, t, secs, pred)
        return False
    except asyncio.TimeoutError:
        return True


async def stats(ws, name):
    r = await req(ws, "profile:get", name=name)
    return {k: v for k, v in r["profile"]["stats"].items() if k.startswith("golf")}


async def three_holes():
    """A 3-hole game: settings, scores checked, the hurry timer, a player leaving mid-hole, results saved."""
    a, b, c, w = WS(), WS(), WS(), WS()
    ids = {"a": "ga" + U + "xx", "b": "gb" + U + "xx", "c": "gc" + U + "xx", "w": "gw" + U + "xx"}
    await a.connect(ids["a"], "Ann"); await b.connect(ids["b"], "Bob"); await c.connect(ids["c"], "Cat"); await w.connect(ids["w"], "Wat")
    for x in (a, b, c, w):
        await x.wait("welcome")
    na, nb = "GolfAnn" + U, "GolfBob" + U
    r = await req(a, "auth:signup", name=na, password="golf-pass-1"); assert r["ok"], r
    r = await req(b, "auth:signup", name=nb, password="golf-pass-2"); assert r["ok"], r
    a.send({"t": "room:create", "game": "golf"}); j = await a.wait("room:joined")
    check(j["state"]["settings"] == {"course": "classic", "holes": 9}, "golf room: default settings classic, 9 holes")
    for x in (b, c):
        x.send({"t": "room:join", "code": j["code"], "game": "golf"}); await x.wait("room:joined")
    w.send({"t": "room:join", "code": j["code"], "game": "golf", "watch": True}); await w.wait("room:joined")
    a.send({"t": "g:settings", "course": "mars", "holes": 4})
    st = await wait_for(a, "g:settings")
    check(st["settings"] == {"course": "classic", "holes": 9}, "bad course / hole count ignored")
    a.send({"t": "g:settings", "course": "spooky", "holes": 3})
    st = await wait_for(b, "g:settings", pred=lambda m: m["settings"]["holes"] == 3)
    check(st["settings"] == {"course": "spooky", "holes": 3}, "host picks Spooky Hollow, 3 holes")
    await wait_for(a, "g:settings", pred=lambda m: m["settings"]["holes"] == 3)
    b.send({"t": "g:settings", "course": "classic"})
    check(await nothing(a, "g:settings", 0.4), "only the host changes settings")
    b.send({"t": "g:start"})
    check(await nothing(a, "g:start", 0.4), "only the host starts")
    a.send({"t": "g:start"})
    s = await wait_for(b, "g:start")
    hole = await wait_for(b, "g:hole")
    rnd = hole["round"]
    check(rnd["course"] == "spooky" and rnd["holes"] == 3 and rnd["pars"] == [2, 3, 3], f"game starts on Spooky Hollow, pars {rnd['pars']}")
    check(set(rnd["players"]) == {ids["a"], ids["b"], ids["c"]}, "the three players play, the watcher watches")
    check(hole["hole"] == 0 and hole["countdown"] == 3.0, "hole 1 starts after a 3 s countdown")
    for x in (a, c, w):
        await wait_for(x, "g:hole")
    # scores before the hole has even started are refused
    a.send({"t": "g:holed", "hole": 0, "strokes": 1})
    t = await wait_for(a, "g:toast")
    check("didn't look right" in t["text"], "holing out during the countdown is refused")
    await asyncio.sleep(hole["countdown"] + 0.2)
    # positions are relayed to the others (not back to the sender)
    a.send({"t": "g:pos", "x": 5.5, "y": 0, "z": 11.2, "s": 1, "moving": True})
    p = await wait_for(b, "g:pos")
    check(p["id"] == ids["a"] and p["z"] == 11.2 and p["s"] == 1 and p["moving"], "ball positions are relayed")
    p = await wait_for(w, "g:pos")
    check(p["id"] == ids["a"], "the watcher sees the balls too")
    # bad scores
    for bad, label in ((0, "0 strokes"), (9, "9 strokes"), ("2", "a string"), (True, "true"), (2.5, "2.5 strokes")):
        a.send({"t": "g:holed", "hole": 0, "strokes": bad})
        t = await wait_for(a, "g:toast")
        check("didn't look right" in t["text"], f"score refused: {label}")
    a.send({"t": "g:holed", "hole": 0, "strokes": 4, "picked": True})
    t = await wait_for(a, "g:toast"); check("didn't look right" in t["text"], "picking up with fewer than 8 refused")
    a.send({"t": "g:holed", "hole": 0, "strokes": 6})
    t = await wait_for(a, "g:toast"); check("didn't look right" in t["text"], "6 strokes in 0.2 s is impossible")
    a.send({"t": "g:holed", "hole": 1, "strokes": 1})
    check(await nothing(b, "g:done", 0.4), "a score for the wrong hole is ignored")
    await asyncio.sleep(0.8)
    a.send({"t": "g:holed", "hole": 0, "strokes": 1})
    d = await wait_for(w, "g:done")
    check(d["id"] == ids["a"] and d["strokes"] == 1 and d["hole"] == 0, "a hole in one counts")
    hu = await wait_for(b, "g:hurry")
    check(hu["seconds"] == 45, "the others get 45 s once someone holes out")
    a.send({"t": "g:holed", "hole": 0, "strokes": 3})
    check(await nothing(b, "g:done", 0.4, lambda m: m["id"] == ids["a"]), "can't hole the same hole twice")
    a.send({"t": "g:pos", "x": 1, "y": 0, "z": 1, "s": 1})
    check(await nothing(b, "g:pos", 0.3), "no positions from a player who's done")
    await asyncio.sleep(1.6)
    b.send({"t": "g:holed", "hole": 0, "strokes": 3})
    c.send({"t": "g:holed", "hole": 0, "strokes": 2})
    he = await wait_for(a, "g:holeEnd", 4)
    pl = he["round"]["players"]
    check(he["hole"] == 0 and not he["last"] and he["next"] == 7.0, "everyone holed: the hole ends, the next starts in 7 s")
    check([pl[ids[k]]["scores"][0] for k in "abc"] == [1, 3, 2] and pl[ids["a"]]["how"][0] == "ace", "scorecard after hole 1: 1, 3, 2")

    # hole 2: Cat never finishes, so the hurry timer ends it
    hole = await wait_for(a, "g:hole", 9)
    check(hole["hole"] == 1, "hole 2 starts by itself")
    await asyncio.sleep(0.1)
    for x in (b, c, w):
        x.drain()
    await asyncio.sleep(hole["countdown"] + 3.4)
    a.send({"t": "g:holed", "hole": 1, "strokes": 2})
    b.send({"t": "g:holed", "hole": 1, "strokes": 4})
    await wait_for(c, "g:hurry")
    t0 = time.time()
    he = await wait_for(w, "g:holeEnd", 50, lambda m: m["hole"] == 1)
    took = time.time() - t0
    pl = he["round"]["players"]
    check(43 <= took <= 48, f"the hurry timer ended hole 2 after {took:.1f}s")
    check(pl[ids["c"]]["scores"][1] == 8 and pl[ids["c"]]["how"][1] == "dnf" and pl[ids["b"]]["scores"][1] == 4, "a player who ran out of time gets 8")

    # hole 3: Cat leaves halfway through
    hole = await wait_for(a, "g:hole", 9)
    check(hole["hole"] == 2, "hole 3 starts")
    await asyncio.sleep(0.1)
    for x in (b, c, w):
        x.drain()
    await asyncio.sleep(hole["countdown"] + 2.6)
    a.send({"t": "g:holed", "hole": 2, "strokes": 2})
    await wait_for(b, "g:done")
    c.send({"t": "room:leave"})
    await asyncio.sleep(0.5)
    b.send({"t": "g:holed", "hole": 2, "strokes": 3})
    he = await wait_for(a, "g:holeEnd", 4, lambda m: m["hole"] == 2)
    check(he["last"] and he["round"]["players"][ids["c"]]["scores"][2] == 8, "the leaver gets 8, the last hole ends without waiting for them")
    res = await wait_for(a, "g:results", 5)
    rows = res["results"]["rows"]
    check([r["id"] for r in rows] == [ids["a"], ids["b"], ids["c"]] and [r["total"] for r in rows] == [5, 10, 18], f"results: {[(r['name'], r['total']) for r in rows]}")
    check([r["place"] for r in rows] == [1, 2, 3] and rows[0]["par"] == -3 and rows[0]["aces"] == 1, "places and score vs par")
    check(res["wins"].get(ids["a"]) == 1, "the winner gets a win in the room")
    v = await wait_for(a, "room:vote", 4, lambda m: m["vote"])
    check(v["vote"]["kind"] == "next", "play-again vote after the game")
    await asyncio.sleep(0.8)
    sa = await stats(w, na); sb = await stats(w, nb)
    check(sa == {"golf.games": 1, "golf.wins": 1, "golf.holes": 3, "golf.aces": 1}, f"winner's stats saved: {sa}")
    check(sb == {"golf.games": 1, "golf.holes": 3}, f"runner-up's stats saved: {sb}")
    prof = (await req(w, "profile:get", name=na))["profile"]
    check(prof["recent"][0]["game"] == "golf" and prof["recent"][0]["outcome"] == "win" and "5 strokes (-3)" in prof["recent"][0]["detail"], f"match history: {prof['recent'][0]['detail']}")

    # admin cheats: ace and end — that game isn't saved
    r = await req(a, "admin:unlock", code="test-admin-code-123"); check(r["ok"], "admin unlock")
    r = await req(a, "admin:cheat", action="ace"); check(not r["ok"], "no cheats between games")
    a.drain(); b.drain()
    a.send({"t": "g:start"})
    hole = await wait_for(a, "g:hole", 5)
    await asyncio.sleep(hole["countdown"] + 0.3)
    r = await req(a, "admin:cheat", action="ace")
    check(r["ok"] and "Hole in one" in r["text"], "admin cheat: ace")
    check(any(m["t"] == "g:ace" for m in getattr(a, "pushed", [])), "the admin's browser is told to drop the ball in")
    d = await wait_for(b, "g:done")
    check(d["id"] == ids["a"] and d["strokes"] == 1, "the cheat holes it in one for everyone to see")
    for k in range(3):
        r = await req(a, "admin:cheat", action="end")
        check(r["ok"], f"admin cheat: end hole {k + 1}")
        if k < 2:
            await wait_for(a, "g:hole", 10)
    res = await wait_for(b, "g:results", 6)
    await asyncio.sleep(0.8)
    sa = await stats(w, na)
    check(sa.get("golf.games") == 1, f"a game with cheats isn't saved: {sa}")
    for x in (a, b, w):
        x.send({"t": "room:leave"})


async def nine_holes():
    """A full 9 holes of Spooky Hollow: best round (min) and the Halloween quest stat."""
    a, b = WS(), WS()
    ia, ib = "gn" + U + "aa", "gn" + U + "bb"
    await a.connect(ia, "Nina"); await b.connect(ib, "Ned")
    for x in (a, b):
        await x.wait("welcome")
    na, nb = "GolfNina" + U, "GolfNed" + U
    r = await req(a, "auth:signup", name=na, password="golf-pass-3"); assert r["ok"], r
    r = await req(b, "auth:signup", name=nb, password="golf-pass-4"); assert r["ok"], r
    a.send({"t": "room:create", "game": "golf"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "golf"}); await b.wait("room:joined")
    a.send({"t": "g:settings", "course": "spooky"}); await wait_for(a, "g:settings")
    a.send({"t": "g:start"})
    pars = []
    for i in range(9):
        hole = await wait_for(a, "g:hole", 12)
        await wait_for(b, "g:hole", 2)
        pars = hole["round"]["pars"]
        nb_strokes = 8 if i == 8 else pars[i] + 1
        await asyncio.sleep(hole["countdown"] + 0.8 * nb_strokes + 0.3)     # (nobody plays a stroke in under 0.8 s)
        a.send({"t": "g:holed", "hole": i, "strokes": 1 if i == 0 else pars[i]})
        b.send({"t": "g:holed", "hole": i, "strokes": nb_strokes, "picked": i == 8})
        await wait_for(a, "g:holeEnd", 5)
    res = await wait_for(a, "g:results", 6)
    rows = res["results"]["rows"]
    total = sum(pars) - 1
    check(rows[0]["id"] == ia and rows[0]["total"] == total and len(rows[0]["scores"]) == 9, f"9-hole round: {rows[0]['total']} for Nina (par {sum(pars)})")
    await asyncio.sleep(0.8)
    sa = await stats(b, na); sb = await stats(a, nb)
    check(sa.get("golf.best") == total and sa.get("golf.spooky_done") == 1 and sa.get("golf.aces") == 1 and sa.get("golf.holes") == 9, f"9 holes: best round and Spooky Hollow done saved: {sa}")
    check(sb.get("golf.spooky_done") == 1 and sb.get("golf.holes") == 8 and sb.get("golf.best") == rows[1]["total"], f"picking up still finishes the course: {sb}")
    for x in (a, b):
        x.send({"t": "room:leave"})


async def random_course():
    """A random course: the server picks a seed, the pars match the browser's genPar, no best round is kept."""
    from games.golf import gen_par, COURSES
    # the same numbers golf-core.js's genPar gives for these seeds (if this fails, the two copies differ)
    js = {1: "233233344", 2: "243343333", 3: "223433324", 777: "232332433", 12345: "233333342", 2000000000: "223334323"}
    check(all("".join(str(gen_par(s, i)) for i in range(9)) == v for s, v in js.items()), "random course pars match the browser's")
    check(set(COURSES) == {"classic", "spooky", "desert", "frost", "beach", "volcano"}, "six courses")
    a, b = WS(), WS()
    await a.connect("gr" + U + "aa", "Rae"); await b.connect("gr" + U + "bb", "Rob")
    for x in (a, b):
        await x.wait("welcome")
    a.send({"t": "room:create", "game": "golf"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "golf"}); await b.wait("room:joined")
    a.send({"t": "g:settings", "course": "volcano"})
    st = await wait_for(b, "g:settings", pred=lambda m: m["settings"]["course"] == "volcano")
    check(st["settings"]["course"] == "volcano", "host picks Volcano Isle")
    a.send({"t": "g:settings", "course": "gen", "holes": 3})
    st = await wait_for(b, "g:settings", pred=lambda m: m["settings"]["course"] == "gen")
    check(st["settings"] == {"course": "gen", "holes": 3}, "host picks a random course, 3 holes")
    a.send({"t": "g:start"})
    hole = await wait_for(b, "g:hole", 5)
    r = hole["round"]
    seed = int(r["course"][4:]) if r["course"].startswith("gen-") else 0
    check(seed > 0 and r["pars"] == [gen_par(seed, i) for i in range(3)], f"the round is {r['course']} with pars {r['pars']}")
    a.send({"t": "g:start"})
    check(await nothing(b, "g:start", 0.3), "can't restart mid-game")
    for x in (a, b):
        x.send({"t": "room:leave"})


async def main():
    await asyncio.gather(three_holes(), nine_holes(), random_course())
    print("FAILED:", check.failed)

if __name__ == "__main__":
    asyncio.run(main())
