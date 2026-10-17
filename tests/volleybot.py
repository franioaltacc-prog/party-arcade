"""Screen Volley against a real server: picking screens, serves, passing the ball over the net, points,
keep-it-up mode, the direct-connection relay, and someone leaving mid-game."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, random, time
from wsbot import WS
from accbot import req, check

U = str(random.randint(1000, 9999))


async def player(uid, name):
    w = WS(); await w.connect(uid, name)
    w.uid = (await w.wait("welcome"))["id"]
    r = await req(w, "auth:signup", name=name, password="pass" + name + "x")
    assert r["ok"], r
    return w


async def stats(w, name):
    return (await req(w, "profile:get", name=name))["profile"]["stats"]


def got(w, t):
    return [m for m in w.drain() if m["t"] == t]


async def main():
    na, nb = "VolA" + U, "VolB" + U
    a, b = await player("vbotA" + U + "x", na), await player("vbotB" + U + "x", nb)
    a.send({"t": "room:create", "game": "volley"}); j = await a.wait("room:joined")
    check(j["state"]["phase"] == "lobby" and j["state"]["sides"] == {"left": None, "right": None}, "a new court has two empty screens")
    b.send({"t": "room:join", "code": j["code"], "game": "volley"}); await b.wait("room:joined")
    await asyncio.sleep(0.2)

    # the clock
    a.send({"t": "g:sync", "c": 123.5}); s = await a.wait("g:sync")
    check(s["c"] == 123.5 and abs(s["s"] - time.time() * 1000) < 2000, "the server tells the time")

    a.send({"t": "g:start"}); await asyncio.sleep(0.2)
    check(not got(a, "g:serve"), "no game without both screens")
    a.send({"t": "g:side", "side": "left"}); b.send({"t": "g:side", "side": "left"})
    await asyncio.sleep(0.3)
    st = [m for m in a.drain() if m["t"] == "g:state"][-1]
    check(st["sides"]["left"] == a.uid and st["sides"]["right"] is None, "first come, first served for the left screen")
    b.send({"t": "g:side", "side": "right"}); await asyncio.sleep(0.2)

    # direct connection details only go to the other screen
    a.send({"t": "g:rtc", "data": {"id": "x1", "kind": "offer", "sdp": "v=0"}})
    r = await b.wait("g:rtc")
    check(r["data"]["kind"] == "offer", "connection details are passed to the other screen")

    a.send({"t": "g:settings", "mode": "versus", "target": 5}); await asyncio.sleep(0.2)
    a.drain(); b.drain()
    a.send({"t": "g:start"})
    sv = await a.wait("g:serve")
    check(sv["side"] == "left" and sv["at"] > time.time() * 1000, "the left screen serves first, a moment from now")
    e = sv["epoch"]

    # B can't pass a ball it doesn't have
    b.send({"t": "g:cross", "epoch": e, "at": time.time() * 1000 + 300, "y": 0.4, "vx": -2, "vy": 0})
    await asyncio.sleep(0.2)
    check(not got(a, "g:cross"), "only the screen with the ball can pass it")

    # A sends it over: B hears about it in advance
    at = time.time() * 1000 + 400
    a.send({"t": "g:cross", "epoch": e, "at": at, "y": -1.25, "vx": 2.1, "vy": -0.5, "a": 1, "spin": 2, "d": 0.01})
    c = await b.wait("g:cross")
    check(c["epoch"] == e + 1 and c["at"] == at and c["y"] == -1.25 and c["vx"] == 2.1 and c["d"] == 0.01, "a ball crossing above the screen is relayed at its true height and time")
    check(not got(a, "g:cross"), "the sender doesn't get its own ball back")
    a.send({"t": "g:cross", "epoch": e, "at": at, "y": 0.42, "vx": 2.1, "vy": -0.5})
    await asyncio.sleep(0.2)
    check(not got(b, "g:cross"), "a ball can't be passed twice")
    # nonsense is ignored
    b.send({"t": "g:cross", "epoch": e + 1, "at": "soon", "y": 7, "vx": 1e9, "vy": 0})
    await asyncio.sleep(0.2)
    check(not got(a, "g:cross"), "impossible balls are ignored")
    b.send({"t": "g:cross", "epoch": e + 1, "at": time.time() * 1000 + 200, "y": -4.1, "vx": -1, "vy": 0})
    b.send({"t": "g:cross", "epoch": e + 1, "at": time.time() * 1000 + 200, "y": 0.8, "vx": -1, "vy": 0})
    await asyncio.sleep(0.2)
    check(not got(a, "g:cross"), "out-of-range heights and passes below the net are still rejected")

    # it drops on B's floor: A scores and serves
    b.send({"t": "g:drop", "epoch": e + 1})
    p = await a.wait("g:point")
    check(p["side"] == "left" and p["score"] == {"left": 1, "right": 0}, "the ball hit B's floor: a point for A")
    sv = await a.wait("g:serve")
    check(sv["side"] == "left", "the one who scored serves")
    b.send({"t": "g:drop", "epoch": e + 1}); await asyncio.sleep(0.2)
    check(not got(a, "g:point"), "an old ball can't lose another point")

    # a drop that arrives before the pass that gave the ball (crossed messages) still counts
    e = sv["epoch"]
    b.send({"t": "g:drop", "epoch": e + 1})
    await asyncio.sleep(0.1)
    a.send({"t": "g:cross", "epoch": e, "at": time.time() * 1000 + 300, "y": 0.4, "vx": 2, "vy": 0})
    p = await a.wait("g:point")
    check(p["score"]["left"] == 2, "a drop that overtakes its pass still counts")
    b.drain()

    # play it out: A wins 5-0
    for _ in range(3):
        sv = await a.wait("g:serve")
        a.send({"t": "g:cross", "epoch": sv["epoch"], "at": time.time() * 1000 + 300, "y": 0.4, "vx": 2, "vy": 0})
        c = await b.wait("g:cross")
        b.send({"t": "g:drop", "epoch": c["epoch"]})
    fin = [m for m in (await asyncio.sleep(0.5) or a.drain()) if m["t"] == "g:state" and m["phase"] == "over"]
    check(fin and fin[-1]["final"]["winner"] == "left" and fin[-1]["final"]["score"] == {"left": 5, "right": 0}, "A wins 5–0")
    await asyncio.sleep(0.5)
    sa, sb = await stats(a, na), await stats(b, nb)
    check(sa.get("volley.wins") == 1 and sa.get("volley.points") == 5 and sa.get("volley.best_rally") == 1, f"A's stats {sa}")
    check(sb.get("volley.games") == 1 and not sb.get("volley.wins"), f"B's stats {sb}")

    # keep-it-up together: three drops and it's over, passes count
    a.send({"t": "g:settings", "mode": "coop"}); await asyncio.sleep(0.2)
    a.drain(); b.drain()
    a.send({"t": "g:start"})
    for life in range(3):
        sv = await a.wait("g:serve")
        side = sv["side"]
        holder, other = (a, b) if side == "left" else (b, a)
        ep = sv["epoch"]
        for k in range(4 if life == 0 else 1):   # pass back and forth
            holder.send({"t": "g:cross", "epoch": ep, "at": time.time() * 1000 + 200, "y": 0.4, "vx": 2 if holder is a else -2, "vy": 0})
            c = await other.wait("g:cross")
            ep = c["epoch"]
            holder, other = other, holder
        holder.send({"t": "g:drop", "epoch": ep})
        p = await a.wait("g:point")
        check(p["lives"] == 2 - life, f"drop {life + 1}: {p['lives']} lives left")
    await asyncio.sleep(0.5)
    fin = [m for m in a.drain() if m["t"] == "g:state" and m["phase"] == "over"]
    check(fin and fin[-1]["final"]["mode"] == "coop" and fin[-1]["final"]["passes"] == 6 and fin[-1]["final"]["best"] == 4, f"keep-it-up: 6 passes, longest rally 4 ({fin and fin[-1]['final']})")
    await asyncio.sleep(0.3)
    sa = await stats(a, na)
    check(sa.get("volley.coop_best") == 6 and sa.get("volley.best_rally") == 4, f"keep-it-up stats {sa}")

    # leaving mid-game hands the win to the other player
    a.send({"t": "g:settings", "mode": "versus"}); await asyncio.sleep(0.2)
    a.send({"t": "g:start"}); await a.wait("g:serve")
    b.send({"t": "room:leave"}); await asyncio.sleep(0.5)
    fin = [m for m in a.drain() if m["t"] == "g:state" and m["phase"] == "over"]
    check(fin and fin[-1]["final"]["winner"] == "left" and fin[-1]["final"]["forfeit"] == "right", "B left: A wins")
    await asyncio.sleep(0.3)
    sa = await stats(a, na)
    check(sa.get("volley.wins") == 2, f"…and it counts ({sa.get('volley.wins')})")
    a.send({"t": "room:leave"}); await asyncio.sleep(0.2)
    print("FAILED:", check.failed)

asyncio.run(main())
