/* Neon Flappy — tap to flap through glowing pipes, solo or in an online "Flappy Royale".
   The level and the bird's physics are in flappy-core.js (fixed 120 Hz steps, so it feels the same
   at 60, 120 or 144 Hz); this file draws everything on a 2D canvas and runs the menus and rounds. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store, Account, Profile, Unlocks } = PA;
  const FX = PA.FX || {};
  const C = window.FlappyCore;
  const P = C.P;
  const TAU = Math.PI * 2;
  const qs = new URLSearchParams(location.search);

  // ------------------------------------------------------------------ looks
  const NEON = ['#22d3ee', '#ff4fd8', '#a3e635', '#facc15', '#a78bfa', '#fb923c'];
  const SKINS = [
    { id: 'classic', name: 'Classic', need: 0, hi: '#fff6b0', base: '#ffd23f', dark: '#f08a00', belly: '#fff3c4', wing: '#ffb21e', beak: '#ff7b29', line: '#a85400', glow: '#facc15' },
    { id: 'robot', name: 'Robot', need: 10, hi: '#f1f5f9', base: '#a7b4c6', dark: '#4b5869', belly: '#cbd5e1', wing: '#7c8aa0', beak: '#64748b', line: '#2c3644', glow: '#22d3ee' },
    { id: 'ghost', name: 'Ghost', need: 25, hi: '#ffffff', base: '#ece9ff', dark: '#b7aef0', belly: '#ffffff', wing: '#d9d3ff', beak: '#c4b5fd', line: '#7c6fd6', glow: '#c4b5fd' },
    { id: 'golden', name: 'Golden', need: 50, hi: '#fffbe0', base: '#ffd43b', dark: '#b7791f', belly: '#fff1a8', wing: '#f5b700', beak: '#ff9a1f', line: '#8a5a00', glow: '#fde047' },
  ];
  const SKIN = Object.fromEntries(SKINS.map((s) => [s.id, s]));
  const MEDAL_COL = { bronze: '#f59e5b', silver: '#e2e8f0', gold: '#facc15', diamond: '#67e8f9' };
  const rgbaCache = new Map();
  const rgba = (hex, a) => {
    let c = rgbaCache.get(hex);
    if (!c) { const n = parseInt(hex.slice(1), 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbaCache.set(hex, c); }
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  };
  const calm = () => document.documentElement.classList.contains('calm');
  const bestEver = () => store.get('flappy_best', 0);
  const unlocked = (s) => bestEver() >= s.need;
  const mySkin = () => { const s = SKIN[store.get('flappy_skin', 'classic')]; return s && unlocked(s) ? s.id : 'classic'; };

  // the Halloween event gives the level a spooky look (?spooky=1 / 0 forces it on or off)
  let spooky = qs.get('spooky') === '1';
  if (qs.get('spooky') == null) {
    Unlocks.activeEvents().then((evs) => { if (evs.some((e) => /halloween/i.test(e.id))) { spooky = true; layers.key = ''; renderHud(); } }).catch(() => {});
  }

  // ------------------------------------------------------------------ canvas
  const stage = $('#stage');
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  let S = 1; let VW = 800; let BX = 220;   // device px per world unit, visible world width, the bird's screen x
  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // a very tall, narrow stage (a portrait phone in full screen) would show less than one pipe ahead:
    // keep the view at most 1.35x as tall as it is wide (the page's CSS caps the stage the same way)
    const ch = Math.min(r.height, Math.round(r.width * 1.35));
    cv.style.height = ch < r.height ? ch + 'px' : '';
    cv.style.marginTop = ch < r.height ? Math.floor((r.height - ch) / 2) + 'px' : '';
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(ch * dpr);
    S = cv.height / P.H;
    VW = cv.width / S;
    BX = Math.round(Math.min(VW * (VW < 600 ? 0.22 : 0.3), 260));   // narrow views: the bird sits further left to see more ahead
    layers.key = '';
  }
  new ResizeObserver(resize).observe(stage);

  // ------------------------------------------------------------------ game state
  const G = {
    mode: 'solo', phase: 'ready', L: null, bird: C.newBird(), prevY: P.START_Y, acc: 0, flapQ: false,
    camX: 0, lastCam: 0, bgX: 0, rot: 0, wing: 0, sq: 0, sqV: 0, trail: [], parts: [], shake: 0, flash: 0,
    pop: 0, medalPop: null, deadAt: 0, cardAt: 0, over: null, god: false, cheated: false, seed: 0,
    goAt: 0, sentAt: 0, round: null, ghosts: new Map(), frozen: false, deathX: 0, fallY: 0, fallV: 0, paused: false,
    bats: [], batAt: 0, seenScore: 0,
  };
  const state = { phase: 'lobby', settings: { rounds: 3 }, round: null, standings: [], roundRows: null, results: null };

  const shown = (id) => !$('#' + id).classList.contains('hidden');

  // ------------------------------------------------------------------ the bird
  function drawBird(c, x, y, o) {
    const sk = SKIN[o.skin] || SKIN.classic;
    const t = o.t || 0;
    c.save();
    c.translate(x, y);
    c.rotate(o.rot || 0);
    const sq = o.sq || 0;
    c.scale(1 - sq * 0.55, 1 + sq);
    c.globalAlpha = o.alpha == null ? 1 : o.alpha;
    // glow
    const gr = o.glow || 36;
    const gl = c.createRadialGradient(0, 0, 4, 0, 0, gr);
    gl.addColorStop(0, rgba(sk.glow, 0.42));
    gl.addColorStop(1, rgba(sk.glow, 0));
    c.fillStyle = gl;
    c.beginPath(); c.arc(0, 0, gr, 0, TAU); c.fill();
    // body
    const bg = c.createRadialGradient(-6, -8, 2, 0, 0, 20);
    bg.addColorStop(0, sk.hi); bg.addColorStop(0.45, sk.base); bg.addColorStop(1, sk.dark);
    c.fillStyle = bg;
    c.strokeStyle = sk.line;
    c.lineWidth = 1.6;
    c.beginPath();
    if (sk.id === 'ghost') {
      c.arc(0, -1, 17, Math.PI, 0);
      c.lineTo(17, 12);
      const wav = Math.sin(t * 9) * 1.6;
      for (let k = 0; k < 4; k++) {
        const x0 = 17 - (k + 0.5) * 8.5;
        c.quadraticCurveTo(x0 + 2, 19 + (k % 2 ? wav : -wav), 17 - (k + 1) * 8.5, 12);
      }
      c.closePath();
    } else c.arc(0, 0, 17, 0, TAU);
    c.fill(); c.stroke();
    // golden shine sweeping across
    if (sk.id === 'golden') {
      c.save(); c.clip();
      const sx = ((t * 40) % 70) - 35;
      const sh = c.createLinearGradient(sx - 8, -17, sx + 8, 17);
      sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,.75)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = sh; c.fillRect(-20, -20, 40, 40);
      c.restore();
    }
    // belly
    if (sk.id !== 'robot') {
      c.fillStyle = rgba(sk.belly, 0.85);
      c.beginPath(); c.ellipse(3, 7, 10, 6.5, -0.15, 0, TAU); c.fill();
    } else {
      c.fillStyle = '#5b6779';
      c.beginPath(); c.roundRect(-6, 3, 13, 8, 2); c.fill();
      c.fillStyle = '#facc15'; c.fillRect(-4, 6, 3, 2);
      c.fillStyle = '#22d3ee'; c.fillRect(1, 6, 4, 2);
      c.fillStyle = '#2c3644';
      for (const [rx, ry] of [[-12, -4], [-11, 7], [12, 9]]) { c.beginPath(); c.arc(rx, ry, 1.2, 0, TAU); c.fill(); }
    }
    // wing
    const wa = -0.35 + Math.sin(o.wing || 0) * 0.85;
    c.save();
    c.translate(-5, 2);
    c.rotate(wa);
    c.fillStyle = sk.wing;
    c.strokeStyle = sk.line;
    c.lineWidth = 1.3;
    c.beginPath(); c.ellipse(-5, 0, 10, 6.5, 0, 0, TAU); c.fill(); c.stroke();
    c.restore();
    // face
    if (sk.id === 'robot') {
      c.fillStyle = '#0b1220';
      c.beginPath(); c.roundRect(-1, -12, 18, 10, 4); c.fill();
      const scan = o.dead ? 0 : (Math.sin(t * 5) + 1) / 2;
      c.fillStyle = o.dead ? '#f43f5e' : '#22d3ee';
      c.shadowColor = c.fillStyle; c.shadowBlur = 0;
      c.fillRect(2, -8.5, 12, 3);
      c.fillStyle = '#ecfeff';
      if (!o.dead) { c.beginPath(); c.arc(3 + scan * 10, -7, 1.7, 0, TAU); c.fill(); }
      // antenna
      c.strokeStyle = '#2c3644'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(-2, -16); c.lineTo(-4, -25); c.stroke();
      c.fillStyle = Math.sin(t * 6) > 0 || o.dead ? '#f43f5e' : '#7f1d1d';
      c.beginPath(); c.arc(-4, -26, 2.6, 0, TAU); c.fill();
    } else if (sk.id === 'ghost') {
      c.fillStyle = '#1b1035';
      if (o.dead) xEyes(c, [4, 11], -5);
      else {
        c.beginPath(); c.ellipse(4, -5, 2.6, 3.8, 0, 0, TAU); c.ellipse(11.5, -5, 2.6, 3.8, 0, 0, TAU); c.fill();
        c.beginPath(); c.ellipse(8.5, 4, 2.4, 3, 0, 0, TAU); c.fill();
      }
      c.fillStyle = 'rgba(244,114,182,.45)';
      c.beginPath(); c.ellipse(0, 1, 3, 1.8, 0, 0, TAU); c.ellipse(14.5, 1, 2.4, 1.6, 0, 0, TAU); c.fill();
    } else {
      // eye
      c.fillStyle = '#fff';
      c.strokeStyle = sk.line;
      c.lineWidth = 1.2;
      c.beginPath(); c.arc(6.5, -6, 6.6, 0, TAU); c.fill(); c.stroke();
      if (o.dead) { c.fillStyle = '#1b1035'; xEyes(c, [7], -6); } else {
        c.fillStyle = '#1b1035';
        c.beginPath(); c.arc(8.6, -5.6, 3.2, 0, TAU); c.fill();
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(9.6, -7, 1.2, 0, TAU); c.fill();
      }
      c.fillStyle = 'rgba(255,105,180,.42)';
      c.beginPath(); c.ellipse(3, 4, 3.6, 2.1, 0, 0, TAU); c.fill();
    }
    // beak
    if (sk.id !== 'ghost') {
      c.fillStyle = sk.beak;
      c.strokeStyle = sk.line;
      c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(12, -2.5); c.quadraticCurveTo(24, -1, 23, 2.5); c.lineTo(12, 2.5); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = rgba(sk.line, 0.55);
      c.beginPath(); c.moveTo(12.5, 2.5); c.lineTo(21, 2.5); c.quadraticCurveTo(18, 6.5, 12.5, 6); c.closePath(); c.fill();
    }
    // golden crown
    if (sk.id === 'golden') {
      c.fillStyle = '#ffe066';
      c.strokeStyle = '#8a5a00';
      c.lineWidth = 1.1;
      c.beginPath();
      c.moveTo(-9, -14); c.lineTo(-10, -24); c.lineTo(-5, -19); c.lineTo(-1, -26); c.lineTo(3, -19); c.lineTo(8, -23); c.lineTo(6, -14);
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#f43f5e'; c.beginPath(); c.arc(-1, -18, 1.6, 0, TAU); c.fill();
    }
    c.restore();
  }
  function xEyes(c, xs, y) {
    c.save();
    c.strokeStyle = '#1b1035';
    c.lineWidth = 2;
    c.lineCap = 'round';
    for (const x of xs) {
      c.beginPath(); c.moveTo(x - 2.6, y - 2.6); c.lineTo(x + 2.6, y + 2.6); c.moveTo(x + 2.6, y - 2.6); c.lineTo(x - 2.6, y + 2.6); c.stroke();
    }
    c.restore();
  }
  const rotFor = (vy) => (vy < 0 ? -0.42 : Math.min(1.45, -0.42 + (vy / P.MAX_FALL) * 2.1));

  // ------------------------------------------------------------------ backgrounds (drawn once per size into canvases)
  const layers = { key: '', far: null, near: null, sun: null, stars: [] };
  function makeCanvas(w, hh) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(hh)); return c; }
  function buildLayers() {
    const key = [cv.width, cv.height, spooky].join();
    if (layers.key === key) return;
    layers.key = key;
    layers.far = skyline(960, 'far');
    layers.near = skyline(1240, 'near');
    layers.sun = spooky ? moonCanvas() : sunCanvas();
    const rnd = C.mulberry32(7);
    layers.stars = Array.from({ length: Math.round((VW + 200) * P.FLOOR / 2600) }, () => ({
      x: rnd() * (VW + 200), y: rnd() * P.FLOOR * 0.78, r: 0.5 + rnd() * 1.3, tw: rnd() * TAU, sp: 0.6 + rnd() * 2.2,
      c: rnd() < 0.2 ? (spooky ? '#c4b5fd' : '#a5f3fc') : rnd() < 0.3 ? (spooky ? '#fdba74' : '#f9a8d4') : '#ffffff',
    }));
  }
  function skyline(tileW, which) {
    const c = makeCanvas(tileW * S, P.FLOOR * S);
    const x = c.getContext('2d');
    x.scale(S, S);
    const rnd = C.mulberry32(which === 'far' ? 11 : 23);
    if (spooky) spookyLayer(x, tileW, which, rnd); else cityLayer(x, tileW, which, rnd);
    return { c, w: tileW };
  }
  function cityLayer(x, tileW, which, rnd) {
    const far = which === 'far';
    const list = [];
    let bx = 0;
    while (bx < tileW - 20) {
      const w = far ? 34 + rnd() * 74 : 48 + rnd() * 92;
      const hh = far ? 90 + rnd() * 190 : 50 + rnd() * 150;
      list.push({ x: bx, w, hh, roof: rnd(), neon: NEON[Math.floor(rnd() * NEON.length)], seed: rnd() * 1e9 });
      bx += w + (far ? rnd() * 10 : 8 + rnd() * 30);
    }
    for (const off of [-tileW, 0, tileW]) {
      for (const b of list) {
        const L = off + b.x; const top = P.FLOOR - b.hh;
        const r = C.mulberry32(b.seed);
        const body = x.createLinearGradient(0, top, 0, P.FLOOR);
        body.addColorStop(0, far ? '#22155a' : '#150d3a');
        body.addColorStop(1, far ? '#160c3e' : '#0a0620');
        x.fillStyle = body;
        x.beginPath();
        if (b.roof < 0.25) { x.moveTo(L, P.FLOOR); x.lineTo(L, top + 14); x.lineTo(L + b.w * 0.5, top); x.lineTo(L + b.w, top + 14); x.lineTo(L + b.w, P.FLOOR); }
        else if (b.roof < 0.45) { x.rect(L, top + 12, b.w, b.hh - 12); x.rect(L + b.w * 0.2, top, b.w * 0.6, 14); }
        else x.rect(L, top, b.w, b.hh);
        x.fill();
        if (b.roof > 0.82) {   // antenna with a red light
          x.strokeStyle = far ? '#2c1d6b' : '#241a55'; x.lineWidth = 1.5;
          x.beginPath(); x.moveTo(L + b.w * 0.5, top); x.lineTo(L + b.w * 0.5, top - 26); x.stroke();
          x.fillStyle = 'rgba(244,63,94,.9)'; x.beginPath(); x.arc(L + b.w * 0.5, top - 27, 2, 0, TAU); x.fill();
        }
        // windows
        const ww = far ? 3 : 4; const wh = far ? 4 : 6; const gx = far ? 7 : 10; const gy = far ? 9 : 13;
        for (let wy = top + 14; wy < P.FLOOR - 8; wy += gy) {
          for (let wx = L + 5; wx < L + b.w - 6; wx += gx) {
            const v = r();
            if (v < (far ? 0.32 : 0.26)) {
              const warm = r() < 0.6;
              x.fillStyle = warm ? `rgba(255,214,140,${far ? 0.22 + r() * 0.2 : 0.45 + r() * 0.4})` : `rgba(130,230,255,${far ? 0.2 + r() * 0.2 : 0.4 + r() * 0.4})`;
              x.fillRect(wx, wy, ww, wh);
            }
          }
        }
        if (!far) {
          // a neon line along the roof, and now and then a glowing sign
          x.save();
          x.globalCompositeOperation = 'lighter';
          for (const [lw, a] of [[7, 0.08], [3.5, 0.22], [1.4, 0.95]]) {
            x.strokeStyle = rgba(b.neon, a); x.lineWidth = lw;
            x.beginPath();
            if (b.roof < 0.25) { x.moveTo(L, top + 14); x.lineTo(L + b.w * 0.5, top); x.lineTo(L + b.w, top + 14); } else { x.moveTo(L, top + (b.roof < 0.45 ? 12 : 0)); x.lineTo(L + b.w, top + (b.roof < 0.45 ? 12 : 0)); }
            x.stroke();
          }
          if (b.roof > 0.55 && b.roof < 0.75 && b.hh > 90) {
            const sx = L + b.w * 0.5 - 5; const sy = top + 22; const sh = Math.min(70, b.hh - 40);
            for (const [lw, a] of [[8, 0.1], [4, 0.25], [1.6, 1]]) { x.strokeStyle = rgba(b.neon, a); x.lineWidth = lw; x.strokeRect(sx, sy, 10, sh); }
            x.fillStyle = rgba(b.neon, 0.18); x.fillRect(sx, sy, 10, sh);
          }
          x.restore();
        }
      }
    }
  }
  function deadTree(x, bx, by, size, rnd, col) {
    x.strokeStyle = col; x.lineCap = 'round';
    const branch = (px, py, ang, len, w, depth) => {
      const ex = px + Math.cos(ang) * len; const ey = py + Math.sin(ang) * len;
      x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
      if (depth <= 0) return;
      const n = 2 + (rnd() < 0.35 ? 1 : 0);
      for (let k = 0; k < n; k++) branch(ex, ey, ang + (rnd() - 0.5) * 1.5, len * (0.55 + rnd() * 0.2), w * 0.62, depth - 1);
    };
    branch(bx, by, -Math.PI / 2 + (rnd() - 0.5) * 0.3, size, size * 0.14, 4);
  }
  function spookyLayer(x, tileW, which, rnd) {
    const far = which === 'far';
    const k1 = Math.floor(2 + rnd() * 2); const k2 = Math.floor(4 + rnd() * 3); const ph = rnd() * TAU;
    const hill = (px) => P.FLOOR - (far ? 70 : 22) - Math.sin((px / tileW) * TAU * k1 + ph) * (far ? 34 : 10) - Math.sin((px / tileW) * TAU * k2) * (far ? 14 : 6);
    const col = far ? '#1d0f33' : '#0d0717';
    x.fillStyle = col;
    x.beginPath(); x.moveTo(-tileW, P.FLOOR);
    for (let px = -tileW; px <= tileW * 2; px += 8) x.lineTo(px, hill(((px % tileW) + tileW) % tileW));
    x.lineTo(tileW * 2, P.FLOOR); x.closePath(); x.fill();
    const items = [];
    if (far) {
      items.push({ kind: 'house', x: tileW * 0.62 });
      for (let k = 0; k < 7; k++) items.push({ kind: 'tree', x: rnd() * tileW, s: 40 + rnd() * 40, seed: rnd() * 1e9 });
    } else {
      for (let k = 0; k < 16; k++) items.push({ kind: rnd() < 0.7 ? 'stone' : 'cross', x: rnd() * tileW, s: 0.8 + rnd() * 0.6, tilt: (rnd() - 0.5) * 0.3 });
      for (let k = 0; k < 4; k++) items.push({ kind: 'tree', x: rnd() * tileW, s: 70 + rnd() * 50, seed: rnd() * 1e9 });
      for (let k = 0; k < 5; k++) items.push({ kind: 'pumpkin', x: rnd() * tileW, s: 0.8 + rnd() * 0.5 });
      items.push({ kind: 'fence', x: rnd() * tileW, w: 120 + rnd() * 80 });
    }
    for (const off of [-tileW, 0, tileW]) {
      for (const it of items) {
        const px = off + it.x; const gy = hill(it.x) + 2;
        if (it.kind === 'tree') deadTree(x, px, gy, it.s, C.mulberry32(it.seed), col);
        else if (it.kind === 'house') {
          const by = gy + 6;
          x.fillStyle = col;
          x.fillRect(px - 60, by - 90, 120, 90);
          x.fillRect(px - 82, by - 130, 34, 130);
          x.fillRect(px + 40, by - 112, 28, 112);
          x.beginPath(); x.moveTo(px - 88, by - 130); x.lineTo(px - 65, by - 178); x.lineTo(px - 42, by - 130); x.fill();
          x.beginPath(); x.moveTo(px + 35, by - 112); x.lineTo(px + 54, by - 150); x.lineTo(px + 73, by - 112); x.fill();
          x.beginPath(); x.moveTo(px - 66, by - 90); x.lineTo(px, by - 128); x.lineTo(px + 66, by - 90); x.fill();
          x.fillStyle = 'rgba(251,146,60,.85)';
          for (const [wx, wy] of [[-72, -112], [-30, -70], [10, -70], [-30, -40], [48, -92], [20, -40]]) x.fillRect(px + wx, by + wy, 8, 11);
          x.fillStyle = 'rgba(163,230,53,.7)'; x.fillRect(px - 4, by - 116, 8, 9);
        } else if (it.kind === 'stone') {
          x.save(); x.translate(px, gy + 3); x.rotate(it.tilt); x.scale(it.s, it.s);
          x.fillStyle = '#1a1029'; x.strokeStyle = 'rgba(167,139,250,.28)'; x.lineWidth = 1.2;
          x.beginPath(); x.moveTo(-10, 0); x.lineTo(-10, -18); x.arc(0, -18, 10, Math.PI, 0); x.lineTo(10, 0); x.closePath(); x.fill(); x.stroke();
          x.restore();
        } else if (it.kind === 'cross') {
          x.save(); x.translate(px, gy + 3); x.rotate(it.tilt); x.scale(it.s, it.s);
          x.fillStyle = '#1a1029'; x.fillRect(-2.5, -30, 5, 30); x.fillRect(-10, -22, 20, 5);
          x.restore();
        } else if (it.kind === 'pumpkin') {
          x.save(); x.translate(px, gy - 3); x.scale(it.s, it.s);
          const pg = x.createRadialGradient(0, 0, 2, 0, 0, 30); pg.addColorStop(0, 'rgba(251,146,60,.35)'); pg.addColorStop(1, 'rgba(251,146,60,0)');
          x.fillStyle = pg; x.beginPath(); x.arc(0, 0, 30, 0, TAU); x.fill();
          x.fillStyle = '#ea580c'; x.beginPath(); x.ellipse(0, 0, 9, 7, 0, 0, TAU); x.fill();
          x.fillStyle = '#c2410c'; x.beginPath(); x.ellipse(0, 0, 3.5, 7, 0, 0, TAU); x.fill();
          x.fillStyle = '#4d7c0f'; x.fillRect(-1, -10, 2.4, 4);
          x.fillStyle = '#fde047';
          x.beginPath(); x.moveTo(-5, -2); x.lineTo(-2.5, -4.5); x.lineTo(-1, -1.5); x.fill();
          x.beginPath(); x.moveTo(5, -2); x.lineTo(2.5, -4.5); x.lineTo(1, -1.5); x.fill();
          x.beginPath(); x.moveTo(-5, 2); x.lineTo(5, 2); x.lineTo(3, 4.5); x.lineTo(0, 3); x.lineTo(-3, 4.5); x.fill();
          x.restore();
        } else if (it.kind === 'fence') {
          x.strokeStyle = '#120a1f'; x.lineWidth = 2;
          x.beginPath(); x.moveTo(px, gy - 16); x.lineTo(px + it.w, gy - 16); x.moveTo(px, gy - 6); x.lineTo(px + it.w, gy - 6); x.stroke();
          x.fillStyle = '#120a1f';
          for (let fx = px; fx <= px + it.w; fx += 9) { x.fillRect(fx - 1.2, gy - 24, 2.4, 24); x.beginPath(); x.moveTo(fx - 3, gy - 24); x.lineTo(fx, gy - 30); x.lineTo(fx + 3, gy - 24); x.fill(); }
        }
      }
    }
  }
  function sunCanvas() {
    const R = 128;
    const c = makeCanvas(R * 3 * S, R * 3 * S);
    const x = c.getContext('2d');
    x.scale(S, S);
    x.translate(R * 1.5, R * 1.5);
    const glow = x.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 1.5);
    glow.addColorStop(0, 'rgba(255,79,216,.35)'); glow.addColorStop(1, 'rgba(255,79,216,0)');
    x.fillStyle = glow; x.beginPath(); x.arc(0, 0, R * 1.5, 0, TAU); x.fill();
    const g = x.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, '#fff27a'); g.addColorStop(0.45, '#ff9a3d'); g.addColorStop(1, '#ff2fb3');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fill();
    // the retro stripes
    x.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 9; k++) { const y = R * 0.05 + k * k * 1.5 + k * 9; x.fillRect(-R, y, R * 2, 2 + k * 0.9); }
    return { c, R: R * 1.5 };
  }
  function moonCanvas() {
    const R = 74;
    const c = makeCanvas(R * 4 * S, R * 4 * S);
    const x = c.getContext('2d');
    x.scale(S, S);
    x.translate(R * 2, R * 2);
    const glow = x.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 2);
    glow.addColorStop(0, 'rgba(251,146,60,.45)'); glow.addColorStop(0.5, 'rgba(234,88,12,.12)'); glow.addColorStop(1, 'rgba(234,88,12,0)');
    x.fillStyle = glow; x.beginPath(); x.arc(0, 0, R * 2, 0, TAU); x.fill();
    const g = x.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
    g.addColorStop(0, '#ffe2a8'); g.addColorStop(0.55, '#ffab40'); g.addColorStop(1, '#e8620c');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fill();
    x.fillStyle = 'rgba(160,60,10,.18)';
    for (const [cx, cy, cr] of [[-20, -14, 14], [24, 10, 18], [-8, 30, 10], [30, -28, 8], [-38, 16, 7]]) { x.beginPath(); x.arc(cx, cy, cr, 0, TAU); x.fill(); }
    return { c, R: R * 2 };
  }

  // ------------------------------------------------------------------ drawing a frame
  function glowStroke(c, path, col, scale = 1) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const [w, a] of [[11, 0.06], [6, 0.14], [3, 0.42], [1.5, 1]]) {
      c.lineWidth = w * scale; c.strokeStyle = rgba(col, a);
      path(); c.stroke();
    }
    c.lineWidth = 0.7 * scale; c.strokeStyle = 'rgba(255,255,255,.55)'; path(); c.stroke();
    c.restore();
  }
  function neonPipe(c, x, y0, y1, col, lipY, lipDown) {
    const w = P.PW;
    c.fillStyle = '#0c0824';
    c.fillRect(x, y0, w, y1 - y0);
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, rgba(col, 0.1)); g.addColorStop(0.28, rgba(col, 0.34)); g.addColorStop(0.55, rgba(col, 0.12)); g.addColorStop(1, rgba(col, 0.05));
    c.fillStyle = g;
    c.fillRect(x, y0, w, y1 - y0);
    // tube bands
    c.fillStyle = rgba(col, 0.1);
    for (let y = lipDown ? lipY + 50 : lipY - 60; lipDown ? y < y1 : y > y0; y += lipDown ? 64 : -64) c.fillRect(x, y, w, 3);
    c.fillStyle = 'rgba(255,255,255,.16)';
    c.fillRect(x + 12, y0, 3, y1 - y0);
    // the lip at the gap
    const ly = lipDown ? lipY : lipY - 26;
    c.fillStyle = '#100b2e';
    c.fillRect(x - 6, ly, w + 12, 26);
    const lg = c.createLinearGradient(x - 6, 0, x + w + 6, 0);
    lg.addColorStop(0, rgba(col, 0.25)); lg.addColorStop(0.3, rgba(col, 0.55)); lg.addColorStop(1, rgba(col, 0.15));
    c.fillStyle = lg;
    c.fillRect(x - 6, ly, w + 12, 26);
    glowStroke(c, () => { c.beginPath(); c.rect(x, y0 - 2, w, y1 - y0 + 4); }, col);
    glowStroke(c, () => { c.beginPath(); c.roundRect(x - 6, ly, w + 12, 26, 4); }, col);
  }
  function tombPipe(c, x, y0, y1, lipY, lipDown) {
    const w = P.PW;
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#231c35'); g.addColorStop(0.35, '#463c60'); g.addColorStop(1, '#1f1930');
    c.fillStyle = g;
    c.fillRect(x, y0, w, y1 - y0);
    // stone blocks
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.2;
    c.beginPath();
    let row = 0;
    for (let y = lipDown ? y0 : y1; lipDown ? y < y1 : y > y0; y += lipDown ? 24 : -24, row++) {
      c.moveTo(x, y); c.lineTo(x + w, y);
      const vx = x + (row % 2 ? w * 0.33 : w * 0.66);
      c.moveTo(vx, y); c.lineTo(vx, y + (lipDown ? 24 : -24));
    }
    c.stroke();
    // moss
    c.fillStyle = 'rgba(132,204,22,.35)';
    for (let k = 0; k < 3; k++) { const my = lipDown ? lipY + 60 + k * 90 : lipY - 60 - k * 90; if (my > y0 && my < y1) { c.beginPath(); c.ellipse(x + (k % 2 ? w - 4 : 4), my, 5, 12, 0, 0, TAU); c.fill(); } }
    glowStroke(c, () => { c.beginPath(); c.rect(x, y0 - 2, w, y1 - y0 + 4); }, '#84cc16', 0.55);
    // the tombstone at the gap (a flat arch, so it matches the hitbox)
    const tw = w + 16; const th = 50; const tx = x - 8; const ah = 16;
    const tomb = () => {
      c.beginPath();
      if (lipDown) { c.moveTo(tx, lipY + th); c.lineTo(tx, lipY + ah); c.ellipse(tx + tw / 2, lipY + ah, tw / 2, ah, 0, Math.PI, 0); c.lineTo(tx + tw, lipY + th); }
      else { c.moveTo(tx, lipY - th); c.lineTo(tx, lipY - ah); c.ellipse(tx + tw / 2, lipY - ah, tw / 2, ah, 0, Math.PI, 0, true); c.lineTo(tx + tw, lipY - th); }
    };
    tomb(); c.closePath();
    const sg = c.createLinearGradient(tx, 0, tx + tw, 0);
    sg.addColorStop(0, '#4a4166'); sg.addColorStop(0.4, '#71679a'); sg.addColorStop(1, '#3b3354');
    c.fillStyle = sg; c.fill();
    c.strokeStyle = '#1b1530'; c.lineWidth = 2; c.stroke();
    glowStroke(c, tomb, '#a3e635', 0.6);
    c.fillStyle = 'rgba(20,12,36,.7)';
    c.font = '15px Bungee, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('RIP', x + w / 2, lipDown ? lipY + 30 : lipY - 30);
    c.fillStyle = 'rgba(255,255,255,.18)';
    c.fillText('RIP', x + w / 2 - 0.8, (lipDown ? lipY + 30 : lipY - 30) - 0.8);
  }
  function pipeColor(p) { return NEON[Math.floor(p.hue * NEON.length) % NEON.length]; }
  function drawPipes(c) {
    const L = G.L;
    if (!L) return;
    const left = G.camX - BX - P.PW;
    for (let i = L.firstAfter(left); ; i++) {
      const p = L.pipe(i);
      const sx = BX + (p.cx - G.camX);
      if (sx - P.PW > VW + 20) break;
      const x = sx - P.PW / 2;
      if (spooky) { tombPipe(c, x, -20, p.top - 30, p.top, false); tombPipe(c, x, p.bottom + 30, P.FLOOR + 2, p.bottom, true); }
      else { const col = pipeColor(p); neonPipe(c, x, -20, p.top, col, p.top, false); neonPipe(c, x, p.bottom, P.FLOOR + 2, col, p.bottom, true); }
    }
  }
  function drawSky(c, t) {
    const g = c.createLinearGradient(0, 0, 0, P.FLOOR);
    if (spooky) { g.addColorStop(0, '#05020c'); g.addColorStop(0.45, '#160a2b'); g.addColorStop(0.78, '#3a1150'); g.addColorStop(1, '#6b2210'); }
    else { g.addColorStop(0, '#07041a'); g.addColorStop(0.42, '#1b0a45'); g.addColorStop(0.75, '#54156f'); g.addColorStop(1, '#b8287a'); }
    c.fillStyle = g;
    c.fillRect(0, 0, VW, P.FLOOR);
    // stars
    const off = G.bgX * 0.02;
    const span = VW + 200;
    for (const s of layers.stars) {
      const a = calm() ? 0.7 : 0.45 + Math.sin(t * s.sp + s.tw) * 0.35;
      c.fillStyle = rgba(s.c, Math.max(0.05, a) * (1 - s.y / (P.FLOOR * 0.9)));
      const x = ((s.x - off) % span + span) % span - 100;
      c.fillRect(x, s.y, s.r, s.r);
    }
    // sun / moon
    const sun = layers.sun;
    if (sun) {
      const narrow = VW < 520;
      const cx = VW * (narrow ? 0.78 : 0.7); const cy = spooky ? (narrow ? 196 : 150) : P.FLOOR - 92;
      const R = sun.R * (narrow && spooky ? 0.62 : 1);
      c.drawImage(sun.c, cx - R, cy - R, R * 2, R * 2);
    }
  }
  function drawLayer(c, layer, par) {
    if (!layer) return;
    const off = ((G.bgX * par) % layer.w + layer.w) % layer.w;
    for (let x = -off; x < VW; x += layer.w) c.drawImage(layer.c, x, 0, layer.w, P.FLOOR);
  }
  function drawHaze(c) {
    const g = c.createLinearGradient(0, P.FLOOR - 190, 0, P.FLOOR);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, spooky ? 'rgba(130,40,160,.32)' : 'rgba(255,79,216,.28)');
    c.fillStyle = g;
    c.fillRect(0, P.FLOOR - 190, VW, 190);
  }
  function drawGround(c, t) {
    const g = c.createLinearGradient(0, P.FLOOR, 0, P.H);
    if (spooky) { g.addColorStop(0, '#1a0d24'); g.addColorStop(1, '#050208'); } else { g.addColorStop(0, '#22073f'); g.addColorStop(1, '#06021a'); }
    c.fillStyle = g;
    c.fillRect(0, P.FLOOR, VW, P.H - P.FLOOR);
    const col = spooky ? '#a3e635' : '#ff4fd8';
    // a perspective grid that scrolls with the world
    c.save();
    c.beginPath(); c.rect(0, P.FLOOR, VW, P.H - P.FLOOR); c.clip();
    c.strokeStyle = rgba(spooky ? '#84cc16' : '#ff4fd8', spooky ? 0.2 : 0.38);
    c.lineWidth = 1.2;
    const sp = 46; const off = ((G.bgX % sp) + sp) % sp; const vp = VW * 0.5;
    c.beginPath();
    for (let x = -off - sp * 12; x < VW + sp * 12; x += sp) { c.moveTo(x, P.FLOOR); c.lineTo(vp + (x - vp) * 2.8, P.H); }
    for (let k = 1; k <= 5; k++) { const y = P.FLOOR + (P.H - P.FLOOR) * (k / 5) ** 1.7; c.moveTo(0, y); c.lineTo(VW, y); }
    c.stroke();
    c.restore();
    glowStroke(c, () => { c.beginPath(); c.moveTo(0, P.FLOOR); c.lineTo(VW, P.FLOOR); }, col);
    if (spooky) drawFog(c, t);
  }
  function drawFog(c, t) {
    const n = 6;
    for (let k = 0; k < n; k++) {
      const w = 260 + k * 30;
      const span = VW + w * 2;
      const x = ((k * 233 - G.bgX * 0.8 - (calm() ? 0 : t * (8 + k * 3))) % span + span) % span - w;
      const y = P.FLOOR - 10 + (k % 3) * 18;
      const g = c.createRadialGradient(x, y, 10, x, y, w * 0.5);
      g.addColorStop(0, 'rgba(196,181,253,.16)'); g.addColorStop(1, 'rgba(196,181,253,0)');
      c.fillStyle = g;
      c.beginPath(); c.ellipse(x, y, w * 0.5, 46, 0, 0, TAU); c.fill();
    }
  }
  function drawBats(c, t, dt) {
    if (!spooky || calm()) { G.bats.length = 0; return; }
    if (t > G.batAt) {
      G.batAt = t + 3 + Math.random() * 6;
      const n = 1 + Math.floor(Math.random() * 3);
      const y0 = 60 + Math.random() * 220;
      for (let k = 0; k < n; k++) G.bats.push({ x: VW + 30 + k * 28, y: y0 + (Math.random() - 0.5) * 50, vx: -(110 + Math.random() * 80), ph: Math.random() * TAU, s: 0.7 + Math.random() * 0.6 });
    }
    c.fillStyle = '#0a0612';
    for (const b of G.bats) {
      b.x += b.vx * dt; b.ph += dt * 16;
      const y = b.y + Math.sin(b.ph * 0.25) * 10;
      const f = Math.sin(b.ph);
      c.save(); c.translate(b.x, y); c.scale(b.s, b.s);
      c.beginPath();
      c.moveTo(0, 0);
      c.quadraticCurveTo(-8, -10 * f - 4, -20, -6 * f);
      c.quadraticCurveTo(-14, 0, -10, 3); c.quadraticCurveTo(-6, 1, 0, 4);
      c.quadraticCurveTo(6, 1, 10, 3); c.quadraticCurveTo(14, 0, 20, -6 * f);
      c.quadraticCurveTo(8, -10 * f - 4, 0, 0);
      c.fill();
      c.beginPath(); c.ellipse(0, 1, 3.4, 4.5, 0, 0, TAU); c.fill();
      c.fillStyle = '#f97316'; c.fillRect(-1.8, -0.5, 1.2, 1.2); c.fillRect(0.8, -0.5, 1.2, 1.2); c.fillStyle = '#0a0612';
      c.restore();
    }
    G.bats = G.bats.filter((b) => b.x > -40);
  }
  function drawTrail(c, skin) {
    const tr = G.trail;
    if (tr.length < 2) return;
    const col = SKIN[skin].glow;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const a = i / tr.length;
      c.strokeStyle = rgba(col, a * 0.45);
      c.lineWidth = 2 + a * 10;
      c.beginPath();
      c.moveTo(BX + tr[i - 1].x - G.camX - 8, tr[i - 1].y);
      c.lineTo(BX + tr[i].x - G.camX - 8, tr[i].y);
      c.stroke();
    }
    c.restore();
  }
  function drawParticles(c, dt) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const p of G.parts) {
      p.life -= dt;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const a = Math.max(0, p.life / p.max);
      const x = BX + p.x - G.camX;
      if (p.ring) {
        c.strokeStyle = rgba(p.col, a * 0.8); c.lineWidth = 3 * a + 0.5;
        c.beginPath(); c.arc(x, p.y, p.r + (1 - a) * p.grow, 0, TAU); c.stroke();
      } else if (p.feather) {
        c.save(); c.translate(x, p.y); c.rotate(p.rot += p.spin * dt);
        c.globalCompositeOperation = 'source-over';
        c.fillStyle = rgba(p.col, a); c.beginPath(); c.ellipse(0, 0, 5, 2.2, 0, 0, TAU); c.fill();
        c.restore();
      } else {
        c.fillStyle = rgba(p.col, a);
        c.beginPath(); c.arc(x, p.y, p.r * (0.4 + a * 0.6), 0, TAU); c.fill();
      }
    }
    c.restore();
    G.parts = G.parts.filter((p) => p.life > 0);
  }
  function burst(x, y, col, n, speed = 160) {
    if (calm()) n = Math.ceil(n / 3);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU; const v = speed * (0.4 + Math.random() * 0.8);
      G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, col, r: 2 + Math.random() * 2.5, g: 200 });
    }
  }
  function drawScore(c, t) {
    if (!(G.phase === 'play' || G.phase === 'dead' || G.phase === 'spectate') || !G.L || (G.mode === 'online' && !G.mine)) return;
    const sc = G.bird.score;
    const k = 1 + G.pop * 0.35;
    c.save();
    c.translate(VW / 2, 72);
    c.scale(k, k);
    c.font = '58px Bungee, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 9; c.strokeStyle = 'rgba(10,4,30,.85)'; c.strokeText(String(sc), 0, 0);
    c.save(); c.globalCompositeOperation = 'lighter';
    c.fillStyle = rgba(spooky ? '#fb923c' : '#ff4fd8', 0.35 + G.pop * 0.4);
    c.fillText(String(sc), 0, 2);
    c.restore();
    c.fillStyle = '#ffffff'; c.fillText(String(sc), 0, 0);
    c.restore();
    if (G.medalPop) {
      const age = t - G.medalPop.t;
      if (age > 1.6) G.medalPop = null;
      else {
        const a = Math.min(1, age * 5) * Math.min(1, (1.6 - age) * 3);
        c.save();
        c.globalAlpha = a;
        c.translate(VW / 2, 122 - age * 8);
        c.font = '22px Bungee, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 6; c.strokeStyle = 'rgba(10,4,30,.85)'; c.strokeText(G.medalPop.text, 0, 0);
        c.fillStyle = G.medalPop.col; c.fillText(G.medalPop.text, 0, 0);
        c.restore();
      }
    }
  }
  function nameTag(c, x, y, text, col) {
    c.save();
    c.font = '600 12px Fredoka, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(text).width + 14;
    c.fillStyle = 'rgba(11,9,32,.72)';
    c.beginPath(); c.roundRect(x - w / 2, y - 9, w, 18, 9); c.fill();
    c.strokeStyle = rgba(col, 0.9); c.lineWidth = 1.2; c.stroke();
    c.fillStyle = '#fff'; c.fillText(text, x, y + 0.5);
    c.restore();
  }

  // ------------------------------------------------------------------ the loop
  let lastT = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (!shown('play')) return;
    if (!cv.width) resize();
    buildLayers();
    update(dt, now);
    draw(dt, now);
  }
  requestAnimationFrame(frame);

  function update(dt, now) {
    const b = G.bird;
    const t = now / 1000;
    let alpha = 0;
    if (G.paused) { renderY = b.y; return; }
    if (G.phase === 'ready' || G.phase === 'count') {
      G.camX += P.V0 * dt;
      b.y = P.START_Y + Math.sin(t * 5.5) * 8;
      b.vy = 0;
      G.prevY = b.y;
      G.wing += dt * 9;
      if (G.phase === 'count' && now >= G.goAt) go();
    } else if (G.phase === 'play') {
      const target = G.mode === 'online' ? (now - G.goAt) / 1000 : null;
      if (G.mode === 'online') {
        let n = 0;
        while (b.alive && b.t + C.DT <= target && n++ < 240) simStep();
        if (b.alive && target - b.t > 0.5) { while (b.alive && b.t + C.DT <= target) simStep(); }
        alpha = Math.max(0, Math.min(1, (target - b.t) / C.DT));
      } else {
        G.acc += dt;
        while (b.alive && G.acc >= C.DT) { simStep(); G.acc -= C.DT; }
        alpha = G.acc / C.DT;
      }
      if (b.alive) {
        G.camX = C.X(b.t + alpha * C.DT);
        renderY = G.prevY + (b.y - G.prevY) * alpha;
        G.wing += dt * (b.vy < 0 ? 22 : 8);
      }
    }
    if (G.phase === 'dead' || G.phase === 'spectate') {
      // the crashed bird drops to the ground
      if (G.fallY < P.FLOOR - P.BODY_R) {
        G.fallV = Math.min(P.MAX_FALL * 1.2, G.fallV + P.G * dt);
        G.fallY = Math.min(P.FLOOR - P.BODY_R, G.fallY + G.fallV * dt);
      }
      if (G.phase === 'spectate' && G.round && !G.frozen) G.camX = C.X(Math.min((now - G.goAt) / 1000, G.round.cap || 150));
    }
    // rotation, squash & stretch
    const vy = G.phase === 'play' ? b.vy : G.phase === 'dead' || G.phase === 'spectate' ? G.fallV : 0;
    const tr = G.phase === 'ready' || G.phase === 'count' ? Math.sin(t * 5.5 + 1.2) * 0.12 : (G.phase === 'play' ? rotFor(vy) : Math.min(1.57, G.rot + dt * 8));
    G.rot += (tr - G.rot) * Math.min(1, dt * (vy < 0 ? 18 : 9));
    for (let left = dt; left > 1e-6; left -= C.DT) {   // a stiff spring: small steps keep it stable at any frame rate
      const st = Math.min(left, C.DT);
      G.sqV += (-260 * G.sq - 13 * G.sqV) * st;
      G.sq += G.sqV * st;
    }
    G.sq = Math.max(-0.4, Math.min(0.4, G.sq));
    // the background scrolls with the camera
    const d = G.camX - G.lastCam;
    if (d > 0 && d < 400) G.bgX += d;
    G.lastCam = G.camX;
    G.pop = Math.max(0, G.pop - dt * 4);
    G.flash = Math.max(0, G.flash - dt * 3.2);
    G.shake = Math.max(0, G.shake - dt * 2.8);
    // the light trail
    if (G.phase !== 'dead' && !(G.phase === 'spectate' && !b.alive)) {
      G.trail.push({ x: G.camX, y: renderY });
      if (G.trail.length > 16) G.trail.shift();
    } else if (G.trail.length) G.trail.shift();
    // online: tell the others where we are ~15 times a second
    if (G.mode === 'online' && G.phase === 'play' && b.alive && now - G.sentAt > 66) {
      G.sentAt = now;
      Net.send('g:pos', { y: +b.y.toFixed(1), v: Math.round(b.vy), s: b.score, ft: +b.t.toFixed(2), k: mySkin() });
    }
  }
  let renderY = P.START_Y;

  function simStep() {
    const b = G.bird;
    G.prevY = b.y;
    const flap = G.flapQ;
    G.flapQ = false;
    const before = b.score;
    C.step(G.L, b, flap);
    if (flap) onFlap();
    if (b.score > before) scored(before);
    if (!b.alive) crashed();
  }
  function onFlap() {
    G.sq = -0.2; G.sqV = 0;
    G.wing = -Math.PI / 2;
    Sfx.tone(520, 0.08, 'triangle', 0.045, 380);
  }
  function scored() {
    const b = G.bird;
    const p = G.L.pipe(b.score - 1);
    const col = spooky ? '#a3e635' : pipeColor(p);
    burst(b.x, b.y, col, 14);
    G.parts.push({ x: p.cx, y: p.y, vx: 0, vy: 0, life: 0.45, max: 0.45, col, ring: true, r: 10, grow: p.gap * 0.55 });
    G.pop = 1;
    Sfx.play('coin');
    const m = C.P.MEDALS.find((x) => x[0] === b.score);
    if (m) { G.medalPop = { text: `${m[1].toUpperCase()}!`, col: MEDAL_COL[m[1]], t: performance.now() / 1000 }; Sfx.play('right'); }
  }
  function crashed() {
    const b = G.bird;
    G.fallY = b.y; G.fallV = b.hit === 'ground' ? 0 : -160;
    G.shake = calm() ? 0 : 1; G.flash = calm() ? 0.35 : 0.85;
    Sfx.noise(0.18, 0.14); Sfx.tone(240, 0.3, 'sawtooth', 0.05, -160);
    const sk = SKIN[mySkin()];
    for (let k = 0; k < (calm() ? 4 : 12); k++) {
      const a = Math.random() * TAU; const v = 60 + Math.random() * 160;
      G.parts.push({ x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.9 + Math.random() * 0.5, max: 1.4, col: k % 2 ? sk.base : sk.wing, feather: true, rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 12, g: 260 });
    }
    burst(b.x, b.y, '#ffffff', 10, 220);
    G.deathX = b.x;
    if (G.mode === 'solo') soloOver();
    else onlineCrash();
  }

  function draw(dt, now) {
    const t = now / 1000;
    const c = ctx;
    const sh = G.shake * G.shake * 11;
    c.setTransform(S, 0, 0, S, sh ? (Math.random() - 0.5) * sh * S : 0, sh ? (Math.random() - 0.5) * sh * S : 0);
    drawSky(c, t);
    drawLayer(c, layers.far, 0.14);
    drawHaze(c);
    drawLayer(c, layers.near, 0.38);
    drawBats(c, t, dt);
    drawPipes(c);
    drawGround(c, t);
    // other players
    if (G.mode === 'online') drawGhosts(c, t, now, dt);
    // you
    const b = G.bird;
    const skin = mySkin();
    if (!(G.mode === 'online' && G.phase === 'spectate' && !G.mine)) {
      drawTrail(c, skin);
      const dead = G.phase === 'dead' || (G.phase === 'spectate' && !b.alive);
      const x = dead ? BX + G.deathX - G.camX : BX;
      const y = dead ? G.fallY : renderY;
      if (x > -40) drawBird(c, x, y, { rot: G.rot, wing: G.wing, skin, sq: G.sq, t, dead });
      if (G.god && !dead) { c.strokeStyle = 'rgba(250,204,21,.7)'; c.lineWidth = 2; c.beginPath(); c.ellipse(BX, renderY - 26, 11, 4, 0, 0, TAU); c.stroke(); }
    }
    drawParticles(c, dt);
    drawScore(c, t);
    if (G.flash > 0) { c.fillStyle = `rgba(255,255,255,${G.flash * 0.75})`; c.fillRect(-20, -20, VW + 40, P.H + 40); }
    if (G.phase === 'ready') drawHint(c, t);
  }
  function drawHint(c, t) {
    const a = calm() ? 0.9 : 0.6 + Math.sin(t * 4) * 0.35;
    c.save();
    c.globalAlpha = a;
    c.font = '20px Bungee, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const x = Math.min(VW / 2, BX + 150); const y = P.START_Y + 80;
    c.lineWidth = 6; c.strokeStyle = 'rgba(10,4,30,.8)'; c.strokeText('TAP TO FLAP', x, y);
    c.fillStyle = '#fff'; c.fillText('TAP TO FLAP', x, y);
    c.restore();
    // a little "tap" finger ring next to the bird
    const k = (t * 1.4) % 1;
    c.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`;
    c.lineWidth = 2;
    c.beginPath(); c.arc(BX + 60, P.START_Y + 4, 8 + k * 16, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.85)';
    c.beginPath(); c.arc(BX + 60, P.START_Y + 4, 5, 0, TAU); c.fill();
    // the logo
    c.save();
    c.font = `${VW < 420 ? 34 : 50}px Bungee, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 10; c.strokeStyle = 'rgba(10,4,30,.85)';
    const ly = 92;
    c.strokeText('NEON FLAPPY', VW / 2, ly);
    const lg = c.createLinearGradient(VW / 2 - 180, 0, VW / 2 + 180, 0);
    lg.addColorStop(0, spooky ? '#fb923c' : '#22d3ee'); lg.addColorStop(1, spooky ? '#a3e635' : '#ff4fd8');
    c.fillStyle = lg;
    c.fillText('NEON FLAPPY', VW / 2, ly);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.25; c.fillText('NEON FLAPPY', VW / 2, ly + 2);
    c.restore();
  }
  function drawGhosts(c, t, now, dt) {
    for (const [id, g] of G.ghosts) {
      const p = (window.Room && Room.player(id)) || { name: '?', color: '#888888' };
      let x; let y; let rot; let dead = false;
      if (g.dead) {
        dead = true;
        x = BX + g.deadX - G.camX;
        if (g.fy < P.FLOOR - P.BODY_R) { g.fv = Math.min(900, g.fv + P.G * dt); g.fy = Math.min(P.FLOOR - P.BODY_R, g.fy + g.fv * dt); }
        y = g.fy; rot = 1.4;
      } else if (G.phase === 'count') {
        x = BX; y = P.START_Y + Math.sin(t * 5.5 + id.length) * 8; rot = 0;
      } else {
        const s = sampleGhost(g, now - 110);
        if (!s) continue;
        x = BX; y = s[1]; rot = rotFor(s[2]);
      }
      if (x < -40 || x > VW + 40) continue;
      drawBird(c, x, y, { rot, wing: t * (dead ? 0 : 12) + id.length, skin: g.skin || 'classic', alpha: dead ? 0.35 : 0.5, t, dead });
      if (!dead) nameTag(c, x, y - 34, p.name, p.color || '#888888');
    }
  }
  function sampleGhost(g, at) {
    const s = g.s;
    if (!s.length) return null;
    if (at <= s[0][0]) return s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i][0] <= at) {
        const a = s[i]; const b = s[i + 1];
        if (!b) {   // no newer sample yet: keep falling like a bird would for a moment
          const dt = Math.min(0.25, (at - a[0]) / 1000);
          return [at, Math.min(P.FLOOR - P.BODY_R, a[1] + a[2] * dt + 0.5 * P.G * dt * dt), a[2] + P.G * dt];
        }
        const k = (at - a[0]) / Math.max(1, b[0] - a[0]);
        return [at, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      }
    }
    return s[0];
  }

  // ------------------------------------------------------------------ input
  function press() {
    if (G.paused) { G.paused = false; fill($('#center')); lastT = performance.now(); return; }
    if (G.phase === 'ready') startRun();
    else if (G.phase === 'play') G.flapQ = true;
    else if (G.phase === 'dead' && G.mode === 'solo' && G.cardAt && performance.now() - G.cardAt > 450) restart();
  }
  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button, a, input') || (!G.paused && e.target.closest('.fl-card, .fl-skins'))) return;
    e.preventDefault();
    press();
  });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', (e) => {
    if (!shown('play') || e.target.closest('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      if (!e.repeat) press();
    } else if (e.key === 'Enter' && G.phase === 'dead' && G.mode === 'solo' && G.cardAt) { e.preventDefault(); restart(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.mode === 'solo' && G.phase === 'play' && G.bird.alive) {
      G.paused = true;
      fill($('#center'), h('div', { class: 'fl-card paused' }, h('h2', {}, 'Paused'), h('p', { class: 'sub' }, 'Tap or press Space to keep flying')));
    }
  });
  PA.on('admin:cheat', ({ action }) => {
    if (action === 'god' && G.phase !== 'dead') { G.god = true; G.bird.god = true; G.cheated = true; renderHud(); }
  });

  // ------------------------------------------------------------------ solo
  function startSolo() {
    showScreen('play');
    G.mode = 'solo';
    G.round = null;
    G.ghosts.clear();
    G.god = false;
    G.cheated = false;
    toReady();
    const url = new URL(location.href); url.searchParams.set('solo', '1'); history.replaceState(null, '', url);
  }
  function toReady() {
    shiftTrail(G.camX);
    Object.assign(G, { phase: 'ready', L: null, bird: C.newBird(), acc: 0, flapQ: false, over: null, cardAt: 0, paused: false, frozen: false });
    G.bird.god = G.god;
    renderY = P.START_Y;
    fill($('#center'));
    $('#banner').classList.add('hidden');
    renderReady();
    renderHud();
  }
  function shiftTrail(newCam) {
    const d = newCam - G.camX;
    for (const p of G.trail) p.x += d;
    for (const p of G.parts) p.x += d;
    G.camX = newCam; G.lastCam = newCam;
  }
  function startRun() {
    const seed = qs.get('seed') ? +qs.get('seed') : Math.floor(Math.random() * 2 ** 31);
    G.seed = seed;
    G.L = C.level(seed);
    shiftTrail(0);
    G.bird = C.newBird();
    G.bird.god = G.god;
    G.prevY = G.bird.y;
    G.acc = 0;
    G.phase = 'play';
    G.flapQ = true;
    $('#ready').classList.add('hidden');
    renderHud();
  }
  function restart() { toReady(); startRun(); }
  function soloOver() {
    G.phase = 'dead';
    G.deadAt = performance.now();
    const score = G.bird.score;
    const before = bestEver();
    const newBest = score > before && !G.cheated;
    const gotSkins = SKINS.filter((s) => s.need > before && score >= s.need && !G.cheated);
    if (newBest) store.set('flappy_best', score);
    store.set('flappy_runs', store.get('flappy_runs', 0) + 1);
    G.over = { score, best: Math.max(before, newBest ? score : 0), newBest, gotSkins };
    if (score >= 1 && !G.cheated) Account.submit('flappy', score);
    setTimeout(() => { if (G.phase === 'dead' && G.over) showOverCard(); }, 800);
  }
  function medalBadge(score) {
    const m = C.medalFor(score);
    return h('div', { class: 'fl-medal' + (m ? ' got' : '') }, m ? m[2] : h('span', { class: 'none' }, 'NO', h('br'), 'MEDAL'));
  }
  function showOverCard() {
    const o = G.over;
    const next = P.MEDALS.find((m) => o.score < m[0]);
    G.cardAt = performance.now();
    renderHud();
    Sfx.play('swoosh');
    if (o.newBest) { Sfx.play('win'); if (o.score >= 10) UI.confetti(160); }
    for (const s of o.gotSkins) UI.toast(`🔓 New bird unlocked: ${s.name}!`, 'good', 3500);
    const card = h('div', { class: 'fl-card over' },
      h('h2', {}, 'Game over'),
      h('p', { class: 'sub' }, G.cheated ? '😇 God mode was on, so this run isn’t saved' : o.newBest ? '🎉 That’s a new best!' : o.score === 0 ? 'Tap to flap — through the gaps!' : `Pipes passed: ${o.score}`),
      h('div', { class: 'fl-score' },
        medalBadge(o.score),
        h('div', { class: 'fl-num' }, h('small', {}, 'Score'), h('b', {}, o.score)),
        h('div', { class: 'fl-num' }, h('small', {}, 'Best', o.newBest ? h('span', { class: 'fl-new' }, 'NEW') : null), h('b', {}, o.best))),
      h('div', { class: 'fl-next' }, next ? `Next medal: ${next[2]} at ${next[0]} pipes` : '💎 You’ve got every medal!'),
      skinPicker(() => {}),
      h('div', { class: 'btns' },
        h('button', { class: 'btn btn-pink', onclick: restart }, '🔁 Fly again'),
        h('button', { class: 'btn btn-ghost', onclick: () => { history.replaceState(null, '', location.pathname); showScreen('entry'); Lobby.showEntry(); } }, '👥 Play online'),
        h('a', { class: 'btn btn-ghost sq', href: '/leaderboards', title: 'Leaderboards', 'aria-label': 'Leaderboards' }, '🏆')));
    fill($('#center'), card);
    if (FX.on && FX.gsap) FX.gsap.from(card, { y: 50, scale: 0.9, autoAlpha: 0, duration: 0.5, ease: 'back.out(1.8)', clearProps: 'transform,opacity,visibility' });
  }
  const previews = new Map();
  function skinPreview(id) {
    const c = h('canvas', { width: 92, height: 92 });
    const x = c.getContext('2d');
    x.scale(2.3, 2.3);
    drawBird(x, 19, 21, { rot: -0.15, wing: 1.2, skin: id, t: 0.4, glow: 19 });
    return c;
  }
  function skinPicker(onPick) {
    const cur = mySkin();
    return h('div', { class: 'fl-skins', role: 'radiogroup', 'aria-label': 'Bird' }, SKINS.map((s) => {
      const ok = unlocked(s);
      if (!previews.has(s.id)) previews.set(s.id, skinPreview(s.id));
      const pv = previews.get(s.id).cloneNode();
      pv.getContext('2d').drawImage(previews.get(s.id), 0, 0);
      return h('button', {
        class: 'fl-skin' + (s.id === cur ? ' on' : '') + (ok ? '' : ' locked'), type: 'button', role: 'radio', 'aria-checked': String(s.id === cur),
        title: ok ? s.name : `Score ${s.need} to unlock`, disabled: !ok,
        onclick: (e) => {
          store.set('flappy_skin', s.id); Sfx.play('pop');
          const wrap = e.currentTarget.parentNode;
          wrap.replaceWith(skinPicker(onPick));
          onPick(s.id);
        },
      }, pv, ok ? null : h('span', { class: 'lock' }, '🔒'), h('span', {}, ok ? s.name : `Best ${s.need}`));
    }));
  }
  function renderReady() {
    const el = $('#ready');
    el.classList.toggle('hidden', G.mode !== 'solo');
    if (G.mode !== 'solo') return;
    const best = bestEver();
    fill(el, best ? h('div', { class: 'best' }, `⭐ Best: ${best}`) : null, skinPicker(() => {}));
  }

  // ------------------------------------------------------------------ HUD
  function renderHud() {
    const kids = [];
    if (G.mode === 'solo') {
      const best = bestEver();
      if (best && G.phase !== 'ready') kids.push(h('span', { class: 'fl-chip best' }, `⭐ ${best}`));
    } else if (G.round) {
      const runners = Object.keys(G.round.runners);
      const alive = runners.filter((id) => (id === Net.id ? G.bird.alive && G.phase !== 'spectate' : !(G.ghosts.get(id) || {}).dead)).length;
      kids.push(h('span', { class: 'fl-chip' }, `Round ${G.round.n}/${G.round.rounds} · 🐤 ${alive}/${runners.length}`));
      kids.push(boardEl);
    }
    if (spooky) kids.push(h('span', { class: 'fl-chip deco' }, '🎃 Spooky night'));
    if (G.god) kids.push(h('span', { class: 'fl-chip' }, '😇 God mode'));
    fill($('#hud'), kids);
    renderBoard(true);
  }
  const boardEl = h('div', { class: 'fl-board' });
  function renderBoard(force) {
    if (G.mode !== 'online' || !G.round) return;
    const rows = Object.keys(G.round.runners).map((id) => {
      const me = id === Net.id;
      const g = G.ghosts.get(id) || {};
      return { id, me, alive: me ? G.bird.alive && G.mine : !g.dead, score: me ? G.bird.score : g.score || 0 };
    });
    rows.sort((a, b) => b.score - a.score || (b.alive ? 1 : 0) - (a.alive ? 1 : 0));
    const key = rows.map((r) => r.id + r.score + r.alive).join();
    if (!force && renderBoard.key === key) return;
    renderBoard.key = key;
    fill(boardEl, rows.slice(0, 8).map((r) => {
      const p = (window.Room && Room.player(r.id)) || { name: '?', color: '#888' };
      return h('div', { class: (r.me ? 'me' : '') + (r.alive ? '' : ' out') }, h('i', { style: { background: p.color } }), p.name, h('b', {}, r.score));
    }));
  }
  setInterval(() => { if (shown('play')) renderBoard(false); }, 250);
  function banner(text) {
    const el = $('#banner');
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  // ------------------------------------------------------------------ screens
  function showScreen(name) {
    for (const s of ['entry', 'room', 'play']) $('#' + s).classList.toggle('hidden', s !== name);
    if (name === 'play') { resize(); requestAnimationFrame(resize); }
    $('#fly-chat').classList.toggle('hidden', !(name === 'play' && G.mode === 'online'));
    scrollTo({ top: 0 });
    if (name === 'play') fitShort();
  }
  // a phone on its side is too short for the header and the stage: scroll the stage to fill the screen
  const fitShort = () => requestAnimationFrame(() => { if (shown('play') && innerHeight <= 520 && !document.fullscreenElement) stage.scrollIntoView({ block: 'start' }); });
  let fitTimer = 0;
  addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitShort, 150); });
  $('#btn-quit').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (G.mode === 'online' && window.Room && Room.code) {
      // leaving a round you're flying in counts as a crash, so the others aren't left waiting for your bird
      if (G.phase === 'play' && G.bird.alive) { G.bird.alive = false; G.deathX = G.bird.x; G.fallY = renderY; G.fallV = 0; onlineCrash(); }
      else if (G.phase === 'count') { G.phase = 'spectate'; G.bird.alive = false; G.deathX = -1e4; }
      showScreen('room'); renderRoomMain();
    }
    else { history.replaceState(null, '', location.pathname); showScreen('entry'); Lobby.showEntry(); }
  });
  $('#btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });

  // ------------------------------------------------------------------ online: Flappy Royale
  const placeEmoji = (n) => ['🥇', '🥈', '🥉'][n - 1] || `#${n}`;
  function renderRoomMain() {
    const host = Room.isHost;
    const res = state.results;
    const kids = [];
    if (res && res.rows && res.rows.length) {
      kids.push(h('div', { class: 'panel-title' }, `🏆 Final standings · ${res.rounds} round${res.rounds === 1 ? '' : 's'}`),
        h('div', { class: 'fl-standings' }, res.rows.map((r, i) => {
          const place = 1 + res.rows.filter((x) => x.points > r.points).length;
          return h('div', { class: 'player-row' + (r.id === Net.id ? ' me' : '') },
            h('b', { style: { width: '28px' } }, placeEmoji(place)), UI.avatar(r, 'sm'),
            h('span', { class: 'grow' }, r.name), h('span', { class: 'pmeta' }, `🐤 best ${r.best} · `, h('b', {}, `${r.points} pts`)));
        })));
    }
    if (state.phase === 'playing' && G.round) {   // a round is on: go back to it (the host can also stop the game)
      const r = G.round;
      kids.push(h('div', { class: 'panel-title' }, r.over ? `🐤 Round ${r.n} of ${r.rounds} is over` : `🐤 Round ${r.n} of ${r.rounds} is on`),
        h('p', { class: 'muted', style: { margin: '4px 0 14px' } }, r.over ? (r.n < r.rounds ? 'The next round starts in a few seconds — you’ll be taken back to fly it.' : 'The final results are coming up…') : 'You can watch the rest of it, or wait here for the next round.'),
        h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => { showScreen('play'); renderHud(); } }, '👀 Back to the round'),
        host ? h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '10px' }, onclick: () => { if (confirm('Stop the game for everyone?')) Net.send('g:stop'); } }, '⏹ Stop the game') : null);
      fill($('#room-main'), kids);
      return;
    }
    const sel = state.settings.rounds;
    kids.push(h('div', { class: 'panel-title' }, '🔁 Rounds', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'seg round-seg' }, [1, 3, 5].map((n) => h('button', {
        class: sel === n ? 'on' : '', disabled: !host, onclick: () => { Net.send('g:settings', { rounds: n }); Sfx.play('click'); },
      }, `${n} round${n === 1 ? '' : 's'}`))),
      h('p', { class: 'tiny muted', style: { margin: '8px 0 16px' } }, 'Each round: 🥇 5 points, 🥈 3, 🥉 2, everyone else 1. Most points wins!'),
      host ? h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => Net.send('g:start') }, res ? '🔁 Play again' : '🐤 Start Flappy Royale')
        : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host')),
      h('p', { class: 'tiny faint', style: { marginTop: '10px', textAlign: 'center' } }, 'Everyone flies the same pipes at the same time and sees the others as ghost birds. Last bird flying wins the round!'));
    fill($('#room-main'), kids);
  }
  function startRound(round, countdown) {
    state.round = round;
    G.mode = 'online';
    G.round = round;
    G.L = C.level(round.seed);
    G.ghosts.clear();
    for (const [id, r] of Object.entries(round.runners)) {
      if (id === Net.id) continue;
      G.ghosts.set(id, { s: [], skin: r.skin, score: r.score || 0, dead: !r.alive, deadX: C.X(r.ft || 0), fy: P.FLOOR - P.BODY_R, fv: 0 });
    }
    const mine = round.runners[Net.id];
    G.mine = !!(mine && mine.alive);
    G.goAt = performance.now() + countdown * 1000;
    G.frozen = !!round.over;
    G.god = false;
    showScreen('play');
    fill($('#center'));
    $('#ready').classList.add('hidden');
    shiftTrail(countdown > 0 ? -P.V0 * countdown : C.X(-countdown));
    G.bird = C.newBird();
    G.prevY = G.bird.y; renderY = G.bird.y;
    G.paused = false;
    if (G.mine && countdown > 0) {
      G.phase = 'count';
      banner('');
      countdownTick();
    } else {
      G.phase = 'spectate';
      G.bird.alive = false;
      G.deathX = -1e4;
      banner(round.over ? '' : '👀 Watching this round — you’ll fly in the next one');
    }
    renderHud();
  }
  let countTimer = null;
  function countdownTick() {
    clearTimeout(countTimer);
    if (G.phase !== 'count') return;
    const left = Math.ceil((G.goAt - performance.now()) / 1000);
    if (left >= 1) {
      fill($('#center'), h('div', { class: 'count' }, left));
      Sfx.play('tick');
      countTimer = setTimeout(countdownTick, Math.max(30, G.goAt - performance.now() - (left - 1) * 1000));
    }
  }
  function go() {
    shiftTrail(0);
    G.bird = C.newBird();
    G.bird.god = G.god;
    G.prevY = G.bird.y;
    G.phase = 'play';
    G.flapQ = true;     // everyone starts with a flap
    Sfx.play('go');
    fill($('#center'), h('div', { class: 'count' }, 'GO!'));
    setTimeout(() => { if ($('#center .count')) fill($('#center')); }, 600);
    renderHud();
  }
  function onlineCrash() {
    const b = G.bird;
    G.phase = 'spectate';
    Net.send('g:die', { score: b.score, ft: +b.t.toFixed(3) });
    const best = bestEver();
    if (b.score > best && !G.god) store.set('flappy_best', b.score);
    banner(`💥 You crashed at ${b.score} · watching the others`);
    renderHud();
  }
  function roundCard(rows, n, next) {
    const total = G.round ? G.round.rounds : n;
    const card = h('div', { class: 'fl-card' },
      h('h2', {}, `Round ${n}${total ? ` of ${total}` : ''}`),
      h('div', { class: 'fl-rows' }, rows.slice(0, 8).map((r) => h('div', { class: r.id === Net.id ? 'me' : '' },
        h('span', {}, placeEmoji(r.place)), h('span', { class: 'grow' }, r.name),
        h('span', {}, `🐤 ${r.score}`), h('span', { class: 'pts' }, `+${r.points}`)))),
      h('p', { class: 'sub', style: { marginTop: '12px' } }, next ? `Next round in ${Math.round(next)}s…` : 'Final results coming up…'));
    fill($('#center'), card);
    if (FX.on && FX.gsap) FX.gsap.from(card, { y: 40, scale: 0.92, autoAlpha: 0, duration: 0.45, ease: 'back.out(1.8)', clearProps: 'transform,opacity,visibility' });
  }

  Lobby.init({
    game: 'flappy',
    title: 'Neon Flappy',
    emoji: '🐤',
    tagline: 'Tap to flap through glowing neon pipes! Chase medals solo or survive Flappy Royale with friends.',
    solo: { label: '🐤 Play solo', onClick: () => startSolo() },
    howTo: '<b>How to play</b><ul><li>Tap, click, Space or ↑ to flap. Don’t touch the pipes or the ground!</li><li>Every gap you fly through is a point. Medals at 🥉 10, 🥈 20, 🥇 30 and 💎 50 — and new birds to unlock.</li><li>After 20 pipes the gaps get a little tighter and the speed creeps up.</li><li><b>Flappy Royale</b> (online): everyone flies the same pipes at once. Last bird flying wins the round!</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'), { extra: (p) => {
    const row = (state.standings || []).find((r) => r.id === p.id);
    return row && row.points ? h('span', { title: 'Points' }, `⭐${row.points}`) : null;
  } });
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#fly-chat'));

  Lobby.on('joined', (m) => {
    Object.assign(state, m.state);
    G.mode = 'online';
    if (state.phase === 'playing' && state.round) {
      startRound(state.round, -state.round.elapsed);
      if (state.round.over && state.roundRows) roundCard(state.roundRows, state.round.n, null);
    } else { showScreen('room'); renderRoomMain(); }
  });
  Lobby.on('players', () => { if (shown('room')) renderRoomMain(); });
  Lobby.on('left', () => { G.mode = 'solo'; G.round = null; G.ghosts.clear(); });
  Lobby.on('entry', () => { for (const s of ['room', 'play']) $('#' + s).classList.add('hidden'); });

  Net.on('g:settings', (m) => { state.settings = m.settings; if (shown('room')) renderRoomMain(); });
  Net.on('g:round', (m) => {
    state.phase = 'playing';
    state.results = null;
    state.standings = m.standings || [];
    Lobby.refreshPlayers();
    startRound(m.round, m.countdown);
  });
  Net.on('g:pos', (m) => {
    const g = G.ghosts.get(m.id);
    if (!g || g.dead) return;
    g.s.push([performance.now(), m.y, m.v]);
    if (g.s.length > 12) g.s.shift();
    g.score = m.s;
    g.skin = m.k;
  });
  Net.on('g:die', (m) => {
    if (G.round && G.round.runners[m.id]) Object.assign(G.round.runners[m.id], { alive: false, score: m.score, ft: m.ft });
    if (m.id === Net.id && G.mode === 'online' && (G.phase === 'play' || G.phase === 'count')) {
      // the server counted our bird out (no word from us for a few seconds): stop flying here too
      const b = G.bird;
      if (G.phase === 'play') { G.deathX = b.x; G.fallY = renderY; G.fallV = 0; } else G.deathX = -1e4;
      b.alive = false;
      if (Number.isFinite(m.score)) b.score = m.score;
      G.phase = 'spectate';
      G.flash = calm() ? 0.2 : 0.5;
      Sfx.noise(0.12, 0.1);
      banner(`📡 Connection lost, so your bird was counted out at ${b.score} · watching the others`);
    }
    const g = G.ghosts.get(m.id);
    if (g && !g.dead) {
      const last = g.s[g.s.length - 1];
      Object.assign(g, { dead: true, score: m.score, deadX: C.X(m.ft), fy: last ? last[1] : P.START_Y, fv: -120 });
      const p = (window.Room && Room.player(m.id)) || { name: '?' };
      if (G.phase === 'play' || G.phase === 'spectate') UI.toast(`💥 ${p.name} crashed at ${m.score}`, '', 1800);
    }
    renderHud();
  });
  Net.on('g:last', (m) => {
    if (m.id === Net.id) { banner('👑 Last bird flying! Keep going!'); Sfx.play('orb'); } else {
      const p = (window.Room && Room.player(m.id)) || { name: '?' };
      if (G.phase === 'spectate') banner(`👑 ${p.name} is the last bird flying!`);
    }
  });
  Net.on('g:god', () => { G.god = true; G.bird.god = true; renderHud(); });
  Net.on('g:toast', (m) => UI.toast(m.text, 'bad', 3500));
  Net.on('g:roundover', (m) => {
    state.standings = m.standings || [];
    state.roundRows = m.rows;
    G.frozen = true;
    if (G.round) G.round.over = true;
    if (G.phase === 'count' || G.phase === 'play') {   // still flying when the round ended
      G.phase = 'spectate'; G.bird.alive = false;
      G.deathX = G.bird.x; G.fallY = renderY; G.fallV = 0;
    }
    banner('');
    if (m.rows[0] && m.rows[0].id === Net.id && m.rows.length > 1) { UI.confetti(120); Sfx.play('win'); }
    if (shown('play')) roundCard(m.rows, m.n, m.next);
    else if (shown('room')) renderRoomMain();
    Lobby.refreshPlayers();
  });
  Net.on('g:results', (m) => {
    state.results = m.results;
    state.phase = 'results';
    state.standings = m.results.rows;
    const rows = m.results.rows;
    if (rows[0] && rows[0].id === Net.id && rows.length > 1 && (rows[1] || {}).points !== rows[0].points) UI.confetti(220);
    const was = shown('play');
    setTimeout(() => { if (state.phase === 'results') { showScreen('room'); renderRoomMain(); Lobby.refreshPlayers(); } }, was ? 3500 : 100);
  });

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {   // testing on your own computer only
    window.__flappy = { G, C, press, startSolo, restart, set spooky(v) { spooky = v; layers.key = ''; renderHud(); }, get spooky() { return spooky; } };
  }

  if (qs.get('solo')) { $('#entry').classList.add('hidden'); startSolo(); }
})();
