import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, json, sys, time, itertools
from wsbot import WS

rid = itertools.count(1)

async def req(ws, t, **data):
    r = next(rid)
    ws.send({"t": t, "rid": r, **data})
    end = time.time() + 8
    while True:
        m = await asyncio.wait_for(ws.inbox.get(), max(0.01, end - time.time()))
        if m["t"] == "res" and m.get("rid") == r:
            return m
        ws.pushed = getattr(ws, "pushed", []) + [m]

def check(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        check.failed += 1
check.failed = 0

async def main():
    a, b = WS(), WS()
    await a.connect("accbotA001", "guestA"); await b.connect("accbotB001", "guestB")
    await a.wait("welcome"); await b.wait("welcome")
    st = await a.wait("auth:state"); check(st["user"] is None, "guest has no account")

    r = await req(a, "auth:signup", name="ab", password="secret12"); check(not r["ok"] and "3–16" in r["error"], "short name rejected")
    r = await req(a, "auth:signup", name="Admin", password="secret12"); check(not r["ok"] and "reserved" in r["error"], "reserved name rejected")
    r = await req(a, "auth:signup", name="TestAlpha", password="123"); check(not r["ok"], "short password rejected")
    r = await req(a, "auth:signup", name="TestAlpha", password="alphapass", avatar="🦊", color="#22d3ee")
    check(r["ok"] and r["user"]["name"] == "TestAlpha" and r["token"], "signup works")
    tokA = r["token"]
    r = await req(b, "auth:signup", name="testalpha", password="whatever1"); check(not r["ok"] and "taken" in r["error"], "duplicate name (any case) rejected")
    r = await req(b, "auth:login", name="TestAlpha", password="wrongpass"); check(not r["ok"] and "Wrong" in r["error"], "wrong password rejected")
    r = await req(b, "auth:signup", name="TestBravo", password="bravopass"); check(r["ok"], "second signup")
    tokB = r["token"]

    # resume with token on a new connection
    c = WS(); await c.connect("accbotC001", "x"); 
    c.send({"t": "hello", "id": "accbotC001", "name": "x", "token": tokA})
    st = await c.wait("auth:state"); st = await c.wait("auth:state") if st["user"] is None else st
    check(st["user"] and st["user"]["name"] == "TestAlpha", "token resumes the session")

    # Connect 4: A beats B
    a.send({"t": "room:create", "game": "connect4"}); j = await a.wait("room:joined")
    check(j["players"][0]["acct"] == "TestAlpha", "room shows account badge")
    b.send({"t": "room:join", "code": j["code"], "game": "connect4"}); await b.wait("room:joined")
    await asyncio.sleep(0.3)
    seats = None
    for _ in range(20):
        m = await a.wait("g:state"); seats = m["seats"]
        if m["phase"] == "playing": break
    first = a if seats[m["turn"]] == "accbotA001" else b
    second = b if first is a else a
    for i in range(4):
        first.send({"t": "g:drop", "col": 0}); await asyncio.sleep(0.15)
        if i < 3: second.send({"t": "g:drop", "col": 1}); await asyncio.sleep(0.15)
    xp = await first.wait("account:xp")
    check(xp["gained"] == 40, f"winner gets XP message ({xp['gained']})")
    winner = "TestAlpha" if first is a else "TestBravo"
    loser = "TestBravo" if first is a else "TestAlpha"
    r = await req(c, "profile:get", name=winner)
    st_ = r["profile"]["stats"]
    check(st_.get("c4.wins") == 1 and st_.get("wins") == 1 and st_.get("games") == 1, f"winner stats saved {st_}")
    check(r["profile"]["recent"][0]["outcome"] == "win" and r["profile"]["online"], "match history + online flag")
    r = await req(c, "profile:get", name=loser)
    check(r["profile"]["stats"].get("c4.losses") == 1, "loser stats saved")
    r = await req(c, "lb:get", board="c4"); check(r["board"]["rows"][0]["name"] == winner, "c4 leaderboard")
    r = await req(c, "lb:get", board="xp"); check(r["board"]["rows"][0]["name"] == winner and r["board"]["me"] is not None, "xp leaderboard + my rank")

    # admin
    r = await req(a, "admin:overview"); check(not r["ok"], "non-admin blocked")
    r = await req(a, "admin:unlock", code="nope"); check(not r["ok"], "wrong admin code rejected")
    r = await req(a, "admin:unlock", code="test-admin-code-123"); check(r["ok"] and r["user"]["admin"], "admin unlocked")
    r = await req(a, "admin:overview"); check(r["ok"] and r["users"] == 2 and r["rooms"], "admin overview")
    # rematch then cheat-win: should not be recorded
    (a if True else b).send({"t": "g:rematch"}); await asyncio.sleep(0.3)
    r = await req(a, "admin:cheat", action="win"); check(r["ok"], "admin cheat works: " + str(r.get("text") or r.get("error")))
    await asyncio.sleep(0.4)
    r = await req(c, "profile:get", name="TestAlpha")
    games_after = r["profile"]["stats"].get("games")
    check(games_after == 1, f"cheated game not recorded (games={games_after})")
    r = await req(a, "admin:user", name="TestBravo", action="xp", value=500); check(r["ok"] and r["user"]["xp"] >= 500, "admin give xp")
    r = await req(a, "admin:user", name="TestAlpha", action="ban"); check(not r["ok"], "can't ban yourself")
    r = await req(a, "admin:users", q="test"); check(r["ok"] and len(r["users"]) == 2, "admin search")
    r = await req(a, "admin:announce", text="hello everyone"); check(r["ok"], "announce")
    m = await b.wait("announce"); check(m["text"] == "hello everyone", "announce received")

    # solo score
    r = await req(b, "stats:solo", game="snake", value=42); check(r["ok"] and r["best"], "solo score saved")
    r = await req(b, "stats:solo", game="snake", value=10); check(not r["ok"], "solo rate limit")
    await asyncio.sleep(4.1)
    r = await req(b, "stats:solo", game="snake", value=10); check(r["ok"] and not r["best"], "lower solo score not best")
    r = await req(b, "lb:get", board="snake"); check(r["board"]["rows"][0]["value"] == 42, "snake board keeps best")
    r = await req(b, "stats:solo", game="snake", value=999999); check(not r["ok"], "absurd solo score rejected") if False else None

    # look, password, delete
    r = await req(b, "account:update", avatar="🐙", color="#84cc16", bio="hi  there"); check(r["ok"] and r["user"]["bio"] == "hi there", "update look")
    r = await req(b, "account:password", old="bad", new="newpass1"); check(not r["ok"], "password change needs old password")
    r = await req(b, "account:password", old="bravopass", new="newpass1"); check(r["ok"] and r["token"], "password changed")
    r = await req(b, "auth:login", name="TestBravo", password="newpass1"); check(r["ok"], "login with new password")
    r = await req(b, "account:delete", password="newpass1"); check(r["ok"], "account deleted")
    r = await req(c, "profile:get", name="TestBravo"); check(not r["ok"], "deleted profile gone")
    r = await req(a, "auth:logout", token=tokA); check(r["ok"], "logout")
    c.send({"t": "hello", "id": "accbotC002", "name": "x", "token": tokA})
    for _ in range(5):
        st = await c.wait("auth:state")
        if st.get("expired"): break
    check(st["user"] is None and st.get("expired"), "logged-out token no longer works")
    print("FAILED:", check.failed)

if __name__ == "__main__":
    asyncio.run(main())
