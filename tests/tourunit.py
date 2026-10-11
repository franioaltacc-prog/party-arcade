import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, sys, time, math
import tournaments as T

failed = 0
def check(cond, label):
    global failed
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


class Mem:
    def __init__(self, uid, acct=None):
        self.uid, self.name, self.avatar, self.color, self.look = uid, uid.upper(), "🙂", "#fff", {}
        self.account = acct
        self.online = True


class Game:
    def __init__(self):
        self.phase = "lobby"
        self.settings = {"rounds": 8}
        self.starts = 0
        self.restarts = 0
    def listed(self): return self.phase == "lobby"
    def on_message(self, m, t, msg):
        if t == "start":
            self.phase = "playing"; self.starts += 1
    def restart(self, host):
        self.phase = "playing"; self.restarts += 1


class Room:
    n = 0
    def __init__(self, game):
        Room.n += 1
        self.code = f"R{Room.n:03d}"
        self.game_key = game
        self.game = Game()
        self.members = {}
        self.host = None
        self.tour = None
        self.msgs = []
    def system(self, text): self.msgs.append(text)
    def sync_players(self): pass


class Hub:
    def __init__(self):
        self.rooms = {}
        self.tournaments = {}
        self.spawned = []
        self.accounts = None
    def create_room(self, game):
        r = Room(game); self.rooms[r.code] = r; return r
    def clients_by_uid(self, uid): return []
    def spawn(self, coro): self.spawned.append(coro); coro.close()
    def tell_xp(self, *a): pass


async def main():
    # bracket shapes
    for n in range(3, 17):
        hub = Hub()
        t = T.Tournament(hub, "blitz", "Party Blitz", [Mem(f"p{i}") for i in range(n)], "Host")
        size = 2 ** math.ceil(math.log2(n))
        r0 = t.rounds[0]
        seen = [u for m in r0 for u in (m["a"], m["b"]) if u]
        ok = (len(t.rounds) == math.ceil(math.log2(n)) and len(r0) == size // 2 and sorted(seen) == sorted(t.players)
              and all(m["a"] or m["b"] for m in r0) and sum(1 for m in r0 if not (m["a"] and m["b"])) == size - n
              and [len(r) for r in t.rounds] == [size // 2 ** (k + 1) for k in range(len(t.rounds))])
        check(ok, f"{n} players: {len(t.rounds)} rounds, {size - n} byes, everyone placed once")

    hub = Hub()
    t = T.Tournament(hub, "blitz", "Party Blitz", [Mem("a", {"id": 1, "name": "A"}), Mem("b"), Mem("c"), Mem("d")], "Host")
    hub.tournaments[t.id] = t
    check(t.public()["startsIn"] in (7, 8) and t.public()["cur"] == -1, "a short wait before round 1")
    t.start_round(0)
    check(t.cur == 0 and all(m["state"] == "playing" and m["room"] for m in t.rounds[0]), "round 1: every match gets a room")
    m1, m2 = t.rounds[0]
    r1, r2 = hub.rooms[m1["room"]], hub.rooms[m2["room"]]
    check(r1.tour == (t, m1) and r1.game.settings["rounds"] == 5, "match rooms use quick tournament settings")
    # match 1: both turn up -> countdown -> start
    for u in (m1["a"], m1["b"]):
        r1.members[u] = Mem(u)
    now = time.time()
    t.watch_match(m1, now)
    check(m1["start_at"] and not m1["started"] and any("starts in" in x for x in r1.msgs), "both players in: countdown")
    t.watch_match(m1, m1["start_at"] + 0.1)
    check(m1["started"] and r1.game.starts == 1 and r1.host in (m1["a"], m1["b"]), "the match starts, a player is the host")
    # match 2: only one shows up
    r2.members[m2["a"]] = Mem(m2["a"])
    t.watch_match(m2, now)
    check(m2["state"] == "playing", "still waiting for the other player")
    t.watch_match(m2, m2["deadline"] + 1)
    check(m2["state"] == "done" and m2["winner"] == m2["a"] and m2["note"] == "no-show", "no-show: the player who came wins")
    # ties: two rematches, then a coin flip
    t.report(m1, [[m1["a"], m1["b"]]])
    check(m1["state"] == "playing" and m1["rematches"] == 1, "a tie means a rematch")
    await asyncio.sleep(4.2)
    check(r1.game.restarts == 1, "the rematch starts by itself")
    t.report(m1, [[m1["b"], m1["a"]]])
    t.report(m1, [[m1["a"], m1["b"], "watcher"]])
    check(m1["state"] == "done" and m1["winner"] in (m1["a"], m1["b"]) and "coin flip" in m1["note"], "after 2 rematches it's a coin flip")
    # round 2 is set up from the winners
    final = t.rounds[1][0]
    check({final["a"], final["b"]} == {m1["winner"], m2["winner"]} and t.next_at, "winners meet in the final")
    t.start_round(1)
    rf = hub.rooms[final["room"]]
    for u in (final["a"], final["b"]):
        rf.members[u] = Mem(u)
    t.watch_match(final, time.time())
    t.watch_match(final, final["start_at"] + 0.1)
    check(final["started"], "final starts")
    # someone leaves the final
    leaver = final["b"]
    del rf.members[leaver]
    t.watch_match(final, time.time())
    check(final["state"] == "playing" and leaver in final["gone"], "a short disconnect isn't a loss yet")
    t.watch_match(final, time.time() + T.GONE + 1)
    check(final["state"] == "done" and final["winner"] == final["a"] and t.champion == final["a"], "leaving the final hands the other player the title")
    check(len(hub.spawned) == 1, "stats saved for the player with an account")
    check(t.public()["done"] and t.summary()["champion"] == t.players[t.champion]["name"], "public state shows the champion")
    # a finished game in a room that's already done is ignored
    t.report(final, [[final["b"]]])
    check(final["winner"] == final["a"], "late results don't change a finished match")
    t.done_at = time.time() - T.KEEP - 1
    check(t.stale(time.time()), "old tournaments are cleaned up")
    print("FAILED:", failed)

asyncio.run(main())
