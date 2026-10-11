"""Minesweeper online.

Race:   everyone gets the same board; clear it fastest. Hitting a mine adds a time penalty.
Battle: one shared board; every cell you open is a point. Mines cost points and stun you.

The board lives on the server: clients only ever see the cells they're allowed to see.
Flags are private (each player has their own).
"""
import random
import time
from collections import deque

from .base import Game, num

SIZES = {"small": (9, 9, 10), "medium": (16, 16, 40), "large": (24, 16, 70)}   # columns, rows, mines
PENALTIES = (0, 5, 10, 20)
MINUTES = (3, 5, 10)
HIDDEN, FLAG, MINE_HIT, MINE, WRONG_FLAG = -1, -2, 9, 10, 11
COUNTDOWN = 3
STUN = 3.0
BATTLE_HIT = 10


class Board:
    def __init__(self, cols, rows, mines):
        self.cols, self.rows, self.n = cols, rows, cols * rows
        # a random starting cell away from the edge; its 3x3 area is mine-free so everyone gets an opening
        self.start = random.randrange(1, rows - 1) * cols + random.randrange(1, cols - 1)
        safe = set(self.around(self.start)) | {self.start}
        self.mines = set(random.sample([i for i in range(self.n) if i not in safe], mines))
        self.counts = [sum(1 for j in self.around(i) if j in self.mines) for i in range(self.n)]
        self.safe_total = self.n - mines

    def around(self, i):
        r, c = divmod(i, self.cols)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if (dr or dc) and 0 <= r + dr < self.rows and 0 <= c + dc < self.cols:
                    yield (r + dr) * self.cols + c + dc

    def flood(self, i, opened, flags=()):
        """Open cell i (and spread from empty cells). `opened` is a set or dict; returns the new cells."""
        if i in opened or i in self.mines:
            return []
        new, queue = [], deque([i])
        seen = {i}
        while queue:
            j = queue.popleft()
            if j in opened or j in flags:
                continue
            new.append(j)
            if self.counts[j] == 0:
                for k in self.around(j):
                    if k not in seen and k not in self.mines:
                        seen.add(k)
                        queue.append(k)
        return new


class Minesweeper(Game):
    key = "mines"
    max_players = 8

    def __init__(self, room):
        super().__init__(room)
        self.settings = {"mode": "race", "size": "medium", "penalty": 10, "minutes": 5}
        self.board = None
        self.game_id = 0
        self.order = []          # players in this game
        self.ps = {}             # uid -> per-player state
        self.started = 0.0
        self.timer = None
        self.results = None
        self.mode = "race"
        # battle (shared board)
        self.opened = {}         # cell -> uid who opened it ("" = the free start area)
        self.boom = {}           # cell -> uid who hit the mine

    # ------------------------------------------------------------------ helpers
    def listed(self):
        return self.phase in ("lobby", "over")

    def member(self, uid):
        return self.room.members.get(uid)

    def online(self, uid):
        mm = self.member(uid)
        return bool(mm and mm.online)

    def progress(self, uid):
        b = self.board
        if not b:
            return 0
        if self.mode == "race":
            return len(self.ps[uid]["open"]) / b.safe_total
        return sum(1 for o in self.opened.values() if o == uid) / b.safe_total

    def player_info(self, uid):
        mm = self.member(uid)
        p = self.ps[uid]
        if mm:
            p["look"] = (mm.name, mm.avatar, mm.color)
        name, avatar, color = p["look"]
        info = {"id": uid, "name": name, "avatar": avatar, "color": color, "online": bool(mm and mm.online),
                "hits": len(p["hits"]), "progress": round(self.progress(uid), 4)}
        if self.mode == "race":
            info.update(done=p["done"], time=p["time"], penalty=p["penalty"], place=p["place"])
        else:
            info.update(points=p["points"], cells=sum(1 for o in self.opened.values() if o == uid),
                        stun=round(max(0.0, p["stun"] - time.time()), 2))
        return info

    def view(self, uid):
        """The board as this player sees it (list of cell codes)."""
        b = self.board
        cells = [HIDDEN] * b.n
        over = self.phase == "over"
        p = self.ps.get(uid)
        flags = p["flags"] if p else set()
        for i in flags:
            cells[i] = FLAG
        if self.mode == "race":
            if p:
                for i in p["open"]:
                    cells[i] = b.counts[i]
                for i in p["hits"]:
                    cells[i] = MINE_HIT
        else:
            for i in self.opened:
                cells[i] = b.counts[i]
            for i in self.boom:
                cells[i] = MINE_HIT
        if over:
            for i in b.mines:
                if cells[i] == HIDDEN:
                    cells[i] = MINE
            for i in flags:
                if i not in b.mines:
                    cells[i] = WRONG_FLAG
        return cells

    def state_for(self, m):
        uid = m.uid if m else None
        st = {"phase": self.phase, "settings": self.settings, "results": self.results, "gameId": self.game_id,
              "mode": self.mode, "players": [self.player_info(u) for u in self.order] if self.board else [],
              "spectator": self.board is not None and uid not in self.ps}
        if self.board and self.phase in ("playing", "over"):
            b = self.board
            st.update(cols=b.cols, rows=b.rows, mines=len(b.mines), elapsed=round(time.time() - self.started, 2),
                      limit=self.settings["minutes"] * 60, cells=self.view(uid))
            if self.mode == "battle":
                index = {u: n for n, u in enumerate(self.order)}
                owners = [-1] * b.n
                for i, o in self.opened.items():
                    owners[i] = index.get(o, -1)
                for i, o in self.boom.items():
                    owners[i] = index.get(o, -1)
                st["owners"] = owners
        return st

    def push(self):
        for mm in list(self.room.members.values()):
            mm.send("g:state", state=self.state_for(mm))

    # ------------------------------------------------------------------ messages
    def on_message(self, m, t, msg):
        host = self.is_host(m)
        if t == "settings" and host and self.phase != "playing":
            s = self.settings
            if msg.get("mode") in ("race", "battle"):
                s["mode"] = msg["mode"]
            if msg.get("size") in SIZES:
                s["size"] = msg["size"]
            if "penalty" in msg and int(num(msg["penalty"], -1)) in PENALTIES:
                s["penalty"] = int(msg["penalty"])
            if "minutes" in msg and int(num(msg["minutes"], -1)) in MINUTES:
                s["minutes"] = int(msg["minutes"])
            self.push()
        elif t == "start" and host and self.phase != "playing":
            self.start()
        elif t == "end" and host and self.phase == "playing":
            self.finish()
        elif t in ("reveal", "flag", "chord") and self.phase == "playing" and m.uid in self.ps:
            i = msg.get("i")
            if not isinstance(i, int) or not 0 <= i < self.board.n or time.time() < self.started:
                return
            if t == "flag":
                self.toggle_flag(m.uid, i)
            elif t == "reveal":
                self.reveal(m, i)
            else:
                self.chord(m, i)
            self.after_move()

    # ------------------------------------------------------------------ flow
    def start(self):
        online = [mm.uid for mm in self.room.members.values() if mm.plays]
        if not online:
            return
        self.tainted = False
        self.game_id += 1
        self.mode = self.settings["mode"]
        self.board = Board(*SIZES[self.settings["size"]])
        self.order = online
        self.ps = {u: {"open": set(), "flags": set(), "hits": [], "penalty": 0, "done": False, "time": None,
                       "place": None, "points": 0, "stun": 0.0, "look": ("?", "🙂", "#888888")} for u in online}
        self.opened, self.boom = {}, {}
        start_area = self.board.flood(self.board.start, set())
        if self.mode == "race":
            for p in self.ps.values():
                p["open"] = set(start_area)
        else:
            self.opened = {i: "" for i in start_area}
        self.results = None
        self.phase = "playing"
        self.started = time.time() + COUNTDOWN
        self.room.cancel(self.timer)
        self.timer = self.room.later(COUNTDOWN + self.settings["minutes"] * 60, self.finish)
        self.push()

    def toggle_flag(self, uid, i):
        p = self.ps[uid]
        shown = self.view(uid)[i]
        if shown == FLAG:
            p["flags"].discard(i)
        elif shown == HIDDEN:
            p["flags"].add(i)

    def reveal(self, m, i):
        p = self.ps[m.uid]
        b = self.board
        if i in p["flags"]:
            return
        if self.mode == "race":
            if p["done"] or i in p["open"] or i in p["hits"]:
                return
            if i in b.mines:
                p["hits"].append(i)
                p["penalty"] += self.settings["penalty"]
                m.send("g:boom", i=i, penalty=self.settings["penalty"])
                return
            p["open"].update(b.flood(i, p["open"], p["flags"]))
            if len(p["open"]) >= b.safe_total and not p["done"]:
                p["done"] = True
                p["time"] = round(time.time() - self.started + p["penalty"], 2)
                p["place"] = 1 + sum(1 for q in self.ps.values() if q["done"] and q is not p)
                self.room.system(f"🏁 {m.name} cleared the board in {p['time']:.1f}s! (#{p['place']})")
        else:
            now = time.time()
            if now < p["stun"]:
                return
            if i in self.opened or i in self.boom:
                return
            if i in b.mines:
                self.boom[i] = m.uid
                p["hits"].append(i)
                p["points"] -= BATTLE_HIT
                p["stun"] = now + STUN
                m.send("g:boom", i=i, penalty=BATTLE_HIT, stun=STUN)
                self.room.system(f"💥 {m.name} hit a mine! −{BATTLE_HIT}")
                return
            new = b.flood(i, self.opened, p["flags"])
            for j in new:
                self.opened[j] = m.uid
            p["points"] += len(new)

    def chord(self, m, i):
        """Click a number whose flags are all placed: open the rest of its neighbours."""
        b = self.board
        p = self.ps[m.uid]
        shown = self.view(m.uid)
        if not 1 <= shown[i] <= 8:
            return
        around = list(b.around(i))
        if sum(1 for j in around if j in p["flags"]) != b.counts[i]:
            return
        for j in around:
            if shown[j] == HIDDEN and j not in p["flags"]:
                self.reveal(m, j)

    def after_move(self):
        b = self.board
        if self.mode == "race":
            active = [u for u in self.order if self.online(u)]
            if active and all(self.ps[u]["done"] for u in active):
                self.room.cancel(self.timer)
                self.timer = self.room.later(1.2, self.finish)
        elif len(self.opened) >= b.safe_total:
            self.room.cancel(self.timer)
            self.timer = self.room.later(0.8, self.finish)
        self.push()

    def finish(self):
        if self.phase != "playing":
            return
        self.room.cancel(self.timer)
        self.phase = "over"
        rows = [self.player_info(u) for u in self.order]
        if self.mode == "race":
            rows.sort(key=lambda r: (not r["done"], r["time"] if r["done"] else 0, -r["progress"]))
        else:
            rows.sort(key=lambda r: -r["points"])
        self.results = {"mode": self.mode, "rows": rows}
        self.broadcast("over", results=self.results)
        self.push()
        self.save_results(rows)

    def save_results(self, rows):
        size = self.settings["size"]
        if self.mode == "battle":
            extra = {r["id"]: {"mines.cells": ("add", r["cells"])} for r in rows}
            self.record_ranking(rows, "mines", value="points", extra=extra)
            return
        n = len(rows)
        self.finished([[r["id"]] for r in rows])
        for i, r in enumerate(rows):
            won = n >= 2 and r["done"] and i == 0
            stats = {}
            if won:
                stats["mines.wins"] = ("add", 1)
            if r["done"]:
                stats["mines.cleared"] = ("add", 1)
                stats[f"mines.race_{size}"] = ("min", int(r["time"] * 1000))
                detail = f"#{i + 1} of {n} · {r['time']:.1f}s · {size}" + (f" · {r['hits']}💥" if r["hits"] else "")
            else:
                detail = f"Didn't finish ({round(r['progress'] * 100)}%) · {size}"
            self.record(r["id"], "win" if won else ("loss" if n >= 2 else "play"), stats, detail,
                        xp=40 if won else 20 if r["done"] else 12)

    # ------------------------------------------------------------------ people coming and going
    def on_join(self, m, rejoin):
        self.push()

    def on_offline(self, m):
        if self.phase == "playing":
            self.after_move()

    def on_leave(self, m):
        if self.phase == "playing" and not any(self.online(u) for u in self.order):
            self.finish()
            return
        self.on_offline(m)
        if self.phase != "playing":
            self.push()

    # ------------------------------------------------------------------ admin
    def on_admin(self, m, action, msg):
        if self.phase != "playing" or m.uid not in self.ps:
            return None
        b = self.board
        if action == "mines":
            m.send("g:xray", mines=sorted(b.mines))
            return "💣 X-ray on: you can see every mine."
        if action == "clear":
            p = self.ps[m.uid]
            if self.mode == "race":
                p["open"] = {i for i in range(b.n) if i not in b.mines}
                if not p["done"]:
                    p["done"] = True
                    p["time"] = round(time.time() - self.started + p["penalty"], 2)
                    p["place"] = 1 + sum(1 for q in self.ps.values() if q["done"] and q is not p)
            else:
                for i in range(b.n):
                    if i not in b.mines and i not in self.opened:
                        self.opened[i] = m.uid
                        p["points"] += 1
            self.after_move()
            return "🧹 Board cleared!"
        if action == "end":
            self.finish()
            return "🏁 Game ended."
        return None
