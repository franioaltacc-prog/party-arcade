import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, time, itertools, random
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))

async def player(uid, name):
    w = WS(); await w.connect(uid, name); await w.wait("welcome")
    r = await req(w, "auth:signup", name=name, password="pass" + name)
    assert r["ok"], r
    return w

async def stats(w, name):
    return (await req(w, "profile:get", name=name))["profile"]["stats"]

async def room(a, b, game):
    a.send({"t": "room:create", "game": game}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": game}); await b.wait("room:joined")
    await asyncio.sleep(0.3)

async def main():
    a = await player("gbotA" + U + "x", "GA" + U); b = await player("gbotB" + U + "x", "GB" + U)
    na, nb = "GA" + U, "GB" + U
    # Dash: both finish, A first
    await room(a, b, "dash"); a.send({"t": "g:start"}); await a.wait("g:start")
    a.send({"t": "g:finish", "time": 31000, "attempts": 2}); await asyncio.sleep(0.2)
    b.send({"t": "g:finish", "time": 35000, "attempts": 5})
    await a.wait("g:results"); await asyncio.sleep(0.5)
    s = await stats(a, na); check(s.get("dash.wins") == 1 and s.get("dash.races") == 1, f"dash winner {s}")
    s = await stats(a, nb); check(s.get("dash.races") == 1 and not s.get("dash.wins") and s.get("dash.podiums") == 1, f"dash 2nd {s}")
    # Blitz: host ends via admin? no - play with short rounds: use settings 3 rounds and answer nothing
    a.send({"t": "room:leave"}); b.send({"t": "room:leave"}); await asyncio.sleep(0.2)
    await room(a, b, "casino")
    a.send({"t": "g:start"}); await asyncio.sleep(0.5)
    a.send({"t": "g:end"}); await asyncio.sleep(2.5)
    s = await stats(a, na); check(s.get("casino.games") == 1, f"casino recorded {s}")
    a.send({"t": "room:leave"}); b.send({"t": "room:leave"}); await asyncio.sleep(0.2)
    # Family Life: both ready, start, host ends
    await room(a, b, "life")
    a.send({"t": "g:ready", "ready": True}); b.send({"t": "g:ready", "ready": True}); await asyncio.sleep(0.3)
    a.send({"t": "g:start"}); await asyncio.sleep(0.8)
    r = await req(a, "admin:cheat", action="money"); check(not r["ok"], "non-admin can't cheat")
    a.send({"t": "g:end"}); await asyncio.sleep(1.0)
    s = await stats(a, na); check(s.get("life.lives") == 1 and "life.best" in s, f"life recorded {s}")
    s = await stats(b, nb); check(s.get("life.lives") == 1, "life recorded for sibling 2")
    a.send({"t": "room:leave"}); b.send({"t": "room:leave"}); await asyncio.sleep(0.2)
    # Blitz: 3 rounds, nobody answers -> ends with 0 points (no win)
    await room(a, b, "blitz"); a.send({"t": "g:settings", "rounds": 3}); a.send({"t": "g:start"})
    await a.wait("g:final", timeout=90); await asyncio.sleep(0.5)
    s = await stats(a, na); check(s.get("blitz.games") == 1 and not s.get("blitz.wins"), f"blitz recorded, 0-0 is not a win {s}")
    print("FAILED:", check.failed)

asyncio.run(main())
