/* Prop Hunt — top-down hide and seek with a killer.
   The server decides who sees what, checks moves and does the shooting; this page draws the town,
   moves you (so it feels instant) and sends your position ~20 times a second. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;

  const PROPS = {
    tree: '🌳', pine: '🌲', bush: '🌿', rock: '🪨', car: '🚗', barrel: '🛢️', crate: '📦', trash: '🗑️', cone: '🚧', hydrant: '🧯',
    mailbox: '📮', bike: '🚲', flower: '🌻', fountain: '⛲', chair: '🪑', couch: '🛋️', bed: '🛏️', plant: '🪴', tv: '📺', gift: '🎁',
    toilet: '🚽', tub: '🛁', guitar: '🎸', teddy: '🧸', basket: '🧺', books: '📚', clock: '🕰️',
    backpack: '🎒', computer: '🖥️', microscope: '🔬', abacus: '🧮', palette: '🎨', trophy: '🏆', cabinet: '🗄️', piano: '🎹',
    flask: '🧪', basketball: '🏀', bus: '🚌', soccer: '⚽', slide: '🛝', dress: '👗', shoe: '👟', bag: '🛍️', cart: '🛒',
    icecream: '🍦', pizza: '🍕', coffee: '☕', camera: '📷', headphones: '🎧', balloon: '🎈', atm: '🏧', pan: '🍳', cake: '🎂',
    drink: '🥤', speaker: '🔊', disco: '🪩', umbrella: '⛱️', float: '🛟', bbq: '🍖',
  };
  const THEMES = {
    town: { name: '🏙️ Town', ground: '#1c3a2a', dots: 'rgba(80,160,90,.18)', floor: '#4a3a63', roofs: ['#c2417f', '#1f8ea3', '#c46a2b', '#5f8a1f', '#6d46c4', '#b8930f'] },
    school: { name: '🏫 School', ground: '#24432c', dots: 'rgba(120,190,110,.16)', floor: '#5b6b8c', roofs: ['#9a3b2e', '#b4532a', '#8f3a3a', '#a8642d', '#7c3a2e', '#b0452f'] },
    mall: { name: '🛍️ Mall', ground: '#2b2a36', dots: 'rgba(255,255,255,.05)', floor: '#5a4f78', roofs: ['#3b82a6', '#4b6fb0', '#2f8f8a', '#5a5fb4', '#3d7d9e', '#4e6a8f'] },
    house: { name: '🏠 Party house', ground: '#22472b', dots: 'rgba(130,200,100,.18)', floor: '#6b4a32', roofs: ['#8b4a2f', '#a0522d', '#7a3e2a', '#94603c', '#6e3b24', '#9c4f34'] },
  };
  const FLOORS = { tile: '#3d4a66', asphalt: '#2a2840', mall: '#4b4469', wood: '#6e4d34' };
  const POWER_INFO = {
    decoy: { icon: '🪞', name: 'Decoy', help: 'leave a fake copy of you' },
    boost: { icon: '⚡', name: 'Speed', help: '3 seconds of extra speed' },
    radar: { icon: '📡', name: 'Radar', help: 'an extra ping right now' },
    grenade: { icon: '💣', name: 'Grenade', help: 'throw it where you aim' },
  };
  const VIEW = 560;
  const PLAYER_R = 18;
  const HIDER_SPEED = 250;
  const KILLER_SPEED = 275;
  const DISGUISED = 0.8;
  const REACH = 80;
  const MAX_DISGUISE_R = 34;
  const GUN_RANGE = 720;
  const MAG = 6;
  const ZOOM_W = 1150;            // how much of the town fits across the screen

  const S = { phase: 'lobby', settings: { hide: 20, time: 120, cycles: 1 }, scores: {}, round: null, final: null, last: null };
  const me = { x: 0, y: 0, a: 0, role: null, alive: false, prop: null, ammo: MAG, reloading: false, powers: {}, boostUntil: 0 };
  const theme = () => THEMES[(map && map.theme) || 'town'] || THEMES.town;
  const roofColor = (c) => theme().roofs[c % 6];
  const grenades = [];
  const ents = new Map();         // id -> { s: [[t, x, y, aim]], prop }
  let map = null;
  let radius = {};
  let endsAt = 0;
  let pingAt = 0;
  let pingSoon = false;
  let aliveCount = 0;
  let lastShot = 0;
  const shots = [];
  const puffs = [];
  let pings = [];
  const feed = [];
  let reveal = null;              // where survivors hid, shown after a round

  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  const mini = $('#mini');
  const mctx = mini.getContext('2d');
  const stage = $('#stage');

  const isKiller = () => !!S.round && S.round.killer === Net.id;
  const inRound = () => S.phase === 'hiding' || S.phase === 'hunting';
  const spectating = () => !(me.role && me.alive);
  const canMove = () => inRound() && me.alive && me.role && (S.phase === 'hunting' || me.role === 'hider');
  const who = (id) => (window.Room && Room.player(id)) || { name: 'Someone', avatar: '🙂', color: '#888888' };
  const snd = (fn) => { if (!Sfx.muted) { try { fn(); } catch { /* no audio */ } } };

  // ------------------------------------------------------------ map helpers
  function prepMap(m) {
    map = m;
    radius = {};
    for (const [k, , , r] of m.props) radius[k] = r;
    pings = [];
    reveal = null;
    shots.length = 0;
    puffs.length = 0;
    ents.clear();
  }
  function roomOf(x, y) {
    if (!map) return null;
    for (let i = 0; i < map.rooms.length; i++) {
      const [bx, by, bw, bh] = map.rooms[i];
      if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) return i;
    }
    return null;
  }
  const myR = () => (me.prop ? Math.min(radius[me.prop] || PLAYER_R, MAX_DISGUISE_R) : PLAYER_R);

  /** Push a circle out of walls and props. */
  function collide(x, y, r) {
    for (let k = 0; k < 4; k++) {
      let moved = false;
      for (const [rx, ry, rw, rh] of map.walls.concat(map.pools || [])) {
        if (x < rx - r || x > rx + rw + r || y < ry - r || y > ry + rh + r) continue;
        const nx = Math.min(Math.max(x, rx), rx + rw);
        const ny = Math.min(Math.max(y, ry), ry + rh);
        const dx = x - nx;
        const dy = y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) { const d = Math.sqrt(d2); x = nx + (dx / d) * r; y = ny + (dy / d) * r; }
        else {
          const l = x - rx; const rr = rx + rw - x; const t = y - ry; const b = ry + rh - y;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = rx - r; else if (m === rr) x = rx + rw + r; else if (m === t) y = ry - r; else y = ry + rh + r;
        }
        moved = true;
      }
      for (const [, px, py, pr] of map.props) {
        const min = r + pr - 2;
        const dx = x - px;
        const dy = y - py;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-3) { x += min; continue; }
        x = px + (dx / d) * min;
        y = py + (dy / d) * min;
        moved = true;
      }
      x = Math.min(Math.max(x, r), map.w - r);
      y = Math.min(Math.max(y, r), map.h - r);
      if (!moved) break;
    }
    return [x, y];
  }

  function rayRect(ox, oy, dx, dy, [rx, ry, rw, rh]) {
    let t0 = -1e9; let t1 = 1e9;
    for (const [o, d, lo, hi] of [[ox, dx, rx, rx + rw], [oy, dy, ry, ry + rh]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; }
      else {
        let a = (lo - o) / d; let b = (hi - o) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) return null;
      }
    }
    return t1 < 0 ? null : Math.max(0, t0);
  }
  function rayCircle(ox, oy, dx, dy, cx, cy, r) {
    const fx = ox - cx; const fy = oy - cy;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    let t = -b - s;
    if (t < 0) t = -b + s;
    return t >= 0 ? t : null;
  }
  /** How far a shot from (x, y) at angle a would fly before hitting a wall or prop. */
  function sightLength(x, y, a) {
    const dx = Math.cos(a); const dy = Math.sin(a);
    let best = GUN_RANGE;
    for (const w of map.walls) { const t = rayRect(x, y, dx, dy, w); if (t != null && t < best) best = t; }
    for (const [, px, py, pr] of map.props) {
      if (Math.abs(px - x) > GUN_RANGE + pr || Math.abs(py - y) > GUN_RANGE + pr) continue;
      const t = rayCircle(x, y, dx, dy, px, py, pr);
      if (t != null && t < best) best = t;
    }
    return best;
  }
  function nearestProp() {
    if (!map) return -1;
    let best = -1; let bd = 1e9;
    map.props.forEach(([, px, py, pr], i) => {
      if (pr > MAX_DISGUISE_R) return;
      const d = Math.hypot(px - me.x, py - me.y) - pr;
      if (d < REACH + PLAYER_R - 6 && d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // ------------------------------------------------------------ input
  const keys = new Set();
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  let mouse = null;   // css px inside the stage
  const typing = () => document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);

  addEventListener('keydown', (e) => {
    if (typing() || $('#play').classList.contains('hidden')) return;
    const k = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
    keys.add(k);
    if (e.repeat) return;
    if (k === 'KeyE' || (k === 'Space' && me.role === 'hider')) disguise();
    else if (k === 'KeyQ') undisguise();
    else if (k === 'KeyR') reload();
    else if (k === 'Digit1' || k === 'Digit2') usePower(Object.keys(me.powers)[k === 'Digit1' ? 0 : 1]);
    else if (k === 'Space' && isKiller()) shoot();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function stagePoint(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }
  stage.addEventListener('pointermove', (e) => {
    const p = stagePoint(e);
    if (e.pointerType !== 'touch') mouse = p;
    if (e.pointerId === stick.id) {
      stick.x = Math.max(-1, Math.min(1, (p.x - stick.ox) / 50));
      stick.y = Math.max(-1, Math.min(1, (p.y - stick.oy) / 50));
      const knob = $('#stick i');
      knob.style.transform = `translate(${stick.x * 35}px, ${stick.y * 35}px)`;
    }
  });
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const p = stagePoint(e);
    if (e.pointerType === 'touch') {
      if (p.x < p.w * 0.45 && stick.id == null) {
        stick.id = e.pointerId; stick.ox = p.x; stick.oy = p.y; stick.x = 0; stick.y = 0;
        const el = $('#stick');
        el.style.display = 'block'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
        $('#stick i').style.transform = '';
        try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      } else if (isKiller()) {
        me.a = Math.atan2(p.y - p.h / 2, p.x - p.w / 2);
        shoot();
      }
      e.preventDefault();
      return;
    }
    mouse = p;
    if (e.button === 0 && isKiller()) shoot();
  });
  const endStick = (e) => {
    if (e.pointerId !== stick.id) return;
    stick.id = null; stick.x = 0; stick.y = 0;
    $('#stick').style.display = 'none';
  };
  stage.addEventListener('pointerup', endStick);
  stage.addEventListener('pointercancel', endStick);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  function inputVector() {
    let x = 0; let y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    x += stick.x; y += stick.y;
    const d = Math.hypot(x, y);
    return d > 1 ? [x / d, y / d] : d < 0.15 ? [0, 0] : [x, y];
  }

  // ------------------------------------------------------------ actions
  function shoot() {
    if (!isKiller() || S.phase !== 'hunting' || !me.alive) return;
    const now = performance.now();
    if (now - lastShot < 400) return;
    if (me.reloading || me.ammo <= 0) { snd(() => Sfx.tone(180, 0.05, 'square', 0.04)); if (!me.reloading) reload(); return; }
    lastShot = now;
    me.ammo = Math.max(0, me.ammo - 1);
    Net.send('g:shoot', { a: +me.a.toFixed(3) });
    renderBottom();
  }
  function reload() {
    if (!isKiller() || S.phase !== 'hunting' || me.reloading || me.ammo >= MAG) return;
    Net.send('g:reload');
    snd(() => { Sfx.tone(300, 0.06, 'square', 0.04); Sfx.tone(420, 0.06, 'square', 0.04, 0, 0.12); });
  }
  function usePower(kind) {
    if (!kind || !inRound() || !me.alive || !(me.powers[kind] > 0)) return;
    if (me.role === 'killer' && S.phase !== 'hunting') { UI.toast('Wait for the hunt to start!', '', 1500); return; }
    if (kind === 'grenade') {
      // throw it where the mouse is (or 300px ahead on a phone)
      let tx = me.x + Math.cos(me.a) * 300; let ty = me.y + Math.sin(me.a) * 300;
      if (mouse) {
        const r = stage.getBoundingClientRect();
        const z = Math.min(r.width / ZOOM_W, r.height / (ZOOM_W * 0.625));
        tx = me.x + (mouse.x - r.width / 2) / z; ty = me.y + (mouse.y - r.height / 2) / z;
      }
      Net.send('g:power', { p: kind, x: Math.round(tx), y: Math.round(ty) });
    } else Net.send('g:power', { p: kind });
  }
  function disguise() {
    if (me.role !== 'hider' || !me.alive || !inRound()) return;
    const i = nearestProp();
    if (i < 0) { UI.toast('Walk up to a prop (a barrel, a bush, a couch…) to turn into it', '', 2200); return; }
    if (me.prop === map.props[i][0]) return;
    Net.send('g:disguise', { i });
  }
  function undisguise() {
    if (me.role !== 'hider' || !me.alive || !me.prop) return;
    Net.send('g:disguise', { i: null });
  }

  // ------------------------------------------------------------ the loop
  let lastFrame = performance.now();
  let sent = { t: 0, x: null, y: null, a: null };
  let hudAt = 0;
  let miniAt = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - lastFrame) / 1000);
    lastFrame = t;
    if ($('#play').classList.contains('hidden') || !map) return;
    if (canMove()) {
      const [vx, vy] = inputVector();
      if (vx || vy) {
        const speed = (me.role === 'killer' ? KILLER_SPEED : HIDER_SPEED) * (me.prop ? DISGUISED : 1) * (performance.now() < me.boostUntil ? 1.6 : 1);
        [me.x, me.y] = collide(me.x + vx * speed * dt, me.y + vy * speed * dt, myR());
      }
    }
    if (isKiller() && me.alive && mouse) {
      const r = stage.getBoundingClientRect();
      me.a = Math.atan2(mouse.y - r.height / 2, mouse.x - r.width / 2);
    }
    if (inRound() && me.alive && me.role) {
      const moved = sent.x == null || Math.abs(sent.x - me.x) > 0.5 || Math.abs(sent.y - me.y) > 0.5 || (isKiller() && Math.abs(sent.a - me.a) > 0.03);
      if ((moved && t - sent.t > 50) || t - sent.t > 400) {
        Net.send('g:pos', { x: +me.x.toFixed(1), y: +me.y.toFixed(1), a: +me.a.toFixed(3) });
        sent = { t, x: me.x, y: me.y, a: me.a };
      }
    }
    draw(t);
    if (t - hudAt > 150) { hudAt = t; tickHud(); }
    if (t - miniAt > 120) { miniAt = t; drawMini(t); }
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------ drawing
  function pattern(size, paint) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    paint(c.getContext('2d'), size);
    return ctx.createPattern(c, 'repeat');
  }
  const pats = {};
  function planks(color) {
    return pattern(48, (g, n) => {
      g.fillStyle = color; g.fillRect(0, 0, n, n);
      g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 2;
      for (let y = 0; y <= n; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(n, y); g.stroke(); }
      for (let y = 0; y < n; y += 16) { const x = (y / 16) % 2 ? 12 : 36; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
    });
  }
  function tiles(color) {
    return pattern(40, (g, n) => {
      g.fillStyle = color; g.fillRect(0, 0, n, n);
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 2; g.strokeRect(1, 1, n - 2, n - 2);
    });
  }
  function patterns() {
    const th = (map && map.theme) || 'town';
    if (pats.theme === th) return;
    const t = theme();
    pats.theme = th;
    pats.grass = pattern(96, (g, n) => {
      g.fillStyle = t.ground; g.fillRect(0, 0, n, n);
      for (let i = 0; i < 70; i++) { g.fillStyle = Math.random() < 0.5 ? t.dots : 'rgba(0,0,0,.12)'; g.fillRect(Math.random() * n, Math.random() * n, 2, 3); }
    });
    pats.floor = th === 'school' || th === 'mall' ? tiles(t.floor) : planks(t.floor);
    pats.tile = tiles(FLOORS.tile); pats.mall = tiles(FLOORS.mall); pats.wood = planks(FLOORS.wood); pats.asphalt = FLOORS.asphalt;
    pats.water = pattern(64, (g, n) => {
      g.fillStyle = '#1d8fd6'; g.fillRect(0, 0, n, n);
      g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2;
      for (let y = 8; y < n; y += 20) { g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(16, y - 6, 32, y); g.quadraticCurveTo(48, y + 6, 64, y); g.stroke(); }
    });
  }

  function emoji(ch, x, y, size) {
    const img = PA.Emoji.image(ch);
    if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    else {
      ctx.font = `${size * 0.82}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ch, x, y + size * 0.04);
    }
  }
  function drawProp(kind, x, y, r) {
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + r * 0.55, r * 0.95, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    emoji(PROPS[kind] || '📦', x, y, r * 2.25);
  }
  function label(text, x, y, color) {
    ctx.font = '600 13px Fredoka, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(11,9,32,.72)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 9, w, 18, 9); ctx.fill();
    ctx.fillStyle = color || '#fff';
    ctx.fillText(text, x, y + 1);
  }
  function drawPerson(id, x, y, a, killer, mine) {
    const p = who(id);
    if (killer) {
      // the gun, pointing where they aim
      ctx.save(); ctx.translate(x, y); ctx.rotate(a || 0);
      ctx.fillStyle = '#1f2937'; ctx.fillRect(PLAYER_R - 6, -5, 26, 10);
      ctx.fillStyle = '#f43f5e'; ctx.fillRect(PLAYER_R + 14, -3, 8, 6);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(x + 2, y + 12, PLAYER_R, PLAYER_R * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = killer ? '#be123c' : p.color || '#8b5cf6';
    ctx.beginPath(); ctx.arc(x, y, PLAYER_R + (killer ? 2 : 0), 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = mine ? 4 : 3;
    ctx.strokeStyle = killer ? '#fda4af' : mine ? '#facc15' : 'rgba(255,255,255,.85)';
    ctx.stroke();
    emoji(killer ? '😈' : p.avatar || '🙂', x, y, PLAYER_R * 1.5);
    label(`${killer ? '🔫 ' : ''}${p.name}${mine ? ' (you)' : ''}`, x, y - PLAYER_R - 14, killer ? '#fecdd3' : '#fff');
  }

  function viewer(t) {
    if (!spectating()) return { x: me.x, y: me.y };
    const k = S.round && ents.get(S.round.killer);
    const p = k && sample(k, t - 110);
    if (p) return { x: p[1], y: p[2], a: p[3] };
    return map ? { x: map.spawn[0], y: map.spawn[1] } : { x: 0, y: 0 };
  }
  function sample(en, rt) {
    const s = en.s;
    if (!s.length) return null;
    if (rt <= s[0][0]) return s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i][0] <= rt) {
        const a = s[i]; const b = s[i + 1];
        if (!b) return a;
        const k = (rt - a[0]) / Math.max(1, b[0] - a[0]);
        let da = (b[3] || 0) - (a[3] || 0);
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        return [rt, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, (a[3] || 0) + da * k];
      }
    }
    return s[0];
  }

  function draw(t) {
    patterns();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = Math.round(stage.clientWidth * dpr);
    const ch = Math.round(stage.clientHeight * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#06050f';
    ctx.fillRect(0, 0, cw, ch);
    const v = viewer(t);
    const z = Math.min(cw / ZOOM_W, ch / (ZOOM_W * 0.625));
    ctx.setTransform(z, 0, 0, z, cw / 2 - v.x * z, ch / 2 - v.y * z);
    const vx0 = v.x - cw / 2 / z - 60; const vx1 = v.x + cw / 2 / z + 60;
    const vy0 = v.y - ch / 2 / z - 60; const vy1 = v.y + ch / 2 / z + 60;
    const onScreen = (x, y, r) => x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;

    // ground, streets, floors, pools, plaza
    ctx.fillStyle = pats.grass; ctx.fillRect(0, 0, map.w, map.h);
    for (const [x, y, w, hh, kind] of map.floors || []) { ctx.fillStyle = pats[kind] || FLOORS.tile; ctx.fillRect(x, y, w, hh); }
    for (const [x, y, w, hh] of map.pools || []) {
      ctx.fillStyle = '#e2e8f0'; ctx.fillRect(x - 10, y - 10, w + 20, hh + 20);
      ctx.fillStyle = pats.water; ctx.fillRect(x, y, w, hh);
    }
    ctx.fillStyle = '#2a2840';
    for (const [x, y, w, hh] of map.streets) ctx.fillRect(x, y, w, hh);
    ctx.strokeStyle = 'rgba(250,204,21,.45)'; ctx.lineWidth = 4; ctx.setLineDash([26, 22]);
    for (const [x, y, w, hh] of map.streets) {
      ctx.beginPath();
      if (w > hh) { ctx.moveTo(x, y + hh / 2); ctx.lineTo(x + w, y + hh / 2); } else { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + hh); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (map.theme === 'town' || !map.theme) {
      ctx.fillStyle = '#3a3358';
      ctx.beginPath(); ctx.arc(map.spawn[0], map.spawn[1], 200, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 6; ctx.stroke();
    }

    // insides of buildings
    for (const [x, y, w, hh] of map.rooms) { if (onScreen(x + w / 2, y + hh / 2, Math.max(w, hh))) { ctx.fillStyle = pats.floor; ctx.fillRect(x, y, w, hh); } }
    ctx.fillStyle = '#ece6ff';
    for (const [x, y, w, hh] of map.walls) if (onScreen(x + w / 2, y + hh / 2, Math.max(w, hh) / 2)) ctx.fillRect(x, y, w, hh);

    // props
    const hint = me.role === 'hider' && me.alive && inRound() ? nearestProp() : -1;
    map.props.forEach(([k, x, y, r], i) => {
      if (!onScreen(x, y, r)) return;
      drawProp(k, x, y, r);
      if (i === hint && map.props[i][0] !== me.prop) {
        ctx.strokeStyle = 'rgba(34,211,238,.9)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(x, y, r + 8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    });

    // people
    const rt = t - 110;
    const showNames = !isKiller();
    for (const [id, en] of ents) {
      const p = sample(en, rt);
      if (!p) continue;
      if (S.round && id === S.round.killer) { drawPerson(id, p[1], p[2], p[3], true, false); continue; }
      const as = en.as || id;            // a decoy looks exactly like the person who left it
      const tag = en.decoy ? ' (decoy)' : '';
      if (en.prop) {
        const r = Math.min(radius[en.prop] || 20, MAX_DISGUISE_R);
        drawProp(en.prop, p[1], p[2], r);
        if (showNames) { ctx.globalAlpha = 0.75; label(`${en.decoy ? '🪞' : '🫥'} ${who(as).name}${tag}`, p[1], p[2] - r - 12, '#a5f3fc'); ctx.globalAlpha = 1; }
      } else {
        if (en.decoy && showNames) ctx.globalAlpha = 0.6;
        drawPerson(as, p[1], p[2], 0, false, false);
        if (en.decoy && showNames) { label('🪞 decoy', p[1], p[2] + PLAYER_R + 14, '#a5f3fc'); ctx.globalAlpha = 1; }
      }
    }
    if (me.role && me.alive && inRound()) {
      if (me.prop) {
        const r = myR();
        drawProp(me.prop, me.x, me.y, r);
        ctx.strokeStyle = 'rgba(250,204,21,.8)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(me.x, me.y, r + 6, 0, Math.PI * 2); ctx.stroke();
        label('🫥 you', me.x, me.y - r - 14, '#fde68a');
      } else drawPerson(Net.id, me.x, me.y, me.a, me.role === 'killer', true);
      if (t < me.boostUntil) {           // speed lines
        ctx.strokeStyle = 'rgba(250,204,21,.7)'; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) { const a = (t / 90 + i * 2.1) % (Math.PI * 2); ctx.beginPath(); ctx.arc(me.x, me.y, myR() + 8 + i * 4, a, a + 0.9); ctx.stroke(); }
      }
    }

    // grenades in the air
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i]; const k = (t - g.t) / (g.fuse * 1000);
      if (k > 1.2) { grenades.splice(i, 1); continue; }
      const kk = Math.min(1, k * 1.6);
      const x = g.x0 + (g.x1 - g.x0) * kk; const y = g.y0 + (g.y1 - g.y0) * kk - Math.sin(kk * Math.PI) * 60;
      if (kk >= 1) { ctx.strokeStyle = `rgba(244,63,94,${0.5 + 0.5 * Math.sin(t / 60)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(g.x1, g.y1, 100, 0, Math.PI * 2); ctx.stroke(); }
      emoji('💣', x, y, 30);
    }

    // shots and puffs
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]; const age = (t - s.t) / 260;
      if (age > 1) { shots.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(253,224,71,${1 - age})`; ctx.lineWidth = 4 * (1 - age) + 1;
      ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; const age = (t - p.t) / p.life;
      if (age > 1) { puffs.splice(i, 1); continue; }
      ctx.fillStyle = p.color.replace('A', String(0.8 * (1 - age)));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + age), 0, Math.PI * 2); ctx.fill();
      if (p.emoji) { ctx.globalAlpha = 1 - age; emoji(p.emoji, p.x, p.y - age * 40, 34); ctx.globalAlpha = 1; }
    }

    // roofs over every building you're not inside
    const inside = roomOf(v.x, v.y);
    map.rooms.forEach(([x, y, w, hh, c], i) => {
      if (i === inside || !onScreen(x + w / 2, y + hh / 2, Math.max(w, hh))) return;
      ctx.fillStyle = roofColor(c);
      ctx.fillRect(x - 4, y - 4, w + 8, hh + 8);
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 3;
      for (let yy = y + 14; yy < y + hh; yy += 18) { ctx.beginPath(); ctx.moveTo(x - 4, yy); ctx.lineTo(x + w + 4, yy); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x - 4, y + hh / 2 - 5, w + 8, 10);
      ctx.fillStyle = '#3f3f46'; ctx.fillRect(x + w * 0.72, y + hh * 0.18, 22, 22);
    });

    // the killer's pings (on top of roofs: people inside buildings get pinged too)
    pings = pings.filter((p) => t - p.t < 6000);
    for (const p of pings) {
      const age = (t - p.t) / 6000;
      for (const [x, y] of p.spots) {
        const pulse = 1 + 0.12 * Math.sin(t / 160);
        ctx.fillStyle = `rgba(244,63,94,${0.16 * (1 - age)})`;
        ctx.strokeStyle = `rgba(244,63,94,${0.85 * (1 - age)})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, y, p.r * pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    // where the survivors hid (after a round)
    if (reveal && t - reveal.t < 9000) {
      for (const [id, [x, y]] of Object.entries(reveal.spots)) {
        const prop = reveal.props[id];
        if (prop) drawProp(prop, x, y, Math.min(radius[prop] || 20, MAX_DISGUISE_R)); else drawPerson(id, x, y, 0, false, false);
        label(`🫥 ${who(id).name} hid here!`, x, y - 40, '#a5f3fc');
      }
    }

    // the killer's laser sight
    if (isKiller() && S.phase === 'hunting' && me.alive) {
      const len = sightLength(me.x + Math.cos(me.a) * (PLAYER_R + 4), me.y + Math.sin(me.a) * (PLAYER_R + 4), me.a);
      ctx.strokeStyle = 'rgba(244,63,94,.55)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(me.x + Math.cos(me.a) * (len + PLAYER_R + 4), me.y + Math.sin(me.a) * (len + PLAYER_R + 4)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // fog: you only see so far
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (inRound()) {
      const sx = cw / 2; const sy = ch / 2;
      const g = ctx.createRadialGradient(sx, sy, VIEW * z * 0.78, sx, sy, VIEW * z);
      g.addColorStop(0, 'rgba(6,5,15,0)');
      g.addColorStop(1, 'rgba(6,5,15,.9)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
      if (S.phase === 'hiding' && (isKiller() || spectating())) { ctx.fillStyle = 'rgba(0,0,0,.94)'; ctx.fillRect(0, 0, cw, ch); }
    }
  }

  function drawMini(t) {
    if (!map) return;
    const W = mini.width; const H = mini.height;
    const k = Math.min(W / map.w, H / map.h);
    const ox = (W - map.w * k) / 2; const oy = (H - map.h * k) / 2;
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = 'rgba(28,58,42,.85)'; mctx.fillRect(ox, oy, map.w * k, map.h * k);
    mctx.fillStyle = 'rgba(42,40,64,.9)';
    for (const [x, y, w, hh] of map.streets) mctx.fillRect(ox + x * k, oy + y * k, w * k, hh * k);
    for (const [x, y, w, hh] of map.floors || []) { mctx.fillStyle = 'rgba(80,80,110,.9)'; mctx.fillRect(ox + x * k, oy + y * k, w * k, hh * k); }
    for (const [x, y, w, hh] of map.pools || []) { mctx.fillStyle = '#1d8fd6'; mctx.fillRect(ox + x * k, oy + y * k, w * k, hh * k); }
    map.rooms.forEach(([x, y, w, hh, c]) => { mctx.fillStyle = roofColor(c); mctx.fillRect(ox + x * k, oy + y * k, w * k, hh * k); });
    for (const p of pings) {
      mctx.fillStyle = 'rgba(244,63,94,.5)';
      for (const [x, y] of p.spots) { mctx.beginPath(); mctx.arc(ox + x * k, oy + y * k, Math.max(5, p.r * k), 0, Math.PI * 2); mctx.fill(); }
    }
    const v = viewer(t);
    mctx.strokeStyle = 'rgba(255,255,255,.5)'; mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.arc(ox + v.x * k, oy + v.y * k, VIEW * k, 0, Math.PI * 2); mctx.stroke();
    mctx.fillStyle = spectating() ? '#f43f5e' : isKiller() ? '#f43f5e' : '#facc15';
    mctx.beginPath(); mctx.arc(ox + v.x * k, oy + v.y * k, 5, 0, Math.PI * 2); mctx.fill();
  }

  // ------------------------------------------------------------ HUD
  let hudKey = '';
  function renderHud() {
    const r = S.round;
    const role = !r ? '' : isKiller() ? 'killer' : me.role === 'hider' ? (me.alive ? 'hider' : 'caught') : 'watch';
    const roleText = { killer: '🔫 You’re the killer', hider: me.prop ? `🫥 Hiding as ${PROPS[me.prop] || ''}` : '🫥 You’re hiding', caught: '💀 Caught · watching', watch: '👀 Watching' }[role] || '';
    const key = [role, roleText, r && r.n].join('|');
    stage.classList.toggle('hider', role !== 'killer');
    if (key === hudKey) return;
    hudKey = key;
    fill($('#hud'),
      h('span', { class: 'ph-chip ' + (role === 'killer' ? 'killer' : role === 'hider' ? 'hider' : '') }, roleText),
      r ? h('span', { class: 'ph-chip' }, `Round ${r.n}/${r.total}`) : null,
      h('span', { class: 'ph-chip clock', id: 'hud-clock' }, '--'),
      h('span', { class: 'ph-chip', id: 'hud-alive' }, ''),
      h('span', { class: 'ph-chip ping hidden', id: 'hud-ping' }, ''),
      h('span', { class: 'sp' }),
      h('button', { class: 'icon-btn', style: { pointerEvents: 'auto', width: '34px', height: '34px' }, title: 'Full screen', 'aria-label': 'Full screen', onclick: toggleFull }, '⛶'));
  }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  }
  function tickHud() {
    renderHud();
    const now = performance.now();
    const clock = $('#hud-clock');
    if (clock) {
      const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
      const txt = inRound() ? `${S.phase === 'hiding' ? '🙈 ' : '⏱️ '}${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '--';
      if (clock.textContent !== txt) clock.textContent = txt;
      clock.classList.toggle('low', S.phase === 'hunting' && left <= 15);
    }
    const alive = $('#hud-alive');
    if (alive) { const txt = inRound() ? `🫥 ${aliveCount} hiding` : ''; if (alive.textContent !== txt) alive.textContent = txt; }
    const ping = $('#hud-ping');
    if (ping) {
      const show = S.phase === 'hunting';
      ping.classList.toggle('hidden', !show);
      if (show) {
        const left = Math.max(0, Math.ceil((pingAt - now) / 1000));
        const txt = isKiller() ? `📡 Ping in ${left}s` : `📡 ${left <= 3 ? 'Ping NOW-ish!' : `Ping in ${left}s`}`;
        if (ping.textContent !== txt) ping.textContent = txt;
        ping.classList.toggle('soon', left <= 3);
      }
    }
    const f = $('#feed');
    while (feed.length && now - feed[0].t > 7000) { feed.shift(); if (f.firstChild) f.firstChild.remove(); }
    if (S.phase === 'hiding') centerHiding(now);
  }
  function addFeed(text) {
    feed.push({ t: performance.now() });
    const el = h('div', {}, text);
    $('#feed').append(el);
    if (G) G.from(el, { x: 30, autoAlpha: 0, duration: 0.3 });
    while (feed.length > 5) { feed.shift(); $('#feed').firstChild.remove(); }
  }

  function powerButtons(touch) {
    return Object.entries(me.powers).map(([kind, n], i) => {
      const info = POWER_INFO[kind];
      return h('button', { class: 'btn btn-sm ' + (kind === 'grenade' || kind === 'radar' ? 'btn-ghost' : 'btn-yellow'), disabled: !(n > 0), title: `${info.name}: ${info.help}`, onclick: () => usePower(kind) },
        `${info.icon} ${info.name} ×${n}`, touch ? '' : ` (${i + 1})`);
    });
  }
  function renderBottom() {
    const b = $('#bottom');
    const touch = matchMedia('(pointer: coarse)').matches;
    if (!inRound()) { fill(b); return; }
    if (isKiller()) {
      fill(b,
        h('div', { class: 'ph-ammo', title: 'Ammo' }, '🔫', ...Array.from({ length: MAG }, (_, i) => h('i', { class: i < me.ammo ? '' : 'used' })), me.reloading ? ' reloading…' : ''),
        ...powerButtons(touch),
        touch ? h('button', { class: 'btn btn-ghost btn-sm', onclick: reload }, '🔄 Reload') : h('span', { class: 'ph-help' }, 'WASD move · mouse aim · click shoot · R reload'));
    } else if (me.role === 'hider' && me.alive) {
      fill(b,
        h('button', { class: 'btn btn-cyan btn-sm', onclick: disguise }, '🎭 Become the prop', touch ? '' : ' (E)'),
        me.prop ? h('button', { class: 'btn btn-ghost btn-sm', onclick: undisguise }, '🙂 Be me', touch ? '' : ' (Q)') : null,
        ...powerButtons(touch),
        touch ? null : h('span', { class: 'ph-help' }, 'WASD move · E become a prop · hide in buildings!'));
    } else fill(b, h('span', { class: 'ph-help' }, '👀 You’re watching the killer. Chat only goes to other watchers.'));
  }

  let centerKind = '';
  function center(kind, ...kids) {
    centerKind = kind;
    const el = $('#center');
    fill(el, kids.length ? h('div', { class: 'card' }, ...kids) : null);
    if (kids.length && G) G.from(el.firstChild, { scale: 0.85, autoAlpha: 0, duration: 0.35, ease: 'back.out(2)' });
  }
  function centerHiding(now) {
    const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
    if (isKiller() || spectating()) {
      const count = $('#center .count');
      if (centerKind === 'hiding' && count) { if (count.textContent !== String(left)) count.textContent = left; return; }
      center('hiding', h('div', { class: 'big' }, isKiller() ? '🙈 Close your eyes!' : '🙈 The killer is counting…'), h('div', { class: 'count' }, left),
        h('p', { class: 'muted' }, isKiller() ? 'The hiders are hiding. Then go find them! You get a 📡 ping of where they are every 30 seconds.' : 'The hiders are hiding right now.'));
    } else if (centerKind === 'hiding') center('');
  }

  function renderScores() {
    const r = S.round;
    const ids = Object.keys(S.scores).sort((a, b) => (S.scores[b] || 0) - (S.scores[a] || 0));
    fill($('#ph-scores'), ids.map((id) => {
      const p = who(id);
      const caught = r && r.caught && r.caught.includes(id);
      const inIt = r && r.players && r.players.includes(id);
      const icon = !r || S.phase === 'over' ? '' : id === r.killer ? '🔫' : caught ? '💀' : inIt ? '🫥' : '👀';
      return h('div', { class: 'ph-row' + (id === Net.id ? ' me' : '') + (caught ? ' out' : '') },
        UI.avatar(p, 'sm'), h('span', { class: 'nm' }, p.name), h('span', { title: 'Role this round' }, icon), h('span', { class: 'pts' }, S.scores[id] || 0));
    }));
  }

  // ------------------------------------------------------------ screens
  function route() {
    const playing = ['hiding', 'hunting', 'roundover'].includes(S.phase);
    $('#room').classList.toggle('hidden', playing);
    $('#play').classList.toggle('hidden', !playing);
    if (!playing) { renderRoomMain(); center(''); return; }
    hudKey = '';
    renderHud();
    renderScores();
    renderBottom();
  }

  function renderRoomMain() {
    const host = Room.isHost;
    const kids = [];
    if (S.final && S.final.length) {
      const top = S.final.slice(0, 3);
      const order = [top[1], top[0], top[2]];
      kids.push(h('div', { class: 'panel-title' }, '🏆 Final scores'),
        h('div', { class: 'podium' }, order.map((r, i) => (r ? h('div', { class: `step p${[2, 1, 3][i]}` }, UI.avatar(r, 'lg'), h('div', { class: 'pname' }, r.name), h('div', { class: 'pts' }, `${r.points} pts`), h('div', { class: 'block' }, [2, 1, 3][i])) : h('div', { class: 'step' })))));
    }
    const seg = (key, opts, labelText) => h('div', { class: 'set-row' },
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, labelText),
      h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: S.settings[key] === v ? 'on' : '', disabled: !host, onclick: () => { Net.send('g:settings', { ...S.settings, [key]: v }); Sfx.play('click'); } }, l))));
    const players = Room.players.filter((p) => p.online && !p.watch).length;
    kids.push(
      h('div', { class: 'panel-title' }, '⚙️ Settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      seg('time', [[90, '1:30'], [120, '2 min'], [180, '3 min'], [240, '4 min']], 'ROUND LENGTH'),
      seg('hide', [[15, '15s'], [20, '20s'], [30, '30s']], 'TIME TO HIDE'),
      seg('cycles', [[1, 'Everyone once'], [2, 'Everyone twice']], 'TURNS AS THE KILLER'),
      seg('map', [['random', '🎲 Mix'], ...Object.entries(THEMES).map(([k, t]) => [k, t.name])], 'MAP'),
      h('div', { class: 'points-help' }, h('div', {}, '🪞 Hiders get 2 decoys and a ⚡ speed burst, the killer gets a 📡 radar and 2 💣 grenades every round (keys 1 and 2).')),
      h('div', { class: 'points-help' },
        h('div', {}, '🫥 Hiders: caught 1st = 1 point, 2nd = 2… survive the round = 1 point for every player in it'),
        h('div', {}, '🔫 Killer: 2 points a catch (up to 8), or 10 for catching everyone')),
      host ? h('button', { class: 'btn btn-pink btn-lg btn-block', disabled: players < 2, onclick: () => Net.send('g:start') }, S.final ? '🔁 Play again' : '🔫 Start the hunt')
        : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host')),
      h('p', { class: 'tiny faint', style: { marginTop: '10px', textAlign: 'center' } }, players < 2 ? 'Needs at least 2 players.' : `${players} players · ${players * S.settings.cycles} rounds, everyone gets a turn as the killer.`));
    fill($('#room-main'), kids);
  }

  function roundOverCard(last) {
    const why = { all: `🔫 ${last.names[last.killer]} caught everyone!`, time: `⏰ Time’s up! ${last.survivors.length} hider${last.survivors.length === 1 ? '' : 's'} survived`,
      killer: '🏃 The killer left', skip: '⏭️ Round skipped' }[last.why] || 'Round over';
    const ids = Object.keys(last.gained).sort((a, b) => last.gained[b] - last.gained[a]);
    const what = (id) => (id === last.killer ? `🔫 killer · caught ${last.caught.length}` : last.survivors.includes(id) ? `🫥 survived${last.props[id] ? ' as ' + (PROPS[last.props[id]] || '') : ''}` : `💀 caught #${last.caught.indexOf(id) + 1}`);
    const next = h('b', {}, last.next);
    center('roundover',
      h('div', { class: 'small muted bold' }, `ROUND ${last.n}/${last.total}`),
      h('div', { class: 'big' }, why),
      h('div', { class: 'rows' }, ids.map((id) => h('div', {}, h('span', {}, who(id).avatar || '🙂'), h('span', { class: 'grow' }, last.names[id] || who(id).name, h('span', { class: 'tiny muted' }, ' · ' + what(id))), h('b', {}, `+${last.gained[id]}`)))),
      h('p', { class: 'muted small', style: { marginTop: '10px' } }, last.final ? 'Final scores in ' : 'Next round in ', next, 's'));
    let n = last.next;
    const iv = setInterval(() => { n -= 1; if (n < 0 || centerKind !== 'roundover') { clearInterval(iv); return; } next.textContent = n; }, 1000);
  }

  if (location.hostname === 'localhost') window.__ph = { S, me, ents, get map() { return map; }, draw };   // for testing

  // ------------------------------------------------------------ server messages
  function setYou(y) {
    if (!y) { Object.assign(me, { role: null, alive: false, prop: null, powers: {} }); return; }
    Object.assign(me, { x: y.x, y: y.y, role: y.role, alive: y.alive, prop: y.prop, ammo: y.ammo == null ? MAG : y.ammo, reloading: !!y.reloading,
      powers: y.powers || {}, boostUntil: performance.now() + (y.boost || 0) * 1000 });
    sent = { t: 0, x: null, y: null, a: null };
  }
  function startRound(r, you, scores) {
    S.round = r;
    if (scores) S.scores = scores;
    S.phase = r.hide > 0 ? 'hiding' : 'hunting';
    prepMap(r.map);
    setYou(you);
    aliveCount = r.alive.length;
    const now = performance.now();
    endsAt = now + (S.phase === 'hiding' ? r.hide : r.left) * 1000;
    pingAt = now + r.ping * 1000;
    center('');
    route();
  }

  Lobby.init({
    game: 'prophunt',
    title: 'Prop Hunt',
    emoji: '🔫',
    tagline: 'Hide and seek with a killer! Turn into a barrel, a bush or a couch, sneak into buildings, and survive.',
    howTo: '<b>How to play</b><ul><li>Each round one player is the 🔫 killer (everyone gets a turn). The killer is blind while the others hide.</li><li>Hiders: walk up to a prop and press <b>E</b> to turn into it, or hide inside buildings — roofs block the killer’s view.</li><li>Every 30 seconds the killer gets a 📡 ping of roughly where everyone is.</li><li>Killer: aim with the mouse and click to shoot. Shooting a real prop wastes a bullet!</li><li>Phone: drag on the left to move, tap on the right to shoot.</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#play-chat'), { title: '💬 Chat' });

  Lobby.on('joined', (m) => {
    const st = m.state;
    S.settings = st.settings; S.scores = st.scores || {}; S.final = st.final; S.last = st.last;
    if (st.round && ['hiding', 'hunting', 'roundover'].includes(st.phase)) {
      startRound(st.round, st.you, st.scores);
      S.phase = st.phase;
      if (st.phase === 'roundover' && st.last) roundOverCard(st.last);
      route();
    } else { S.phase = st.phase; S.round = null; route(); }
  });
  Lobby.on('players', () => { if ($('#play').classList.contains('hidden')) renderRoomMain(); else renderScores(); });
  Lobby.on('left', () => { S.phase = 'lobby'; S.round = null; map = null; });

  Net.on('g:settings', (m) => { S.settings = m.settings; renderRoomMain(); });
  Net.on('g:toast', (m) => UI.toast(m.text, '', 2600));
  Net.on('g:round', (m) => {
    S.final = null;
    startRound(m.round, m.you, m.scores);
    const killer = who(m.round.killer);
    if (isKiller()) { UI.toast('🔫 You’re the killer this round! Wait for it…', 'bad', 3500); snd(() => Sfx.play('boom')); }
    else if (me.role === 'hider') { UI.toast(`🏃 HIDE! ${killer.name} is the killer!`, 'good', 3500); snd(() => Sfx.play('go')); }
    if (FX.banner) FX.banner(`ROUND ${m.round.n} · ${(THEMES[m.round.theme] || THEMES.town).name}`, isKiller() ? 'You’re the killer 🔫' : `${killer.name} is the killer`, { color: isKiller() ? '#f43f5e' : '#22d3ee', hold: 1.2 });
  });
  Net.on('g:hunt', (m) => {
    S.phase = 'hunting';
    endsAt = performance.now() + m.left * 1000;
    pingAt = performance.now() + 30000;
    center('');
    renderBottom();
    snd(() => Sfx.play('go'));
    addFeed(isKiller() ? '🔫 Go find them!' : '🔫 The hunt is on!');
  });
  Net.on('g:snap', (m) => {
    if (!map) return;
    const now = performance.now();
    const seen = new Set();
    for (const e of m.e) {
      const [id, x, y, prop, a, as, decoy] = e;
      let en = ents.get(id);
      if (!en) { en = { s: [], as: as || null, decoy: !!decoy }; ents.set(id, en); }
      const prev = en.s[en.s.length - 1];
      if (prev && Math.hypot(prev[1] - x, prev[2] - y) > 220) en.s.length = 0;   // jumped (respawn): don't slide
      en.s.push([now, x, y, a == null ? null : a]);
      if (en.s.length > 8) en.s.shift();
      en.prop = prop || null;
      seen.add(id);
    }
    for (const id of [...ents.keys()]) if (!seen.has(id)) ents.delete(id);
    if (m.ph && m.ph !== S.phase && inRound()) { S.phase = m.ph; renderBottom(); }
    const ends = now + m.tl * 1000;
    if (Math.abs(ends - endsAt) > 400) endsAt = ends;
    aliveCount = m.alive;
    if (m.ammo != null && !me.reloading && Math.abs(m.ammo - me.ammo) > 0 && performance.now() - lastShot > 600) { me.ammo = m.ammo; renderBottom(); }
  });
  Net.on('g:fix', (m) => { me.x = m.x; me.y = m.y; });
  Net.on('g:ammo', (m) => { me.ammo = m.ammo; me.reloading = m.reloading; renderBottom(); if (!m.reloading && m.ammo === MAG) snd(() => Sfx.tone(660, 0.08, 'triangle', 0.06)); });
  Net.on('g:disguised', (m) => {
    me.prop = m.prop;
    [me.x, me.y] = collide(me.x, me.y, myR());
    snd(() => Sfx.play(m.prop ? 'pop' : 'boing'));
    if (m.prop) puffs.push({ x: me.x, y: me.y, r: 40, t: performance.now(), life: 450, color: 'rgba(255,255,255,A)' });
    hudKey = '';
    renderBottom();
  });
  Net.on('g:shot', (m) => {
    const t = performance.now();
    shots.push({ ...m, t });
    if (m.hit === 'prop' || m.hit === 'wall') puffs.push({ x: m.x1, y: m.y1, r: 12, t, life: 350, color: 'rgba(255,240,200,A)' });
    const v = viewer(t);
    const d = Math.hypot(m.x0 - v.x, m.y0 - v.y);
    const vol = Math.max(0.03, 0.22 * (1 - d / 1400));
    snd(() => { Sfx.noise(0.16, vol, 0, 400); Sfx.tone(150, 0.1, 'square', vol * 0.35, -70); });
  });
  Net.on('g:caught', (m) => {
    S.scores = m.scores;
    if (S.round) S.round.caught = [...(S.round.caught || []), m.id];
    aliveCount = m.left;
    puffs.push({ x: m.x, y: m.y, r: 46, t: performance.now(), life: 900, color: 'rgba(244,63,94,A)', emoji: '💥' });
    addFeed(`🔫 ${m.killer} caught ${m.avatar} ${m.name}${m.prop ? ' (' + (PROPS[m.prop] || m.prop) + ')' : ''}!`);
    if (m.id === Net.id) {
      me.alive = false;
      me.prop = null;
      snd(() => Sfx.play('lose'));
      center('caught', h('div', { class: 'big' }, '💀 You got caught!'), h('p', {}, `+${m.pts} point${m.pts === 1 ? '' : 's'}. Now you’re watching the killer 👀`));
      setTimeout(() => { if (centerKind === 'caught') center(''); }, 3200);
    } else snd(() => Sfx.play(isKiller() ? 'coin' : 'boom'));
    hudKey = '';
    renderScores();
    renderBottom();
  });
  Net.on('g:powers', (m) => {
    me.powers = m.powers;
    if (m.used === 'boost') { me.boostUntil = performance.now() + m.boost * 1000; snd(() => Sfx.tone(500, 0.25, 'sawtooth', 0.05, 600)); }
    if (m.used === 'decoy') { snd(() => Sfx.play('pop')); addFeed('🪞 Decoy placed — now sneak away!'); }
    renderBottom();
  });
  Net.on('g:grenade', (m) => {
    grenades.push({ ...m, t: performance.now() });
    snd(() => Sfx.tone(700, 0.15, 'triangle', 0.05, -300));
  });
  Net.on('g:boom', (m) => {
    const t = performance.now();
    puffs.push({ x: m.x, y: m.y, r: m.r, t, life: 700, color: 'rgba(251,146,60,A)', emoji: '💥' });
    puffs.push({ x: m.x, y: m.y, r: m.r * 0.6, t, life: 400, color: 'rgba(254,240,138,A)' });
    const v = viewer(t);
    if (Math.hypot(m.x - v.x, m.y - v.y) < 1200) snd(() => Sfx.play('boom'));
  });
  Net.on('g:decoy', (m) => {
    puffs.push({ x: m.x, y: m.y, r: 30, t: performance.now(), life: 600, color: 'rgba(165,243,252,A)', emoji: '💨' });
    if (isKiller()) addFeed('💨 That was just a decoy!');
    else if (m.owner === Net.id) addFeed('💨 The killer shot your decoy!');
  });
  Net.on('g:pingsoon', () => { pingSoon = true; addFeed('📡 Ping in 3 seconds — keep still or move!'); snd(() => Sfx.play('tick')); });
  Net.on('g:ping', (m) => {
    pings.push({ spots: m.spots, r: m.radius, t: performance.now() });
    pingAt = performance.now() + 30000;
    addFeed(`📡 ${m.radar ? 'Radar' : 'Ping'}! ${m.spots.length} hider${m.spots.length === 1 ? '' : 's'} nearby the red circles`);
    snd(() => { Sfx.tone(900, 0.12, 'sine', 0.08); Sfx.tone(1200, 0.18, 'sine', 0.07, 0, 0.12); });
  });
  Net.on('g:pinged', (m) => {
    pingSoon = false;
    if (!m.radar) pingAt = performance.now() + 30000;
    addFeed(m.radar ? '📡 The killer used their radar — they know roughly where you are!' : '📡 The killer just got a ping of roughly where you are!');
    snd(() => Sfx.tone(500, 0.2, 'sawtooth', 0.04, -200));
  });
  Net.on('g:roundover', (m) => {
    S.phase = 'roundover';
    S.last = m.last;
    S.scores = m.scores;
    reveal = { t: performance.now(), spots: m.last.spots || {}, props: m.last.props || {} };
    hudKey = '';
    renderScores();
    renderBottom();
    roundOverCard(m.last);
    const mine = m.last.gained[Net.id];
    if (mine != null) snd(() => Sfx.play(mine >= 5 ? 'win' : 'coin'));
    if (m.last.why === 'all' && FX.rain) FX.rain('💀', 14);
  });
  Net.on('g:over', (m) => {
    S.phase = 'over';
    S.final = m.ranking;
    S.scores = m.scores;
    S.round = null;
    map = null;
    route();
    if (m.ranking[0] && m.ranking[0].id === Net.id) { UI.confetti(220); Sfx.play('win'); }
  });
})();
