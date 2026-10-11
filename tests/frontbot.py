import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random, time
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))


async def turns_until(ws, pred, timeout=5):
    """Collect turns until pred(turn) is true. Returns the list of turns seen."""
    seen = []
    end = time.time() + timeout
    while time.time() < end:
        try:
            m = await asyncio.wait_for(ws.inbox.get(), max(0.01, end - time.time()))
        except asyncio.TimeoutError:
            break
        if m["t"] == "g:turn":
            seen.append(m)
            if pred(m):
                return seen
    return seen


async def main():
    a, b, c = WS(), WS(), WS()
    await a.connect("frA" + U + "xx", "Ann"); await b.connect("frB" + U + "xx", "Bob"); await c.connect("frC" + U + "xx", "Cat")
    for w in (a, b, c):
        await w.wait("welcome")
    r = await req(a, "auth:signup", name="FrontA" + U, password="front-pass-1"); assert r["ok"], r
    r = await req(b, "auth:signup", name="FrontB" + U, password="front-pass-2"); assert r["ok"], r
    r = await req(a, "admin:unlock", code="test-admin-code-123"); check(r["ok"], "admin unlock")

    a.send({"t": "room:create", "game": "front"}); j = await a.wait("room:joined")
    code = j["code"]
    check(j["state"]["phase"] == "lobby" and j["state"]["settings"]["bots"] == 8, "lobby state with default settings")
    b.send({"t": "room:join", "code": code, "game": "front"}); await b.wait("room:joined")
    await asyncio.sleep(0.2); a.drain(); b.drain()

    # settings: only the host, and values are checked
    b.send({"t": "g:settings", "bots": 30}); await asyncio.sleep(0.2)
    a.send({"t": "g:settings", "mode": "teams", "teams": 9, "bots": 999, "size": "small", "difficulty": "hard", "style": "nope"})
    st = (await b.wait("g:state"))["state"]
    s = st["settings"]
    check(s["mode"] == "teams" and s["teams"] == 4 and s["bots"] == 40 and s["size"] == "small" and s["difficulty"] == "hard" and s["style"] == "continents",
          f"host settings clamped, guest ignored: {s}")
    a.send({"t": "g:settings", "teams": 2, "bots": 4}); await b.wait("g:state")
    a.send({"t": "g:team", "team": 1}); await b.wait("g:state")
    await asyncio.sleep(0.2); a.drain()
    b.send({"t": "g:team", "team": 7}); st = (await a.wait("g:state"))["state"]
    check(st["picks"].get(a_id := "frA" + U + "xx") == 1 and st["picks"].get("frB" + U + "xx") == 2, f"team picks (clamped): {st['picks']}")

    # only the host can start
    b.send({"t": "g:start"}); await asyncio.sleep(0.3)
    check(not [m for m in b.drain() if m["t"] == "g:start"], "guest can't start")
    a.drain()
    a.send({"t": "g:start"})
    sa = await a.wait("g:start"); sb = await b.wait("g:start")
    m = sa["match"]
    check(sa["match"]["seed"] == sb["match"]["seed"] and len(m["humans"]) == 2, "both get the same match")
    check([x["team"] for x in m["humans"]] == [1, 2] and m["settings"]["bots"] == 4, f"teams carried into the match: {[x['team'] for x in m['humans']]}")

    # turns arrive in order, about 10 a second
    t0 = time.time()
    seen = await turns_until(a, lambda t: t["n"] >= 20, 4)
    ns = [t["n"] for t in seen]
    check(ns == list(range(ns[0], ns[0] + len(ns))) and ns[-1] >= 20, f"turns numbered in order ({ns[0]}..{ns[-1]})")
    rate = (ns[-1] - ns[0]) / max(0.01, time.time() - t0)
    check(8 <= rate <= 12.5, f"about 10 turns a second ({rate:.1f})")

    # moves: cleaned up, tagged with the right player, bad ones dropped
    a.send({"t": "g:do", "it": {"k": "spawn", "t": 1234}})
    b.send({"t": "g:do", "it": {"k": "attack", "t": 999, "r": 500, "extra": "x"}})
    b.send({"t": "g:do", "it": {"k": "cheat", "c": "troops"}})
    b.send({"t": "g:do", "it": {"k": "build", "b": "castle", "t": 5}})
    b.send({"t": "g:do", "it": {"k": "build", "b": "city", "t": 5}})
    c.send({"t": "g:do", "it": {"k": "spawn", "t": 1}})   # not even in the room
    got = []
    for t in await turns_until(a, lambda t: False, 1.0):
        got += t["i"]
    check([1, {"k": "spawn", "t": 1234}] in got, "spawn move relayed as player 1")
    check([2, {"k": "attack", "t": 999, "r": 100}] in got, "attack relayed as player 2, ratio clamped, junk removed")
    check(not any(mv[1]["k"] == "cheat" for mv in got), "players can't send cheats")
    check([2, {"k": "build", "t": 5, "b": "city"}] in got and not any(mv[1].get("b") == "castle" for mv in got), "unknown buildings dropped")
    check(len(got) == 3, f"exactly the 3 good moves ({len(got)})")

    # spam protection
    for i in range(60):
        b.send({"t": "g:do", "it": {"k": "attack", "t": i, "r": 10}})
    spam = []
    for t in await turns_until(a, lambda t: False, 1.2):
        spam += [mv for mv in t["i"] if mv[0] == 2]
    check(len(spam) <= 40, f"spam limited ({len(spam)} of 60 got through)")

    # admin cheat becomes a move everyone runs
    r = await req(a, "admin:cheat", action="troops"); check(r["ok"], "admin cheat accepted")
    got = []
    for t in await turns_until(a, lambda t: False, 0.6):
        got += t["i"]
    check([1, {"k": "cheat", "c": "troops"}] in got, "cheat goes out to everyone as a move")

    # someone joining mid-game gets the whole log and can catch up
    c.send({"t": "room:join", "code": code, "game": "front"})
    jc = await c.wait("room:joined")
    st = jc["state"]
    flat = [mv for n, moves in st["turns"] for mv in moves]
    check(st["phase"] == "playing" and st["match"]["seed"] == m["seed"] and st["n"] > 20, "late joiner gets the match")
    check([1, {"k": "spawn", "t": 1234}] in flat and [1, {"k": "cheat", "c": "troops"}] in flat, "late joiner gets every earlier move")
    nxt = await c.wait("g:turn")
    check(nxt["n"] == st["n"] + 1, f"late joiner's next turn follows on ({st['n']} -> {nxt['n']})")
    c.send({"t": "g:do", "it": {"k": "attack", "t": 3, "r": 20}})   # spectators can't move
    got = []
    for t in await turns_until(a, lambda t: False, 0.5):
        got += t["i"]
    check(not got, "spectators can't send moves")

    # fingerprints: a mismatch tells the odd one out
    a.drain(); b.drain()
    a.send({"t": "g:hash", "n": 10, "h": 111})
    b.send({"t": "g:hash", "n": 10, "h": 222})
    await asyncio.sleep(0.4)
    des = [m2 for m2 in a.drain() + b.drain() if m2["t"] == "g:desync"]
    check(len(des) == 1, "out-of-sync player is told")

    # the end: one of two players can't decide the winner alone
    a.send({"t": "g:over", "w": {"team": 1}, "tick": 3000, "shares": {"1": 0.5, "2": 0.3}, "names": ["Ann", "Bob", "Bot A", "Bot B"]})
    await asyncio.sleep(0.4)
    check(not [m2 for m2 in a.drain() if m2["t"] == "g:over"], "one report out of two isn't enough")
    b.send({"t": "g:over", "w": {"team": 1}, "tick": 3000, "shares": {"1": 0.5, "2": 0.3}, "names": ["Ann", "Bob", "Bot A", "Bot B"]})
    ov = await a.wait("g:over")
    res = ov["results"]
    check(res["name"] == "Team Red" and [x["won"] for x in res["rows"]] == [True, False], f"results: {res['name']} {[x['won'] for x in res['rows']]}")
    st = (await a.wait("g:state"))["state"]
    check(st["phase"] == "lobby" and st["results"], "back in the lobby with results")
    # turns stop after the game
    await asyncio.sleep(0.3); a.drain()
    await asyncio.sleep(0.4)
    check(not [m2 for m2 in a.drain() if m2["t"] == "g:turn"], "turns stop when the game ends")

    # stats (the admin-cheated game doesn't count: tainted)
    await asyncio.sleep(0.4)
    pa = (await req(b, "profile:get", name="FrontA" + U))["profile"]["stats"]
    check("front.wins" not in pa, f"a game with cheats doesn't count ({pa.get('front.wins')})")

    # a clean game counts
    a.send({"t": "g:settings", "mode": "ffa"}); await a.wait("g:state")
    a.send({"t": "g:start"}); await a.wait("g:start")
    await asyncio.sleep(0.3)
    for w in (a, b):
        w.send({"t": "g:over", "w": {"player": 2}, "tick": 4200, "shares": {"1": 0.1, "2": 0.81}, "names": ["Ann", "Bob"]})
    ov = await a.wait("g:over")
    check(ov["results"]["name"].startswith("FrontB") and ov["results"]["minutes"] == 7.0, f"ffa results: {ov['results']['name']} in {ov['results']['minutes']} min")
    await asyncio.sleep(0.6)
    pb = (await req(a, "profile:get", name="FrontB" + U))["profile"]
    check(pb["stats"].get("front.wins") == 1 and pb["stats"].get("front.games") == 1 and pb["stats"].get("front.best") == 81, f"winner's stats saved: {pb['stats']}")
    pa = (await req(a, "profile:get", name="FrontA" + U))["profile"]
    check(pa["stats"].get("front.games") == 1 and not pa["stats"].get("front.wins"), "loser's game saved as a loss")
    check(any(mm["game"] == "front" and "Won" in mm["detail"] for mm in pb["recent"]), f"match history: {[mm['detail'] for mm in pb['recent']][:2]}")

    # host can stop a game; the leaderboard exists
    a.send({"t": "g:start"}); await a.wait("g:start")
    a.send({"t": "g:stop"}); await a.wait("g:stopped")
    check(True, "host can stop a running game")
    lb = (await req(a, "lb:get", board="front"))["board"]
    check(lb.get("title", "").startswith("🌍") and any(row.get("value") == 1 for row in lb.get("rows", [])), f"leaderboard: {lb.get('title')}")
    # solo wins
    r = await req(b, "stats:solo", game="front-solo", value=12); check(r.get("ok") and r.get("best"), "solo win saved")
    await asyncio.sleep(4.1)
    r = await req(b, "stats:solo", game="front-solo", value=99); check(not r.get("ok"), "silly solo win rejected")
    pb = (await req(a, "profile:get", name="FrontB" + U))["profile"]["stats"]
    check(pb.get("frontsolo.wins") == 1 and pb.get("frontsolo.best") == 12, f"solo stats: {pb.get('frontsolo.wins')} wins, best {pb.get('frontsolo.best')}")
    print("FAILED:", check.failed)

asyncio.run(main())
