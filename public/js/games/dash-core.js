/* Neon Dash core: levels and physics. No drawing here, so the same code runs the game, the
   level editor, the admin's replay preview and the tests outside the browser.
   Physics units are blocks, y points up, the floor is at y = 0. */
(function (root) {
  'use strict';
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
  //   o  yellow orb (tap/hold in the air)        =  yellow jump pad
  //   p  pink orb (small jump)   r  red orb (huge jump)   _  pink pad (small launch)
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
      ['..p...', '......', '^^^^^^'],
      ['......', '....##', '_...##'],
    ],
    3: [
      ['#^^^'], ['..#', '.##', '###'], ['##..##..##', '##^^##^^##'],
      ['...#####', '........', '=.^^^^^^'],
      ['^^...^^^'],
      ['..o...o..', '.........', '^^^^^^^^^'],
      ['#^^^#'],
      ['..........', '..........', '...r......', '.......###', '^^^^^^^###'],
      ['......p..p..p...', '................', '....^^^^^^^^^^^^'],
    ],
    4: [
      ['^^^.^^^'], ['#^^^#^^^#'],
      ['...##..', '..###..', '.####..', '#####^^'],
      ['..o...o...o..', '.............', '^^^^^^^^^^^^^'],
      ['##.....##', '##^^^^^##'],
      ['=..^^^^#^^^'],
      ['.........', '.........', '..r......', '......###', '......###', '^^^^^^###'],
      ['..o...p...r....', '...............', '^^^^^^^^^^^^^^^'],
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


  // ---- game modes -----------------------------------------------------------
  // Portals switch your mode. Ship, UFO, Ball and Wave only happen inside closed
  // tunnels (floor + ceiling) and the physics clamps you inside them, so nobody can
  // fly out of the level. The normal cube parts have a hard ceiling too (WORLD_TOP).
  const MODE_DIMS = { cube: [0.97, 0.97], ship: [0.97, 0.7], ufo: [0.97, 0.8], ball: [0.9, 0.9], wave: [0.6, 0.6] };
  const SHIP_LIFT = 40;   // holding pushes you up this hard...
  const SHIP_GRAV = 32;   // ...and letting go drops you a bit softer, so the ship feels light
  const SHIP_MAX = 7.5;   // fastest climb
  const SHIP_FALL = 6.5;  // fastest drop
  const UFO_GRAV = 52;
  const UFO_FLAP = 12.5;
  const UFO_FALL = 13;
  const BALL_GRAV = 68;
  const BALL_FALL = 17;
  const WAVE_V = SPEED;   // exactly 45 degrees, so the wave can ride along the slopes
  const WAVE_HIT = 0.2;   // half the size of the wave's (small, like GD) hitbox
  const WORLD_TOP = 14;
  const ORB_POWER = { o: ORB_V, p: 14.5, r: 25 };   // yellow, pink (small), red (huge)
  const PINK_PAD_V = 21;

  // Tunnel sections, written as building steps (the tunnel is `ceil` blocks tall):
  //   F x w h  pillar from the floor      C x w h  pillar from the ceiling
  //   W x w y gap  wall with a hole from y to y+gap
  //   S x w  spikes on the floor          T x w  spikes hanging from the ceiling
  //   ^ x y / v x y  one spike            O x y t  orb (b = blue: flips gravity)
  /** A GD-style wave corridor: the floor and roof are zigzag slopes `gap` blocks apart that follow
      `path` ([x, y] = the middle of the corridor). It opens up at both ends so you can fly in and out.
      Gives [x, floorY, roofY] points; slopes are never steeper than 45 degrees (the wave's angle). */
  function corridor(w, gap, path) {
    return [[0, 0, 7], ...path.map(([x, y]) => [x, y - gap / 2, y + gap / 2]), [w, 0, 7]];
  }

  const SECTIONS = [
    { mode: 'ship', tier: 1, w: 44, ceil: 7, ops: [['S', 4, 3], ['F', 9, 2, 4], ['S', 13, 3], ['C', 18, 2, 3], ['F', 27, 2, 4], ['S', 31, 3], ['C', 36, 2, 3]] },
    { mode: 'ship', tier: 2, w: 50, ceil: 7, ops: [['S', 3, 4], ['F', 9, 2, 4], ['^', 9, 4], ['^', 10, 4], ['C', 19, 2, 4], ['F', 29, 2, 4], ['S', 33, 4], ['C', 39, 2, 3], ['F', 46, 2, 3]] },
    { mode: 'ship', tier: 3, w: 54, ceil: 7, ops: [['S', 2, 16], ['C', 6, 3, 4], ['F', 18, 3, 4], ['T', 17, 5], ['S', 22, 12], ['C', 30, 3, 4], ['F', 42, 3, 4], ['T', 41, 5], ['S', 46, 6]] },
    { mode: 'ufo', tier: 1, w: 40, ceil: 7, ops: [['S', 4, 4], ['W', 9, 2, 3, 3], ['S', 12, 5], ['W', 18, 2, 1, 3], ['S', 21, 5], ['W', 27, 2, 3, 3], ['S', 30, 6]] },
    { mode: 'ufo', tier: 2, w: 44, ceil: 7, ops: [['S', 3, 41], ['W', 8, 2, 2, 3], ['W', 15, 2, 4, 2.5], ['W', 22, 2, 1, 2.5], ['W', 29, 2, 3, 2.5], ['W', 36, 2, 2, 2.5]] },
    { mode: 'ufo', tier: 3, w: 46, ceil: 7, ops: [['S', 2, 44], ['T', 2, 44], ['W', 8, 1, 3, 2.5], ['W', 14, 1, 1, 2.5], ['W', 20, 1, 4, 2.2], ['W', 26, 1, 2, 2.2], ['O', 31, 3, 'b'], ['W', 35, 1, 2, 2.4], ['W', 41, 1, 3, 2.4]] },
    { mode: 'ball', tier: 1, w: 42, ceil: 7, ops: [['S', 9, 6], ['T', 22, 6], ['S', 34, 5]] },
    { mode: 'ball', tier: 2, w: 44, ceil: 7, ops: [['S', 7, 5], ['T', 16, 5], ['S', 25, 4], ['T', 33, 4], ['F', 40, 1, 2]] },
    // harder ball parts: a lower tunnel, fast spike switches, then pillars with spikes on the
    // other side, so you have to flip at just the right moment to slip past each one
    { mode: 'ball', tier: 3, w: 51, ceil: 6, ops: [['S', 4, 2], ['T', 8, 2], ['S', 12, 2], ['T', 16, 2],
      ['F', 25, 2, 2], ['T', 24, 3], ['C', 34, 2, 2], ['S', 33, 3], ['F', 43, 2, 2], ['T', 42, 3]] },
    { mode: 'ball', tier: 4, w: 59, ceil: 6, ops: [['S', 4, 2], ['T', 8, 2], ['S', 12, 2], ['T', 16, 2],
      ['F', 25, 2, 3], ['T', 24, 3], ['C', 34, 2, 3], ['S', 33, 3], ['F', 43, 2, 3], ['T', 42, 3], ['C', 52, 2, 3], ['S', 51, 3]] },
    { mode: 'wave', tier: 2, w: 36, ceil: 7, ops: [], slopes: corridor(36, 4.4, [[6, 2.3], [8.4, 4.7], [10.8, 2.3], [13.8, 2.3], [16.2, 4.7], [19.2, 4.7], [21.6, 2.3], [24.6, 2.3], [26.1, 3.8], [27.6, 2.3]]) },
    { mode: 'wave', tier: 3, w: 34, ceil: 7, ops: [], slopes: corridor(34, 4.2, [[5, 2.2], [7.6, 4.8], [9.6, 2.8], [11.6, 4.8], [14.2, 2.2], [16.2, 4.2], [18.2, 2.2], [20.8, 4.8], [22.8, 2.8], [24.8, 4.8], [27.4, 2.2]]) },
  ];
  const SECTION_POOL = {
    easy: { chance: 0.12, modes: { ship: [1], ufo: [1] } },
    normal: { chance: 0.16, modes: { ship: [1, 2], ufo: [1, 2], ball: [1] } },
    hard: { chance: 0.2, modes: { ship: [2, 3], ufo: [2], ball: [2, 3], wave: [2] } },
    insane: { chance: 0.24, modes: { ship: [2, 3], ufo: [2, 3], ball: [3, 4], wave: [2, 3] } },
  };

  /** Turn a tunnel's building steps into objects (y = 0 is the floor). Heights can be
      fractional for holes (W): blocks fill every row the hole doesn't cover. */
  function sectionCells(sec) {
    const cells = [];
    const put = (t, x, y) => { if (x >= 0 && x < sec.w && y >= 0 && y < sec.ceil) cells.push([t, x, y]); };
    for (const [op, a, b, c, d] of sec.ops) {
      if (op === 'F') for (let x = a; x < a + b; x++) for (let y = 0; y < c; y++) put('#', x, y);
      else if (op === 'C') for (let x = a; x < a + b; x++) for (let y = sec.ceil - c; y < sec.ceil; y++) put('#', x, y);
      else if (op === 'W') for (let x = a; x < a + b; x++) for (let y = 0; y < sec.ceil; y++) { if (y + 1 <= c || y >= c + d) put('#', x, y); }
      else if (op === 'S') for (let x = a; x < a + b; x++) put('^', x, 0);
      else if (op === 'T') for (let x = a; x < a + b; x++) put('v', x, sec.ceil - 1);
      else if (op === '^' || op === 'v') put(op, a, b);
      else if (op === 'O') put(c, a, b);
    }
    // a block wins over a spike in the same cell
    const solid = new Set(cells.filter((q) => q[0] === '#').map((q) => q[1] + ',' + q[2]));
    return cells.filter((q) => q[0] === '#' || !solid.has(q[1] + ',' + q[2]));
  }

  function placeSection(lv, sec, x0) {
    for (const [t, x, y] of sectionCells(sec)) addObj(lv, t, x0 + x, y);
    const placed = { x0, x1: x0 + sec.w, mode: sec.mode, ceil: sec.ceil, tier: sec.tier };
    if (sec.slopes) {
      placed.floor = sec.slopes.map(([x, f]) => [x0 + x, f]);
      placed.roof = sec.slopes.map(([x, , r]) => [x0 + x, r]);
    }
    lv.sections.push(placed);
    return sec.w;
  }

  /** Height of a slope line (a list of [x, y] points) at x. */
  function lineAt(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      if (x <= x1) { const [x0, y0] = pts[i - 1]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
    }
    return pts[pts.length - 1][1];
  }
  // highest floor / lowest roof anywhere between x = a and x = b
  const lineMax = (pts, a, b) => pts.reduce((m, [x, y]) => (x > a && x < b ? Math.max(m, y) : m), Math.max(lineAt(pts, a), lineAt(pts, b)));
  const lineMin = (pts, a, b) => pts.reduce((m, [x, y]) => (x > a && x < b ? Math.min(m, y) : m), Math.min(lineAt(pts, a), lineAt(pts, b)));

  function sectionAt(lv, x) {
    for (const s of lv.sections) if (x >= s.x0 && x < s.x1) return s;
    return null;
  }


  function buildLevel(seed, difficulty = 'normal', length = 'medium', modes = true) {
    const rng = mulberry32(seed);
    const lv = { objs: [], cols: {}, checkpoints: [0], end: 0, chunks: [], sections: [], theme: THEMES[difficulty] || THEMES.normal };
    const mix = TIER_MIX[difficulty] || TIER_MIX.normal;
    const [gMin, gMax] = GAPS[difficulty] || GAPS.normal;
    const target = LENGTH[length] || LENGTH.medium;
    const pool = SECTION_POOL[difficulty] || SECTION_POOL.normal;
    let x = 12;
    let last = null;
    let lastSection = 0;
    while (x < target) {
      // sometimes a portal into a Ship / UFO / Ball / Wave tunnel
      if (modes && x > 40 && x - lastSection > 70 && x < target - 30 && rng() < pool.chance) {
        const kinds = Object.keys(pool.modes);
        const kind = kinds[Math.floor(rng() * kinds.length)];
        const tiers = pool.modes[kind];
        const tier = tiers[Math.floor(rng() * tiers.length)];
        const options = SECTIONS.filter((q) => q.mode === kind && q.tier === tier);
        const sec = options[Math.floor(rng() * options.length)];
        x += placeSection(lv, sec, x);
        lastSection = x;
        lv.checkpoints.push(x + 0.3);
        x += gMin + Math.floor(rng() * (gMax - gMin + 1)) + 5;   // room to fall back to the floor
        continue;
      }
      let roll = rng();
      let tier = mix[0][0];
      for (const [t, w] of mix) { if ((roll -= w) <= 0) { tier = t; break; } }
      const chunks = CHUNKS[tier];
      let chunk = chunks[Math.floor(rng() * chunks.length)];
      if (chunk === last) chunk = chunks[Math.floor(rng() * chunks.length)];
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
    const pad = chunk.some((row) => /[=_]/.test(row)) ? 2 : 0;
    const orb = chunk.some((row) => /[opr]/.test(row)) ? 3 : 0;            // rings leave you high in the air
    const spikeEnd = chunk[rows - 1][w - 1] === '^' ? 1 : 0;              // landing right after spikes is tight
    return Math.max(0, top - 1) * 2 + Math.max(pad, orb) + spikeEnd;
  }


  function newPlayer(x = 0) {
    return { x, y: 0, vy: 0, rot: 0, grounded: true, dead: false, done: false, used: new Set(), air: 0, buffer: 0, jumped: false, mode: 'cube', g: 1 };
  }

  const hits = (pl, ax0, ay0, ax1, ay1) => pl.x + 0.78 > ax0 && pl.x + 0.22 < ax1 && pl.y + 0.82 > ay0 && pl.y + 0.18 < ay1;

  /** Advance one physics substep. `ev` collects sound/fx events. */
  function step(pl, lv, hold, dt, ev) {
    if (pl.dead || pl.done) return;
    const sec = lv.sections && lv.sections.length ? sectionAt(lv, pl.x + 0.5) : null;
    const mode = sec ? sec.mode : 'cube';
    if (mode !== pl.mode) enterMode(pl, mode, sec, ev);
    if (mode === 'cube') stepCube(pl, lv, hold, dt, ev);
    else stepFlyer(pl, lv, hold, dt, ev, sec);
    if (pl.x >= lv.end) { pl.done = true; pl.x = lv.end; }
  }

  function enterMode(pl, mode, sec, ev) {
    pl.mode = mode;
    pl.g = 1;
    const h = MODE_DIMS[mode][1];
    if (sec && pl.y + h > sec.ceil) pl.y = sec.ceil - h;   // never start inside or above a tunnel's ceiling
    if (mode === 'cube') { pl.grounded = false; pl.jumped = true; pl.air = 1; }
    else { pl.vy = Math.max(-6, Math.min(6, pl.vy)); if (mode !== 'ball') pl.rot = 0; }
    ev && ev.push('portal');
  }

  /** Ship, UFO, Ball and Wave. The tunnel's floor and ceiling are walls you slide along. */
  function stepFlyer(pl, lv, hold, dt, ev, sec) {
    const mode = pl.mode;
    const [w, h] = MODE_DIMS[mode];
    const top = sec ? sec.ceil : WORLD_TOP;
    const c0 = Math.floor(pl.x) - 1;
    const c1 = Math.floor(pl.x) + 2;
    // blue orbs: tap while touching one to flip gravity (UFO and Ball)
    if (pl.buffer > 0 && (mode === 'ufo' || mode === 'ball')) {
      for (let c = c0; c <= c1 && pl.buffer > 0; c++) {
        for (const o of lv.cols[c] || []) {
          if (o.t !== 'b' || pl.used.has(o)) continue;
          const dx = pl.x - o.x;
          const dy = pl.y - o.y;
          if (dx * dx + dy * dy < ORB_R * ORB_R) { pl.g = -pl.g; pl.vy = 0; pl.used.add(o); pl.buffer = 0; ev && ev.push('orb'); break; }
        }
      }
    }
    const prevY = pl.y;
    pl.x += SPEED * dt;
    if (mode === 'ship') {
      pl.vy = Math.max(-SHIP_FALL, Math.min(SHIP_MAX, pl.vy + (hold ? SHIP_LIFT : -SHIP_GRAV) * dt));
    } else if (mode === 'ufo') {
      if (pl.buffer > 0) { pl.vy = UFO_FLAP * pl.g; pl.buffer = 0; ev && ev.push('jump'); }
      pl.vy -= UFO_GRAV * pl.g * dt;
      pl.vy = pl.g > 0 ? Math.max(pl.vy, -UFO_FALL) : Math.min(pl.vy, UFO_FALL);
    } else if (mode === 'ball') {
      pl.vy -= BALL_GRAV * pl.g * dt;
      pl.vy = pl.g > 0 ? Math.max(pl.vy, -BALL_FALL) : Math.min(pl.vy, BALL_FALL);
    } else {
      pl.vy = (hold ? 1 : -1) * WAVE_V;
    }
    pl.y += pl.vy * dt;
    const wasGrounded = pl.grounded;
    pl.grounded = false;
    if (pl.y <= 0) { pl.y = 0; if (pl.vy < 0) pl.vy = 0; if (pl.g > 0) pl.grounded = true; }
    if (pl.y + h >= top) { pl.y = top - h; if (pl.vy > 0) pl.vy = 0; if (pl.g < 0) pl.grounded = true; }
    // wave slopes: touching the zigzag floor or roof is a crash
    if (sec && sec.floor) {
      const cx = pl.x + w / 2;
      const cy = pl.y + h / 2;
      const lo = lineMax(sec.floor, cx - WAVE_HIT, cx + WAVE_HIT);
      const hi = lineMin(sec.roof, cx - WAVE_HIT, cx + WAVE_HIT);
      if (cy - WAVE_HIT < lo || cy + WAVE_HIT > hi) {
        if (pl.god) pl.y = Math.max(lo + WAVE_HIT, Math.min(hi - WAVE_HIT, cy)) - h / 2;
        else { pl.dead = true; ev && ev.push('die'); return; }
      }
    }

    for (let c = c0; c <= c1; c++) {
      for (const o of lv.cols[c] || []) {
        if (o.t !== '#') continue;
        if (pl.x + w - 0.03 <= o.x || pl.x + 0.03 >= o.x + 1 || pl.y + h - 0.02 <= o.y || pl.y + 0.02 >= o.y + 1) continue;
        if (mode !== 'wave' && pl.vy <= 0 && prevY >= o.y + 1 - 0.05) { pl.y = o.y + 1; pl.vy = 0; if (pl.g > 0) pl.grounded = true; }
        else if (mode !== 'wave' && pl.vy >= 0 && prevY + h <= o.y + 0.05) { pl.y = o.y - h; pl.vy = 0; if (pl.g < 0) pl.grounded = true; }
        else if (pl.god) { pl.y = Math.min(top - h, o.y + 1); pl.vy = 0; }
        else { pl.dead = true; ev && ev.push('die'); return; }
      }
    }
    const hx0 = pl.x + w * 0.15;
    const hx1 = pl.x + w * 0.85;
    const hy0 = pl.y + h * 0.15;
    const hy1 = pl.y + h * 0.85;
    for (let c = c0; c <= c1 && !pl.god; c++) {
      for (const o of lv.cols[c] || []) {
        const up = o.t === '^';
        if (!up && o.t !== 'v') continue;
        const y0 = up ? o.y : o.y + 0.45;
        const y1 = up ? o.y + 0.55 : o.y + 1;
        if (hx1 > o.x + 0.32 && hx0 < o.x + 0.68 && hy1 > y0 && hy0 < y1) { pl.dead = true; ev && ev.push('die'); return; }
      }
    }
    if (pl.grounded) pl.air = 0; else pl.air += dt;
    if (mode === 'ball' && pl.buffer > 0 && (pl.grounded || pl.air < COYOTE)) {
      pl.g = -pl.g;
      pl.vy = -pl.g * 2;
      pl.buffer = 0;
      pl.grounded = false;
      pl.air = COYOTE;
      ev && ev.push('jump');
    }
    pl.buffer = Math.max(0, pl.buffer - dt);
    // ship and UFO tilt smoothly toward where they're heading instead of snapping
    if (mode === 'ship') pl.rot += (-Math.atan2(pl.vy, SPEED * 1.4) * 180 / Math.PI - pl.rot) * Math.min(1, dt * 12);
    else if (mode === 'wave') pl.rot = pl.vy > 0 ? -42 : 42;
    else if (mode === 'ufo') pl.rot += (Math.max(-18, Math.min(18, -pl.vy * 1.5)) - pl.rot) * Math.min(1, dt * 14);
    else pl.rot += 620 * dt * pl.g;
    if (pl.grounded && !wasGrounded && mode !== 'ship' && mode !== 'wave') ev && ev.push('land');
  }

  /** The normal cube. */
  function stepCube(pl, lv, hold, dt, ev) {
    const prevY = pl.y;
    pl.x += SPEED * dt;
    pl.vy = Math.max(pl.vy - GRAV * dt, -MAX_FALL);
    pl.y += pl.vy * dt;
    const wasGrounded = pl.grounded;
    pl.grounded = false;
    if (pl.y <= 0) { pl.y = 0; if (pl.vy < 0) pl.vy = 0; pl.grounded = true; }
    if (pl.y + 0.97 > WORLD_TOP) { pl.y = WORLD_TOP - 0.97; if (pl.vy > 0) pl.vy = 0; }

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
        } else if (pl.god) {
          pl.y = top; pl.vy = 0; pl.grounded = true;   // admin god mode: climb over walls
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
          if (!pl.god && hits(pl, o.x + 0.32, o.y, o.x + 0.68, o.y + 0.55)) { pl.dead = true; ev && ev.push('die'); return; }
        } else if (o.t === 'v') {
          if (!pl.god && hits(pl, o.x + 0.32, o.y + 0.45, o.x + 0.68, o.y + 1)) { pl.dead = true; ev && ev.push('die'); return; }
        } else if (o.t === '=' || o.t === '_') {
          if (!pl.used.has(o) && pl.x + 0.97 > o.x + 0.1 && pl.x + 0.03 < o.x + 0.9 && pl.y < o.y + 0.3 && pl.y + 0.97 > o.y) {
            pl.vy = o.t === '=' ? PAD_V : PINK_PAD_V; pl.grounded = false; pl.used.add(o); ev && ev.push('pad');
          }
        } else if (o.t === 'o' || o.t === 'p' || o.t === 'r') {
          if ((hold || pl.buffer > 0) && !pl.grounded && !pl.used.has(o)) {
            const dx = pl.x - o.x;
            const dy = pl.y - o.y;
            if (dx * dx + dy * dy < ORB_R * ORB_R) { pl.vy = ORB_POWER[o.t]; pl.used.add(o); pl.buffer = 0; ev && ev.push('orb'); }
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
  }

  // ====================================================================
  // Custom levels (the level editor and community levels)
  // ====================================================================
  // A level as the editor saves it (and the server stores it):
  //   { v: 1, name, desc, theme, music, len, objs: [[t, x, y], ...], zones: [[mode, x, w, ceil, gap?, path?], ...] }
  //   t      a chunk letter from above, or b (blue orb: flips gravity in UFO / Ball zones)
  //   len    the finish line (columns)             theme  one of THEMES      music  true / false
  //   zones  Ship / UFO / Ball / Wave tunnels: from column x, w blocks long, `ceil` blocks tall.
  //          A wave zone can have a zigzag corridor like the game's wave parts: `path` is a list of
  //          [x, y] points (the middle of the corridor, x counted from the zone's start), `gap` its height.
  const LIMITS = { len: [30, 800], rows: 14, objs: 5000, zones: 40, zoneW: [6, 200], ceil: [3, 14], gap: [2.5, 8], path: 40, name: 32, desc: 140 };
  const OBJ_TYPES = ['#', '^', 'v', 'o', 'p', 'r', 'b', '=', '_'];
  const ZONE_MODES = ['ship', 'ufo', 'ball', 'wave'];

  /** A wave zone's floor and roof as [x, floorY, roofY] points (x from the zone's start). */
  function zoneSlopes(w, ceil, gap, path) {
    return [[0, 0, ceil], ...path.map(([x, y]) => [x, y - gap / 2, y + gap / 2]), [w, 0, ceil]];
  }

  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

  /** Check a level the same way the server does. Returns a clean copy, or throws an Error saying what's wrong. */
  function checkLevel(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('That isn’t a Neon Dash level.');
    const name = String(d.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > LIMITS.name) throw new Error(`Give your level a name (up to ${LIMITS.name} characters).`);
    const desc = String(d.desc ?? '').replace(/\s+/g, ' ').trim();
    if (desc.length > LIMITS.desc) throw new Error(`The description can be up to ${LIMITS.desc} characters.`);
    if (!THEMES[d.theme]) throw new Error('Unknown colour theme.');
    if (!isInt(d.len, LIMITS.len[0], LIMITS.len[1])) throw new Error(`Levels are ${LIMITS.len[0]}–${LIMITS.len[1]} blocks long.`);
    if (!Array.isArray(d.objs) || d.objs.length > LIMITS.objs) throw new Error(`Levels can have up to ${LIMITS.objs} objects.`);
    if (!Array.isArray(d.zones || []) || (d.zones || []).length > LIMITS.zones) throw new Error(`Levels can have up to ${LIMITS.zones} mode zones.`);
    const seen = new Set();
    const objs = d.objs.map((o) => {
      if (!Array.isArray(o) || o.length !== 3 || !OBJ_TYPES.includes(o[0]) || !isInt(o[1], 0, d.len - 1) || !isInt(o[2], 0, LIMITS.rows - 1)) throw new Error('The level has a broken object.');
      const k = o[1] + ',' + o[2];
      if (seen.has(k)) throw new Error('Two objects are in the same spot.');
      seen.add(k);
      return [o[0], o[1], o[2]];
    });
    let end = 0;
    const zones = [...(d.zones || [])].sort((a, b) => (Array.isArray(a) && Array.isArray(b) ? a[1] - b[1] : 0)).map((z) => {
      if (!Array.isArray(z) || !ZONE_MODES.includes(z[0]) || !isInt(z[1], 1, d.len) || !isInt(z[2], LIMITS.zoneW[0], LIMITS.zoneW[1])
        || !isInt(z[3], LIMITS.ceil[0], LIMITS.ceil[1]) || z[1] + z[2] > d.len) throw new Error('The level has a broken mode zone.');
      if (z[1] < end) throw new Error('Two mode zones overlap.');
      end = z[1] + z[2];
      const out = [z[0], z[1], z[2], z[3]];
      if (z[0] === 'wave' && z.length > 4) {
        const [, , w, ceil, gap, path] = z;
        if (!isNum(gap, LIMITS.gap[0], LIMITS.gap[1]) || gap > ceil || !Array.isArray(path) || path.length > LIMITS.path) throw new Error('A wave zigzag is broken.');
        let lastX = 0;
        for (const p of path) {
          if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0], lastX + 0.01, w - 0.01) || !isNum(p[1], gap / 2, ceil - gap / 2)) throw new Error('A wave zigzag is broken.');
          lastX = p[0];
        }
        if (path.length) out.push(gap, path.map((p) => [p[0], p[1]]));
      } else if (z.length > 4) throw new Error('Only wave zones can have a zigzag.');
      return out;
    });
    return { v: 1, name, desc, theme: d.theme, music: d.music !== false, len: d.len, objs, zones };
  }

  /** Turn an editor level into the same level object buildLevel() makes, so the game plays and draws it as usual. */
  function compileLevel(d) {
    const lv = { objs: [], cols: {}, checkpoints: [0], end: d.len, chunks: [], sections: [], theme: THEMES[d.theme] || THEMES.normal, custom: true };
    for (const [mode, x0, w, ceil, gap, path] of [...(d.zones || [])].sort((a, b) => a[1] - b[1])) {
      const sec = { x0, x1: x0 + w, mode, ceil, tier: 0 };
      if (mode === 'wave' && path && path.length) {
        const pts = zoneSlopes(w, ceil, gap, path);
        sec.floor = pts.map(([x, f]) => [x0 + x, f]);
        sec.roof = pts.map(([x, , r]) => [x0 + x, r]);
      }
      lv.sections.push(sec);
    }
    for (const [t, x, y] of [...d.objs].sort((a, b) => a[1] - b[1] || b[2] - a[2])) {
      const sec = sectionAt(lv, x);
      if (sec && y >= sec.ceil) continue;   // hidden inside a tunnel's roof (the game's sections drop these too)
      addObj(lv, t, x, y);
    }
    lv.checkpoints = autoCheckpoints(lv);
    return lv;
  }

  /** Practice flags for a custom level: on open floor, away from tunnels, every 24+ blocks. */
  function autoCheckpoints(lv) {
    const cps = [0];
    let last = 0;
    for (let x = 8; x < lv.end - 8; x++) {
      if (x - last < 24) continue;
      let clear = !lv.sections.some((s) => x >= s.x0 - 2 && x < s.x1 + 5);   // you leave a tunnel in the air
      for (let c = x - 1; c <= x + 3 && clear; c++) {
        for (const o of lv.cols[c] || []) if (o.y <= 3) clear = false;
      }
      if (clear) { cps.push(x + 0.3); last = x; }
    }
    return cps;
  }

  /** Where you stand at column x: on top of any blocks there (for "playtest from here"). */
  function standY(lv, x) {
    const c = Math.floor(x);
    const solid = (cx, y) => (lv.cols[cx] || []).some((o) => o.t === '#' && o.y === y);
    let y = 0;
    while (y < WORLD_TOP - 1 && (solid(c, y) || solid(c + 1, y))) y++;
    return y;
  }

  // ---- fixed-step runs --------------------------------------------------------
  // Custom levels always run in whole substeps, and the button only changes between them, so a
  // recorded list of inputs plays out exactly the same every time (verify runs, the admin's replay
  // preview, the tests). Inputs are substep numbers where the button goes down, up, down, up...
  // (a tap shorter than one substep is a down and an up on the same number).
  function newRun(lv, x = 0) {
    const p = newPlayer(x);
    if (x) p.y = standY(lv, x);
    return { p, tick: 0, hold: false, rec: [] };
  }
  function runInput(run, down) {
    if (down === run.hold) return;
    run.rec.push(run.tick);
    run.hold = down;
    if (down) run.p.buffer = BUFFER;
  }
  function runStep(run, lv, ev) {
    step(run.p, lv, run.hold, SUB, ev);
    run.tick++;
  }
  /** How many substeps a full run of this level takes (everyone moves at the same speed in every mode). */
  function runTicks(lv) {
    const p = { x: 0 };
    let n = 0;
    while (p.x < lv.end) { p.x += SPEED * SUB; n++; }
    return n;
  }
  /** Play a recorded run without drawing anything: { done, dead, ticks, progress }. */
  function replay(lv, events, maxTicks) {
    const run = newRun(lv);
    const limit = maxTicks || runTicks(lv) + 10;
    let i = 0;
    while (run.tick < limit && !run.p.dead && !run.p.done) {
      while (i < events.length && events[i] <= run.tick) { runInput(run, i % 2 === 0); i++; }
      runStep(run, lv, null);
    }
    return { done: run.p.done, dead: run.p.dead, ticks: run.tick, x: run.p.x, progress: Math.min(1, run.p.x / lv.end) };
  }

  /** A random level from buildLevel() in the editor's format ("start from a random level", and the tests). */
  function levelFromBuilt(lv, meta = {}) {
    const r2 = (v) => Math.round(v * 100) / 100;
    const zones = lv.sections.map((s) => {
      const z = [s.mode, s.x0, s.x1 - s.x0, s.ceil];
      if (s.floor) {
        const gap = r2(s.roof[1][1] - s.floor[1][1]);
        z.push(gap, s.floor.slice(1, -1).map(([x, f], i) => [r2(x - s.x0), r2((f + s.roof[i + 1][1]) / 2)]));
      }
      return z;
    });
    const theme = Object.keys(THEMES).find((k) => THEMES[k] === lv.theme) || 'normal';
    return { v: 1, name: meta.name || 'Random level', desc: meta.desc || '', theme, music: true, len: Math.min(LIMITS.len[1], Math.ceil(lv.end)),
      objs: lv.objs.map((o) => [o.t, o.x, o.y]), zones };
  }

  /** Share codes: "ND1." + the level as base64 JSON. */
  function encodeLevel(d) {
    const bytes = new TextEncoder().encode(JSON.stringify(d));
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return 'ND1.' + btoa(s).replace(/=+$/, '');
  }
  function decodeLevel(code) {
    const m = String(code || '').trim().match(/^ND1\.([A-Za-z0-9+/]+)$/);
    if (!m) throw new Error('That isn’t a level code. They start with ND1.');
    let d;
    try { d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0)))); } catch { throw new Error('That level code is broken. Copy the whole thing.'); }
    return checkLevel(d);
  }

  root.DashCore = {
    buildLevel, newPlayer, step, CHUNKS, SECTIONS, SPEED, SUB, BUFFER, MODE_DIMS, THEMES, WORLD_TOP, placeChunk, placeSection, sectionCells, exitRunway,
    sectionAt, LIMITS, OBJ_TYPES, ZONE_MODES, zoneSlopes, checkLevel, compileLevel, autoCheckpoints, standY,
    newRun, runInput, runStep, runTicks, replay, encodeLevel, decodeLevel, levelFromBuilt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
