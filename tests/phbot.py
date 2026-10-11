"""End-to-end: friend invites, then a full 3-round Prop Hunt game over websockets."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random, time, math
from wsbot import WS
from accbot import req, check
from games import prophunt as P
U = str(random.randint(1000, 9999))


async def wait_for(ws, t, timeout=5, pred=None):
    for i, m in enumerate(getattr(ws, "pushed", [])):
        if m["t"] == t and (pred is None or pred(m)):
            ws.pushed.pop(i)
            return m
    end = time.time() + timeout
    while True:
        m = await asyncio.wait_for(ws.inbox.get(), max(0.01, end - time.time()))
        if m["t"] == t and (pred is None or pred(m)):
            return m
        if m["t"] in ("g:fix",):
            ws.fixes = getattr(ws, "fixes", []) + [m]


async def try_wait(ws, t, timeout=1.0, pred=None):
    try:
        return await wait_for(ws, t, timeout, pred)
    except asyncio.TimeoutError:
        return None


def clear(*ws):
    for w in ws:
        w.drain()
        w.pushed = []


async def invites():
    a, b, c = WS(), WS(), WS()
    await a.connect("ivA" + U + "xx", "Ann"); await b.connect("ivB" + U + "xx", "Bob"); await c.connect("ivC" + U + "xx", "Cat")
    for w in (a, b, c):
        await w.wait("welcome")
    na, nb, nc = "InvAnn" + U, "InvBob" + U, "InvCat" + U
    r = await req(c, "friends:invite", name=na); check(not r["ok"] and "log in" in r["error"], "guests can't invite")
    for w, n in ((a, na), (b, nb), (c, nc)):
        await req(w, "auth:signup", name=n, password="invite-pass-1")
    await req(a, "friends:add", name=nb); await req(b, "friends:add", name=na)
    r = await req(a, "friends:invite", name=nb); check(not r["ok"] and "room first" in r["error"], "you need a room to invite")
    a.send({"t": "room:create", "game": "prophunt"}); j = await wait_for(a, "room:joined")
    clear(b)
    r = await req(a, "friends:invite", name=nb); check(r["ok"], "invite sent")
    iv = await try_wait(b, "friends:invite", 2)
    check(iv and iv["from"] == na and iv["room"]["code"] == j["code"] and iv["room"]["game"] == "prophunt" and iv["room"]["title"] == "Prop Hunt" and not iv["room"]["live"],
          f"friend gets the invite: {iv and iv['room']}")
    r = await req(a, "friends:invite", name=nb); check(not r["ok"] and "moment" in r["error"], "no spamming the same friend")
    r = await req(a, "friends:invite", name=nc); check(not r["ok"] and "only invite your friends" in r["error"], "can't invite strangers")
    clear(a)
    r = await req(b, "friends:invite-no", name=na); check(r["ok"], "decline")
    pg = await try_wait(a, "friends:ping", 2)
    check(pg and pg["kind"] == "declined" and pg["name"] == nb, "inviter hears 'not now'")
    b.send({"t": "room:join", "code": j["code"], "game": "prophunt"}); await wait_for(b, "room:joined")
    await asyncio.sleep(16)
    r = await req(a, "friends:invite", name=nb); check(not r["ok"] and "already in your room" in r["error"], "friend already in the room")
    b.w.close(); await asyncio.sleep(0.5)
    await req(c, "friends:add", name=na); await req(a, "friends:add", name=nc)
    c.w.close(); await asyncio.sleep(0.5)
    r = await req(a, "friends:invite", name=nc); check(not r["ok"] and "offline" in r["error"], "offline friends can't be invited")
    a.w.close()


class Bot:
    def __init__(self, ws, uid):
        self.ws, self.uid = ws, uid
        self.x = self.y = 0.0

    async def walk_to(self, town, tx, ty, speed=230, r=P.PLAYER_R):
        """Straight walk in small steps (like a browser would send)."""
        while True:
            dx, dy = tx - self.x, ty - self.y
            d = math.hypot(dx, dy)
            if d < 1:
                return True
            step = min(d, speed * 0.05)
            nx, ny = self.x + dx / d * step, self.y + dy / d * step
            if town.blocked(nx, ny, r):
                return False
            self.x, self.y = nx, ny
            self.ws.send({"t": "g:pos", "x": round(nx, 1), "y": round(ny, 1), "a": 0})
            await asyncio.sleep(0.05)


def clear_path(town, x0, y0, x1, y1, r=P.PLAYER_R + 2):
    d = math.hypot(x1 - x0, y1 - y0)
    n = max(1, int(d / 6))
    return all(not town.blocked(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r) for i in range(n + 1))


def line_of_fire(town, kx, ky, hx, hy):
    dx, dy = hx - kx, hy - ky
    d = math.hypot(dx, dy); dx /= d; dy /= d
    ox, oy = kx + dx * (P.PLAYER_R + 4), ky + dy * (P.PLAYER_R + 4)
    for w in town.walls:
        t = P.ray_rect(ox, oy, dx, dy, w)
        if t is not None and t < d - 40:
            return False
    for _, px, py, pr in town.props:
        t = P.ray_circle(ox, oy, dx, dy, px, py, pr)
        if t is not None and t < d - 40:
            return False
    return d < P.GUN_RANGE - 40


async def bring_into_sight(town, k, hb, cx, cy):
    """Walk a hider somewhere on the plaza the killer can shoot."""
    for rad in (150, 120, 180):
        for ang in range(0, 360, 12):
            a = math.radians(ang)
            tx, ty = cx + math.cos(a) * rad, cy + math.sin(a) * rad
            if town.blocked(tx, ty, P.PLAYER_R + 6) or not line_of_fire(town, k.x, k.y, tx, ty):
                continue
            if clear_path(town, hb.x, hb.y, tx, ty):
                return await hb.walk_to(town, tx, ty)
            # go via the middle ring
            for ang2 in range(0, 360, 20):
                b = math.radians(ang2)
                mx, my = cx + math.cos(b) * 110, cy + math.sin(b) * 110
                if clear_path(town, hb.x, hb.y, mx, my) and clear_path(town, mx, my, tx, ty):
                    await hb.walk_to(town, mx, my)
                    return await hb.walk_to(town, tx, ty)
    return False


async def prophunt():
    names = ["Hunter" + U, "Hider" + U, "Sneak" + U]
    ws = [WS() for _ in range(3)]
    uids = [f"ph{i}" + U + "xx" for i in range(3)]
    for w, u, n in zip(ws, uids, names):
        await w.connect(u, n); await w.wait("welcome")
        r = await req(w, "auth:signup", name=n, password="prop-pass-1"); assert r["ok"], r
    watcher = WS(); await watcher.connect("phW" + U + "xx", "Watcher"); await watcher.wait("welcome")
    host = ws[0]
    host.send({"t": "room:create", "game": "prophunt"}); j = await wait_for(host, "room:joined"); code = j["code"]
    for w in ws[1:]:
        w.send({"t": "room:join", "code": code, "game": "prophunt"}); await wait_for(w, "room:joined")
    watcher.send({"t": "room:join", "code": code, "game": "prophunt", "watch": True}); await wait_for(watcher, "room:joined")
    host.send({"t": "g:settings", "hide": 15, "time": 90, "cycles": 1})
    await wait_for(host, "g:settings")
    clear(*ws, watcher)
    host.send({"t": "g:start"})
    killers = []
    total_gained = {}
    for rnd in range(1, 4):
        rounds = [await wait_for(w, "g:round", 12) for w in ws]
        wr = await wait_for(watcher, "g:round", 3)
        rd = rounds[0]["round"]
        check(rd["n"] == rnd and rd["total"] == 3, f"round {rnd}/3 starts")
        town = P.Town(rd["map"])
        cx, cy = rd["map"]["spawn"]
        kid = rd["killer"]
        killers.append(kid)
        bots = {}
        for w, u, rr in zip(ws, uids, rounds):
            b = Bot(w, u); b.x, b.y = rr["you"]["x"], rr["you"]["y"]; bots[u] = b
        k = bots[kid]
        hid = [u for u in uids if u != kid]
        if rnd == 1:
            check(wr["you"] is None, "the watcher has no role")
            # blind killer
            s = await wait_for(k.ws, "g:snap", 2)
            check(not any(e[0] in hid for e in s["e"]), "killer sees no hiders while they hide")
            s = await wait_for(watcher, "g:snap", 2)
            check(not any(e[0] in hid for e in s["e"]) and any(e[0] == kid for e in s["e"]), "watcher sees through the killer's eyes")
            # one hider becomes a prop
            h1 = bots[hid[0]]
            target = None
            for i, (kind, px, py, pr) in sorted(enumerate(town.props), key=lambda ip: math.hypot(ip[1][1] - h1.x, ip[1][2] - h1.y)):
                if pr > P.MAX_DISGUISE_R:
                    continue
                ang = math.atan2(h1.y - py, h1.x - px)
                for da in (0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3):
                    sx, sy = px + math.cos(ang + da) * (pr + P.PLAYER_R + 14), py + math.sin(ang + da) * (pr + P.PLAYER_R + 14)
                    if not town.blocked(sx, sy, P.PLAYER_R + 3) and clear_path(town, h1.x, h1.y, sx, sy):
                        target = (i, kind, sx, sy)
                        break
                if target:
                    break
            check(target is not None, "found a prop to copy")
            h1.ws.send({"t": "g:disguise", "i": target[0]})
            toast = await try_wait(h1.ws, "g:toast", 1.5)
            if math.hypot(town.props[target[0]][1] - h1.x, town.props[target[0]][2] - h1.y) > P.REACH + town.props[target[0]][3] + P.PLAYER_R:
                check(toast is not None, "too far away to copy it")
            ok = await h1.walk_to(town, target[2], target[3])
            check(ok, "walked to the prop")
            await asyncio.sleep(0.7)
            h1.ws.send({"t": "g:disguise", "i": target[0]})
            dg = await wait_for(h1.ws, "g:disguised", 2)
            check(dg["prop"] == target[1], f"turned into a {target[1]}")
            fixes = getattr(h1.ws, "fixes", [])
            check(not fixes, f"normal walking is never corrected ({len(fixes)} fixes)")
        hunt = await wait_for(host, "g:hunt", 20)
        check(hunt is not None, "the hunt starts after the hiding time")
        for w in ws:
            w.drain(); w.pushed = []
        # catch both hiders
        for n, u in enumerate(hid):
            hb = bots[u]
            ok = await bring_into_sight(town, k, hb, cx, cy)
            check(ok, f"hider walks into the open ({u[:3]})")
            await asyncio.sleep(0.4)
            if rnd == 1 and n == 0:
                s = await wait_for(k.ws, "g:snap", 2, pred=lambda m: any(e[0] == u for e in m["e"]))
                e = next(e for e in s["e"] if e[0] == u)
                check(e[3] == target[1], "the killer sees the disguised hider as a prop")
            ang = math.atan2(hb.y - k.y, hb.x - k.x)
            await asyncio.sleep(0.45)
            k.ws.send({"t": "g:shoot", "a": round(ang, 3)})
            cg = await wait_for(watcher, "g:caught", 3)
            check(cg["id"] == u and cg["pts"] == n + 1, f"caught #{n + 1} gets {n + 1} point(s)")
            if rnd == 1 and n == 0:
                # a caught player's chat only reaches watchers
                for w in ws: w.drain()
                hb.ws.send({"t": "chat", "text": "psst"})
                got = await try_wait(watcher, "chat", 1.5, pred=lambda m: m.get("text") == "psst")
                check(got and got.get("spec"), "caught player's chat reaches the watcher as spectator chat")
                other = bots[hid[1]].ws
                check(await try_wait(other, "chat", 0.6, pred=lambda m: m.get("text") == "psst") is None, "...but not the hider still alive")
                # wait for the 30s ping
                soon = await wait_for(bots[hid[1]].ws, "g:pingsoon", 34)
                ping = await wait_for(k.ws, "g:ping", 5)
                h2 = bots[hid[1]]
                spot = ping["spots"][0]
                check(len(ping["spots"]) == 1 and math.hypot(spot[0] - h2.x, spot[1] - h2.y) <= P.PING_SPREAD + 5, "the 30 s ping shows roughly where the last hider is")
                check(await try_wait(h2.ws, "g:pinged", 2) is not None, "the hider is told they were pinged")
        ro = await wait_for(host, "g:roundover", 4)
        last = ro["last"]
        check(last["why"] == "all" and last["gained"][kid] == 10, f"round {rnd}: killer caught everyone, +10")
        for u, g in last["gained"].items():
            total_gained[u] = total_gained.get(u, 0) + g
    check(len(set(killers)) == 3, "everyone was the killer once")
    ov = await wait_for(host, "g:over", 15)
    rk = ov["ranking"]
    check({r["id"]: r["points"] for r in rk} == total_gained, f"final points add up: {total_gained}")
    check(sum(total_gained.values()) == 3 * (10 + 1 + 2), "39 points handed out")
    vote = await wait_for(host, "room:vote", 3, pred=lambda m: m["vote"])
    check(vote["vote"]["kind"] == "next", "play-again vote after the game")
    await asyncio.sleep(1.0)
    st = (await req(ws[0], "profile:get", name=names[0]))["profile"]["stats"]
    check(st.get("prophunt.games") == 1 and st.get("prophunt.catches") == 2 and st.get("prophunt.aces") == 1, f"stats saved: {[(k, v) for k, v in st.items() if 'prophunt' in k]}")
    for w in ws + [watcher]:
        w.w.close()


async def main():
    await invites()
    await prophunt()
    print("FAILED:", check.failed)

asyncio.run(main())
