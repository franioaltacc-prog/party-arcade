"""Takes the in-game pictures for the home page (public/assets/shots/<game>.webp and <game>-sm.webp) from the
games themselves, in a headless Chrome, with the local server running (python3 server.py).
Each game has a recipe below that gets it to a good moment (a jump, a full board, a round in play). Games that
need more players open more tabs (each its own player) and join the room by its code.
Run: python3 tools/game_shots.py              (every game)
     python3 tools/game_shots.py golf moto    (just these)"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Chrome

BASE = "http://localhost:8000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "shots")
W, H = 960, 540   # (a smallish window drawn at 4/3 scale: 1280×720 pictures where the game fills the frame)
DPR = 4 / 3

# put on every page before it runs: helpers to click things by their text, and to hide the site's top bar,
# toasts and banners so the picture is just the game
HELPERS = r"""
window.__s = {
  find(text, sel) {
    const els = [...document.querySelectorAll(sel || 'button, a, [role=button], .btn, label')]
      .filter((e) => e.offsetParent !== null && !e.disabled && e.textContent.replace(/\s+/g, ' ').trim().toLowerCase().includes(text.toLowerCase()));
    return els[0] || null;
  },
  click(text, sel) { const e = this.find(text, sel); if (!e) throw new Error('nothing says ' + text); e.click(); return true; },
  tap(el) { const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); el.dispatchEvent(new MouseEvent('click', o)); },
  clean() {
    if (document.getElementById('__s_css')) return;
    const s = document.createElement('style'); s.id = '__s_css';
    s.textContent = '.topbar, .news-wrap, .event-banner, #toasts, .toasts, .toast, .room-dock, .party-card, .room-vote { display: none !important; } * { cursor: none !important; } ::-webkit-scrollbar { display: none; }';
    document.head.appendChild(s);
  },
};
"""


def sleep(s):
    time.sleep(s)


def key(t, code, down=True, keyname=None):
    k = keyname or {"ArrowUp": "ArrowUp", "ArrowDown": "ArrowDown", "ArrowLeft": "ArrowLeft", "ArrowRight": "ArrowRight", "Space": " "}.get(code, code[-1].lower() if code.startswith("Key") else code)
    t.call("Input.dispatchKeyEvent", type="keyDown" if down else "keyUp", code=code, key=k, windowsVirtualKeyCode={"ArrowUp": 38, "ArrowDown": 40, "ArrowLeft": 37, "ArrowRight": 39, "Space": 32, "Enter": 13}.get(code, ord(k.upper()) if len(k) == 1 else 0))


def press(t, code, hold=0.06):
    key(t, code, True); sleep(hold); key(t, code, False)


def mouse(t, x, y, kind="click"):
    if kind in ("click", "down"):
        t.call("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
    if kind in ("click", "up"):
        t.call("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)
    if kind == "move":
        t.call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)


TABS = []


def new_player(c, name):
    t = c.tab()
    TABS.append(t)
    t.call("Page.addScriptToEvaluateOnNewDocument", source=HELPERS)
    t.goto(BASE + "/", 1.2)
    t.js("localStorage.setItem('pa_profile', JSON.stringify(%s)); localStorage.setItem('pa_settings', JSON.stringify({sfx:0,music:0,motion:'full'})); 1"
         % {"Franio": "{name:'Franio',avatar:'🦊',color:'#ff5fb8'}", "Maja": "{name:'Maja',avatar:'🐼',color:'#38bdf8'}",
            "Leo": "{name:'Leo',avatar:'🦁',color:'#facc15'}", "Zoe": "{name:'Zoe',avatar:'🐸',color:'#4ade80'}"}.get(name, "{name:'%s',avatar:'🐱',color:'#a78bfa'}" % name))
    return t


def until(t, expr, timeout=20):
    """Wait until a JavaScript expression is true on the page."""
    for _ in range(int(timeout / 0.25)):
        try:
            if t.js(expr):
                return True
        except RuntimeError:
            pass
        sleep(0.25)
    raise RuntimeError("timed out waiting for " + expr)


def room_of(t):
    for _ in range(40):
        code = t.js("window.Room && Room.code || null")
        if code:
            return code
        sleep(0.25)
    raise RuntimeError("no room code")


# ---------------------------------------------------------------- recipes: each gets the game to a good moment
def r_golf(c, t):
    t.goto(BASE + "/games/golf?solo=1&course=classic", 5)
    t.js("__s.clean()"); sleep(2)


def r_moto(c, t):
    t.goto(BASE + "/games/moto?free=1&world=magmaisle", 3)
    until(t, "!!(window.__moto && __moto.R.T && __moto.R.T.terrain && __moto.R.running)", 40)
    t.js("""(async () => { for (let i = 0; i < 60 && !(window.__moto && __moto.R.T && __moto.R.T.terrain && __moto.R.running); i++) await new Promise(r => setTimeout(r, 300));
      const M = __moto, g = M.R.T.terrain.gaps[0];
      M.C.respawn(M.R.T, M.R.bike, 0, { position: g.retry.position, heading: g.retry.heading }); M.R.bike.hold = 0;
      for (let i = 0; i < 400; i++) { M.advance(0.05, () => ({ gas: 1, brake: 0, lean: 0, steer: 0, nitro: false })); const b = M.R.bike; if ((b.px - g.x) * g.s + (b.pz - g.z) * g.c > g.gap * 0.32) break; }
      const cv = M.renderer.domElement; document.querySelectorAll('body *').forEach(e => { if (e !== cv && !e.contains(cv)) e.style.visibility = 'hidden'; });   // (just the picture)
      M.advance(0.01, () => ({ gas: 1, brake: 0, lean: 0, steer: 0 }));
      // a film camera off to the side and ahead, looking back at the bike over the lava
      const T3 = await import('three'), root = M.R.model.root; root.updateMatrixWorld(true);
      const cam = M.camera.clone(); cam.fov = 42; cam.aspect = innerWidth / innerHeight;
      const mid = new T3.Vector3(g.x + g.s * g.gap * 0.5, g.level, g.z + g.c * g.gap * 0.5), side = new T3.Vector3(g.c, 0, -g.s), fwd = new T3.Vector3(g.s, 0, g.c);
      const eye = mid.clone().addScaledVector(side, 21).addScaledVector(fwd, -9).add(new T3.Vector3(0, 8, 0)), look = root.position.clone().addScaledVector(fwd, 5).add(new T3.Vector3(0, -3.2, 0));
      cam.position.copy(eye); cam.lookAt(look); cam.clearViewOffset(); cam.updateProjectionMatrix();
      M.world.update(root.position, 0.016, cam); M.renderer.render(M.world.scene, cam); return 1; })()""")
    sleep(0.3)


def r_poly(c, t):
    t.goto(BASE + "/games/poly?solo=1", 4)
    t.js("__s.clean(); __poly.startSolo(__poly.trackById ? (__poly.trackById('chaos') || __poly.trackById('hairpins')) : undefined); 1")
    sleep(5)
    key(t, "ArrowUp"); sleep(4.5)
    # just the 3D view, drawn at 16:9 by the game's own picture hook (no timer or buttons)
    t.js("(() => { const img = new Image(); img.src = __poly.snap(1280, 720); Object.assign(img.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: 99999, objectFit: 'cover' }); document.body.appendChild(img); return 1; })()")
    sleep(0.6)


def r_slope(c, t):
    t.goto(BASE + "/games/slope", 3)
    t.js("__s.clean(); __s.click('Play'); 1"); sleep(4)


def r_flappy(c, t):
    t.goto(BASE + "/games/flappy?solo=1", 4)
    t.js("__s.clean(); 1")
    for i in range(14):
        press(t, "Space"); sleep(0.42)


def r_dash(c, t):
    t.goto(BASE + "/games/dash?solo=1", 3)
    t.js("__s.clean(); __s.click('Play'); 1"); sleep(0.3)
    t.js("__dashGame().god = true; 1")   # (it can't crash, so it's mid-run in the picture)
    key(t, "Space"); sleep(2.6)


def r_front(c, t):
    t.goto(BASE + "/games/front?solo=1", 3)
    t.js("__s.clean(); __s.click('Start the war'); 1"); sleep(3)
    t.js("(() => { const F = __front; for (let i = 0; i < 400; i++) F.step([], true); return 1; })()"); sleep(1.5)


def r_billiards(c, t):
    t.goto(BASE + "/games/billiards?solo=1", 3)
    t.js("__s.clean(); __s.click('Play the CPU'); 1"); sleep(4)


def r_mines(c, t):
    t.goto(BASE + "/games/mines?solo=1", 3)
    t.js("__s.clean(); 1")
    for i in [130]:   # (the first click is always safe and opens up a patch)
        r = t.js(f"(() => {{ const c = document.querySelectorAll('.ms-cell')[{i}]; if (!c || !c.classList.contains('h')) return null; const b = c.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }})()")
        if r:
            mouse(t, r[0], r[1]); sleep(0.35)
    sleep(0.8)


def r_2048(c, t):
    t.goto(BASE + "/games/2048", 2)
    t.js("__s.clean(); 1")
    import random
    rnd = random.Random(7)
    for i in range(140):
        press(t, rnd.choice(["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "ArrowLeft", "ArrowDown"]), 0.02); sleep(0.07)
    sleep(0.6)


def r_memory(c, t):
    t.goto(BASE + "/games/memory", 2)
    t.js("""(() => { __s.clean(); const cards = [...document.querySelectorAll('.card, .mem-card, button.flip, .tile')].filter(e => e.offsetParent); [0, 5, 9].forEach(i => cards[i] && cards[i].click()); return cards.length; })()""")
    sleep(0.8)


def r_snake(c, t):
    t.goto(BASE + "/games/snake", 2)
    t.js("__s.clean(); __s.click('Play'); 1"); sleep(0.4)
    press(t, "Space"); sleep(0.3)   # (pause, then lay out a long snake winding across the board)
    t.js("""(() => { const b = []; let x = 14, y = 5; const path = [[-1,0,8],[0,1,3],[1,0,9],[0,1,3],[-1,0,7]];
      b.push({ x, y }); for (const [dx, dy, n] of path) for (let i = 0; i < n; i++) { x += dx; y += dy; b.push({ x, y }); }
      __snake.set(b, { x: -1, y: 0 }, { x: 4, y: 15 }, 290); document.getElementById('ov').classList.add('hidden'); return b.length; })()""")
    sleep(0.4)


def r_wheel(c, t):
    t.goto(BASE + "/games/wheel", 2)
    t.js("__s.clean(); __s.click('Spin'); 1"); sleep(1.1)


def r_wyr(c, t):
    t.goto(BASE + "/games/wyr", 2.5)
    t.js("__s.clean(); (document.querySelector('.wyr-opt, .opt, .choice, button.side') || __s.find('Talk')).click(); 1"); sleep(1.2)


def r_eightball(c, t):
    t.goto(BASE + "/games/eightball", 2)
    t.js("__s.clean(); const i = document.querySelector('input, textarea'); if (i) { i.value = 'Will we win tonight?'; i.dispatchEvent(new Event('input', { bubbles: true })); } (__s.find('Shake') || __s.find('Ask') || document.querySelector('.ball, canvas')).click(); 1")
    sleep(3)


def r_volley(c, t):
    t.goto(BASE + "/games/volley", 3)
    t.js("__s.clean(); __s.click('Practice against the robot'); 1"); sleep(1)
    t.js("__s.click('Medium'); 1"); sleep(2.2)


def host(c, t, game, guests=(), settle=2.5):
    """Make a room in t and bring guests (each a new tab: their own player) into it. Returns the guest tabs."""
    t.goto(f"{BASE}/games/{game}", settle)
    until(t, "!!(window.__s && __s.find('Create a room'))")
    t.js("__s.clean(); __s.click('Create a room'); 1")
    code = room_of(t)
    tabs = []
    for name in guests:
        g = new_player(c, name)
        g.goto(f"{BASE}/games/{game}?room={code}", settle)
        g.js("__s.clean(); 1")
        tabs.append(g)
    sleep(1)
    t.js("__s.clean(); 1")
    return tabs


def r_songs(c, t):
    gs = host(c, t, "songs", ["Maja", "Leo"])
    t.js("__s.click('Start the music'); 1"); sleep(9)


def r_life(c, t):
    gs = host(c, t, "life", ["Maja"])
    for x in [t] + gs:
        x.js("__s.click('ready'); 1"); sleep(0.5)
    until(t, "!!__s.find('kids are born')")
    t.js("__s.click('kids are born'); 1"); sleep(5)


def r_impostor(c, t):
    gs = host(c, t, "impostor", ["Maja", "Leo", "Zoe"])
    t.js("__s.click('Start the game'); 1"); sleep(4)


def r_blitz(c, t):
    gs = host(c, t, "blitz", ["Maja"])
    t.js("__s.click('Start the Blitz'); 1"); sleep(7)


def r_casino(c, t):
    gs = host(c, t, "casino", ["Maja"])
    t.js("__s.click('Start the match'); 1"); sleep(4)


def r_prophunt(c, t):
    gs = host(c, t, "prophunt", ["Maja", "Leo"])
    t.js("__s.click('Start the hunt'); 1"); sleep(5)
    return next((x for x in [t] + gs if x.js("window.__ph && __ph.me.role === 'hider'")), t)   # (the hunter's eyes are shut)


def r_connect4(c, t):
    gs = host(c, t, "connect4", ["Maja"])
    sleep(1.5)
    for col in [3, 3, 4, 2, 4, 4, 2, 5, 1, 2, 5]:
        for who in [t] + gs:   # (only the player whose turn it is can drop)
            if who.js(f"(() => {{ const c = document.querySelectorAll('.c4col')[{col}]; if (!c || !c.classList.contains('can')) return false; c.click(); return true; }})()"):
                break
        sleep(0.8)
    sleep(1)


def r_doodle(c, t):
    gs = host(c, t, "doodle", ["Maja", "Leo"])
    t.js("__s.click('Start game'); 1"); sleep(3)
    # whoever is drawing picks a word and draws a little house; the picture is taken from someone guessing
    tabs = [t] + gs
    drawer = None
    for x in tabs:
        if x.js("!!(__s.find('', '.word-choice button, .words button, .pick-word button'))"):
            x.js("document.querySelector('.word-choice button, .words button, .pick-word button').click(); 1"); drawer = x
    sleep(1.5)
    drawer = drawer or tabs[0]
    box = drawer.js("(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
    x0, y0, w, h = box
    strokes = [[(.3, .75), (.3, .45), (.5, .25), (.7, .45), (.7, .75), (.3, .75)], [(.45, .75), (.45, .58), (.55, .58), (.55, .75)], [(.78, .2), (.83, .15), (.88, .2), (.83, .25), (.78, .2)]]
    for st in strokes:
        pts = [(x0 + w * a, y0 + h * b) for a, b in st]
        drawer.call("Input.dispatchMouseEvent", type="mousePressed", x=pts[0][0], y=pts[0][1], button="left", clickCount=1)
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            for k in range(1, 9):
                drawer.call("Input.dispatchMouseEvent", type="mouseMoved", x=ax + (bx - ax) * k / 8, y=ay + (by - ay) * k / 8, button="left", buttons=1)
                sleep(0.01)
        drawer.call("Input.dispatchMouseEvent", type="mouseReleased", x=pts[-1][0], y=pts[-1][1], button="left", clickCount=1)
    sleep(1.5)
    viewer = next((x for x in tabs if x is not drawer), drawer)
    if viewer is not t:   # (the picture is always taken from t)
        t.js("1")
    sleep(0.5)


RECIPES = {
    "moto": r_moto, "golf": r_golf, "poly": r_poly, "slope": r_slope, "flappy": r_flappy, "dash": r_dash, "front": r_front,
    "billiards": r_billiards, "mines": r_mines, "2048": r_2048, "memory": r_memory, "snake": r_snake, "wheel": r_wheel,
    "wyr": r_wyr, "eightball": r_eightball, "volley": r_volley,
    "songs": r_songs, "life": r_life, "impostor": r_impostor, "blitz": r_blitz, "casino": r_casino, "prophunt": r_prophunt,
    "connect4": r_connect4, "doodle": r_doodle,
}


def main(keys):
    os.makedirs(OUT, exist_ok=True)
    c = Chrome(w=W, h=H, dpr=DPR)
    try:
        for k in keys:
            t = new_player(c, "Franio")
            try:
                shooter = RECIPES[k](c, t) or t   # (a recipe can pick another player's screen)
                shooter.shot(os.path.join(OUT, f"{k}.webp"), W, H, fmt="webp", quality=80)
                shooter.shot(os.path.join(OUT, f"{k}-sm.webp"), W, H, fmt="webp", quality=78, scale=0.5)
                print("shot", k)
            except Exception as e:
                print("FAILED", k, e)
            finally:
                for x in TABS:
                    x.close()
                TABS.clear()
    finally:
        c.close()


if __name__ == "__main__":
    main(sys.argv[1:] or list(RECIPES))
