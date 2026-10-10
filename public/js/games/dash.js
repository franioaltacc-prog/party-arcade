/* Neon Dash — a mini Geometry Dash with online races.
   Every client builds the same level from a shared seed; the server only
   relays ghost positions and decides who finished first. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store, fmtTime, clamp, on: onBus } = PA;

  // ====================================================================
  // Core physics (units = blocks, y points up, floor at y = 0)
  // ====================================================================
  const SPEED = 10.4;
  const GRAV = 88;
  const JUMP_V = 19.7;
  const PAD_V = 27;
  const ORB_V = 19.7;
  const MAX_FALL = 30;
  const SUB = 1 / 240;
  const COYOTE = 0.09;   // you can still jump this long after running off a ledge
  const BUFFER = 0.13;   // a tap this early before landing still counts
  const ORB_R = 1.15;    // how close you need to be to a yellow ring
  const LEDGE = 0.38;    // a jump that's barely too low still steps up onto a block

  // Level chunks: rows top -> bottom, the last row sits on the floor.
  //   .  empty      #  block       ^  spike      v  hanging spike
  //   o  jump orb (tap/hold in the air)          =  jump pad
  const CHUNKS = {
    1: [
      ['^'], ['^^'], ['#'], ['##'], ['###'], ['#...#'], ['^....^'], ['#..^'], ['^..#'],
      ['##...^'],
    ],
    2: [
      ['^^^'], ['#^^#'], ['=.^^^'], ['..##', '####'], ['.##.', '####'], ['#..#..#'],
      ['..o..', '.....', '^^^^^'],
      ['vvvvvv', '......', '......', '######'],
      ['^.....^^'], ['##^^##'], ['#...^^'],
    ],
    3: [
      ['#^^^'], ['..#', '.##', '###'], ['##..##..##', '##^^##^^##'],
      ['...#####', '........', '=.^^^^^^'],
      ['^^...^^^'],
      ['..o...o..', '.........', '^^^^^^^^^'],
      ['#^^^#'],
    ],
    4: [
      ['^^^.^^^'], ['#^^^#^^^#'],
      ['...##..', '..###..', '.####..', '#####^^'],
      ['..o...o...o..', '.............', '^^^^^^^^^^^^^'],
      ['##.....##', '##^^^^^##'],
      ['=..^^^^#^^^'],
    ],
  };
  const TIER_MIX = {
    easy: [[1, 0.85], [2, 0.15]],
    normal: [[1, 0.3], [2, 0.7]],
    hard: [[2, 0.4], [3, 0.6]],
    insane: [[3, 0.5], [4, 0.5]],
  };
  const GAPS = { easy: [6, 9], normal: [5, 8], hard: [4, 7], insane: [4, 6] };
  const LENGTH = { short: 220, medium: 380, long: 560 };
  const THEMES = {
    easy: { top: '#0b2f4a', bottom: '#0e7490', line: '#22d3ee', ground: '#082f49' },
    normal: { top: '#1e0b3d', bottom: '#6d28d9', line: '#f0abfc', ground: '#2e1065' },
    hard: { top: '#2b0707', bottom: '#9a3412', line: '#fb923c', ground: '#431407' },
    insane: { top: '#03140b', bottom: '#14532d', line: '#a3e635', ground: '#052e16' },
  };

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function addObj(lv, t, x, y) {
    const o = { t, x, y };
    lv.objs.push(o);
    (lv.cols[x] ||= []).push(o);
  }

  function placeChunk(lv, chunk, x0) {
    const rows = chunk.length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < chunk[r].length; c++) {
        const ch = chunk[r][c];
        if (ch !== '.') addObj(lv, ch, x0 + c, rows - 1 - r);
      }
    }
    return chunk[0].length;
  }

  function buildLevel(seed, difficulty = 'normal', length = 'medium') {
    const rng = mulberry32(seed);
    const lv = { objs: [], cols: {}, checkpoints: [0], end: 0, chunks: [], theme: THEMES[difficulty] || THEMES.normal };
    const mix = TIER_MIX[difficulty] || TIER_MIX.normal;
    const [gMin, gMax] = GAPS[difficulty] || GAPS.normal;
    const target = LENGTH[length] || LENGTH.medium;
    let x = 12;
    let last = null;
    while (x < target) {
      let roll = rng();
      let tier = mix[0][0];
      for (const [t, w] of mix) { if ((roll -= w) <= 0) { tier = t; break; } }
      const pool = CHUNKS[tier];
      let chunk = pool[Math.floor(rng() * pool.length)];
      if (chunk === last) chunk = pool[Math.floor(rng() * pool.length)];
      last = chunk;
      lv.chunks.push({ x, tier, chunk });
      x += placeChunk(lv, chunk, x);
      lv.checkpoints.push(x + 0.3);
      // tall sections need extra runway so you can land and react before the next one
      x += gMin + Math.floor(rng() * (gMax - gMin + 1)) + exitRunway(chunk);
    }
    lv.end = x + 6;
    return lv;
  }

  /** Extra floor after a chunk: how high you might be falling from when it ends. */
  function exitRunway(chunk) {
    const rows = chunk.length;
    const w = chunk[0].length;
    let top = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = Math.max(0, w - 4); c < w; c++) {
        if (chunk[r][c] === '#') top = Math.max(top, rows - r);
      }
    }
    const pad = chunk.some((row) => row.includes('=')) ? 2 : 0;
    const orb = chunk.some((row) => row.includes('o')) ? 3 : 0;            // rings leave you high in the air
    const spikeEnd = chunk[rows - 1][w - 1] === '^' ? 1 : 0;              // landing right after spikes is tight
    return Math.max(0, top - 1) * 2 + Math.max(pad, orb) + spikeEnd;
  }

  function newPlayer(x = 0) {
    return { x, y: 0, vy: 0, rot: 0, grounded: true, dead: false, done: false, used: new Set(), air: 0, buffer: 0, jumped: false };
  }

  const hits = (pl, ax0, ay0, ax1, ay1) => pl.x + 0.78 > ax0 && pl.x + 0.22 < ax1 && pl.y + 0.82 > ay0 && pl.y + 0.18 < ay1;

  /** Advance one physics substep. `ev` collects sound/fx events. */
  function step(pl, lv, hold, dt, ev) {
    if (pl.dead || pl.done) return;
    const prevY = pl.y;
    pl.x += SPEED * dt;
    pl.vy = Math.max(pl.vy - GRAV * dt, -MAX_FALL);
    pl.y += pl.vy * dt;
    const wasGrounded = pl.grounded;
    pl.grounded = false;
    if (pl.y <= 0) { pl.y = 0; if (pl.vy < 0) pl.vy = 0; pl.grounded = true; }

    const c0 = Math.floor(pl.x) - 1;
    const c1 = Math.floor(pl.x) + 2;
    // solids first
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols[c];
      if (!col) continue;
      for (const o of col) {
        if (o.t !== '#') continue;
        if (pl.x + 0.97 <= o.x || pl.x + 0.03 >= o.x + 1 || pl.y + 0.97 <= o.y || pl.y >= o.y + 1) continue;
        const top = o.y + 1;
        if (top - pl.y <= LEDGE || (pl.vy <= 0 && prevY >= top - 0.02)) {
          pl.y = top;
          if (pl.vy <= 0) { pl.vy = 0; pl.grounded = true; }
        } else if (pl.vy > 0 && prevY + 0.97 <= o.y + 0.05) {
          pl.y = o.y - 0.97; pl.vy = 0;
        } else {
          pl.dead = true; ev && ev.push('die'); return;
        }
      }
    }
    // hazards, pads, orbs
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols[c];
      if (!col) continue;
      for (const o of col) {
        if (o.t === '^') {
          if (hits(pl, o.x + 0.32, o.y, o.x + 0.68, o.y + 0.55)) { pl.dead = true; ev && ev.push('die'); return; }
        } else if (o.t === 'v') {
          if (hits(pl, o.x + 0.32, o.y + 0.45, o.x + 0.68, o.y + 1)) { pl.dead = true; ev && ev.push('die'); return; }
        } else if (o.t === '=') {
          if (!pl.used.has(o) && pl.x + 0.97 > o.x + 0.1 && pl.x + 0.03 < o.x + 0.9 && pl.y < o.y + 0.3 && pl.y + 0.97 > o.y) {
            pl.vy = PAD_V; pl.grounded = false; pl.used.add(o); ev && ev.push('pad');
          }
        } else if (o.t === 'o') {
          if ((hold || pl.buffer > 0) && !pl.grounded && !pl.used.has(o)) {
            const dx = pl.x - o.x;
            const dy = pl.y - o.y;
            if (dx * dx + dy * dy < ORB_R * ORB_R) { pl.vy = ORB_V; pl.used.add(o); pl.buffer = 0; ev && ev.push('orb'); }
          }
        }
      }
    }
    if (pl.grounded) { pl.air = 0; pl.jumped = false; } else pl.air += dt;
    if ((hold || pl.buffer > 0) && !pl.jumped && (pl.grounded || (pl.air < COYOTE && pl.vy <= 0))) {
      pl.vy = JUMP_V; pl.grounded = false; pl.jumped = true; pl.buffer = 0; ev && ev.push('jump');
    }
    pl.buffer = Math.max(0, pl.buffer - dt);
    if (pl.grounded) {
      if (!wasGrounded) ev && ev.push('land');
      const target = Math.round(pl.rot / 90) * 90;
      pl.rot += (target - pl.rot) * 0.35;
    } else {
      pl.rot += 400 * dt;
    }
    if (pl.x >= lv.end) { pl.done = true; pl.x = lv.end; }
  }

  window.DashCore = { buildLevel, newPlayer, step, CHUNKS, SPEED, SUB, placeChunk, exitRunway };

  // ====================================================================
  // Music: a tiny synthwave loop made with WebAudio
  // ====================================================================
  const Music = (() => {
    let timer = null;
    let bus = null;
    let nextTime = 0;
    let stepN = 0;
    let noiseBuf = null;
    let enabled = store.get('dash_music', true);
    const BPM = 132;
    const STEP = 60 / BPM / 4;
    const CHORDS = [[45, [69, 72, 76]], [41, [65, 69, 72]], [48, [72, 76, 79]], [43, [67, 71, 74]]];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    function voice(c, freq, t, dur, type, vol, cutoff) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = o;
      if (cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
      node.connect(g).connect(bus);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function kick(c, t) {
      const o = c.createOscillator(); const g = c.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.22);
    }
    function noise(c, t, dur, vol, type, freq) {
      if (!noiseBuf) {
        noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const s = c.createBufferSource(); s.buffer = noiseBuf;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    }
    function schedule() {
      const c = Sfx.ac();
      if (!c) return;
      while (nextTime < c.currentTime + 0.12) {
        const bar = Math.floor(stepN / 16) % 4;
        const s = stepN % 16;
        const [root, arp] = CHORDS[bar];
        const t = nextTime;
        if (s % 4 === 0) kick(c, t);
        if (s % 8 === 4) noise(c, t, 0.14, 0.22, 'bandpass', 1800);
        if (s % 2 === 1) noise(c, t, 0.04, 0.08, 'highpass', 7000);
        if (s % 2 === 0) voice(c, mtof(root + (s % 4 === 2 ? 12 : 0)), t, STEP * 1.8, 'sawtooth', 0.12, 700);
        voice(c, mtof(arp[s % 3] + (s >= 8 ? 12 : 0)), t, STEP * 0.9, 'square', 0.03, 3200);
        nextTime += STEP;
        stepN++;
      }
    }
    return {
      get enabled() { return enabled; },
      toggle() { enabled = !enabled; store.set('dash_music', enabled); enabled ? this.start() : this.stop(); return enabled; },
      start() {
        if (timer || !enabled || Sfx.muted) return;
        const c = Sfx.ac();
        if (!c) return;
        bus = c.createGain(); bus.gain.value = 0.45; bus.connect(Sfx.master);
        nextTime = c.currentTime + 0.06; stepN = 0;
        timer = setInterval(schedule, 25);
      },
      stop() {
        clearInterval(timer); timer = null;
        if (bus) { const b = bus; b.gain.setTargetAtTime(0, Sfx.ac().currentTime, 0.04); setTimeout(() => b.disconnect(), 300); bus = null; }
      },
      get playing() { return !!timer; },
    };
  })();
  onBus('muted', (m) => { if (m) Music.stop(); else if (game && game.running && !game.player.done) Music.start(); });

  // ====================================================================
  // Game session (rendering + loop)
  // ====================================================================
  const stage = $('#stage');
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    const r = stage.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  new ResizeObserver(resize).observe(stage);

  let game = null;       // current session
  let hold = false;

  const ghosts = new Map();

  function startSession(opts) {
    stopSession();
    const level = buildLevel(opts.seed, opts.difficulty, opts.length);
    game = {
      ...opts, level,
      player: newPlayer(0),
      attempts: 1, cp: 0, startAt: performance.now() + (opts.countdown || 0) * 1000,
      running: true, finished: false, finishMs: 0, deathTimer: 0, shake: 0,
      particles: [], trail: [], camX: -4, camY: 0, lastSend: 0, last: performance.now(),
      attemptX: 0, flash: 0,
    };
    ghosts.clear();
    showScreen('play');
    resize();
    $('#hud-att').textContent = '1';
    $('#hud-time').textContent = '0.00';
    fill($('#standings'));
    hideBanner();
    renderTrack();
    if (opts.countdown) UI.countdown(opts.countdown, () => Music.start());
    else Music.start();
    requestAnimationFrame(loop);
  }

  function stopSession() {
    if (game) game.running = false;
    game = null;
    Music.stop();
  }

  function respawn() {
    const g = game;
    const cpX = g.checkpoints ? g.level.checkpoints[g.cp] || 0 : 0;
    g.player = newPlayer(cpX);
    g.attempts += 1;
    g.attemptX = cpX;
    g.trail = [];
    g.flash = 1;
    $('#hud-att').textContent = g.attempts;
  }

  function loop(now) {
    const g = game;
    if (!g || !g.running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - g.last) / 1000);
    g.last = now;
    const started = now >= g.startAt;
    const p = g.player;
    const ev = [];

    if (started && !p.dead && !p.done) {
      let acc = dt;
      while (acc > 1e-6) {
        const s = Math.min(SUB, acc);
        step(p, g.level, hold, s, ev);
        acc -= s;
        if (p.dead || p.done) break;
      }
      // checkpoints
      while (g.cp + 1 < g.level.checkpoints.length && p.x >= g.level.checkpoints[g.cp + 1] && p.grounded) g.cp++;
      if (p.done && !g.finished) onFinish(now);
    }
    for (const e of ev) {
      if (e === 'jump') Sfx.play('jump');
      else if (e === 'pad') { Sfx.play('boing'); burst(p.x + 0.5, p.y, '#facc15', 10, 4); }
      else if (e === 'orb') { Sfx.play('orb'); burst(p.x + 0.5, p.y + 0.5, '#fde047', 14, 5); }
      else if (e === 'land') burst(p.x + 0.5, p.y, g.level.theme.line, 4, 2);
      else if (e === 'die') onDeath();
    }
    if (p.dead) {
      g.deathTimer -= dt;
      if (g.deathTimer <= 0) respawn();
    }

    // HUD time
    if (started && !g.finished) $('#hud-time').textContent = fmtTime(now - g.startAt);
    else if (!started) $('#hud-time').textContent = '0.00';

    // network
    if (g.mode === 'race' && now - g.lastSend > 66 && started && !g.finished) {
      g.lastSend = now;
      Net.send('g:pos', { x: +p.x.toFixed(2), y: +p.y.toFixed(2), r: Math.round(p.rot), d: p.dead, p: +(p.x / g.level.end).toFixed(4), a: g.attempts });
      renderTrack();
    }
    if (g.mode !== 'race' && Math.floor(now / 100) !== Math.floor((now - dt * 1000) / 100)) renderTrack();

    // ghosts drift forward between updates
    for (const gh of ghosts.values()) {
      if (!gh.d && !gh.done) gh.tx += SPEED * dt;
      gh.x += (gh.tx - gh.x) * Math.min(1, dt * 12);
      gh.y += (gh.ty - gh.y) * Math.min(1, dt * 14);
      if (Math.abs(gh.tx - gh.x) > 6) gh.x = gh.tx;
    }

    // trail + particles
    if (!p.dead && started && !p.done && Math.random() < 0.9) g.trail.push({ x: p.x + 0.15, y: p.y + 0.15 + Math.random() * 0.2, life: 0.35 });
    for (const t of g.trail) t.life -= dt;
    g.trail = g.trail.filter((t) => t.life > 0);
    for (const q of g.particles) { q.vy -= 30 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
    g.particles = g.particles.filter((q) => q.life > 0);
    g.shake = Math.max(0, g.shake - dt * 2.5);
    g.flash = Math.max(0, g.flash - dt * 2);

    // camera
    const viewW = W / (H / 10);
    const targetX = p.x - viewW * 0.3;
    g.camX = p.dead ? g.camX : (g.camX < targetX - 20 ? targetX : g.camX + (targetX - g.camX) * Math.min(1, dt * 10));
    const targetY = Math.max(0, p.y - 4.5);
    g.camY += (targetY - g.camY) * Math.min(1, dt * 5);

    draw(now);
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random());
      game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2, life: 0.4 + Math.random() * 0.4, color, size: 0.12 + Math.random() * 0.15 });
    }
  }

  function onDeath() {
    const g = game;
    Sfx.play('boom');
    burst(g.player.x + 0.5, g.player.y + 0.5, (PA.Profile.get().color), 26, 9);
    burst(g.player.x + 0.5, g.player.y + 0.5, '#ffffff', 10, 6);
    g.shake = 1;
    g.deathTimer = 0.75;
  }

  function onFinish(now) {
    const g = game;
    g.finished = true;
    g.finishMs = Math.round(now - g.startAt);
    $('#hud-time').textContent = fmtTime(g.finishMs);
    Music.stop();
    Sfx.play('win');
    UI.confetti(160);
    burst(g.player.x + 0.5, g.player.y + 0.5, '#facc15', 40, 10);
    if (g.mode === 'race') {
      Net.send('g:finish', { time: g.finishMs, attempts: g.attempts });
      showBanner(h('span', { class: 'big' }, 'FINISHED!'), `${fmtTime(g.finishMs)} · ${g.attempts} attempt${g.attempts === 1 ? '' : 's'}`);
    } else {
      setTimeout(() => soloResults(g), 900);
    }
  }

  // ------------------------------------------------------------------ draw
  function draw(now) {
    const g = game;
    const th = g.level.theme;
    const S = H / 10;           // pixels per block
    const groundPx = H - 1.8 * S;
    const shakeX = g.shake ? (Math.random() - 0.5) * 10 * g.shake : 0;
    const shakeY = g.shake ? (Math.random() - 0.5) * 10 * g.shake : 0;
    const sx = (x) => (x - g.camX) * S + shakeX;
    const sy = (y) => groundPx - (y - g.camY) * S + shakeY;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // sky
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, th.top);
    grad.addColorStop(1, th.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // parallax squares
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#ffffff';
    const par = g.camX * S * 0.15;
    for (let i = 0; i < 14; i++) {
      const size = (1.5 + (i * 37 % 5)) * S * 0.6;
      const x = ((i * 211 - par) % (W + 400) + W + 400) % (W + 400) - 200;
      const y = (i * 97 % 60) / 100 * H;
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();

    // grid
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const startCol = Math.floor(g.camX * 0.5);
    for (let c = startCol; c < startCol + W / S * 2 + 2; c += 2) {
      const x = (c - g.camX * 0.5) * S;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, groundPx); ctx.stroke();
    }
    ctx.restore();

    const viewL = Math.floor(g.camX) - 2;
    const viewR = Math.ceil(g.camX + W / S) + 2;

    // checkpoints
    if (g.checkpoints) {
      ctx.fillStyle = 'rgba(163,230,53,0.55)';
      for (let i = 1; i < g.level.checkpoints.length; i++) {
        const cx = g.level.checkpoints[i];
        if (cx < viewL || cx > viewR) continue;
        const x = sx(cx + 0.2);
        ctx.beginPath(); ctx.moveTo(x, sy(0)); ctx.lineTo(x, sy(1.2)); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(163,230,53,0.7)'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, sy(1.2)); ctx.lineTo(x + S * 0.45, sy(1.05)); ctx.lineTo(x, sy(0.9)); ctx.fill();
      }
    }

    // finish line
    const fx = sx(g.level.end);
    if (fx < W + 40) {
      const cell = S * 0.4;
      for (let r = 0; r < 26; r++) {
        for (let c = 0; c < 2; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#ffffff' : '#111111';
          ctx.fillRect(fx + c * cell, groundPx - (r + 1) * cell, cell, cell);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(fx + cell * 2, 0, W, groundPx);
    }

    // objects
    const t = now / 1000;
    for (let c = viewL; c <= viewR; c++) {
      const col = g.level.cols[c];
      if (!col) continue;
      for (const o of col) drawObj(o, sx(o.x), sy(o.y + 1), S, th, t, g.player.used.has(o));
    }

    // ground
    const gy = sy(0);
    const gg = ctx.createLinearGradient(0, gy, 0, H);
    gg.addColorStop(0, th.ground);
    gg.addColorStop(1, '#000000');
    ctx.fillStyle = gg;
    ctx.fillRect(0, gy, W, H - gy);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let c = Math.floor(g.camX); c < g.camX + W / S + 1; c++) {
      if (c % 3) continue;
      ctx.beginPath(); ctx.moveTo(sx(c), gy); ctx.lineTo(sx(c), H); ctx.stroke();
    }
    ctx.shadowColor = th.line; ctx.shadowBlur = 14;
    ctx.fillStyle = th.line;
    ctx.fillRect(0, gy - 1.5, W, 3);
    ctx.shadowBlur = 0;

    // "Attempt N" text
    if (g.attempts > 1 || g.mode === 'solo') {
      ctx.save();
      ctx.font = `700 ${Math.round(S * 0.9)}px Fredoka, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'left';
      ctx.fillText(`Attempt ${g.attempts}`, sx(g.attemptX + 2), sy(4.2));
      ctx.restore();
    }

    // ghosts
    for (const gh of ghosts.values()) {
      if (gh.x < viewL - 2 || gh.x > viewR + 2) continue;
      drawCube(sx(gh.x), sy(gh.y + 1), S, gh.color, gh.avatar, gh.rot, gh.d ? 0.15 : 0.45);
      ctx.save();
      ctx.font = `600 ${Math.round(S * 0.36)}px Fredoka, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(gh.name, sx(gh.x + 0.5), sy(gh.y + 1.35));
      ctx.restore();
    }

    // trail
    const me = PA.Profile.get();
    for (const tr of g.trail) {
      ctx.globalAlpha = tr.life / 0.35 * 0.5;
      ctx.fillStyle = me.color;
      const s = S * 0.3 * (tr.life / 0.35);
      ctx.fillRect(sx(tr.x) - s / 2, sy(tr.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // player
    const p = g.player;
    if (!p.dead) drawCube(sx(p.x), sy(p.y + 1), S, me.color, me.avatar, p.rot, 1, true);

    // particles
    for (const q of g.particles) {
      ctx.globalAlpha = Math.min(1, q.life * 2);
      ctx.fillStyle = q.color;
      const s = q.size * S;
      ctx.fillRect(sx(q.x) - s / 2, sy(q.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    if (g.flash) { ctx.fillStyle = `rgba(255,255,255,${g.flash * 0.25})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawObj(o, x, y, S, th, t, used) {
    if (o.t === '#') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y, S, S);
      ctx.strokeStyle = th.line;
      ctx.lineWidth = Math.max(1.5, S * 0.06);
      ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + S * 0.25, y + S * 0.25, S * 0.5, S * 0.5);
    } else if (o.t === '^' || o.t === 'v') {
      const up = o.t === '^';
      ctx.beginPath();
      if (up) { ctx.moveTo(x + S * 0.08, y + S); ctx.lineTo(x + S / 2, y + S * 0.08); ctx.lineTo(x + S * 0.92, y + S); }
      else { ctx.moveTo(x + S * 0.08, y); ctx.lineTo(x + S / 2, y + S * 0.92); ctx.lineTo(x + S * 0.92, y); }
      ctx.closePath();
      ctx.fillStyle = '#0a0612';
      ctx.fill();
      ctx.shadowColor = th.line; ctx.shadowBlur = 10;
      ctx.strokeStyle = th.line; ctx.lineWidth = Math.max(1.5, S * 0.06);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (o.t === '=') {
      ctx.fillStyle = used ? 'rgba(250,204,21,0.4)' : '#facc15';
      ctx.shadowColor = '#facc15'; ctx.shadowBlur = used ? 0 : 16;
      ctx.beginPath();
      ctx.ellipse(x + S / 2, y + S, S * 0.42, S * 0.22, 0, Math.PI, 0);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (o.t === 'o') {
      const pulse = 1 + Math.sin(t * 6 + o.x) * 0.08;
      ctx.save();
      ctx.globalAlpha = used ? 0.3 : 1;
      ctx.shadowColor = '#fde047'; ctx.shadowBlur = 20;
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = S * 0.12;
      ctx.beginPath(); ctx.arc(x + S / 2, y + S / 2, S * 0.32 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(253,224,71,0.35)';
      ctx.beginPath(); ctx.arc(x + S / 2, y + S / 2, S * 0.18 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawCube(x, y, S, color, emoji, rot, alpha, glow) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + S / 2, y + S / 2);
    ctx.rotate((rot * Math.PI) / 180);
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 24; }
    ctx.fillStyle = color;
    ctx.fillRect(-S / 2, -S / 2, S, S);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, S * 0.08);
    ctx.strokeRect(-S / 2 + 1, -S / 2 + 1, S - 2, S - 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, S * 0.05);
    ctx.strokeRect(-S / 2 + S * 0.16, -S / 2 + S * 0.16, S * 0.68, S * 0.68);
    ctx.font = `${Math.round(S * 0.62)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, S * 0.04);
    ctx.restore();
  }

  // ------------------------------------------------------------------ HUD
  function showBanner(...kids) {
    const b = $('#banner');
    fill(b, ...kids.map((k) => (typeof k === 'string' ? h('div', {}, k) : k)));
    b.classList.remove('hidden');
    const FX = PA.FX;
    if (FX && FX.on) {
      FX.gsap.fromTo(b, { xPercent: -50, x: 0, y: -40, scale: 0.4, rotation: -6, autoAlpha: 0 },
        { xPercent: -50, x: 0, y: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 0.8, ease: 'elastic.out(1, 0.55)', clearProps: 'transform' });
      const big = b.querySelector('.big');
      if (big) FX.gsap.fromTo(big, { letterSpacing: '0.5em' }, { letterSpacing: '0em', duration: 0.7, ease: 'power3.out', clearProps: 'letterSpacing' });
    }
  }
  function hideBanner() { $('#banner').classList.add('hidden'); }

  function renderTrack() {
    const track = $('#track');
    const g = game;
    if (!g) return;
    const myP = clamp(g.player.x / g.level.end, 0, 1);
    $('#track-fill').style.width = (myP * 100).toFixed(1) + '%';
    const runners = [{ id: Net.id, p: myP, ...PA.Profile.get(), me: true }];
    for (const [id, gh] of ghosts) runners.push({ id, p: gh.p || 0, name: gh.name, avatar: gh.avatar, color: gh.color });
    const existing = new Map([...track.querySelectorAll('.runner')].map((el) => [el.dataset.id, el]));
    for (const r of runners) {
      let el = existing.get(r.id);
      if (!el) {
        el = h('div', { class: 'runner' + (r.me ? ' me' : ''), 'data-id': r.id, title: r.name }, UI.avatar(r, 'sm'));
        track.append(el);
      }
      existing.delete(r.id);
      el.style.left = `calc(14px + (100% - 44px) * ${r.p.toFixed(4)})`;
    }
    existing.forEach((el) => el.remove());
  }

  // ====================================================================
  // Screens
  // ====================================================================
  const screens = ['entry', 'solo', 'room', 'play'];
  function showScreen(name) {
    for (const s of screens) $('#' + s).classList.toggle('hidden', s !== name);
    if (name !== 'play') { stopSession(); }
    if (name === 'solo' && PA.FX && PA.FX.list) PA.FX.list($('#solo').children, { y: 30, stagger: 0.08, duration: 0.55, ease: 'back.out(1.5)' });
    window.scrollTo({ top: 0 });
  }

  // input
  const isJumpKey = (e) => e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';
  addEventListener('keydown', (e) => {
    if (!game || !isJumpKey(e)) return;
    if (e.target.tagName === 'INPUT') return;
    e.preventDefault();
    if (!hold && !e.repeat && game) game.player.buffer = BUFFER;
    hold = true;
  });
  addEventListener('keyup', (e) => { if (isJumpKey(e)) hold = false; });
  stage.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!hold && game) game.player.buffer = BUFFER; hold = true; Sfx.ac(); });
  addEventListener('pointerup', () => { hold = false; });
  addEventListener('pointercancel', () => { hold = false; });
  addEventListener('blur', () => { hold = false; });

  $('#btn-music').addEventListener('click', () => { const on = Music.toggle(); $('#btn-music').style.opacity = on ? 1 : 0.4; if (on && game && game.finished) Music.stop(); });
  $('#btn-music').style.opacity = Music.enabled ? 1 : 0.4;
  $('#btn-quit').addEventListener('click', () => {
    if (game && game.mode === 'race') { showScreen('room'); renderRoomMain(); }
    else showScreen('solo');
  });

  // ====================================================================
  // Solo practice
  // ====================================================================
  const DIFFS = [['easy', '🟢 Easy'], ['normal', '🟣 Normal'], ['hard', '🟠 Hard'], ['insane', '💀 Insane']];
  const LENS = [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']];
  const solo = store.get('dash_solo', { difficulty: 'normal', length: 'short', checkpoints: true });

  function seg(el, options, value, onPick, disabled = false) {
    fill(el, ...options.map(([v, label]) => h('button', {
      class: v === value ? 'on' : '', type: 'button', disabled,
      onclick: () => { onPick(v); Sfx.play('click'); },
    }, label)));
  }
  function renderSolo() {
    seg($('#solo-diff'), DIFFS, solo.difficulty, (v) => { solo.difficulty = v; store.set('dash_solo', solo); renderSolo(); });
    seg($('#solo-len'), LENS, solo.length, (v) => { solo.length = v; store.set('dash_solo', solo); renderSolo(); });
    $('#solo-cp').checked = solo.checkpoints;
    const best = store.get('dash_best', {});
    fill($('#solo-best'), ...DIFFS.flatMap(([d, dl]) => LENS.map(([l, ll]) => {
      const b = best[`${d}-${l}`];
      return b ? h('div', { class: 'best-row' }, h('span', {}, `${dl} · ${ll}`), h('b', { class: 'mono' }, `${fmtTime(b.time)} · ${b.attempts}💀`)) : null;
    })).filter(Boolean));
    if (!$('#solo-best').children.length) $('#solo-best').append(h('p', { class: 'muted small' }, 'No runs yet. Go set some records! 🏁'));
  }
  $('#solo-cp').addEventListener('change', (e) => { solo.checkpoints = e.target.checked; store.set('dash_solo', solo); });
  $('#solo-back').addEventListener('click', () => { showScreen('entry'); history.replaceState(null, '', location.pathname); });
  function playSolo(seed) {
    startSession({ mode: 'solo', seed: seed || Math.floor(Math.random() * 2 ** 31), difficulty: solo.difficulty, length: solo.length, checkpoints: solo.checkpoints, countdown: 0 });
  }
  $('#solo-go').addEventListener('click', () => playSolo());
  function soloResults(g) {
    if (game !== g) return;
    const key = `${g.difficulty}-${g.length}`;
    const best = store.get('dash_best', {});
    const prev = best[key];
    const isBest = !prev || g.finishMs < prev.time;
    if (isBest) { best[key] = { time: g.finishMs, attempts: g.attempts }; store.set('dash_best', best); }
    const close = UI.modal(h('div', { style: { textAlign: 'center' } },
      h('div', { style: { fontSize: '3rem' } }, isBest ? '🏆' : '🏁'),
      h('h2', {}, isBest ? 'New personal best!' : 'Level complete!'),
      h('div', { class: 'result-big gradient-text' }, fmtTime(g.finishMs)),
      h('p', { class: 'muted' }, `${g.attempts} attempt${g.attempts === 1 ? '' : 's'}` + (prev && !isBest ? ` · best ${fmtTime(prev.time)}` : '')),
      h('div', { class: 'col', style: { marginTop: '18px' } },
        h('button', { class: 'btn btn-pink btn-lg', onclick: () => { close(); playSolo(); } }, '🎲 New level'),
        h('button', { class: 'btn btn-cyan', onclick: () => { close(); playSolo(g.seed); } }, '🔁 Retry this level'),
        h('button', { class: 'btn btn-ghost', onclick: () => { close(); showScreen('solo'); renderSolo(); } }, '⚙️ Settings')),
    ), { dismissable: false });
  }

  // ====================================================================
  // Online room
  // ====================================================================
  const state = { phase: 'lobby', settings: { difficulty: 'normal', length: 'medium', checkpoints: true }, race: null, results: null, wins: {} };

  function medal(i) { return ['🥇', '🥈', '🥉'][i] || `${i + 1}.`; }

  function renderRoomMain() {
    const el = $('#room-main');
    const host = Room.isHost;
    const s = state.settings;
    const send = (patch) => Net.send('g:settings', { ...s, ...patch });
    const kids = [];

    if (state.results && state.phase !== 'racing') {
      kids.push(h('div', { class: 'results-box' },
        h('div', { class: 'panel-title' }, '🏁 Race results'),
        h('table', { class: 'table' }, h('tbody', {}, state.results.map((r, i) => h('tr', {},
          h('td', {}, r.done ? medal(i) : '💤'),
          h('td', {}, h('div', { class: 'row' }, UI.avatar(r, 'sm'), h('b', {}, r.name))),
          h('td', { class: 'mono' }, r.done ? fmtTime(r.time) : `${Math.round(r.p * 100)}%`),
          h('td', { class: 'muted small' }, `${r.attempts}💀`)))))));
    }

    if (state.phase === 'racing') {
      kids.push(h('div', { class: 'spectate' },
        h('div', { style: { fontSize: '3rem' } }, '🏎️'),
        h('h2', {}, 'Race in progress!'),
        h('p', { class: 'muted' }, 'You’ll be in the next race. Chat with the others while you wait.'),
        h('div', { class: 'track', style: { marginTop: '16px' }, id: 'spec-track' }, h('span', { class: 'flag' }, '🏁')),
        host ? h('button', { class: 'btn btn-ghost btn-sm', style: { marginTop: '16px' }, onclick: () => Net.send('g:stop') }, '⏹ End race now') : null));
      fill(el, ...kids);
      renderSpecTrack();
      return;
    }

    kids.push(
      h('div', { class: 'panel-title' }, '⚙️ Race settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'settings-grid' },
        h('div', {}, h('div', { class: 'setting-label' }, 'Difficulty'), (() => { const d = h('div', { class: 'seg' }); seg(d, DIFFS, s.difficulty, (v) => send({ difficulty: v }), !host); return d; })()),
        h('div', {}, h('div', { class: 'setting-label' }, 'Length'), (() => { const d = h('div', { class: 'seg' }); seg(d, LENS, s.length, (v) => send({ length: v }), !host); return d; })()),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s.checkpoints, disabled: !host, onchange: (e) => send({ checkpoints: e.target.checked }) }), 'Checkpoints'),
      ),
      h('div', { class: 'start-area' },
        host
          ? h('button', { class: 'btn btn-pink btn-lg', onclick: () => Net.send('g:start') }, state.results ? '🔁 Race again!' : '🏁 Start race!')
          : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host to start')),
        h('p', { class: 'tiny faint', style: { textAlign: 'center' } }, 'Everyone races the same random level. Crash = respawn. First to the 🏁 wins!'),
      ),
    );
    fill(el, ...kids);
  }

  function renderSpecTrack() {
    const t = $('#spec-track');
    if (!t || !state.race) return;
    t.querySelectorAll('.runner').forEach((x) => x.remove());
    for (const [id, run] of Object.entries(state.race.runners || {})) {
      const p = Room.player(id) || { name: '?', avatar: '❓', color: '#888' };
      t.append(h('div', { class: 'runner', style: { left: `calc(14px + (100% - 44px) * ${(run.p || 0).toFixed(3)})` }, title: p.name }, UI.avatar(p, 'sm')));
    }
  }

  function startRace(race, countdown) {
    state.phase = 'racing';
    state.race = race;
    const mine = race.runners && race.runners[Net.id];
    if (!mine) { showScreen('room'); renderRoomMain(); return; }
    startSession({ mode: 'race', seed: race.seed, difficulty: race.settings.difficulty, length: race.settings.length, checkpoints: race.settings.checkpoints, countdown: Math.max(0, countdown) });
    for (const id of Object.keys(race.runners)) {
      if (id === Net.id) continue;
      const p = Room.player(id) || { name: '?', avatar: '❓', color: '#888888' };
      ghosts.set(id, { x: 0, y: 0, tx: 0, ty: 0, rot: 0, d: false, done: false, p: 0, name: p.name, avatar: p.avatar, color: p.color });
    }
    renderTrack();
  }

  Lobby.init({
    game: 'dash',
    title: 'Neon Dash',
    emoji: '🟪',
    tagline: 'Jump over spikes, hit the pads, and race your friends to the finish line!',
    solo: { label: '🎮 Play solo (practice)', onClick: () => { showScreen('solo'); renderSolo(); } },
    howTo: '<b>How to play</b><ul><li>Press <b>Space</b>, <b>↑</b>, click or tap to jump. Hold to bunny-hop.</li><li>🟨 Yellow pads launch you up. 🟡 Yellow rings: tap while touching them to jump again in mid-air.</li><li>Online: everyone gets the same level. Crash and you respawn — first to the finish wins!</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'), { extra: (p) => (state.wins[p.id] ? h('span', { title: 'Wins' }, `🏆${state.wins[p.id]}`) : null) });
  Lobby.ChatBox($('#room-chat'));

  Lobby.on('joined', (m) => {
    Object.assign(state, m.state);
    if (state.phase === 'racing' && state.race && state.race.runners[Net.id] && !state.race.runners[Net.id].done) {
      startRace(state.race, Math.max(0, -state.race.elapsed));
    } else {
      showScreen('room');
      renderRoomMain();
    }
  });
  Lobby.on('players', () => { if (!$('#room').classList.contains('hidden')) renderRoomMain(); for (const [id, gh] of ghosts) { const p = Room.player(id); if (p) Object.assign(gh, { name: p.name, avatar: p.avatar, color: p.color }); } });
  Lobby.on('left', () => stopSession());
  Lobby.on('entry', () => { for (const s of ['solo', 'room', 'play']) $('#' + s).classList.add('hidden'); stopSession(); });

  Net.on('g:settings', (m) => { state.settings = m.settings; if (!game) renderRoomMain(); });
  Net.on('g:start', (m) => { state.results = null; startRace(m.race, m.countdown); });
  Net.on('g:pos', (m) => {
    if (game && game.mode === 'race') {
      let gh = ghosts.get(m.id);
      if (!gh) {
        const p = Room.player(m.id) || { name: '?', avatar: '❓', color: '#888888' };
        gh = { x: m.x, y: m.y, name: p.name, avatar: p.avatar, color: p.color };
        ghosts.set(m.id, gh);
      }
      if (m.d && !gh.d) gh.deadAt = performance.now();
      Object.assign(gh, { tx: m.x, ty: m.y, rot: m.r, d: m.d, p: m.p });
    }
    if (state.race && state.race.runners && state.race.runners[m.id]) { state.race.runners[m.id].p = m.p; renderSpecTrack(); }
  });
  Net.on('g:finish', (m) => {
    const p = Room.player(m.id) || { name: '?', avatar: '❓', color: '#888' };
    const gh = ghosts.get(m.id);
    if (gh) { gh.done = true; gh.p = 1; }
    if (state.race && state.race.runners[m.id]) Object.assign(state.race.runners[m.id], { done: true, p: 1, place: m.place });
    if (game && game.mode === 'race') {
      $('#standings').append(h('span', { class: 'chip' }, UI.avatar(p, 'sm'), `${medal(m.place - 1)} ${p.name} · ${fmtTime(m.time)}`));
      if (m.id === Net.id) showBanner(h('span', { class: 'big' }, m.place === 1 ? '🏆 1ST PLACE!' : `#${m.place}`), `${fmtTime(m.time)} · ${m.attempts} attempt${m.attempts === 1 ? '' : 's'}`, h('div', { class: 'small muted' }, 'Waiting for the others…'));
      else UI.toast(`${p.avatar} ${p.name} finished #${m.place}!`, '', 1800);
      renderTrack();
    }
    renderSpecTrack();
  });
  Net.on('g:hurry', (m) => {
    if (game && game.mode === 'race' && !game.finished) UI.toast(`⏰ Someone finished! ${m.seconds}s left to cross the line!`, 'bad', 3500);
  });
  Net.on('g:results', (m) => {
    state.phase = 'results';
    state.results = m.results;
    state.wins = m.wins || {};
    const wasRacing = game && game.mode === 'race';
    setTimeout(() => {
      if (game && game.mode === 'race' && !game.finished) UI.toast('⏱ Time’s up!', 'bad');
      if (wasRacing || !game) { showScreen('room'); renderRoomMain(); Lobby.refreshPlayers(); }
      if (m.results[0] && m.results[0].id === Net.id && m.results[0].done) UI.confetti(200);
    }, wasRacing && game && game.finished ? 1800 : 300);
  });

  if (new URLSearchParams(location.search).get('solo')) {
    $('#entry').classList.add('hidden');
    showScreen('solo');
    renderSolo();
  }
})();
