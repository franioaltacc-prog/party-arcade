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
import socket
import struct
import time
import traceback
from pathlib import Path
from urllib.parse import unquote, urlsplit

from games import GAMES

ROOT = Path(__file__).resolve().parent
PUBLIC = (ROOT / "public").resolve()
DATA = ROOT / "data"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 1 << 20          # 1 MB per websocket message
OFFLINE_GRACE = 40             # seconds a disconnected player keeps their seat
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

    @property
    def online(self):
        return self.client is not None

    def send(self, t, **data):
        if self.client:
            self.client.send(t, **data)

    def info(self):
        return {"id": self.uid, "name": self.name, "avatar": self.avatar,
                "color": self.color, "online": self.online}


class Room:
    def __init__(self, hub, game_key):
        self.hub = hub
        self.code = hub.new_code()
        self.game_key = game_key
        self.members = {}
        self.host = None
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
        if self.host not in self.members:
            self.host = client.uid
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
        return {"count": len(self.clients), "games": games}

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
            self.set_profile(c, msg)
            c.send("welcome", id=c.uid, online=self.online_payload())
            self.online_changed()
            return
        if c.uid is None:
            return

        if t == "ping":
            c.send("pong", ts=msg.get("ts"))
        elif t == "profile":
            self.set_profile(c, msg)
            if c.room and c.uid in c.room.members:
                c.room.members[c.uid].copy_profile(c)
                c.room.sync_players()
        elif t == "room:create":
            game = msg.get("game")
            if game in GAMES:
                self.join(c, self.create_room(game))
        elif t == "room:join":
            code = clean_text(msg.get("code"), 8).upper()
            room = self.rooms.get(code)
            if not room:
                c.send("error", msg=f"No room with code {code or '????'} 🤔", code="noroom")
            elif msg.get("game") and msg.get("game") != room.game_key:
                c.send("error", msg="That code is for a different game", code="wronggame",
                       game=room.game_key, room=room.code)
            else:
                self.join(c, room)
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
            room = self.rooms.get(code)
            c.send("room:found", code=code, game=room.game_key if room else None)
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

    # -- housekeeping ----------------------------------------------------
    async def janitor(self):
        while True:
            await asyncio.sleep(5)
            now = time.time()
            for code, room in list(self.rooms.items()):
                for uid, m in list(room.members.items()):
                    grace = getattr(room.game, "offline_grace", OFFLINE_GRACE)
                    if not m.online and m.offline_since and now - m.offline_since > grace:
                        room.remove(uid)
                if not room.members or (room.empty_since and now - room.empty_since > EMPTY_ROOM_TTL):
                    room.close()
                    del self.rooms[code]
            if self.wyr_dirty:
                self.wyr_dirty = False
                self.save_json("wyr.json", self.wyr)


hub = Hub()


# --------------------------------------------------------------------------
# HTTP + WebSocket server
# --------------------------------------------------------------------------
def http_response(writer, status, reason, body=b"", ctype="text/plain; charset=utf-8", head_only=False):
    headers = [
        f"HTTP/1.1 {status} {reason}",
        f"Content-Type: {ctype}",
        f"Content-Length: {len(body)}",
        "Cache-Control: no-cache",
        "X-Content-Type-Options: nosniff",
        "Connection: close",
        "", "",
    ]
    writer.write("\r\n".join(headers).encode() + (b"" if head_only else body))


async def serve_static(writer, method, path):
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
    http_response(writer, 200, "OK", target.read_bytes(), ctype, head_only=(method == "HEAD"))


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
        else:
            await serve_static(writer, method, path)
            await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


def lan_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


async def main():
    asyncio.create_task(hub.janitor())
    server = await asyncio.start_server(handle_connection, HOST, PORT, reuse_address=True)
    lan = lan_address()
    print("\n  🕹️  Party Arcade is running!\n")
    print(f"  On this computer:   http://localhost:{PORT}")
    if lan:
        print(f"  Friends on Wi-Fi:   http://{lan}:{PORT}")
    print("\n  Press Ctrl+C to stop.\n", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Bye! 👋")
