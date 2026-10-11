import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))


async def main():
    a, b, adm = WS(), WS(), WS()
    await a.connect("lookA" + U + "x", "A"); await b.connect("lookB" + U + "x", "B"); await adm.connect("lookM" + U + "x", "M")
    for w in (a, b, adm):
        await w.wait("welcome")
    na, nb = "Looker" + U, "Watcher" + U
    r = await req(a, "auth:signup", name=na, password="look-pass-1"); assert r["ok"], r
    check(r["user"]["look"] == {}, "new accounts wear nothing")
    r = await req(adm, "auth:signup", name="LookAdm" + U, password="adm-pass-1"); assert r["ok"], r
    r = await req(adm, "admin:unlock", code="test-admin-code-123"); check(r["ok"], "admin unlock")

    # level 1: everything is locked except the classic ball
    r = await req(a, "account:look", look={"aura": "glow"}); check(not r["ok"] and "locked" in r["error"], "level-1 player can't wear a level-2 aura")
    r = await req(a, "account:look", look={"aura": "made-up"}); check(not r["ok"], "unknown aura rejected")
    r = await req(a, "account:look", look={"ball": "classic"}); check(r["ok"] and r["user"]["look"].get("ball") == "classic", "free classic ball allowed")
    r = await req(b, "account:look", look={"aura": "glow"}); check(not r["ok"] and "log in" in r["error"].lower(), "guests can't wear rewards")

    # level 12 unlocks rainbow aura (10), spin (12), rainbow ball (12) but not legend (30)
    r = await req(adm, "admin:user", name=na, action="setlevel", value=12); check(r["ok"], "admin sets level 12")
    r = await req(a, "account:look", look={"aura": "rainbow", "anim": "spin", "ball": "rainbow"})
    check(r["ok"] and r["user"]["look"] == {"aura": "rainbow", "anim": "spin", "ball": "rainbow"}, f"level-12 rewards worn: {r.get('user', {}).get('look')}")
    r = await req(a, "account:look", look={"aura": "legend"}); check(not r["ok"], "level-30 aura still locked")
    # achievements unlock rewards too
    r = await req(a, "account:look", look={"aura": "orbit"}); check(not r["ok"], "World orbit locked before winning Front Wars")
    r = await req(adm, "admin:user", name=na, action="stat", value={"key": "front.wins", "value": 1}); check(r["ok"], "admin gives a Front Wars win")
    r = await req(a, "account:look", look={"aura": "orbit"}); check(r["ok"] and r["user"]["look"]["aura"] == "orbit", "World orbit unlocked by the achievement")
    r = await req(a, "account:look", look={"anim": ""}); check(r["ok"] and "anim" not in r["user"]["look"] and r["user"]["look"]["aura"] == "orbit", "taking one thing off keeps the rest")

    # others see it: rooms, chat, profile, leaderboard, player search
    a.send({"t": "room:create", "game": "mines"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "mines"}); jb = await b.wait("room:joined")
    me = next(p for p in jb["players"] if p["name"] == na)
    check(me.get("aura") == "orbit" and "anim" not in me, f"room players show the aura: {me}")
    await asyncio.sleep(0.2); b.drain()
    a.send({"t": "chat", "text": "hi"}); m = await b.wait("chat")
    check(m["from"].get("aura") == "orbit", "chat messages carry the aura")
    r = await req(a, "account:look", look={"anim": "bounce"}); check(r["ok"], "wear an animation while in a room")
    upd = await b.wait("room:players")
    me = next(p for p in upd["players"] if p["name"] == na)
    check(me.get("anim") == "bounce", "room sees the new animation right away")
    prof = (await req(b, "profile:get", name=na))["profile"]
    check(prof["look"] == {"aura": "orbit", "ball": "rainbow", "anim": "bounce"}, f"profile shows the look: {prof['look']}")
    lb = (await req(b, "lb:get", board="xp"))["board"]
    row = next((x for x in lb["rows"] if x["name"] == na), None)
    check(row and row["look"].get("aura") == "orbit", "leaderboard rows carry the look")
    found = (await req(b, "players:find", q=na))["players"]
    check(found and found[0]["look"].get("aura") == "orbit", "player search carries the look")
    # logging back in keeps it
    tok = None
    r = await req(a, "auth:login", name=na, password="look-pass-1"); check(r["ok"] and r["user"]["look"]["aura"] == "orbit", "look survives logging in again")
    # deleting the account removes the look too
    r = await req(a, "account:delete", password="look-pass-1"); check(r["ok"], "account deleted")
    r = await req(a, "auth:signup", name=na, password="look-pass-2"); check(r["ok"] and r["user"]["look"] == {}, "a new account with the same name starts with nothing")
    print("FAILED:", check.failed)

asyncio.run(main())
