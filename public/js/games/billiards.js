/* Billiards: 8-ball / 9-ball online (two seats, everyone else watches) and solo (vs CPU, Speed Clear,
   Practice). Physics and rules live in pool-core.js (shared with the server); this file is the page:
   the canvas table, the rolling 3D balls, the cue and aiming guide, the controls and the game flow. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store, clamp } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;
  const PC = window.PoolCore;
  const { W, H, R, D, HEAD_X, POCKETS, SEGMENTS, CUSHIONS, DIAMONDS, DT } = PC;

  // ================================================================ table look
  const CUSH = 0.072;          // cushion rubber depth behind the nose line (the jaws end inside it)
  const WOOD = 0.105;          // wooden rail width
  const OUT = CUSH + WOOD;     // table border around the playing surface
  const OW = W + 2 * OUT;
  const OH = H + 2 * OUT;
  const FELTS = {
    green: ['Tournament green', '#1c7a45'],
    blue: ['Pro blue', '#1a5c9e'],
    red: ['Wine red', '#8a1e2e'],
    purple: ['Neon purple', '#5a2f99'],
    teal: ['Teal', '#0d7a78'],
    grey: ['Slate', '#3c4656'],
    pink: ['Arcade pink', '#a8356f'],
  };
  let feltKey = FELTS[store.get('pool_felt', 'green')] ? store.get('pool_felt', 'green') : 'green';

  const BALL_RGB = {
    1: [246, 192, 34], 2: [28, 72, 196], 3: [214, 36, 40], 4: [96, 40, 142], 5: [244, 110, 26], 6: [16, 128, 64], 7: [128, 30, 34], 8: [18, 18, 22],
  };
  for (let i = 9; i <= 15; i++) BALL_RGB[i] = BALL_RGB[i - 8];
  const IVORY = [246, 243, 232];
  const MODE_NAME = { '8ball': '8-ball', '9ball': '9-ball' };
  const FOUL_TEXT = { scratch: 'Scratch!', nohit: 'No ball hit', wrong: 'Wrong ball first', norail: 'No rail after contact', timeout: 'Shot clock ran out' };
  const WIN_TEXT = { eight: 'potted the 8-ball', nine: 'potted the 9-ball', early8: 'the 8 went down early', scratch8: 'scratched on the 8', foul8: 'fouled on the 8', cheat: 'used admin magic ✨' };

  // ================================================================ view (table <-> screen)
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  const V = { w: 0, h: 0, dpr: 1, s: 1, portrait: false, a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const toS = (x, y) => [V.a * x + V.c * y + V.e, V.b * x + V.d * y + V.f];
  function toT(sx, sy) {
    if (V.portrait) return [(V.f - sy) / V.s, (sx - V.e) / V.s];
    return [(sx - V.e) / V.s, (sy - V.f) / V.s];
  }
  const tableTransform = (c) => c.setTransform(V.a * V.dpr, V.b * V.dpr, V.c * V.dpr, V.d * V.dpr, V.e * V.dpr, V.f * V.dpr);

  function layout() {
    if ($('#play').classList.contains('hidden')) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const portrait = vw < 760 && vh > vw * 1.15;
    const game = $('.bl-game');
    const power = $('#power');
    const gw = game.clientWidth - power.offsetWidth - 10;
    const stage = $('#stage');
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const under = $('.bl-under').offsetHeight + ($('#help').offsetHeight || 0) + 34;
    const gh = Math.max(240, vh - Math.min(top, 220) - under);
    const A = OW / OH;
    let w, hh;
    if (portrait) { w = Math.min(gw, gh / A); hh = w * A; } else { w = Math.min(gw, gh * A, 1240); hh = w / A; }
    w = Math.floor(w); hh = Math.floor(hh);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (w === V.w && hh === V.h && dpr === V.dpr && portrait === V.portrait) return;
    Object.assign(V, { w, h: hh, dpr, portrait });
    stage.style.width = w + 'px';
    stage.style.height = hh + 'px';
    power.style.height = hh + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hh * dpr);
    if (portrait) {
      V.s = w / OH;
      Object.assign(V, { a: 0, b: -V.s, c: V.s, d: 0, e: OUT * V.s, f: (W + OUT) * V.s });
    } else {
      V.s = w / OW;
      Object.assign(V, { a: V.s, b: 0, c: 0, d: V.s, e: OUT * V.s, f: OUT * V.s });
    }
    stage.style.borderRadius = Math.round(0.07 * V.s) + 'px';
    buildStatic();
    ballLut = null;
    for (const b of balls.values()) b.dirty = true;
  }

  // ================================================================ static layer: wood, felt, cushions, pockets
  let staticCv = null;
  function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function grainTexture() {
    const tw = 1600, th = 160;
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const g = c.getContext('2d');
    const r = rnd(7);
    const base = g.createLinearGradient(0, 0, 0, th);
    base.addColorStop(0, '#4f2510'); base.addColorStop(0.5, '#6a3416'); base.addColorStop(1, '#45200d');
    g.fillStyle = base; g.fillRect(0, 0, tw, th);
    const TAU = Math.PI * 2;
    const wave = (k) => TAU * k / tw;       // whole waves per texture: the grain wraps without a seam
    // broad growth rings
    for (let i = 0; i < 26; i++) {
      const y0 = r() * th, a1 = 4 + r() * 12, f1 = wave(1 + Math.floor(r() * 3)), p1 = r() * TAU, f2 = wave(5 + Math.floor(r() * 6)), a2 = r() * 3;
      g.beginPath();
      for (let x = 0; x <= tw; x += 6) {
        const y = y0 + Math.sin(x * f1 + p1) * a1 + Math.sin(x * f2 + p1) * a2;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(${r() < 0.5 ? '255,170,105' : '170,90,45'},${0.08 + r() * 0.12})`;
      g.lineWidth = 6 + r() * 14;
      g.stroke();
    }
    // fine dark grain lines
    for (let i = 0; i < 110; i++) {
      const y0 = r() * th, a1 = 2 + r() * 8, f1 = wave(1 + Math.floor(r() * 4)), p1 = r() * TAU, a2 = r() * 1.8, f2 = wave(8 + Math.floor(r() * 20));
      g.beginPath();
      for (let x = 0; x <= tw; x += 6) {
        const y = y0 + Math.sin(x * f1 + p1) * a1 + Math.sin(x * f2) * a2;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(28,10,3,${0.18 + r() * 0.4})`;
      g.lineWidth = 0.8 + r() * 2.6;
      g.stroke();
    }
    // pores
    for (let i = 0; i < 3200; i++) {
      g.fillStyle = `rgba(20,8,2,${0.2 + r() * 0.35})`;
      g.fillRect(r() * tw, r() * th, 2 + r() * 5, 0.8 + r() * 0.8);
    }
    return c;
  }
  let grainCv = null;

  function noisePattern(c) {
    const n = 192;
    const nc = document.createElement('canvas'); nc.width = nc.height = n;
    const g = nc.getContext('2d');
    const img = g.createImageData(n, n);
    const r = rnd(42);
    for (let i = 0; i < n * n; i++) {
      const v = r();
      const light = v > 0.5;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = light ? 255 : 0;
      img.data[i * 4 + 3] = Math.floor(Math.abs(v - 0.5) * 2 * (light ? 16 : 26));
    }
    g.putImageData(img, 0, 0);
    // a faint diagonal weave on top
    g.strokeStyle = 'rgba(255,255,255,0.025)';
    for (let k = -n; k < n; k += 3) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + n, n); g.stroke(); }
    return c.createPattern(nc, 'repeat');
  }

  function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(hex, k) {
    const [r, g, b] = hexRgb(hex);
    const f = (v) => Math.round(clamp(k >= 0 ? v + (255 - v) * k : v * (1 + k), 0, 255));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  function roundRect(c, x, y, w, hh, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + hh, r);
    c.arcTo(x + w, y + hh, x, y + hh, r);
    c.arcTo(x, y + hh, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // outward normal and "depth beyond the nose line" for cushion k (0..5 clockwise from the top-left rail)
  const RAIL_N = [[0, -1], [0, -1], [1, 0], [0, 1], [0, 1], [-1, 0]];
  function depthOf(k, p) { return k < 2 ? -p[1] : k === 2 ? p[0] - W : k < 5 ? p[1] - H : -p[0]; }

  function buildStatic() {
    if (!V.w) return;
    const felt = FELTS[feltKey][1];
    if (!grainCv) grainCv = grainTexture();
    staticCv = staticCv || document.createElement('canvas');
    staticCv.width = cv.width; staticCv.height = cv.height;
    const c = staticCv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, staticCv.width, staticCv.height);
    tableTransform(c);
    const px = 1 / V.s;           // one CSS pixel in meters
    const RAD = 0.075;

    // ---- wood frame: four mitred planks with grain
    c.save();
    roundRect(c, -OUT, -OUT, OW, OH, RAD);
    c.clip();
    const O = [[-OUT, -OUT], [W + OUT, -OUT], [W + OUT, H + OUT], [-OUT, H + OUT]];
    const I = [[-CUSH, -CUSH], [W + CUSH, -CUSH], [W + CUSH, H + CUSH], [-CUSH, H + CUSH]];
    for (let k = 0; k < 4; k++) {
      const o0 = O[k], o1 = O[(k + 1) % 4], i1 = I[(k + 1) % 4], i0 = I[k];
      c.save();
      c.beginPath(); c.moveTo(o0[0], o0[1]); c.lineTo(o1[0], o1[1]); c.lineTo(i1[0], i1[1]); c.lineTo(i0[0], i0[1]); c.closePath();
      c.clip();
      const pat = c.createPattern(grainCv, 'repeat');
      const len = k % 2 === 0 ? OW : OH;
      const m = new DOMMatrix();
      // texture x runs along the plank, texture y across it (outer edge -> inner edge)
      const ang = [0, Math.PI / 2, Math.PI, -Math.PI / 2][k];
      m.translateSelf(o0[0], o0[1]).rotateSelf(ang * 180 / Math.PI).scaleSelf(len / grainCv.width, WOOD / grainCv.height * 1.15).translateSelf(0, k * 37);
      pat.setTransform(m);
      c.fillStyle = pat;
      c.fillRect(-OUT - 1, -OUT - 1, OW + 2, OH + 2);
      // lacquer: a soft sheen across each plank, brighter towards the outer edge
      const nx = [0, 1, 0, -1][k], ny = [-1, 0, 1, 0][k];
      const ox = k === 1 ? W + OUT : k === 3 ? -OUT : 0, oy = k === 0 ? -OUT : k === 2 ? H + OUT : 0;
      const ix = k === 1 ? W + CUSH : k === 3 ? -CUSH : 0, iy = k === 0 ? -CUSH : k === 2 ? H + CUSH : 0;
      const gr = c.createLinearGradient(k % 2 ? ox : 0, k % 2 ? 0 : oy, k % 2 ? ix : 0, k % 2 ? 0 : iy);
      gr.addColorStop(0, 'rgba(0,0,0,0.35)');
      gr.addColorStop(0.1, 'rgba(255,220,180,0.20)');
      gr.addColorStop(0.28, 'rgba(255,220,180,0.06)');
      gr.addColorStop(0.75, 'rgba(0,0,0,0.05)');
      gr.addColorStop(1, 'rgba(0,0,0,0.42)');
      c.fillStyle = gr;
      c.fillRect(-OUT - 1, -OUT - 1, OW + 2, OH + 2);
      void nx; void ny;
      c.restore();
    }
    // mitre joints
    c.strokeStyle = 'rgba(20,8,2,0.55)';
    c.lineWidth = 1.2 * px;
    for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(O[k][0], O[k][1]); c.lineTo(I[k][0], I[k][1]); c.stroke(); }
    c.restore();
    // outer bevel: light from the top left
    c.save();
    roundRect(c, -OUT + 0.004, -OUT + 0.004, OW - 0.008, OH - 0.008, RAD - 0.004);
    const bev = c.createLinearGradient(-OUT, -OUT, W + OUT, H + OUT);
    bev.addColorStop(0, 'rgba(255,214,170,0.55)'); bev.addColorStop(0.5, 'rgba(255,214,170,0.12)'); bev.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.strokeStyle = bev; c.lineWidth = 0.008; c.stroke();
    roundRect(c, -OUT + 0.0005, -OUT + 0.0005, OW - 0.001, OH - 0.001, RAD);
    c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.5 * px; c.stroke();
    c.restore();

    // ---- felt bed
    c.save();
    c.beginPath(); c.rect(-CUSH, -CUSH, W + 2 * CUSH, H + 2 * CUSH); c.clip();
    c.fillStyle = felt;
    c.fillRect(-CUSH, -CUSH, W + 2 * CUSH, H + 2 * CUSH);
    // overhead lamp: a soft pool of light in the middle, darker towards the rails
    const lamp = c.createRadialGradient(W / 2, H / 2, 0.05, W / 2, H / 2, W * 0.62);
    lamp.addColorStop(0, 'rgba(255,255,240,0.13)');
    lamp.addColorStop(0.45, 'rgba(255,255,240,0.04)');
    lamp.addColorStop(1, 'rgba(0,0,0,0.38)');
    c.fillStyle = lamp;
    c.fillRect(-CUSH, -CUSH, W + 2 * CUSH, H + 2 * CUSH);
    const pat = noisePattern(c);
    pat.setTransform(new DOMMatrix().scaleSelf(1 / (V.s * V.dpr), 1 / (V.s * V.dpr)));
    c.fillStyle = pat;
    c.fillRect(-CUSH, -CUSH, W + 2 * CUSH, H + 2 * CUSH);
    // spots
    c.fillStyle = 'rgba(255,255,255,0.28)';
    for (const sp of [PC.HEAD_SPOT, PC.FOOT_SPOT]) { c.beginPath(); c.arc(sp[0], sp[1], 0.0045, 0, Math.PI * 2); c.fill(); }
    // the cushions cast a soft shadow onto the bed
    const sh = 0.03;
    const shadowBand = (x0, y0, x1, y1, gx0, gy0, gx1, gy1) => {
      const gr = c.createLinearGradient(gx0, gy0, gx1, gy1);
      gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    shadowBand(-CUSH, 0, W + CUSH, sh, 0, 0, 0, sh);
    shadowBand(-CUSH, H - sh, W + CUSH, H, 0, H, 0, H - sh);
    shadowBand(0, -CUSH, sh, H + CUSH, 0, 0, sh, 0);
    shadowBand(W - sh, -CUSH, W, H + CUSH, W, 0, W - sh, 0);
    c.restore();

    // groove between rubber and wood
    c.strokeStyle = 'rgba(0,0,0,0.65)'; c.lineWidth = 2.2 * px;
    c.strokeRect(-CUSH, -CUSH, W + 2 * CUSH, H + 2 * CUSH);
    c.strokeStyle = 'rgba(255,210,160,0.18)'; c.lineWidth = 1 * px;
    c.strokeRect(-CUSH - 1.6 * px, -CUSH - 1.6 * px, W + 2 * CUSH + 3.2 * px, H + 2 * CUSH + 3.2 * px);

    // ---- pocket cups: leather caps behind the jaws (under the cushions), so the opening reads as a pocket
    c.save();
    c.beginPath();
    c.rect(-OUT, -OUT, OW, OH);
    c.rect(0, 0, W, H);
    c.clip('evenodd');
    for (const p of POCKETS) {
      const rc = p.corner ? 0.104 : 0.088;
      const ox = p.x + p.axis[0] * 0.006, oy = p.y + p.axis[1] * 0.006;
      const lg = c.createRadialGradient(ox - p.axis[0] * 0.02, oy - p.axis[1] * 0.02, p.r * 0.5, ox, oy, rc);
      lg.addColorStop(0, '#050302'); lg.addColorStop(0.55, '#140c07'); lg.addColorStop(0.86, '#2b1a0f'); lg.addColorStop(0.95, '#3b2615'); lg.addColorStop(1, '#120a05');
      c.fillStyle = lg;
      c.beginPath(); c.arc(ox, oy, rc, 0, Math.PI * 2); c.fill();
      // stitching along the leather edge
      c.setLineDash([0.004, 0.004]);
      c.strokeStyle = 'rgba(255,220,170,0.22)'; c.lineWidth = 0.9 * px;
      c.beginPath(); c.arc(ox, oy, rc - 0.008, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1.5 * px;
      c.beginPath(); c.arc(ox, oy, rc, 0, Math.PI * 2); c.stroke();
    }
    c.restore();

    // ---- cushions: exactly the physics polylines, extruded back to the wood
    const feltDark = shade(felt, -0.18);
    const feltLight = shade(felt, 0.22);
    CUSHIONS.forEach((pts, k) => {
      const n = RAIL_N[k];
      const back = (p) => { const dd = CUSH - depthOf(k, p); return [p[0] + n[0] * dd, p[1] + n[1] * dd]; };
      const e0 = back(pts[0]), e1 = back(pts[3]);
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.lineTo(e1[0], e1[1]); c.lineTo(e0[0], e0[1]); c.closePath();
      const mid = [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2];
      const gr = c.createLinearGradient(mid[0], mid[1], mid[0] + n[0] * CUSH, mid[1] + n[1] * CUSH);
      gr.addColorStop(0, feltLight); gr.addColorStop(0.12, felt); gr.addColorStop(0.7, feltDark); gr.addColorStop(1, shade(felt, -0.45));
      c.fillStyle = gr;
      c.fill();
      // the cushion nose: a crisp highlight line, then a shadow just inside it
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.strokeStyle = shade(felt, 0.38); c.lineWidth = 1.2 * px; c.stroke();
      // jaw faces are a little darker (they face away from the lamp)
      for (const [a, b] of [[0, 1], [2, 3]]) {
        c.beginPath(); c.moveTo(pts[a][0], pts[a][1]); c.lineTo(pts[b][0], pts[b][1]);
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2 * px; c.stroke();
      }
    });

    // ---- pockets: the hole is exactly the capture circle
    for (const p of POCKETS) {
      const ang = Math.atan2(p.axis[1], p.axis[0]);
      const hg = c.createRadialGradient(p.x - p.axis[0] * p.r * 0.35, p.y - p.axis[1] * p.r * 0.35, p.r * 0.1, p.x, p.y, p.r);
      hg.addColorStop(0, '#000'); hg.addColorStop(0.8, '#030202'); hg.addColorStop(1, '#16110d');
      c.fillStyle = hg;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
      // the far wall of the hole catches a little light
      c.beginPath(); c.arc(p.x, p.y, p.r * 0.84, ang - 1.0, ang + 1.0);
      c.strokeStyle = 'rgba(140,110,80,0.16)'; c.lineWidth = p.r * 0.2; c.stroke();
      c.beginPath(); c.arc(p.x, p.y, p.r, ang + Math.PI - 1.3, ang + Math.PI + 1.3);
      c.strokeStyle = 'rgba(255,230,190,0.18)'; c.lineWidth = 1.2 * px; c.stroke();
    }

    // ---- diamonds (mother-of-pearl) on the wood
    for (const dm of DIAMONDS) {
      let x = dm[0], y = dm[1], horiz = true;
      const off = CUSH + WOOD * 0.47;
      if (y === 0) y = -off; else if (y === H) y = H + off;
      else { horiz = false; x = x === 0 ? -off : W + off; }
      const a = 0.017, b = 0.0095;
      c.save();
      c.translate(x, y);
      if (!horiz) c.rotate(Math.PI / 2);
      c.beginPath(); c.moveTo(-a, 0); c.lineTo(0, -b); c.lineTo(a, 0); c.lineTo(0, b); c.closePath();
      const pg = c.createLinearGradient(-a, -b, a, b);
      pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.3, '#f3e6f7'); pg.addColorStop(0.55, '#cfe3f0'); pg.addColorStop(0.8, '#f6eedd'); pg.addColorStop(1, '#b7b0c8');
      c.fillStyle = pg; c.fill();
      c.strokeStyle = 'rgba(40,20,8,0.7)'; c.lineWidth = 0.8 * px; c.stroke();
      c.restore();
    }
  }

  // ================================================================ balls: 3D orientation + per-pixel shading
  const balls = new Map();      // id -> { id, x, y, M (local -> table rotation, row-major 3x3), dirty, sp (sprite canvas), img }
  let ballLut = null;
  const GLYPH = 64;
  const glyphs = {};
  const COS_D = Math.cos(0.5);           // number disc: 0.5 rad around each pole
  const SIN_D = Math.sin(0.5);
  const BAND = 0.5;                      // stripe band: |local z| below this

  function glyph(n) {
    if (glyphs[n]) return glyphs[n];
    const c = document.createElement('canvas'); c.width = c.height = GLYPH;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = String(n);
    g.font = `bold ${Math.round(GLYPH * (txt.length > 1 ? 0.6 : 0.7))}px "Arial Black", Arial, Helvetica, sans-serif`;
    g.save();
    g.translate(GLYPH / 2, GLYPH / 2 + GLYPH * 0.04);
    if (txt.length > 1) g.scale(0.82, 1);
    g.fillText(txt, 0, 0);
    g.restore();
    if (n === 6 || n === 9) { g.fillRect(GLYPH * 0.34, GLYPH * 0.84, GLYPH * 0.32, GLYPH * 0.05); }
    const d = g.getImageData(0, 0, GLYPH, GLYPH).data;
    const a = new Float32Array(GLYPH * GLYPH);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    glyphs[n] = a;
    return a;
  }

  // light from the top left (screen frame: x right, y down, z into the screen; the camera looks along +z)
  const LIGHT = (() => { const v = [-0.42, -0.55, -0.72]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
  const HALF = (() => { const v = [LIGHT[0], LIGHT[1], LIGHT[2] - 1]; const l = Math.hypot(...v); return v.map((x) => x / l); })();

  function makeLut(diam) {
    const sz = Math.ceil(diam) + 2;
    const r0 = diam / 2;
    const c = sz / 2;
    const n = sz * sz;
    const L = { sz, diam, nx: new Float32Array(n), ny: new Float32Array(n), nz: new Float32Array(n), al: new Float32Array(n), dif: new Float32Array(n), spec: new Float32Array(n), rim: new Float32Array(n) };
    for (let j = 0; j < sz; j++) {
      for (let i = 0; i < sz; i++) {
        const k = j * sz + i;
        const dx = i + 0.5 - c, dy = j + 0.5 - c;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const al = clamp(r0 - dist + 0.5, 0, 1);
        L.al[k] = al;
        if (al <= 0) continue;
        const q = Math.min(dist / r0, 0.995);
        const nx = dist > 0 ? dx / dist * q : 0, ny = dist > 0 ? dy / dist * q : 0;
        const nz = -Math.sqrt(1 - q * q);
        L.nx[k] = nx; L.ny[k] = ny; L.nz[k] = nz;
        const dif = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        const nh = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
        L.dif[k] = 0.36 + 0.74 * dif;
        L.spec[k] = 255 * (0.95 * Math.pow(nh, 90) + 0.16 * Math.pow(nh, 10));
        // rim darkening, plus a faint bounce of the cloth on the lower edge
        const fr = Math.pow(1 - Math.abs(nz), 2.2);
        L.rim[k] = 1 - 0.5 * fr;
      }
    }
    return L;
  }

  function newBall(id, x, y, M) {
    return { id, x, y, M: M || randomOrient(), dirty: true, sp: null, img: null, spSize: 0 };
  }
  /** A random orientation, mostly with a number facing up so the table is readable. */
  function randomOrient(tilt = 1.25) {
    const ph = Math.random() * Math.PI * 2;
    const c = Math.cos(ph), s = Math.sin(ph);
    // row-major (rows: table x, y, z); column k = the image of local axis k. Local z -> the camera (table -z).
    const M = new Float64Array([c, s, 0, s, -c, 0, 0, 0, -1]);
    const ax = Math.random() * Math.PI * 2;
    rotate(M, Math.cos(ax), Math.sin(ax), 0, Math.random() * tilt);
    return M;
  }
  /** M <- Rot(axis, angle) * M (axis in the table frame, unit length). */
  function rotate(M, ux, uy, uz, ang) {
    if (!ang) return;
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const r00 = c + ux * ux * t, r01 = ux * uy * t - uz * s, r02 = ux * uz * t + uy * s;
    const r10 = uy * ux * t + uz * s, r11 = c + uy * uy * t, r12 = uy * uz * t - ux * s;
    const r20 = uz * ux * t - uy * s, r21 = uz * uy * t + ux * s, r22 = c + uz * uz * t;
    for (let col = 0; col < 3; col++) {
      const a = M[col], b = M[3 + col], d = M[6 + col];
      M[col] = r00 * a + r01 * b + r02 * d;
      M[3 + col] = r10 * a + r11 * b + r12 * d;
      M[6 + col] = r20 * a + r21 * b + r22 * d;
    }
  }
  function orthonormalize(M) {
    // Gram-Schmidt on the columns
    let ax = M[0], ay = M[3], az = M[6];
    let l = Math.sqrt(ax * ax + ay * ay + az * az); ax /= l; ay /= l; az /= l;
    let bx = M[1], by = M[4], bz = M[7];
    const dt = ax * bx + ay * by + az * bz;
    bx -= dt * ax; by -= dt * ay; bz -= dt * az;
    l = Math.sqrt(bx * bx + by * by + bz * bz); bx /= l; by /= l; bz /= l;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    M[0] = ax; M[3] = ay; M[6] = az; M[1] = bx; M[4] = by; M[7] = bz; M[2] = cx; M[5] = cy; M[8] = cz;
  }
  /** Roll ball b by a table displacement (dx, dy) without slipping, plus a spin about the vertical. */
  function roll(b, dx, dy, spin) {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-7) {
      // axis = up x d, with up = (0, 0, -1) in the table frame (z points into the table)
      rotate(b.M, dy / d, -dx / d, 0, d / R);
      b.dirty = true;
    }
    if (spin) { rotate(b.M, 0, 0, -1, spin); b.dirty = true; }
    if (b.dirty && Math.random() < 0.05) orthonormalize(b.M);
  }

  /** Paint ball b into its own small canvas (per pixel), for the current view rotation. */
  function shadeBall(b, L, felt) {
    if (!b.sp || b.spSize !== L.sz) {
      b.sp = b.sp || document.createElement('canvas');
      b.sp.width = b.sp.height = L.sz;
      b.img = b.sp.getContext('2d').createImageData(L.sz, L.sz);
      b.spSize = L.sz;
      b.dirty = true;
    }
    if (!b.dirty) return;
    b.dirty = false;
    paintSphere(b.img.data, L, b.id, b.M, V.portrait, felt);
    b.sp.getContext('2d').putImageData(b.img, 0, 0);
  }

  function paintSphere(out, L, id, M, portrait, felt) {
    // n_local = Q n_screen. Table normal from the screen one: landscape = same; portrait = (-ny, nx, nz)
    let q00, q01, q02, q10, q11, q12, q20, q21, q22;
    if (portrait) {
      q00 = M[3]; q01 = -M[0]; q02 = M[6]; q10 = M[4]; q11 = -M[1]; q12 = M[7]; q20 = M[5]; q21 = -M[2]; q22 = M[8];
    } else {
      q00 = M[0]; q01 = M[3]; q02 = M[6]; q10 = M[1]; q11 = M[4]; q12 = M[7]; q20 = M[2]; q21 = M[5]; q22 = M[8];
    }
    const base = id === 0 ? IVORY : BALL_RGB[id];
    const stripe = id >= 9;
    const gl = id > 0 ? glyph(id) : null;
    const n = L.sz * L.sz;
    const fr = felt[0], fg = felt[1], fb = felt[2];
    for (let k = 0; k < n; k++) {
      const al = L.al[k];
      const o = k * 4;
      if (al <= 0) { out[o + 3] = 0; continue; }
      const nx = L.nx[k], ny = L.ny[k], nz = L.nz[k];
      const lx = q00 * nx + q01 * ny + q02 * nz;
      const ly = q10 * nx + q11 * ny + q12 * nz;
      const lz = q20 * nx + q21 * ny + q22 * nz;
      let r, g, bl;
      if (id === 0) {
        r = IVORY[0]; g = IVORY[1]; bl = IVORY[2];
        // six red dots (like a pro cue ball) make the spin visible
        if (lx > 0.988 || lx < -0.988 || ly > 0.988 || ly < -0.988 || lz > 0.988 || lz < -0.988) { r = 200; g = 28; bl = 40; }
      } else {
        const az = lz < 0 ? -lz : lz;
        if (az > COS_D) {
          // number disc
          r = IVORY[0]; g = IVORY[1]; bl = IVORY[2];
          const u = lx / SIN_D, v = (lz > 0 ? -ly : ly) / SIN_D;
          const gx = (u * 0.5 + 0.5) * (GLYPH - 1), gy = (v * 0.5 + 0.5) * (GLYPH - 1);
          const ix = gx | 0, iy = gy | 0;
          if (ix >= 0 && iy >= 0 && ix < GLYPH - 1 && iy < GLYPH - 1) {
            const fx = gx - ix, fy = gy - iy;
            const i0 = iy * GLYPH + ix;
            const a = (gl[i0] * (1 - fx) + gl[i0 + 1] * fx) * (1 - fy) + (gl[i0 + GLYPH] * (1 - fx) + gl[i0 + GLYPH + 1] * fx) * fy;
            const ink = 1 - a;
            r *= ink; g *= ink; bl *= ink;
            r += 22 * a; g += 20 * a; bl += 24 * a;
          }
          // soft disc edge
          const e = (az - COS_D) / 0.02;
          if (e < 1) {
            const cb = stripe ? IVORY : base;
            r = cb[0] + (r - cb[0]) * e; g = cb[1] + (g - cb[1]) * e; bl = cb[2] + (bl - cb[2]) * e;
          }
        } else if (stripe) {
          const e = (az - BAND) / 0.025;
          if (e <= -1) { r = base[0]; g = base[1]; bl = base[2]; } else if (e >= 1) { r = IVORY[0]; g = IVORY[1]; bl = IVORY[2]; } else {
            const t = (e + 1) / 2;
            r = base[0] + (IVORY[0] - base[0]) * t; g = base[1] + (IVORY[1] - base[1]) * t; bl = base[2] + (IVORY[2] - base[2]) * t;
          }
        } else { r = base[0]; g = base[1]; bl = base[2]; }
      }
      const dif = L.dif[k], rim = L.rim[k], sp = L.spec[k];
      // the cloth reflects a little into the lower half of the ball
      const bounce = ny > 0 ? ny * ny * 0.22 : 0;
      r = r * dif * rim + fr * bounce * 0.5 + sp;
      g = g * dif * rim + fg * bounce * 0.5 + sp;
      bl = bl * dif * rim + fb * bounce * 0.5 + sp;
      out[o] = r > 255 ? 255 : r; out[o + 1] = g > 255 ? 255 : g; out[o + 2] = bl > 255 ? 255 : bl;
      out[o + 3] = al * 255;
    }
  }

  /** A small upright picture of ball id (number facing the camera), as a data URL for the HUD and the tray. */
  const iconCache = {};
  function ballIcon(id) {
    if (iconCache[id]) return iconCache[id];
    const L = makeLut(40);
    const c = document.createElement('canvas'); c.width = c.height = L.sz;
    const g = c.getContext('2d');
    const img = g.createImageData(L.sz, L.sz);
    // local z towards the camera, local x to the right, local y up (so the number reads upright)
    const M = new Float64Array([1, 0, 0, 0, -1, 0, 0, 0, -1]);
    if (id === 0) rotate(M, 1, 0, 0, 0.5);
    else if (id >= 9) rotate(M, 1, 0, 0, -0.85);   // tip stripes forward so the band shows
    paintSphere(img.data, L, id, M, false, [0, 0, 0]);
    g.putImageData(img, 0, 0);
    iconCache[id] = c.toDataURL();
    return iconCache[id];
  }
  const ballImg = (id, cls = '') => h('img', { class: 'mb ' + cls, src: ballIcon(id), alt: id ? `${id} ball` : 'cue ball', draggable: 'false' });

  // ================================================================ sounds (PA.Sfx synth; volume by speed)
  let sndBudget = 0;
  const Snd = {
    ok() { return !Sfx.muted && sndBudget-- > 0; },
    clack(speed) {
      const v = Math.min(1, speed / 5);
      if (v < 0.02 || !Snd.ok()) return;
      Sfx.tone(1900 + Math.random() * 600, 0.03, 'triangle', 0.02 + 0.17 * v);
      Sfx.tone(3400 + Math.random() * 400, 0.015, 'sine', 0.01 + 0.06 * v);
      Sfx.noise(0.02, 0.03 + 0.16 * v, 0, 2800);
    },
    rail(speed) {
      const v = Math.min(1, speed / 4);
      if (v < 0.04 || !Snd.ok()) return;
      Sfx.tone(90 + Math.random() * 25, 0.11, 'sine', 0.05 + 0.16 * v, -25);
      Sfx.noise(0.045, 0.02 + 0.07 * v, 0, 250);
    },
    pocket() {
      if (!Snd.ok()) return;
      Sfx.tone(210, 0.1, 'sine', 0.13, -110);
      Sfx.tone(130, 0.22, 'triangle', 0.07, -50, 0.07);
      Sfx.noise(0.14, 0.05, 0.06, 180);
      Sfx.tone(700, 0.03, 'triangle', 0.03, 0, 0.18);
    },
    cue(p) {
      if (Sfx.muted) return;
      Sfx.tone(520 + p * 200, 0.035, 'square', 0.03 + 0.05 * p);
      Sfx.noise(0.03, 0.06 + 0.16 * p, 0, 1400);
    },
  };

  // ================================================================ scene state
  const T = {
    F: null,                 // frame shown (PoolCore frame state)
    anim: null,              // shot replay: { sim, t0, max, done, after }
    drops: [],               // balls falling into pockets
    tray: [],                // pocketed ids this frame, in order
    aim: { a: Math.PI, pull: 0, sx: 0, sy: 0 },   // the local player's cue (pull = live power 0..1)
    kbPower: 0.55,           // power for Space / Enter
    view: null,              // the cue shown when it's not us: { a, p, sx, sy, ta, tp }
    place: null,             // dragging the cue ball (or any ball in practice): { id, x, y, ok, ox, oy }
    strike: null,            // cue strike animation { t0, from, a, sx, sy }
    hover: null,             // pointer position on the table (table coords)
    guide: null,             // cached aiming guide
    guideKey: '',
    ctl: null,               // current controller (Solo or Online)
  };

  function setBalls(list, keep = true) {
    const seen = new Set();
    for (const [id, x, y] of list) {
      seen.add(id);
      const b = balls.get(id);
      if (b && keep) { if (b.x !== x || b.y !== y) { b.x = x; b.y = y; } } else balls.set(id, newBall(id, x, y));
    }
    for (const id of [...balls.keys()]) if (!seen.has(id)) balls.delete(id);
  }
  function newRack(F) {
    balls.clear();
    T.tray = [];
    T.drops = [];
    T.anim = null;
    setBalls(F.balls, false);
    renderTray();
  }
  const cueBall = () => balls.get(0);

  // ================================================================ shot replay (real time, PoolCore.Sim)
  /** Replay shot from `before` at real time. Resolves when every ball stopped. */
  function playShot(before, shot, after) {
    finishAnim();
    setBalls(before);
    return new Promise((resolve) => {
      const sim = new PC.Sim(before.map((b) => [b[0], b[1], b[2]]), shot);
      T.anim = { sim, t0: performance.now(), resolve, after, last: performance.now() };
      T.guide = null;
    });
  }
  function finishAnim() {
    const A = T.anim;
    if (!A) return;
    T.anim = null;
    if (!A.sim.done) {
      // jump to the end: run it out silently
      while (!A.sim.done) for (const e of A.sim.step()) if (e[0] === 'pot') onPot(e[1], e[2], false);
    }
    syncFromSim(A.sim, 0);
    if (A.after) setBalls(A.after);
    A.resolve();
  }
  function syncFromSim(sim, dtSim) {
    const { ids, X, Y, RX, RY, S, ON } = sim;
    for (let i = 0; i < sim.n; i++) {
      const b = balls.get(ids[i]);
      if (!b) continue;
      if (!ON[i]) continue;
      if (dtSim > 0) {
        // roll from the ball's angular velocity (r == v when rolling, 0 when sliding: stun, draw, follow look right)
        roll(b, RX[i] * dtSim, RY[i] * dtSim, S[i] * dtSim / R);
        // and keep exactly in step with the position
      }
      b.x = X[i]; b.y = Y[i];
    }
  }
  function stepAnim(now) {
    const A = T.anim;
    if (!A) return;
    const sim = A.sim;
    const target = Math.floor((now - A.t0) / 1000 / DT);
    let n = 0;
    const startSteps = sim.steps;
    while (!sim.done && sim.steps < target && n < 600) {
      for (const e of sim.step()) onEvent(e, sim);
      n++;
    }
    syncFromSim(sim, (sim.steps - startSteps) * DT);
    if (sim.done) { T.anim = null; if (A.after) setBalls(A.after); A.resolve(); }
  }
  function onEvent(e, sim) {
    if (e[0] === 'hit') Snd.clack(e[4]);
    else if (e[0] === 'rail') Snd.rail(e[3]);
    else if (e[0] === 'pot') {
      // the ball's last position is still in the sim arrays
      const i = sim.ids.indexOf(e[1]);
      const b = balls.get(e[1]);
      if (b && i >= 0) { b.x = sim.X[i]; b.y = sim.Y[i]; }
      onPot(e[1], e[2], true);
    }
  }
  function onPot(id, pocket, animate) {
    const b = balls.get(id);
    if (b && animate) {
      T.drops.push({ b, px: POCKETS[pocket].x, py: POCKETS[pocket].y, x0: b.x, y0: b.y, t0: performance.now() });
      Snd.pocket();
    }
    balls.delete(id);
    if (id !== 0) {
      T.tray = T.tray.filter((x) => x !== id);
      T.tray.push(id);
      setTimeout(renderTray, animate ? 260 : 0);
    }
  }

  // ================================================================ tray (pocketed balls)
  let trayShown = null;
  function renderTray() {
    const el = $('#tray');
    if (!T.F) { fill(el); trayShown = null; return; }
    const on = new Set(T.F.balls.map((b) => b[0]));
    // balls we saw drop, in order, then any others that are gone (joined mid-frame)
    const list = T.tray.filter((id) => !on.has(id) && !balls.has(id));
    const all = T.F.mode === '9ball' ? 9 : 15;
    for (let id = 1; id <= all; id++) if (!on.has(id) && !balls.has(id) && !list.includes(id)) list.push(id);
    if (trayShown && list.join() === trayShown.join()) return;
    const fresh = trayShown ? list.filter((id) => !trayShown.includes(id)) : [];
    trayShown = list;
    if (!list.length) { fill(el, h('span', { class: 'empty' }, 'Pocketed balls roll in here')); return; }
    const imgs = list.map((id) => ballImg(id, fresh.includes(id) && fresh.length < 6 ? 'in' : ''));
    fill(el, imgs);
    requestAnimationFrame(() => requestAnimationFrame(() => imgs.forEach((im) => im.classList.remove('in'))));
  }

  // ================================================================ aiming geometry (exact core geometry)
  /** First thing the cue ball (centre at x, y, moving along unit u) touches: a ball (centre distance 2R),
      a cushion or jaw (a segment at distance R) or a pocket capture circle. */
  function castRay(x, y, ux, uy, list, skip) {
    let best = { t: 40, kind: 'none' };
    for (const b of list) {
      if (b[0] === skip) continue;
      const dx = b[1] - x, dy = b[2] - y;
      const pr = dx * ux + dy * uy;
      if (pr <= 0) continue;
      const pe2 = dx * dx + dy * dy - pr * pr;
      if (pe2 >= D * D) continue;
      const t = pr - Math.sqrt(D * D - pe2);
      if (t < best.t) best = { t: Math.max(0, t), kind: 'ball', id: b[0], bx: b[1], by: b[2] };
    }
    for (const s of SEGMENTS) {
      const t = rayCapsule(x, y, ux, uy, s[0], s[1], s[2], s[3], R);
      if (t !== null && t < best.t) best = { t, kind: 'rail', seg: s };
    }
    for (let p = 0; p < 6; p++) {
      const P = POCKETS[p];
      const t = rayCircle(x, y, ux, uy, P.x, P.y, P.r);
      if (t !== null && t < best.t) best = { t, kind: 'pocket', p };
    }
    return best;
  }
  function rayCircle(x, y, ux, uy, cx, cy, r) {
    const dx = cx - x, dy = cy - y;
    const pr = dx * ux + dy * uy;
    const pe2 = dx * dx + dy * dy - pr * pr;
    if (pe2 >= r * r) return null;
    const t = pr - Math.sqrt(r * r - pe2);
    return t > 1e-9 ? t : null;
  }
  function rayCapsule(x, y, ux, uy, x1, y1, x2, y2, r) {
    const sx = x2 - x1, sy = y2 - y1;
    const L = Math.sqrt(sx * sx + sy * sy);
    const tx = sx / L, ty = sy / L;
    const nx = -ty, ny = tx;
    let best = null;
    const s0 = (x - x1) * nx + (y - y1) * ny;
    const un = ux * nx + uy * ny;
    if (Math.abs(un) > 1e-12) {
      const side = s0 >= 0 ? 1 : -1;
      const t = (side * r - s0) / un;
      if (t > 1e-9) {
        const along = (x + ux * t - x1) * tx + (y + uy * t - y1) * ty;
        if (along >= 0 && along <= L) best = t;
      }
    }
    for (const [ex, ey] of [[x1, y1], [x2, y2]]) {
      const t = rayCircle(x, y, ux, uy, ex, ey, r);
      if (t !== null && (best === null || t < best)) best = t;
    }
    return best;
  }
  /** The balls the shooter may hit first (null = anything goes). */
  function legalSet(F) {
    if (!F || T.ctl.free) return null;
    const on = F.balls.map((b) => b[0]).filter((id) => id !== 0);
    if (F.mode === '9ball') return new Set([Math.min(...on)]);
    if (F.isBreak) return null;
    if (F.open) {
      const left = on.filter((id) => id !== 8);
      return new Set(left.length ? left : [8]);
    }
    const g = F.groups[F.turn];
    const mine = on.filter((id) => PC.groupOf(id) === g);
    return new Set(mine.length ? mine : [8]);
  }
  /** The cue ball's speed and roll at distance `dist` (a one-ball simulation with the real physics). */
  function cueAt(x, y, ux, uy, power, sx, sy, dist, brk) {
    const sp = (brk ? PC.BREAK_SPEED : PC.MAX_SPEED) * clamp(power, 0.02, 1);
    const sim = new PC.Sim([[0, x, y]], { x, y, vx: ux * sp, vy: uy * sp, sx, sy });
    let n = 0;
    while (!sim.done && n < 4000) {
      const dx = sim.X[0] - x, dy = sim.Y[0] - y;
      if (dx * dx + dy * dy >= dist * dist) break;
      sim.advance(1); n++;
    }
    return { vx: sim.VX[0], vy: sim.VY[0], rx: sim.RX[0], ry: sim.RY[0], stopped: sim.done };
  }

  function computeGuide(cx, cy, a, power, sx, sy) {
    const F = T.F;
    const ux = Math.cos(a), uy = Math.sin(a);
    const list = [];
    for (const b of balls.values()) if (b.id !== 0) list.push([b.id, b.x, b.y]);
    const hit = castRay(cx, cy, ux, uy, list, 0);
    const g = { cx, cy, ux, uy, hit, gx: cx + ux * hit.t, gy: cy + uy * hit.t };
    if (hit.kind === 'ball') {
      let nx = hit.bx - g.gx, ny = hit.by - g.gy;
      const l = Math.sqrt(nx * nx + ny * ny); nx /= l; ny /= l;
      const cos = ux * nx + uy * ny;
      g.obj = { nx, ny, len: 0.08 + 0.6 * cos * cos };
      const legal = legalSet(F);
      g.bad = legal ? !legal.has(hit.id) : false;
      // cue ball after the hit: keeps its tangential speed + a little of the normal one, its roll is unchanged,
      // and then the slip resolves (r == v): v_final = 5/7 v' + 2/7 r
      const st = cueAt(cx, cy, ux, uy, Math.max(power, 0.25), sx, sy, hit.t, F && F.isBreak);
      if (!st.stopped) {
        const vn = st.vx * nx + st.vy * ny;
        const keep = 1 - (1 + PC.CONST.E_BALL) / 2;
        const vx = st.vx - vn * nx * (1 - keep), vy = st.vy - vn * ny * (1 - keep);
        const fx = vx * 5 / 7 + st.rx * 2 / 7, fy = vy * 5 / 7 + st.ry * 2 / 7;
        const fl = Math.sqrt(fx * fx + fy * fy);
        const v0 = Math.sqrt(st.vx * st.vx + st.vy * st.vy) || 1;
        if (fl > 0.02 * v0) g.cue = { ux: fx / fl, uy: fy / fl, len: 0.05 + 0.4 * Math.min(1, fl / v0) };
      }
    } else if (hit.kind === 'rail') {
      const s = hit.seg;
      let tx = s[2] - s[0], ty = s[3] - s[1];
      const l = Math.sqrt(tx * tx + ty * ty); tx /= l; ty /= l;
      const d = ux * tx + uy * ty;
      const rx = 2 * d * tx - ux, ry = 2 * d * ty - uy;
      g.bounce = { ux: rx, uy: ry, len: 0.18 };
    }
    return g;
  }

  // ================================================================ drawing
  let lastFrame = performance.now();
  let feltRgb = hexRgb(FELTS[feltKey][1]);

  function draw(now) {
    if (!staticCv) return;
    const dpr = V.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(staticCv, 0, 0);
    tableTransform(ctx);
    const px = 1 / V.s;
    const F = T.F;
    const ctl = T.ctl;
    const aiming = ctl && !T.anim && !T.strike && F && !F.over;
    const shooterView = aiming ? cueView() : null;   // {a, p, sx, sy, mine}

    // kitchen while placing behind the head string
    if (aiming && F.inHand && F.kitchen && (ctl.canPlace() || T.view)) {
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(0, 0, HEAD_X, H);
      ctx.setLineDash([0.02, 0.014]);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.2 * px;
      ctx.beginPath(); ctx.moveTo(HEAD_X, 0); ctx.lineTo(HEAD_X, H); ctx.stroke();
      ctx.setLineDash([]);
    }

    // legal targets: a soft glow under the balls you may hit first
    if (aiming && ctl.canAim()) {
      const legal = legalSet(F);
      if (legal && legal.size <= 8) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        for (const id of legal) {
          const b = balls.get(id);
          if (!b) continue;
          ctx.beginPath(); ctx.arc(b.x, b.y, R * 1.45, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${0.18 + 0.2 * pulse})`; ctx.lineWidth = 1.6 * px; ctx.stroke();
        }
      }
    }

    // shadows (screen space, away from the lamp)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rs = R * V.s;
    const shadow = shadowSprite(rs);
    const drawShadow = (x, y, k = 1) => {
      const [sx, sy] = toS(x, y);
      const sz = shadow.width / dpr * k;
      ctx.drawImage(shadow, sx - sz / 2 + rs * 0.22, sy - sz / 2 + rs * 0.34, sz, sz);
    };
    for (const b of balls.values()) if (!(T.place && T.place.id === b.id)) drawShadow(b.x, b.y);

    // balls dropping into the pockets
    T.drops = T.drops.filter((d) => {
      const t = (now - d.t0) / 220;
      if (t >= 1) return false;
      const x = d.x0 + (d.px - d.x0) * Math.min(1, t * 1.4), y = d.y0 + (d.py - d.y0) * Math.min(1, t * 1.4);
      const [sx, sy] = toS(x, y);
      const k = 1 - 0.42 * t;
      ctx.globalAlpha = 1 - t * t;
      ctx.drawImage(spriteOf(d.b), sx - rs * k - 1 / dpr * 0, sy - rs * k, rs * 2 * k, rs * 2 * k);
      ctx.fillStyle = `rgba(0,0,0,${0.6 * t})`;
      ctx.beginPath(); ctx.arc(sx, sy, rs * k, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    });

    // aiming guide (under the balls), ghost ball on top
    let guide = null;
    if (shooterView && cueBall() && (shooterView.mine || ctl.showOthersGuide)) {
      const cb = placePos();
      const key = [cb[0], cb[1], shooterView.a, shooterView.mine ? Math.round(shooterView.p * 20) : 0, shooterView.sx, shooterView.sy, balls.size, F.turn].join();
      if (key !== T.guideKey || !T.guide) { T.guide = computeGuide(cb[0], cb[1], shooterView.a, shooterView.mine ? (shooterView.p || T.kbPower) : 0.5, shooterView.sx, shooterView.sy); T.guideKey = key; }
      guide = T.guide;
      tableTransform(ctx);
      drawGuideLines(guide, px, shooterView.mine ? 1 : 0.5);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // balls
    if (!ballLut || ballLut.diam !== Math.round(rs * 2 * dpr * 100) / 100) ballLut = makeLut(Math.round(rs * 2 * dpr * 100) / 100);
    for (const b of balls.values()) {
      let x = b.x, y = b.y;
      if (T.place && T.place.id === b.id) { x = T.place.x; y = T.place.y; drawShadow(x, y, 1.15); }
      shadeBall(b, ballLut, feltRgb);
      const [sx, sy] = toS(x, y);
      const sz = ballLut.sz / dpr;
      if (T.place && T.place.id === b.id && !T.place.ok) ctx.globalAlpha = 0.55;
      ctx.drawImage(b.sp, sx - sz / 2, sy - sz / 2, sz, sz);
      ctx.globalAlpha = 1;
    }

    if (guide) { tableTransform(ctx); drawGhost(guide, px, shooterView.mine ? 1 : 0.55); }

    // ball in hand marker
    tableTransform(ctx);
    if (aiming && F.inHand && cueBall()) {
      const [x, y] = placePos();
      const ok = !T.place || T.place.ok;
      const pulse = 0.5 + 0.5 * Math.sin(now / 200);
      ctx.beginPath(); ctx.arc(x, y, R * (1.55 + 0.15 * pulse), 0, Math.PI * 2);
      ctx.strokeStyle = ok ? `rgba(163,230,53,${0.55 + 0.35 * pulse})` : 'rgba(244,63,94,0.95)';
      ctx.lineWidth = 2 * px; ctx.stroke();
      if (!T.place && ctl.canPlace() && !(T.hover && dist2(T.hover, [x, y]) > (4 * R) ** 2) && now % 1 >= 0) {
        // little move arrows
        ctx.fillStyle = 'rgba(163,230,53,0.85)';
        for (let k = 0; k < 4; k++) {
          const an = k * Math.PI / 2;
          const cxx = x + Math.cos(an) * R * 2.25, cyy = y + Math.sin(an) * R * 2.25;
          ctx.beginPath();
          ctx.moveTo(cxx + Math.cos(an) * R * 0.35, cyy + Math.sin(an) * R * 0.35);
          ctx.lineTo(cxx + Math.cos(an + 2.3) * R * 0.3, cyy + Math.sin(an + 2.3) * R * 0.3);
          ctx.lineTo(cxx + Math.cos(an - 2.3) * R * 0.3, cyy + Math.sin(an - 2.3) * R * 0.3);
          ctx.fill();
        }
      }
    }

    // the cue stick
    const cb = cueBall();
    if (cb && T.strike) {
      const st = T.strike;
      const t = (now - st.t0) / 1000;
      let gap;
      if (t < 0.07) gap = st.from * (1 - (t / 0.07) ** 2);
      else gap = -0.02 * Math.min(1, (t - 0.07) / 0.08);
      const fade = t > 0.35 ? Math.max(0, 1 - (t - 0.35) / 0.25) : 1;
      if (fade > 0) drawCue(st.x, st.y, st.a, gap, st.sx, fade);
      if (t > 0.6 && !st.hold) T.strike = null;
    } else if (shooterView && cb && !T.place) {
      const [x, y] = placePos();
      drawCue(x, y, shooterView.a, 0.012 + Math.max(0, shooterView.p) * 0.3, shooterView.sx, shooterView.mine ? 1 : 0.9);
    }
  }

  function dist2(p, q) { const dx = p[0] - q[0], dy = p[1] - q[1]; return dx * dx + dy * dy; }
  function placePos() {
    if (T.place && T.place.id === 0) return [T.place.x, T.place.y];
    const b = cueBall();
    return b ? [b.x, b.y] : [PC.HEAD_SPOT[0], PC.HEAD_SPOT[1]];
  }
  function spriteOf(b) { shadeBall(b, ballLut, feltRgb); return b.sp; }

  let shadowCv = null;
  function shadowSprite(rs) {
    const sz = Math.ceil(rs * 2 * 1.5 * V.dpr) + 2;
    if (shadowCv && shadowCv.width === sz) return shadowCv;
    shadowCv = document.createElement('canvas'); shadowCv.width = shadowCv.height = sz;
    const g = shadowCv.getContext('2d');
    const gr = g.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.42)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, sz, sz);
    return shadowCv;
  }

  function drawGuideLines(g, px, alpha) {
    const c = ctx;
    const bad = g.bad;
    const col = bad ? '244,63,94' : '255,255,255';
    // cue line: from the cue ball edge to the ghost ball
    const x0 = g.cx + g.ux * R, y0 = g.cy + g.uy * R;
    const x1 = g.gx - g.ux * (g.hit.kind === 'ball' || g.hit.kind === 'rail' ? R : 0), y1 = g.gy - g.uy * (g.hit.kind === 'ball' || g.hit.kind === 'rail' ? R : 0);
    c.lineCap = 'round';
    c.strokeStyle = `rgba(${col},${0.18 * alpha})`; c.lineWidth = 5 * px;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = `rgba(${col},${0.8 * alpha})`; c.lineWidth = 1.4 * px;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    if (g.obj && !bad) {
      // object ball path
      const bx = g.hit.bx + g.obj.nx * R, by = g.hit.by + g.obj.ny * R;
      const list = [];
      for (const b of balls.values()) if (b.id !== g.hit.id && b.id !== 0) list.push([b.id, b.x, b.y]);
      const lim = castRay(g.hit.bx, g.hit.by, g.obj.nx, g.obj.ny, list, g.hit.id).t;
      const len = Math.min(g.obj.len, lim);
      const ex = g.hit.bx + g.obj.nx * len, ey = g.hit.by + g.obj.ny * len;
      const gr = c.createLinearGradient(bx, by, ex, ey);
      gr.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.strokeStyle = gr; c.lineWidth = 2.6 * px;
      c.beginPath(); c.moveTo(bx, by); c.lineTo(ex, ey); c.stroke();
    }
    if (g.cue && !bad) {
      const lim = castRay(g.gx, g.gy, g.cue.ux, g.cue.uy, [], -1).t;
      const len = Math.min(g.cue.len, lim);
      const ex = g.gx + g.cue.ux * len, ey = g.gy + g.cue.uy * len;
      c.setLineDash([0.012, 0.01]);
      c.strokeStyle = `rgba(125,230,255,${0.75 * alpha})`; c.lineWidth = 1.5 * px;
      c.beginPath(); c.moveTo(g.gx, g.gy); c.lineTo(ex, ey); c.stroke();
      c.setLineDash([]);
    }
    if (g.bounce) {
      const lim = castRay(g.gx, g.gy, g.bounce.ux, g.bounce.uy, [], -1).t;
      const len = Math.min(g.bounce.len, lim);
      c.setLineDash([0.012, 0.01]);
      c.strokeStyle = `rgba(255,255,255,${0.45 * alpha})`; c.lineWidth = 1.3 * px;
      c.beginPath(); c.moveTo(g.gx, g.gy); c.lineTo(g.gx + g.bounce.ux * len, g.gy + g.bounce.uy * len); c.stroke();
      c.setLineDash([]);
    }
    c.lineCap = 'butt';
  }
  function drawGhost(g, px, alpha) {
    if (g.hit.kind === 'pocket' || g.hit.kind === 'none') return;
    const c = ctx;
    const bad = g.bad;
    c.beginPath(); c.arc(g.gx, g.gy, R, 0, Math.PI * 2);
    c.fillStyle = bad ? `rgba(244,63,94,${0.18 * alpha})` : `rgba(255,255,255,${0.12 * alpha})`;
    c.fill();
    c.strokeStyle = bad ? `rgba(244,63,94,${0.95 * alpha})` : `rgba(255,255,255,${0.85 * alpha})`;
    c.lineWidth = 1.5 * px; c.stroke();
    if (bad) {
      const k = R * 0.45;
      c.beginPath(); c.moveTo(g.gx - k, g.gy - k); c.lineTo(g.gx + k, g.gy + k); c.moveTo(g.gx + k, g.gy - k); c.lineTo(g.gx - k, g.gy + k);
      c.lineWidth = 2 * px; c.stroke();
    }
  }

  /** The cue stick, its tip `gap` meters behind the cue ball, drawn in table coords. */
  function drawCue(x, y, a, gap, sx, alpha) {
    const c = ctx;
    const ux = Math.cos(a), uy = Math.sin(a);
    const side = (sx || 0) * R * 0.55;
    const tipX = x - ux * (R + gap) - uy * side, tipY = y - uy * (R + gap) + ux * side;
    const LEN = 1.46;
    const TIP = 0.0065, BUTT = 0.0148;
    c.save();
    c.globalAlpha = alpha;
    c.translate(tipX, tipY);
    c.rotate(a + Math.PI);      // local +x runs from the tip to the butt
    const wAt = (d) => TIP + (BUTT - TIP) * Math.min(1, d / LEN) ** 0.9;
    const body = (d0, d1) => {
      c.beginPath();
      c.moveTo(d0, -wAt(d0)); c.lineTo(d1, -wAt(d1)); c.lineTo(d1, wAt(d1)); c.lineTo(d0, wAt(d0)); c.closePath();
    };
    // shadow on the cloth
    c.save();
    c.translate(0.012, 0.02);
    body(0, LEN);
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 8 * V.dpr;
    c.fill();
    c.restore();
    const cyl = (cols) => {
      const gr = c.createLinearGradient(0, -BUTT, 0, BUTT);
      // cylinder shading: dark edges, a bright stripe a little above the middle
      gr.addColorStop(0, cols[2]); gr.addColorStop(0.32, cols[1]); gr.addColorStop(0.42, cols[0]); gr.addColorStop(0.55, cols[1]); gr.addColorStop(1, cols[2]);
      return gr;
    };
    const part = (d0, d1, cols) => { body(d0, d1); c.fillStyle = cyl(cols); c.fill(); };
    part(0, 0.011, ['#7fb0ff', '#2f6fd6', '#123a7a']);                  // chalked tip
    part(0.011, 0.034, ['#ffffff', '#f2eee2', '#a9a492']);              // ferrule
    part(0.034, 0.78, ['#fff3d6', '#e8c98f', '#9a7240']);               // maple shaft
    part(0.78, 0.792, ['#ffffff', '#c9ccd2', '#5d626b']);               // joint ring
    part(0.792, 1.06, ['#6a4a35', '#2a1a12', '#0a0605']);               // ebony forearm
    // maple points inlaid in the forearm
    c.fillStyle = cyl(['#fff6dc', '#e2c48c', '#8f6a3a']);
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(0.80, s * wAt(0.8) * 0.15); c.lineTo(1.0, s * wAt(1.0) * 0.95); c.lineTo(0.8, s * wAt(0.8) * 0.95); c.closePath(); c.fill();
    }
    part(1.06, 1.07, ['#ffffff', '#c9ccd2', '#5d626b']);
    part(1.07, 1.3, ['#5a5f6b', '#2b2f38', '#0e1015']);                 // wrap
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 0.002;
    for (let d = 1.075; d < 1.3; d += 0.006) { c.beginPath(); c.moveTo(d, -wAt(d)); c.lineTo(d + 0.004, wAt(d)); c.stroke(); }
    part(1.3, 1.31, ['#ffffff', '#c9ccd2', '#5d626b']);
    part(1.31, 1.445, ['#7a2f3a', '#3a0f18', '#12040a']);               // butt sleeve
    part(1.445, LEN, ['#444', '#1a1a1a', '#000']);                      // bumper
    c.restore();
  }

  /** The cue that should be shown now: ours while we aim, else the shooter's (opponent / CPU). */
  function cueView() {
    if (T.ctl.canAim()) return { a: T.aim.a, p: T.aim.pull, sx: T.aim.sx, sy: T.aim.sy, mine: true };
    if (T.view) return { a: T.view.a, p: T.view.p, sx: T.view.sx, sy: T.view.sy, mine: false };
    return null;
  }

  // ================================================================ input: table pointer, power bar, fine aim, spin, keys
  const stage = $('#stage');
  let ptr = null;           // active pointer gesture on the table
  let mouseLock = null;     // [sx, sy] where fine aim (keys / wheel) last happened: the mouse doesn't re-aim until it moves away

  function evPos(e) {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function aimAt(tx, ty) {
    const [x, y] = placePos();
    const dx = tx - x, dy = ty - y;
    if (dx * dx + dy * dy < (1.2 * R) ** 2) return;
    setAim(Math.atan2(dy, dx));
  }
  function setAim(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    T.aim.a = a;
    aimChanged();
  }
  function aimChanged() { if (T.ctl && T.ctl.onAim) T.ctl.onAim(T.aim); }
  /** Which ball the pointer grabs (cue ball when in hand; any ball in practice). */
  function grabbable(tx, ty, touch) {
    const ctl = T.ctl;
    if (!ctl.canPlace()) return null;
    const reach = (touch ? 2.6 : 1.6) * R;
    const [x, y] = placePos();
    if (dist2([tx, ty], [x, y]) < reach * reach) return 0;
    if (ctl.free) {
      for (const b of balls.values()) if (b.id && dist2([tx, ty], [b.x, b.y]) < (1.2 * R) ** 2) return b.id;
    }
    return null;
  }
  function placeOk(id, x, y) {
    const F = T.F;
    if (id === 0) return PC.validPlacement(F, x, y);
    // practice: any ball anywhere it fits
    const tmp = { ...F, kitchen: false, balls: F.balls.filter((b) => b[0] !== id).map((b) => (b[0] === 0 ? [99, b[1], b[2]] : b)) };
    return PC.validPlacement(tmp, x, y);
  }

  cv.addEventListener('pointerdown', (e) => {
    if (!T.ctl || !T.F) return;
    const [sx, sy] = evPos(e);
    const [tx, ty] = toT(sx, sy);
    const touch = e.pointerType !== 'mouse';
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    Sfx.ac && Sfx.ac();
    const gid = grabbable(tx, ty, touch);
    if (gid !== null) {
      const b = balls.get(gid);
      const [bx, by] = gid === 0 ? placePos() : [b.x, b.y];
      T.place = { id: gid, x: bx, y: by, ok: true, ox: bx - tx, oy: by - ty, sx: bx, sy: by };
      ptr = { kind: 'place', id: e.pointerId };
      cv.setPointerCapture(e.pointerId);
      stage.classList.add('grabbing');
      Sfx.play('click');
      return;
    }
    if (!T.ctl.canAim()) return;
    if (touch) {
      ptr = { kind: 'touchAim', id: e.pointerId, last: [sx, sy] };
      aimAt(tx, ty);
    } else {
      const a = T.aim.a;
      // screen direction of the aim
      const p0 = toS(0, 0), p1 = toS(Math.cos(a), Math.sin(a));
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy);
      ptr = { kind: 'stroke', id: e.pointerId, x0: sx, y0: sy, dx: dx / l, dy: dy / l, max: Math.max(120, Math.min(300, 0.5 * V.s)) };
    }
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!T.ctl || !T.F) return;
    const [sx, sy] = evPos(e);
    const [tx, ty] = toT(sx, sy);
    T.hover = [tx, ty];
    if (ptr && ptr.id === e.pointerId) {
      if (ptr.kind === 'place') {
        const x = tx + T.place.ox, y = ty + T.place.oy;
        T.place.x = x; T.place.y = y;
        T.place.ok = placeOk(T.place.id, x, y);
        if (T.place.ok && T.place.id === 0 && T.ctl.onPlace) T.ctl.onPlace(x, y);
      } else if (ptr.kind === 'touchAim') {
        if (e.shiftKey) setAim(T.aim.a + (sx - ptr.last[0]) * 0.002);
        else aimAt(tx, ty);
        ptr.last = [sx, sy];
      } else if (ptr.kind === 'stroke') {
        const pull = ((ptr.x0 - sx) * ptr.dx + (ptr.y0 - sy) * ptr.dy) / ptr.max;
        T.aim.pull = clamp(pull, 0, 1);
        showPower(T.aim.pull);
        aimChanged();
      }
      return;
    }
    // hover
    const canGrab = grabbable(tx, ty, false) !== null;
    stage.classList.toggle('grab', canGrab);
    stage.classList.toggle('idle', !T.ctl.canAim() && !canGrab);
    if (e.pointerType === 'mouse' && T.ctl.canAim() && !canGrab) {
      if (mouseLock && Math.hypot(sx - mouseLock[0], sy - mouseLock[1]) < 8) return;
      mouseLock = null;
      if (e.shiftKey && ptr === null && T.lastMouse) setAim(T.aim.a + (sx - T.lastMouse[0] + sy - T.lastMouse[1]) * 0.0006);
      else aimAt(tx, ty);
      T.lastMouse = [sx, sy];
    }
  });
  const endPtr = (e) => {
    if (!ptr || ptr.id !== e.pointerId) return;
    const p = ptr;
    ptr = null;
    stage.classList.remove('grabbing');
    if (p.kind === 'place') {
      const P = T.place;
      if (!P.ok) { P.x = P.sx; P.y = P.sy; Sfx.play('wrong'); }
      if (P.id === 0) {
        const cb = cueBall();
        if (cb) { cb.x = P.x; cb.y = P.y; }
        if (T.ctl.onPlace) T.ctl.onPlace(P.x, P.y, true);
      } else {
        const b = balls.get(P.id);
        if (b) { b.x = P.x; b.y = P.y; }
        if (T.ctl.onMoveBall) T.ctl.onMoveBall(P.id, P.x, P.y);
      }
      T.place = null;
      T.guide = null;
      return;
    }
    if (p.kind === 'stroke') {
      const pw = T.aim.pull;
      if (e.type === 'pointerup' && pw >= 0.02) shoot(pw);
      else { T.aim.pull = 0; showPower(0); aimChanged(); }
    }
  };
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('pointerleave', () => { T.hover = null; });
  cv.addEventListener('wheel', (e) => {
    if (!T.ctl || !T.ctl.canAim()) return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.01 : 0.0018) * Math.sign(e.deltaY || e.deltaX);
    setAim(T.aim.a + step);
    mouseLock = evPos(e);
  }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  /** The local player lets go: strike with `power`. */
  function shoot(power) {
    const ctl = T.ctl;
    if (!ctl || !ctl.canAim()) return;
    const [x, y] = placePos();
    T.strike = { t0: performance.now(), from: 0.012 + power * 0.3, x, y, a: T.aim.a, sx: T.aim.sx, hold: true };
    T.aim.pull = 0;
    showPower(0);
    Snd.cue(power);
    const F = T.F;
    ctl.shoot(T.aim.a, power, T.aim.sx, T.aim.sy, F.inHand ? x : undefined, F.inHand ? y : undefined);
  }

  // ---- power bar: pull down and let go
  const ptrack = $('#ptrack');
  let pdrag = null;
  function showPower(p) {
    $('#pfill').style.height = `calc(${(p * 100).toFixed(1)}% - ${p > 0 ? 8 * p : 0}px)`;
    $('#pcue').style.top = `${-60 + p * 52}%`;
    $('#ppct').textContent = p > 0 ? Math.round(p * 100) + '%' : '';
  }
  function showKbMark() {
    const m = $('#pmark');
    m.style.top = `${T.kbPower * 100}%`;
  }
  ptrack.addEventListener('pointerdown', (e) => {
    if (!T.ctl || !T.ctl.canAim()) return;
    e.preventDefault();
    pdrag = { id: e.pointerId, y0: e.clientY, hgt: ptrack.clientHeight };
    ptrack.setPointerCapture(e.pointerId);
    Sfx.ac && Sfx.ac();
  });
  ptrack.addEventListener('pointermove', (e) => {
    if (!pdrag || pdrag.id !== e.pointerId) return;
    T.aim.pull = clamp((e.clientY - pdrag.y0) / (pdrag.hgt * 0.85), 0, 1);
    showPower(T.aim.pull);
    aimChanged();
  });
  const pEnd = (e) => {
    if (!pdrag || pdrag.id !== e.pointerId) return;
    pdrag = null;
    const pw = T.aim.pull;
    if (e.type === 'pointerup' && pw >= 0.02 && T.ctl.canAim()) shoot(pw);
    else { T.aim.pull = 0; showPower(0); aimChanged(); }
  };
  ptrack.addEventListener('pointerup', pEnd);
  ptrack.addEventListener('pointercancel', pEnd);

  // ---- fine aim strip
  const fine = $('#fine');
  let fdrag = null;
  let ridgeX = 0;
  fine.addEventListener('pointerdown', (e) => { if (!T.ctl || !T.ctl.canAim()) return; fdrag = { id: e.pointerId, x: e.clientX }; fine.setPointerCapture(e.pointerId); });
  fine.addEventListener('pointermove', (e) => {
    if (!fdrag || fdrag.id !== e.pointerId) return;
    const dx = e.clientX - fdrag.x;
    fdrag.x = e.clientX;
    ridgeX += dx;
    $('#ridges').style.backgroundPosition = `${ridgeX}px 0`;
    setAim(T.aim.a + dx * 0.0009);
    mouseLock = T.lastMouse || [0, 0];
    if (Math.abs(dx) > 2) Sfx.play('tick');
  });
  const fEnd = (e) => { if (fdrag && fdrag.id === e.pointerId) fdrag = null; };
  fine.addEventListener('pointerup', fEnd);
  fine.addEventListener('pointercancel', fEnd);

  // ---- spin: where the tip hits the cue ball
  const spinEl = $('#spin');
  const spinCv = $('#spin-cv');
  function drawSpin(canvas, big) {
    const sz = Math.round((big ? 200 : 64) * Math.min(2, window.devicePixelRatio || 1));
    if (canvas.width !== sz) { canvas.width = canvas.height = sz; }
    const g = canvas.getContext('2d');
    const L = makeLutCached(sz);
    const img = g.createImageData(L.sz, L.sz);
    paintSphere(img.data, L, 0, SPIN_M, false, [0, 0, 0]);
    g.clearRect(0, 0, sz, sz);
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = L.sz;
    tmp.getContext('2d').putImageData(img, 0, 0);
    g.drawImage(tmp, 0, 0, sz, sz);
    const r = sz / 2;
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = Math.max(1, sz / 90);
    g.beginPath(); g.moveTo(r, sz * 0.12); g.lineTo(r, sz * 0.88); g.moveTo(sz * 0.12, r); g.lineTo(sz * 0.88, r); g.stroke();
    g.beginPath(); g.arc(r, r, r * 0.42, 0, Math.PI * 2); g.stroke();
    const dx = r + T.aim.sx * r * 0.82, dy = r - T.aim.sy * r * 0.82;
    g.beginPath(); g.arc(dx, dy, sz * 0.085, 0, Math.PI * 2);
    g.fillStyle = '#e11d48'; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = sz / 40; g.stroke();
  }
  const SPIN_M = new Float64Array([1, 0, 0, 0, -1, 0, 0, 0, -1]);
  rotate(SPIN_M, 1, 0, 0, 1.3);
  const lutCache = {};
  function makeLutCached(sz) { return lutCache[sz] || (lutCache[sz] = makeLut(sz - 2)); }
  function setSpinFrom(e, canvas) {
    const r = canvas.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width * 2 - 1) / 0.82, y = -((e.clientY - r.top) / r.height * 2 - 1) / 0.82;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    T.aim.sx = Math.round(x * 100) / 100; T.aim.sy = Math.round(y * 100) / 100;
    if (Math.abs(T.aim.sx) < 0.06 && Math.abs(T.aim.sy) < 0.06) { T.aim.sx = 0; T.aim.sy = 0; }
    redrawSpin();
    aimChanged();
  }
  let spinPop = null;
  function redrawSpin() { drawSpin(spinCv, false); if (spinPop) drawSpin(spinPop.cv, true); }
  function bindSpin(canvas) {
    let id = null;
    canvas.addEventListener('pointerdown', (e) => { if (!T.ctl || !T.ctl.canAim()) return; id = e.pointerId; canvas.setPointerCapture(id); setSpinFrom(e, canvas); e.stopPropagation(); });
    canvas.addEventListener('pointermove', (e) => { if (id === e.pointerId) setSpinFrom(e, canvas); });
    const end = (e) => { if (id === e.pointerId) { id = null; Sfx.play('click'); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', () => { T.aim.sx = 0; T.aim.sy = 0; redrawSpin(); aimChanged(); });
  }
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (coarse) {
    // phones: tap the little ball to open a big one
    spinEl.addEventListener('click', () => { if (T.ctl && T.ctl.canAim()) openSpinPop(); });
  } else bindSpin(spinCv);
  function openSpinPop() {
    if (spinPop) return;
    const big = h('canvas');
    const close = () => { if (spinPop) { spinPop.el.remove(); spinPop = null; } };
    const el = h('div', { class: 'bl-spinpop', onclick: (e) => { if (e.target === el) close(); } },
      h('div', { class: 'box' }, h('b', {}, '🎯 Spin'), big,
        h('div', { class: 'row', style: { gap: '8px', display: 'flex' } },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { T.aim.sx = 0; T.aim.sy = 0; redrawSpin(); aimChanged(); } }, 'Center'),
          h('button', { class: 'btn btn-pink btn-sm', onclick: close }, 'Done'))));
    stage.append(el);
    spinPop = { el, cv: big };
    bindSpin(big);
    redrawSpin();
  }

  // ---- keys
  window.addEventListener('keydown', (e) => {
    if ($('#play').classList.contains('hidden') || !T.ctl) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    if (!T.ctl.canAim()) return;
    const big = e.shiftKey ? 8 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setAim(T.aim.a + (e.key === 'ArrowLeft' ? -1 : 1) * 0.0025 * big);
      mouseLock = T.lastMouse || [0, 0];
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      T.kbPower = clamp(Math.round((T.kbPower + (e.key === 'ArrowUp' ? 0.05 : -0.05)) * 100) / 100, 0.05, 1);
      showKbMark();
      flashPct(T.kbPower);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) shoot(T.kbPower);
    }
  });
  let pctTimer = null;
  function flashPct(p) {
    $('#pmark').style.opacity = '1';
    $('#ppct').textContent = Math.round(p * 100) + '%';
    clearTimeout(pctTimer);
    pctTimer = setTimeout(() => { if (!T.aim.pull) $('#ppct').textContent = ''; }, 1200);
  }

  // ================================================================ main loop
  function loop(now) {
    requestAnimationFrame(loop);
    if ($('#play').classList.contains('hidden')) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    sndBudget = 4;
    stepAnim(now);
    if (T.view) {
      // ease the opponent's / CPU's cue towards its target
      const v = T.view;
      let da = v.ta - v.a;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const k = Math.min(1, dt * (v.fast || 12));
      v.a += da * k;
      v.p += (v.tp - v.p) * k;
      if (v.tx !== undefined && T.F && T.F.inHand) {
        const cb = cueBall();
        if (cb) { cb.x += (v.tx - cb.x) * k; cb.y += (v.ty - cb.y) * k; }
      }
    }
    if (T.ctl && T.ctl.tick) T.ctl.tick(now, dt);
    draw(now);
    hudTick(now);
  }
  requestAnimationFrame(loop);

  // ================================================================ HUD: player cards, status, overlays
  const RING = 2 * Math.PI * 22;
  function card(i, p) {
    // p: { name, avatar, color, score, turn, sub (node[]), dim }
    const el = $('#card' + i);
    el.classList.toggle('turn', !!p.turn);
    el.classList.toggle('dim', !!p.dim);
    el.style.setProperty('--c', p.color || '#facc15');
    const key = JSON.stringify([p.name, p.avatar, p.color, p.score, p.subKey, !!p.turn, !!p.clock]);
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const svg = '<svg viewBox="0 0 50 50" aria-hidden="true"><circle class="bg" cx="25" cy="25" r="22"/><circle class="fg" cx="25" cy="25" r="22" stroke-dasharray="' + RING + '" stroke-dashoffset="' + (p.clock ? 0 : RING) + '"/></svg>';
    const av = h('div', { class: 'bl-av', html: svg });
    av.prepend(UI.avatar(p));
    fill(el, av, h('div', { class: 'bl-info' }, h('div', { class: 'bl-name' }, p.name), h('div', { class: 'bl-sub' }, p.sub || '')), h('div', { class: 'bl-score' }, p.score == null ? '' : String(p.score)));
    if (p.turn && G) FX.bump(av);
  }
  /** Group balls for the card: the group's balls (gone ones faded) or what's next. */
  function groupSub(F, seat) {
    if (!F) return { sub: '', key: '' };
    const on = new Set(F.balls.map((b) => b[0]));
    if (F.mode === '9ball') {
      if (F.turn !== seat || F.over) return { sub: '', key: 'n' };
      const low = Math.min(...[...on].filter((x) => x));
      return { sub: [h('span', {}, 'Next'), ballImg(low)], key: 'n' + low };
    }
    if (F.open) return { sub: F.isBreak ? (F.turn === seat ? 'Break!' : '') : 'Open table', key: 'o' + F.isBreak + F.turn };
    const g = F.groups[seat];
    if (!g) return { sub: '', key: '' };
    const ids = g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    const left = ids.filter((id) => on.has(id));
    if (!left.length) return { sub: [h('span', {}, 'On the'), ballImg(8)], key: 'e' };
    return { sub: ids.map((id) => ballImg(id, on.has(id) ? '' : 'gone')), key: g + left.join() };
  }
  let clock = null;          // { end, total, seat }
  function hudTick(now) {
    for (let i = 0; i < 2; i++) {
      const c = $('#card' + i + ' .fg');
      if (!c) continue;
      if (clock && clock.seat === i && clock.total) {
        const left = Math.max(0, (clock.end - now) / 1000);
        const frac = left / clock.total;
        c.setAttribute('stroke-dashoffset', String(RING * (1 - frac)));
        c.classList.toggle('warn', left < 10 && left >= 5);
        c.classList.toggle('hot', left < 5);
        if (left < 5.5 && left > 0 && Math.floor(left) !== clock.tick) { clock.tick = Math.floor(left); if (clock.mine) Sfx.play('tick'); }
      } else c.setAttribute('stroke-dashoffset', String(RING));
    }
    const ce = $('#bl-mid .clock');
    if (ce) ce.textContent = clock && clock.total ? Math.ceil(Math.max(0, (clock.end - now) / 1000)) + 's' : '';
    if (T.ctl && T.ctl.timerText) { const el = $('#solo-timer'); if (el) el.textContent = T.ctl.timerText(now); }
  }
  function setStatus(text) { const el = $('#status'); if (el.textContent !== text) el.textContent = text; }
  function setThink(text) { const el = $('#think'); el.classList.toggle('on', !!text); if (text) el.textContent = text; }
  function overlay(node) {
    const el = $('#overlay');
    fill(el, node || null);
    if (node && G) G.from(node, { scale: 0.7, autoAlpha: 0, duration: 0.45, ease: 'back.out(2)' });
  }
  function controlsOn(on) {
    $('#power').classList.toggle('off', !on);
    $('#fine').classList.toggle('off', !on);
    spinEl.classList.toggle('off', !on);
    if (!on && spinPop) { spinPop.el.remove(); spinPop = null; }
  }

  /** Toasts after a shot. names: [seat0, seat1] display names, meIdx: our seat or -1. */
  function announce(res, shooterSeat, F2, names, meIdx) {
    if (!res) return;
    const who = shooterSeat === meIdx ? 'You' : names[shooterSeat];
    if (res.foul) {
      UI.toast(`🚫 ${FOUL_TEXT[res.reason] || 'Foul'}${res.over ? '' : ` · ${F2.turn === meIdx ? 'your' : names[F2.turn] + '’s'} ball in hand`}`, 'bad', 2600);
      if (G) FX.shake(stage);
      if (!Sfx.muted) Sfx.play('wrong');
    }
    if (res.assigned) {
      const g = res.assigned;
      UI.toast(`${shooterSeat === meIdx ? '🎯 You are' : `🎯 ${names[shooterSeat]} is`} ${g === 'solids' ? 'solids ●' : 'stripes ◐'}`, 'good', 2600);
    }
    if (!res.foul && !res.over && res.potted && res.potted.length && res.again && shooterSeat === meIdx && res.potted.length >= 2) UI.toast(`🔥 ${res.potted.length} balls in one shot!`, 'good', 1800);
    void who;
  }

  // ================================================================ screens
  const SCREENS = ['entry', 'menu', 'room', 'play'];
  function showScreen(name) {
    for (const s of SCREENS) $('#' + s).classList.toggle('hidden', s !== name);
    if (name === 'play') { V.w = 0; requestAnimationFrame(() => { layout(); redrawSpin(); showKbMark(); }); }
  }
  window.addEventListener('resize', () => layout());
  window.addEventListener('orientationchange', () => setTimeout(layout, 200));

  function soloBar(nodes) {
    const el = $('#solo-bar');
    el.classList.toggle('hidden', !nodes);
    fill(el, nodes || null);
  }
  function tools(extra = []) {
    fill($('#tools'), ...extra,
      h('button', { class: 'icon-btn', title: 'Table colour', 'aria-label': 'Table colour', onclick: feltPicker }, '🎨'));
  }
  function feltPicker() {
    const close = UI.modal(h('div', {},
      h('h2', {}, '🎨 Table cloth'),
      h('p', { class: 'muted small' }, 'Pick your felt. Only you see it.'),
      h('div', { class: 'felt-pick' }, Object.entries(FELTS).map(([k, [name, col]]) => h('button', {
        class: k === feltKey ? 'on' : '', title: name, 'aria-label': name, style: { background: col },
        onclick: () => { feltKey = k; store.set('pool_felt', k); feltRgb = hexRgb(col); buildStatic(); for (const b of balls.values()) b.dirty = true; Sfx.play('pop'); close(); },
      })))));
  }

  // ================================================================ CPU brain (pool-ai.js, in a worker when possible)
  let aiWorker = null;
  let aiWorkerBroken = false;
  function aiChoose(F, level) {
    const budget = coarse ? 650 : 900;
    const sync = () => new Promise((res) => setTimeout(() => {
      let r = null;
      try { if (window.PoolAI) r = window.PoolAI.choose(PC.cloneFrame(F), level, { budgetMs: budget }); } catch (e) { console.warn('PoolAI failed', e); }
      res(r || fallbackAI(F, level));
    }, 30));
    if (aiWorkerBroken || !window.PoolAI || typeof Worker === 'undefined') return sync();
    try {
      if (!aiWorker) {
        const o = location.origin;
        const src = `self.window = self;
          try { importScripts('${o}/js/games/pool-core.js', '${o}/js/games/pool-ai.js'); } catch (e) { self.bad = String(e); }
          onmessage = (e) => {
            if (self.bad || !self.PoolAI) { postMessage({ err: self.bad || 'no PoolAI' }); return; }
            try { postMessage({ r: self.PoolAI.choose(e.data.F, e.data.level, { budgetMs: e.data.budget }) }); } catch (er) { postMessage({ err: String(er) }); }
          };`;
        aiWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      }
    } catch (e) { aiWorkerBroken = true; return sync(); }
    return new Promise((res) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; aiWorkerBroken = true; try { aiWorker.terminate(); } catch { /* gone */ } aiWorker = null; sync().then(res); } }, budget + 2500);
      aiWorker.onmessage = (e) => {
        if (done) return;
        done = true; clearTimeout(t);
        if (e.data && e.data.r) res(e.data.r);
        else { aiWorkerBroken = true; sync().then(res); }
      };
      aiWorker.onerror = () => { if (done) return; done = true; clearTimeout(t); aiWorkerBroken = true; sync().then(res); };
      aiWorker.postMessage({ F: PC.cloneFrame(F), level, budget });
    });
  }
  /** A simple straight-in shooter, used only if pool-ai.js is missing or failed. */
  function fallbackAI(F, level) {
    const cue = F.balls.find((b) => b[0] === 0) || [0, PC.HEAD_SPOT[0], PC.HEAD_SPOT[1]];
    let cx = cue[1], cy = cue[2];
    if (F.inHand && !PC.validPlacement(F, cx, cy)) {
      for (let k = 0; k < 200; k++) { const x = R + Math.random() * (F.kitchen ? HEAD_X - 2 * R : W - 2 * R), y = R + Math.random() * (H - 2 * R); if (PC.validPlacement(F, x, y)) { cx = x; cy = y; break; } }
    }
    const legal = legalSetFor(F);
    const targets = F.balls.filter((b) => b[0] !== 0 && (!legal || legal.has(b[0])));
    let best = null;
    for (const b of targets) {
      for (const p of POCKETS) {
        let tx = p.x - b[1], ty = p.y - b[2];
        const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
        const gx = b[1] - tx * D, gy = b[2] - ty * D;
        let ax = gx - cx, ay = gy - cy;
        const al = Math.hypot(ax, ay); ax /= al; ay /= al;
        const cut = ax * tx + ay * ty;
        if (cut < 0.25) continue;
        const score = cut - al * 0.1 - tl * 0.1;
        if (!best || score > best.score) best = { score, a: Math.atan2(ay, ax), p: clamp(0.25 + (al + tl) * 0.18, 0.25, 0.85) };
      }
    }
    if (!best) {
      const b = targets[0] || F.balls.find((x) => x[0] !== 0);
      best = { a: b ? Math.atan2(b[2] - cy, b[1] - cx) : 0, p: 0.5 };
    }
    const err = [0, 0.03, 0.012, 0.004][level] || 0.02;
    return { a: best.a + (Math.random() - 0.5) * err, p: F.isBreak ? 1 : best.p, sx: 0, sy: 0, cx, cy, think: '' };
  }
  function legalSetFor(F) {
    const on = F.balls.map((b) => b[0]).filter((id) => id !== 0);
    if (F.mode === '9ball') return new Set([Math.min(...on)]);
    if (F.isBreak) return null;
    if (F.open) { const l = on.filter((id) => id !== 8); return new Set(l.length ? l : [8]); }
    const mine = on.filter((id) => PC.groupOf(id) === F.groups[F.turn]);
    return new Set(mine.length ? mine : [8]);
  }

  // ================================================================ solo
  const LEVELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
  const soloPrefs = { mode: '8ball', level: 2, pmode: '8ball', ...store.get('pool_solo', {}) };
  const saveSoloPrefs = () => store.set('pool_solo', soloPrefs);
  let solo = null;

  function soloMenu() {
    stopSolo();
    showScreen('menu');
    const best = store.get('pool_speed_best', null);
    const wins = store.get('pool_cpu_wins', {});
    const seg = (key, opts) => h('div', { class: 'seg' }, opts.map(([v, label]) => h('button', {
      class: soloPrefs[key] === v ? 'on' : '', onclick: () => { soloPrefs[key] = v; saveSoloPrefs(); soloMenu(); Sfx.play('click'); },
    }, label)));
    fill($('#menu'),
      h('div', { class: 'page-head' }, h('h1', { class: 'display' }, '🎱 Billiards solo'), h('p', { class: 'muted' }, 'Sharpen your game, then take it online.')),
      h('div', { class: 'bl-modes' },
        h('div', { class: 'bl-mode' },
          h('span', { class: 'e' }, '🤖'), h('b', {}, 'vs CPU'),
          h('p', {}, 'A full frame against the computer. It thinks, it aims, it sometimes misses (on Easy, a lot).'),
          seg('mode', [['8ball', '8-ball'], ['9ball', '9-ball']]),
          seg('level', [[1, 'Easy'], [2, 'Medium'], [3, 'Hard']]),
          h('span', { class: 'best' }, Object.keys(wins).length ? `🏆 Wins: ${[1, 2, 3].map((l) => `${LEVELS[l]} ${wins[l] || 0}`).join(' · ')}` : ' '),
          h('button', { class: 'btn btn-pink btn-block', onclick: () => startSolo('cpu') }, '🎱 Play the CPU')),
        h('div', { class: 'bl-mode' },
          h('span', { class: 'e' }, '⏱️'), h('b', {}, 'Speed Clear'),
          h('p', {}, 'All 15 balls, no opponent. Clear the table as fast as you can. Every scratch costs +10 seconds.'),
          h('span', { class: 'best' }, best ? `🏆 Best: ${fmtMs(best)}` : 'No best time yet'),
          h('button', { class: 'btn btn-cyan btn-block', onclick: () => startSolo('speed') }, '⏱️ Start the clock')),
        h('div', { class: 'bl-mode' },
          h('span', { class: 'e' }, '🎯'), h('b', {}, 'Practice'),
          h('p', {}, 'A free table, no rules. Drag any ball anywhere to set up a shot and try it again and again.'),
          seg('pmode', [['8ball', '8-ball rack'], ['9ball', '9-ball rack']]),
          h('button', { class: 'btn btn-lime btn-block', onclick: () => startSolo('practice') }, '🎯 Practice'))),
      h('div', { style: { textAlign: 'center', marginTop: '18px' } },
        h('button', { class: 'btn btn-ghost', onclick: () => { history.replaceState(null, '', location.pathname); showScreen('entry'); Lobby.showEntry(); } }, '👥 Play friends online')));
    if (FX.list) FX.list($('#menu').querySelectorAll('.bl-mode'), { y: 30, stagger: 0.08, duration: 0.5, ease: 'back.out(1.6)' });
  }
  function fmtMs(ms) {
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
  }
  function stopSolo() {
    if (solo) { solo.dead = true; solo = null; }
    finishAnim();
    T.view = null; T.strike = null; T.place = null;
    setThink('');
    overlay(null);
    clock = null;
  }

  function startSolo(kind) {
    stopSolo();
    const url = new URL(location.href); url.searchParams.set('solo', '1'); history.replaceState(null, '', url);
    const me = PA.Profile.get();
    solo = {
      kind, dead: false, level: soloPrefs.level, mode: kind === 'practice' ? soloPrefs.pmode : kind === 'speed' ? '8ball' : soloPrefs.mode,
      scores: [0, 0], breaker: 0, busy: false, me, start: 0, penalty: 0, scratches: 0, shots: 0, finished: false,
    };
    T.ctl = soloCtl;
    $('#bl-grid').classList.add('solo');
    showScreen('play');
    soloBar(null);
    tools([
      h('button', { class: 'btn btn-ghost btn-sm', onclick: soloMenu }, '← Menu'),
      kind !== 'cpu' ? h('button', { class: 'btn btn-yellow btn-sm', onclick: () => { soloFrame(); Sfx.play('pop'); } }, kind === 'speed' ? '🔁 Restart' : '🔁 Re-rack') : null,
    ]);
    soloFrame();
  }

  function soloFrame() {
    const s = solo;
    if (!s) return;
    overlay(null);
    setThink('');
    T.view = null; T.strike = null;
    finishAnim();
    const F = PC.newFrame(s.mode, s.breaker, Math.random);
    if (s.kind !== 'cpu') { F.turn = 0; F.breaker = 0; }
    if (s.kind === 'practice') { F.kitchen = false; }
    s.start = 0; s.penalty = 0; s.scratches = 0; s.shots = 0; s.finished = false; s.busy = false;
    T.F = F;
    newRack(F);
    T.aim.a = Math.atan2(PC.FOOT_SPOT[1] - F.balls[0][2], PC.FOOT_SPOT[0] - F.balls[0][1]);
    T.aim.sx = 0; T.aim.sy = 0; redrawSpin();
    soloHud();
    if (s.kind === 'cpu' && F.turn === 1) cpuTurn();
  }

  const soloCtl = {
    get free() { return solo && solo.kind !== 'cpu'; },
    showOthersGuide: false,
    canAim() { return !!solo && !solo.busy && !T.anim && !T.strike && T.F && !T.F.over && (solo.kind !== 'cpu' || T.F.turn === 0) && !solo.finished; },
    canPlace() {
      if (!this.canAim()) return false;
      return solo.kind === 'practice' || T.F.inHand;
    },
    onPlace(x, y, done) {
      if (!done) return;
      const F = T.F;
      const cb = F.balls.find((b) => b[0] === 0);
      if (cb) { cb[1] = x; cb[2] = y; }
    },
    onMoveBall(id, x, y) {
      const b = T.F.balls.find((q) => q[0] === id);
      if (b) { b[1] = x; b[2] = y; }
      T.F.isBreak = false;
    },
    shoot(a, p, sx, sy, cx, cy) { soloShoot(a, p, sx, sy, cx, cy); },
    tick(now) {
      if (!solo) return;
      soloStatus();
      void now;
    },
    timerText(now) {
      if (!solo || solo.kind !== 'speed') return '';
      const ms = solo.finished ? solo.time : solo.start ? now - solo.start + solo.penalty * 1000 : 0;
      return fmtMs(ms) + (solo.penalty ? ` (+${solo.penalty}s)` : '');
    },
  };

  async function soloShoot(a, p, sx, sy, cx, cy) {
    const s = solo;
    if (!s || s.busy) return;
    s.busy = true;
    const F = T.F;
    if (s.kind !== 'cpu' && F.inHand) F.kitchen = F.isBreak && s.kind === 'speed';
    const shot = PC.makeShot(F, a, p, sx, sy, cx, cy);
    await sleepMs(75);
    if (s.dead) return;
    T.strike.hold = false;
    if (s.kind === 'speed' && !s.start) s.start = performance.now();
    s.shots++;
    if (s.kind === 'cpu') {
      const out = PC.applyShot(F, shot);
      await playShot(F.balls, shot, out.frame.balls);
      if (s.dead) return;
      afterCpuGameShot(out, F.turn);
    } else {
      const sim = PC.simulate(F.balls.map((b) => [b[0], b[1], b[2]]), shot);
      await playShot(F.balls, shot, sim.balls);
      if (s.dead) return;
      const F2 = PC.cloneFrame(F);
      F2.balls = sim.balls.map((b) => [b[0], b[1], b[2]]);
      F2.isBreak = false;
      F2.shots++;
      const scratch = !F2.balls.some((b) => b[0] === 0);
      F2.inHand = s.kind === 'practice';
      F2.kitchen = false;
      if (scratch) {
        placeCueBall(F2);
        F2.inHand = true;
        if (s.kind === 'speed') { s.penalty += 10; s.scratches++; UI.toast('🚫 Scratch! +10 seconds · ball in hand', 'bad', 2200); Sfx.play('wrong'); }
      }
      T.F = F2;
      setBalls(F2.balls);
      renderTray();
      if (s.kind === 'speed' && !F2.balls.some((b) => b[0] !== 0)) speedDone();
    }
    s.busy = false;
    T.guide = null;
    soloHud();
  }
  function placeCueBall(F) {
    const tries = [[PC.HEAD_SPOT[0], PC.HEAD_SPOT[1]]];
    for (let k = 1; k < 60; k++) for (const [dx, dy] of [[-1, 0], [0, -1], [0, 1], [1, 0]]) tries.push([PC.HEAD_SPOT[0] + dx * k * R, PC.HEAD_SPOT[1] + dy * k * R]);
    for (const [x, y] of tries) if (PC.validPlacement({ ...F, kitchen: false }, x, y)) { F.balls.push([0, x, y]); F.balls.sort((a, b) => a[0] - b[0]); return; }
    F.balls.push([0, PC.HEAD_SPOT[0], PC.HEAD_SPOT[1]]);
    F.balls.sort((a, b) => a[0] - b[0]);
  }
  function speedDone() {
    const s = solo;
    s.finished = true;
    s.time = Math.round(performance.now() - s.start + s.penalty * 1000);
    const best = store.get('pool_speed_best', null);
    const isBest = !best || s.time < best;
    if (isBest) store.set('pool_speed_best', s.time);
    PA.Account.submit('pool-speed', s.time);
    UI.confetti(isBest ? 220 : 120);
    Sfx.play('win');
    if (FX.banner) FX.banner('🧹 TABLE CLEARED', fmtMs(s.time), { color: '#22d3ee' });
    overlay(h('div', { class: 'card' },
      h('h2', {}, isBreakRecord(isBest)),
      h('div', { class: 'big' }, fmtMs(s.time)),
      h('p', {}, `${s.shots} shots${s.scratches ? ` · ${s.scratches} scratch${s.scratches > 1 ? 'es' : ''} (+${s.penalty}s)` : ' · no scratches'}`),
      best && !isBest ? h('p', {}, `Best: ${fmtMs(best)}`) : null,
      h('div', { class: 'btns' },
        h('button', { class: 'btn btn-pink', onclick: () => soloFrame() }, '🔁 Again'),
        h('button', { class: 'btn btn-ghost', onclick: soloMenu }, 'Menu'))));
  }
  function isBreakRecord(isBest) { return isBest ? '🏆 New best time!' : '🧹 Table cleared!'; }

  function afterCpuGameShot(out, shooter) {
    const s = solo;
    const F2 = out.frame;
    T.F = F2;
    setBalls(F2.balls);
    renderTray();
    announce(out.result, shooter, F2, [s.me.name, 'CPU'], 0);
    if (F2.over) { cpuFrameOver(out.result); return; }
    T.aim.pull = 0;
    if (F2.turn === 1) cpuTurn();
    else if (shooter === 1) { aimTowardTarget(); }
  }
  function aimTowardTarget() {
    const F = T.F;
    const cb = F.balls.find((b) => b[0] === 0);
    if (!cb) return;
    const legal = legalSetFor(F);
    let best = null, bd = 1e9;
    for (const b of F.balls) {
      if (b[0] === 0 || (legal && !legal.has(b[0]))) continue;
      const d = Math.hypot(b[1] - cb[1], b[2] - cb[2]);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) T.aim.a = Math.atan2(best[2] - cb[2], best[1] - cb[1]);
  }
  function cpuFrameOver(res) {
    const s = solo;
    const youWon = res.winner === 0;
    s.scores[res.winner]++;
    s.breaker = 1 - s.breaker;
    soloHud();
    if (youWon) {
      PA.Account.submit('pool-cpu', s.level);
      const wins = store.get('pool_cpu_wins', {});
      wins[s.level] = (wins[s.level] || 0) + 1;
      store.set('pool_cpu_wins', wins);
      setTimeout(() => { UI.confetti(220); Sfx.play('win'); }, 250);
      if (FX.banner) FX.banner('🏆 YOU WIN', WIN_TEXT[res.win] || '', { color: '#facc15' });
    } else {
      setTimeout(() => Sfx.play('lose'), 250);
      if (FX.banner) FX.banner('🤖 CPU WINS', WIN_TEXT[res.win] || '', { color: '#f43f5e' });
    }
    const why = res.win === 'eight' || res.win === 'nine' ? `${youWon ? 'You' : 'The CPU'} ${WIN_TEXT[res.win]}` : `${youWon ? 'The CPU' : 'You'}: ${WIN_TEXT[res.win] || ''}`;
    setTimeout(() => {
      if (solo !== s) return;
      overlay(h('div', { class: 'card' },
        h('h2', {}, youWon ? '🏆 Frame to you!' : '🤖 Frame to the CPU'),
        h('p', {}, why),
        res.runout && youWon ? h('p', { style: { color: 'var(--yellow)' } }, '🔥 Run out!') : null,
        h('div', { class: 'big' }, `${s.scores[0]} – ${s.scores[1]}`),
        h('div', { class: 'btns' },
          h('button', { class: 'btn btn-pink', onclick: () => soloFrame() }, '🎱 Next frame'),
          h('button', { class: 'btn btn-ghost', onclick: soloMenu }, 'Menu'))));
    }, 900);
  }

  async function cpuTurn() {
    const s = solo;
    if (!s || s.dead) return;
    s.busy = true;
    const F = T.F;
    const cb = F.balls.find((b) => b[0] === 0);
    T.view = { a: T.aim.a, ta: T.aim.a, p: 0, tp: 0, sx: 0, sy: 0, fast: 6 };
    setThink('🤖 CPU is thinking…');
    await sleepMs(350);
    if (s.dead) return;
    // wander the cue while the brain works (it runs in a worker, so this keeps animating)
    const t0 = performance.now();
    const wander = setInterval(() => { if (T.view && !s.dead) T.view.ta = T.view.a + (Math.random() - 0.5) * 0.9; }, 380);
    const pick = await aiChoose(F, s.level);
    clearInterval(wander);
    if (s.dead) return;
    const think = 800 + Math.random() * 700 - (performance.now() - t0);
    if (pick.think) setThink('🤖 ' + pick.think);
    if (F.inHand && cb && PC.validPlacement(F, pick.cx, pick.cy)) {
      T.view.tx = pick.cx; T.view.ty = pick.cy;
      await sleepMs(450);
      if (s.dead) return;
      const c2 = cueBall(); if (c2) { c2.x = pick.cx; c2.y = pick.cy; }
      T.view.tx = undefined;
    }
    // sweep onto the line, settle, a couple of practice strokes
    T.view.fast = 5;
    T.view.ta = pick.a + (Math.random() - 0.5) * 0.25;
    await sleepMs(Math.max(350, think * 0.6));
    T.view.fast = 9;
    T.view.ta = pick.a;
    await sleepMs(Math.max(300, think * 0.4));
    if (s.dead) return;
    T.view.a = pick.a;
    T.view.tp = Math.min(1, pick.p) * 0.6; T.view.fast = 5;
    await sleepMs(300);
    T.view.tp = 0.05;
    await sleepMs(240);
    T.view.tp = pick.p; T.view.fast = 6;
    T.view.sx = pick.sx || 0;
    await sleepMs(420);
    if (s.dead) return;
    setThink('');
    const [x, y] = [cueBall() ? cueBall().x : 0, cueBall() ? cueBall().y : 0];
    T.strike = { t0: performance.now(), from: 0.012 + T.view.p * 0.3, x, y, a: pick.a, sx: pick.sx || 0, hold: true };
    T.view = null;
    Snd.cue(pick.p);
    const shot = PC.makeShot(F, pick.a, pick.p, pick.sx || 0, pick.sy || 0, pick.cx, pick.cy);
    await sleepMs(75);
    if (s.dead) return;
    T.strike.hold = false;
    const out = PC.applyShot(F, shot);
    await playShot(F.balls, shot, out.frame.balls);
    if (s.dead) return;
    s.busy = false;
    afterCpuGameShot(out, 1);
    soloHud();
  }
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  function soloHud() {
    const s = solo;
    if (!s) return;
    const F = T.F;
    const me = s.me;
    if (s.kind === 'cpu') {
      const g0 = groupSub(F, 0), g1 = groupSub(F, 1);
      card(0, { ...me, score: s.scores[0], turn: F.turn === 0 && !F.over, sub: g0.sub, subKey: g0.key, dim: F.turn !== 0 });
      card(1, { name: 'CPU', avatar: '🤖', color: '#22d3ee', score: s.scores[1], turn: F.turn === 1 && !F.over, sub: g1.sub, subKey: g1.key, dim: F.turn !== 1 });
      fill($('#bl-mid'), h('div', { class: 'mode' }, '🎱 ', MODE_NAME[F.mode]), h('div', { class: 'race' }, `${LEVELS[s.level].toUpperCase()} CPU`));
      $('#card1').style.display = '';
      $('.bl-top').classList.remove('single');
    } else {
      const left = F.balls.filter((b) => b[0] !== 0).length;
      card(0, { ...me, score: null, turn: true, sub: s.kind === 'speed' ? `${left} ball${left === 1 ? '' : 's'} to go` : 'Free table · drag any ball', subKey: 'l' + left });
      $('#card1').style.display = 'none';
      $('.bl-top').classList.add('single');
      fill($('#bl-mid'), h('div', { class: 'mode' }, s.kind === 'speed' ? '⏱️ Speed Clear' : `🎯 Practice · ${MODE_NAME[F.mode]} rack`),
        s.kind === 'speed' ? h('div', { class: 'timer', id: 'solo-timer' }, '0:00.0') : null);
    }
    $('#help').textContent = coarse
      ? 'Drag on the table to aim · pull the power bar down and let go · fine aim strip · tap the white ball for spin'
      : 'Move the mouse to aim · drag back (or pull the power bar) and let go to shoot · ← → / wheel fine aim · ↑ ↓ + Space · set spin on the white ball';
  }
  function soloStatus() {
    const s = solo;
    if (!s || !T.F) return;
    const F = T.F;
    let st = '';
    if (T.anim) st = '';
    else if (s.finished || F.over) st = '';
    else if (s.kind === 'cpu' && F.turn === 1) st = '🤖 CPU’s shot';
    else if (s.kind === 'practice') st = '🎯 Practice · drag balls to set up a shot';
    else if (F.isBreak) st = F.inHand ? '💥 Your break · ball in hand behind the line' : '💥 Your break';
    else if (F.inHand) st = s.kind === 'speed' ? '✋ Ball in hand' : `✋ Ball in hand${F.kitchen ? ' (behind the line)' : ''}`;
    else st = s.kind === 'speed' ? '' : '🎱 Your shot';
    setStatus(st);
    controlsOn(soloCtl.canAim());
  }

  // ================================================================ online
  let S = null;              // last public state from the server
  let pendingState = null;   // a state that arrived while a shot was still rolling on screen
  let lastShotSeen = 0;
  let lastFrameNo = -1;
  let lastPhase = '';
  let lastSent = 0;
  let sendTimer = null;
  let placeSent = 0;

  const mySeat = () => (S && S.seats ? S.seats.indexOf(Net.id) : -1);
  const pl = (id) => (id && Room.player(id)) || { name: id ? 'Player' : 'Empty seat', avatar: id ? '🙂' : '🪑', color: '#555' };
  const SEAT_C = ['#facc15', '#22d3ee'];

  const onlineCtl = {
    free: false,
    showOthersGuide: false,
    canAim() {
      return !!S && S.phase === 'aiming' && !S.busy && !T.anim && !T.strike && !!T.F && !T.F.over && mySeat() === T.F.turn && !onlineCtl.sent;
    },
    canPlace() { return this.canAim() && T.F.inHand; },
    onAim(aim) {
      if (!this.canAim()) return;
      const now = performance.now();
      clearTimeout(sendTimer);
      const send = () => { lastSent = performance.now(); Net.send('g:aim', { a: aim.a, p: aim.pull, sx: aim.sx, sy: aim.sy }); };
      if (now - lastSent > 85) send(); else sendTimer = setTimeout(send, 85 - (now - lastSent));
    },
    onPlace(x, y, done) {
      const now = performance.now();
      if (done || now - placeSent > 85) { placeSent = now; Net.send('g:place', { x, y }); }
      if (done) { const cb = T.F.balls.find((b) => b[0] === 0); if (cb) { cb[1] = x; cb[2] = y; } }
    },
    shoot(a, p, sx, sy, cx, cy) {
      onlineCtl.sent = true;
      const msg = { a, p, sx, sy };
      if (cx !== undefined) { msg.cx = cx; msg.cy = cy; }
      Net.send('g:shoot', msg);
      setTimeout(() => {
        // the server didn't take it (e.g. the clock ran out): give the cue back
        if (onlineCtl.sent && !T.anim) { onlineCtl.sent = false; if (T.strike) T.strike = null; }
      }, 2500);
    },
    tick() { onlineStatus(); },
  };

  function normState(m) { return m && m.state && m.phase === undefined ? m.state : m; }

  function onlineState(st, fromJoin) {
    if (!st) return;
    if (T.anim && !fromJoin) { pendingState = st; return; }
    applyState(st, fromJoin);
  }
  function applyState(st, snap) {
    const prev = S;
    S = st;
    pendingState = null;
    T.ctl = onlineCtl;
    route();
    if (!S.frame) { T.F = null; return; }
    const newFrame = S.frameNo !== lastFrameNo;
    const F = S.frame;
    const turnChanged = !T.F || T.F.turn !== F.turn || T.F.shots !== F.shots || newFrame;
    T.F = PC.cloneFrame(F);
    if (newFrame) { lastFrameNo = S.frameNo; newRack(T.F); } else { setBalls(T.F.balls); renderTray(); }
    if (S.shotNo > lastShotSeen) lastShotSeen = S.shotNo;
    if (turnChanged || snap) {
      onlineCtl.sent = false;
      T.strike = null;
      T.place = null;
      T.aim.pull = 0;
      showPower(0);
      if (mySeat() === F.turn) { T.view = null; aimTowardTarget(); T.aim.sx = 0; T.aim.sy = 0; redrawSpin(); if (S.phase === 'aiming' && (!prev || prev.phase !== 'aiming' || turnChanged)) myTurnPing(); }
      else {
        const cb = T.F.balls.find((b) => b[0] === 0);
        const a = cb ? defaultAim(T.F) : 0;
        T.view = { a, ta: a, p: 0, tp: 0, sx: 0, sy: 0 };
      }
    }
    // shot clock
    if (S.phase === 'aiming' && S.clockLeft != null && S.settings.clock) clock = { end: performance.now() + S.clockLeft * 1000, total: S.settings.clock, seat: F.turn, mine: mySeat() === F.turn };
    else clock = null;
    onlineHud();
    phaseEffects(prev);
  }
  function defaultAim(F) {
    const save = T.aim.a;
    aimTowardTarget();
    const a = T.aim.a;
    T.aim.a = save;
    void F;
    return a;
  }
  function myTurnPing() {
    Sfx.play('pop');
    if (G) FX.bump($('#card' + mySeat() + ' .bl-av'));
  }

  function phaseEffects(prev) {
    const ph = S.phase;
    if (ph === lastPhase && prev) { overlayForPhase(); return; }
    const was = lastPhase;
    lastPhase = ph;
    overlayForPhase();
    if (ph === 'frameover' && was && was !== 'frameover') frameOverFx();
    if (ph === 'over' && was && was !== 'over') matchOverFx();
    if (ph === 'aiming' && was === 'lobby') { UI.toast('🎱 Rack ’em up!', 'good'); Sfx.play('go'); }
  }
  function frameWinnerUid() { return S.frame && S.frame.winner != null ? S.seats[S.frame.winner] : null; }
  function frameOverFx() {
    const uid = frameWinnerUid();
    if (!uid) return;
    const mine = uid === Net.id;
    if (FX.banner) FX.banner(mine ? '🏆 FRAME TO YOU' : `🎱 ${pl(uid).name.toUpperCase()}`, WIN_TEXT[S.frame.reason] || '', { color: mine ? '#facc15' : '#22d3ee' });
    if (mine) { UI.confetti(120); Sfx.play('win'); } else if (mySeat() !== -1) Sfx.play('lose'); else Sfx.play('coin');
  }
  function matchOverFx() {
    const uid = S.matchWinner;
    const mine = uid === Net.id;
    if (FX.banner) FX.banner(mine ? '🏆 YOU WIN THE MATCH' : `🏆 ${pl(uid).name.toUpperCase()} WINS`, scoreLine(), { color: '#facc15', hold: 1.8 });
    if (mine) { setTimeout(() => { UI.confetti(260); Sfx.play('win'); }, 300); } else if (mySeat() !== -1) setTimeout(() => Sfx.play('lose'), 300); else UI.confetti(80);
  }
  function scoreLine() { return S.seats.map((u) => (S.scores && S.scores[u]) || 0).join(' – '); }

  function overlayForPhase() {
    const ph = S.phase;
    const key = ph + ':' + S.frameNo + ':' + (S.matchWinner || '') + ':' + Room.isHost + ':' + (S.waiting || []).length + ':' + mySeat();
    if (overlayForPhase.key === key) return;
    overlayForPhase.key = key;
    if (ph === 'frameover') {
      const uid = frameWinnerUid();
      const reason = S.frame && S.frame.reason;
      overlay(h('div', { class: 'card' },
        h('h2', {}, uid === Net.id ? '🏆 Frame to you!' : `🎱 Frame to ${pl(uid).name}`),
        h('p', {}, reason === 'eight' || reason === 'nine' ? `${uid === Net.id ? 'You' : pl(uid).name} ${WIN_TEXT[reason]}` : (WIN_TEXT[reason] ? `The other player ${WIN_TEXT[reason]}` : '')),
        h('div', { class: 'big' }, scoreLine()),
        h('p', {}, `Race to ${S.settings.race} · next frame in a moment…`)));
    } else if (ph === 'over') {
      const uid = S.matchWinner;
      const seated = mySeat() !== -1;
      const canSwap = Room.isHost && (S.waiting || []).length > 0;
      overlay(h('div', { class: 'card' },
        h('h2', {}, uid === Net.id ? '🏆 You win the match!' : `🏆 ${pl(uid).name} wins!`),
        h('div', { class: 'big' }, scoreLine()),
        h('p', {}, `${MODE_NAME[S.settings.mode]} · race to ${S.settings.race}`),
        h('div', { class: 'btns' },
          seated ? h('button', { class: 'btn btn-pink', onclick: () => { Net.send('g:rematch'); Sfx.play('click'); } }, '🔁 Rematch') : null,
          canSwap ? h('button', { class: 'btn btn-cyan', onclick: () => { Net.send('g:swap'); Sfx.play('click'); } }, '🔄 Winner stays on') : null,
          Room.isHost ? h('button', { class: 'btn btn-ghost', onclick: () => { lobbyView = true; route(); } }, '⚙️ Settings') : null),
        !seated ? h('p', { class: 'small' }, '👀 You’re watching') : null));
    } else overlay(null);
  }

  let lobbyView = false;
  function route() {
    if (solo) return;
    if (!Room.code || !S) return;
    const showTable = S.phase !== 'lobby' && !(S.phase === 'over' && lobbyView);
    if (S.phase !== 'over') lobbyView = false;
    if (showTable) {
      if ($('#play').classList.contains('hidden')) { $('#bl-grid').classList.remove('solo'); soloBar(null); tools([]); showScreen('play'); }
    } else {
      showScreen('room');
      renderLobby();
    }
  }

  function renderLobby() {
    const host = Room.isHost;
    const s = S.settings;
    const send = (patch) => { Net.send('g:settings', patch); Sfx.play('click'); };
    const seg = (key, options, label, fmt) => h('div', {},
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, label),
      h('div', { class: 'seg' }, options.map((v) => h('button', { class: s[key] === v ? 'on' : '', disabled: !host, onclick: () => send({ [key]: v }) }, fmt(v)))));
    const seatBox = (i) => {
      const id = S.seats[i];
      const p = pl(id);
      return h('div', { class: 'bl-seat' + (id ? ' full' : ''), style: { '--c': SEAT_C[i] } }, id ? UI.avatar(p) : h('span', { style: { fontSize: '1.6rem' } }, '🪑'), h('span', { class: 'nm' }, id ? p.name : 'Waiting for a player…'));
    };
    const ready = S.seats.filter(Boolean).length === 2;
    fill($('#room-main'),
      h('div', { class: 'panel-title' }, '🎱 At the table'),
      h('div', { class: 'bl-seats' }, seatBox(0), h('span', { class: 'bl-vs' }, 'VS'), seatBox(1)),
      (S.waiting || []).length ? h('p', { class: 'small muted', style: { marginTop: '-8px' } }, `Next up: ${S.waiting.map((u) => pl(u).name).join(', ')} (winner stays on)`) : null,
      h('div', { class: 'panel-title' }, '⚙️ Game settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'set-grid' },
        seg('mode', ['8ball', '9ball'], 'GAME', (v) => (v === '8ball' ? '🎱 8-ball' : '9️⃣ 9-ball')),
        seg('race', [1, 2, 3, 5], 'RACE TO', (v) => `${v} frame${v > 1 ? 's' : ''}`),
        seg('clock', [0, 30, 45, 60], 'SHOT CLOCK', (v) => (v ? `${v}s` : 'Off'))),
      h('div', { style: { marginTop: '18px' } }, host
        ? h('button', { class: 'btn btn-pink btn-lg btn-block', disabled: !ready, onclick: () => { lobbyView = false; Net.send('g:start'); } }, ready ? (S.phase === 'over' ? '🔁 New match' : '🎱 Break off!') : '⏳ Waiting for a second player')
        : h('div', { class: 'center muted bold', style: { padding: '12px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host'))),
      h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '10px' } }, 'Two players at the table, everyone else watches and plays the winner.'));
  }

  function onlineHud() {
    if (!S || !T.F) return;
    const F = T.F;
    const playing = S.phase === 'aiming' || S.phase === 'rolling';
    for (let i = 0; i < 2; i++) {
      const uid = S.seats[i];
      const p = pl(uid);
      const gs = groupSub(F, i);
      card(i, { ...p, name: uid ? p.name + (uid === Net.id ? ' (you)' : '') : 'Empty seat', score: (S.scores && S.scores[uid]) || 0, turn: playing && F.turn === i, dim: playing && F.turn !== i,
        sub: gs.sub, subKey: gs.key + (p.online === false ? 'off' : ''), clock: !!(clock && clock.seat === i), color: SEAT_C[i] });
    }
    $('#card1').style.display = '';
    $('.bl-top').classList.remove('single');
    fill($('#bl-mid'),
      h('div', { class: 'mode' }, MODE_NAME[S.settings.mode]),
      h('div', { class: 'race' }, `RACE TO ${S.settings.race}`),
      h('div', { class: 'clock' }));
    $('#help').textContent = mySeat() === -1 ? '👀 You’re watching. Join in from the room panel to play the winner.' : coarse
      ? 'Drag on the table to aim · pull the power bar down and let go · fine aim strip · tap the white ball for spin'
      : 'Move the mouse to aim · drag back (or pull the power bar) and let go to shoot · ← → / wheel fine aim · ↑ ↓ + Space · set spin on the white ball';
  }
  function onlineStatus() {
    if (!S || !T.F) return;
    const F = T.F;
    let st = '';
    const shooter = S.seats[F.turn];
    if (S.phase === 'aiming' && !T.anim) {
      if (shooter === Net.id) st = F.isBreak ? '💥 Your break!' : F.inHand ? `✋ Ball in hand${F.kitchen ? ' (behind the line)' : ''}` : '🎱 Your shot';
      else st = `${pl(shooter).avatar} ${pl(shooter).name} ${F.isBreak ? 'is breaking' : F.inHand ? 'has ball in hand' : 'is aiming'}${pl(shooter).online === false ? ' (reconnecting…)' : ''}`;
      if (mySeat() === -1) st = '👀 ' + st;
    } else if (S.phase === 'frameover' || S.phase === 'over') st = '';
    setStatus(st);
    controlsOn(onlineCtl.canAim());
  }

  Net.on('g:state', (m) => { if (!solo) onlineState(normState(m)); });
  Net.on('g:shot', async (m) => {
    if (solo || !m || !m.shot) return;
    if (T.anim) finishAnim();
    lastShotSeen = Math.max(lastShotSeen, m.shotNo || 0);
    const st = normState(m.state);
    T.view = null;
    onlineCtl.sent = false;
    if (T.strike) T.strike.hold = false;
    else if (m.shooter !== Net.id) {
      // show the opponent's cue strike
      const b0 = (m.before || []).find((b) => b[0] === 0);
      if (b0) { T.strike = { t0: performance.now() - 30, from: 0.012 + 0.3 * Math.min(1, Math.hypot(m.shot.vx, m.shot.vy) / PC.MAX_SPEED), x: m.shot.x, y: m.shot.y, a: Math.atan2(m.shot.vy, m.shot.vx), sx: m.shot.sx, hold: false }; Snd.cue(Math.min(1, Math.hypot(m.shot.vx, m.shot.vy) / 7)); }
    }
    if (st) { S = { ...st, phase: 'rolling' }; }
    await sleepMs(T.strike ? 60 : 0);
    if (solo) return;
    const prevF = T.F;
    await playShot(m.before, m.shot, m.after);
    if (solo) return;
    const names = [pl(S.seats[0]).name, pl(S.seats[1]).name];
    const shooterSeat = m.seat != null ? m.seat : S.seats.indexOf(m.shooter);
    if (st && st.frame) announce(m.result, shooterSeat, st.frame, names, mySeat());
    void prevF;
    const next = pendingState || st;
    pendingState = null;
    if (next) applyState(next, false);
  });
  Net.on('g:aim', (m) => {
    if (solo || !T.view || !S || m.id !== S.seats[T.F ? T.F.turn : 0]) return;
    T.view.ta = m.a; T.view.tp = m.p || 0; T.view.sx = m.sx || 0; T.view.sy = m.sy || 0; T.view.fast = 14;
  });
  Net.on('g:place', (m) => {
    if (solo || !T.view || !T.F || !T.F.inHand) return;
    T.view.tx = m.x; T.view.ty = m.y;
    const cb = T.F.balls.find((b) => b[0] === 0);
    if (cb) { cb[1] = m.x; cb[2] = m.y; }
  });
  Net.on('g:toast', (m) => { if (!solo && m && m.text) UI.toast(m.text, '', 3200); });

  // ================================================================ admin cheats in solo practice (local only)
  PA.on('admin:cheat', ({ action }) => {
    if (!solo || Room.code || !T.F) return;
    const F = T.F;
    if (action === 'hand') { F.inHand = true; F.kitchen = false; }
    else if (action === 'clear') {
      if (F.mode === '9ball') F.balls = F.balls.filter((b) => b[0] === 0 || b[0] === 9);
      else { const g = F.groups[0] || 'solids'; F.open = false; F.groups = [g, g === 'solids' ? 'stripes' : 'solids']; F.balls = F.balls.filter((b) => PC.groupOf(b[0]) !== g); }
      F.isBreak = false;
      setBalls(F.balls); renderTray();
    }
    soloHud();
  });

  // ================================================================ boot
  Lobby.init({
    game: 'billiards',
    title: 'Billiards',
    emoji: '🎱',
    tagline: 'Proper pool with real rolling balls. 8-ball or 9-ball, with friends or against the CPU.',
    howTo: '<b>How to play</b><ul><li><b>Aim</b> by moving the mouse (or dragging on the table), <b>shoot</b> by dragging back and letting go, or pull the power bar.</li><li>Put spin on the white ball for follow, draw and side.</li><li><b>8-ball:</b> pot your group (solids or stripes), then the 8. <b>9-ball:</b> always hit the lowest ball first; whoever pots the 9 wins.</li><li>Two players at the table, everyone else watches and plays the winner.</li></ul>',
    solo: { label: '🎮 Play solo (vs CPU, Speed Clear, Practice)', onClick: soloMenu },
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'), { extra: (p) => (S && S.seats && S.seats.includes(p.id) ? h('span', { title: 'At the table' }, '🎱') : null) });
  Lobby.renderPlayers($('#play-players'), { extra: (p) => (S && S.seats && S.seats.includes(p.id) ? h('span', { title: 'At the table' }, '🎱') : null) });
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#play-chat'));

  Lobby.on('joined', (m) => {
    stopSolo();
    lastFrameNo = -1; lastPhase = ''; overlayForPhase.key = '';
    T.ctl = onlineCtl;
    applyState(normState(m.state), true);
    Lobby.refreshPlayers();
  });
  Lobby.on('players', () => {
    if (solo || !S) return;
    if (!$('#room').classList.contains('hidden')) renderLobby();
    onlineHud();
    overlayForPhase.key = '';
    if (S.phase === 'over') overlayForPhase();
  });
  Lobby.on('left', () => { S = null; T.F = null; });
  Lobby.on('entry', () => { stopSolo(); for (const s of ['menu', 'room', 'play']) $('#' + s).classList.add('hidden'); });

  tools();
  showPower(0);
  if (new URLSearchParams(location.search).get('solo')) { Lobby.hideEntry(); soloMenu(); }
})();
