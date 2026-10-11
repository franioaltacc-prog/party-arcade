"""End-to-end tournament: 5 bots, Connect 4, byes, 3 rounds, a champion."""
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, random, time
from wsbot import WS
from accbot import req, check
U = str(random.randint(1000, 9999))
SLOW = 0.05


class Bot:
    def __init__(self, i):
        self.i = i
        self.uid = f"tb{i}{U}xx"
        self.name = f"Tour{i}_{U}"
        self.ws = WS()
        self.matches = []
        self.room = None
        self.seat = None
        self.log = []
        self.tour_states = []

    async def start(self, account):
        await self.ws.connect(self.uid, self.name)
        await self.ws.wait("welcome")
        if account:
            r = await req(self.ws, "auth:signup", name=self.name, password="tour-pass-1")
            assert r["ok"], r
        asyncio.create_task(self.loop())

    async def loop(self):
        ws = self.ws
        for m in getattr(ws, "pushed", []):
            await ws.inbox.put(m)
        ws.pushed = []
        while True:
            m = await ws.inbox.get()
            t = m["t"]
            self.log.append(t)
            if t == "room:joined":
                self.joined = m
            if t == "tour:go":
                self.tour_id = m["id"]
                ws.send({"t": "tour:view", "id": m["id"]})
            elif t == "tour:state":
                self.tour_states.append(m["tour"])
            elif t == "tour:match":
                self.matches.append(m)
                ws.send({"t": "room:join", "code": m["code"], "game": m["game"]})
            elif t == "tour:back":
                ws.send({"t": "room:leave"})
                ws.send({"t": "tour:view", "id": m["id"]})
            elif t == "g:state":
                if m.get("phase") == "playing" and m["seats"][m["turn"]] == self.uid:
                    seat = m["seats"].index(self.uid)
                    await asyncio.sleep(SLOW)
                    ws.send({"t": "g:drop", "col": 0 if seat == 0 else 1})


async def main():
    bots = [Bot(i) for i in range(5)]
    for i, b in enumerate(bots):
        await b.start(account=i < 2)
    host = bots[0]
    host.ws.send({"t": "room:create", "game": "blitz"})
    while not getattr(host, "joined", None):
        await asyncio.sleep(0.05)
    code = host.joined["code"]
    for b in bots[1:]:
        b.ws.send({"t": "room:join", "code": code, "game": "blitz"})
    await asyncio.sleep(1)
    watcher = WS(); await watcher.connect("tbW" + U + "xx", "Watcher"); await watcher.wait("welcome")
    # not the host / wrong game / too few players
    bots[1].ws.send({"t": "tour:start", "game": "connect4"})
    host.ws.send({"t": "tour:start", "game": "life"})
    await asyncio.sleep(0.5)
    check(not any("tour:go" in b.log for b in bots), "only the host starts a tournament, in a supported game")
    host.ws.send({"t": "tour:start", "game": "connect4"})
    await asyncio.sleep(1.0)
    check(all("tour:go" in b.log for b in bots), "everyone is sent to the bracket")
    tid = bots[0].tour_id
    st = bots[0].tour_states[-1]
    check(st and st["id"] == tid and len(st["players"]) == 5 and len(st["rounds"]) == 3 and st["cur"] == -1, f"bracket of 5: 3 rounds ({len(st['rounds'])})")
    r1 = st["rounds"][0]["matches"]
    byes = [m for m in r1 if not m["a"] or not m["b"]]
    check(len(r1) == 4 and len(byes) == 3, "8-slot first round with 3 byes")
    check(st["rounds"][2]["name"] == "Final" and st["rounds"][1]["name"] == "Semi-finals", "round names")
    watcher.send({"t": "tour:view", "id": tid}); ws_state = await watcher.wait("tour:state")
    check(ws_state["tour"]["id"] == tid, "anyone can view the bracket")
    watcher.send({"t": "rooms:list"}); rl = await watcher.wait("rooms:list")
    check(any(t["id"] == tid for t in rl["tours"]), "the tournament is listed on the home page")
    # round 1 starts after the delay
    t0 = time.time()
    while time.time() - t0 < 15 and not any(b.matches for b in bots):
        await asyncio.sleep(0.2)
    players1 = [b for b in bots if b.matches]
    check(len(players1) == 2, f"round 1: one real match ({len(players1)} players sent)")
    m1 = players1[0].matches[0]
    check(m1["round"] == "Quarter-finals" and m1["game"] == "connect4", f"match message: {m1['round']}")
    # a watcher drops into the match room: forced to watch
    watcher.send({"t": "room:join", "code": m1["code"], "game": "connect4"})
    wj = await watcher.wait("room:joined")
    me = next(p for p in wj["players"] if p["id"] == "tbW" + U + "xx")
    check(me.get("watch") and wj["tour"] and wj["tour"]["round"] == "Quarter-finals", "outsiders can only watch a match, and see which match it is")
    # wait for the whole tournament
    t0 = time.time()
    champ = None
    while time.time() - t0 < 120:
        await asyncio.sleep(0.5)
        states = [s for b in bots for s in b.tour_states if s]
        done = [s for s in states if s["champion"]]
        if done:
            champ = done[-1]
            break
    check(champ is not None, f"the tournament finishes ({round(time.time() - t0)}s)")
    if champ:
        rounds = champ["rounds"]
        check(all(m["winner"] for r in rounds for m in r["matches"]), "every match has a winner")
        final = rounds[2]["matches"][0]
        check(final["winner"] == champ["champion"] and final["note"] == "", "the final's winner is the champion")
        semis = rounds[1]["matches"]
        check(all(m["a"] and m["b"] for m in semis), "semi-finals were full matches")
        winner_bot = next(b for b in bots if b.uid == champ["champion"])
        print("champion:", winner_bot.name)
        await asyncio.sleep(1.5)
        # stats for players with accounts
        look = WS(); await look.connect("tbL" + U + "xx", "Looker"); await look.wait("welcome")
        for b in bots[:2]:
            p = (await req(look, "profile:get", name=b.name))["profile"]["stats"]
            check(p.get("tour.played") == 1 and p.get("tour.wins", 0) == (1 if b is winner_bot else 0), f"{b.name} tournament stats: {p.get('tour.played')} played, {p.get('tour.wins', 0)} won")
            check(p.get("games", 0) >= 1 or b.uid not in [x for r in rounds for m in r["matches"] for x in (m["a"], m["b"]) if m["note"] != "bye"], "matches count as normal games")
        check(all("tour:back" in b.log for b in bots if b.matches), "players are sent back to the bracket after their match")
    print("FAILED:", check.failed)

if __name__ == "__main__":
    asyncio.run(main())
