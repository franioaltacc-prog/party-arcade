"""Tournaments: a bracket of 1-on-1 matches.

The host of a room picks a game and everyone in the room is put into a bracket (byes if the
numbers don't work out). Each round, every match gets its own room and both players are sent
there; the match starts as soon as both are in. Winners move on until there's a champion.
Everyone else follows along on the bracket page (/tournament?id=...) and can watch any match."""
import asyncio
import random
import time
import traceback

# the games you can play a tournament in, with quick settings for a 1-on-1 match
GAMES = {
    "connect4": {},
    "dash": {"difficulty": "normal", "length": "short", "checkpoints": True, "modes": True},
    "mines": {"mode": "race", "size": "small", "penalty": 10, "minutes": 3},
    "blitz": {"rounds": 5},
    "prophunt": {"hide": 15, "time": 90, "cycles": 1, "map": "random"},
}
MIN_PLAYERS, MAX_PLAYERS = 3, 16
FIRST_DELAY = 8     # seconds before round 1 (everyone is loading the bracket page)
NEXT_DELAY = 8      # between rounds
SHOW_UP = 45        # seconds to turn up for a match before you lose it
START_IN = 5        # countdown once both players are in the room
GONE = 25           # a player who leaves a match for this long loses it
BACK_AFTER = 7      # seconds after a match before players go back to the bracket
MAX_REMATCHES = 2   # ties are replayed this many times, then it's a coin flip
KEEP = 30 * 60      # a finished tournament stays viewable this long
MAX_AGE = 4 * 3600
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def round_name(i, total):
    left = total - i
    return {1: "Final", 2: "Semi-finals", 3: "Quarter-finals"}.get(left, f"Round {i + 1}")


class Tournament:
    def __init__(self, hub, game, title, members, host_name):
        self.hub = hub
        self.id = "".join(random.choice(CODE_ALPHABET) for _ in range(5))
        while self.id in hub.tournaments:
            self.id = "".join(random.choice(CODE_ALPHABET) for _ in range(5))
        self.game = game
        self.title = title
        self.host = host_name
        self.players = {m.uid: {"name": m.name, "avatar": m.avatar, "color": m.color, "look": dict(m.look),
                                "acct": dict(m.account) if m.account else None} for m in members}
        self.rounds = []
        self.cur = -1
        self.champion = None
        self.created = time.time()
        self.done_at = None
        self.next_at = time.time() + FIRST_DELAY
        self.viewers = set()
        self.handle = None
        self.build()

    # ------------------------------------------------------------------ the bracket
    def build(self):
        seeds = list(self.players)
        random.shuffle(seeds)
        size = 1
        while size < len(seeds):
            size *= 2
        n = size // 2
        byes = size - len(seeds)
        spread = list(range(0, n, 2)) + list(range(1, n, 2))     # byes spread over both halves
        bye_at = set(spread[:byes])
        it = iter(seeds)
        first = []
        for i in range(n):
            a = next(it)
            b = None if i in bye_at else next(it)
            first.append(self.match(a, b))
        self.rounds = [first]
        while len(self.rounds[-1]) > 1:
            self.rounds.append([self.match(None, None) for _ in range(len(self.rounds[-1]) // 2)])

    @staticmethod
    def match(a, b):
        return {"a": a, "b": b, "winner": None, "state": "waiting", "room": None, "note": "",
                "rematches": 0, "deadline": None, "start_at": None, "started": False, "gone": {}}

    def public(self):
        rounds = []
        for i, rnd in enumerate(self.rounds):
            out = []
            for mt in rnd:
                room = self.hub.rooms.get(mt["room"]) if mt["room"] else None
                out.append({"a": mt["a"], "b": mt["b"], "winner": mt["winner"], "state": mt["state"], "room": mt["room"],
                            "note": mt["note"], "live": bool(room and mt["started"] and mt["state"] == "playing")})
            rounds.append({"name": round_name(i, len(self.rounds)), "matches": out})
        players = {uid: {k: p[k] for k in ("name", "avatar", "color", "look")} for uid, p in self.players.items()}
        return {"id": self.id, "game": self.game, "title": self.title, "host": self.host, "players": players, "rounds": rounds,
                "cur": self.cur, "champion": self.champion, "done": self.champion is not None,
                "startsIn": max(0, round(self.next_at - time.time())) if self.next_at else None}

    def summary(self):
        return {"id": self.id, "game": self.game, "title": self.title, "players": len(self.players), "host": self.host,
                "round": round_name(max(0, self.cur), len(self.rounds)), "champion": self.players[self.champion]["name"] if self.champion else None}

    def push(self):
        state = self.public()
        for c in list(self.viewers):
            if c.open:
                c.send("tour:state", tour=state)
            else:
                self.viewers.discard(c)

    def tell(self, uid, t, **data):
        for c in self.hub.clients_by_uid(uid):
            c.send(t, **data)

    # ------------------------------------------------------------------ running it
    def later(self, delay, fn, *args):
        def run():
            try:
                fn(*args)
            except Exception:
                traceback.print_exc()
        return asyncio.get_running_loop().call_later(delay, run)

    def start(self):
        self.handle = self.later(FIRST_DELAY, self.start_round, 0)
        self.later(1, self.tick)

    def start_round(self, i):
        self.cur = i
        self.next_at = None
        name = round_name(i, len(self.rounds))
        for mt in self.rounds[i]:
            if mt["a"] is None or mt["b"] is None:
                mt["winner"] = mt["a"] or mt["b"]
                mt["state"], mt["note"] = "done", "bye"
                continue
            room = self.hub.create_room(self.game)
            room.tour = (self, mt)
            settings = GAMES.get(self.game) or {}
            if settings and hasattr(room.game, "settings"):
                room.game.settings.update(settings)
            mt.update(room=room.code, state="playing", deadline=time.time() + SHOW_UP)
            for me, other in ((mt["a"], mt["b"]), (mt["b"], mt["a"])):
                self.tell(me, "tour:match", id=self.id, game=self.game, code=room.code, round=name, vs=self.players[other]["name"])
        self.push()
        self.check_round()

    def tick(self):
        if self.champion is not None or self.hub.tournaments.get(self.id) is not self:
            return
        now = time.time()
        if 0 <= self.cur < len(self.rounds):
            for mt in self.rounds[self.cur]:
                if mt["state"] == "playing":
                    self.watch_match(mt, now)
        self.later(1, self.tick)

    def watch_match(self, mt, now):
        room = self.hub.rooms.get(mt["room"])
        players = (mt["a"], mt["b"])
        here = [u for u in players if room and u in room.members and room.members[u].online]
        if not mt["started"]:
            if room and room.game.phase not in ("lobby", "waiting"):
                mt["started"] = True        # (Connect 4 starts by itself when both are seated)
                self.push()
            elif len(here) == 2:
                if not mt["start_at"]:
                    mt["start_at"] = now + START_IN
                    room.system(f"🏆 {self.players[mt['a']]['name']} vs {self.players[mt['b']]['name']} — the match starts in {START_IN} seconds!")
                elif now >= mt["start_at"]:
                    self.kick_off(room, mt)
            elif now > mt["deadline"]:
                winner = here[0] if here else random.choice(players)
                if room:
                    room.system("⏰ Someone didn't turn up in time.")
                self.finish_match(mt, winner, "no-show" if here else "nobody came (coin flip)")
            return
        for u in players:
            if u in here:
                mt["gone"].pop(u, None)
            else:
                mt["gone"].setdefault(u, now)
        gone = [u for u, since in mt["gone"].items() if now - since > GONE]
        if gone:
            stay = [u for u in players if u not in gone]
            self.finish_match(mt, stay[0] if stay else random.choice(players), "the other player left")

    def kick_off(self, room, mt):
        host = next((room.members[u] for u in (mt["a"], mt["b"]) if u in room.members), None)
        if not host:
            return
        room.host = host.uid
        room.sync_players()
        if room.game.phase == "lobby" or room.game.listed():
            room.game.on_message(host, "start", {})
        mt["started"] = room.game.phase not in ("lobby", "waiting", "over")
        if not mt["started"]:
            mt["start_at"] = time.time() + 2      # try again in a moment
        self.push()

    def report(self, mt, groups):
        """The match room's game finished. groups: player ids from first place down."""
        if mt["state"] != "playing":
            return
        players = (mt["a"], mt["b"])
        groups = [[u for u in g if u in players] for g in groups]
        groups = [g for g in groups if g]
        if not groups:
            return
        room = self.hub.rooms.get(mt["room"])
        if len(groups[0]) == 2:
            if mt["rematches"] < MAX_REMATCHES and room:
                mt["rematches"] += 1
                room.system("🤝 It's a tie! Rematch in 4 seconds…")
                self.later(4, self.rematch, mt)
                return
            self.finish_match(mt, random.choice(players), "tie → coin flip")
            return
        self.finish_match(mt, groups[0][0], "")

    def rematch(self, mt):
        room = self.hub.rooms.get(mt["room"])
        host = room and next((room.members[u] for u in (mt["a"], mt["b"]) if u in room.members), None)
        if host and mt["state"] == "playing":
            room.host = host.uid
            room.game.restart(host)

    def finish_match(self, mt, winner, note):
        if mt["state"] == "done":
            return
        mt.update(winner=winner, state="done", note=note)
        room = self.hub.rooms.get(mt["room"]) if mt["room"] else None
        if room:
            room.system(f"🏆 {self.players[winner]['name']} wins the match and moves on!")
            members = list(room.members)
            self.later(BACK_AFTER, self.send_back, members)
        self.push()
        self.check_round()

    def send_back(self, uids):
        for uid in uids:
            self.tell(uid, "tour:back", id=self.id)

    def check_round(self):
        rnd = self.rounds[self.cur]
        if any(mt["state"] != "done" for mt in rnd):
            return
        if self.cur == len(self.rounds) - 1:
            self.crown(rnd[0]["winner"])
            return
        nxt = self.rounds[self.cur + 1]
        for k, mt in enumerate(nxt):
            mt["a"], mt["b"] = rnd[2 * k]["winner"], rnd[2 * k + 1]["winner"]
        self.next_at = time.time() + NEXT_DELAY
        self.push()
        self.handle = self.later(NEXT_DELAY, self.start_round, self.cur + 1)

    def crown(self, uid):
        self.champion = uid
        self.done_at = time.time()
        self.next_at = None
        self.push()
        name = self.players[uid]["name"]
        for c in list(self.viewers):
            c.send("tour:champion", id=self.id, name=name)
        rounds_won = {u: 0 for u in self.players}
        for rnd in self.rounds:
            for mt in rnd:
                if mt["winner"] and mt["note"] != "bye":
                    rounds_won[mt["winner"]] += 1
        for u, p in self.players.items():
            if not p["acct"]:
                continue
            won = u == uid
            stats = {"tour.played": ("add", 1)}
            if won:
                stats["tour.wins"] = ("add", 1)
            detail = f"{'Won' if won else 'Played'} a {self.title} tournament · {len(self.players)} players · {rounds_won[u]} match{'es' if rounds_won[u] != 1 else ''} won"
            self.hub.spawn(self.save(p["acct"], "win" if won else "loss", stats, detail, 100 if won else 15 + 10 * rounds_won[u]))

    async def save(self, acct, outcome, stats, detail, xp):
        try:
            gained, before, after = await self.hub.accounts.record(acct["id"], "tour", outcome, stats, detail, xp, totals=False)
        except Exception:
            traceback.print_exc()
            return
        self.hub.tell_xp(acct["id"], gained, before, after, "Tournament")

    def stale(self, now):
        return (self.done_at and now - self.done_at > KEEP) or now - self.created > MAX_AGE
