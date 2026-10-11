import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random, time
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))


async def turns(ws, secs):
    got = []
    end = time.time() + secs
    while time.time() < end:
        try:
            m = await asyncio.wait_for(ws.inbox.get(), max(0.01, end - time.time()))
        except asyncio.TimeoutError:
            break
        if m["t"] == "g:turn":
            got += m["i"]
    return got


async def main():
    a, b = WS(), WS()
    await a.connect("fwA" + U + "x", "Ann"); await b.connect("fwB" + U + "x", "Bob")
    await a.wait("welcome"); await b.wait("welcome")
    r = await req(a, "auth:signup", name="AllyA" + U, password="ally-pass-1"); assert r["ok"]
    r = await req(b, "auth:signup", name="AllyB" + U, password="ally-pass-2"); assert r["ok"]
    a.send({"t": "room:create", "game": "front"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "front"}); await b.wait("room:joined")
    a.send({"t": "g:settings", "bots": 4, "size": "small"}); await asyncio.sleep(0.3)
    a.send({"t": "g:start"}); await a.wait("g:start"); await asyncio.sleep(0.2); a.drain()

    a.send({"t": "g:do", "it": {"k": "ally", "p": 2, "t": 55, "junk": 1}})
    b.send({"t": "g:do", "it": {"k": "decline", "p": 1}})
    b.send({"t": "g:do", "it": {"k": "unally", "p": "999"}})
    a.send({"t": "g:do", "it": {"k": "warship", "t": 1234}})
    a.send({"t": "g:do", "it": {"k": "build", "b": "port", "t": 77}})
    a.send({"t": "g:do", "it": {"k": "build", "b": "castle", "t": 77}})
    got = await turns(a, 1.0)
    check([1, {"k": "ally", "p": 2}] in got, "ally move relayed with just the other player")
    check([2, {"k": "decline", "p": 1}] in got, "decline relayed")
    check([2, {"k": "unally", "p": 200}] in got, "player number clamped")
    check([1, {"k": "warship", "t": 1234}] in got, "warship move relayed")
    check([1, {"k": "build", "t": 77, "b": "port"}] in got and not any(m[1].get("b") == "castle" for m in got), "ports allowed, unknown buildings dropped")

    # both browsers see an alliance win
    for w in (a, b):
        w.send({"t": "g:over", "w": {"players": [2, 1]}, "tick": 3600, "shares": {"1": 0.4, "2": 0.45}, "names": ["Ann", "Bob", "🤖 Bot A", "🤖 Bot B"]})
    ov = await a.wait("g:over")
    res = ov["results"]
    check(res["winner"] == {"players": [1, 2]} and all(x["won"] for x in res["rows"]), f"alliance win: both players won ({res['winner']})")
    check("alliance" in res["name"] and "AllyA" in res["name"], f"winner name: {res['name']}")
    await asyncio.sleep(0.6)
    pb = (await req(a, "profile:get", name="AllyB" + U))["profile"]["stats"]
    check(pb.get("front.wins") == 1, "alliance win counts as a win")
    print("FAILED:", check.failed)

asyncio.run(main())
