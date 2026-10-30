#!/usr/bin/env python3
"""
Party Arcade - a tiny multiplayer game hub.

Zero dependencies. Run:

    python3 server.py

then open http://localhost:8000. Friends on the same Wi-Fi can join using the
network address printed at startup. Set PORT / HOST env vars to change them.
"""
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import random
import re
import secrets
import signal
import socket
import struct
import time
import traceback
from pathlib import Path
from urllib.parse import unquote, urlsplit

from accounts import MOTO_CHALLENGES, MOTO_TRACKS, Accounts, chute_key, AuthError, StoreError, level_info, parse_look, role_of
from games import GAMES
import tournaments
from dashlevels import DashLevels, level_id
from planner import Planner

ROOT = Path(__file__).resolve().parent
PUBLIC = (ROOT / "public").resolve()
DATA = Path(os.environ.get("DATA_DIR") or ROOT / "data")
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 1 << 20          # 1 MB per websocket message
OFFLINE_GRACE = 40             # seconds a disconnected player keeps their seat
PING_EVERY = 25                # the server pings every connection this often...
DEAD_AFTER = 75                # ...and drops ones that haven't answered for this long
EMPTY_ROOM_TTL = 90            # seconds an empty room survives
VOTE_SECONDS = 20              # "play again?" and "which game next?" votes
PARTY_NEXT = 10                # seconds of party standings before the next game
PARTY_POINTS = (10, 7, 5, 3)   # 1st, 2nd, 3rd, 4th in each party game; everyone else gets 1
PARTY_GAMES = ("dash", "poly", "moto", "doodle", "songs", "blitz", "impostor", "mines", "front", "prophunt", "casino", "life", "flappy", "golf")   # games that work for groups
WATCHERS_EXTRA = 20            # watchers allowed on top of a game's player limit
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
UID_RE = re.compile(r"^[A-Za-z0-9_-]{6,40}$")

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


# --------------------------------------------------------------------------
# WebSocket framing (RFC 6455, server side)
# --------------------------------------------------------------------------
def ws_frame(payload: bytes, opcode: int = 1) -> bytes:
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x80 | opcode, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x80 | opcode, 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | opcode, 127, n)
    return head + payload


def unmask(data: bytes, mask: bytes) -> bytes:
    n = len(data)
    if not n:
        return data
    key = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "big") ^ int.from_bytes(key, "big")).to_bytes(n, "big")


def clean_text(value, limit):
    text = "".join(ch for ch in str(value or "") if ch.isprintable())
    return " ".join(text.split())[:limit]


# --------------------------------------------------------------------------
# Connections, rooms, hub
# --------------------------------------------------------------------------
class Client:
    def __init__(self, writer):
        self.writer = writer
        self.uid = None
        self.name = "Player"
        self.avatar = "😎"
        self.color = "#ff4fd8"
        self.room = None
        self.open = True
        self.last_chat = 0.0
        self.voted = set()
        self.account = None     # {"id", "name", "admin", "role"} when logged in
        self.device = None      # one id per browser, shared by its tabs
        self.heard = time.time()
        self.ip = "?"
        self.solo_at = 0.0
        self.search_at = 0.0
        self.look = {}          # rewards a logged-in player is wearing (aura, avatar animation)
        self.page = None        # which game page this tab is on (for solo games, so friends can see it)
        self.tour_view = None   # the tournament bracket this tab is looking at

    def send(self, t, **data):
        if not self.open:
            return
        data["t"] = t
        try:
            raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()
            self.writer.write(ws_frame(raw))
            if self.writer.transport.get_write_buffer_size() > 4 << 20:
                self.close()  # client is not reading; drop it
        except Exception:
            self.close()

    def person(self):
        """Who this is, so several tabs of one person count once."""
        if self.account:
            return f"acct:{self.account['id']}"
        return f"dev:{self.device or self.uid}"

    def ping(self):
        if self.open:
            try:
                self.writer.write(ws_frame(b"", 0x9))
            except Exception:
                self.close()

    def close(self):
        if self.open:
            self.open = False
            try:
                self.writer.close()
            except Exception:
                pass

    def info(self):
        return {"id": self.uid, "name": self.name, "avatar": self.avatar, "color": self.color, **shown_look(self.look)}


def shown_look(look):
    """The rewards other players can see on someone's avatar."""
    return {k: look[k] for k in ("aura", "anim", "bike") if look.get(k)}


class Member:
    """A player's seat in a room. Survives short disconnects (page refresh)."""

    def __init__(self, client):
        self.uid = client.uid
        self.client = client
        self.offline_since = None
        self.copy_profile(client)

    watching = False   # here to watch, not to play (joined with 👀 Watch)

    @property
    def plays(self):
        """Online and here to play (not just watching)."""
        return self.client is not None and not self.watching

    def copy_profile(self, client):
        self.name, self.avatar, self.color = client.name, client.avatar, client.color
        self.account = client.account
        self.look = dict(client.look)

    @property
    def online(self):
        return self.client is not None

    def send(self, t, **data):
        if self.client:
            self.client.send(t, **data)

    def info(self):
        acct = self.account
        return {"id": self.uid, "name": self.name, "avatar": self.avatar,
                "color": self.color, "online": self.online, **shown_look(self.look), **({"watch": True} if self.watching else {}),
                "acct": acct["name"] if acct else None, "adm": bool(acct and acct["admin"])}


class Room:
    def __init__(self, hub, game_key, code=None):
        self.hub = hub
        self.code = code or hub.new_code()
        self.game_key = game_key
        self.members = {}
        self.host = None
        self.prev_host = None   # host before a restart; gets the crown back on return
        self.waiting = False    # brought back after a restart, nobody has rejoined yet
        self.timers = set()
        self.banned = set()
        self.empty_since = time.time()
        self.game = GAMES[game_key](self)
        self.party = None   # {"list": [games], "i": index, "scores": {uid: pts}, "names": {uid: name}, "done": bool}
        self.vote = None    # {"kind": "next"|"pick", "votes": {uid: choice}, "ends": time, "options": [...]}
        self.vote_timer = None
        self.party_timer = None
        self.tour = None    # (Tournament, match) when this room is a tournament match
        self.private = False   # code only: not in the open rooms list or quick play (friends still join by code or invite)

    # -- messaging -------------------------------------------------------
    def broadcast(self, t, exclude=None, **data):
        for m in list(self.members.values()):
            if m.uid != exclude:
                m.send(t, **data)

    def send(self, uid, t, **data):
        m = self.members.get(uid)
        if m:
            m.send(t, **data)

    def system(self, text):
        self.broadcast("chat", sys=True, text=text)

    def online_members(self):
        return [m for m in self.members.values() if m.online]

    def players_now(self):
        """Online members who are here to play (not watching). Games pick their players from these."""
        return [m for m in self.members.values() if m.plays]

    # -- what happens after a game: party points, "play again?" vote, switching games --------
    def switch_game(self, key):
        """Everyone moves to another game in this same room (same code)."""
        if key not in GAMES or key == self.game_key:
            return
        self.close()   # stop the old game's timers
        self.vote = None
        self.game_key = key
        self.game = GAMES[key](self)
        self.broadcast("room:goto", game=key, code=self.code)
        self.hub.online_changed()

    def game_over(self, groups):
        """A game finished. groups: player ids from first place down (ties share a group)."""
        if self.tour:
            self.tour[0].report(self.tour[1], groups)
            return
        if self.party and not self.party["done"]:
            self.party_points(groups)
            return
        if self.players_now():
            self.start_vote("next")

    def party_public(self):
        p = self.party
        if not p:
            return None
        board = sorted(p["scores"].items(), key=lambda kv: -kv[1])
        return {"list": p["list"], "i": p["i"], "done": p["done"], "next": p.get("next"),
                "nextIn": max(0, round(p.get("next_at", 0) - time.time())) if p.get("next") else None,
                "board": [{"id": uid, "name": p["names"].get(uid, "?"), "points": pts} for uid, pts in board],
                "last": p.get("last")}

    def push_party(self):
        self.broadcast("party:state", party=self.party_public())

    def start_party(self, games):
        self.party = {"list": games, "i": 0, "scores": {}, "names": {}, "done": False}
        for m in self.players_now():
            self.party["scores"][m.uid] = 0
            self.party["names"][m.uid] = m.name
        self.end_vote()
        self.system(f"🎉 Party mode! {len(games)} games: " + " → ".join(GAME_TITLES.get(g, g) for g in games))
        if self.game_key != games[0]:
            self.switch_game(games[0])
        self.push_party()

    def party_points(self, groups):
        p = self.party
        place = 0
        gained = {}
        for g in groups:
            pts = PARTY_POINTS[place] if place < len(PARTY_POINTS) else 1
            for uid in g:
                gained[uid] = pts
                p["scores"][uid] = p["scores"].get(uid, 0) + pts
                m = self.members.get(uid)
                if m:
                    p["names"][uid] = m.name
            place += len(g)
        p["last"] = {"game": self.game_key, "gained": gained}
        if p["i"] + 1 < len(p["list"]):
            p["next"] = p["list"][p["i"] + 1]
            p["next_at"] = time.time() + PARTY_NEXT
            self.push_party()
            self.system(f"🎉 Party: next up is {GAME_TITLES.get(p['next'], p['next'])} in {PARTY_NEXT} seconds!")
            self.cancel(self.party_timer)
            self.party_timer = self.later(PARTY_NEXT, self.party_next)
        else:
            p["done"] = True
            p["next"] = None
            self.push_party()
            board = sorted(p["scores"].items(), key=lambda kv: -kv[1])
            if board:
                self.system(f"🏆 {p['names'].get(board[0][0], '?')} wins the party with {board[0][1]} points!")
            self.save_party(board)

    def party_next(self):
        p = self.party
        if not p or p["done"]:
            return
        p["i"] += 1
        p["next"] = None
        self.switch_game(p["list"][p["i"]])
        self.push_party()

    def save_party(self, board):
        top = board[0][1] if board else 0
        leaders = [uid for uid, pts in board if pts == top]
        for uid, pts in board:
            won = len(board) >= 2 and pts == top and len(leaders) == 1
            outcome = "win" if won else ("draw" if pts == top and len(board) >= 2 else ("loss" if len(board) >= 2 else "play"))
            stats = {"party.points": ("add", pts)}
            if won:
                stats["party.wins"] = ("add", 1)
            # a party is made of games that were already counted, so it stays out of the all-games totals
            self.hub.record(self, uid, "party", outcome, stats, f"{pts} party points · {len(self.party['list'])} games", 50 if won else 20, totals=False)

    def stop_party(self):
        self.cancel(self.party_timer)
        self.party = None
        self.push_party()

    def vote_public(self):
        v = self.vote
        if not v:
            return None
        counts = {}
        for choice in v["votes"].values():
            counts[choice] = counts.get(choice, 0) + 1
        return {"kind": v["kind"], "left": max(0, round(v["ends"] - time.time())), "counts": counts,
                "options": v.get("options"), "voters": len(self.players_now())}

    def start_vote(self, kind):
        self.cancel(self.vote_timer)
        self.vote = {"kind": kind, "votes": {}, "ends": time.time() + VOTE_SECONDS}
        if kind == "pick":
            self.vote["options"] = [g for g in PARTY_GAMES if g in GAMES] + ["connect4", "billiards"]
        self.vote_timer = self.later(VOTE_SECONDS, self.decide_vote)
        self.broadcast("room:vote", vote=self.vote_public())

    def end_vote(self):
        if self.vote:
            self.cancel(self.vote_timer)
            self.vote = None
            self.broadcast("room:vote", vote=None)

    def cast_vote(self, m, choice):
        v = self.vote
        if not v or not m.plays:
            return
        valid = ("again", "new") if v["kind"] == "next" else tuple(v["options"])
        if choice not in valid:
            return
        v["votes"][m.uid] = choice
        voters = len(self.players_now())
        counts = {}
        for c in v["votes"].values():
            counts[c] = counts.get(c, 0) + 1
        if len(v["votes"]) >= voters or (v["kind"] == "next" and max(counts.values()) * 2 > voters):
            self.decide_vote()
        else:
            self.broadcast("room:vote", vote=self.vote_public())

    def decide_vote(self):
        v = self.vote
        if not v:
            return
        self.cancel(self.vote_timer)
        self.vote = None
        counts = {}
        for c in v["votes"].values():
            counts[c] = counts.get(c, 0) + 1
        self.broadcast("room:vote", vote=None)
        if v["kind"] == "next":
            if counts.get("again", 0) > counts.get("new", 0):
                host = self.members.get(self.host)
                if host:
                    self.system("🔁 Everyone voted: play again!")
                    self.game.restart(host)
            elif counts.get("new", 0):
                self.system("🎮 Let's pick a new game!")
                self.start_vote("pick")
        elif counts:
            best = max(v["options"], key=lambda g: (counts.get(g, 0), -v["options"].index(g)))
            if counts.get(best):
                self.system(f"🎮 Next game: {GAME_TITLES.get(best, best)}!")
                if best == self.game_key:
                    return
                self.switch_game(best)

    def tour_public(self):
        if not self.tour:
            return None
        t, mt = self.tour
        name = next((rnd["name"] for rnd in t.public()["rounds"] if any(x["room"] == self.code for x in rnd["matches"])), "")
        return {"id": t.id, "title": t.title, "round": name, "a": t.players[mt["a"]]["name"], "b": t.players[mt["b"]]["name"],
                "players": [mt["a"], mt["b"]]}

    def players(self):
        return [m.info() for m in self.members.values()]

    def sync_players(self):
        self.broadcast("room:players", host=self.host, players=self.players())

    # -- timers ----------------------------------------------------------
    def later(self, delay, fn, *args):
        loop = asyncio.get_running_loop()

        def run():
            self.timers.discard(handle)
            try:
                fn(*args)
            except Exception:
                traceback.print_exc()

        handle = loop.call_later(max(0, delay), run)
        self.timers.add(handle)
        return handle

    def cancel(self, handle):
        if handle:
            handle.cancel()
            self.timers.discard(handle)

    def close(self):
        for h in list(self.timers):
            h.cancel()
        self.timers.clear()

    # -- membership ------------------------------------------------------
    def add(self, client, watch=False):
        member = self.members.get(client.uid)
        rejoin = member is not None
        if rejoin:
            old = member.client
            if old is not None and old is not client:
                old.room = None
                old.send("room:kicked", reason="You opened this room in another tab.")
            member.client = client
            member.offline_since = None
            member.copy_profile(client)
        else:
            member = Member(client)
            member.watching = bool(watch)
            self.members[client.uid] = member
        client.room = self
        self.empty_since = None
        self.waiting = False
        if self.host not in self.members:
            self.host = client.uid
        if self.tour and client.uid in (self.tour[1]["a"], self.tour[1]["b"]) and self.host not in (self.tour[1]["a"], self.tour[1]["b"]):
            self.host = client.uid      # in a tournament match one of the two players is always the host
        if client.uid == self.prev_host:
            if self.host != client.uid and self.host in self.members and rejoin:
                self.system(f"👑 {member.name} is the host again")
            self.host, self.prev_host = client.uid, None
        self.pick_host()
        client.send("room:joined", code=self.code, game=self.game_key, me=client.uid, party=self.party_public(), vote=self.vote_public(), tour=self.tour_public(),
                    host=self.host, private=self.private, players=self.players(), state=self.game.state_for(member))
        self.sync_players()
        if not rejoin:
            self.system(f"{member.avatar} {member.name} {'is watching 👀' if member.watching else 'joined the room'}")
        self.game.on_join(member, rejoin)
        self.hub.online_changed()

    def disconnect(self, client):
        member = self.members.get(client.uid)
        client.room = None
        if not member or member.client is not client:
            return
        member.client = None
        member.offline_since = time.time()
        self.game.on_offline(member)
        self.pick_host()
        self.sync_players()
        if not self.online_members():
            self.empty_since = time.time()
        self.hub.online_changed()

    def remove(self, uid):
        member = self.members.pop(uid, None)
        if not member:
            return
        if member.client:
            member.client.room = None
        self.system(f"{member.avatar} {member.name} left")
        if uid == self.prev_host:
            self.prev_host = None
        self.game.on_leave(member)
        self.pick_host()
        self.sync_players()
        if not self.online_members() and self.empty_since is None:
            self.empty_since = time.time()
        self.hub.online_changed()

    def kick(self, uid, reason="The host removed you from the room."):
        member = self.members.get(uid)
        if not member:
            return
        self.banned.add(uid)
        if member.client:
            member.client.send("room:kicked", reason=reason)
        self.remove(uid)

    def pick_host(self):
        current = self.members.get(self.host)
        if current and current.online:
            return
        for m in self.members.values():
            if m.online:
                if current is not None and self.prev_host is None:
                    # the host only dropped (page reload, game switch): they get the crown back on return
                    self.prev_host = current.uid
                self.host = m.uid
                if current is not None:
                    self.system(f"👑 {m.name} is now the host")
                return


class Hub:
    def __init__(self):
        self.clients = set()
        self.rooms = {}
        self.chat_log = []
        self.wyr = self.load_json("wyr.json", {})
        self.wyr_dirty = False
        self._online_scheduled = False
        self.accounts = Accounts(DATA)
        self.dash_levels = DashLevels(self.accounts)   # Neon Dash community levels
        self.planner = Planner(self.accounts)          # the update calendar for testers and developers
        self.tasks = set()
        self.started = time.time()
        self.restoring = {}     # room code -> task looking it up in saved rooms
        self.tournaments = {}   # id -> Tournament
        self.closing = False

    # -- persistence -----------------------------------------------------
    def load_json(self, name, default):
        try:
            return json.loads((DATA / name).read_text())
        except Exception:
            return default

    def save_json(self, name, value):
        try:
            DATA.mkdir(exist_ok=True)
            (DATA / name).write_text(json.dumps(value))
        except Exception:
            traceback.print_exc()

    # -- helpers ---------------------------------------------------------
    def new_code(self):
        while True:
            code = "".join(random.choice(CODE_ALPHABET) for _ in range(4))
            if code not in self.rooms:
                return code

    def online_payload(self):
        games = {}
        for r in self.rooms.values():
            games[r.game_key] = games.get(r.game_key, 0) + len(r.online_members())
        people = {c.person() for c in self.clients if c.uid}
        return {"count": len(people), "games": games}

    def online_changed(self):
        if self._online_scheduled:
            return
        self._online_scheduled = True

        def push():
            self._online_scheduled = False
            payload = self.online_payload()
            for c in list(self.clients):
                c.send("online", **payload)

        asyncio.get_running_loop().call_later(1.0, push)

    def room_list(self):
        """Open rooms you can join, and games in progress you can watch (live)."""
        out = []
        for r in self.rooms.values():
            playing = r.players_now()
            if not playing or r.private:
                continue
            host = r.members.get(r.host)
            out.append({"code": r.code, "game": r.game_key, "players": len(playing),
                        "watchers": sum(1 for m in r.online_members() if m.watching),
                        "max": r.game.max_players, "host": host.name if host else "?",
                        "hostAvatar": host.avatar if host else "🎮", "live": not r.game.listed(),
                        "party": bool(r.party and not r.party["done"]), "tour": r.tour[0].title if r.tour else None})
        out.sort(key=lambda x: (x["live"], -x["players"]))
        return out[:40]

    def set_profile(self, c, msg):
        name = clean_text(msg.get("name"), 16)
        if name:
            c.name = name
        avatar = clean_text(msg.get("avatar"), 8)
        if avatar:
            c.avatar = avatar
        color = str(msg.get("color") or "")
        if COLOR_RE.match(color):
            c.color = color

    def create_room(self, game_key):
        room = Room(self, game_key)
        self.rooms[room.code] = room
        return room

    async def restore_room(self, code):
        """Bring back a room the previous server saved when it shut down (a redeploy)."""
        if code in self.rooms or len(code) != 4 or any(ch not in CODE_ALPHABET for ch in code):
            return
        task = self.restoring.get(code)
        if task is None:
            task = asyncio.get_running_loop().create_task(self._restore_room(code))
            self.restoring[code] = task
            task.add_done_callback(lambda _: self.restoring.pop(code, None))
        await asyncio.shield(task)

    async def _restore_room(self, code):
        try:
            saved = await self.accounts.take_room(code)
        except Exception:
            traceback.print_exc()
            return
        if not saved or saved["game"] not in GAMES or code in self.rooms:
            return
        room = Room(self, saved["game"], code)
        room.prev_host = saved["host"]
        room.banned = saved["banned"]
        room.private = saved.get("private", False)
        room.waiting = True
        self.rooms[code] = room

    async def join_saved(self, c, code, game, watch=False):
        await self.restore_room(code)
        if c.open:
            self.join_code(c, code, game, watch)

    async def find_saved(self, c, code):
        await self.restore_room(code)
        room = self.rooms.get(code)
        c.send("room:found", code=code, game=room.game_key if room else None)

    def join_code(self, c, code, game, watch=False):
        room = self.rooms.get(code)
        if not room:
            c.send("error", msg=f"No room with code {code or '????'} 🤔", code="noroom")
        elif game and game != room.game_key:
            c.send("error", msg="That code is for a different game", code="wronggame",
                   game=room.game_key, room=room.code)
        else:
            self.join(c, room, watch)

    async def shutdown(self):
        """Render (or Ctrl+C) is stopping this server: warn everyone and save the rooms
        so the next server can bring them back when players reconnect."""
        if self.closing:
            return
        self.closing = True
        for c in list(self.clients):
            c.send("server:restart")
        rooms = [(r.code, r.game_key, r.host, r.banned, r.private) for r in self.rooms.values() if r.members]
        if rooms:
            try:
                await asyncio.wait_for(self.accounts.save_rooms(rooms), 15)
                print(f"  💾 Saved {len(rooms)} room(s) for the next start")
            except Exception:
                traceback.print_exc()
        if self.wyr_dirty:
            self.save_json("wyr.json", self.wyr)
        for c in list(self.clients):
            c.close()

    def join(self, c, room, watch=False):
        if room.tour and c.uid not in (room.tour[1]["a"], room.tour[1]["b"]):
            watch = True        # only the two players play a tournament match; everyone else watches
        if c.room is not None and c.room is not room:
            c.room.remove(c.uid)
        if c.uid in room.banned:
            c.send("error", msg="You were removed from that room. 🚫")
            return
        if c.uid not in room.members:
            players = sum(1 for m in room.members.values() if not m.watching)
            if watch and len(room.members) >= room.game.max_players + WATCHERS_EXTRA:
                c.send("error", msg="Too many people are watching that room right now!")
                return
            if not watch and players >= room.game.max_players:
                c.send("error", msg="That room is full! You can still watch it from the home page 👀")
                return
        room.add(c, watch)

    def disconnect(self, c):
        self.clients.discard(c)
        t = self.tournaments.get(getattr(c, "tour_view", None))
        if t:
            t.viewers.discard(c)
        if c.room:
            c.room.disconnect(c)
        self.online_changed()

    # -- message router --------------------------------------------------
    def handle(self, c, msg):
        t = msg.get("t")
        if not isinstance(t, str):
            return
        if t == "hello":
            uid = str(msg.get("id") or "")
            c.uid = uid if UID_RE.match(uid) else secrets.token_urlsafe(9)
            device = str(msg.get("device") or "")
            c.device = device if UID_RE.match(device) else None
            self.set_profile(c, msg)
            page = str(msg.get("page") or "")
            c.page = page if page in GAME_TITLES else None
            c.send("welcome", id=c.uid, online=self.online_payload())
            self.online_changed()
            token = msg.get("token")
            if isinstance(token, str) and token:
                self.spawn(self.resume(c, token))
            else:
                c.send("auth:state", user=None)
            return
        if c.uid is None:
            return

        if t == "ping":
            c.send("pong", ts=msg.get("ts"))
        elif t == "profile":
            self.set_profile(c, msg)
            if c.account:
                c.name = c.account["name"]
            if c.room and c.uid in c.room.members:
                c.room.members[c.uid].copy_profile(c)
                c.room.sync_players()
        elif t == "room:create":
            game = msg.get("game")
            if game in GAMES:
                room = self.create_room(game)
                room.private = bool(msg.get("private"))
                self.join(c, room)
        elif t == "room:join":
            code = clean_text(msg.get("code"), 8).upper()
            watch = bool(msg.get("watch"))
            if code in self.rooms:
                self.join_code(c, code, msg.get("game"), watch)
            else:
                self.spawn(self.join_saved(c, code, msg.get("game"), watch))
        elif t == "tour:view":
            tour = self.tournaments.get(str(msg.get("id") or "").upper())
            if not tour:
                c.send("tour:state", tour=None)
                return
            old = self.tournaments.get(getattr(c, "tour_view", None))
            if old:
                old.viewers.discard(c)
            c.tour_view = tour.id
            tour.viewers.add(c)
            c.send("tour:state", tour=tour.public())
        elif t in ("room:watch", "room:vote", "room:privacy", "party:start", "party:stop", "room:switch", "tour:start") and c.room:
            self.room_action(c, t, msg)
        elif t == "room:quick":
            game = msg.get("game")
            if game not in GAMES:
                return
            options = [r for r in self.rooms.values()
                       if r.game_key == game and r.online_members() and r.game.listed() and not r.tour and not r.private
                       and sum(1 for m in r.members.values() if not m.watching) < r.game.max_players and r is not c.room]
            room = max(options, key=lambda r: len(r.online_members())) if options else self.create_room(game)
            self.join(c, room)
        elif t == "room:leave":
            if c.room:
                c.room.remove(c.uid)
            c.send("room:left")
        elif t == "room:find":
            code = clean_text(msg.get("code"), 8).upper()
            self.spawn(self.find_saved(c, code))
        elif t == "rooms:list":
            c.send("rooms:list", rooms=self.room_list(), tours=[t.summary() for t in self.tournaments.values()][:10])
        elif t == "chat":
            self.chat(c, msg)
        elif t == "chat:history":
            c.send("chat:history", messages=self.chat_log[-40:])
        elif t == "wyr:vote":
            self.wyr_vote(c, msg)
        elif t == "wyr:get":
            q = str(msg.get("q"))[:6]
            c.send("wyr:result", q=q, votes=self.wyr.get(q, [0, 0]), mine=None)
        elif t in ACCOUNT_MESSAGES:
            self.spawn(self.account_message(c, t, msg))
        elif t.startswith("g:") and c.room:
            member = c.room.members.get(c.uid)
            if member and member.client is c:
                if t == "g:start" and c.room.vote and member.uid == c.room.host:
                    c.room.end_vote()   # the host started a game: no need to vote
                c.room.game.on_message(member, t[2:], msg)

    def room_action(self, c, t, msg):
        """Room-wide things that work in every game: watching, votes, party mode, switching game."""
        room = c.room
        m = room.members.get(c.uid)
        if not m or m.client is not c:
            return
        host = room.host == m.uid
        if room.tour and t in ("party:start", "room:switch", "tour:start"):
            return      # a tournament match room stays as it is
        if t == "room:watch":
            want = bool(msg.get("watch"))
            if not want and room.tour and m.uid not in (room.tour[1]["a"], room.tour[1]["b"]):
                c.send("error", msg="Only the two players can play a tournament match — you can watch!")
                return
            if want != m.watching:
                if not want and sum(1 for x in room.members.values() if not x.watching) >= room.game.max_players:
                    c.send("error", msg="The room is full of players right now.")
                    return
                m.watching = want
                room.system(f"{m.avatar} {m.name} " + ("is just watching now 👀" if want else "joined in! ✋"))
                room.sync_players()
                if not want:
                    room.game.on_join(m, True)   # games that let people join mid-round add them now
        elif t == "room:vote":
            room.cast_vote(m, str(msg.get("choice") or ""))
        elif t == "room:privacy" and host:
            want = bool(msg.get("private"))
            if want != room.private:
                room.private = want
                room.broadcast("room:privacy", private=want)
                room.system("🔒 The room is code only now: friends join with the code or an invite" if want
                            else "🌍 The room is public now: anyone can find it in open rooms and quick play")
        elif t == "party:start" and host:
            games = msg.get("games")
            if isinstance(games, list) and 2 <= len(games) <= 8 and all(g in PARTY_GAMES and g in GAMES for g in games):
                room.start_party(list(games))
            else:
                c.send("error", msg="Pick 2 to 8 games for the party.")
        elif t == "party:stop" and host and room.party:
            room.system("🛑 The host ended party mode.")
            room.stop_party()
        elif t == "tour:start" and host:
            game = msg.get("game")
            players = room.players_now()
            if game not in tournaments.GAMES or game not in GAMES:
                c.send("error", msg="Pick a game for the tournament.")
            elif not tournaments.MIN_PLAYERS <= len(players) <= tournaments.MAX_PLAYERS:
                c.send("error", msg=f"A tournament needs {tournaments.MIN_PLAYERS} to {tournaments.MAX_PLAYERS} players in the room (watchers don't count).")
            else:
                tour = tournaments.Tournament(self, game, GAME_TITLES.get(game, game), players, m.name)
                self.tournaments[tour.id] = tour
                room.end_vote()
                if room.party:
                    room.stop_party()
                room.system(f"🏆 {m.name} started a {tour.title} tournament with {len(players)} players!")
                room.broadcast("tour:go", id=tour.id)
                tour.start()
        elif t == "room:switch" and host:
            game = msg.get("game")
            if game in GAMES and game != room.game_key:
                room.end_vote()
                room.system(f"🔀 The host switched to {GAME_TITLES.get(game, game)}!")
                room.switch_game(game)

    def chat(self, c, msg):
        text = clean_text(msg.get("text"), 200)
        now = time.time()
        if not text or now - c.last_chat < 0.4:
            return
        c.last_chat = now
        entry = {"from": c.info(), "text": text, "ts": int(now * 1000)}
        if c.room:
            member = c.room.members.get(c.uid)
            if member and member.client is c and c.room.game.on_chat(member, entry):
                return
            c.room.broadcast("chat", **entry)
        else:
            self.chat_log.append(entry)
            del self.chat_log[:-60]
            for other in list(self.clients):
                if other.room is None:
                    other.send("chat", **entry)

    def wyr_vote(self, c, msg):
        q = str(msg.get("q"))[:6]
        choice = msg.get("choice")
        if choice not in (0, 1):
            return
        votes = self.wyr.setdefault(q, [0, 0])
        if q not in c.voted:
            c.voted.add(q)
            votes[choice] += 1
            self.wyr_dirty = True
        c.send("wyr:result", q=q, votes=votes, mine=choice)

    # -- accounts --------------------------------------------------------
    def spawn(self, coro):
        task = asyncio.get_running_loop().create_task(coro)
        self.tasks.add(task)

        def done(t):
            self.tasks.discard(t)
            if not t.cancelled() and t.exception():
                traceback.print_exception(t.exception())

        task.add_done_callback(done)

    def clients_by_uid(self, uid):
        return [c for c in list(self.clients) if c.uid == uid]

    def clients_of(self, user_id):
        return [c for c in list(self.clients) if c.account and c.account["id"] == user_id]

    def attach(self, c, user):
        """Log this connection in as `user` (a row from the users table)."""
        c.account = {"id": user["id"], "name": user["name"], "admin": bool(user["admin"]), "role": role_of(user)}
        c.name, c.avatar, c.color = user["name"], user["avatar"], user["color"]
        c.look = parse_look(user.get("look"))
        self.refresh_member(c)

    def detach(self, c):
        c.account = None
        c.look = {}
        self.refresh_member(c)

    def refresh_member(self, c):
        if c.room and c.uid in c.room.members:
            member = c.room.members[c.uid]
            if member.client is c:
                member.copy_profile(c)
                c.room.sync_players()

    async def resume(self, c, token):
        try:
            user = await self.accounts.resume(token)
        except StoreError:
            traceback.print_exc()
            c.send("auth:state", user=None, offline=True)
            return
        if user and c.open:
            self.attach(c, user)
            c.send("auth:state", user=self.accounts.me(user))
        else:
            c.send("auth:state", user=None, expired=True)

    def record(self, room, uid, game, outcome, stats=None, detail="", xp=None, totals=True):
        """Save a finished game for a player if they are logged in."""
        member = room.members.get(uid)
        acct = member.account if member else None
        if acct:
            self.spawn(self._record(room, uid, acct, game, outcome, stats, detail, xp, totals))

    async def _record(self, room, uid, acct, game, outcome, stats, detail, xp, totals=True):
        try:
            gained, before, after = await self.accounts.record(acct["id"], game, outcome, stats, detail, xp, totals)
        except StoreError:
            traceback.print_exc()
            return
        self.tell_xp(acct["id"], gained, before, after, f"{GAME_TITLES.get(game, game)} · {outcome}")

    def tell_xp(self, user_id, gained, before, after, why=""):
        info = level_info(after)
        up = info["level"] > level_info(before)["level"]
        for c in self.clients_of(user_id):
            c.send("account:xp", gained=gained, why=why, levelUp=up, **info)

    async def account_message(self, c, t, msg):
        rid = msg.get("rid")
        try:
            result = await self.account_op(c, t, msg)
            c.send("res", rid=rid, ok=True, **(result or {}))
        except AuthError as e:
            c.send("res", rid=rid, ok=False, error=str(e))
        except StoreError:
            traceback.print_exc()
            c.send("res", rid=rid, ok=False, error="The account database isn't reachable right now. Try again in a minute. 🛠️")
        except Exception:
            traceback.print_exc()
            c.send("res", rid=rid, ok=False, error="Something went wrong 😵")

    def people_online(self):
        """Everyone online, with all of one person's tabs grouped together."""
        people = {}
        for x in list(self.clients):
            if not x.uid:
                continue
            p = people.setdefault(x.person(), {"name": x.name, "avatar": x.avatar, "acct": x.account["name"] if x.account else None,
                                               "tabs": 0, "where": []})
            p["tabs"] += 1
            if x.room:
                p["where"].append({"room": x.room.code, "game": x.room.game_key})
        return sorted(people.values(), key=lambda p: (not p["where"], p["name"].lower()))

    def presence(self, user_id):
        """Is a player online, and what are they playing? Used by the friends list."""
        live = self.clients_of(user_id)
        out = {"online": bool(live), "room": None, "page": None}
        for x in live:
            r = x.room
            m = r.members.get(x.uid) if r else None
            if r and m and m.client is x and not out["room"]:
                players = sum(1 for y in r.members.values() if not y.watching)
                out["room"] = {"code": r.code, "game": r.game_key, "title": GAME_TITLES.get(r.game_key, r.game_key),
                               "live": not r.game.listed(), "full": players >= r.game.max_players,
                               "watching": m.watching, "party": bool(r.party and not r.party.get("done"))}
            elif x.page and not out["page"]:
                out["page"] = {"game": x.page, "title": GAME_TITLES.get(x.page, x.page)}
        return out

    def friend_ping(self, user_id, **data):
        for x in self.clients_of(user_id):
            x.send("friends:ping", **data)

    def need_login(self, c):
        if not c.account:
            raise AuthError("You need to log in first.")
        return c.account["id"]

    async def account_op(self, c, t, msg):
        acc = self.accounts
        if t == "auth:signup":
            user, token = await acc.signup(msg.get("name"), msg.get("password"), msg.get("avatar"), msg.get("color"), c.ip)
            self.attach(c, user)
            return {"token": token, "user": acc.me(user)}
        if t == "auth:login":
            user, token = await acc.login(msg.get("name"), msg.get("password"), c.ip)
            self.attach(c, user)
            return {"token": token, "user": acc.me(user)}
        if t == "auth:logout":
            await acc.logout(msg.get("token"))
            self.detach(c)
            return {}
        if t == "account:update":
            user = await acc.update_look(self.need_login(c), msg.get("avatar"), msg.get("color"), msg.get("bio"))
            for other in self.clients_of(user["id"]):
                self.attach(other, user)
            return {"user": acc.me(user)}
        if t == "account:look":
            look = msg.get("look") if isinstance(msg.get("look"), dict) else {}
            user = await acc.set_look(self.need_login(c), look)
            for other in self.clients_of(user["id"]):
                self.attach(other, user)
            return {"user": acc.me(user)}
        if t == "account:password":
            token = await acc.change_password(self.need_login(c), msg.get("old"), msg.get("new"))
            return {"token": token}
        if t == "account:delete":
            uid = self.need_login(c)
            await acc.delete_account(uid, msg.get("password"))
            for other in self.clients_of(uid):
                self.detach(other)
                if other is not c:
                    other.send("auth:state", user=None, expired=True)
            return {}
        if t == "profile:get":
            prof = await acc.profile(msg.get("name"))
            if not prof:
                raise AuthError("No player with that name.")
            live = self.clients_of(prof["id"])
            prof["online"] = bool(live)
            rooms = [x.room for x in live if x.room]
            prof["playing"] = GAME_TITLES.get(rooms[0].game_key) if rooms else None
            if c.account and c.account["id"] != prof["id"]:
                prof["friend"] = await acc.friend_state(c.account["id"], prof["id"])
                if prof["friend"] == "ok":
                    prof["where"] = self.presence(prof["id"])
            return {"profile": prof}
        if t == "players:find":
            if time.time() - c.search_at < 0.25:
                await asyncio.sleep(0.25)
            c.search_at = time.time()
            players, total = await acc.find_players(msg.get("q"), str(msg.get("sort") or "active"))
            for p in players:
                live = self.clients_of(p["id"])
                p["online"] = bool(live)
                rooms = [x.room for x in live if x.room]
                p["playing"] = GAME_TITLES.get(rooms[0].game_key) if rooms else None
            return {"players": players, "total": total}
        if t == "lb:boards":
            return {"boards": acc.boards()}
        if t == "lb:get":
            return {"board": await acc.board(str(msg.get("board") or "xp"), c.account["id"] if c.account else None)}
        if t == "ghost:get":   # the record holder's run on an Unrevvd board, to race against
            return {"ghost": await acc.ghost(str(msg.get("game") or ""))}
        if t == "ghost:put":
            uid = self.need_login(c)
            if acc.limited(f"ghost:{uid}", 20, 600):
                raise AuthError("Slow down a little 🙂")
            acc.hit(f"ghost:{uid}")
            return await acc.ghost_put(uid, str(msg.get("game") or ""), msg.get("ms"), msg.get("data"))
        if t == "stats:solo":
            uid = self.need_login(c)
            if time.time() - c.solo_at < 4:
                raise AuthError("Slow down a little 🙂")
            c.solo_at = time.time()
            game = str(msg.get("game") or "")
            value = msg.get("value")
            if not isinstance(value, (int, float)) or value != value:
                raise AuthError("Bad score.")
            result = await acc.solo(uid, game, value, msg.get("extra") if isinstance(msg.get("extra"), dict) else None)
            self.tell_xp(uid, result["gained"], result["before"], result["after"], GAME_TITLES.get(game, game))
            return result
        if t == "friends:list":
            out = await acc.friends(self.need_login(c))
            for f in out["friends"]:
                f.update(self.presence(f["id"]))
            out["friends"].sort(key=lambda f: (not f["online"], not f["room"], f["name"].lower()))
            return out
        if t == "friends:add":
            uid = self.need_login(c)
            if acc.limited(f"friend:{uid}", 30, 600):
                raise AuthError("That’s a lot of friend requests — try again in a few minutes.")
            acc.hit(f"friend:{uid}")
            them, state = await acc.friend_add(uid, msg.get("name"))
            me = c.account["name"]
            self.friend_ping(them["id"], kind="accepted" if state == "friends" else "request", name=me)
            return {"state": state, "name": them["name"]}
        if t == "friends:invite":
            uid = self.need_login(c)
            room = c.room
            m = room.members.get(c.uid) if room else None
            if not m or m.client is not c:
                raise AuthError("Join or create a room first, then invite your friends.")
            them = await acc.user_by_name(msg.get("name"))
            if not them or await acc.friend_state(uid, them["id"]) != "ok":
                raise AuthError("You can only invite your friends.")
            live = self.clients_of(them["id"])
            if not live:
                raise AuthError(f"{them['name']} is offline right now.")
            if any(x.room is room for x in live):
                raise AuthError(f"{them['name']} is already in your room!")
            if acc.limited(f"invite:{uid}:{them['id']}", 1, 15):
                raise AuthError(f"You just invited {them['name']} — give them a moment 🙂")
            if acc.limited(f"invite:{uid}", 12, 120):
                raise AuthError("That’s a lot of invites — wait a minute.")
            acc.hit(f"invite:{uid}:{them['id']}")
            acc.hit(f"invite:{uid}")
            players = sum(1 for x in room.members.values() if not x.watching)
            invite = {"from": c.account["name"], "avatar": c.avatar, "color": c.color, "look": shown_look(c.look),
                      "room": {"code": room.code, "game": room.game_key, "title": GAME_TITLES.get(room.game_key, room.game_key),
                               "live": not room.game.listed(), "full": players >= room.game.max_players,
                               "party": bool(room.party and not room.party.get("done"))}}
            for x in live:
                x.send("friends:invite", **invite)
            return {"name": them["name"]}
        if t == "friends:invite-no":
            uid = self.need_login(c)
            them = await acc.user_by_name(msg.get("name"))
            if them and not acc.limited(f"invite-no:{uid}", 10, 60) and await acc.friend_state(uid, them["id"]) == "ok":
                acc.hit(f"invite-no:{uid}")
                self.friend_ping(them["id"], kind="declined", name=c.account["name"])
            return {}
        if t == "friends:remove":
            uid = self.need_login(c)
            them = await acc.friend_remove(uid, msg.get("name"))
            self.friend_ping(them["id"], kind="removed", name=c.account["name"])
            return {"name": them["name"]}
        if t == "admin:unlock":
            user = await acc.unlock_admin(self.need_login(c), msg.get("code"))
            for other in self.clients_of(user["id"]):
                self.attach(other, user)
                other.send("auth:state", user=acc.me(user))
            return {"user": acc.me(user)}

        if t.startswith("dash:"):
            return await self.dash_op(c, t, msg)
        if t.startswith("plan:"):
            return await self.plan_op(c, t, msg)
        if t.startswith("team:"):
            return await self.team_op(c, t, msg)

        # everything below is admin only (checked against the database every time)
        actor = await acc.require_admin(self.need_login(c))
        if t == "admin:overview":
            return {"users": await acc.count_users(), "storage": acc.store.kind, "where": acc.store.where,
                    "uptime": int(time.time() - self.started), "adminCode": len(acc.admin_code) >= 8,
                    "clients": self.people_online(),
                    "rooms": [{"code": r.code, "game": r.game_key, "phase": r.game.phase, "tainted": r.game.tainted,
                               "players": [{"id": m.uid, "name": m.name, "avatar": m.avatar, "online": m.online,
                                            "acct": m.account["name"] if m.account else None} for m in r.members.values()]}
                              for r in self.rooms.values()]}
        if t == "admin:users":
            return {"users": await acc.search(msg.get("q"))}
        if t == "admin:user":
            action = str(msg.get("action") or "")
            name = str(msg.get("name") or "")
            user = await acc.admin_action(actor, name, action, msg.get("value"))
            for other in [x for x in list(self.clients) if x.account and x.account["name"].lower() == name.lower()]:
                if user is None or action in ("ban", "logout", "password"):
                    self.detach(other)
                    other.send("auth:state", user=None, banned=action == "ban", expired=True)
                else:
                    self.attach(other, user)
                    other.send("auth:state", user=acc.me(user))
            return {"user": acc.me(user) if user else None}
        if t == "admin:announce":
            text = clean_text(msg.get("text"), 200)
            if not text:
                raise AuthError("Type a message first.")
            for x in list(self.clients):
                x.send("announce", text=text, by=actor["name"])
            return {"sent": len(self.clients)}
        if t == "admin:room":
            room = self.rooms.get(clean_text(msg.get("code"), 8).upper())
            if not room:
                raise AuthError("That room is gone.")
            if msg.get("action") == "close":
                for uid in list(room.members):
                    room.kick(uid, "An admin closed this room. 🛡️")
                room.close()
                self.rooms.pop(room.code, None)
                self.online_changed()
                return {"closed": True}
            if msg.get("action") == "kick":
                uid = str(msg.get("uid") or "")
                if uid not in room.members:
                    raise AuthError("That player already left.")
                room.kick(uid, "An admin removed you from the room. 🛡️")
                return {"kicked": True}
            raise AuthError("Unknown room action.")
        if t == "admin:cheat":
            if not c.room or c.uid not in c.room.members:
                raise AuthError("Join a game room first.")
            member = c.room.members[c.uid]
            game = c.room.game
            text = game.on_admin(member, str(msg.get("action") or ""), msg)
            if not text:
                raise AuthError("That cheat doesn't work here.")
            if not game.tainted:
                game.tainted = True
                c.room.system("🛠️ An admin used a cheat, so this game won't count for leaderboards.")
            return {"text": text}
        raise AuthError("Unknown request.")

    async def dash_op(self, c, t, msg):
        """Neon Dash community levels: post (3 a day), browse, like, and the admins' review queue."""
        acc, dl = self.accounts, self.dash_levels

        async def me():
            user = await acc.user_by_id(self.need_login(c))
            if not user or user["banned"]:
                raise AuthError("You need to log in first.")
            return user
        if t == "dash:list":
            if time.time() - c.search_at < 0.25:
                await asyncio.sleep(0.25)
            c.search_at = time.time()
            by = msg.get("by") if isinstance(msg.get("by"), str) else None
            return await dl.browse(str(msg.get("sort") or "new"), msg.get("q"), by, msg.get("offset") or 0, c.account["id"] if c.account else None)
        if t == "dash:get":
            viewer = await acc.user_by_id(c.account["id"]) if c.account else None
            return {"level": await dl.get(level_id(msg.get("id")), viewer)}
        if t == "dash:play":
            return await dl.play(c.person(), level_id(msg.get("id")), c.ip)
        if t == "dash:quota":
            return await dl.quota(await me())
        if t == "dash:mine":
            user = await me()
            return {"levels": await dl.mine(user["id"]), **(await dl.quota(user))}
        if t == "dash:post":
            return await dl.post(await me(), msg.get("level"), msg.get("replay"))
        if t == "dash:delete":
            await dl.delete((await me())["id"], level_id(msg.get("id")))
            return {}
        if t == "dash:like":
            return await dl.like((await me())["id"], level_id(msg.get("id")), msg.get("on") is not False)
        admin = await acc.require_admin(self.need_login(c))
        if t == "dash:queue":
            return await dl.queue(str(msg.get("status") or "pending"))
        if t == "dash:review":
            done = await dl.review(admin, level_id(msg.get("id")), str(msg.get("action") or ""), msg.get("reason"))
            for x in self.clients_of(done["user_id"]):   # a live toast for the creator
                x.send("dash:reviewed", id=done["id"], name=done["name"], status=done["status"], reason=done["reason"])
            return {"id": done["id"], "status": done["status"]}
        raise AuthError("Unknown request.")

    async def plan_op(self, c, t, msg):
        """The update calendar: testers see the rows shared with them, developers and admins change it."""
        acc, pl = self.accounts, self.planner
        if t == "plan:list":
            return await pl.list(await acc.require_role(self.need_login(c), "tester"))
        user = await acc.require_role(self.need_login(c), "developer")
        if acc.limited(f"plan:{user['id']}", 120, 60):
            raise AuthError("Slow down a little. 🐢")
        acc.hit(f"plan:{user['id']}")
        if t == "plan:save":
            pid = await pl.save(user, msg.get("item") if isinstance(msg.get("item"), dict) else {})
        elif t == "plan:delete":
            pid = await pl.delete(user, msg.get("id"))
        else:
            raise AuthError("Unknown request.")
        for x in list(self.clients):    # open calendars reload (the list request checks who may see what)
            if x.account and x.account.get("role"):
                x.send("plan:changed", id=pid)
        return {"id": pid}

    def to_team(self, t, **data):
        """Send to everyone online with a role (testers, developers, admins)."""
        for x in list(self.clients):
            if x.account and x.account.get("role"):
                x.send(t, **data)

    async def team_op(self, c, t, msg):
        """The calendar team's announcements and group chat (everyone with a role)."""
        acc, pl = self.accounts, self.planner
        user = await acc.require_role(self.need_login(c), "developer" if t == "team:announce" else "tester")
        uid = user["id"]
        if t == "team:get":
            return await pl.team(user)
        if t == "team:say":
            if acc.limited(f"tchat:{uid}", 8, 10):
                raise AuthError("Slow down a little. 🐢")
            acc.hit(f"tchat:{uid}")
            m = await pl.say(user, msg.get("text"))
            self.to_team("team:msg", msg=m)
            return {"msg": m}
        if t == "team:announce":
            if acc.limited(f"tnews:{uid}", 10, 3600):
                raise AuthError("That's a lot of announcements. Try again later.")
            acc.hit(f"tnews:{uid}")
            n = await pl.announce(user, msg.get("text"))
            self.to_team("team:news", news=n)
            return {"news": n}
        if t in ("team:unsay", "team:unannounce"):
            table = "team_chat" if t == "team:unsay" else "team_news"
            pid = await pl.unpost(user, table, msg.get("id"))
            self.to_team("team:gone", kind="msg" if t == "team:unsay" else "news", id=pid)
            return {"id": pid}
        raise AuthError("Unknown request.")

    # -- housekeeping ----------------------------------------------------
    async def janitor(self):
        last_ping = 0.0
        while True:
            await asyncio.sleep(5)
            now = time.time()
            # drop connections that stopped answering (closed laptop, lost Wi-Fi...)
            ping = now - last_ping >= PING_EVERY
            if ping:
                last_ping = now
            for c in list(self.clients):
                if now - c.heard > DEAD_AFTER:
                    c.close()
                elif ping:
                    c.ping()
            for code, room in list(self.rooms.items()):
                for uid, m in list(room.members.items()):
                    grace = getattr(room.game, "offline_grace", OFFLINE_GRACE)
                    if not m.online and m.offline_since and now - m.offline_since > grace:
                        room.remove(uid)
                if (not room.members and not room.waiting) or (room.empty_since and now - room.empty_since > EMPTY_ROOM_TTL):
                    room.close()
                    del self.rooms[code]
            for tid, tour in list(self.tournaments.items()):
                if tour.stale(now):
                    del self.tournaments[tid]
            if self.wyr_dirty:
                self.wyr_dirty = False
                self.save_json("wyr.json", self.wyr)


ACCOUNT_MESSAGES = {
    "dash:post", "dash:quota", "dash:mine", "dash:delete", "dash:get", "dash:list", "dash:like", "dash:play", "dash:queue", "dash:review",
    "auth:signup", "auth:login", "auth:logout", "account:update", "account:look", "account:password", "account:delete",
    "profile:get", "players:find", "lb:boards", "lb:get", "stats:solo", "ghost:get", "ghost:put", "admin:unlock", "admin:overview", "admin:users",
    "admin:user", "admin:announce", "admin:room", "admin:cheat", "plan:list", "plan:save", "plan:delete", "team:get", "team:say", "team:announce", "team:unsay", "team:unannounce", "friends:list", "friends:add", "friends:remove", "friends:invite", "friends:invite-no",
}
GAME_TITLES = {"dash": "Neon Dash", "life": "Family Life", "doodle": "Doodle Guess", "songs": "Song Rush", "volley": "Screen Volley", "blitz": "Party Blitz",
               "connect4": "Connect 4", "casino": "Casino Night", "snake": "Neon Snake", "2048": "2048",
               "memory": "Memory Flip", "dash-solo": "Neon Dash practice", "dashsolo": "Neon Dash practice",
               "impostor": "Impostor", "mines": "Minesweeper", "mines_easy": "Minesweeper (Easy)",
               "mines_medium": "Minesweeper (Medium)", "mines_hard": "Minesweeper (Hard)", "mines-easy": "Minesweeper (Easy)",
               "mines-medium": "Minesweeper (Medium)", "mines-hard": "Minesweeper (Hard)", "slope": "Slope",
               "front": "Front Wars", "prophunt": "Prop Hunt", "poly": "Poly Racer", "poly-1": "Poly Racer · First Lap", "poly1": "Poly Racer · First Lap", "poly-2": "Poly Racer · Hill Climb", "poly2": "Poly Racer · Hill Climb", "poly-3": "Poly Racer · Hairpins", "poly3": "Poly Racer · Hairpins", "poly-4": "Poly Racer · Big Air", "poly4": "Poly Racer · Big Air", "poly-5": "Poly Racer · Sky Highway", "poly5": "Poly Racer · Sky Highway", "poly-6": "Poly Racer · Chaos", "poly6": "Poly Racer · Chaos", "frontsolo": "Front Wars solo", "front-solo": "Front Wars solo", "party": "Party mode",
               "billiards": "Billiards", "pool-speed": "Billiards speed clear", "poolspeed": "Billiards speed clear",
               "pool-cpu": "Billiards vs CPU", "poolcpu": "Billiards vs CPU",
               "flappy": "Neon Flappy",
               "golf": "Mini Golf", "golf-classic": "Mini Golf · Classic Meadow", "golfclassic": "Mini Golf · Classic Meadow",
               "golf-spooky": "Mini Golf · Spooky Hollow", "golfspooky": "Mini Golf · Spooky Hollow",
               "golf-desert": "Mini Golf · Cactus Canyon", "golfdesert": "Mini Golf · Cactus Canyon",
               "golf-frost": "Mini Golf · Frosty Peaks", "golffrost": "Mini Golf · Frosty Peaks",
               "golf-beach": "Mini Golf · Tropical Cove", "golfbeach": "Mini Golf · Tropical Cove",
               "golf-volcano": "Mini Golf · Volcano Isle", "golfvolcano": "Mini Golf · Volcano Isle",
               "eightball": "Magic 8-Ball", "wyr": "Would You Rather", "wheel": "Spin the Wheel", "tour": "Tournament",
               "moto": "Revvd"}
for _t in MOTO_TRACKS:
    GAME_TITLES[f"moto-{_t['id']}"] = GAME_TITLES[f"moto{_t['id']}"] = f"Revvd · {_t['name']}"
for _c in MOTO_CHALLENGES:
    GAME_TITLES[f"mch-{_c['id']}"] = GAME_TITLES[chute_key(_c["id"])] = f"{'Carvvd' if _c.get('board') else 'Unrevvd' if _c.get('vehicle') == 'mtb' else 'Revvd'} · {_c['name']}"
GAME_TITLES["mch-daily"] = GAME_TITLES["mchdaily"] = "Unrevvd · Daily Chute"
GAME_TITLES["mch-cup"] = GAME_TITLES["mchcup"] = "Unrevvd · Downhill World Cup"
GAME_TITLES["mch-weekly"] = GAME_TITLES["mchweekly"] = "Revvd · Weekly Challenge"

hub = Hub()


# --------------------------------------------------------------------------
# HTTP + WebSocket server
# --------------------------------------------------------------------------
def http_response(writer, status, reason, body=b"", ctype="text/plain; charset=utf-8", head_only=False, extra=()):
    headers = [
        f"HTTP/1.1 {status} {reason}",
        f"Content-Type: {ctype}",
        f"Content-Length: {len(body)}",
        "Cache-Control: no-cache",
        "X-Content-Type-Options: nosniff",
        "Connection: close",
        *extra,
        "", "",
    ]
    writer.write("\r\n".join(headers).encode() + (b"" if head_only else body))


async def serve_static(writer, method, path, headers=None):
    if method not in ("GET", "HEAD"):
        http_response(writer, 405, "Method Not Allowed", b"Method not allowed")
        return
    rel = unquote(path).lstrip("/")
    if rel == "" or rel.endswith("/"):
        rel += "index.html"
    target = (PUBLIC / rel).resolve()
    if not target.is_relative_to(PUBLIC):
        http_response(writer, 404, "Not Found", b"Not found")
        return
    if not target.is_file() and not target.suffix and target.with_suffix(".html").is_file():
        target = target.with_suffix(".html")
    if not target.is_file():
        page = PUBLIC / "404.html"
        body = page.read_bytes() if page.is_file() else b"Not found"
        http_response(writer, 404, "Not Found", body, "text/html; charset=utf-8")
        return
    ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/json", "image/svg+xml"):
        ctype += "; charset=utf-8"
    # browsers keep a copy and just ask "has it changed?" next time (304 = no, use yours)
    info = target.stat()
    etag = f'"{info.st_mtime_ns:x}-{info.st_size:x}"'
    sent = [t.strip().removeprefix("W/") for t in (headers or {}).get("if-none-match", "").split(",")]
    if etag in sent or "*" in sent:
        http_response(writer, 304, "Not Modified", b"", ctype, head_only=True, extra=(f"ETag: {etag}",))
        return
    http_response(writer, 200, "OK", target.read_bytes(), ctype, head_only=(method == "HEAD"), extra=(f"ETag: {etag}",))


PRIVATE_IP = re.compile(r"^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)", re.I)


def client_ip(headers, peer):
    """The visitor's address, used for rate limits. Behind a proxy (Render) the proxy
    appends the real address to X-Forwarded-For, so read it from the right and skip
    private proxy hops. Anything further left could be made up by the visitor."""
    hops = [x.strip() for x in headers.get("x-forwarded-for", "").split(",") if x.strip()]
    for ip in reversed(hops):
        if not PRIVATE_IP.match(ip):
            return ip[:64]
    return (hops[-1] if hops else (peer[0] if peer else "?"))[:64]


async def websocket_session(reader, writer, headers):
    key = headers.get("sec-websocket-key")
    if not key:
        http_response(writer, 400, "Bad Request", b"Expected a websocket key")
        return
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
    writer.write((
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
    ).encode())
    await writer.drain()

    client = Client(writer)
    client.ip = client_ip(headers, writer.get_extra_info("peername"))
    hub.clients.add(client)
    parts, size = [], 0
    try:
        while client.open:
            b1, b2 = await reader.readexactly(2)
            fin, opcode = b1 & 0x80, b1 & 0x0F
            masked, n = b2 & 0x80, b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", await reader.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", await reader.readexactly(8))[0]
            if n > MAX_MESSAGE:
                break
            mask = await reader.readexactly(4) if masked else b""
            data = await reader.readexactly(n)
            client.heard = time.time()
            if masked:
                data = unmask(data, mask)

            if opcode == 0x8:          # close
                writer.write(ws_frame(data[:2], 0x8))
                break
            if opcode == 0x9:          # ping
                writer.write(ws_frame(data, 0xA))
                continue
            if opcode == 0xA:          # pong
                continue
            parts.append(data)
            size += n
            if size > MAX_MESSAGE:
                break
            if not fin:
                continue
            raw, parts, size = b"".join(parts), [], 0
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if isinstance(msg, dict):
                try:
                    hub.handle(client, msg)
                except Exception:
                    traceback.print_exc()
    except (asyncio.IncompleteReadError, ConnectionError, OSError):
        pass
    finally:
        client.close()
        hub.disconnect(client)


async def handle_connection(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 20)
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError, OSError):
        writer.close()
        return
    lines = head.decode("latin-1").split("\r\n")
    try:
        method, target, _ = lines[0].split(" ", 2)
    except ValueError:
        writer.close()
        return
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    path = urlsplit(target).path
    try:
        if path == "/ws" and "websocket" in headers.get("upgrade", "").lower():
            await websocket_session(reader, writer, headers)
        elif path == "/api/health":
            await health(writer)
            await writer.drain()
        else:
            await serve_static(writer, method, path, headers)
            await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def health(writer):
    """Small status page used to check the database (and to keep it awake)."""
    acc = hub.accounts
    info = {"ok": True, "storage": acc.store.kind, "accounts": acc.ready, "online": len(hub.clients)}
    try:
        await acc.q("SELECT 1 AS one")
        info["accounts"] = True
    except Exception as e:
        info.update(accounts=False, error=str(e)[:200])
    http_response(writer, 200, "OK", json.dumps(info).encode(), "application/json; charset=utf-8")


def lan_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


async def main():
    asyncio.create_task(hub.janitor())
    try:
        await hub.accounts.init()
        where = "Turso database" if hub.accounts.store.kind == "turso" else hub.accounts.store.where
        print(f"  👤 Accounts are saved in: {where}")
    except Exception as e:
        print(f"  ⚠️  Accounts are offline: {e}")
    server = await asyncio.start_server(handle_connection, HOST, PORT, reuse_address=True)
    lan = lan_address()
    print("\n  🕹️  Party Arcade is running!\n")
    print(f"  On this computer:   http://localhost:{PORT}")
    if lan:
        print(f"  Friends on Wi-Fi:   http://{lan}:{PORT}")
    print("\n  Press Ctrl+C to stop.\n", flush=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, AttributeError, ValueError):
            pass  # Windows: Ctrl+C still stops the server, just without saving rooms
    await stop.wait()
    server.close()
    await hub.shutdown()
    print("\n  Bye! 👋")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Bye! 👋")
