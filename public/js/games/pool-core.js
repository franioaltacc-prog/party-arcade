/* Billiards core: table geometry, deterministic ball physics and the 8-ball / 9-ball rules.
   No drawing here, so it also runs headless in node (tests) and it has a line-by-line Python
   twin in games/pool_core.py that gives bit-identical results for the same input.

   Units are meters and seconds. The playing surface (between the cushion noses) is W x H with
   the origin at the top-left nose corner, x to the right (head on the left), y down.

   Determinism rules (keep pool_core.py in sync, same operation order everywhere):
   only + - * /, Math.sqrt, Math.abs, Math.min/max, comparisons and Math.ceil inside the
   simulation. No hypot, pow, ** or trig. Balls, segments and pockets are always iterated in the
   same order. makeShot turns the aim angle into vx/vy with its own polynomial sin/cos (sincos below,
   only + - * / and floor), so even makeShot is bit-identical in both languages; still, online clients
   must replay the server's shot object (its vx/vy), never a shot they rebuilt themselves. */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ units, table
  const W = 2.24;
  const H = 1.12;
  const R = 0.028575;
  const D = 2 * R;
  const D2 = D * D;
  const R2 = R * R;
  const HEAD_X = W / 4;
  const FOOT_X = 3 * W / 4;
  const HEAD_SPOT = [W / 4, H / 2];
  const FOOT_SPOT = [3 * W / 4, H / 2];

  // ------------------------------------------------------------------ physics constants
  const DT = 1 / 400;
  const G = 9.81;
  const MU_S = 0.2;            // sliding friction
  const MU_R = 0.024;          // rolling resistance (a slowish casual cloth)
  const DRAG = 0.13;           // speed-proportional cloth drag (1/s): a medium shot runs ~2 table lengths, a full one ~4
  const SIDE_DECAY = 0.9;      // side spin decay (m/s per s of surface speed)
  const E_BALL = 0.95;         // ball-ball restitution
  const E_CUSH = 0.87;         // cushion restitution for a soft hit ...
  const E_CUSH_DROP = 0.007;   // ... minus this per m/s of normal speed ...
  const E_CUSH_MIN = 0.7;      // ... but never below this
  const CUSH_T = 0.95;         // tangential speed kept at a cushion
  const CUSH_K = 0.22;         // side-spin kick at a cushion (tangential m/s per m/s of spin)
  const CUSH_SPIN = 0.55;      // side spin kept after a cushion
  const MAX_SPEED = 7;
  const MAX_T = 40;
  const MAX_STEPS = 16000;     // MAX_T / DT
  const SUB = 0.4 * R;         // a ball moves at most this far per substep
  const SLIDE_A = MU_S * G * DT;
  const SLIDE_DU = 3.5 * SLIDE_A;
  const ROLL_DEC = MU_R * G * DT;
  const DRAG_DT = DRAG * DT;
  const SPIN_DEC = SIDE_DECAY * DT;
  const TWO7 = 2 / 7;
  const HALF_E = (1 + E_BALL) / 2;
  const SLIP_EPS2 = 1e-14;
  const SEP2 = (D - 1e-7) * (D - 1e-7);
  const PLACE2 = (D + 1e-4) * (D + 1e-4);
  const BREAK_SPEED = 9.5;     // makeShot speed at power 1 on the break (a normal shot tops out at MAX_SPEED)
  const SHOT_CAP = 20;         // Sim clamps any shot to this speed (and non-finite numbers to 0) so bad input stays cheap
  const JAW_E0 = 0.45;         // jaw (pocket facing) restitution: a soft hit dies in the jaws ...
  const JAW_EK = 0.2;          // ... plus this per m/s of normal speed ...
  const JAW_EMAX = 0.9;        // ... up to this, so a slammed ball rattles out

  // ------------------------------------------------------------------ geometry
  function unit(x, y) {
    const l = Math.sqrt(x * x + y * y);
    return [x / l, y / l];
  }
  const SQRT2 = Math.sqrt(2);
  const SQRT3 = Math.sqrt(3);
  const CORNER_MOUTH = 2.2 * D;          // distance between the two jaw tips of a corner pocket
  const SIDE_MOUTH = 2.4 * D;            // ... of a side pocket
  const CA = CORNER_MOUTH / SQRT2;       // jaw tip distance from the corner along each rail
  const SH = SIDE_MOUTH / 2;             // half the side mouth
  const CJ = unit(1, 0.78);              // corner jaw direction: ~38 deg off the rail line
  const SJ = unit(1, 4);                 // side jaw direction: ~76 deg off the rail line (steeper)
  const CJ_LEN = 3.5 * R;
  const SJ_LEN = 2.5 * R;
  const C_OFF = 0.5 * R;                 // corner capture centre, behind the corner point on the diagonal
  const C_RAD = 1.8 * R;
  const S_OFF = 1.6 * R;                 // side capture centre, behind the rail line
  const S_RAD = 1.5 * R;
  const CZ = CA + 1.5 * R;               // a ball this close to both rails of a corner may touch its jaws
  const SZ = SH + 1.5 * R;               // ... or this close to the middle of a long rail
  const OB = 2.5 * R;                    // a centre this far beyond a rail line is always pocketed
  const XHI = W - R;
  const YHI = H - R;
  const RAIL_X1 = W / 2 - SH;            // the long rails run CA..RAIL_X1 and RAIL_X2..RAIL_XE
  const RAIL_X2 = W / 2 + SH;
  const RAIL_XE = W - CA;
  const RAIL_YE = H - CA;                // the short rails run CA..RAIL_YE

  // pockets clockwise from the top-left: 0 TL, 1 top side, 2 TR, 3 BR, 4 bottom side, 5 BL
  const POCKETS = [];
  const JAWS = [];                       // 12 jaw segments, 2 per pocket: [tipX, tipY, endX, endY]
  function jaw(tx, ty, dx, dy, len) { return [tx, ty, tx + dx * len, ty + dy * len]; }
  function corner(cx, cy, sx, sy) {
    const hTip = [cx - sx * CA, cy];     // tip on the long (horizontal) rail
    const vTip = [cx, cy - sy * CA];     // tip on the short (vertical) rail
    const p = { x: cx + sx * C_OFF, y: cy + sy * C_OFF, r: C_RAD, corner: true,
      mouth: [hTip, vTip], axis: [sx / SQRT2, sy / SQRT2],
      jaws: [jaw(hTip[0], hTip[1], sx * CJ[0], sy * CJ[1], CJ_LEN), jaw(vTip[0], vTip[1], sx * CJ[1], sy * CJ[0], CJ_LEN)] };
    p.hole = C_RAD;                      // drawing radius = capture radius: a ball drops once its centre is over the hole
    return p;
  }
  function side(cy, sy) {
    const lTip = [W / 2 - SH, cy];
    const rTip = [W / 2 + SH, cy];
    const p = { x: W / 2, y: cy + sy * S_OFF, r: S_RAD, corner: false,
      mouth: [lTip, rTip], axis: [0, sy],
      jaws: [jaw(lTip[0], lTip[1], SJ[0], sy * SJ[1], SJ_LEN), jaw(rTip[0], rTip[1], -SJ[0], sy * SJ[1], SJ_LEN)] };
    p.hole = S_RAD;
    return p;
  }
  POCKETS.push(corner(0, 0, -1, -1), side(0, -1), corner(W, 0, 1, -1), corner(W, H, 1, 1), side(H, 1), corner(0, H, -1, 1));
  // per-jaw physics data: start, delta, |delta|^2 and the normal pointing into the pocket channel
  const JX = [], JY = [], JDX = [], JDY = [], JL2 = [], JNX = [], JNY = [];
  for (let p = 0; p < 6; p++) {
    const P = POCKETS[p];
    for (let k = 0; k < 2; k++) {
      const s = P.jaws[k];
      JAWS.push(s);
      const dx = s[2] - s[0], dy = s[3] - s[1];
      const l = Math.sqrt(dx * dx + dy * dy);
      let nx = -dy / l, ny = dx / l;
      if ((P.x - s[0]) * nx + (P.y - s[1]) * ny < 0) { nx = -nx; ny = -ny; }
      JX.push(s[0]); JY.push(s[1]); JDX.push(dx); JDY.push(dy); JL2.push(dx * dx + dy * dy); JNX.push(nx); JNY.push(ny);
    }
  }
  const PX = POCKETS.map((p) => p.x), PY = POCKETS.map((p) => p.y), PR = POCKETS.map((p) => p.r), PR2 = POCKETS.map((p) => p.r * p.r);

  // the cushions as 6 polylines (jaw end, tip, tip, jaw end), clockwise from the top-left rail
  function end(s) { return [s[2], s[3]]; }
  function tip(s) { return [s[0], s[1]]; }
  const PJ = POCKETS.map((p) => p.jaws);
  const CUSHIONS = [
    [end(PJ[0][0]), tip(PJ[0][0]), tip(PJ[1][0]), end(PJ[1][0])],
    [end(PJ[1][1]), tip(PJ[1][1]), tip(PJ[2][0]), end(PJ[2][0])],
    [end(PJ[2][1]), tip(PJ[2][1]), tip(PJ[3][1]), end(PJ[3][1])],
    [end(PJ[3][0]), tip(PJ[3][0]), tip(PJ[4][1]), end(PJ[4][1])],
    [end(PJ[4][0]), tip(PJ[4][0]), tip(PJ[5][0]), end(PJ[5][0])],
    [end(PJ[5][1]), tip(PJ[5][1]), tip(PJ[0][1]), end(PJ[0][1])],
  ];
  const SEGMENTS = [];                   // the same as 18 segments [x1, y1, x2, y2]
  for (const c of CUSHIONS) for (let k = 0; k < 3; k++) SEGMENTS.push([c[k][0], c[k][1], c[k + 1][0], c[k + 1][1]]);
  // diamond positions on the cushion nose lines (draw them out on the wooden rail)
  const DIAMONDS = [];
  for (const k of [1, 2, 3, 5, 6, 7]) DIAMONDS.push([k * W / 8, 0]);
  for (const k of [1, 2, 3]) DIAMONDS.push([W, k * H / 4]);
  for (const k of [7, 6, 5, 3, 2, 1]) DIAMONDS.push([k * W / 8, H]);
  for (const k of [3, 2, 1]) DIAMONDS.push([0, k * H / 4]);

  // ------------------------------------------------------------------ simulation
  /** A steppable simulation of one shot. balls: [[id, x, y], ...] (resting), shot: {x, y, vx, vy, sx, sy}
      (the cue ball, id 0, is put at shot.x/shot.y). sim.step() advances one DT and returns that step's
      events; sim.done tells when everything stopped. Arrays sim.ids/X/Y/VX/VY/RX/RY/S/ON hold the state.
      The shot is sanitised: non-finite numbers count as 0 (a missing position as the head spot), sx/sy are
      clamped to [-1, 1] and the speed to SHOT_CAP. Within a step the cue ball's contacts come out in the
      order they happened (also a cushion before its first ball), and pots of one substep likewise. */
  function Sim(balls, shot, opts) {
    const ids = [], X = [], Y = [], VX = [], VY = [], RX = [], RY = [], S = [], ON = [], MOV = [];
    let cue = -1;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b[0] === 0) cue = i;
      ids.push(b[0]); X.push(b[1]); Y.push(b[2]);
      VX.push(0); VY.push(0); RX.push(0); RY.push(0); S.push(0); ON.push(true); MOV.push(false);
    }
    if (shot) {
      if (cue < 0) {
        cue = 0;
        ids.unshift(0); X.unshift(0); Y.unshift(0);
        VX.unshift(0); VY.unshift(0); RX.unshift(0); RY.unshift(0); S.unshift(0); ON.unshift(true); MOV.unshift(false);
      }
      // sanitise: non-finite numbers -> 0 (position -> head spot), spin to [-1, 1], speed to SHOT_CAP
      let vx = fin(shot.vx, 0), vy = fin(shot.vy, 0);
      if (vx > SHOT_CAP) vx = SHOT_CAP; else if (vx < -SHOT_CAP) vx = -SHOT_CAP;
      if (vy > SHOT_CAP) vy = SHOT_CAP; else if (vy < -SHOT_CAP) vy = -SHOT_CAP;
      const v2 = vx * vx + vy * vy;
      if (v2 > SHOT_CAP * SHOT_CAP) { const f = SHOT_CAP / Math.sqrt(v2); vx = vx * f; vy = vy * f; }
      let sx = fin(shot.sx, 0), sy = fin(shot.sy, 0);
      if (sx > 1) sx = 1; else if (sx < -1) sx = -1;
      if (sy > 1) sy = 1; else if (sy < -1) sy = -1;
      const k = 1.25 * sy;
      X[cue] = fin(shot.x, HEAD_SPOT[0]); Y[cue] = fin(shot.y, HEAD_SPOT[1]);
      VX[cue] = vx; VY[cue] = vy; RX[cue] = vx * k; RY[cue] = vy * k;
      S[cue] = 1.1 * sx * Math.sqrt(vx * vx + vy * vy);
      MOV[cue] = vx !== 0 || vy !== 0;
    }
    this.n = ids.length;
    this.cue = cue;                      // index of the cue ball (-1 if there is none)
    this.ids = ids; this.X = X; this.Y = Y; this.VX = VX; this.VY = VY; this.RX = RX; this.RY = RY; this.S = S;
    this.ON = ON; this.MOV = MOV;
    this.steps = 0;
    this.events = [];
    this.record = opts && opts.record ? (opts.record === true ? 1 : opts.record) : 0;
    this.frames = this.record ? [] : null;
    this.done = false;
    if (!MOV.some((m) => m)) this._finish();
  }

  Sim.prototype.step = function () {
    const k = this.events.length;
    this.advance(1);
    return this.events.slice(k);
  };

  Sim.prototype.time = function () { return this.steps * DT; };

  Sim.prototype.state = function () {
    const out = [];
    for (let i = 0; i < this.n; i++) {
      out.push({ id: this.ids[i], x: this.X[i], y: this.Y[i], vx: this.VX[i], vy: this.VY[i], rx: this.RX[i], ry: this.RY[i], s: this.S[i], on: this.ON[i] });
    }
    return out;
  };

  Sim.prototype.result = function () {
    const balls = [];
    for (let i = 0; i < this.n; i++) if (this.ON[i]) balls.push([this.ids[i], this.X[i], this.Y[i]]);
    const r = { balls, events: this.events, steps: this.steps, dur: this.steps * DT };
    if (this.frames) r.frames = this.frames;
    return r;
  };

  /** Run up to maxSteps steps of DT. */
  Sim.prototype.advance = function (maxSteps) {
    if (this.done) return;
    const X = this.X, Y = this.Y, VX = this.VX, VY = this.VY, RX = this.RX, RY = this.RY, S = this.S;
    const ON = this.ON, MOV = this.MOV, ids = this.ids, ev = this.events, N = this.n;
    let steps = this.steps;
    const cue = this.cue;
    const pots = [];                     // [rewind time, event index] of the pots in this substep
    let act = [];
    for (let i = 0; i < N; i++) if (ON[i]) act.push(i);
    for (let it = 0; it < maxSteps; it++) {
      let m2 = 0;
      for (let a = 0; a < act.length; a++) {
        const i = act[a];
        if (MOV[i]) {
          const v2 = VX[i] * VX[i] + VY[i] * VY[i];
          if (v2 > m2) m2 = v2;
        }
      }
      let ns = Math.ceil(Math.sqrt(m2) * DT / SUB);
      if (ns < 1) ns = 1;
      else if (ns > 8) ns = 8;
      const h = DT / ns;
      for (let sub = 0; sub < ns; sub++) {
        // move
        for (let a = 0; a < act.length; a++) {
          const i = act[a];
          if (MOV[i]) { X[i] += VX[i] * h; Y[i] += VY[i] * h; }
        }
        // the cue ball first (the rules read its first contact, and any cushion after it, from the event
        // order): if it reached two balls in this substep it takes them in the order it reached them, and a
        // cushion it reached before its contact is taken first. When the cue ball is act[0] (always, for
        // frames), _cueFirst handles its whole row of pairs and the pair loop below starts at a = 1.
        let start = 0;
        if (cue >= 0 && MOV[cue]) {
          const whole = act[0] === cue;
          if (this._cueFirst(act, h, steps, pots, whole)) {
            const keep = [];
            for (let a = 0; a < act.length; a++) if (ON[act[a]]) keep.push(act[a]);
            act = keep;
          } else if (whole) start = 1;
        }
        // ball-ball, pairs in index order. A pass with a collision is followed by one more pass, which
        // catches balls the first one pushed into balls it had already checked (chain hits against the
        // array order) before the overlap can show.
        for (let pass = 0; pass < 2; pass++) {
          let hits = false;
          const na = act.length;
          for (let a = pass === 0 ? start : 0; a < na - 1; a++) {
            const i = act[a];
            let xi = X[i], yi = Y[i], mi = MOV[i];
            for (let b = a + 1; b < na; b++) {
              const j = act[b];
              if (!mi && !MOV[j]) continue;
              let dx = X[j] - xi;
              if (dx >= D || dx <= -D) continue;
              let dy = Y[j] - yi;
              if (dy >= D || dy <= -D) continue;
              let d2 = dx * dx + dy * dy;
              if (d2 >= D2) continue;
              let d = Math.sqrt(d2);
              let nx = 1, ny = 0;
              if (d > 0) { nx = dx / d; ny = dy / d; }
              const wx = VX[j] - VX[i], wy = VY[j] - VY[i];
              if (wx * nx + wy * ny < 0) {
                // rewind both balls to the moment of contact, collide, then replay that time
                const qa = wx * wx + wy * wy;
                const qb = dx * wx + dy * wy;
                const qc = d2 - D2;
                let t = (qb + Math.sqrt(qb * qb - qa * qc)) / qa;
                if (t > h) t = h;
                X[i] -= VX[i] * t; Y[i] -= VY[i] * t; X[j] -= VX[j] * t; Y[j] -= VY[j] * t;
                dx = X[j] - X[i]; dy = Y[j] - Y[i];
                d2 = dx * dx + dy * dy;
                d = Math.sqrt(d2);
                if (d > 0) { nx = dx / d; ny = dy / d; }
                const un = (VX[j] - VX[i]) * nx + (VY[j] - VY[i]) * ny;
                if (un < 0) {
                  const k = un * HALF_E;
                  VX[i] += k * nx; VY[i] += k * ny; VX[j] -= k * nx; VY[j] -= k * ny;
                  ev.push(['hit', ids[i], ids[j], steps, -un]);
                    hits = true;
                }
                X[i] += VX[i] * t; Y[i] += VY[i] * t; X[j] += VX[j] * t; Y[j] += VY[j] * t;
                MOV[i] = true; MOV[j] = true; mi = true;
                dx = X[j] - X[i]; dy = Y[j] - Y[i];
                d2 = dx * dx + dy * dy;
              }
              if (d2 < D2) {
                // still overlapping: push apart along the line of centres
                d = Math.sqrt(d2);
                if (d > 0) {
                  const o = (D - d) * 0.5 / d;
                  X[i] -= dx * o; Y[i] -= dy * o; X[j] += dx * o; Y[j] += dy * o;
                }
              }
              xi = X[i]; yi = Y[i];
            }
          }
          if (!hits) break;
        }
        // cushions, jaws, pockets (only for balls near a rail line)
        for (let a = 0; a < act.length; a++) {
          const i = act[a];
          if (!MOV[i]) continue;
          const x = X[i], y = Y[i];
          if (x > R && x < XHI && y > R && y < YHI) continue;
          const pt = this._cushion(i, h, steps);
          if (pt >= 0) pots.push(pt, ev.length - 1);
        }
        if (pots.length > 0) {
          if (pots.length > 2) orderPots(ev, pots);
          pots.length = 0;
          const keep = [];
          for (let a = 0; a < act.length; a++) if (ON[act[a]]) keep.push(act[a]);
          act = keep;
        }
      }
      // friction, once per step
      let moving = false;
      for (let a = 0; a < act.length; a++) {
        const i = act[a];
        if (!MOV[i]) continue;
        let vx = VX[i], vy = VY[i], rx = RX[i], ry = RY[i];
        const ux = vx - rx, uy = vy - ry;
        const u2 = ux * ux + uy * uy;
        if (u2 > SLIP_EPS2) {
          const u = Math.sqrt(u2);
          if (u <= SLIDE_DU) {
            vx = vx - ux * TWO7; vy = vy - uy * TWO7;
            rx = vx; ry = vy;
          } else {
            let f = SLIDE_A / u;
            vx = vx - ux * f; vy = vy - uy * f;
            f = f * 2.5;
            rx = rx + ux * f; ry = ry + uy * f;
            vx = vx - vx * DRAG_DT; vy = vy - vy * DRAG_DT;
          }
        } else {
          const sp = Math.sqrt(vx * vx + vy * vy);
          const dec = ROLL_DEC + DRAG_DT * sp;
          if (sp <= dec) { vx = 0; vy = 0; } else {
            const f = (sp - dec) / sp;
            vx = vx * f; vy = vy * f;
          }
          rx = vx; ry = vy;
        }
        let s = S[i];
        if (s > SPIN_DEC) s = s - SPIN_DEC;
        else if (s < -SPIN_DEC) s = s + SPIN_DEC;
        else s = 0;
        if (vx === 0 && vy === 0 && rx === 0 && ry === 0) { MOV[i] = false; s = 0; } else moving = true;
        VX[i] = vx; VY[i] = vy; RX[i] = rx; RY[i] = ry; S[i] = s;
      }
      steps += 1;
      if (this.record && steps % this.record === 0) {
        const f = [];
        for (let i = 0; i < N; i++) { f.push(X[i]); f.push(Y[i]); }
        this.frames.push(f);
      }
      if (!moving || steps >= MAX_STEPS) {
        this.steps = steps;
        this._finish();
        return;
      }
    }
    this.steps = steps;
  };

  /** The cue ball's contacts with the balls it overlaps and approaches after this substep's move:
      [index, rewind time, ...]; the balls it overlaps without approaching go to ov (if ov is an array). */
  Sim.prototype._cueContacts = function (act, h, ov) {
    const X = this.X, Y = this.Y, VX = this.VX, VY = this.VY, c = this.cue;
    const xc = X[c], yc = Y[c], vxc = VX[c], vyc = VY[c];
    const out = [];
    for (let a = 0; a < act.length; a++) {
      const j = act[a];
      const dx = X[j] - xc;
      if (dx >= D || dx <= -D) continue;
      const dy = Y[j] - yc;
      if (dy >= D || dy <= -D) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= D2 || j === c) continue;
      const wx = VX[j] - vxc, wy = VY[j] - vyc;
      const qb = dx * wx + dy * wy;
      if (d2 > 0 ? qb < 0 : wx < 0) {
        const qa = wx * wx + wy * wy;
        let t = (qb + Math.sqrt(qb * qb - qa * (d2 - D2))) / qa;
        if (t > h) t = h;
        out.push(j, t);
      } else if (ov) ov.push(j);
    }
    return out;
  };

  /** See advance: order the cue ball's contacts within a substep (whole: also handle a single contact and
      push apart the balls it overlaps, i.e. its whole row of pairs). Returns true if the cue ball dropped. */
  Sim.prototype._cueFirst = function (act, h, step, pots, whole) {
    const c = this.cue;
    let ov = whole ? [] : null;
    let cc = this._cueContacts(act, h, ov);
    if (cc.length === 0 && !whole) return false;
    const x = this.X[c], y = this.Y[c];
    if (!(x > R && x < XHI && y > R && y < YHI)) {
      let tm = -1;
      for (let k = 1; k < cc.length; k += 2) if (cc[k] > tm) tm = cc[k];
      if (cc.length > 0 && this._railT(c, h) > tm) {
        const pt = this._cushion(c, h, step);
        if (pt >= 0) { pots.push(pt, this.events.length - 1); return true; }
        ov = whole ? [] : null;
        cc = this._cueContacts(act, h, ov);
      }
    }
    if (cc.length < 4 && !whole) return false;
    const order = [];                    // insertion sort, stable, by rewind time descending (earliest contact first)
    for (let k = 0; k < cc.length; k += 2) {
      let b = order.length;
      while (b > 0 && cc[order[b - 1] + 1] < cc[k + 1]) b--;
      order.splice(b, 0, k);
    }
    for (let m = 0; m < order.length; m++) {
      const j = cc[order[m]];
      const i0 = c < j ? c : j, j0 = c < j ? j : c;
      this._hit(i0, j0, h, step);
    }
    if (whole) {
      const X = this.X, Y = this.Y;
      for (let m = 0; m < ov.length; m++) {
        const j = ov[m];
        const dx = X[j] - X[c], dy = Y[j] - Y[c];
        const d2 = dx * dx + dy * dy;
        if (d2 < D2) {
          const d = Math.sqrt(d2);
          if (d > 0) {
            const o = (D - d) * 0.5 / d;
            X[c] -= dx * o; Y[c] -= dy * o; X[j] += dx * o; Y[j] += dy * o;
          }
        }
      }
    }
    return false;
  };

  /** Balls i < j, if they overlap: when they approach, rewind both to the moment of contact, collide and
      replay that time; then push them apart if they still overlap (the same steps as the main ball-ball pass). */
  Sim.prototype._hit = function (i, j, h, step) {
    const X = this.X, Y = this.Y, VX = this.VX, VY = this.VY;
    let dx = X[j] - X[i], dy = Y[j] - Y[i];
    let d2 = dx * dx + dy * dy;
    if (d2 >= D2) return;
    const wx = VX[j] - VX[i], wy = VY[j] - VY[i];
    const qb = dx * wx + dy * wy;
    if (d2 > 0 ? qb < 0 : wx < 0) {
      const qa = wx * wx + wy * wy;
      let t = (qb + Math.sqrt(qb * qb - qa * (d2 - D2))) / qa;
      if (t > h) t = h;
      X[i] -= VX[i] * t; Y[i] -= VY[i] * t; X[j] -= VX[j] * t; Y[j] -= VY[j] * t;
      dx = X[j] - X[i]; dy = Y[j] - Y[i];
      d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2);
      let nx = 1, ny = 0;
      if (d > 0) { nx = dx / d; ny = dy / d; }
      const un = (VX[j] - VX[i]) * nx + (VY[j] - VY[i]) * ny;
      if (un < 0) {
        const k = un * HALF_E;
        VX[i] += k * nx; VY[i] += k * ny; VX[j] -= k * nx; VY[j] -= k * ny;
        this.events.push(['hit', this.ids[i], this.ids[j], step, -un]);
      }
      X[i] += VX[i] * t; Y[i] += VY[i] * t; X[j] += VX[j] * t; Y[j] += VY[j] * t;
      this.MOV[i] = true; this.MOV[j] = true;
      dx = X[j] - X[i]; dy = Y[j] - Y[i];
      d2 = dx * dx + dy * dy;
    }
    if (d2 < D2) {
      const d = Math.sqrt(d2);
      if (d > 0) {
        const o = (D - d) * 0.5 / d;
        X[i] -= dx * o; Y[i] -= dy * o; X[j] += dx * o; Y[j] += dy * o;
      }
    }
  };

  /** Cushion response for ball i: inward unit normal (nx, ny), penetration pen; jaw: a pocket jaw (its
      restitution rises with speed, so soft hits die in the jaws and hard ones rattle). */
  Sim.prototype._bounce = function (i, nx, ny, pen, h, step, jaw) {
    const X = this.X, Y = this.Y, VX = this.VX, VY = this.VY;
    let vx = VX[i], vy = VY[i];
    const vn = vx * nx + vy * ny;
    if (vn >= 0) {
      X[i] += nx * pen; Y[i] += ny * pen;
      return;
    }
    const sp = -vn;
    let e;
    if (jaw) {
      e = JAW_E0 + JAW_EK * sp;
      if (e > JAW_EMAX) e = JAW_EMAX;
    } else {
      e = E_CUSH - E_CUSH_DROP * sp;
      if (e < E_CUSH_MIN) e = E_CUSH_MIN;
    }
    let t = pen / sp;
    if (t > h) t = h;
    X[i] -= vx * t; Y[i] -= vy * t;
    const tx = -ny, ty = nx;
    const vt = (vx * tx + vy * ty) * CUSH_T - CUSH_K * this.S[i];
    const vn2 = e * sp;
    vx = vn2 * nx + vt * tx; vy = vn2 * ny + vt * ty;
    const rn = this.RX[i] * nx + this.RY[i] * ny;
    this.RX[i] -= rn * nx; this.RY[i] -= rn * ny;
    this.S[i] = this.S[i] * CUSH_SPIN;
    VX[i] = vx; VY[i] = vy;
    X[i] += vx * t; Y[i] += vy * t;
    this.events.push(['rail', this.ids[i], step, sp]);
  };

  Sim.prototype._pot = function (i, p, step) {
    this.ON[i] = false; this.MOV[i] = false;
    this.VX[i] = 0; this.VY[i] = 0; this.RX[i] = 0; this.RY[i] = 0; this.S[i] = 0;
    this.events.push(['pot', this.ids[i], p, step]);
  };

  /** How long ago (within this substep of length h) ball i first touched a rail or jaw it is now pressing
      into while still moving into it; -1 if none. Mirrors the tests in _cushion without changing anything. */
  Sim.prototype._railT = function (i, h) {
    const x = this.X[i], y = this.Y[i], vx = this.VX[i], vy = this.VY[i];
    let best = -1;
    if ((x >= CA && x <= RAIL_X1) || (x >= RAIL_X2 && x <= RAIL_XE)) {
      if (y < R) { if (vy < 0) { let t = (R - y) / -vy; if (t > h) t = h; if (t > best) best = t; } }
      else if (y > YHI) { if (vy > 0) { let t = (y - YHI) / vy; if (t > h) t = h; if (t > best) best = t; } }
    }
    if (y >= CA && y <= RAIL_YE) {
      if (x < R) { if (vx < 0) { let t = (R - x) / -vx; if (t > h) t = h; if (t > best) best = t; } }
      else if (x > XHI) { if (vx > 0) { let t = (x - XHI) / vx; if (t > h) t = h; if (t > best) best = t; } }
    }
    const p = pocketZone(x, y);
    if (p >= 0) {
      for (let q = 2 * p; q < 2 * p + 2; q++) {
        let u = ((x - JX[q]) * JDX[q] + (y - JY[q]) * JDY[q]) / JL2[q];
        if (u < 0) u = 0; else if (u > 1) u = 1;
        const ex = x - (JX[q] + JDX[q] * u), ey = y - (JY[q] + JDY[q] * u);
        const e2 = ex * ex + ey * ey;
        if (e2 < R2) {
          const e = Math.sqrt(e2);
          let nx = JNX[q], ny = JNY[q];
          if (e > 0) { nx = ex / e; ny = ey / e; }
          const vn = vx * nx + vy * ny;
          if (vn < 0) { let t = (R - e) / -vn; if (t > h) t = h; if (t > best) best = t; }
        }
      }
    }
    return best;
  };

  /** Rails, jaws and pockets for a ball near a rail line. Returns -1, or (if it was pocketed) how long ago
      in this substep its centre crossed into the capture circle (used to order pots of the same substep). */
  Sim.prototype._cushion = function (i, h, step) {
    const X = this.X, Y = this.Y;
    let x = X[i], y = Y[i];
    if (y < R) {
      if ((x >= CA && x <= RAIL_X1) || (x >= RAIL_X2 && x <= RAIL_XE)) this._bounce(i, 0, 1, R - y, h, step);
    } else if (y > YHI) {
      if ((x >= CA && x <= RAIL_X1) || (x >= RAIL_X2 && x <= RAIL_XE)) this._bounce(i, 0, -1, y - YHI, h, step);
    }
    x = X[i]; y = Y[i];
    if (x < R) {
      if (y >= CA && y <= RAIL_YE) this._bounce(i, 1, 0, R - x, h, step);
    } else if (x > XHI) {
      if (y >= CA && y <= RAIL_YE) this._bounce(i, -1, 0, x - XHI, h, step);
    }
    x = X[i]; y = Y[i];
    const p = pocketZone(x, y);
    if (p >= 0) {
      for (let q = 2 * p; q < 2 * p + 2; q++) {
        let t = ((x - JX[q]) * JDX[q] + (y - JY[q]) * JDY[q]) / JL2[q];
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const ex = x - (JX[q] + JDX[q] * t), ey = y - (JY[q] + JDY[q] * t);
        const e2 = ex * ex + ey * ey;
        if (e2 < R2) {
          const e = Math.sqrt(e2);
          let nx = JNX[q], ny = JNY[q];
          if (e > 0) { nx = ex / e; ny = ey / e; }
          this._bounce(i, nx, ny, R - e, h, step, true);
          x = X[i]; y = Y[i];
        }
      }
      const cx = x - PX[p], cy = y - PY[p];
      const c2 = cx * cx + cy * cy;
      if (c2 < PR2[p]) {
        const vx = this.VX[i], vy = this.VY[i];
        const v2 = vx * vx + vy * vy;
        let t = 0;
        if (v2 > 0) { t = (PR[p] - Math.sqrt(c2)) / Math.sqrt(v2); if (t > h) t = h; }
        this._pot(i, p, step);
        return t;
      }
    }
    if (x < -OB || x > W + OB || y < -OB || y > H + OB || (p < 0 && (x < 0 || x > W || y < 0 || y > H))) {
      this._pot(i, nearestPocket(x, y), step);
      return 0;
    }
    return -1;
  };

  /** Everything stopped: zero the motion and separate any balls left overlapping. */
  Sim.prototype._finish = function () {
    const X = this.X, Y = this.Y, ON = this.ON, N = this.n;
    for (let i = 0; i < N; i++) {
      this.VX[i] = 0; this.VY[i] = 0; this.RX[i] = 0; this.RY[i] = 0; this.S[i] = 0; this.MOV[i] = false;
    }
    for (let pass = 0; pass < 12; pass++) {
      let moved = false;
      for (let i = 0; i < N - 1; i++) {
        if (!ON[i]) continue;
        for (let j = i + 1; j < N; j++) {
          if (!ON[j]) continue;
          const dx = X[j] - X[i], dy = Y[j] - Y[i];
          const d2 = dx * dx + dy * dy;
          if (d2 < SEP2) {
            const d = Math.sqrt(d2);
            let nx = 1, ny = 0;
            if (d > 0) { nx = dx / d; ny = dy / d; }
            const o = (D - d) * 0.5;
            X[i] -= nx * o; Y[i] -= ny * o; X[j] += nx * o; Y[j] += ny * o;
            moved = true;
          }
        }
      }
      for (let i = 0; i < N; i++) {
        if (!ON[i]) continue;
        const x = X[i], y = Y[i];
        if ((x >= CA && x <= RAIL_X1) || (x >= RAIL_X2 && x <= RAIL_XE)) {
          if (y < R) { Y[i] = R; moved = true; } else if (y > YHI) { Y[i] = YHI; moved = true; }
        }
        if (y >= CA && y <= RAIL_YE) {
          if (x < R) { X[i] = R; moved = true; } else if (x > XHI) { X[i] = XHI; moved = true; }
        }
      }
      if (!moved) break;
    }
    this.done = true;
  };

  /** The pocket whose jaws a ball at (x, y) may touch, or -1. */
  function pocketZone(x, y) {
    if (x < CZ) {
      if (y < CZ) return 0;
      if (y > H - CZ) return 5;
    } else if (x > W - CZ) {
      if (y < CZ) return 2;
      if (y > H - CZ) return 3;
    } else if (x > W / 2 - SZ && x < W / 2 + SZ) {
      if (y < R) return 1;
      if (y > YHI) return 4;
    }
    return -1;
  }

  /** Several balls dropped in one substep: reorder their pot events (in place, in the same event slots)
      so the ball that crossed into its pocket first comes first. pots: [rewind, eventIndex, ...]. */
  function orderPots(ev, pots) {
    const n = pots.length / 2;
    const order = [];                    // insertion sort, stable, by rewind time descending
    for (let a = 0; a < n; a++) {
      let b = order.length;
      while (b > 0 && pots[2 * order[b - 1]] < pots[2 * a]) b--;
      order.splice(b, 0, a);
    }
    const evs = [];
    for (let a = 0; a < n; a++) evs.push(ev[pots[2 * order[a] + 1]]);
    for (let a = 0; a < n; a++) ev[pots[2 * a + 1]] = evs[a];
  }

  function fin(v, dflt) { return typeof v === 'number' && isFinite(v) ? v : dflt; }

  // deterministic sin/cos (only + - * / and floor, identical in pool_core.py): Cody-Waite reduction to
  // [-pi/4, pi/4] and Taylor series to x^17 / x^16 (error below 1e-16 there)
  const TWO_PI_HI = 6.283185307179586, TWO_PI_LO = 2.4492935982947064e-16;
  const HALF_PI_HI = 1.5707963267948966, HALF_PI_LO = 6.123233995736766e-17;
  const S3 = -1 / 6, S5 = 1 / 120, S7 = -1 / 5040, S9 = 1 / 362880, S11 = -1 / 39916800, S13 = 1 / 6227020800,
    S15 = -1 / 1307674368000, S17 = 1 / 355687428096000;
  const C4 = 1 / 24, C6 = -1 / 720, C8 = 1 / 40320, C10 = -1 / 3628800, C12 = 1 / 479001600,
    C14 = -1 / 87178291200, C16 = 1 / 20922789888000;
  function sincos(a) {
    if (!(a >= -1e9 && a <= 1e9)) a = 0;   // aim angles are radians; junk beyond this would not reduce accurately
    const k = Math.floor(a / TWO_PI_HI + 0.5);
    let r = (a - k * TWO_PI_HI) - k * TWO_PI_LO;
    const q = Math.floor(r / HALF_PI_HI + 0.5);
    r = (r - q * HALF_PI_HI) - q * HALF_PI_LO;
    const z = r * r;
    const s = r + r * z * (S3 + z * (S5 + z * (S7 + z * (S9 + z * (S11 + z * (S13 + z * (S15 + z * S17)))))));
    const c = 1 - 0.5 * z + z * z * (C4 + z * (C6 + z * (C8 + z * (C10 + z * (C12 + z * (C14 + z * C16))))));
    if (q === 0) return [s, c];
    if (q === 1) return [c, -s];
    if (q === -1) return [-c, s];
    return [-s, -c];
  }

  function nearestPocket(x, y) {
    let best = 0, bd = -1;
    for (let p = 0; p < 6; p++) {
      const dx = x - PX[p], dy = y - PY[p];
      const d2 = dx * dx + dy * dy;
      if (bd < 0 || d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }

  /** Simulate a whole shot. Returns {balls: [[id, x, y]...] still on the table, events, steps, dur}
      (+ frames: [[x0, y0, x1, y1, ...] every `record` steps] if opts.record). Events:
      ['hit', a, b, step, speed], ['rail', id, step, speed], ['pot', id, pocketIndex, step]. */
  function simulate(balls, shot, opts) {
    const sim = new Sim(balls, shot, opts);
    sim.advance(MAX_STEPS + 1);
    return sim.result();
  }

  // ------------------------------------------------------------------ rules
  function groupOf(id) {
    if (id >= 1 && id <= 7) return 'solids';
    if (id >= 9 && id <= 15) return 'stripes';
    return null;
  }

  function cloneFrame(F) {
    return {
      mode: F.mode, balls: F.balls.map((b) => [b[0], b[1], b[2]]), turn: F.turn, breaker: F.breaker,
      isBreak: F.isBreak, open: F.open, groups: [F.groups[0], F.groups[1]], inHand: F.inHand, kitchen: F.kitchen,
      over: F.over, winner: F.winner, reason: F.reason, shots: F.shots,
      visit: { seat: F.visit.seat, potted: F.visit.potted.slice(), start: visitStart(F) },
    };
  }

  /** visit.start, or 0 when it is missing or not a finite number (older frames). */
  function visitStart(F) { return isNum(F.visit.start) ? F.visit.start : 0; }

  function sortBalls(balls) { balls.sort((a, b) => a[0] - b[0]); }

  const RACK_GAP = 1.5e-4;
  const RACK_JIT = 5e-5;

  /** A new racked frame. rand() in [0, 1) picks the rack order and a tiny jitter. */
  function newFrame(mode, breaker, rand) {
    const RS = D + RACK_GAP;
    const rowX = RS * SQRT3 / 2;
    const pos = [];
    const widths = mode === '9ball' ? [1, 2, 3, 2, 1] : [1, 2, 3, 4, 5];
    for (let k = 0; k < widths.length; k++) {
      const w = widths[k];
      for (let j = 0; j < w; j++) pos.push([FOOT_X + k * rowX, H / 2 + (2 * j - (w - 1)) * RS * 0.5]);
    }
    const at = [];
    let rest;
    if (mode === '9ball') {
      at[0] = 1; at[4] = 9;
      rest = [2, 3, 4, 5, 6, 7, 8];
    } else {
      const solid = 1 + Math.floor(rand() * 7);
      const stripe = 9 + Math.floor(rand() * 7);
      if (rand() < 0.5) { at[10] = solid; at[14] = stripe; } else { at[10] = stripe; at[14] = solid; }
      at[4] = 8;
      rest = [];
      for (let id = 1; id <= 15; id++) if (id !== 8 && id !== solid && id !== stripe) rest.push(id);
    }
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
    }
    let r = 0;
    for (let k = 0; k < pos.length; k++) if (at[k] === undefined) at[k] = rest[r++];
    const balls = [[0, HEAD_SPOT[0], HEAD_SPOT[1]]];
    for (let k = 0; k < pos.length; k++) {
      const x = pos[k][0] + (rand() - 0.5) * RACK_JIT;
      const y = pos[k][1] + (rand() - 0.5) * RACK_JIT;
      balls.push([at[k], x, y]);
    }
    sortBalls(balls);
    return {
      mode: mode === '9ball' ? '9ball' : '8ball', balls, turn: breaker, breaker, isBreak: true, open: true,
      groups: [null, null], inHand: true, kitchen: true, over: false, winner: null, reason: '', shots: 0,
      visit: { seat: breaker, potted: [], start: 0 },
    };
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** Can the cue ball be placed at (x, y)? */
  function validPlacement(F, x, y) {
    if (!isNum(x) || !isNum(y)) return false;
    if (x < R || x > XHI || y < R || y > YHI) return false;
    if (F.kitchen && x > HEAD_X) return false;
    for (const b of F.balls) {
      if (b[0] === 0) continue;
      const dx = b[1] - x, dy = b[2] - y;
      if (dx * dx + dy * dy < PLACE2) return false;
    }
    for (let p = 0; p < 6; p++) {
      const dx = x - PX[p], dy = y - PY[p];
      const rr = POCKETS[p].r + R;
      if (dx * dx + dy * dy < rr * rr) return false;
    }
    return true;
  }

  function cueOf(F) {
    for (const b of F.balls) if (b[0] === 0) return b;
    return null;
  }

  /** Build a shot: aim angle (radians, 0 = +x), power 0..1, tip offset sx (side) / sy (follow+, draw-),
      and the cue ball position (cx, cy) when the shooter has ball in hand. Speed = MAX_SPEED * power, or
      BREAK_SPEED * power on the break. */
  function makeShot(F, angle, power, sx, sy, cx, cy) {
    let p = isNum(power) ? power : 0.02;
    if (p < 0.02) p = 0.02; else if (p > 1) p = 1;
    let a = isNum(sx) ? Math.max(-1, Math.min(1, sx)) : 0;
    let b = isNum(sy) ? Math.max(-1, Math.min(1, sy)) : 0;
    const l2 = a * a + b * b;
    if (l2 > 1) { const l = Math.sqrt(l2); a = a / l; b = b / l; }
    const cue = cueOf(F);
    let x = cue ? cue[1] : HEAD_SPOT[0], y = cue ? cue[2] : HEAD_SPOT[1];
    if (F.inHand && validPlacement(F, cx, cy)) { x = cx; y = cy; }
    const sp = (F.isBreak ? BREAK_SPEED : MAX_SPEED) * p;
    const sc = sincos(isNum(angle) ? angle : 0);
    return { x, y, vx: sc[1] * sp, vy: sc[0] * sp, sx: a, sy: b };
  }

  function spotFree(balls, x, y) {
    for (const b of balls) {
      const dx = b[1] - x, dy = b[2] - y;
      if (dx * dx + dy * dy < PLACE2) return false;
    }
    return true;
  }

  /** Put ball `id` back on the foot spot, or the nearest free point toward the foot rail (then toward the head). */
  function respot(balls, id) {
    const y = H / 2;
    const st = R / 8;
    let x = FOOT_X;
    let ok = false;
    for (let k = 0; k < 400; k++) {
      x = FOOT_X + k * st;
      if (x > XHI) break;
      if (spotFree(balls, x, y)) { ok = true; break; }
    }
    if (!ok) {
      for (let k = 1; k < 800; k++) {
        x = FOOT_X - k * st;
        if (x < R) break;
        if (spotFree(balls, x, y)) { ok = true; break; }
      }
    }
    if (!ok) x = FOOT_X;
    balls.push([id, x, y]);
    sortBalls(balls);
  }

  /** Put the cue ball back (after a scratch) on the head spot or the closest valid point. */
  function placeCue(F) {
    const hx = HEAD_SPOT[0], hy = HEAD_SPOT[1];
    let x = hx, y = hy;
    if (!validPlacement(F, x, y)) {
      const st = R / 2;
      let found = false;
      for (let k = 1; k < 400 && !found; k++) {
        const o = k * st;
        const cand = [[hx - o, hy], [hx + o, hy], [hx, hy - o], [hx, hy + o]];
        for (const c of cand) {
          if (validPlacement(F, c[0], c[1])) { x = c[0]; y = c[1]; found = true; break; }
        }
      }
    }
    F.balls.push([0, x, y]);
    sortBalls(F.balls);
  }

  function groupLeft(balls, g) {
    let n = 0;
    for (const b of balls) if (groupOf(b[0]) === g) n++;
    return n;
  }

  /** Play a shot on frame F. Returns {frame, sim, result}. */
  function applyShot(F, shot) {
    const F2 = cloneFrame(F);
    if (F.over) return { frame: F2, sim: null, result: null };
    const cue = cueOf(F);
    let x = shot.x, y = shot.y;
    if (!(F.inHand && validPlacement(F, x, y)) && cue) { x = cue[1]; y = cue[2]; }
    const s = { x, y, vx: shot.vx, vy: shot.vy, sx: shot.sx, sy: shot.sy };
    const balls = [];
    for (const b of F.balls) balls.push([b[0], b[1], b[2]]);
    const sim = simulate(balls, s);
    // what happened
    let first = null, railAfter = false;
    const potted = [];
    for (const e of sim.events) {
      if (e[0] === 'hit') {
        if (first === null && (e[1] === 0 || e[2] === 0)) first = e[1] === 0 ? e[2] : e[1];
      } else if (e[0] === 'rail') {
        if (first !== null) railAfter = true;
      } else if (e[0] === 'pot') potted.push(e[1]);
    }
    const obj = potted.filter((id) => id !== 0);
    const scratch = potted.indexOf(0) >= 0;
    const me = F.turn, op = 1 - F.turn;
    F2.balls = sim.balls.map((b) => [b[0], b[1], b[2]]);
    F2.shots = F.shots + 1;
    let foul = false, reason = null, assigned = null, again = false, over = false, winner = null, win = null, runout = false;
    if (F.mode === '9ball') {
      let lowest = null;
      for (const b of F.balls) if (b[0] !== 0 && (lowest === null || b[0] < lowest)) lowest = b[0];
      if (scratch) reason = 'scratch';
      else if (first === null) reason = 'nohit';
      else if (first !== lowest) reason = 'wrong';
      else if (!F.isBreak && obj.length === 0 && !railAfter) reason = 'norail';
      foul = reason !== null;
      const nine = obj.indexOf(9) >= 0;
      if (nine && !foul) { over = true; winner = me; win = 'nine'; } else {
        if (nine) respot(F2.balls, 9);
        again = !foul && obj.length > 0;
      }
    } else if (F.isBreak) {
      if (scratch) reason = 'scratch';
      else if (first === null) reason = 'nohit';
      foul = reason !== null;
      if (obj.indexOf(8) >= 0) respot(F2.balls, 8);
      again = !foul && obj.length > 0;
      F2.open = true;
    } else {
      const g = F.groups[me];
      // on the 8: your group is all down (or, on an open table, every group ball is down)
      const on8 = F.open ? groupLeft(F.balls, 'solids') + groupLeft(F.balls, 'stripes') === 0
        : g !== null && groupLeft(F.balls, g) === 0;
      if (scratch) reason = 'scratch';
      else if (first === null) reason = 'nohit';
      else if (on8 ? first !== 8 : (F.open ? first === 8 : groupOf(first) !== g)) reason = 'wrong';
      else if (obj.length === 0 && !railAfter) reason = 'norail';
      foul = reason !== null;
      if (obj.indexOf(8) >= 0) {
        over = true;
        if (on8 && !foul) { winner = me; win = 'eight'; } else { winner = op; win = foul ? (scratch ? 'scratch8' : 'foul8') : 'early8'; }
      } else {
        if (F.open && !foul) {
          for (const id of obj) {
            const gg = groupOf(id);
            if (gg !== null) { assigned = gg; break; }
          }
          if (assigned !== null) {
            F2.open = false;
            F2.groups[me] = assigned;
            F2.groups[op] = assigned === 'solids' ? 'stripes' : 'solids';
          }
        }
        const g2 = F2.groups[me];
        if (!foul && g2 !== null) for (const id of obj) if (groupOf(id) === g2) again = true;
      }
    }
    F2.isBreak = false;
    const vp = F.visit.seat === me ? F.visit.potted.concat(obj) : obj.slice();
    const vstart = F.visit.seat === me ? visitStart(F) : F.shots;
    if (over) {
      F2.over = true; F2.winner = winner; F2.reason = win; F2.inHand = false; F2.kitchen = false;
      F2.visit = { seat: me, potted: vp, start: vstart };
      if (winner === me) {
        if (win === 'nine') runout = vstart === 0;       // the visit began with the break shot
        else {
          const g = F2.groups[me];
          runout = g !== null && vp.indexOf(8) >= 0;
          for (let id = 1; id <= 15; id++) if (groupOf(id) === g && vp.indexOf(id) < 0) runout = false;
        }
      }
      if (scratch && !cueOf(F2)) placeCue(F2);
    } else {
      if (foul) {
        F2.turn = op; F2.inHand = true; F2.kitchen = F.mode === '8ball' && F.isBreak && scratch;
      } else {
        F2.turn = again ? me : op; F2.inHand = false; F2.kitchen = false;
      }
      if (F2.turn === me) F2.visit = { seat: me, potted: vp, start: vstart };
      else F2.visit = { seat: op, potted: [], start: F2.shots };
      if (scratch) placeCue(F2);
    }
    const result = { foul, reason, first, potted, assigned, again, over, winner, win, runout };
    return { frame: F2, sim, result };
  }

  /** The shot clock ran out: foul, the opponent gets ball in hand anywhere. On the break (the rack is still
      intact) the opponent breaks instead, so the ball in hand is in the kitchen; F.breaker is left alone. */
  function timeoutFoul(F) {
    const F2 = cloneFrame(F);
    if (F.over) return F2;
    const op = 1 - F.turn;
    F2.turn = op;
    F2.inHand = true;
    F2.kitchen = F.isBreak;
    F2.visit = { seat: op, potted: [], start: F.shots };
    return F2;
  }

  const PoolCore = {
    W, H, R, D, HEAD_X, FOOT_X, HEAD_SPOT, FOOT_SPOT, DT, MAX_SPEED, BREAK_SPEED, SHOT_CAP, MAX_T, MAX_STEPS,
    CONST: { G, MU_S, MU_R, DRAG, SIDE_DECAY, E_BALL, E_CUSH, E_CUSH_DROP, E_CUSH_MIN, CUSH_T, CUSH_K, CUSH_SPIN, SUB, RACK_GAP, RACK_JIT,
      JAW_E0, JAW_EK, JAW_EMAX },
    CORNER_MOUTH, SIDE_MOUTH, POCKETS, JAWS, CUSHIONS, SEGMENTS, DIAMONDS,
    Sim, simulate, nearestPocket, groupOf, sincos,
    newFrame, validPlacement, makeShot, applyShot, timeoutFoul, cloneFrame,
  };
  root.PoolCore = PoolCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = PoolCore;
})(typeof window !== 'undefined' ? window : globalThis);
