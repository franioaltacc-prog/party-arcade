import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path[:0] = [_HERE, _os.path.dirname(_HERE)]   # tests/ (the bot helpers) and the repo (the game code)
import asyncio, json, os, base64, struct, random, sys, time

PORT = int(os.environ.get("PORT", 8011))

class WS:
    async def connect(self, uid, name):
        self.r, self.w = await asyncio.open_connection("127.0.0.1", PORT)
        key = base64.b64encode(os.urandom(16)).decode()
        self.w.write(f"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        await self.r.readuntil(b"\r\n\r\n")
        self.inbox = asyncio.Queue()
        self.task = asyncio.create_task(self.reader())
        self.send({"t": "hello", "id": uid, "name": name, "avatar": "🤖", "color": "#22d3ee"})
    async def reader(self):
        while True:
            b1, b2 = await self.r.readexactly(2)
            n = b2 & 0x7f
            if n == 126: n = struct.unpack('!H', await self.r.readexactly(2))[0]
            elif n == 127: n = struct.unpack('!Q', await self.r.readexactly(8))[0]
            data = await self.r.readexactly(n)
            op = b1 & 0x0f
            if op == 0x9:   # server ping -> answer with a pong, like a browser does
                mask = os.urandom(4)
                self.w.write(bytes([0x8A, 0x80 | len(data)]) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
                continue
            if op != 0x1:
                continue
            await self.inbox.put(json.loads(data))
    def send(self, obj):
        data = json.dumps(obj).encode(); mask = os.urandom(4); n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack('!H', n))
        self.w.write(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
    async def wait(self, t, timeout=5):
        end = time.time() + timeout
        while True:
            m = await asyncio.wait_for(self.inbox.get(), max(0.01, end - time.time()))
            if m["t"] == t: return m
    def drain(self):
        out = []
        while not self.inbox.empty(): out.append(self.inbox.get_nowait())
        return out

async def life_test():
    a, b, c = WS(), WS(), WS()
    await a.connect("botA00001", "Alpha"); await b.connect("botB00001", "Bravo"); await c.connect("botC00001", "Charlie")
    for x in (a, b, c): await x.wait("welcome")
    a.send({"t": "room:create", "game": "life"})
    j = await a.wait("room:joined"); code = j["code"]
    b.send({"t": "room:join", "code": code, "game": "life"}); await b.wait("room:joined")
    c.send({"t": "room:join", "code": code, "game": "life"}); await c.wait("room:joined")
    a.send({"t": "g:settings", "yearTime": 10})
    a.send({"t": "g:start"})
    bots = {"A": a, "B": b, "C": c}
    me = {}
    errors = []
    over = None
    years = 0
    t0 = time.time()
    while over is None and time.time() - t0 < 400:
        await asyncio.sleep(0.05)
        for k, ws in bots.items():
            for m in ws.drain():
                if m["t"] == "g:me": me[k] = m["me"]
                elif m["t"] == "g:over": over = m
                elif m["t"] == "g:year" and k == "A": years += 1
                elif m["t"] == "error": errors.append(m)
        for k, ws in bots.items():
            p = me.get(k)
            if not p or not p["alive"] or p["ready"]: continue
            for off in p["offers"]:
                ws.send({"t": "g:respond", "from": off["from"], "accept": random.random() < 0.7})
            if p["event"]:
                ws.send({"t": "g:choose", "i": random.randrange(len(p["event"]["choices"]))}); p["event"] = None; continue
            acts = [x for x in p["actions"] if not x["client"]]
            if p["actionsLeft"] > 0 and acts:
                act = random.choice(acts)
                msg = {"t": "g:act", "a": act["id"]}
                if act["target"]:
                    others = [o for o in me.values() if o["id"] != p["id"] and o["alive"]]
                    if not others: continue
                    msg["target"] = random.choice(others)["id"]
                if any(x["client"] == "jobs" for x in p["actions"]) and random.random() < 0.3:
                    okjobs = [j for j in p["jobs"] if j["ok"]]
                    if okjobs: msg = {"t": "g:act", "a": "apply", "job": random.choice(okjobs)["key"]}
                ws.send(msg); p["actionsLeft"] -= 1
            else:
                ws.send({"t": "g:ready"}); p["ready"] = True
    print("years:", years, "errors:", errors)
    if over:
        for r in over["ranking"]:
            print(r["player"], r["name"], "age", r["age"], r["cause"], "score", r["score"]["total"], "|", r["summary"], r["achievements"])
    else:
        print("NOT OVER", {k: (v["age"], v["alive"]) for k, v in me.items()})

async def misc_test():
    a, b = WS(), WS()
    await a.connect("botD00001", "Delta"); await b.connect("botE00001", "Echo")
    for x in (a, b): await x.wait("welcome")
    # connect4
    a.send({"t": "room:create", "game": "connect4"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"], "game": "connect4"}); await b.wait("room:joined")
    st = await a.wait("g:state")
    for col in [0, 1, 0, 1, 0, 1, 0]:
        mover = a if st["seats"][st["turn"]] == "botD00001" else b
        mover.send({"t": "g:drop", "col": col}); st = await a.wait("g:state")
    print("c4 phase", st["phase"], "winner", st["winner"], st["winCells"])
    # blitz
    a.send({"t": "room:create", "game": "blitz"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"]}); await b.wait("room:joined")
    a.send({"t": "g:settings", "rounds": 3}); a.send({"t": "g:start"})
    for _ in range(3):
        r = (await a.wait("g:round", 8))["round"]
        for ws in (a, b):
            ws.send({"t": "g:answer", "n": r["n"], "ms": random.randint(200, 900), "value": 5})
        res = await a.wait("g:roundResult", 25)
        print("blitz", r["kind"], [(x["ok"], x["points"]) for x in res["results"]])
    fin = await a.wait("g:final", 10); print("blitz final", [(x["name"], x["points"]) for x in fin["ranking"]])
    # doodle
    a.send({"t": "room:create", "game": "doodle"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"]}); await b.wait("room:joined")
    a.send({"t": "g:settings", "rounds": 1, "drawTime": 30}); a.send({"t": "g:start"})
    drawer_ws = None; words = None
    for ws in (a, b):
        try:
            words = (await ws.wait("g:choose", 2))["words"]; drawer_ws = ws
        except asyncio.TimeoutError: pass
    guesser = b if drawer_ws is a else a
    drawer_ws.send({"t": "g:pick", "i": 0})
    drawer_ws.send({"t": "g:draw", "segs": [[10, 10, 200, 200, 3, 8, 1]]})
    d = await guesser.wait("g:draw"); print("doodle relay ok", d["segs"])
    guesser.send({"t": "g:guess", "text": words[0][:-1] + "x" if len(words[0]) > 2 else "zz"})
    guesser.send({"t": "g:guess", "text": words[0]})
    cor = await guesser.wait("g:correct"); print("doodle correct", cor["points"])
    rev = await guesser.wait("g:reveal"); print("doodle reveal", rev["word"])
    # dash
    a.send({"t": "room:create", "game": "dash"}); j = await a.wait("room:joined")
    b.send({"t": "room:join", "code": j["code"]}); await b.wait("room:joined")
    a.send({"t": "g:start"}); s = await b.wait("g:start"); print("dash seed", s["race"]["seed"])
    a.send({"t": "g:pos", "x": 5, "y": 1, "r": 90, "p": 0.1, "a": 1}); pos = await b.wait("g:pos"); print("dash pos", pos)
    a.send({"t": "g:finish", "time": 30000, "attempts": 3}); await b.wait("g:hurry")
    b.send({"t": "g:finish", "time": 35000, "attempts": 5}); res = await a.wait("g:results", 5)
    print("dash results", [(r["name"], r["place"], r["time"]) for r in res["results"]])
    a.send({"t": "rooms:list"}); print("rooms", (await a.wait("rooms:list"))["rooms"])

if __name__ == "__main__":
    asyncio.run(misc_test() if "misc" in sys.argv else life_test())
