"""Site themes + Halloween quests.

Over the websocket (needs a running server, see run_all.py): free themes can be worn, the Halloween
theme is refused until every Halloween quest is done, quest stats unlock it (and the small quest
rewards), list rules add up, and a real online game during the event counts for the event.
In-process (no server; a temporary database and a simulated clock): "max" stats are tracked as a
max, summed-list rules, achievements that need other achievements, and nothing is tracked outside
the event window."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, datetime, os, random, tempfile
from pathlib import Path
from wsbot import WS
from accbot import req, check
import accounts

U = str(random.randint(1000, 9999))
EV = "ev.halloween26."
QUESTS = {"games": 5, "survived": 3, "wins": 3, "golf": 1, "flappy": 13, "poolcpu": 1, "age": 60, "doodle": 3}
QUEST_IDS = ["trick-or-treat", "boo", "night-owl", "haunted-hole", "creepy-flap", "pool-shark", "undead", "sweet-tooth"]


def day(s):
    return datetime.datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp()


def unlocks_sanity():
    d = accounts.UNLOCKS
    themes = {t["id"]: t for t in d.get("themes", [])}
    check(set(themes) == {"neon", "midnight", "sunset", "ocean", "forest", "candy", "retro", "halloween"}, f"all 8 themes listed: {sorted(themes)}")
    check(all(themes[t]["rule"] is None for t in themes if t != "halloween"), "the 7 normal themes are free")
    hw = themes.get("halloween", {})
    check(hw.get("event") == "halloween26" and hw.get("rule", {}).get("achs") == QUEST_IDS, "Halloween theme needs all 8 quests and is limited to the event")
    evq = [a["id"] for a in d["achievements"] if a.get("event") == "halloween26"]
    check(sorted(evq) == sorted(QUEST_IDS), f"8 Halloween quests: {evq}")
    check(accounts.LOOK_SLOTS.get("theme") == "themes", "theme is a look slot")


async def over_ws():
    a, b, adm = WS(), WS(), WS()
    await a.connect("themeA" + U + "x", "A"); await b.connect("themeB" + U + "x", "B"); await adm.connect("themeM" + U + "x", "M")
    for w in (a, b, adm):
        await w.wait("welcome")
    na, nb = "Spooky" + U, "Rival" + U
    r = await req(a, "auth:signup", name=na, password="spook-pass-1"); assert r["ok"], r
    r = await req(b, "auth:signup", name=nb, password="rival-pass-1"); assert r["ok"], r
    r = await req(adm, "auth:signup", name="ThemeAdm" + U, password="adm-pass-1"); assert r["ok"], r
    r = await req(adm, "admin:unlock", code="test-admin-code-123"); check(r["ok"], "admin unlock")

    # free themes: anyone with an account, any level
    r = await req(a, "account:look", look={"theme": "midnight"}); check(r["ok"] and r["user"]["look"].get("theme") == "midnight", "level-1 player wears the free Midnight theme")
    r = await req(a, "account:look", look={"theme": "retro", "aura": ""}); check(r["ok"] and r["user"]["look"] == {"theme": "retro"}, f"switching theme keeps the rest: {r.get('user', {}).get('look')}")
    r = await req(a, "account:look", look={"theme": "made-up"}); check(not r["ok"], "unknown theme refused")
    g = WS(); await g.connect("themeG" + U + "x", "G"); await g.wait("welcome")
    r = await req(g, "account:look", look={"theme": "ocean"}); check(not r["ok"] and "log in" in r["error"].lower(), "guests keep their theme in the browser (server refuses)")

    # the Halloween theme is locked until every quest is done
    r = await req(a, "account:look", look={"theme": "halloween"}); check(not r["ok"] and "locked" in r["error"], "Halloween theme refused for a new player")
    r = await req(adm, "admin:user", name=na, action="setlevel", value=200); check(r["ok"], "admin sets level 200")
    r = await req(a, "account:look", look={"theme": "halloween"}); check(not r["ok"], "a high level doesn't unlock the Halloween theme")
    # the normal (non-event) stats don't count either: only the event's own counters do
    for k, v in {"games": 50, "wins": 20, "golf.spooky_done": 2, "flappy.best": 40, "poolcpu.wins": 3, "life.oldest": 90, "doodle.games": 9, "prophunt.survived": 9}.items():
        await req(adm, "admin:user", name=na, action="stat", value={"key": k, "value": v})
    r = await req(a, "account:look", look={"theme": "halloween"}); check(not r["ok"], "stats from outside the event don't complete quests")

    # 7 of 8 quests: still locked
    for k, v in QUESTS.items():
        if k != "doodle":
            await req(adm, "admin:user", name=na, action="stat", value={"key": EV + k, "value": v})
    r = await req(a, "account:look", look={"theme": "halloween"}); check(not r["ok"], "7 of 8 quests: still locked")
    # Sweet tooth is a summed list (Doodle Guess + Party Blitz games): 1 + 1 isn't 3, 1 + 2 is
    await req(adm, "admin:user", name=na, action="stat", value={"key": EV + "doodle", "value": 1})
    await req(adm, "admin:user", name=na, action="stat", value={"key": EV + "blitz", "value": 1})
    r = await req(a, "account:look", look={"ball": "candy"}); check(not r["ok"], "Sweet tooth not done at 1 + 1 (candy ball locked)")
    r = await req(a, "account:look", look={"theme": "halloween"}); check(not r["ok"], "theme still locked at 1 + 1")
    await req(adm, "admin:user", name=na, action="stat", value={"key": EV + "blitz", "value": 2})
    r = await req(a, "account:look", look={"ball": "candy"}); check(r["ok"] and r["user"]["look"].get("ball") == "candy", "Sweet tooth done at 1 + 2: candy ball unlocked")
    r = await req(a, "account:look", look={"theme": "halloween"}); check(r["ok"] and r["user"]["look"].get("theme") == "halloween", "all 8 quests: Halloween theme worn")
    r = await req(a, "account:look", look={"anim": "bat"}); check(r["ok"] and r["user"]["look"].get("anim") == "bat", "Night owl unlocks the bat animation")
    prof = (await req(b, "profile:get", name=na))["profile"]
    check(prof["look"].get("theme") == "halloween", "the theme is saved in the account's look")
    # logging in again keeps it; the theme isn't shown on others' room cards (only aura/anim are)
    r = await req(a, "auth:login", name=na, password="spook-pass-1"); check(r["ok"] and r["user"]["look"].get("theme") == "halloween", "theme survives logging in again")

    # a real online game during the event counts for it (Connect 4: A beats B)
    live = bool(accounts.active_events())
    before = (await req(adm, "profile:get", name=nb))["profile"]["stats"]
    a.send({"t": "room:create", "game": "connect4"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "connect4"}); await b.wait("room:joined")
    m = None
    for _ in range(20):
        m = await a.wait("g:state")
        if m["phase"] == "playing": break
    first = a if m["seats"][m["turn"]] == "themeA" + U + "x" else b
    second = b if first is a else a
    for i in range(4):
        first.send({"t": "g:drop", "col": 0}); await asyncio.sleep(0.15)
        if i < 3: second.send({"t": "g:drop", "col": 1}); await asyncio.sleep(0.15)
    await first.wait("account:xp")
    await asyncio.sleep(0.3)
    win_name = na if first is a else nb
    st = (await req(adm, "profile:get", name=win_name))["profile"]["stats"]
    lose = (await req(adm, "profile:get", name=nb if win_name == na else na))["profile"]["stats"]
    if live:
        wins_before = (QUESTS["wins"] if win_name == na else before.get(EV + "wins", 0))
        check(st.get(EV + "wins") == wins_before + 1, f"an online win during the event counts for Night owl ({st.get(EV + 'wins')})")
        check((lose.get(EV + "games") or 0) >= 1, "the loser's game counts for Trick or treat")
    else:
        check(EV + "wins" not in st or st.get(EV + "wins") == (QUESTS["wins"] if win_name == na else 0), "outside the event an online win isn't counted for it")
    # solo high scores ("max") count during the event, once Neon Flappy's solo submit exists on the server
    r = await req(b, "stats:solo", game="flappy", value=14)
    if r["ok"]:
        st = (await req(adm, "profile:get", name=nb))["profile"]["stats"]
        check(st.get(EV + "flappy") == (14 if live else None), f"solo Neon Flappy score tracked as the event's best ({st.get(EV + 'flappy')})")
        await asyncio.sleep(4.1)   # (the server allows one solo score every 4 s)
        r = await req(b, "stats:solo", game="flappy", value=6); check(r["ok"], f"a lower Neon Flappy score is saved too: {r}")
        st = (await req(adm, "profile:get", name=nb))["profile"]["stats"]
        check(st.get(EV + "flappy") == (14 if live else None), "a lower score doesn't lower it")
    else:
        print("NOTE solo 'flappy' isn't in accounts.SOLO yet (added at integration) — checked in-process above")
    # a solo Mini Golf round: Classic Meadow doesn't count for Haunted hole, a finished Spooky Hollow round does
    await asyncio.sleep(4.1)
    r = await req(b, "stats:solo", game="golf-classic", value=30); check(r["ok"], f"solo Classic Meadow round saved: {r}")
    st = (await req(adm, "profile:get", name=nb))["profile"]["stats"]
    check(not st.get(EV + "golf") and not st.get("golf.spooky_done"), "Classic Meadow doesn't count for Haunted hole")
    await asyncio.sleep(4.1)
    r = await req(b, "stats:solo", game="golf-spooky", value=34); check(r["ok"], f"solo Spooky Hollow round saved: {r}")
    st = (await req(adm, "profile:get", name=nb))["profile"]["stats"]
    check(st.get("golf.spooky_done") == 1 and st.get(EV + "golf") == (1 if live else None), f"a solo Spooky Hollow round counts for Haunted hole ({st.get(EV + 'golf')})")
    await asyncio.sleep(4.1)
    r = await req(b, "stats:solo", game="golf-spooky", value=8); check(not r["ok"], "an impossible golf total (under 9) is refused")
    for w in (a, b, adm, g):
        w.w.close()


async def in_process():
    """record() with a simulated clock, straight against a temporary database."""
    for k in ("TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"):
        os.environ.pop(k, None)
    tmp = Path(tempfile.mkdtemp())
    acc = accounts.Accounts(tmp)
    await acc.init()
    user, _ = await acc.signup("Clock" + U, "clock-pass-1", "🎃", "#ff7a1a", "127.0.0.1")
    uid = user["id"]
    real = accounts.active_events
    clock = {"t": day("2026-10-20")}
    accounts.active_events = lambda t=None: real(clock["t"])
    accounts.SOLO.setdefault("flappy", ("flappy", 1, 100_000))   # the integration agent adds the real entry
    stats = lambda: acc.q("SELECT key, value FROM stats WHERE user_id = ?", uid)

    async def get():
        return {r["key"]: r["value"] for r in (await stats())["rows"]}
    try:
        # before the event: nothing tracked
        clock["t"] = day("2026-10-10") + 3600
        await acc.record(uid, "c4", "win", {"c4.wins": ("add", 1)})
        await acc.solo(uid, "flappy", 30)
        s = await get()
        check(not any(k.startswith("ev.") for k in s) and s.get("flappy.best") == 30, f"before the event nothing is tracked for it: {sorted(k for k in s if k.startswith('ev.'))}")
        # during the event
        clock["t"] = day("2026-10-20")
        for v in (9, 15, 11):
            await acc.solo(uid, "flappy", v)
        s = await get()
        check(s.get(EV + "flappy") == 15, f"a 'max' stat is tracked as the event's max ({s.get(EV + 'flappy')})")
        check(s.get("flappy.best") == 30, "the all-time best is untouched")
        await acc.record(uid, "life", "play", {"life.oldest": ("max", 47)})
        await acc.record(uid, "life", "play", {"life.oldest": ("max", 63)})
        await acc.record(uid, "life", "play", {"life.oldest": ("max", 55)})
        s = await get()
        check(s.get(EV + "age") == 63, f"Family Life oldest tracked as max ({s.get(EV + 'age')})")
        await acc.record(uid, "golf", "win", {"golf.wins": ("add", 1), "golf.spooky_done": ("add", 1)})
        await acc.record(uid, "doodle", "loss")
        await acc.record(uid, "blitz", "win")
        await acc.record(uid, "blitz", "play")
        await acc.record(uid, "poolcpu", "play", {"poolcpu.wins": ("add", 1)}, totals=False)
        await acc.record(uid, "prophunt", "loss", {"prophunt.survived": ("add", 3)})
        s = await get()
        check(s.get(EV + "golf") == 1 and s.get(EV + "poolcpu") == 1 and s.get(EV + "doodle") == 1 and s.get(EV + "blitz") == 2, "golf / pool / doodle / blitz counted")
        check(s.get(EV + "games") == 8 and s.get(EV + "wins") == 2, f"online games and wins counted, solo ones not ({s.get(EV + 'games')} games, {s.get(EV + 'wins')} wins)")
        lvl = accounts.level_info(0)["level"]
        achs = accounts.earned_achievements(lvl, s)
        need = set(QUEST_IDS) - achs
        check(need == {"night-owl"}, f"7 of 8 quests done, only Night owl (3 wins) left: {need}")
        check("halloween" not in accounts.unlocked_items(0, s)["theme"], "theme still locked")
        check("sweet-tooth" in achs, "Sweet tooth: 1 Doodle + 2 Blitz = 3 (list rule summed)")
        await acc.record(uid, "c4", "win", {"c4.wins": ("add", 1)})
        s = await get()
        check("halloween" in accounts.unlocked_items(0, s)["theme"], "3rd online win: all quests done, theme unlocked")
        u = await acc.set_look(uid, {"theme": "halloween"})
        check(accounts.parse_look(u.get("look")).get("theme") == "halloween", "set_look accepts it")
        # after the event: nothing more tracked, but the theme stays yours
        clock["t"] = day("2026-11-03") + 60
        before = {k: v for k, v in (await get()).items() if k.startswith("ev.")}
        await acc.record(uid, "c4", "win", {"c4.wins": ("add", 1)})
        await acc.solo(uid, "flappy", 99)
        await acc.record(uid, "life", "play", {"life.oldest": ("max", 99)})
        after = {k: v for k, v in (await get()).items() if k.startswith("ev.")}
        check(before == after, "after the event nothing is tracked for it")
        check("halloween" in accounts.unlocked_items(0, await get())["theme"], "the theme is still yours after the event")
        u = await acc.set_look(uid, {"theme": "sunset"}); u = await acc.set_look(uid, {"theme": "halloween"})
        check(accounts.parse_look(u.get("look")).get("theme") == "halloween", "and can be worn again after the event")
        # an achievement that needs other achievements works whatever order the list is in
        extra = [{"id": "zz-meta", "rule": {"achs": ["zz-chain", "hello"]}}, {"id": "zz-chain", "rule": {"ach": "winner"}}]
        accounts.UNLOCKS["achievements"][:0] = extra
        try:
            got = accounts.earned_achievements(1, {"games": 1, "wins": 1})
            check({"hello", "winner", "zz-chain", "zz-meta"} <= got, "chained achievement rules resolve in any order")
            check(not accounts.rule_ok({"stat": ["a", "b"], "gte": 3}, 1, {"a": 1, "b": 1}, set()) and accounts.rule_ok({"stat": ["a", "b"], "gte": 3}, 1, {"a": 1, "b": 2}, set()), "rule_ok sums a list of stats")
        finally:
            del accounts.UNLOCKS["achievements"][:2]
    finally:
        accounts.active_events = real


async def main():
    unlocks_sanity()
    await in_process()
    await over_ws()
    print("FAILED:", check.failed)

asyncio.run(main())
