/* Motocross core: tracks, the ground, bike physics, tricks and a robot rider. Nothing is drawn here,
   so the same code also runs in the tests (tests/mototest.js), where the robot rides every track.

   You ride anywhere in 3D: the bike has a position on the ground (px, pz) and a heading, and you steer
   it with real bike geometry (how far the bars turn depends on your speed) and tyre grip (too fast and
   you slide wide; a berm holds you in). Up and down it's a full suspension model in the bike's own
   upright plane, which turns with the bike: each step the ground is sampled along the way the bike
   points (slice()), and in that plane x is metres travelled and y is the height.
   The frame hangs on two wheels through a fork and a shock: each wheel is its own little body, held
   on its suspension axis by a stiff spring and pushed out along it by the suspension spring and
   damper. Tyres grip the ground with a slip-based friction, the engine turns the rear wheel through a
   5-speed gearbox (its torque also lifts the front: wheelies), the brakes push the nose down, and the
   rider (a body on springy legs) leans: on the ground that moves their weight, in the air it spins the
   bike. With no lean held in the air, the rider levels the bike for the landing by themselves.

   A track is a list of pieces (tracks.json), e.g. "double 8 2.0 12" = a takeoff 8 m long with its
   lip 2 m high, then a 12 m gap to the top of the landing. build() turns them into ground samples
   every 25 cm along the middle of the track, plus where the checkpoints, the finish line and the
   mud/ice patches are. heightAt() turns that into ground everywhere: the riding surface (banked in the
   corners), the sides of the jumps, and the hills around (the 3D world draws exactly this ground). */
(function (root) {
  'use strict';
  const DT = 1 / 120;        // one game step (seconds)
  const SUB = 8;             // physics substeps per game step
  const DX = 0.25;           // ground sample spacing (metres)
  const X0 = -30;            // the ground starts this far behind the course
  const TAU = Math.PI * 2;

  const P = {
    G: 10.5,                 // gravity (a touch above real, so jumps don't feel floaty)
    M: 104, I: 17,           // the bike's frame: mass (kg) and how hard it is to spin (the wheels and the rider come on top)
    MR: 70,                  // the rider: a body on springy legs and arms, so bumps aren't passed straight into the bike
    // where the rider's hips sit on the bike (frame coordinates) when neutral, leaning back and leaning forward;
    // leg/arm springs (along the bike, up the bike), their damping, and how far the body can move before it hits the bike
    RIDER: { rest: [-0.12, 0.46], back: [-0.42, 0.38], fwd: [0.18, 0.42], k: [20000, 12000], c: [1600, 1400], room: 0.24 },
    MW: 11,                  // each wheel (with the brake, hub and half the fork/swingarm)
    R: [0.35, 0.34],         // wheel radius: front 21", rear 19" with knobbly tyres
    IW: [0.85, 0.95],        // wheel spin inertia
    // suspension: the axle at full extension (frame coordinates, metres from the centre of mass),
    // the direction it compresses (up the fork / shock), travel, spring, preload, damping in/out
    SUS: [
      { p: [0.84, -0.32], u: [-0.454, 0.891], travel: 0.30, k: 7200, pre: 0.035, cb: 650, rb: 1300 },
      { p: [-0.69, -0.35], u: [0.12, 0.993], travel: 0.31, k: 8800, pre: 0.035, cb: 750, rb: 1500 },
    ],
    KP: 140000, CP: 1100,    // how stiffly the wheel is held sideways on its axis
    KT: 90000, CT: 700,      // tyre stiffness and damping
    MU: 1.2, SLIP: 0.6,      // tyre grip (times the ground's) and the slip speed that uses all of it
    // parts of the bike that can hit the ground: [x, y, radius] in frame coordinates (skid plate, front
    // fender, rear fender, seat, handlebars), and of the rider, from the hips: [along, up, radius] (hips, chest, head)
    BODY: [[0.02, -0.27, 0.08], [0.98, 0.10, 0.08], [-1.02, 0.28, 0.08], [-0.32, 0.36, 0.1], [0.44, 0.62, 0.07]],
    BODY_R: [[0, 0, 0.15], [0.16, 0.40, 0.17], [0.24, 0.64, 0.15]],
    KB: 70000, CB: 1500, MUB: 0.55,
    GEARS: [33, 26, 21.5, 18.8, 17],       // engine turns per rear-wheel turn in each gear
    IDLE: 1700, LAUNCH: 7800, UP: 11500, DOWN: 6000, LIMIT: 12300,
    TQ: 28,                  // peak engine torque (N·m)
    SHIFT: 0.09,             // seconds without drive while changing gear
    NITRO_TQ: 1.6, NITRO_LIMIT: 13600, NITRO_USE: 0.34,
    BRAKE: [900, 430],       // front, rear brake torque (N·m)
    LEAN_AIR: 1500, LEAN_GROUND: 300, SPIN_MAX: 8.5,
    DRAG: 0.4, ROLL: 0.012,  // air drag, tyre rolling resistance on hard dirt (tracks add more: sand, mud)
    BERM: 1.5,               // how much a corner's berm helps you round it (the robot's corner speed = √(grip·g·radius·BERM))
    WHEELBASE: 1.48, STEER: 0.55, STEER_FALL: 0.08,   // steering lock at walking pace, and how it narrows with speed
    MU_SIDE: 1.35, BERM_GRIP: 0.6,                     // sideways grip (times the ground's), and how much more a berm gives
    AIR_TWIST: 0.8,          // how fast you can twist the bike's direction in the air (rad/s)
    ASSIST: 0.5,             // how strongly the rider levels the bike in the air when you don't lean
    PADDLE: 650, BACK_MAX: 2.4,                        // paddling backwards when stopped with the brake held
    TW: 4.4,                 // half the riding width (the tape is just outside it)
    FENCE: 11.5,             // how far from the middle of the track you can go before the barrier stops you
    CRASH_TIME: 1.3,         // seconds of tumbling before you go back to the checkpoint
    HOLD_TIME: 1.0,          // ...and how long you wait there (together: the crash penalty)
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ------------------------------------------------------------------ tracks
  const SURFACE = { dirt: 0, mud: 1, ice: 2, rough: 3 };   // rough = off the track

  /** Turn a track's pieces into ground samples. Throws on a piece it doesn't know. */
  function build(def) {
    const ys = [0]; const gr = [1]; const kd = [0]; const hd = [0]; const rr = [0]; const vm = [0];
    const rand = rng(hash(def.id || def.name || 'track'));
    const baseGrip = def.grip || 1;
    const baseRoll = def.roll || 0;
    let y = 0; let heading = 0;
    let x = X0;
    const cps = []; const features = [];
    let start = null; let finish = null;
    // add a piece L metres long: f(t 0..1, metres in) gives the height; o: grip, kind, roll, turn, vmax
    const add = (L, f, o = {}) => {
      const n = Math.max(1, Math.round(L / DX));
      const h0 = heading; const turn = o.turn || 0;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        ys.push(f(t, i * DX)); gr.push(o.grip || 1); kd.push(o.kind || 0); hd.push(h0 + turn * t);
        rr.push(baseRoll + (o.roll || 0)); vm.push(o.vmax || 0);
      }
      heading = h0 + turn;
      x += n * DX;
    };
    const flat = (L, o) => { const y0 = y; add(L, () => y0, o); };
    const feature = (kind, x0, o = {}) => { const f = { kind, x0, x1: x, ...o }; features.push(f); return f; };
    const rise = (t) => (1 - Math.cos(Math.PI * t / 2));            // a takeoff: flat, then steeper and steeper
    const ease = (t) => (1 - Math.cos(Math.PI * t)) / 2;             // smooth from 0 to 1
    flat(-X0);
    for (const raw of def.course) {
      const parts = String(raw).trim().split(/\s+/);
      const k = parts[0]; const a = parts.slice(1).map(Number);
      if (a.some((v) => !Number.isFinite(v))) throw new Error(`bad numbers in "${raw}"`);
      const x0 = x; const y0 = y;
      if (k === 'flat') flat(a[0]);
      else if (k === 'start') start = x;
      else if (k === 'finish') finish = x;
      else if (k === 'cp') cps.push(x);
      else if (k === 'bumps') {
        const [L, H] = a; const l1 = 1.4 + rand() * 1.2; const l2 = 2.6 + rand() * 1.6; const p1 = rand() * TAU; const p2 = rand() * TAU;
        add(L, (t, d) => y0 + H * Math.min(1, t * 6, (1 - t) * 6) * (0.6 * Math.sin(TAU * d / l1 + p1) + 0.4 * Math.sin(TAU * d / l2 + p2)));
      } else if (k === 'roller') {
        const [L, H] = a; add(L, (t) => y0 + H * (1 - Math.cos(TAU * t)) / 2); feature('roller', x0, { h: H });
      } else if (k === 'rollers' || k === 'whoops') {
        const [L, H, N] = a; add(L, (t) => y0 + H * Math.pow((1 - Math.cos(TAU * N * t)) / 2, k === 'whoops' ? 1.4 : 1)); feature(k, x0, { h: H, n: N });
      } else if (k === 'up' || k === 'down') {
        const [L, H] = a; const s = k === 'up' ? H : -H;
        add(L, (t) => y0 + s * ease(t)); y = y0 + s;
        feature(k, x0, { h: H });
      } else if (k === 'dip') {
        const [L, D] = a; add(L, (t) => y0 - D * (1 - Math.cos(TAU * t)) / 2); feature('dip', x0, { h: D });
      } else if (k === 'kicker') {
        const [L, H] = a;
        add(L, (t) => y0 + H * rise(t));
        const lip = x;
        add(1.2 + 0.5 * H, (t) => y0 + H * (1 - ease(t)));
        feature('kicker', x0, { h: H, lip });
      } else if (k === 'double' || k === 'table') {
        const [L, H, G] = a;
        add(L, (t) => y0 + H * rise(t));
        const lip = x;
        let land = H;
        if (k === 'table') add(G, () => y0 + H);
        else {
          // a pit between the takeoff and the landing (shallow, with a back you can ride up if you come up short)
          land = H * 0.92;
          const down = Math.min(G * 0.25, 1.4 + 0.5 * H); const upL = Math.min(G * 0.35, 1.6 * H + 1);
          const pit = y0 - 0.15;
          add(down, (t) => y0 + H - (y0 + H - pit) * ease(t));
          if (G - down - upL > 0) add(G - down - upL, () => pit);
          add(upL, (t) => pit + (y0 + land - pit) * ease(t));
        }
        const top = x;
        add(L * 1.8, (t) => y0 + land * (1 - ease(t)));
        feature(k, x0, { h: H, lip, top, land: x });
      } else if (k === 'stepup') {
        // a takeoff up to three quarters of the height, a short gap, and you land on top of the step
        const [L, H] = a;
        add(L, (t) => y0 + 0.75 * H * rise(t));
        const lip = x;
        add(1.4, (t) => y0 + 0.75 * H - 0.2 * H * ease(t));
        add(1.2, () => y0 + 0.55 * H);
        add(1.2 + 0.3 * H, (t) => y0 + 0.55 * H + 0.45 * H * ease(t));
        y = y0 + H;
        feature('stepup', x0, { h: H, lip, top: x, land: x + 9 });
      } else if (k === 'drop') {
        const [H] = a; const L = 2 + 1.2 * H;
        add(L, (t) => y0 - H * ease(t)); y = y0 - H;
        feature('drop', x0, { h: H });
      } else if (k === 'turn') {
        // a bermed corner: the track bends (seen from above) and you can't go round it faster than its speed
        const [deg, R] = a; const L = Math.abs(deg) * Math.PI / 180 * R;
        const vmax = Math.sqrt(baseGrip * P.G * R * P.BERM);
        add(L, () => y0, { turn: deg * Math.PI / 180, vmax });
        feature('turn', x0, { deg, r: R, vmax });
      } else if (k === 'mud' || k === 'ice') {
        const [L] = a; const l1 = 0.9 + rand() * 0.5; const p1 = rand() * TAU;
        add(L, (t, d) => y0 + (k === 'mud' ? -0.06 + 0.035 * Math.sin(TAU * d / l1 + p1) : 0) * Math.min(1, t * 8, (1 - t) * 8),
          { grip: k === 'mud' ? 0.62 : 0.5, kind: SURFACE[k], roll: k === 'mud' ? 0.05 : -0.004 });
        feature(k, x0);
      } else throw new Error(`unknown track piece "${raw}"`);
    }
    if (start == null || finish == null) throw new Error('a track needs a "start" and a "finish"');
    // a big dirt wall at the end stops anyone who keeps going
    const y0 = y;
    add(14, (t) => y0 + 7 * ease(t));
    flat(10);
    const n = ys.length;
    const T = {
      id: def.id, name: def.name, theme: def.theme || 'desert', def,
      dx: DX, x0: X0, n, end: X0 + (n - 1) * DX,
      ys: Float32Array.from(ys), gr: Float32Array.from(gr, (g) => g * baseGrip), kd: Uint8Array.from(kd), hd: Float32Array.from(hd),
      rr: Float32Array.from(rr), vm: Float32Array.from(vm), baseGrip, baseRoll,
      start, finish, cps: cps.filter((c) => c > start && c < finish).sort((p, q) => p - q), features,
      robot: def.robot || null,
    };
    // where the track goes when seen from above (corners only change this, and how fast you can go)
    T.px = new Float32Array(n); T.pz = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const hh = (T.hd[i] + T.hd[i - 1]) / 2;
      T.px[i] = T.px[i - 1] + Math.cos(hh) * DX; T.pz[i] = T.pz[i - 1] + Math.sin(hh) * DX;
    }
    // the speed that lands each gap jump in the sweet spot of its landing
    for (const f of features) if (f.top != null) f.speed = launchSpeed(T, f);
    prepareGround(T);
    return T;
  }

  /** The takeoff speed that lands a jump a third of the way down its landing (found by trying). */
  function launchSpeed(T, f) {
    const target = f.top + (f.land - f.top) * 0.3;
    const a = slope(T, f.lip - 0.3);
    const y0 = groundY(T, f.lip) + 0.8;
    let best = null;
    for (let v = 6; v <= 32; v += 0.25) {
      let x = f.lip; let y = y0; let vx = v * Math.cos(a); let vy = v * Math.sin(a);
      for (let i = 0; i < 600; i++) {
        vy -= P.G / 120; x += vx / 120; y += vy / 120;
        if (vy < 0 && y - 0.8 <= groundY(T, x)) break;
      }
      if (x >= target) { best = v; break; }
    }
    return best;
  }

  function index(T, x) { return clamp((x - T.x0) / T.dx, 0, T.n - 1.0001); }
  /** Ground height at x. */
  function groundY(T, x) { const f = index(T, x); const i = f | 0; return lerp(T.ys[i], T.ys[i + 1], f - i); }
  /** Ground slope angle at x (radians, positive going uphill). */
  function slope(T, x) { const i = index(T, x) | 0; return Math.atan2(T.ys[i + 1] - T.ys[i], T.dx); }
  function gripAt(T, x) { return T.gr[Math.round(index(T, x))]; }
  function surfaceAt(T, x) { return T.kd[Math.round(index(T, x))]; }
  function rollAt(T, x) { return T.rr[Math.round(index(T, x))]; }
  /** The fastest you can take the corner you're in (0 = not in a corner). */
  function cornerAt(T, x) { return T.vm[Math.round(index(T, x))]; }
  /** Where x is when seen from above: { x, z, heading } (for drawing). */
  function plan(T, x) {
    const f = index(T, x); const i = f | 0; const t = f - i;
    return { x: lerp(T.px[i], T.px[i + 1], t), z: lerp(T.pz[i], T.pz[i + 1], t), heading: lerp(T.hd[i], T.hd[i + 1], t) };
  }

  // ------------------------------------------------------------------ the ground everywhere
  // A point near the track is (s = metres along the middle of it, u = metres to its right). The riding
  // surface follows the track's profile (tilted into a berm in the corners); further out it blends into
  // natural ground, so jumps get dirt sides, and hills rise away from the track.
  const HILLS = { desert: 18, forest: 30, snow: 40 };
  function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y) {
    const xi = Math.floor(x); const yi = Math.floor(y); const xf = x - xi; const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi); const b = hash2(xi + 1, yi); const c = hash2(xi, yi + 1); const d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 4) { let s = 0; let a = 0.5; let f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); }
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /** Work out the natural ground level (the track's height smoothed a lot) and how hard each bit of it turns. */
  function prepareGround(T) {
    T.S0 = T.x0 - 140; T.S1 = T.end + 180; T.hill = HILLS[T.theme] || 20;
    const nb = Math.ceil(T.S1 - T.S0) + 1;
    const raw = new Float32Array(nb);
    for (let i = 0; i < nb; i++) raw[i] = groundY(T, clamp(T.S0 + i, T.x0, T.end));
    const pre = new Float64Array(nb + 1); for (let i = 0; i < nb; i++) pre[i + 1] = pre[i] + raw[i];
    T.base = new Float32Array(nb); T.berm = new Float32Array(nb);
    const W = 28; const tmp = {};
    for (let i = 0; i < nb; i++) {
      const a = Math.max(0, i - W); const b = Math.min(nb, i + W + 1);
      T.base[i] = Math.min(raw[i], (pre[b] - pre[a]) / (b - a)) - 0.12;
      let k = 0;
      for (let d = -6; d <= 6; d += 2) k += pathAt(T, T.S0 + i + d + 0.5, tmp).h - pathAt(T, T.S0 + i + d - 0.5, tmp).h;
      T.berm[i] = k / 7;   // radians per metre
    }
  }
  const at1m = (T, arr, s) => { const f = clamp(s - T.S0, 0, arr.length - 1.001); const i = f | 0; return arr[i] + (arr[i + 1] - arr[i]) * (f - i); };
  /** The middle of the track seen from above at s: { x, z, h (heading) }, carried on straight past both ends. */
  function pathAt(T, s, out = {}) {
    const e = s < T.x0 ? T.x0 : s > T.end ? T.end : s;
    const f = index(T, e); const i = f | 0; const t = f - i;
    const h = lerp(T.hd[i], T.hd[i + 1], t);
    out.x = lerp(T.px[i], T.px[i + 1], t) + Math.cos(h) * (s - e); out.z = lerp(T.pz[i], T.pz[i + 1], t) + Math.sin(h) * (s - e); out.h = h;
    return out;
  }
  const trackY = (T, s) => groundY(T, clamp(s, T.x0, T.end));
  /** How much the track turns at s (radians per metre, + = right), smoothed over a few metres. */
  function bermAt(T, s) { return at1m(T, T.berm, s); }
  /** How far the ground at lane u is above the middle of the track: corners are banked into berms. */
  function bank(T, s, u) {
    const k = bermAt(T, s); if (!k) return 0;
    const amt = Math.min(1, Math.abs(k) * 22) * 1.5; const uo = -u * Math.sign(k);   // uo: towards the outside of the corner
    if (uo <= 0) return 0;
    const TW = P.TW;
    return amt * smooth(0.5, TW + 1.8, uo) * (1 - smooth(TW + 2.2, TW + 6.5, uo)) + amt * 0.15 * smooth(TW + 2.2, TW + 6.5, uo);
  }
  /** The natural ground away from the track: lumps nearby, hills rising further out. */
  function natural(T, s, u) {
    const au = Math.abs(u);
    const n1 = fbm(s * 0.035, u * 0.035 + 17, 4) - 0.5; const n2 = vnoise(s * 0.4, u * 0.4) - 0.5;
    const rise = Math.pow(Math.max(0, au - 14) / 110, 1.6) * T.hill;
    const lumps = n1 * (0.6 + Math.min(1, au / 60) * T.hill * 0.35);
    return at1m(T, T.base, s) - 0.06 + rise + lumps + n2 * 0.06 * smooth(5, 12, au);
  }
  /** The height of the ground at (s, u). */
  function heightAt(T, s, u) {
    const ty = trackY(T, s);
    const nat = natural(T, s, u);
    const w = 2.2 + 1.5 * Math.abs(ty - nat);
    const t = smooth(P.TW, P.TW + w, Math.abs(u));
    const top = ty - 0.04 * (u / P.TW) * (u / P.TW) + bank(T, s, u);
    return top + (nat - top) * t;
  }
  /** Where a point seen from above is on the track: { s, u, h } (h = the track's heading there).
      hint: a nearby s (the track never comes back close to itself, so the nearest point is found by walking). */
  const loc = { s: 0, u: 0, h: 0 };
  function locate(T, wx, wz, hint, out = loc) {
    let i = clamp(Math.round((hint - T.x0) / T.dx), 0, T.n - 1);
    const d2 = (k) => { const dx = wx - T.px[k]; const dz = wz - T.pz[k]; return dx * dx + dz * dz; };
    let best = d2(i);
    for (const st of [64, 16, 4, 1]) {
      for (let moved = true; moved;) {
        moved = false;
        for (const k of [i - st, i + st]) if (k >= 0 && k < T.n) { const d = d2(k); if (d < best) { best = d; i = k; moved = true; } }
      }
    }
    const k = i >= T.n - 1 ? T.n - 2 : i;
    const h = T.hd[k]; const c = Math.cos(h); const sn = Math.sin(h);
    const along = (wx - T.px[k]) * c + (wz - T.pz[k]) * sn;   // metres past sample k (can run past either end of the track)
    out.s = T.x0 + k * T.dx + (k === 0 || k === T.n - 2 ? along : clamp(along, -T.dx, 2 * T.dx));
    out.u = -(wx - T.px[k]) * sn + (wz - T.pz[k]) * c;
    out.h = h;
    return out;
  }
  /** The ground along the way the bike points, in its own plane (x = its odometer), for this step's physics.
      Off the track it's rough and slow; mud and ice are only on the riding surface. */
  const SLICE_N = 41;
  function slice(T, b) {
    const G = b.G || (b.G = { x0: 0, dx: 0.25, n: SLICE_N, ys: new Float32Array(SLICE_N), gr: new Float32Array(SLICE_N), kd: new Uint8Array(SLICE_N), rr: new Float32Array(SLICE_N), s: new Float32Array(SLICE_N) });
    G.x0 = b.x - (SLICE_N - 1) / 2 * G.dx;
    const c = Math.cos(b.h); const sn = Math.sin(b.h);
    let hint = b.s;
    for (let i = 0; i < SLICE_N; i++) {
      const d = G.x0 + i * G.dx - b.x;
      const L = locate(T, b.px + c * d, b.pz + sn * d, hint);
      hint = L.s;
      G.ys[i] = heightAt(T, L.s, L.u); G.s[i] = L.s;
      if (Math.abs(L.u) < P.TW + 0.8) {
        const j = Math.round(index(T, L.s));
        G.gr[i] = T.gr[j]; G.kd[i] = T.kd[j]; G.rr[i] = T.rr[j];
      } else { G.gr[i] = T.baseGrip * 0.8; G.kd[i] = SURFACE.rough; G.rr[i] = T.baseRoll + 0.16; }
    }
    return G;
  }

  /** The ground point nearest to a circle (cx, cy, r) if it touches: { pen, nx, ny } or null. */
  const hit = { pen: 0, nx: 0, ny: 1 };
  function touch(T, cx, cy, r) {
    const gy = groundY(T, cx);
    if (cy < gy) {   // the centre is under the ground: push straight out along the slope's normal
      const a = slope(T, cx);
      hit.nx = -Math.sin(a); hit.ny = Math.cos(a); hit.pen = r + (gy - cy) * Math.cos(a);
      return hit;
    }
    const i0 = Math.max(0, Math.floor((cx - r - T.x0) / T.dx) - 1);
    const i1 = Math.min(T.n - 2, Math.ceil((cx + r - T.x0) / T.dx) + 1);
    let best = r * r; let found = false;
    for (let i = i0; i <= i1; i++) {
      const ax = T.x0 + i * T.dx; const ay = T.ys[i]; const ey = T.ys[i + 1] - ay;
      let t = ((cx - ax) * T.dx + (cy - ay) * ey) / (T.dx * T.dx + ey * ey);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = cx - (ax + t * T.dx); const dy = cy - (ay + t * ey);
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; found = true; const d = Math.sqrt(d2) || 1e-6; hit.nx = dx / d; hit.ny = dy / d; hit.pen = r - d; }
    }
    return found ? hit : null;
  }

  // ------------------------------------------------------------------ the bike
  /** A bike standing on the track s metres along it, u metres right of the middle (default: the start, in the middle). */
  function newBike(T, s, u = 0) {
    const b = {
      x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0,   // in the bike's upright plane: x = odometer, y = height, a = pitch
      px: 0, pz: 0, h: 0,                     // seen from above: where the bike is and which way it points
      s: 0, u: 0, steer: 0, yaw: 0, scrub: 0, wrong: false, off: false, backT: 0, fenceT: 0,
      rx: 0, ry: 0, rvx: 0, rvy: 0,     // the rider's hips
      wh: [0, 1].map(() => ({ x: 0, y: 0, vx: 0, vy: 0, sp: 0, ang: 0, c: 0, ct: false, nx: 0, ny: 1, load: 0, slip: 0, fx: 0, fy: 0, tq: 0 })),
      gear: 1, rpm: P.IDLE, thr: 0, brk: 0, lean: 0, shift: 0, nitro: 0, boost: false, limiter: false,
      air: 0, airRot: 0, airPeak: 0, ground: 0, landing: null,
      crashed: 0, rider: null, hold: 0, cp: -1, t: 0, finished: null, crashes: 0, flips: 0, maxSpeed: 0,
      scrape: 0, slide: 0, bodyHit: false, lastLand: null,
    };
    place(T, b, s == null ? T.start : s, u);
    return b;
  }

  /** Put the bike upright on the track at (s, u), pointing along it, standing still, and let the suspension settle. */
  function place(T, b, s, u = 0) {
    const p = pathAt(T, s);
    b.h = p.h; b.px = p.x - Math.sin(p.h) * u; b.pz = p.z + Math.cos(p.h) * u; b.s = s; b.u = u;
    const x = s;   // (the odometer starts at s: any number would do)
    b.x = x;
    const G = slice(T, b);
    const a = slope(G, x);
    b.a = a; b.vx = b.vy = b.w = 0;
    b.y = groundY(G, x) + 0.95;
    const ca = Math.cos(a); const sa = Math.sin(a);
    for (let k = 0; k < 2; k++) {
      const s = P.SUS[k]; const w = b.wh[k];
      w.x = b.x + ca * s.p[0] - sa * s.p[1]; w.y = b.y + sa * s.p[0] + ca * s.p[1];
      w.vx = w.vy = w.sp = 0; w.c = 0;
    }
    // lift everything so the lower wheel just touches, then settle
    const lift = Math.max(...[0, 1].map((k) => groundY(G, b.wh[k].x) + P.R[k] - b.wh[k].y));
    b.y += lift; b.wh[0].y += lift; b.wh[1].y += lift;
    const rp = P.RIDER.rest;
    b.rx = b.x + ca * rp[0] - sa * rp[1]; b.ry = b.y + sa * rp[0] + ca * rp[1]; b.rvx = b.rvy = 0;
    b.crashed = 0; b.rider = null; b.air = 0; b.airRot = 0; b.landing = null; b.thr = 0; b.brk = 0; b.lean = 0; b.gear = 1; b.rpm = P.IDLE; b.boost = false;
    b.steer = 0; b.yaw = 0; b.scrub = 0; b.wrong = false; b.backT = 0;
    for (let i = 0; i < 120; i++) step(T, b, { gas: 0, brake: 1, lean: 0, nitro: false, hold: true });
    const dx = x - b.x;
    b.x += dx; b.rx += dx; b.wh[0].x += dx; b.wh[1].x += dx;
    b.h = p.h; b.px = p.x - Math.sin(p.h) * u; b.pz = p.z + Math.cos(p.h) * u; b.s = s; b.u = u;
    b.vx = b.vy = b.w = b.rvx = b.rvy = 0;
    for (const w of b.wh) { w.vx = w.vy = w.sp = 0; }
    b.air = 0; b.airRot = 0; b.landing = null; b.ground = 1;
  }

  function torqueCurve(rpm) {
    if (rpm < 9000) return 0.58 + 0.42 * clamp((rpm - 2000) / 7000, 0, 1);
    return 1 - 0.38 * Math.pow((rpm - 9000) / 3600, 2);
  }

  /** One substep of physics. */
  function substep(T, b, h, drive) {
    const ca = Math.cos(b.a); const sa = Math.sin(b.a);
    let fx = 0; let fy = -P.M * P.G; let tq = 0;
    const speed = Math.hypot(b.vx, b.vy);
    fx -= P.DRAG * speed * b.vx; fy -= P.DRAG * speed * b.vy;
    for (let k = 0; k < 2; k++) {
      const s = P.SUS[k]; const w = b.wh[k]; const r = P.R[k];
      const ax = b.x + ca * s.p[0] - sa * s.p[1]; const ay = b.y + sa * s.p[0] + ca * s.p[1];
      const ux = ca * s.u[0] - sa * s.u[1]; const uy = sa * s.u[0] + ca * s.u[1];
      const nx = -uy; const ny = ux;
      const rx = w.x - ax; const ry = w.y - ay;
      const c = rx * ux + ry * uy; const e = rx * nx + ry * ny;
      const ox = w.x - b.x; const oy = w.y - b.y;
      const rvx = w.vx - (b.vx - b.w * oy); const rvy = w.vy - (b.vy + b.w * ox);
      const cv = rvx * ux + rvy * uy; const ev = rvx * nx + rvy * ny;
      // suspension: pushes the wheel away from the frame along the axis
      let S;
      if (c >= 0) {
        S = s.k * (c + s.pre);
        const soft = s.travel - 0.05;
        if (c > soft) S += 60000 * (c - soft);              // the progressive end of the stroke
        if (c > s.travel) S += 600000 * (c - s.travel);     // bottoming out
      } else S = 300000 * c;                                 // fully extended: held there
      let F = S + cv * (cv > 0 ? s.cb : s.rb);
      if (c > s.travel - 0.05 && cv > 0) F += 5000 * cv;   // bottoming cups: a hard landing is soaked up, not bounced back
      const Fp = -P.KP * e - P.CP * ev;
      let wfx = -F * ux + Fp * nx; let wfy = -F * uy + Fp * ny;
      fx -= wfx; fy -= wfy; tq -= ox * wfy - oy * wfx;
      w.c = c;
      wfy -= P.MW * P.G;
      let spTq = 0;
      // the tyre on the ground
      const g = touch(T, w.x, w.y, r);
      if (g && g.pen > 0) {
        const vn = w.vx * g.nx + w.vy * g.ny;
        const N = Math.max(0, P.KT * g.pen - P.CT * vn);
        const tx = g.ny; const ty = -g.nx;
        const slip = (w.vx * tx + w.vy * ty) - w.sp * r;
        const mu = P.MU * gripAt(T, w.x);
        const x = slip / P.SLIP;
        const Ff = -mu * N * (x > 1 ? 1 : x < -1 ? -1 : x * (1.5 - 0.5 * x * x));
        wfx += N * g.nx + Ff * tx; wfy += N * g.ny + Ff * ty;
        spTq -= r * Ff;
        spTq -= Math.sign(w.sp) * (P.ROLL + rollAt(T, w.x)) * N * r;
        w.ct = true; w.nx = g.nx; w.ny = g.ny; w.load = Math.max(w.load, N); w.slip = Math.max(w.slip, Math.abs(slip));
      }
      // engine (rear) and brakes
      if (k === 1 && drive.tq) { spTq += drive.tq; tq += drive.tq; }
      const bt = drive.brake[k];
      if (bt && w.sp !== 0) {   // (never so hard that it turns the wheel backwards)
        const use = Math.min(bt, Math.abs(w.sp) * P.IW[k] / h);
        spTq -= Math.sign(w.sp) * use; tq -= Math.sign(w.sp) * use;
      }
      w.vx += wfx / P.MW * h; w.vy += wfy / P.MW * h;
      w.sp += spTq / P.IW[k] * h;
      w.x += w.vx * h; w.y += w.vy * h; w.ang += w.sp * h;
    }
    tq += drive.lean;
    fx += drive.push;
    // the rider: hips held over the pegs by springy legs and arms; leaning moves where they want to be
    let rfx = 0; let rfy = -P.MR * P.G;
    if (!b.crashed) {
      const RD = P.RIDER; const L = b.lean;
      const to = L < 0 ? RD.back : RD.fwd; const t = Math.abs(L);
      const lx = lerp(RD.rest[0], to[0], t); const ly = lerp(RD.rest[1], to[1], t);
      const ax = b.x + ca * lx - sa * ly; const ay = b.y + sa * lx + ca * ly;
      const ox = ax - b.x; const oy = ay - b.y;
      const dx = b.rx - ax; const dy = b.ry - ay;
      const vx = b.rvx - (b.vx - b.w * oy); const vy = b.rvy - (b.vy + b.w * ox);
      // along the bike / up the bike
      const da = dx * ca + dy * sa; const du = -dx * sa + dy * ca;
      const va = vx * ca + vy * sa; const vu = -vx * sa + vy * ca;
      let fa = -RD.k[0] * da - RD.c[0] * va; let fu = -RD.k[1] * du - RD.c[1] * vu;
      const d = Math.hypot(da, du);
      if (d > RD.room) { const k = 200000 * (d - RD.room) / d; fa -= k * da; fu -= k * du; }
      const gx = fa * ca - fu * sa; const gy = fa * sa + fu * ca;
      rfx += gx; rfy += gy;
      fx -= gx; fy -= gy; tq -= ox * gy - oy * gx;
      // the rider's body hitting the ground
      const ra = Math.atan2(Math.sin(b.a), Math.cos(b.a));
      const rc = Math.cos(ra); const rs = Math.sin(ra);
      for (const pt of P.BODY_R) {
        const px = b.rx + rc * pt[0] - rs * pt[1]; const py = b.ry + rs * pt[0] + rc * pt[1];
        const g = touch(T, px, py, pt[2]);
        if (!g || g.pen <= 0) continue;
        b.bodyHit = true;
        const vn = b.rvx * g.nx + b.rvy * g.ny;
        const N = Math.max(0, P.KB * g.pen - P.CB * vn);
        rfx += N * g.nx; rfy += N * g.ny;
      }
    }
    // the bike scraping or hitting the ground
    for (let i = 0; i < P.BODY.length; i++) {
      const pt = P.BODY[i];
      const px = b.x + ca * pt[0] - sa * pt[1]; const py = b.y + sa * pt[0] + ca * pt[1];
      const g = touch(T, px, py, pt[2]);
      if (!g || g.pen <= 0) continue;
      b.scrape = 1;
      const ox = px - b.x; const oy = py - b.y;
      const vx = b.vx - b.w * oy; const vy = b.vy + b.w * ox;
      const vn = vx * g.nx + vy * g.ny;
      const N = Math.max(0, P.KB * g.pen - P.CB * vn);
      const tx = g.ny; const ty = -g.nx; const vt = vx * tx + vy * ty;
      const Ff = -P.MUB * N * clamp(vt / 0.5, -1, 1);
      const ffx = N * g.nx + Ff * tx; const ffy = N * g.ny + Ff * ty;
      fx += ffx; fy += ffy; tq += ox * ffy - oy * ffx;
      b.slide = Math.max(b.slide, Math.abs(vt));
    }
    b.vx += fx / P.M * h; b.vy += fy / P.M * h; b.w += tq / P.I * h;
    b.x += b.vx * h; b.y += b.vy * h; b.a += b.w * h;
    if (!b.crashed) {
      b.rvx += rfx / P.MR * h; b.rvy += rfy / P.MR * h;
      b.rx += b.rvx * h; b.ry += b.rvy * h;
    }
  }

  /** One game step (1/120 s). inp = { gas 0..1, brake 0..1, steer -1 (left) .. 1 (right), lean -1 (back) .. 1 (forward),
      nitro, hold (stand at the gate), assist: false (no levelling in the air) }.
      Returns a list of events: ['land', {...}], ['crash'], ['cp', i], ['finish', time], ['shift', gear], ['fence']. */
  function step(T, b, inp) {
    const ev = [];
    const G = slice(T, b);
    const x0 = b.x;
    const out = !!b.crashed;
    const gas = out || b.finished != null ? 0 : clamp(+inp.gas || 0, 0, 1);
    const brake = out ? 0.3 : b.finished != null ? 1 : clamp(+inp.brake || 0, 0, 1);
    const lean = out || b.finished != null ? 0 : clamp(+inp.lean || 0, -1, 1);
    b.thr += clamp(gas - b.thr, -DT * 9, DT * 7);
    b.brk += clamp(brake - b.brk, -DT * 10, DT * 10);
    const onGround = b.wh[0].ct || b.wh[1].ct;
    const leanRate = onGround ? 6 : 12;
    b.lean += clamp(lean - b.lean, -DT * leanRate, DT * leanRate);
    // nitro
    b.boost = !!(inp.nitro && b.nitro > 0 && !out && !inp.hold && b.finished == null);
    if (b.boost) b.nitro = Math.max(0, b.nitro - P.NITRO_USE * DT);
    // engine: rpm from the rear wheel through the gearbox, with a slipping clutch at low speed
    const rear = b.wh[1];
    const ratio = P.GEARS[b.gear - 1];
    const wheelRpm = Math.max(0, rear.sp) * ratio * 60 / TAU;
    const limit = b.boost ? P.NITRO_LIMIT : P.LIMIT;
    let target = wheelRpm;
    let clutch = 1;
    if (inp.hold) { target = P.IDLE + b.thr * (limit - P.IDLE) * 0.85; clutch = 0; }
    else if (b.gear === 1 && wheelRpm < P.LAUNCH) { target = Math.max(wheelRpm, P.IDLE + b.thr * (P.LAUNCH - P.IDLE)); clutch = 0.35 + 0.65 * wheelRpm / P.LAUNCH; }
    else if (!rear.ct && b.thr > 0.1) target = Math.max(wheelRpm, b.rpm);   // in the air the wheel spins up with the engine
    b.rpm += (Math.max(P.IDLE, target) - b.rpm) * Math.min(1, DT * 14);
    b.limiter = b.rpm >= limit - 40 && b.thr > 0.5;
    if (b.shift > 0) b.shift -= DT;
    else if (!inp.hold && rear.ct) {
      if (b.rpm > P.UP && b.gear < P.GEARS.length && b.thr > 0.3) { b.gear++; b.shift = P.SHIFT; ev.push(['shift', b.gear]); }
      else if (b.rpm < P.DOWN && b.gear > 1) { b.gear--; b.shift = P.SHIFT * 0.6; ev.push(['shift', b.gear]); }
    }
    let engine = 0;
    if (b.shift <= 0 && clutch > 0 && b.rpm < limit) {
      engine = P.TQ * torqueCurve(b.rpm) * b.thr * ratio * clutch * (b.boost ? P.NITRO_TQ : 1);
    }
    // in the air the wheel can't spin faster than the engine lets it
    if (!rear.ct && rear.sp * ratio * 60 / TAU > limit) engine = Math.min(engine, 0);
    const spin = b.w;
    const flying = !onGround && b.air > 0.12;   // (a wheel just popping off the ground isn't flying yet)
    let leanTq = -b.lean * (flying ? P.LEAN_AIR : P.LEAN_GROUND);
    let frontBrake = 1;
    if (flying && Math.sign(leanTq) === Math.sign(spin) && Math.abs(spin) > P.SPIN_MAX) leanTq = 0;
    if (flying && Math.sign(leanTq) === -Math.sign(spin)) leanTq *= 1.6;   // stopping a spin is easier than starting one
    if (!flying && !inp.hold) {
      // the rider's instinct on a wheelie: weight forward and ease off before it loops (looking a moment
      // ahead, so a fast pop is caught too). Hold lean-back to keep a wheelie going, up to a point.
      const rel = b.a - slope(G, b.x) + Math.max(0, b.w) * 0.22;
      const wheelie = b.lean < -0.3 ? 0.75 : 0.24;
      if (rel > wheelie) {
        leanTq -= Math.min(1.5, (rel - wheelie) * 4) * P.LEAN_GROUND * 2.2;
        engine *= clamp(1 - (rel - wheelie) * 3, 0, 1);
      }
      // ...and on a stoppie (back wheel lifting under braking): ease off the front brake, weight back
      const stoppie = b.lean > 0.3 ? 0.55 : 0.16;
      if (-rel > stoppie) {
        frontBrake *= clamp(1 - (-rel - stoppie) * 4, 0, 1);
        leanTq += Math.min(1, (-rel - stoppie) * 3) * P.LEAN_GROUND * 1.4;
      }
    }
    // no lean held in the air: the rider levels the bike for the landing
    if (flying && Math.abs(lean) < 0.05 && inp.assist !== false && !out) {
      const L = predictLanding(T, b);
      const err = b.a - L.slope;
      leanTq += -clamp(err * 3 + b.w * 0.9, -1, 1) * P.LEAN_AIR * P.ASSIST;
    }
    // stopped with the brake held: paddle backwards (bikes have no reverse gear)
    const grounded = b.wh[0].ct || b.wh[1].ct;
    b.backT = grounded && !out && !inp.hold && b.finished == null && brake > 0.5 && gas < 0.1 && b.vx < 0.6 ? b.backT + DT : 0;
    const backing = b.backT > 0.35;
    const push = backing && b.vx > -P.BACK_MAX ? -P.PADDLE : 0;
    const drive = { tq: engine, brake: backing ? [0, 0] : [P.BRAKE[0] * b.brk * frontBrake, P.BRAKE[1] * b.brk], lean: leanTq, push };
    const h = DT / SUB;
    for (const w of b.wh) { w.ct = false; w.load = 0; w.slip = 0; }
    b.scrape = 0; b.slide = 0; b.bodyHit = false;
    for (let s = 0; s < SUB; s++) substep(G, b, h, drive);
    if (inp.hold) { b.vx *= 0.5; b.vy = Math.min(b.vy, 0); }
    if (!onGround && !(b.wh[0].ct || b.wh[1].ct) && Math.abs(b.w) > 0.3 && !b.scrape) b.w *= 1 - DT * 0.25;   // a little air resistance on spinning
    if (b.a > Math.PI || b.a < -Math.PI) b.a -= TAU * Math.round(b.a / TAU);   // (flips are counted in airRot)
    // move over the ground the distance the bike went in its plane, then steer
    const moved = b.x - x0;
    b.px += Math.cos(b.h) * moved; b.pz += Math.sin(b.h) * moved;
    steering(T, G, b, out || inp.hold || b.finished != null ? 0 : clamp(+inp.steer || 0, -1, 1), DT);
    // where that is on the track, the barrier, and which way you're going
    const L = locate(T, b.px, b.pz, b.s);
    b.s = L.s; b.u = L.u;
    b.off = Math.abs(b.u) > P.TW + 0.8;
    if (b.fenceT > 0) b.fenceT -= DT;
    if (Math.abs(b.u) > P.FENCE) fence(T, b, L, ev);
    const speed = Math.hypot(b.vx, b.vy);
    b.wrong = !out && speed > 1.5 && Math.cos(b.h - L.h) * Math.sign(b.vx) < -0.2;
    if (b.finished == null && !out) b.maxSpeed = Math.max(b.maxSpeed, speed);
    tricks(G, b, ev);
    // crashing: your body hits the ground, or the bike lies upside down
    if (!b.crashed && !inp.hold) {
      const rel = Math.atan2(Math.sin(b.a - slope(G, b.x)), Math.cos(b.a - slope(G, b.x)));
      if (b.bodyHit || (b.scrape && Math.abs(rel) > 1.75)) crash(T, b, ev);
    }
    if (b.crashed) {
      b.crashed += DT;
      riderStep(G, b);
    }
    // checkpoints (in order, however you get there) and the finish
    if (!b.crashed && b.finished == null && !inp.hold) {
      b.t += DT;
      while (b.cp + 1 < T.cps.length && b.s >= T.cps[b.cp + 1]) { b.cp++; ev.push(['cp', b.cp]); }
      if (b.s >= T.finish && b.cp === T.cps.length - 1) { b.finished = b.t; ev.push(['finish', b.t]); }
    } else if (b.crashed && b.finished == null) b.t += DT;
    return ev;
  }

  /** Turn the bike. On the ground: the bars turn less the faster you go, and the tyres (and a berm, if
      you're going round it) can only hold so much; past that you slide wide and scrub off speed. In the
      air you can only twist it a little. */
  function steering(T, G, b, input, dt) {
    b.steer += clamp(input - b.steer, -dt * 5, dt * 5);
    const v = b.vx;
    let yaw = 0;
    b.scrub = 0;
    if (b.crashed) { b.yaw = 0; return; }
    if (b.wh[0].ct || b.wh[1].ct) {
      const lock = P.STEER / (1 + Math.abs(v) * P.STEER_FALL);
      yaw = v * Math.tan(b.steer * lock) / P.WHEELBASE;
      const k = bermAt(T, b.s);
      const berm = k && Math.sign(k) === Math.sign(yaw) && Math.abs(b.u) < P.TW + 1.5 ? 1 + P.BERM_GRIP * Math.min(1, Math.abs(k) * 22) : 1;
      const most = P.MU_SIDE * gripAt(G, b.x) * berm * P.G;   // the sideways acceleration the tyres can take
      const lat = Math.abs(v * yaw);
      if (lat > most && Math.abs(v) > 1) {
        yaw = Math.sign(yaw) * most / Math.abs(v);
        b.scrub = (lat - most) / P.G;
        const f = 1 - dt * Math.min(0.5, 0.06 + b.scrub * 0.25);   // (a little speed lost while sliding, not a lot)
        b.vx *= f; for (const w of b.wh) { w.vx *= f; w.sp *= f; }
      }
    } else yaw = b.steer * P.AIR_TWIST;
    b.yaw = yaw;
    b.h += yaw * dt;
  }

  /** Too far off the track: the barrier stops you and turns you back along it. */
  function fence(T, b, L, ev) {
    const sgn = Math.sign(b.u); const over = Math.abs(b.u) - P.FENCE;
    const rx = -Math.sin(L.h); const rz = Math.cos(L.h);
    b.px -= rx * over * sgn; b.pz -= rz * over * sgn; b.u = sgn * P.FENCE;
    const out = (Math.cos(b.h) * rx + Math.sin(b.h) * rz) * sgn * Math.sign(b.vx || 1);   // how much you're heading into it
    if (out > 0) {
      const along = Math.cos(b.h - L.h) >= 0 ? L.h : L.h + Math.PI;
      let d = along - b.h; d = Math.atan2(Math.sin(d), Math.cos(d));
      b.h += d * Math.min(1, 0.6 + out);
      const f = 1 - 0.55 * out;
      b.vx *= f; b.vy *= f; for (const w of b.wh) { w.vx *= f; w.sp *= f; }
      if (b.fenceT <= 0) { ev.push(['fence', out]); b.fenceT = 0.5; }
    }
  }

  /** Air time, flips and landings. Flips only count when you land them cleanly. */
  function tricks(T, b, ev) {
    const f = b.wh[0].ct; const r = b.wh[1].ct;
    const touching = f || r || b.scrape;
    if (!touching) {
      if (b.air === 0) { b.airRot = 0; b.airPeak = b.y; }
      b.air += DT; b.airRot += b.w * DT; b.airPeak = Math.max(b.airPeak, b.y);
      b.ground = 0;
      return;
    }
    if (b.air > 0) {
      if (b.air > 0.3) b.landing = { air: b.air, rot: b.airRot, t: 0, both: f && r, height: b.airPeak - groundY(T, b.x), angle: Math.abs(b.a - slope(T, b.x)) };
      b.air = 0;
    }
    b.ground += DT;
    const L = b.landing;
    if (!L) return;
    L.t += DT;
    if (f && r) L.both = true;
    if (b.crashed) { b.landing = null; return; }
    if (L.t < 0.3) return;
    b.landing = null;
    const turns = Math.floor((Math.abs(L.rot) + 1.0) / TAU);
    const clean = L.both && !b.scrape;
    if (!clean) { ev.push(['land', { clean: false, air: L.air }]); return; }
    let gain = L.air > 0.5 ? 0.05 + 0.035 * Math.min(L.air, 2.5) : 0;
    const perfect = L.angle < 0.14 && L.air > 0.5;
    if (perfect) gain += 0.05;
    if (turns > 0) gain += 0.3 * turns;
    b.flips += turns;
    b.nitro = Math.min(1, b.nitro + gain);
    b.lastLand = { air: L.air, turns, back: L.rot > 0, perfect, gain };
    ev.push(['land', { clean: true, air: L.air, turns, back: L.rot > 0, perfect, gain, height: L.height }]);
  }

  function crash(T, b, ev) {
    b.crashed = DT; b.crashes++;
    b.landing = null; b.air = 0;
    const ca = Math.cos(b.a); const sa = Math.sin(b.a);
    // previous positions for the Verlet ragdoll come from how the rider was moving
    const hip = { x: b.rx, y: b.ry, px: b.rx - b.rvx * DT, py: b.ry - b.rvy * DT };
    const hx = b.rx + ca * 0.24 - sa * 0.64; const hy = b.ry + sa * 0.24 + ca * 0.64;
    const head = { x: hx, y: hy, px: hx - (b.rvx - b.w * (hy - b.ry)) * DT, py: hy - (b.rvy + b.w * (hx - b.rx)) * DT };
    b.rider = { hip, head };
    ev.push(['crash']);
  }

  /** The rider tumbling after a crash: two points (hip and head) on a stick. */
  function riderStep(T, b) {
    const R = b.rider; if (!R) return;
    const pts = [R.hip, R.head];
    for (const p of pts) {
      const vx = (p.x - p.px) * 0.995; const vy = (p.y - p.py) * 0.995;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy - P.G * DT * DT;
    }
    for (let it = 0; it < 3; it++) {
      const dx = R.head.x - R.hip.x; const dy = R.head.y - R.hip.y; const d = Math.hypot(dx, dy) || 1e-6;
      const k = (d - 0.62) / d / 2;
      R.hip.x += dx * k; R.hip.y += dy * k; R.head.x -= dx * k; R.head.y -= dy * k;
      for (const p of pts) {
        const gy = groundY(T, p.x) + 0.16;
        if (p.y < gy) {
          p.y = gy;
          const vx = p.x - p.px; const vy = p.y - p.py;
          p.px = p.x - vx * 0.82; p.py = p.y + Math.abs(vy) * 0.25;
        }
      }
    }
  }

  /** Back to the last checkpoint (or the start), in the middle of the track (or a lane). */
  function respawn(T, b, u = 0) {
    const x = b.cp >= 0 ? T.cps[b.cp] : T.start;
    const keep = { nitro: b.nitro, cp: b.cp, t: b.t, crashes: b.crashes, flips: b.flips, maxSpeed: b.maxSpeed };
    place(T, b, x, u);
    Object.assign(b, keep);
    b.hold = P.HOLD_TIME;
  }

  // ------------------------------------------------------------------ the robot rider
  /** Where the bike will come down if nothing changes (going by the track's profile): { x (along the track), t, slope }
      (the slope as the bike will meet it, so riding across a slope makes it gentler). */
  function predictLanding(T, b) {
    const c = Math.cos(b.h - pathAt(T, b.s, tmpPath).h);
    let x = b.s; let y = b.y - 0.45; const vx = b.vx * c; let vy = b.vy; let t = 0;
    for (let i = 0; i < 160; i++) {
      t += 1 / 40; vy -= P.G / 40; x += vx / 40; y += vy / 40;
      if (y <= groundY(T, x) + 0.1 && vy < 0) break;
    }
    let sum = 0;   // the average slope around there (bumps and whoops would make it jumpy)
    for (let d = -1.5; d <= 1.5; d += 0.5) sum += slope(T, x + d);
    return { x, t, slope: Math.atan(Math.tan(sum / 7) * c) };
  }
  const tmpPath = {};

  /** The speed the robot wants here: slow enough to brake for every corner ahead, and the right speed for the next jump. */
  function robotSpeed(T, x) {
    let want = 99; let exact = null;
    for (const f of T.features) {
      if (f.kind === 'turn') {
        if (f.x1 < x || f.x0 > x + 140) continue;
        const d = Math.max(0, f.x0 - x - 2);
        want = Math.min(want, Math.sqrt(Math.pow(f.vmax * 0.96, 2) + 2 * 6 * d));
      } else if (f.kind === 'whoops') {
        if (f.x1 < x || f.x0 > x + 140) continue;
        want = Math.min(want, Math.sqrt(15 * 15 + 2 * 6 * Math.max(0, f.x0 - x - 2)));
      } else if (f.speed) {
        if (f.lip < x || f.x0 > x + 160) continue;
        const d = Math.max(0, f.x0 - x - 4);
        want = Math.min(want, Math.sqrt(f.speed * f.speed + 2 * 6 * d));
        if (exact == null) exact = { f, d };
      }
    }
    return { want, exact };
  }

  /** What the robot presses this step. It steers for a point a little way along its lane (b.lane, 0 = the middle). */
  function robot(T, b) {
    const inp = { gas: 1, brake: 0, steer: 0, lean: 0, nitro: false, assist: false };
    if (b.crashed || b.finished != null) return inp;
    const onGround = b.wh[0].ct || b.wh[1].ct;
    const speed = Math.hypot(b.vx, b.vy);
    const p = pathAt(T, b.s + 4 + Math.abs(b.vx) * 0.45, tmpPath); const lane = b.lane || 0;
    let ang = Math.atan2(p.z + Math.cos(p.h) * lane - b.pz, p.x - Math.sin(p.h) * lane - b.px) - b.h;
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    inp.steer = clamp(ang * 2.6 - b.yaw * 0.08, -1, 1);
    const x = b.s;
    // in whoops: weight back and keep the front light, so the bike skims over the tops
    const whoops = T.features.some((f) => (f.kind === 'whoops' || f.kind === 'rollers') && x > f.x0 - 3 && x < f.x1 + 2);
    if (onGround) {
      const rel = b.a - slope(T, x + 0.3);
      inp.lean = clamp((rel - (whoops ? 0.14 : 0.04)) * 5 + b.w * 0.25, -1, 1);
      const { want, exact } = robotSpeed(T, x);
      const onFace = exact && x >= exact.f.x0 - 1;
      if (onFace) inp.gas = speed < want ? 1 : 0.35;          // never brake on a takeoff
      else if (speed > want + 0.6) { inp.gas = 0; inp.brake = clamp((speed - want) / 3, 0.3, 1); }
      else if (speed > want - 0.4) inp.gas = 0.45;
      if (rel > 0.4) inp.gas = Math.min(inp.gas, 0.3);
      // nitro on a flat run with nothing to slow down for
      let flat = true;
      for (let d = 2; d < 34; d += 2) if (Math.abs(slope(T, x + d)) > 0.12) { flat = false; break; }
      inp.nitro = flat && b.nitro > 0.25 && speed < want - 3;
    } else {
      const L = predictLanding(T, b);
      const want = whoops ? Math.max(0.08, L.slope + 0.1) : L.slope - 0.03;
      const err = b.a - want;
      const wantSpin = clamp(-err / Math.max(L.t, 0.3), -4, 4);
      inp.lean = clamp((b.w - wantSpin) * (L.t < 0.35 ? 0.5 : 0.9), -1, 1);
      inp.gas = 0.3;
    }
    return inp;
  }

  /** The robot rides a track from the start (or a checkpoint) to the finish: { time, crashes, ... }. */
  function simulate(T, opts = {}) {
    const b = newBike(T, opts.from != null ? T.cps[opts.from] : T.start, opts.lane || 0);
    b.lane = opts.lane || 0;
    if (opts.from != null) b.cp = opts.from;
    const ride = opts.rider || robot;
    const limit = opts.limit || 240;
    let wait = 0; const landings = []; let n = 0;
    while (b.finished == null && b.t < limit) {
      if (wait > 0) { wait -= DT; b.t += DT; continue; }
      const ev = step(T, b, ride(T, b, n++));
      for (const [k, d] of ev) {
        if (k === 'land') landings.push(d);
      }
      if (b.crashed > P.CRASH_TIME) { respawn(T, b, b.lane); wait = P.HOLD_TIME; }
      if (opts.onStep) opts.onStep(b);
    }
    return { time: b.finished, crashes: b.crashes, flips: b.flips, landings, maxSpeed: b.maxSpeed, bike: b };
  }

  root.MotoCore = {
    DT, SUB, P, SURFACE, build, groundY, slope, gripAt, surfaceAt, plan, touch,
    newBike, place, step, respawn, robot, robotSpeed, predictLanding, simulate, torqueCurve, launchSpeed, rollAt, cornerAt,
    pathAt, heightAt, natural, bank, bermAt, trackY, locate, slice, vnoise, fbm,
  };
})(typeof window !== 'undefined' ? window : globalThis);
