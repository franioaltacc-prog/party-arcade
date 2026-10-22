"""A tiny Chrome DevTools Protocol client (standard library only) for the screenshot tool.
Starts a headless Chrome, opens tabs, runs JavaScript in them and takes screenshots."""
import base64, json, os, socket, struct, subprocess, tempfile, time, urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class Tab:
    def __init__(self, ws_url):
        host, rest = ws_url[len("ws://"):].split("/", 1)
        h, p = host.split(":")
        self.sock = socket.create_connection((h, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        self.extra = buf.split(b"\r\n\r\n", 1)[1]
        self.n = 0

    def _recv(self, n):
        while len(self.extra) < n:
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise ConnectionError("chrome closed the connection")
            self.extra += chunk
        out, self.extra = self.extra[:n], self.extra[n:]
        return out

    def _frame(self):
        b1, b2 = self._recv(2)
        ln = b2 & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", self._recv(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", self._recv(8))[0]
        return b1 & 0x0F, self._recv(ln)

    def _send(self, text):
        data = text.encode()
        head = bytes([0x81])
        ln = len(data)
        if ln < 126:
            head += bytes([0x80 | ln])
        elif ln < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", ln)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", ln)
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(data)))

    def call(self, method, **params):
        self.n += 1
        mid = self.n
        self._send(json.dumps({"id": mid, "method": method, "params": params}))
        msg = b""
        while True:
            op, payload = self._frame()
            msg += payload
            if op == 0:   # continuation
                continue
            try:
                m = json.loads(msg)
            except ValueError:
                continue
            msg = b""
            if m.get("id") == mid:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result", {})

    def js(self, expr, wait=True):
        """Run JavaScript (an expression, awaited if it's a promise) and return its value."""
        r = self.call("Runtime.evaluate", expression=expr, awaitPromise=wait, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(f"JS error: {r['exceptionDetails'].get('exception', {}).get('description') or r['exceptionDetails']}")
        return r.get("result", {}).get("value")

    def goto(self, url, settle=2.0):
        self.call("Page.navigate", url=url)
        time.sleep(settle)

    def shot(self, path, w, h, quality=86, fmt="jpeg", scale=1):
        data = self.call("Page.captureScreenshot", format=fmt, quality=quality, clip={"x": 0, "y": 0, "width": w, "height": h, "scale": scale})["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))

    def close(self):
        try:
            self.call("Page.close")
        except (OSError, RuntimeError, ConnectionError):
            pass
        self.sock.close()


class Chrome:
    def __init__(self, port=9333, w=1280, h=720, headless=True, dpr=1):
        self.port, self.w, self.h, self.dpr = port, w, h, dpr
        self.dir = tempfile.mkdtemp(prefix="pa-shots-")
        args = [CHROME, f"--remote-debugging-port={port}", f"--user-data-dir={self.dir}", f"--window-size={w},{h}",
                "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
                "--enable-webgl", "--ignore-gpu-blocklist", "--hide-scrollbars"]
        if headless:
            args.append("--headless=new")
        self.proc = subprocess.Popen(args + ["about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
                break
            except OSError:
                time.sleep(0.25)

    def tab(self):
        """A new tab (in its own browser context, so it has its own storage: a different player)."""
        ver = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/version").read())
        browser = Tab(ver["webSocketDebuggerUrl"])
        ctx = browser.call("Target.createBrowserContext")["browserContextId"]
        tid = browser.call("Target.createTarget", url="about:blank", browserContextId=ctx, width=self.w, height=self.h)["targetId"]
        t = Tab(f"ws://127.0.0.1:{self.port}/devtools/page/{tid}")
        t.call("Page.enable")
        t.call("Emulation.setDeviceMetricsOverride", width=self.w, height=self.h, deviceScaleFactor=self.dpr, mobile=False)
        return t

    def close(self):
        self.proc.terminate()
