"""Unrevvd's chutes against a real server: a best-time board for every race challenge (impossible times turned away),
today's Daily Chute board, the Downhill World Cup board, this week's Weekly Challenge board, the record ghosts (only the fastest run, and only if it's the
time you saved), and the room games: Forest Tag (who's it, tags checked against where riders are, the least time
being it wins), the Lantern Hunt's scores and the Lantern Relay (passing it to a teammate; the whole team finishes
together)."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, datetime, random, time
from wsbot import WS
from accbot import req, check

U = str(random.randint(1000, 9999))
GHOST = {"v": 1, "f": ["px", "pz", "h"], "frames": [[0, 0, -258, 1.57], [0.13, 0, -257, 1.57]]}


async def player(uid, name):
    w = WS(); await w.connect(uid, name)
    w.uid = (await w.wait("welcome"))["id"]
    r = await req(w, "auth:signup", name=name, password="pass" + name + "x")
    assert r["ok"], r
    return w


async def solo(w, game, ms):
    await asyncio.sleep(4.1)   # (the server allows one solo score every 4 seconds)
    return await req(w, "stats:solo", game=game, value=ms)


async def main():
    na, nb = "ChuteA" + U, "ChuteB" + U
    a = await player("chA" + U + "x", na)
    b = await player("chB" + U + "x", nb)

    # ---------------------------------------------------------------- boards
    r = await req(a, "lb:boards")
    keys = {x["key"] for x in r["boards"]}
    check({"mch_timber-run", "mch_frozen-run", "mch_night-run", "mch_autumn-run", "mch_board-run", "mch_daily", "mch_cup"} <= keys,
          "every chute, the Daily Chute and the World Cup have a leaderboard")
    check("mch_lantern-hunt" not in keys and "mch_forest-tag" not in keys, "only races have time boards")
    r = await solo(a, "mch-timber-run", 3000)
    check(not r["ok"], "a Timber Run faster than anyone could ride it is turned away")
    r = await solo(a, "mch-timber-run", 61234)
    check(r["ok"] and r["best"], "a real Timber Run time is saved as a best")
    r = await req(a, "lb:get", board="mch_timber-run")
    check(r["board"]["rows"] and r["board"]["rows"][0]["name"] == na and r["board"]["rows"][0]["value"] == 61234, "the Timber Run board shows it")
    r = await solo(b, "mch-daily", 70000)
    day = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d")
    st = (await req(b, "profile:get", name=nb))["profile"]["stats"]
    check(r["ok"] and st.get(f"mchdaily{day}.best") == 70000, f"a Daily Chute time goes on today's board ({st.get(f'mchdaily{day}.best')})")
    r = await req(b, "lb:get", board="mch_daily")
    check(any(x["name"] == nb and x["value"] == 70000 for x in r["board"]["rows"]), "today's Daily Chute board shows it")
    r = await solo(b, "mch-cup", 30000)
    check(not r["ok"], "a World Cup quicker than five chutes could be ridden is turned away")
    r = await solo(b, "mch-cup", 321000)
    check(r["ok"] and r["best"], "a World Cup time is saved")

    # ---------------------------------------------------------------- the Weekly Challenge
    import accounts
    wc = accounts.weekly_challenge()
    r = await solo(a, "mch-weekly", 1000)
    check(not r["ok"], f"a Weekly Challenge ({wc['id']}) quicker than it could be ridden is turned away")
    good = accounts._fastest_ms(wc) + 15000
    r = await solo(a, "mch-weekly", good)
    st = (await req(a, "profile:get", name=na))["profile"]["stats"]
    check(r["ok"] and r["best"] and st.get(f"{accounts.weekly_key()}.best") == good, "a Weekly Challenge time goes on this week's board")
    r = await req(b, "lb:get", board="mch_weekly")
    check(any(x["name"] == na and x["value"] == good for x in r["board"]["rows"]), "this week's board shows it")
    r = await req(a, "ghost:put", game="mch-weekly", ms=good, data=GHOST)
    g = (await req(b, "ghost:get", game="mch-weekly"))["ghost"]
    check(r["kept"] and g and g["name"] == na, "the Weekly Challenge has a record ghost too")

    # ---------------------------------------------------------------- record ghosts
    r = await req(a, "ghost:get", game="mch-timber-run")
    check(r["ok"] and r["ghost"] is None, "no ghost before anyone has sent one")
    r = await req(a, "ghost:put", game="mch-timber-run", ms=60000, data=GHOST)
    check(r["ok"] and not r["kept"], "a ghost that isn't your saved best isn't kept")
    r = await req(a, "ghost:put", game="mch-timber-run", ms=61234, data=GHOST)
    check(r["ok"] and r["kept"], "your best run becomes the record ghost")
    r = await req(b, "ghost:get", game="mch-timber-run")
    check(r["ghost"] and r["ghost"]["name"] == na and r["ghost"]["ms"] == 61234 and r["ghost"]["data"]["frames"] == GHOST["frames"], "anyone can race the record ghost")
    await solo(b, "mch-timber-run", 65000)
    r = await req(b, "ghost:put", game="mch-timber-run", ms=65000, data=GHOST)
    check(r["ok"] and not r["kept"], "a slower run doesn't replace the record ghost")
    await solo(b, "mch-timber-run", 59000)
    r = await req(b, "ghost:put", game="mch-timber-run", ms=59000, data=GHOST)
    g = (await req(a, "ghost:get", game="mch-timber-run"))["ghost"]
    check(r["kept"] and g["name"] == nb and g["ms"] == 59000, "a faster one does")
    r = await req(a, "ghost:put", game="mch-timber-run", ms=61234, data={"v": 1, "frames": "lots"})
    check(not r["ok"], "a ghost that isn't a recorded run is turned away")
    r = await req(b, "ghost:put", game="mch-daily", ms=70000, data=GHOST)
    check(r["ok"] and r["kept"], "the Daily Chute has a ghost of its own")

    # ---------------------------------------------------------------- Forest Tag
    a.send({"t": "room:create", "game": "moto"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "moto"}); await b.wait("room:joined")
    await asyncio.sleep(0.2)
    a.send({"t": "g:settings", "mode": "challenge", "challenge": "forest-tag"}); await asyncio.sleep(0.2)
    a.send({"t": "g:ready", "ready": True}); b.send({"t": "g:ready", "ready": True})
    st = await a.wait("g:start")
    race = st["race"]
    check(race.get("kind") == "tag" and race.get("it") in (a.uid, b.uid) and race.get("itTimes") == {a.uid: 0, b.uid: 0}, "Forest Tag starts with someone it")
    it, other = (a, b) if race["it"] == a.uid else (b, a)
    await asyncio.sleep(st["countdown"] + 3.2)   # (the start, and the first few seconds nobody can be tagged)
    pos = lambda w, x, z: w.send({"t": "g:pos", "x": 0, "px": x, "pz": z, "h": 0, "y": 40, "a": 0, "s": 20})
    pos(it, 0, 0); pos(other, 20, 0); await asyncio.sleep(0.2)
    other.drain()
    it.send({"t": "g:tag", "id": other.uid}); await asyncio.sleep(0.3)
    check(not [m for m in other.drain() if m["t"] == "g:tag"], "a tag from 20 m away doesn't count")
    other.send({"t": "g:tag", "id": it.uid}); await asyncio.sleep(0.3)
    check(not [m for m in it.drain() if m["t"] == "g:tag"], "only whoever is it can tag")
    pos(other, 2, 0); await asyncio.sleep(0.2)
    it.send({"t": "g:tag", "id": other.uid})
    tg = await other.wait("g:tag")
    check(tg["it"] == other.uid and tg["by"] == it.uid and tg["itTimes"][it.uid] > 2, f"riding into them passes it on ({tg['itTimes']})")
    await asyncio.sleep(0.2); it.drain()
    other.send({"t": "g:tag", "id": it.uid}); await asyncio.sleep(0.3)
    check(not [m for m in it.drain() if m["t"] == "g:tag"], "no tagging straight back")
    await asyncio.sleep(1)
    a.send({"t": "g:stop"})
    res = await b.wait("g:results")
    rows = res["results"]["rows"]
    check(res["results"]["kind"] == "tag" and rows[0]["id"] == other.uid and rows[0]["place"] == 1 and rows[0]["score"] < rows[1]["score"],
          f"the least time being it wins ({[(r['name'], r['score']) for r in rows]})")

    # ---------------------------------------------------------------- the Lantern Hunt
    a.send({"t": "g:settings", "challenge": "lantern-hunt"}); await asyncio.sleep(0.2)
    a.send({"t": "g:ready", "ready": True}); b.send({"t": "g:ready", "ready": True})
    st = await a.wait("g:start")
    check(st["race"].get("kind") == "lanterns", "the Lantern Hunt starts for the room")
    await asyncio.sleep(st["countdown"] + 0.3)
    a.send({"t": "g:score", "score": 7}); b.send({"t": "g:score", "score": 99}); await asyncio.sleep(0.3)
    a.send({"t": "g:score", "score": 11}); await asyncio.sleep(0.3)
    a.send({"t": "g:stop"})
    res = await b.wait("g:results")
    rows = res["results"]["rows"]
    check(rows[0]["id"] == a.uid and rows[0]["score"] == 11 and rows[1]["score"] is None, "most lanterns wins (and an impossible count doesn't count)")

    # ---------------------------------------------------------------- the Lantern Relay (three riders: two teams)
    cc = await player("chC" + U + "x", "ChuteC" + U)
    cc.send({"t": "room:join", "code": j["code"], "game": "moto"}); await cc.wait("room:joined"); await asyncio.sleep(0.2)
    a.send({"t": "g:settings", "challenge": "lantern-relay"}); await asyncio.sleep(0.2)
    for w in (a, b, cc): w.send({"t": "g:ready", "ready": True})
    st = await a.wait("g:start")
    race = st["race"]; teams = race.get("teams", {})
    check(race.get("kind") == "relay" and sorted(len(v) for v in teams.values()) == [1, 2] and all(race["carrier"][t] == v[0] for t, v in teams.items()),
          f"the Lantern Relay starts with two teams, the first of each carrying ({teams})")
    t2 = next(t for t, v in teams.items() if len(v) == 2); first, second = teams[t2]
    lone = next(v[0] for t, v in teams.items() if len(v) == 1)
    by = {w.uid: w for w in (a, b, cc)}
    await asyncio.sleep(st["countdown"] + 0.3)
    pos(by[first], 0, -250); pos(by[second], 0, 0); pos(by[lone], 3, -250); await asyncio.sleep(0.2)
    for w in (a, b, cc): w.drain()
    by[first].send({"t": "g:pass", "id": second}); await asyncio.sleep(0.3)
    check(not [m for m in by[second].drain() if m["t"] == "g:relay"], "the lantern can't be passed from 250 m away")
    by[first].send({"t": "g:finish", "time": 20000, "cp": 0}); await asyncio.sleep(0.3)
    check(not [m for m in by[second].drain() if m["t"] == "g:finish"], "the first rider can't finish for the team: there's another leg")
    pos(by[first], 1, 0); await asyncio.sleep(0.2)
    by[first].send({"t": "g:pass", "id": second})
    rl = await by[second].wait("g:relay")
    check(rl["carrier"] == second and rl["by"] == first and rl["leg"] == 1, "riding up to your teammate passes the lantern on")
    await asyncio.sleep(5)   # (a time quicker than the chute can be ridden doesn't count)
    by[lone].send({"t": "g:finish", "time": 5200, "cp": 0})
    await by[first].wait("g:finish")
    by[second].send({"t": "g:finish", "time": 5600, "cp": 0})
    res = await a.wait("g:results")
    rows = {r["id"]: r for r in res["results"]["rows"]}
    check(res["results"]["kind"] == "relay" and rows[lone]["place"] == 1 and rows[first]["place"] == 2 and rows[second]["place"] == 2 and rows[first]["done"],
          f"the first team down wins, and the whole team finishes together ({[(r['name'], r['place'], r['time']) for r in res['results']['rows']]})")
    cc.send({"t": "room:leave"})
    a.send({"t": "room:leave"}); b.send({"t": "room:leave"}); await asyncio.sleep(0.2)
    print("FAILED:", check.failed)

asyncio.run(main())
