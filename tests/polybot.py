import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random, time
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))

async def wait_for(ws, t, timeout=5, pred=None):
    end = time.time() + timeout
    while True:
        m = await asyncio.wait_for(ws.inbox.get(), max(0.01, end - time.time()))
        if m["t"] == t and (pred is None or pred(m)):
            return m

async def main():
    a, b, w = WS(), WS(), WS()
    await a.connect("pa" + U + "xx", "Ann"); await b.connect("pb" + U + "xx", "Bob"); await w.connect("pw" + U + "xx", "Wat")
    for x in (a, b, w): await x.wait("welcome")
    await req(a, "auth:signup", name="PolyAnn" + U, password="poly-pass-1")
    a.send({"t": "room:create", "game": "poly"}); j = await a.wait("room:joined")
    check(j["state"]["settings"]["track"] == 1, "default track 1")
    b.send({"t": "room:join", "code": j["code"], "game": "poly"}); await b.wait("room:joined")
    w.send({"t": "room:join", "code": j["code"], "game": "poly", "watch": True}); await w.wait("room:joined")
    a.send({"t": "g:settings", "track": 9}); a.send({"t": "g:settings", "track": 4})
    st = await wait_for(a, "g:settings", pred=lambda m: m["settings"]["track"] == 4)
    check(st is not None, "host picks a track (bad ids ignored)")
    b.send({"t": "g:start"})
    a.send({"t": "g:start"})
    s = await wait_for(b, "g:start")
    race = s["race"]
    check(race["track"] == 4 and set(race["runners"]) == {"pa" + U + "xx", "pb" + U + "xx"}, "race starts: track 4, the watcher isn't racing")
    await asyncio.sleep(s["countdown"] + 0.2)
    a.send({"t": "g:pos", "x": 1.5, "y": 6, "z": 10, "r": 0.1, "v": 30, "p": 0.05, "cp": 0})
    pos = await wait_for(b, "g:pos")
    check(pos["id"] == "pa" + U + "xx" and pos["z"] == 10 and pos["p"] == 0.05, "positions are relayed")
    # too fast to be real
    a.send({"t": "g:finish", "time": 3000})
    tst = await wait_for(a, "g:toast")
    check("didn't look right" in tst["text"], "an impossible time is refused")
    # a time that claims more than the race has been going
    a.send({"t": "g:finish", "time": 20000})
    tst = await wait_for(a, "g:toast")
    check(tst is not None, "a time longer than the race so far is refused")
    await asyncio.sleep(18.5)
    a.send({"t": "g:finish", "time": 18400, "respawns": 1})
    f = await wait_for(w, "g:finish")
    check(f["place"] == 1 and f["time"] == 18400, "a believable time counts: 1st place")
    hur = await wait_for(b, "g:hurry")
    check(hur["seconds"] == 30, "the others get 30 s to finish")
    await asyncio.sleep(1.5)
    b.send({"t": "g:finish", "time": 20200})
    res = await wait_for(a, "g:results", timeout=4)
    rows = res["results"]["rows"]
    check([r["place"] for r in rows] == [1, 2] and rows[0]["id"] == "pa" + U + "xx" and res["results"]["track"] == 4, "results in order")
    vote = await wait_for(a, "room:vote", pred=lambda m: m["vote"])
    check(vote["vote"]["kind"] == "next", "play-again vote after the race")
    await asyncio.sleep(0.8)
    stt = (await req(a, "profile:get", name="PolyAnn" + U))["profile"]["stats"]
    check(stt.get("poly.races") == 1 and stt.get("poly.wins") == 1 and stt.get("poly.podiums") == 1, f"stats saved: {[(k, v) for k, v in stt.items() if k.startswith('poly')]}")
    # solo times go on the per-track leaderboard
    r = await req(a, "stats:solo", game="poly-4", value=24100)
    check(r["ok"] and r["best"], "solo time trial saved")
    r = await req(a, "stats:solo", game="poly-4", value=5000)
    check(not r["ok"], "impossibly fast solo times are refused")
    lb = (await req(a, "lb:get", board="poly4"))["board"]
    check(lb["rows"] and lb["rows"][0]["value"] == 24100, f"the Big Air leaderboard has the time")
    # random track
    await asyncio.sleep(4.5)
    a.send({"t": "g:settings", "track": "random"}); await wait_for(a, "g:settings")
    a.send({"t": "g:start"})
    s2 = await wait_for(a, "g:start", 6)
    check(s2["race"]["track"] in range(1, 7), f"random track: {s2['race']['track']}")
    print("FAILED:", check.failed)

asyncio.run(main())
