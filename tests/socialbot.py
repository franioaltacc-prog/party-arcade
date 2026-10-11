import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random, time
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))


async def wait_for(ws, t, timeout=5, pred=None):
    """Wait for message type t (also looks at messages req() put aside)."""
    for i, m in enumerate(getattr(ws, "pushed", [])):
        if m["t"] == t and (pred is None or pred(m)):
            ws.pushed.pop(i)
            return m
    end = time.time() + timeout
    while True:
        m = await asyncio.wait_for(ws.inbox.get(), max(0.01, end - time.time()))
        if m["t"] == t and (pred is None or pred(m)):
            return m


async def try_wait(ws, t, timeout=1.0, pred=None):
    try:
        return await wait_for(ws, t, timeout, pred)
    except asyncio.TimeoutError:
        return None


def clear(*ws):
    for w in ws:
        w.drain()
        w.pushed = []


async def friends():
    a, b, c = WS(), WS(), WS()
    await a.connect("frA" + U + "xx", "Ann"); await b.connect("frB" + U + "xx", "Bob"); await c.connect("frC" + U + "xx", "Cat")
    for w in (a, b, c):
        await w.wait("welcome")
    na, nb, nc = "FrAnn" + U, "FrBob" + U, "FrCat" + U
    r = await req(c, "friends:list"); check(not r["ok"] and "log in" in r["error"], "guests can't use friends")
    ta = (await req(a, "auth:signup", name=na, password="friend-pass-1"))
    tb = (await req(b, "auth:signup", name=nb, password="friend-pass-2"))
    tc = (await req(c, "auth:signup", name=nc, password="friend-pass-3"))
    check(ta["ok"] and tb["ok"] and tc["ok"], "three accounts")

    r = await req(a, "friends:add", name=na); check(not r["ok"] and "yourself" in r["error"], "can't add yourself")
    r = await req(a, "friends:add", name="nobody-" + U); check(not r["ok"] and "No player" in r["error"], "unknown name")
    clear(b)
    r = await req(a, "friends:add", name=nb.lower()); check(r["ok"] and r["state"] == "sent" and r["name"] == nb, "request sent (name is case-insensitive)")
    p = await try_wait(b, "friends:ping"); check(p and p["kind"] == "request" and p["name"] == na, "Bob is told about the request")
    r = await req(a, "friends:add", name=nb); check(r["ok"] and r["state"] == "sent", "asking twice is harmless")
    r = await req(b, "friends:list")
    check(r["ok"] and [x["name"] for x in r["incoming"]] == [na] and not r["friends"], "Bob sees Ann's request")
    r = await req(a, "friends:list"); check([x["name"] for x in r["outgoing"]] == [nb], "Ann sees her request waiting")
    clear(a)
    r = await req(b, "friends:add", name=na); check(r["ok"] and r["state"] == "friends", "Bob adding Ann accepts it")
    p = await try_wait(a, "friends:ping"); check(p and p["kind"] == "accepted", "Ann is told it was accepted")
    r = await req(a, "friends:list")
    f = r["friends"][0] if r["friends"] else {}
    check(f.get("name") == nb and f.get("online") and f.get("room") is None and not r["outgoing"], "Ann's friend list has Bob, online")
    check("look" in f and "level" in f and "avatar" in f, "friend rows carry avatar, look and level")
    r = await req(a, "friends:add", name=nb); check(not r["ok"] and "already friends" in r["error"], "already friends")

    # Bob opens a room: Ann sees where he is
    b.send({"t": "room:create", "game": "doodle"}); j = await wait_for(b, "room:joined")
    r = await req(a, "friends:list"); room = r["friends"][0]["room"]
    check(room and room["code"] == j["code"] and room["game"] == "doodle" and room["title"] == "Doodle Guess" and not room["live"] and not room["full"], f"Ann sees Bob's room {room}")
    pr = (await req(a, "profile:get", name=nb))["profile"]
    check(pr.get("friend") == "ok" and pr["where"]["room"]["code"] == j["code"], "profile shows friendship and room")
    pr = (await req(c, "profile:get", name=nb))["profile"]
    check(pr.get("friend") is None and "where" not in pr, "strangers don't see the room on the profile")

    # Cat on a solo game page: friends see "playing Slope"
    c2 = WS()
    await c2.connect("frD" + U + "xx", "Cat")
    c2.send({"t": "hello", "id": "frD" + U + "xx", "name": "Cat", "avatar": "🐱", "color": "#22d3ee", "token": tc["token"], "page": "slope"})
    await wait_for(c2, "auth:state", pred=lambda m: m.get("user"))
    await req(c, "auth:logout", token=tc["token"])   # only the slope tab is still logged in... (logout ends the token)
    r = await req(a, "friends:add", name=nc); check(r["ok"] and r["state"] == "sent", "Ann asks Cat")
    r = await req(c2, "friends:list"); check([x["name"] for x in r["incoming"]] == [na], "Cat (on the slope page) sees it")
    await req(c2, "friends:add", name=na)
    r = await req(a, "friends:list")
    cat = next((x for x in r["friends"] if x["name"] == nc), {})
    check(cat.get("page") == {"game": "slope", "title": "Slope"} and cat.get("room") is None, f"Ann sees Cat playing Slope: {cat.get('page')}")
    check([x["name"] for x in r["friends"]] == [nb, nc], "friends with rooms listed first")

    # remove / decline / cancel
    r = await req(a, "friends:remove", name=nb); check(r["ok"], "unfriend")
    r = await req(b, "friends:list"); check(not r["friends"], "gone for both")
    await req(a, "friends:add", name=nb)
    r = await req(b, "friends:remove", name=na); check(r["ok"], "decline")
    r = await req(a, "friends:list"); check(not r["outgoing"] and [x["name"] for x in r["friends"]] == [nc], "declined request disappears")
    for w in (a, b, c, c2):
        w.w.close()


async def watching():
    a, b, v = WS(), WS(), WS()
    await a.connect("waA" + U + "xx", "Host"); await b.connect("waB" + U + "xx", "Pal"); await v.connect("waV" + U + "xx", "Viewer")
    for w in (a, b, v):
        await w.wait("welcome")
    a.send({"t": "room:create", "game": "blitz"}); j = await wait_for(a, "room:joined"); code = j["code"]
    b.send({"t": "room:join", "code": code, "game": "blitz"}); await wait_for(b, "room:joined")
    v.send({"t": "room:join", "code": code, "game": "blitz", "watch": True}); jv = await wait_for(v, "room:joined")
    me = next(p for p in jv["players"] if p["id"] == "waV" + U + "xx")
    check(me.get("watch") is True, "watcher joins as a watcher")
    check("party" in jv and "vote" in jv, "room:joined carries party and vote")
    v.send({"t": "rooms:list"}); rl = await wait_for(v, "rooms:list")
    mine = next((r for r in rl["rooms"] if r["code"] == code), None)
    check(mine and mine["players"] == 2 and mine["watchers"] == 1 and not mine["live"], f"room list counts players and watchers: {mine}")
    clear(a, b, v)
    a.send({"t": "g:settings", "rounds": 3}); a.send({"t": "g:start"})
    beg = await wait_for(v, "g:begin")
    check(set(beg["scores"]) == {"waA" + U + "xx", "waB" + U + "xx"}, "the watcher isn't in the round")
    v.send({"t": "rooms:list"}); rl = await wait_for(v, "rooms:list")
    mine = next((r for r in rl["rooms"] if r["code"] == code), None)
    check(mine and mine["live"], "a game in progress shows as live")
    v.send({"t": "room:vote", "choice": "again"})   # no vote running: ignored
    v.send({"t": "room:watch", "watch": False})
    pl = await wait_for(v, "room:players", pred=lambda m: not any(p.get("watch") for p in m["players"]))
    check(pl is not None, "nobody is watching any more")
    sc = await wait_for(v, "g:scores", timeout=3)
    check("waV" + U + "xx" in sc["scores"], "✋ Join in adds the watcher to the game")

    # full rooms: Family Life holds 4 players; a fifth can only watch
    ls = [WS() for _ in range(5)]
    for i, w in enumerate(ls):
        await w.connect(f"lf{i}" + U + "xx", f"L{i}")
        await w.wait("welcome")
    ls[0].send({"t": "room:create", "game": "life"}); jl = await wait_for(ls[0], "room:joined")
    for w in ls[1:4]:
        w.send({"t": "room:join", "code": jl["code"], "game": "life"}); await wait_for(w, "room:joined")
    x = ls[4]
    x.send({"t": "room:join", "code": jl["code"], "game": "life"}); e = await wait_for(x, "error")
    check("full" in e["msg"] and "watch" in e["msg"], "a full room says you can watch")
    x.send({"t": "room:join", "code": jl["code"], "game": "life", "watch": True}); j3 = await wait_for(x, "room:joined")
    check("lf4" + U + "xx" not in j3["state"]["chars"], "the watcher doesn't get a character")
    x.send({"t": "room:watch", "watch": False}); e = await wait_for(x, "error")
    check("full" in e["msg"], "can't join in when the room is full")
    c1 = c2 = c3 = ls[0]
    for w in (a, b, v, *ls):
        w.w.close()


async def votes_and_party():
    a, b, v = WS(), WS(), WS()
    ua, ub = "voA" + U + "xx", "voB" + U + "xx"
    await a.connect(ua, "Ann"); await b.connect(ub, "Bob"); await v.connect("voV" + U + "xx", "Viewer")
    for w in (a, b, v):
        await w.wait("welcome")
    na, nb = "PtAnn" + U, "PtBob" + U
    await req(a, "auth:signup", name=na, password="party-pass-1"); await req(b, "auth:signup", name=nb, password="party-pass-2")
    a.send({"t": "room:create", "game": "dash"}); j = await wait_for(a, "room:joined"); code = j["code"]
    b.send({"t": "room:join", "code": code, "game": "dash"}); await wait_for(b, "room:joined")
    v.send({"t": "room:join", "code": code, "game": "dash", "watch": True}); await wait_for(v, "room:joined")

    async def race(first, second):
        clear(a, b, v)
        a.send({"t": "g:start"}); await wait_for(a, "g:start")
        first.send({"t": "g:finish", "time": 30000, "attempts": 2})
        second.send({"t": "g:finish", "time": 40000, "attempts": 5})
        await wait_for(a, "g:results", timeout=6)

    # play-again vote
    await race(a, b)
    vt = await wait_for(b, "room:vote", pred=lambda m: m["vote"])
    check(vt["vote"]["kind"] == "next" and vt["vote"]["voters"] == 2 and vt["vote"]["left"] >= 18, f"after a game everyone votes: {vt['vote']}")
    v.send({"t": "room:vote", "choice": "new"})   # watchers can't vote
    a.send({"t": "room:vote", "choice": "again"})
    vt = await wait_for(b, "room:vote")
    check(vt["vote"] and vt["vote"]["counts"] == {"again": 1}, f"one vote counted, watcher ignored: {vt['vote']}")
    clear(a, b, v)
    b.send({"t": "room:vote", "choice": "again"})
    st = await try_wait(a, "g:start", 3)
    check(st is not None, "🔁 play again restarts the game for everyone")
    check(set(st["race"]["runners"]) == {ua, ub} if st else False, "the restarted race has just the players")

    # new game: vote, then pick
    a.send({"t": "g:finish", "time": 31000}); b.send({"t": "g:finish", "time": 32000})
    await wait_for(a, "room:vote", timeout=6, pred=lambda m: m["vote"] and m["vote"]["kind"] == "next")
    a.send({"t": "room:vote", "choice": "new"}); b.send({"t": "room:vote", "choice": "new"})
    pk = await wait_for(a, "room:vote", pred=lambda m: m["vote"] and m["vote"]["kind"] == "pick")
    check("blitz" in pk["vote"]["options"] and "front" in pk["vote"]["options"], "🎮 new game opens a pick vote")
    a.send({"t": "room:vote", "choice": "chess"})
    a.send({"t": "room:vote", "choice": "mines"}); b.send({"t": "room:vote", "choice": "mines"})
    go = await wait_for(v, "room:goto", 3)
    check(go["game"] == "mines" and go["code"] == code, "everyone (watchers too) moves to the picked game")
    # pages reload: rejoin on the new game page
    for w, g in ((a, "dash"), (a, "mines"), (b, "mines"), (v, "mines")):
        pass
    a.send({"t": "room:join", "code": code, "game": "dash"}); e = await wait_for(a, "error")
    check(e.get("code") == "wronggame" and e.get("game") == "mines", "an old page is sent to the new game")
    for w in (a, b, v):
        w.send({"t": "room:join", "code": code, "game": "mines"})
    jv = await wait_for(v, "room:joined")
    check(jv["game"] == "mines" and any(p["id"] == v_id and p.get("watch") for p in jv["players"] for v_id in ["voV" + U + "xx"]), "the watcher is still watching after the move")

    # host tools
    b.send({"t": "party:start", "games": ["dash", "blitz"]})   # not the host
    a.send({"t": "party:start", "games": ["dash", "nope"]})
    e = await wait_for(a, "error"); check("2 to 8" in e["msg"], "bad playlists are refused")
    nothing = await try_wait(a, "party:state", 0.5)
    check(nothing is None, "only the host can start a party")
    clear(a, b, v)
    a.send({"t": "room:switch", "game": "dash"})
    go = await wait_for(b, "room:goto"); check(go["game"] == "dash", "🔀 host switches game")
    for w in (a, b, v):
        w.send({"t": "room:join", "code": code, "game": "dash"})
    await wait_for(a, "room:joined"); await wait_for(b, "room:joined")

    # party: dash twice; places become points
    clear(a, b, v)
    a.send({"t": "party:start", "games": ["dash", "dash"]})
    ps = await wait_for(b, "party:state")
    p = ps["party"]
    check(p["list"] == ["dash", "dash"] and p["i"] == 0 and not p["done"] and {r["id"] for r in p["board"]} == {ua, ub}, f"party started: {p}")
    await race(b, a)
    ps = await wait_for(a, "party:state", timeout=4)
    p = ps["party"]
    check(p["next"] == "dash" and p["nextIn"] in (9, 10) and p["last"]["gained"] == {ub: 10, ua: 7}, f"points after game 1: {p['last']}")
    check(p["board"][0]["id"] == ub and p["board"][0]["points"] == 10, "Bob leads the party")
    nv = await try_wait(a, "room:vote", 0.5, pred=lambda m: m["vote"])
    check(nv is None, "no play-again vote during a party")
    ps = await wait_for(a, "party:state", timeout=13)
    check(ps["party"]["i"] == 1 and ps["party"]["next"] is None, "the party moves on to game 2 by itself")
    await race(a, b)
    ps = await wait_for(a, "party:state", timeout=4)
    p = ps["party"]
    check(p["done"] and [r["points"] for r in p["board"]] == [17, 17], f"party over, a 17-17 tie: {p['board']}")
    await asyncio.sleep(0.8)
    st = (await req(a, "profile:get", name=na))["profile"]["stats"]
    check(st.get("party.games") == 1 and st.get("party.points") == 17 and not st.get("party.wins"), f"party saved (tie = no win): {st.get('party.games')}, {st.get('party.points')}")
    check(st.get("games") == 4, f"the party doesn't count as an extra game: games={st.get('games')}")
    ms = (await req(a, "profile:get", name=na))["profile"].get("recent") or []
    check(any(m.get("game") == "party" for m in ms), "party shows in match history")

    # party with a clear winner, then stop
    clear(a, b, v)
    a.send({"t": "party:start", "games": ["dash", "mines"]})
    await wait_for(a, "party:state")
    await race(a, b)
    ps = await wait_for(a, "party:state", timeout=4, pred=lambda m: m["party"] and m["party"].get("next"))
    a.send({"t": "party:stop"})
    ps = await wait_for(b, "party:state", pred=lambda m: m["party"] is None)
    check(ps is not None, "host can end the party")
    gone = await try_wait(b, "room:goto", 11)
    check(gone is None, "a stopped party doesn't move anyone")
    for w in (a, b, v):
        w.w.close()


async def main():
    await friends()
    await watching()
    await votes_and_party()
    print("FAILED:", check.failed)

asyncio.run(main())
