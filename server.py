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

from accounts import Accounts, AuthError, StoreError, level_info
from games import GAMES

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
        self.account = None     # {"id", "name", "admin"} when logged in
        self.device = None      # one id per browser, shared by its tabs
        self.heard = time.time()
        self.ip = "?"
        self.solo_at = 0.0
        self.search_at = 0.0

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
        return {"id": self.uid, "name": self.name, "avatar": self.avatar, "color": self.color}


class Member:
    """A player's seat in a room. Survives short disconnects (page refresh)."""

    def __init__(self, client):
        self.uid = client.uid
        self.client = client
        self.offline_since = None
        self.copy_profile(client)

    def copy_profile(self, client):
        self.name, self.avatar, self.color = client.name, client.avatar, client.color
        self.account = client.account

    @property
    def online(self):
        return self.client is not None

    def send(self, t, **data):
        if self.client:
            self.client.send(t, **data)

    def info(self):
        acct = self.account
        return {"id": self.uid, "name": self.name, "avatar": self.avatar,
                "color": self.color, "online": self.online,
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
    def add(self, client):
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
            self.members[client.uid] = member
        client.room = self
        self.empty_since = None
        self.waiting = False
        if self.host not in self.members:
            self.host = client.uid
        if client.uid == self.prev_host:
            self.host, self.prev_host = client.uid, None
        self.pick_host()
        client.send("room:joined", code=self.code, game=self.game_key, me=client.uid,
                    host=self.host, players=self.players(), state=self.game.state_for(member))
        self.sync_players()
        if not rejoin:
            self.system(f"{member.avatar} {member.name} joined the room")
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
        self.tasks = set()
        self.started = time.time()
        self.restoring = {}     # room code -> task looking it up in saved rooms
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
        out = []
        for r in self.rooms.values():
            online = r.online_members()
            if online and r.game.listed():
                host = r.members.get(r.host)
                out.append({"code": r.code, "game": r.game_key, "players": len(online),
                            "max": r.game.max_players, "host": host.name if host else "?",
                            "hostAvatar": host.avatar if host else "🎮"})
        out.sort(key=lambda x: -x["players"])
        return out[:30]

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
        room.waiting = True
        self.rooms[code] = room

    async def join_saved(self, c, code, game):
        await self.restore_room(code)
        if c.open:
            self.join_code(c, code, game)

    async def find_saved(self, c, code):
        await self.restore_room(code)
        room = self.rooms.get(code)
        c.send("room:found", code=code, game=room.game_key if room else None)

    def join_code(self, c, code, game):
        room = self.rooms.get(code)
        if not room:
            c.send("error", msg=f"No room with code {code or '????'} 🤔", code="noroom")
        elif game and game != room.game_key:
            c.send("error", msg="That code is for a different game", code="wronggame",
                   game=room.game_key, room=room.code)
        else:
            self.join(c, room)

    async def shutdown(self):
        """Render (or Ctrl+C) is stopping this server: warn everyone and save the rooms
        so the next server can bring them back when players reconnect."""
        if self.closing:
            return
        self.closing = True
        for c in list(self.clients):
            c.send("server:restart")
        rooms = [(r.code, r.game_key, r.host, r.banned) for r in self.rooms.values() if r.members]
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

    def join(self, c, room):
        if c.room is not None and c.room is not room:
            c.room.remove(c.uid)
        if c.uid in room.banned:
            c.send("error", msg="You were removed from that room. 🚫")
            return
        if c.uid not in room.members and len(room.members) >= room.game.max_players:
            c.send("error", msg="That room is full!")
            return
        room.add(c)

    def disconnect(self, c):
        self.clients.discard(c)
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
                self.join(c, self.create_room(game))
        elif t == "room:join":
            code = clean_text(msg.get("code"), 8).upper()
            if code in self.rooms:
                self.join_code(c, code, msg.get("game"))
            else:
                self.spawn(self.join_saved(c, code, msg.get("game")))
        elif t == "room:quick":
            game = msg.get("game")
            if game not in GAMES:
                return
            options = [r for r in self.rooms.values()
                       if r.game_key == game and r.online_members() and r.game.listed()
                       and len(r.members) < r.game.max_players and r is not c.room]
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
            c.send("rooms:list", rooms=self.room_list())
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
                c.room.game.on_message(member, t[2:], msg)

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

    def clients_of(self, user_id):
        return [c for c in list(self.clients) if c.account and c.account["id"] == user_id]

    def attach(self, c, user):
        """Log this connection in as `user` (a row from the users table)."""
        c.account = {"id": user["id"], "name": user["name"], "admin": bool(user["admin"])}
        c.name, c.avatar, c.color = user["name"], user["avatar"], user["color"]
        self.refresh_member(c)

    def detach(self, c):
        c.account = None
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
            c.send("auth:state", user=self.accounts.public(user))
        else:
            c.send("auth:state", user=None, expired=True)

    def record(self, room, uid, game, outcome, stats=None, detail="", xp=None):
        """Save a finished game for a player if they are logged in."""
        member = room.members.get(uid)
        acct = member.account if member else None
        if acct:
            self.spawn(self._record(room, uid, acct, game, outcome, stats, detail, xp))

    async def _record(self, room, uid, acct, game, outcome, stats, detail, xp):
        try:
            gained, before, after = await self.accounts.record(acct["id"], game, outcome, stats, detail, xp)
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

    def need_login(self, c):
        if not c.account:
            raise AuthError("You need to log in first.")
        return c.account["id"]

    async def account_op(self, c, t, msg):
        acc = self.accounts
        if t == "auth:signup":
            user, token = await acc.signup(msg.get("name"), msg.get("password"), msg.get("avatar"), msg.get("color"), c.ip)
            self.attach(c, user)
            return {"token": token, "user": acc.public(user)}
        if t == "auth:login":
            user, token = await acc.login(msg.get("name"), msg.get("password"), c.ip)
            self.attach(c, user)
            return {"token": token, "user": acc.public(user)}
        if t == "auth:logout":
            await acc.logout(msg.get("token"))
            self.detach(c)
            return {}
        if t == "account:update":
            user = await acc.update_look(self.need_login(c), msg.get("avatar"), msg.get("color"), msg.get("bio"))
            for other in self.clients_of(user["id"]):
                self.attach(other, user)
            return {"user": acc.public(user)}
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
        if t == "stats:solo":
            uid = self.need_login(c)
            if time.time() - c.solo_at < 4:
                raise AuthError("Slow down a little 🙂")
            c.solo_at = time.time()
            game = str(msg.get("game") or "")
            value = msg.get("value")
            if not isinstance(value, (int, float)) or value != value:
                raise AuthError("Bad score.")
            result = await acc.solo(uid, game, value)
            self.tell_xp(uid, result["gained"], result["before"], result["after"], GAME_TITLES.get(game, game))
            return result
        if t == "admin:unlock":
            user = await acc.unlock_admin(self.need_login(c), msg.get("code"))
            for other in self.clients_of(user["id"]):
                self.attach(other, user)
                other.send("auth:state", user=acc.public(user))
            return {"user": acc.public(user)}

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
                    other.send("auth:state", user=acc.public(user))
            return {"user": acc.public(user) if user else None}
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
            if self.wyr_dirty:
                self.wyr_dirty = False
                self.save_json("wyr.json", self.wyr)


ACCOUNT_MESSAGES = {
    "auth:signup", "auth:login", "auth:logout", "account:update", "account:password", "account:delete",
    "profile:get", "players:find", "lb:boards", "lb:get", "stats:solo", "admin:unlock", "admin:overview", "admin:users",
    "admin:user", "admin:announce", "admin:room", "admin:cheat",
}
GAME_TITLES = {"dash": "Neon Dash", "life": "Family Life", "doodle": "Doodle Guess", "blitz": "Party Blitz",
               "connect4": "Connect 4", "casino": "Casino Night", "snake": "Neon Snake", "2048": "2048",
               "memory": "Memory Flip", "dash-solo": "Neon Dash practice", "dashsolo": "Neon Dash practice",
               "impostor": "Impostor", "mines": "Minesweeper", "mines_easy": "Minesweeper (Easy)",
               "mines_medium": "Minesweeper (Medium)", "mines_hard": "Minesweeper (Hard)", "mines-easy": "Minesweeper (Easy)",
               "mines-medium": "Minesweeper (Medium)", "mines-hard": "Minesweeper (Hard)", "slope": "Slope"}

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
