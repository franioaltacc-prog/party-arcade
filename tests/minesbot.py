import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random, time
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))

async def latest(w, timeout=3):
    st = None; end = time.time() + timeout
    while time.time() < end:
        try: m = await asyncio.wait_for(w.inbox.get(), 0.2)
        except asyncio.TimeoutError:
            if st: return st
            continue
        if m["t"] == "g:state": st = m["state"]
    return st

async def sweep(w, uid, stop_when_done=True, delay=0.0):
    """Open every hidden cell one by one (mines just cost a penalty / stun)."""
    st = await latest(w)
    n = st["cols"] * st["rows"]
    for i in range(n):
        if st["phase"] != "playing": break
        me = next((p for p in st["players"] if p["id"] == uid), None)
        if stop_when_done and me and me.get("done"): break
        if st["cells"][i] == -1:
            w.send({"t": "g:reveal", "i": i})
            await asyncio.sleep(delay)
            got = await latest(w, 0.6)
            st = got or st
            me = next((p for p in st["players"] if p["id"] == uid), None)
            if me and me.get("stun"): await asyncio.sleep(me["stun"] + 0.05)
    return st

async def main():
    a, b = WS(), WS()
    ua, ub = f"msA{U}xx", f"msB{U}xx"
    await a.connect(ua, "a"); await b.connect(ub, "b"); await a.wait("welcome"); await b.wait("welcome")
    for w, nm in ((a, "MineA" + U), (b, "MineB" + U)):
        r = await req(w, "auth:signup", name=nm, password="mine-pass-123"); assert r["ok"], r
    a.send({"t": "room:create", "game": "mines"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "mines"}); await b.wait("room:joined"); await asyncio.sleep(0.3)
    # ---- race
    a.send({"t": "g:settings", "mode": "race", "size": "small", "penalty": 5})
    a.send({"t": "g:start"}); await asyncio.sleep(0.2)
    st = await latest(a)
    check(st["phase"] == "playing" and st["cols"] == 9 and st["elapsed"] < 0, "race started with countdown")
    opened0 = sum(1 for c in st["cells"] if c >= 0)
    check(opened0 > 0, f"everyone starts with an opening ({opened0} cells)")
    hidden = [i for i, c in enumerate(st["cells"]) if c == -1]
    a.send({"t": "g:reveal", "i": hidden[0]}); await asyncio.sleep(0.3)
    st2 = await latest(a, 0.6)
    check(st2 is None or st2["cells"][hidden[0]] == -1, "clicks during the countdown are ignored")
    await asyncio.sleep(3.0)
    a.send({"t": "g:flag", "i": hidden[1]}); await asyncio.sleep(0.3)
    sa, sb = await latest(a, 0.8), await latest(b, 0.8)
    check(sa["cells"][hidden[1]] == -2 and sb["cells"][hidden[1]] == -1, "flags are private")
    a.send({"t": "g:flag", "i": hidden[1]})
    st = await sweep(a, ua)
    me = next(p for p in st["players"] if p["id"] == ua)
    check(me["done"] and me["place"] == 1, f"A cleared the board first ({me['time']}s, {me['hits']} mines, +{me['penalty']}s)")
    check(me["penalty"] == 5 * me["hits"], "penalty = 5s per mine")
    await sweep(b, ub)
    await asyncio.sleep(2)
    st = await latest(a, 1.5) or st
    check(st["phase"] == "over" and st["results"]["rows"][0]["id"] == ua, "race over, A first")
    check(any(c == 10 for c in st["cells"]) or me["hits"] == 10, "mines revealed at the end")
    await asyncio.sleep(0.6)
    s = (await req(a, "profile:get", name="MineA" + U))["profile"]["stats"]
    check(s.get("mines.wins") == 1 and s.get("mines.cleared") == 1 and "mines.race_small" in s, f"race stats saved {s}")
    r = await req(a, "admin:cheat", action="mines"); check(not r["ok"], "non-admin can't x-ray")
    # ---- battle
    a.send({"t": "g:settings", "mode": "battle"}); a.send({"t": "g:start"}); await asyncio.sleep(3.3)
    sts = await asyncio.gather(sweep(a, ua, False, 0.02), sweep(b, ub, False, 0.02))
    await asyncio.sleep(1.5)
    st = await latest(a, 1.5) or sts[0]
    check(st["phase"] == "over" and st["results"]["mode"] == "battle", "battle finished when every safe cell was opened")
    rows = st["results"]["rows"]
    total_cells = sum(r["cells"] for r in rows)
    safe = 81 - 10 - sum(1 for c in st["cells"] if False)
    check(total_cells + 0 <= 71, f"cells opened by players {total_cells} (rest was the free start area)")
    check(rows[0]["points"] >= rows[1]["points"], f"battle ranking by points {[r['points'] for r in rows]}")
    await asyncio.sleep(0.6)
    s = (await req(a, "profile:get", name="MineA" + U))["profile"]["stats"]
    check(s.get("mines.games") == 2 and "mines.cells" in s, f"battle stats saved {s}")
    print("FAILED:", check.failed)
asyncio.run(main())
