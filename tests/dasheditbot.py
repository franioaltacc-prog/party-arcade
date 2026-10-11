"""Neon Dash community levels: posting (3 a day, counted from every post), checks on the level data,
admin review, likes, plays, community level races and deleting an account."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, json, os, random, struct
from wsbot import WS
from accbot import req, check
from dashlevels import run_ticks

U = str(random.randint(1000, 9999))


class BigWS(WS):
    """The bot websocket, plus frames over 64 KB (for the "too big" checks)."""
    def send(self, obj):
        data = json.dumps(obj).encode()
        if len(data) < 65536:
            return super().send(obj)
        mask = os.urandom(4)
        head = bytes([0x81, 0x80 | 127]) + struct.pack("!Q", len(data))
        self.w.write(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def level(name="Spiky", n=80, objs=None, zones=None, **extra):
    lv = {"v": 1, "name": name, "desc": "A test level", "theme": "hard", "music": True, "len": n,
          "objs": objs if objs is not None else [["^", 12, 0], ["#", 20, 0], ["#", 21, 0], ["#", 21, 1], ["^", 30, 0]],
          "zones": zones if zones is not None else [["ship", 40, 20, 7]]}
    lv.update(extra)
    return lv


def replay(n=80):
    return {"e": [100, 140, 300, 330], "n": run_ticks(n)}


async def player(uid, name, password):
    w = BigWS()
    await w.connect(uid, name)
    await w.wait("welcome")
    r = await req(w, "auth:signup", name=name, password=password)
    assert r["ok"], r
    return w


async def post(w, lv=None, rp=None):
    await asyncio.sleep(5.1)   # one post per 5 seconds per player
    return await req(w, "dash:post", level=lv or level(), replay=rp or replay())


async def main():
    # ---- guests can look but not post
    g = BigWS(); await g.connect("dshG" + U + "xx", "guest"); await g.wait("welcome")
    r = await req(g, "dash:post", level=level(), replay=replay()); check(not r["ok"] and "log in" in r["error"], "guest can't post")
    r = await req(g, "dash:list"); check(r["ok"] and isinstance(r["levels"], list), "guests can browse")

    a = await player("dshA" + U + "xx", "Maker" + U, "maker-pass-1")
    b = await player("dshB" + U + "xx", "Player" + U, "player-pass-1")
    c = await player("dshC" + U + "xx", "Leaver" + U, "leaver-pass-1")
    adm = await player("dshD" + U + "xx", "Judge" + U, "judge-pass-1")
    r = await req(adm, "admin:unlock", code="test-admin-code-123"); check(r["ok"], "admin unlocked")

    # ---- bad levels are refused (and don't use up a post)
    bad = {
        "unknown object": level(objs=[["X", 3, 0]]),
        "object outside the level": level(objs=[["#", 80, 0]]),
        "object above row 14": level(objs=[["#", 3, 14]]),
        "fractional cell": level(objs=[["#", 3.5, 0]]),
        "NaN": level(objs=[["#", float("nan"), 0]]),
        "huge number": level(n=10 ** 30),
        "huge float": level(objs=[["#", 1e300, 0]]),
        "string number": level(objs=[["#", "3", 0]]),
        "bool as number": level(objs=[["#", True, 0]]),
        "objs not a list": level(objs={"a": 1}),
        "name not text": level(name=["x"]),
        "empty name": level(name="   "),
        "name too long": level(name="x" * 33),
        "description too long": level(desc="y" * 141),
        "unknown theme": level(theme="pink"),
        "two objects in one cell": level(objs=[["#", 3, 0], ["^", 3, 0]]),
        "too many objects (and over 64 KB)": level(n=800, objs=[["#", 100 + i % 700, i // 700] for i in range(5001)]),
        "zones overlap": level(zones=[["ship", 30, 20, 7], ["ufo", 40, 10, 7]]),
        "zone past the end": level(zones=[["ship", 70, 20, 7]]),
        "zone too tall": level(zones=[["ship", 30, 20, 15]]),
        "unknown mode": level(zones=[["car", 30, 20, 7]]),
        "zigzag on a ship zone": level(zones=[["ship", 30, 20, 7, 4, [[3, 3]]]]),
        "zigzag outside the zone": level(zones=[["wave", 30, 20, 7, 4, [[25, 3]]]]),
        "level not an object": [1, 2, 3],
    }
    for label, lv in bad.items():
        r = await req(b, "dash:post", level=lv, replay=replay(lv["len"] if isinstance(lv, dict) and isinstance(lv.get("len"), int) and lv["len"] < 10 ** 6 else 80))
        check(not r["ok"] and "Slow down" not in r["error"], f"refused: {label} ({r.get('error')})")
    r = await req(b, "dash:post", level=level(), replay=None); check(not r["ok"] and "verify" in r["error"].lower(), "refused: no verify run")
    r = await req(b, "dash:post", level=level(), replay={"e": [5, 3], "n": run_ticks(80)}); check(not r["ok"], "refused: inputs out of order")
    r = await req(b, "dash:post", level=level(), replay={"e": [], "n": 100}); check(not r["ok"] and "reach the end" in r["error"], "refused: verify run that doesn't reach the end")
    r = await req(b, "dash:quota"); check(r["ok"] and r["left"] == 3, "refused posts don't count toward the limit")
    r = await req(b, "dash:post", level=level(objs=[["#", 100 + i % 690, i // 690] for i in range(4999)], n=800), replay=replay(800))
    check(r["ok"], f"a level with 4999 objects (about 70 KB) is fine ({r.get('error')})")

    # ---- 3 posts a day
    ids = []
    for i in range(3):
        r = await post(a, level(name=f"Level {i + 1}"))
        check(r["ok"] and r["status"] == "pending" and r["left"] == 2 - i, f"post {i + 1} accepted ({r.get('left')} left)")
        ids.append(r.get("id"))
    r = await post(a, level(name="Level 4"))
    check(not r["ok"] and "You've posted 3 levels today" in r["error"] and "you can post again in" in r["error"] and " h " in r["error"], f"4th post refused: {r.get('error')}")
    r = await req(a, "dash:quota"); check(r["left"] == 0 and 86000 < r["wait"] <= 86400, f"quota says when the next post frees up ({r.get('wait')}s)")

    # ---- pending levels: only the creator and admins see them
    r = await req(b, "dash:get", id=ids[0]); check(not r["ok"], "others can't open a pending level")
    r = await req(g, "dash:get", id=ids[0]); check(not r["ok"], "guests can't open a pending level")
    r = await req(a, "dash:get", id=ids[0]); check(r["ok"] and r["level"]["data"]["name"] == "Level 1" and r["level"]["replay"]["n"] == run_ticks(80), "the creator can open their pending level")
    r = await req(adm, "dash:get", id=ids[0]); check(r["ok"] and r["level"]["replay"], "admins can open a pending level with its verify run")
    r = await req(b, "dash:list"); check(r["ok"] and not any(l["id"] in ids for l in r["levels"]), "pending levels aren't listed")
    r = await req(a, "dash:mine"); check(r["ok"] and [l["status"] for l in r["levels"]] == ["pending"] * 3 and r["left"] == 0, "My levels shows them as pending")

    # ---- deleting doesn't give a post back
    r = await req(a, "dash:delete", id=ids[2]); check(r["ok"], "creator deletes a level")
    r = await req(b, "dash:delete", id=ids[1]); check(not r["ok"], "can't delete someone else's level")
    r = await post(a, level(name="Again")); check(not r["ok"] and "3 levels today" in r["error"], "still refused after deleting one")
    r = await req(a, "dash:mine"); check(len(r["levels"]) == 2, "deleted levels leave My levels")

    # ---- reviewing
    r = await req(b, "dash:review", id=ids[0], action="approve"); check(not r["ok"] and "Admins only" in r["error"], "non-admin can't review")
    r = await req(b, "dash:queue"); check(not r["ok"], "non-admin can't see the queue")
    r = await req(adm, "dash:queue"); q = [l["id"] for l in r.get("levels", [])]
    check(r["ok"] and ids[0] in q and ids[1] in q and q.index(ids[0]) < q.index(ids[1]) and ids[2] not in q and r["counts"].get("deleted", 0) >= 1, "admin queue lists pending levels, oldest first (not the deleted one)")
    a.drain()
    r = await req(adm, "dash:review", id=ids[0], action="approve"); check(r["ok"] and r["status"] == "approved", "admin approves")
    m = await a.wait("dash:reviewed"); check(m["id"] == ids[0] and m["status"] == "approved", "creator gets a live message when approved")
    r = await req(adm, "dash:review", id=ids[1], action="reject", reason="Impossible jump at 40%"); check(r["ok"], "admin rejects with a reason")
    m = await a.wait("dash:reviewed"); check(m["status"] == "rejected" and m["reason"] == "Impossible jump at 40%", "creator gets the rejection and the reason")
    r = await req(adm, "dash:review", id=ids[1], action="reject"); check(not r["ok"], "can't reject twice")
    r = await req(adm, "dash:review", id=ids[2], action="approve"); check(not r["ok"], "can't approve a deleted level")
    r = await req(a, "dash:mine")
    st = {l["id"]: l for l in r["levels"]}
    check(st[ids[0]]["status"] == "approved" and st[ids[1]]["status"] == "rejected" and st[ids[1]].get("reason") == "Impossible jump at 40%", "My levels shows approved / rejected + reason")
    r = await post(a, level(name="After review")); check(not r["ok"] and "3 levels today" in r["error"], "still refused after approve / reject")
    r = await req(g, "dash:list"); mine = [l for l in r["levels"] if l["id"] in ids]
    check(len(mine) == 1 and mine[0]["id"] == ids[0] and mine[0]["by"]["name"] == "Maker" + U and r["levels"][0]["id"] == ids[0], "approved level is listed for everyone (newest first)")
    r = await req(g, "dash:get", id=ids[0]); check(r["ok"] and r["level"]["data"]["len"] == 80, "anyone can open an approved level")
    r = await req(g, "dash:list", q="level 1"); check(ids[0] in [l["id"] for l in r["levels"]], "search by name")
    r = await req(g, "dash:list", q="maker" + U); check([l["id"] for l in r["levels"]] == [ids[0]], "search by creator")
    r = await req(g, "dash:list", q="nothing like this"); check(r["levels"] == [], "search with no match")
    r = await req(g, "dash:list", by="Maker" + U); check(len(r["levels"]) == 1, "a player's approved levels (profile)")

    # ---- admins have no limit
    for i in range(4):
        r = await post(adm, level(name=f"Admin {i}"))
        check(r["ok"], f"admin post {i + 1} accepted (no limit)")

    # ---- stats + achievement (not counted as games)
    r = await req(a, "profile:get", name="Maker" + U)
    s = r["profile"]["stats"]
    check(s.get("dash.levels_posted") == 3 and s.get("dash.levels_approved") == 1 and not s.get("games"), f"stats: posted 3, approved 1, no games ({s})")

    # ---- likes: once per account
    r = await req(b, "dash:like", id=ids[0]); check(r["ok"] and r["likes"] == 1, "like")
    r = await req(b, "dash:like", id=ids[0]); check(r["ok"] and r["likes"] == 1, "liking twice still counts once")
    r = await req(c, "dash:like", id=ids[0]); check(r["ok"] and r["likes"] == 2, "a second player's like")
    r = await req(a, "dash:like", id=ids[0]); check(not r["ok"], "can't like your own level")
    r = await req(g, "dash:like", id=ids[0]); check(not r["ok"], "guests can't like")
    r = await req(b, "dash:like", id=ids[0], on=False); check(r["ok"] and r["likes"] == 1, "unlike")
    r = await req(b, "dash:like", id=ids[1]); check(not r["ok"], "can't like a rejected level")
    r = await req(b, "dash:list", by="Maker" + U); check(r["levels"][0]["likes"] == 1 and r["levels"][0]["liked"] is False, "list shows likes and whether you liked it")
    r = await req(c, "dash:list", by="Maker" + U); check(r["levels"][0]["liked"] is True, "liked flag for the player who liked")

    # ---- plays: counted when a run starts, rate limited
    r = await req(b, "dash:play", id=ids[0]); check(r["ok"] and r["counted"], "play counted")
    r = await req(b, "dash:play", id=ids[0]); check(r["ok"] and not r["counted"], "the same player again right away isn't counted")
    r = await req(g, "dash:play", id=ids[0]); check(r["ok"] and r["counted"], "a guest's play counts")
    r = await req(b, "dash:play", id=ids[1]); check(r["ok"] and not r["counted"], "plays on a rejected level don't count")
    r = await req(g, "dash:get", id=ids[0]); check(r["level"]["plays"] == 2, f"play count is 2 ({r['level']['plays']})")
    r = await req(g, "dash:list", sort="plays"); check(r["ok"] and r["levels"][0]["plays"] >= 2 and all(x["plays"] >= y["plays"] for x, y in zip(r["levels"], r["levels"][1:])), "sort by most played")

    # ---- unlist
    r = await req(adm, "dash:review", id=ids[0], action="unlist", reason="Copied"); check(r["ok"], "admin unlists an approved level")
    r = await req(g, "dash:list"); check(not any(l["id"] == ids[0] for l in r["levels"]), "unlisted level leaves the list")
    r = await req(b, "dash:get", id=ids[0]); check(not r["ok"], "unlisted level can't be opened by others")
    r = await req(adm, "dash:review", id=ids[0], action="approve"); check(r["ok"], "admin lists it again")
    r = await req(a, "profile:get", name="Maker" + U); check(r["profile"]["stats"].get("dash.levels_approved") == 1, "listing again doesn't count as a new approval")

    # ---- community level race
    a.send({"t": "room:create", "game": "dash"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "dash"}); await b.wait("room:joined")
    await asyncio.sleep(0.3); b.drain()
    a.send({"t": "g:settings", "level": ids[1]})
    m = await a.wait("error"); check("isn't available" in m["msg"], "a rejected level can't be raced")
    a.send({"t": "g:settings", "level": ids[0]})
    m = await b.wait("g:settings")
    while not m["settings"].get("level"):
        m = await b.wait("g:settings")
    check(m["settings"]["level"]["id"] == ids[0] and m["settings"]["level"]["name"] == "Level 1", "host picks a community level, everyone sees it")
    b.send({"t": "g:settings", "level": None}); await asyncio.sleep(0.3)
    a.send({"t": "g:start"})
    m = await b.wait("g:start"); race = m["race"]
    check(race["custom"] and race["custom"]["len"] == 80 and race["custom"]["name"] == "Level 1" and race["settings"]["level"]["id"] == ids[0], "race start sends the level data (and only the host picks)")
    a.send({"t": "g:finish", "time": 9000, "attempts": 1}); b.send({"t": "g:finish", "time": 9500, "attempts": 2})
    await a.wait("g:results"); await asyncio.sleep(0.4)
    r = await req(g, "dash:get", id=ids[0]); check(r["level"]["plays"] == 3, "a race counts as a play")
    r = await req(a, "profile:get", name="Maker" + U); check(r["profile"]["stats"].get("dash.races") == 1, "the race still counts as a Neon Dash race")
    a.send({"t": "g:settings", "level": None}); m = await b.wait("g:settings")
    check(m["settings"]["level"] is None, "back to random levels")
    a.send({"t": "g:start"}); m = await b.wait("g:start"); check(not m["race"]["custom"] and m["race"]["seed"], "random level races still work")
    a.send({"t": "g:stop"}); await asyncio.sleep(0.3)
    a.send({"t": "room:leave"}); b.send({"t": "room:leave"}); await asyncio.sleep(0.2)

    # ---- deleting an account removes its levels and its likes
    r = await post(c, level(name="Leaving soon")); check(r["ok"], "the leaver posts a level")
    cid = r["id"]
    r = await req(adm, "dash:review", id=cid, action="approve"); check(r["ok"], "approved")
    r = await req(b, "dash:like", id=cid); check(r["ok"], "someone likes it")
    r = await req(g, "dash:get", id=ids[0]); before = r["level"]["likes"]
    r = await req(c, "account:delete", password="leaver-pass-1"); check(r["ok"], "the leaver deletes their account")
    r = await req(g, "dash:get", id=cid); check(not r["ok"], "their level is gone")
    r = await req(g, "dash:list", q="leaving"); check(r["levels"] == [], "and not listed")
    r = await req(g, "dash:get", id=ids[0]); check(r["level"]["likes"] == before - 1, f"their like is taken back ({before} -> {r['level']['likes']})")

    print("FAILED:", check.failed)


asyncio.run(main())
