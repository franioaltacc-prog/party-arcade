/* Poly Racer core: tracks, car physics and an autopilot. No drawing here, so it also runs in
   tests outside the browser (the autopilot drives every track to check it can be finished and
   to set the medal times).

   A track is a little "turtle" program. From the start line the road goes:
     F40      forward 40            B20      boost pad, 20 long
     L90r30   turn left 90° (radius 30)   R45r60  turn right
     U30h6    smooth hill up 6 over 30    D30h6   smooth hill down
     K12h3    straight kicker ramp (launches you over a gap)
     J18      gap you have to jump (J18h-4 lands 4 lower)
     C        checkpoint here       W0 / W1  walls off / on       w5  road half-width 5
   The end of the program is the finish line. */
(function (root) {
  'use strict';
  const STEP = 1;
  const P = {
    G: 32,            // gravity
    ACC: 26,          // engine
    VMAX: 46,         // top speed (units/s; the speedometer shows km/h = ×3.6)
    BOOST_MAX: 64,    // top speed on a boost
    BOOST_ACC: 46,
    BOOST_TIME: 1.3,
    BRAKE: 52,
    REV: 12,
    STEER: 2.4,       // turn rate at low speed (rad/s)
    STEER_FALL: 0.024,// turning gets wider as you go faster
    GRIP: 9,          // how fast sideways sliding stops
    DRIFT_GRIP: 1.6,  // with the handbrake
    HALF_W: 1.05,     // half the car's width
    SNAP: 0.9,        // how far above the road you can be and still count as driving on it
    FALL: 10,         // fall this far below the road and you respawn
    END: 4.2,         // the road goes this far past its first and last point, then a barrier closes it off
  };

  // ------------------------------------------------------------------ tracks
  // medals are [author, gold, silver, bronze] in seconds (set from the autopilot's time)
  const TRACKS = [
    { id: 1, name: 'First Lap', emoji: '🌱', theme: 'summer', medals: [26.9, 28.0, 31.7, 37.7],
      code: 'w7 F60 R90r34 F40 C R90r34 F30 U30h4 F20 D30h4 F40 C L90r30 F30 L90r30 F50 B20 F40 C R90r34 F40 R45r50 F30 L45r50 F40 C U20h3 F30 D20h3 R90r34 F60 B20 F40' },
    { id: 2, name: 'Hill Climb', emoji: '⛰️', theme: 'summer', medals: [26.9, 28.0, 31.7, 37.7],
      code: 'w6 F40 U40h8 F20 D30h6 C F20 R60r40 F30 K12h2 J14 F20 D30h4 C L90r30 U30h6 F20 R90r30 F30 C D40h6 F20 B20 F40 L90r34 U40h10 F20 C K10h2 J14 F10 D40h12 R90r30 F30 C L45r40 F20 U30h5 D30h5 R45r40 B20 F50' },
    { id: 3, name: 'Hairpins', emoji: '🌀', theme: 'desert', medals: [32.9, 34.2, 38.8, 46.1],
      code: 'w6 F40 R90r18 F20 R90r18 F30 C L90r18 F14 L90r18 F30 C R135r16 F20 L135r16 F30 C R90r22 F20 L90r22 F20 R90r22 F30 B20 F40 C L90r18 F10 L90r18 F30 R90r18 F10 R90r18 F30 C L180r16 F40 B20 F40' },
    { id: 4, name: 'Big Air', emoji: '🚀', theme: 'desert', medals: [23.5, 24.4, 27.7, 32.9],
      code: 'w6 F30 B20 F10 K14h3 J20 F30 C R90r30 F20 B15 K14h3 J24h-2 F30 C L90r34 F20 U30h5 F10 B15 K12h3 J26h-4 F30 C R90r30 B20 F20 K14h3 J22 F40 C L90r30 F20 B20 K16h4 J30h-3 F30 C R60r40 F20 B15 K12h3 J20 F20 L60r40 F40' },
    { id: 5, name: 'Sky Highway', emoji: '☁️', theme: 'snow', medals: [23.6, 24.5, 27.8, 33.0],
      code: 'w6 F40 W0 U40h10 F30 C R60r50 F30 L60r50 F20 w5 F30 C W1 R90r28 F20 W0 B20 K12h2 J16 F20 C w6 L90r40 D40h8 F20 W1 B20 F40 C W0 w5 U30h6 F20 R45r60 F30 L90r50 F20 C w4 F40 w6 R45r60 W1 D30h6 B20 F50' },
    { id: 6, name: 'Chaos', emoji: '🌋', theme: 'night', medals: [29.7, 30.9, 35.0, 41.6],
      code: 'w6 F30 B15 K12h3 J20h-2 F20 R90r20 F15 C L90r20 F10 W0 w5 U30h6 F20 L45r40 R45r40 F20 C W1 w6 D30h6 R135r18 F20 C B20 K14h3 J24h-3 F20 L90r24 F20 R90r24 C F20 W0 R60r40 L60r40 W1 B15 F30 C L90r20 F10 W0 w5 B15 K12h3 J22h-2 F20 W1 w6 R90r24 F20 C L135r18 F20 B20 F40' },
  ];

  const TOKEN = /^([A-Za-z])(-?\d+(?:\.\d+)?)?(?:([a-z])(-?\d+(?:\.\d+)?))?$/;

  /** Turn a track program into samples every 1 unit along the middle of the road. */
  function build(track) {
    let x = 0; let y = 6; let z = 0; let yaw = 0;
    let w = 6; let walls = true;
    let s = 0;
    let cps = 0;
    const S = [];
    const push = (o) => {
      S.push({ x, y, z, hx: Math.sin(yaw), hz: Math.cos(yaw), w, walls, gap: false, boost: false, cp: -1, slope: 0, s, ...o });
    };
    push({});
    const fwd = () => { x += Math.sin(yaw) * STEP; z += Math.cos(yaw) * STEP; s += STEP; };
    for (const tok of track.code.trim().split(/\s+/)) {
      const m = TOKEN.exec(tok);
      if (!m) throw new Error('bad token ' + tok);
      const k = m[1]; const a = m[2] != null ? +m[2] : 0; const b = m[4] != null ? +m[4] : 0;
      if (k === 'F' || k === 'B') {
        for (let i = 0; i < a; i++) { fwd(); push({ boost: k === 'B' }); }
      } else if (k === 'L' || k === 'R') {
        const len = (b * a * Math.PI) / 180;
        const n = Math.max(1, Math.round(len / STEP));
        const d = ((a * Math.PI) / 180 / n) * (k === 'L' ? 1 : -1);
        for (let i = 0; i < n; i++) { yaw += d / 2; fwd(); yaw += d / 2; push({}); }
      } else if (k === 'U' || k === 'D') {
        const y0 = y; const hgt = k === 'U' ? b : -b;
        for (let i = 1; i <= a; i++) {
          const t = i / a;
          fwd();
          y = y0 + hgt * t * t * (3 - 2 * t);
          push({ slope: (hgt * 6 * t * (1 - t)) / a });
        }
      } else if (k === 'K') {
        for (let i = 1; i <= a; i++) { fwd(); y += b / a; push({ slope: b / a }); }
      } else if (k === 'J') {
        const y0 = y;
        for (let i = 1; i <= a; i++) { fwd(); y = y0 + (b * i) / a; push({ gap: true }); }
      } else if (k === 'C') {
        S[S.length - 1].cp = cps++;
      } else if (k === 'W') {
        walls = a !== 0;
      } else if (k === 'w') {
        w = a;
      }
    }
    // a little run-out after the finish line so you don't fall off the end
    const finish = S.length - 1;
    for (let i = 0; i < 25; i++) { fwd(); push({ after: true }); }
    return { track, S, finish, cps, length: S[finish].s };
  }

  // ------------------------------------------------------------------ the car
  function newCar(T, at = 0) {
    const c = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, vy: 0, grounded: true, idx: 0, cp: -1, t: 0,
      boostT: 0, finished: false, time: null, splits: [], respawns: 0, airT: 0, onWall: false, fell: false };
    place(T, c, at);
    return c;
  }
  function place(T, c, i) {
    const s = T.S[i];
    Object.assign(c, { x: s.x, y: s.y, z: s.z, yaw: Math.atan2(s.hx, s.hz), vx: 0, vz: 0, vy: 0, grounded: true, idx: i, boostT: 0, airT: 0 });
  }
  /** Back to the last checkpoint (or the start). The clock keeps running. */
  function respawn(T, c) {
    let i = 0;
    if (c.cp >= 0) i = T.S.findIndex((s) => s.cp === c.cp);
    place(T, c, Math.max(0, i));
    c.respawns++;
  }
  const speed = (c) => c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw);

  function locate(T, c, lo, hi) {
    const S = T.S;
    let best = c.idx; let bd = Infinity;
    for (let i = Math.max(0, lo); i <= Math.min(S.length - 1, hi); i++) {
      const s = S[i];
      const dx = c.x - s.x; const dz = c.z - s.z; const dy = c.y - s.y;
      const d = dx * dx + dz * dz + (dy < -3 ? (dy + 3) * (dy + 3) * 3 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Move the car by dt seconds. inp: { up, down, left, right (0..1), drift }. */
  function step(T, c, inp, dt) {
    if (c.finished) return;
    c.t += dt;
    const fx = Math.sin(c.yaw); const fz = Math.cos(c.yaw);
    const rx = -fz; const rz = fx;
    let u = c.vx * fx + c.vz * fz;      // speed forwards
    let l = c.vx * rx + c.vz * rz;      // sliding sideways
    const steer = (inp.right || 0) - (inp.left || 0);
    const here = T.S[c.idx];
    if (c.grounded) {
      if (here.boost) c.boostT = P.BOOST_TIME;
      const boosting = c.boostT > 0;
      const vmax = boosting ? P.BOOST_MAX : P.VMAX;
      if (boosting) u += P.BOOST_ACC * dt * Math.max(0, 1 - u / P.BOOST_MAX);
      if (inp.up && !inp.down) {
        if (u < vmax) u += P.ACC * dt * Math.max(0.15, 1 - (u / vmax) ** 2) * (u < 0 ? 2 : 1);
      } else if (inp.down) {
        if (u > 0.5) u = Math.max(0, u - P.BRAKE * dt);
        else u = Math.max(-P.REV, u - P.ACC * 0.6 * dt);
      } else {
        u -= Math.sign(u) * Math.min(Math.abs(u), (2.5 + Math.abs(u) * 0.06) * dt);
      }
      if (u > vmax) u = Math.max(vmax, u - 10 * dt);       // a boost wears off
      // hills: going up slows you down, going down speeds you up
      const along = fx * here.hx + fz * here.hz;
      u -= P.G * 0.7 * here.slope * along * dt;
      // steering: tighter when slow, wider when fast, reversed when backing up
      const rate = (P.STEER * Math.min(1, Math.abs(u) / 8)) / (1 + Math.abs(u) * P.STEER_FALL);
      c.yaw -= steer * rate * dt * Math.sign(u || 1) * (inp.drift ? 1.25 : 1);
      l *= Math.exp(-(inp.drift ? P.DRIFT_GRIP : P.GRIP) * dt);
      if (inp.drift && Math.abs(u) > 4) u -= u * 0.35 * dt;
    } else {
      c.yaw -= steer * 1.2 * dt;      // a little air control
      c.airT += dt;
    }
    c.boostT = Math.max(0, c.boostT - dt);
    // velocity in the world: keep the old direction's momentum, the new heading takes over through grip
    const nfx = Math.sin(c.yaw); const nfz = Math.cos(c.yaw);
    if (c.grounded) {
      const nrx = -nfz; const nrz = nfx;
      const vx = fx * u + rx * l; const vz = fz * u + rz * l;
      const nu = vx * nfx + vz * nfz; const nl = vx * nrx + vz * nrz;
      c.vx = nfx * nu + nrx * nl; c.vz = nfz * nu + nrz * nl;
    }
    c.x += c.vx * dt; c.z += c.vz * dt;
    if (!c.grounded) { c.vy -= P.G * dt; c.y += c.vy * dt; }

    // where on the track are we?
    const prev = c.idx;
    const i = locate(T, c, c.idx - 12, c.idx + (c.grounded ? 30 : 90));
    const s = T.S[i];
    const dx = c.x - s.x; const dz = c.z - s.z;
    const trx = -s.hz; const trz = s.hx;
    const lat = dx * trx + dz * trz;
    const roadY = s.y + s.slope * (dx * s.hx + dz * s.hz);
    const onRoad = !s.gap && Math.abs(lat) <= s.w + 0.35;
    if (c.grounded) {
      if (onRoad && c.y - roadY < P.SNAP && c.y - roadY > -2.5) {
        c.y = roadY; c.vy = 0;
      } else {
        c.grounded = false;     // off a jump or over the edge
        c.vy = Math.max(0, here.slope * (c.vx * here.hx + c.vz * here.hz));
        c.airT = 0;
      }
    } else if (onRoad && c.y <= roadY + 0.05 && c.y > roadY - 2.5 && c.vy <= 0) {
      c.grounded = true;
      c.y = roadY;
      const hard = Math.min(1, -c.vy / 40);
      c.vx *= 1 - hard * 0.25; c.vz *= 1 - hard * 0.25;
      c.vy = 0;
    }
    // walls push you back onto the road
    c.onWall = false;
    // the two ends of the track (behind the start, after the run-out) are closed by a barrier across the road
    const along = dx * s.hx + dz * s.hz;
    const end = i === 0 && along < 0 ? -1 : i === T.S.length - 1 && along > 0 ? 1 : 0;
    const stop = P.END - 2.2;               // the car's nose touches the barrier here
    if (end && Math.abs(along) > stop && c.y < roadY + 3) {
      const over = Math.abs(along) - stop;
      c.x -= s.hx * end * over; c.z -= s.hz * end * over;
      const va = c.vx * s.hx + c.vz * s.hz;
      if (va * end > 0) {
        c.vx -= s.hx * va * 1.3; c.vz -= s.hz * va * 1.3;
        c.vx *= 0.7; c.vz *= 0.7;
      }
      c.onWall = true;
    }
    if (c.grounded && s.walls && Math.abs(lat) > s.w - P.HALF_W) {
      const side = Math.sign(lat);
      const push = Math.abs(lat) - (s.w - P.HALF_W);
      c.x -= trx * side * push; c.z -= trz * side * push;
      const vlat = c.vx * trx + c.vz * trz;
      if (vlat * side > 0) {
        // bouncing off: the harder you hit, the more speed you lose
        const hit = Math.min(0.55, Math.abs(vlat) / 28);
        c.vx -= trx * vlat * 1.3; c.vz -= trz * vlat * 1.3;
        c.vx *= 1 - hit; c.vz *= 1 - hit;
      }
      // scraping along at a shallow angle straightens you up a bit
      const ty = Math.atan2(s.hx, s.hz);
      let d = ty - c.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 0.45) c.yaw += d * Math.min(1, 2.5 * dt);
      else c.vx *= 1 - 1.2 * dt, c.vz *= 1 - 1.2 * dt;     // grinding nose-first into a wall
      c.onWall = true;
    }
    c.idx = i;
    // checkpoints in order, then the finish
    for (let k = prev + 1; k <= i; k++) {
      if (T.S[k].cp === c.cp + 1) { c.cp++; c.splits.push(c.t); }
    }
    if (i >= T.finish && prev < T.finish + 25 && c.cp === T.cps - 1 && Math.abs(lat) <= s.w + 1) {
      c.finished = true;
      c.time = c.t;
    }
    // fell off?
    c.fell = !c.grounded && c.y < roadY - P.FALL;
  }

  // ------------------------------------------------------------------ autopilot
  /** Steering and pedals that drive the track well (used to test tracks and set medals). */
  function autopilot(T, c, skill = 1) {
    const S = T.S;
    const n = S.length - 1;
    const u = speed(c);
    const look = Math.min(n, c.idx + Math.round(4 + Math.max(0, u) * 0.3));
    const tgt = S[look];
    const want = Math.atan2(tgt.x - c.x, tgt.z - c.z);
    let err = want - c.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, -err * 3));
    // the fastest speed we can take every bend ahead at, braking in time
    let target = P.BOOST_MAX;
    for (let k = c.idx + 1; k < Math.min(n, c.idx + 90); k++) {
      const a = Math.atan2(S[k].hx, S[k].hz); const b = Math.atan2(S[k + 1].hx, S[k + 1].hz);
      let dyaw = b - a;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const curv = Math.abs(dyaw) / STEP;
      if (curv < 1e-4) continue;
      // fastest v with v * curv <= turn rate(v)
      let lo = 0; let hi = P.BOOST_MAX;
      for (let it = 0; it < 20; it++) {
        const v = (lo + hi) / 2;
        const rate = (P.STEER * Math.min(1, v / 8)) / (1 + v * P.STEER_FALL);
        if (v * curv <= rate * 0.92 * skill) lo = v; else hi = v;
      }
      const d = (k - c.idx) * STEP;
      target = Math.min(target, Math.sqrt(lo * lo + 2 * P.BRAKE * 0.8 * d));
    }
    const nearJump = S.slice(c.idx, c.idx + 40).some((s) => s.gap || s.slope > 0.15);
    return { up: nearJump || u < target, down: !nearJump && u > target + 3, left: steer < 0 ? -steer : 0, right: steer > 0 ? steer : 0 };
  }

  /** Drive a track with the autopilot. Returns { time, respawns } (time null if it never finished). */
  function simulate(track, maxT = 400, skill = 1) {
    const T = build(track);
    const c = newCar(T);
    const dt = 1 / 120;
    while (!c.finished && c.t < maxT) {
      step(T, c, autopilot(T, c, skill), dt);
      if (c.fell) respawn(T, c);
    }
    return { time: c.finished ? c.time : null, respawns: c.respawns, cps: c.cp + 1, total: T.cps };
  }

  root.PolyCore = { P, TRACKS, STEP, build, newCar, step, respawn, speed, autopilot, simulate };
})(typeof window !== 'undefined' ? window : globalThis);
