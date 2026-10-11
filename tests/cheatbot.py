import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))
async def main():
    a, b = WS(), WS()
    await a.connect("chtA" + U + "xx", "a"); await b.connect("chtB" + U + "xx", "b"); await a.wait("welcome"); await b.wait("welcome")
    r = await req(a, "auth:signup", name="Cheater" + U, password="cheat-pass-1"); assert r["ok"], r
    await req(a, "auth:unlock") if False else None
    r = await req(a, "admin:unlock", code="test-admin-code-123"); check(r["ok"], "unlock")
    r = await req(b, "auth:signup", name="Honest" + U, password="honest-pass-1"); assert r["ok"], r
    async def room(game):
        a.send({"t": "room:create", "game": game}); j = await a.wait("room:joined")
        b.send({"t": "room:join", "code": j["code"], "game": game}); await b.wait("room:joined"); await asyncio.sleep(0.3)
    async def leave():
        a.send({"t": "room:leave"}); b.send({"t": "room:leave"}); await asyncio.sleep(0.3)
    # life
    await room("life"); a.send({"t": "g:ready", "ready": True}); b.send({"t": "g:ready", "ready": True}); await asyncio.sleep(0.3)
    a.send({"t": "g:start"}); await asyncio.sleep(0.6)
    for act in ("money", "stats", "energy", "clean", "event", "skip"):
        r = await req(a, "admin:cheat", action=act); check(r["ok"], f"life cheat {act}: {r.get('text') or r.get('error')}")
    a.send({"t": "g:end"}); await asyncio.sleep(1)
    r = await req(b, "profile:get", name="Honest" + U); check("life.lives" not in r["profile"]["stats"], "cheated life game not saved for anyone")
    await leave()
    # casino
    await room("casino"); a.send({"t": "g:start"}); await asyncio.sleep(0.5)
    for act in ("coins", "rich", "broke"):
        r = await req(a, "admin:cheat", action=act); check(r["ok"], f"casino cheat {act}: {r.get('text') or r.get('error')}")
    r = await req(a, "admin:cheat", action="end"); check(r["ok"], "casino end")
    await asyncio.sleep(2.2); await leave()
    # blitz
    await room("blitz"); a.send({"t": "g:start"}); await asyncio.sleep(1.5)
    for act in ("points", "skip", "end"):
        r = await req(a, "admin:cheat", action=act); check(r["ok"], f"blitz cheat {act}: {r.get('text') or r.get('error')}")
    await leave()
    # doodle
    await room("doodle"); a.send({"t": "g:start"}); await asyncio.sleep(0.5)
    for act in ("points", "skip"):
        r = await req(a, "admin:cheat", action=act); check(r["ok"], f"doodle cheat {act}: {r.get('text') or r.get('error')}")
    await asyncio.sleep(0.3)
    # drawer picks a word so "word" works
    for w in (a, b):
        w.send({"t": "g:pick", "i": 0})
    await asyncio.sleep(0.5)
    r = await req(a, "admin:cheat", action="word"); check(r["ok"] and "word" in r["text"], f"doodle word: {r.get('text') or r.get('error')}")
    r = await req(a, "admin:cheat", action="end"); check(r["ok"], "doodle end")
    await leave()
    # dash
    await room("dash"); a.send({"t": "g:start"}); await asyncio.sleep(0.4)
    r = await req(a, "admin:cheat", action="god"); check(r["ok"], "dash god")
    r = await req(a, "admin:cheat", action="nonsense"); check(not r["ok"], "unknown cheat rejected")
    print("FAILED:", check.failed)
asyncio.run(main())
