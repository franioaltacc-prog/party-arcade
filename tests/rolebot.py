"""Roles and the update calendar: an admin gives people the tester or developer role; testers see the
calendar rows shared with them, developers change the calendar, and neither gets the admin panel,
cheats or XP tools. Other players never see someone's role. The team (everyone with a role) has a
group chat and announcements that developers and admins post."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, itertools, time
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


async def signup(uid, name):
    ws = WS()
    await ws.connect(uid, name)
    await ws.wait("welcome")
    r = await req(ws, "auth:signup", name=name, password="password123")
    check(r["ok"] and r["user"]["role"] == "", f"signup {name} (a normal player)")
    return ws


async def main():
    boss = await signup("rolebotA001", "RoleBoss")
    r = await req(boss, "admin:unlock", code="test-admin-code-123")
    check(r["ok"] and r["user"]["role"] == "admin", "admin unlocked, and their own account says admin")
    tess = await signup("rolebotT001", "RoleTess")
    dev = await signup("rolebotD001", "RoleDev")
    pat = await signup("rolebotP001", "RolePat")

    r = await req(pat, "plan:list")
    check(not r["ok"] and "testers and developers" in r["error"], "a normal player can't see the calendar")

    # an admin gives roles
    r = await req(boss, "admin:user", name="RoleTess", action="role", value="tester")
    check(r["ok"] and r["user"]["role"] == "tester" and not r["user"]["admin"], "admin makes RoleTess a tester")
    st = await tess.wait("auth:state")
    check(st["user"]["role"] == "tester", "the tester's own account shows the role straight away")
    r = await req(boss, "admin:user", name="RoleDev", action="role", value="developer")
    check(r["ok"] and r["user"]["role"] == "developer", "admin makes RoleDev a developer")
    await dev.wait("auth:state")
    r = await req(boss, "admin:user", name="RoleBoss", action="role", value="")
    check(not r["ok"], "an admin can't take their own admin away")
    r = await req(boss, "admin:user", name="RolePat", action="role", value="king")
    check(not r["ok"] and "Pick a role" in r["error"], "unknown roles are refused")
    r = await req(pat, "admin:user", name="RolePat", action="role", value="developer")
    check(not r["ok"], "players can't give themselves a role")

    # nobody else sees roles: no name tag, nothing in profiles or room lists
    r = await req(pat, "profile:get", name="RoleDev")
    check(r["ok"] and "role" not in r.get("profile", {}), "profiles don't show someone's role")
    dev.send({"t": "room:create", "game": "connect4"})
    j = await dev.wait("room:joined")
    me = next(p for p in j["players"] if p["acct"] == "RoleDev")
    check(not me.get("adm") and "role" not in me, "a developer gets no name tag in rooms")
    dev.send({"t": "room:leave"})

    # the calendar
    r = await req(tess, "plan:save", item={"title": "Sneaky", "day": "2026-10-19"})
    check(not r["ok"] and "Only developers" in r["error"], "a tester can't add updates")
    r = await req(dev, "plan:save", item={"title": "Song guessing game", "day": "2026-10-19", "kind": "big", "status": "planned",
                                          "testers": True, "notes": "line one\nline two"})
    check(r["ok"], "a developer adds an update")
    song = r["id"]
    ping = await tess.wait("plan:changed")
    check(ping["id"] == song, "open calendars hear about the change")
    await asyncio.sleep(0.2)
    check(not any(m["t"] == "plan:changed" for m in pat.drain()), "players without a role don't")
    r = await req(dev, "plan:save", item={"title": "Secret idea", "day": "", "kind": "small"})
    check(r["ok"], "a developer adds an idea hidden from testers")
    secret = r["id"]
    r = await req(dev, "plan:list")
    check(r["ok"] and r["canEdit"] and [i["title"] for i in r["items"]] == ["Song guessing game", "Secret idea"], "a developer sees everything, dated first")
    check(r["items"][0]["by"] == "RoleDev" and r["items"][0]["notes"] == "line one\nline two" and r["items"][1]["status"] == "idea",
          "rows say who added them, keep line breaks, and undated ones are ideas")
    r = await req(tess, "plan:list")
    check(r["ok"] and not r["canEdit"] and r["role"] == "tester" and [i["title"] for i in r["items"]] == ["Song guessing game"],
          "a tester only sees what's shared with testers")
    check("by" not in r["items"][0], "testers don't see who added a row")

    r = await req(dev, "plan:save", item={"title": "   ", "day": ""})
    check(not r["ok"], "an update needs a name")
    r = await req(dev, "plan:save", item={"title": "Bad date", "day": "2026-02-30"})
    check(not r["ok"], "impossible dates are refused")
    r = await req(dev, "plan:save", item={"title": "x" * 300, "day": "2026-11-01", "kind": "huge", "status": "??", "version": "v2.20.0", "testers": 1})
    check(r["ok"], "odd values are cleaned up instead of refused")
    odd = r["id"]
    r = await req(dev, "plan:list")
    row = next(i for i in r["items"] if i["id"] == odd)
    check(len(row["title"]) == 120 and row["kind"] == "small" and row["status"] == "planned" and row["version"] == "2.20.0" and row["testers"],
          "the cleaned row: title cut to 120, known kind and status, no 'v'")

    r = await req(dev, "plan:save", item={"id": secret, "title": "Secret idea", "day": "2026-10-30", "kind": "small", "status": "planned", "testers": True})
    check(r["ok"], "a developer moves the idea onto a day and shares it")
    r = await req(tess, "plan:list")
    check([i["title"] for i in r["items"]] == ["Song guessing game", "Secret idea", "x" * 120], "the tester sees it now, in date order")
    r = await req(tess, "plan:delete", id=song)
    check(not r["ok"], "a tester can't delete")
    r = await req(boss, "plan:delete", id=odd)
    check(r["ok"], "an admin can change the calendar too")
    r = await req(dev, "plan:save", item={"id": 99999, "title": "Ghost"})
    check(not r["ok"] and "deleted" in r["error"], "changing a deleted update says so")

    # no admin powers for testers and developers
    for ws, who in ((tess, "tester"), (dev, "developer")):
        r = await req(ws, "admin:user", name="RolePat", action="xp", value=500)
        check(not r["ok"] and "Admins only" in r["error"], f"a {who} can't give XP")
        r = await req(ws, "admin:cheat", action="win")
        check(not r["ok"] and "Admins only" in r["error"], f"a {who} can't use cheats")
        r = await req(ws, "admin:overview")
        check(not r["ok"], f"a {who} can't open the admin panel")
        r = await req(ws, "dash:queue")
        check(not r["ok"], f"a {who} can't review community levels")

    # the team: group chat and announcements
    r = await req(pat, "team:get")
    check(not r["ok"], "a normal player can't open the team chat")
    r = await req(tess, "team:get")
    check(r["ok"] and r["chat"] == [] and r["news"] == [] and not r["canAnnounce"], "a tester opens the team page (testers can't announce)")
    pat.drain()
    r = await req(tess, "team:say", text="  hi   team  ")
    check(r["ok"] and r["msg"]["text"] == "hi team" and r["msg"]["by"]["name"] == "RoleTess", "a tester chats with the team")
    got = await dev.wait("team:msg")
    check(got["msg"]["text"] == "hi team", "the developer gets the message live")
    await asyncio.sleep(0.2)
    check(not any(m["t"].startswith("team:") for m in pat.drain()), "players without a role don't")
    r = await req(tess, "team:say", text="   ")
    check(not r["ok"], "empty messages are refused")
    r = await req(tess, "team:say", text="y" * 500)
    check(r["ok"] and len(r["msg"]["text"]) == 300, "long messages are cut to 300 characters")
    long_id = r["msg"]["id"]
    r = await req(tess, "team:announce", text="Testers rule")
    check(not r["ok"] and "Only developers" in r["error"], "a tester can't post announcements")
    r = await req(dev, "team:announce", text="Big update on Monday!\n\n\n\nTesters: try the song game")
    check(r["ok"] and r["news"]["text"] == "Big update on Monday!\n\nTesters: try the song game", "a developer posts an announcement (line breaks kept, tidied)")
    news_id = r["news"]["id"]
    got = await tess.wait("team:news")
    check(got["news"]["id"] == news_id and got["news"]["by"]["name"] == "RoleDev", "testers get announcements live")
    r = await req(tess, "team:get")
    check([m["text"][:7] for m in r["chat"]] == ["hi team", "yyyyyyy"] and len(r["news"]) == 1, "the team page has the chat (oldest first) and announcements")
    r = await req(tess, "team:unannounce", id=news_id)
    check(not r["ok"] and "your own" in r["error"], "you can't delete someone else's announcement")
    r = await req(tess, "team:unsay", id=long_id)
    check(r["ok"], "you can delete your own message")
    got = await dev.wait("team:gone")
    check(got["kind"] == "msg" and got["id"] == long_id, "...and it disappears for everyone")
    r = await req(dev, "team:say", text="hello from dev")
    r = await req(boss, "team:unsay", id=r["msg"]["id"])
    check(r["ok"], "an admin can delete anyone's message")
    results = [await req(tess, "team:say", text=f"spam {i}") for i in range(9)]
    check(any(not x["ok"] and "Slow down" in x["error"] for x in results), "the team chat has a speed limit")

    r = await req(boss, "admin:users", q="role")
    roles = {u["name"]: u["role"] for u in r["users"]}
    check(roles.get("RoleDev") == "developer" and roles.get("RoleTess") == "tester" and roles.get("RoleBoss") == "admin" and roles.get("RolePat") == "",
          "the admin panel lists everyone's role")
    r = await req(boss, "admin:user", name="RoleTess", action="role", value="")
    check(r["ok"] and r["user"]["role"] == "", "an admin takes the tester role away")
    r = await req(tess, "plan:list")
    check(not r["ok"], "no role, no calendar")
    r = await req(boss, "admin:user", name="RoleDev", action="role", value="admin")
    check(r["ok"] and r["user"]["admin"] and r["user"]["role"] == "admin", "the role picker can make an admin")
    r = await req(boss, "admin:user", name="RoleDev", action="role", value="developer")
    check(r["ok"] and not r["user"]["admin"] and r["user"]["role"] == "developer", "...and turn them back into a developer")

    await asyncio.sleep(10)    # let the chat speed limit pass
    r = await req(dev, "team:say", text="bye from dev")
    check(r["ok"], "the developer chats once more")
    r = await req(boss, "admin:user", name="RoleDev", action="delete")
    check(r["ok"], "the developer's account is deleted")
    r = await req(boss, "plan:list")
    check(r["ok"] and len(r["items"]) == 2 and all(i["by"] == "" for i in r["items"]), "their calendar rows stay, without a name")
    r = await req(boss, "team:get")
    check(not any(m["text"] == "bye from dev" for m in r["chat"]), "their chat messages are deleted with the account")
    check(len(r["news"]) == 1 and r["news"][0]["by"]["name"] == "", "their announcements stay, without a name")
    print("FAILED:", check.failed)


if __name__ == "__main__":
    asyncio.run(main())
