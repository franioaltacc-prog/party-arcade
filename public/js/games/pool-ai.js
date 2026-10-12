// Billiards CPU opponent (solo "vs CPU"). Pure, synchronous, no DOM: works in the browser (window.PoolAI)
// and in node (module.exports) on top of PoolCore (pool-core.js must be loaded first in the browser).
//
//   PoolAI.choose(frame, level, opts) -> { a, p, sx, sy, cx?, cy?, think }
//     frame: a PoolCore frame, the CPU is seat frame.turn; level 1 (Easy) | 2 (Medium) | 3 (Hard);
//     opts: { budgetMs (default 900), rand (default Math.random) }.
//   cx/cy are only given when frame.inHand (always a PoolCore.validPlacement spot). The caller plays
//   PoolCore.makeShot(frame, a, p, sx, sy, cx, cy) and then PoolCore.applyShot.
//
// How it thinks: every legal ball x pocket gives a ghost-ball pot (cuts up to ~78 deg, clear lanes, aimed
// inside the pocket opening); Hard adds one-cushion banks, kicks and combinations. Each is scored by how
// forgiving it is (the cue angle error that still pots it, against the level's aim noise). The best few
// are played out with PoolCore (a few powers and spins) and judged with applyShot: a legal pot that keeps
// the turn is good (plus the next shot's quality at Medium/Hard), fouls/scratches and losing are bad, a
// turnover costs the opponent's best chance. Medium/Hard re-check the top picks with aim errors, and play
// safe when no pot is worth it. Ball in hand tries spots behind good ghost balls. The break is a full-power
// hit on the apex ball. Finally the level's noise is added (Easy ~2 deg, Medium ~0.6, Hard ~0.15).
// Work is capped by a number of simulations per level (so the answer is deterministic for a given
// opts.rand on a fast enough machine) and always stops inside budgetMs. It never throws.
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const LEVELS = {
    1: { sigma: 2.0 * DEG, pNoise: 0.07, spinNoise: 0.08, topK: 4, jitter: 30, powerMul: [1.6, 2.3], spins: [[0, 0]],
      position: false, safety: 0, banks: false, combos: 0, robust: 0, simCap: 24, places: 3,
      placeAngles: [0], breakOpts: 1, cutMax: 58 * DEG },
    2: { sigma: 0.6 * DEG, pNoise: 0.03, spinNoise: 0.04, topK: 8, jitter: 0, powerMul: [1.0, 1.4, 2.0],
      spins: [[0, 0], [0, 0.45], [0, -0.45]], position: true, safety: 1, banks: false, combos: 1, robust: 2, simCap: 150,
      places: 6, placeAngles: [0, 22 * DEG, -22 * DEG], breakOpts: 3, cutMax: 76 * DEG },
    3: { sigma: 0.15 * DEG, pNoise: 0.012, spinNoise: 0.02, topK: 18, jitter: 0, powerMul: [0.9, 1.3, 1.9],
      spins: [[0, 0], [0, 0.5], [0, -0.55], [0.4, 0.15], [-0.4, 0.15]], position: true, safety: 2, banks: true, combos: 2,
      robust: 4, simCap: 360, places: 10, placeAngles: [0, 18 * DEG, -18 * DEG, 34 * DEG, -34 * DEG], breakOpts: 5, cutMax: 78 * DEG },
  };
  const V_WIN = 1000, V_FOUL = -130, V_MISS = -45;
  const POCKET_NAMES = ['top-left corner', 'top side', 'top-right corner', 'bottom-right corner', 'bottom side', 'bottom-left corner'];

  function core() {
    if (root.PoolCore) return root.PoolCore;
    try { if (typeof require === 'function') return require('./pool-core.js'); } catch (e) { /* no core */ }
    return null;
  }
  function now() {
    return typeof performance !== 'undefined' && performance && typeof performance.now === 'function' ? performance.now() : Date.now();
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // ------------------------------------------------------------------ geometry helpers
  let G = null;                          // cached table data from PoolCore
  function geom(PC) {
    if (G && G.PC === PC) return G;
    const pockets = PC.POCKETS.map((p) => ({
      tips: [[p.mouth[0][0], p.mouth[0][1]], [p.mouth[1][0], p.mouth[1][1]]],
      axis: [p.axis[0], p.axis[1]], corner: p.corner, x: p.x, y: p.y,
    }));
    const R = PC.R;
    // rails as lines for ball centres: [coordinate index (0 x / 1 y), value, valid ranges along the rail]
    const CA = PC.CORNER_MOUTH / Math.SQRT2, SH = PC.SIDE_MOUTH / 2, M = 2.5 * R;
    const rails = [
      { c: 1, v: R, ranges: [[CA + M, PC.W / 2 - SH - M], [PC.W / 2 + SH + M, PC.W - CA - M]] },
      { c: 1, v: PC.H - R, ranges: [[CA + M, PC.W / 2 - SH - M], [PC.W / 2 + SH + M, PC.W - CA - M]] },
      { c: 0, v: R, ranges: [[CA + M, PC.H - CA - M]] },
      { c: 0, v: PC.W - R, ranges: [[CA + M, PC.H - CA - M]] },
    ];
    const C = PC.CONST || {};
    G = { PC, pockets, rails, R, D: PC.D, W: PC.W, H: PC.H, A: (C.MU_R || 0.024) * (C.G || 9.81), K: C.DRAG || 0.13 };
    return G;
  }

  /** Is the straight path of a ball centre from (ax, ay) to (bx, by) clear of every ball but the skipped ids? */
  function laneClear(objs, ax, ay, bx, by, skip1, skip2, rad) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const r2 = rad * rad;
    for (let i = 0; i < objs.length; i++) {
      const b = objs[i];
      if (b[0] === skip1 || b[0] === skip2) continue;
      let t = l2 > 0 ? ((b[1] - ax) * dx + (b[2] - ay) * dy) / l2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const ex = ax + dx * t - b[1], ey = ay + dy * t - b[2];
      if (ex * ex + ey * ey < r2) return false;
    }
    return true;
  }

  /** Aim a ball at (ox, oy) through a pocket mouth (two tips): the aim point, the half width of the gap the
      centre can pass through, and the matching angular tolerance at the ball. null if the mouth is shut. */
  function pocketAim(g, ox, oy, tips, axis, corner) {
    const R = g.R;
    let mx = (tips[0][0] + tips[1][0]) / 2, my = (tips[0][1] + tips[1][1]) / 2;
    let ux = mx - ox, uy = my - oy;
    let dist = Math.sqrt(ux * ux + uy * uy);
    if (dist < 1e-6) return null;
    ux /= dist; uy /= dist;
    const facing = ux * axis[0] + uy * axis[1];
    if (facing < (corner ? 0.2 : 0.45)) return null;
    const nx = -uy, ny = ux;
    const s1 = (tips[0][0] - ox) * nx + (tips[0][1] - oy) * ny;
    const s2 = (tips[1][0] - ox) * nx + (tips[1][1] - oy) * ny;
    const lo = Math.min(s1, s2) + 0.8 * R, hi = Math.max(s1, s2) - 0.8 * R;
    if (hi - lo < 0.15 * R) return null;
    const s = (lo + hi) / 2;
    const f = (mx - ox) * ux + (my - oy) * uy + R;
    const tx = ox + ux * f + nx * s, ty = oy + uy * f + ny * s;
    const d = Math.sqrt((tx - ox) * (tx - ox) + (ty - oy) * (ty - oy));
    return { tx, ty, d, tol: ((hi - lo) / 2) / d };
  }

  /** A ball close to a pocket's hole (in or near the jaws): {pk, ux, uy} pointing from it to the hole. */
  function hanging(g, O) {
    let best = null;
    for (let pk = 0; pk < 6; pk++) {
      const P = g.pockets[pk];
      const dx = P.x - O[1], dy = P.y - O[2];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 4.2 * g.R && d > 1e-9 && (!best || d < best.d)) best = { pk, ux: dx / d, uy: dy / d, d };
    }
    return best;
  }

  function inTable(g, x, y) { return x >= g.R && x <= g.W - g.R && y >= g.R && y <= g.H - g.R; }

  // rolling distance from speed v with constant deceleration A plus drag K*v
  function sDist(g, v) { return v / g.K - (g.A / (g.K * g.K)) * Math.log(1 + g.K * v / g.A); }
  function speedFor(g, d, vEnd) {
    const target = d + sDist(g, vEnd);
    let lo = 0, hi = 14;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (sDist(g, mid) < target) lo = mid; else hi = mid;
    }
    return hi;
  }
  /** A cue speed (m/s) that sends the object ball d2 further with some pace left, after a cut cosCut. */
  function needSpeed(g, d1, d2, cosCut, extra) {
    const vObj = speedFor(g, d2, 0.4) * (extra || 1);
    const vC = vObj / (0.975 * Math.max(cosCut, 0.25));
    return speedFor(g, d1, vC) * 1.1;
  }

  function erf(x) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  /** Chance to get the cue angle within +-tol with gaussian aim error sigma. */
  function pHit(tol, sigma) { return erf(tol / (sigma * Math.SQRT2)); }

  function mirror(rail, x, y, k) {
    if (rail.c === 0) return [rail.v - (x - rail.v) * k, y];
    return [x, rail.v - (y - rail.v) * k];
  }
  /** Where the line from (ax, ay) to the mirrored point (bx, by) crosses the rail line, if on the cushion. */
  function railHit(rail, ax, ay, bx, by) {
    const qa = rail.c === 0 ? ax : ay, qb = rail.c === 0 ? bx : by;
    if ((qa - rail.v) * (qb - rail.v) >= 0) return null;
    const t = (rail.v - qa) / (qb - qa);
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    const along = rail.c === 0 ? y : x;
    for (const r of rail.ranges) if (along >= r[0] && along <= r[1]) return [x, y];
    return null;
  }

  // ------------------------------------------------------------------ rules helpers
  function groupOf(id) {
    if (id >= 1 && id <= 7) return 'solids';
    if (id >= 9 && id <= 15) return 'stripes';
    return null;
  }
  /** Ball ids the shooter of F may hit first. */
  function legalTargets(F) {
    const objs = F.balls.filter((b) => b[0] !== 0);
    if (!objs.length) return [];
    if (F.mode === '9ball') {
      let lo = objs[0][0];
      for (const b of objs) if (b[0] < lo) lo = b[0];
      return [lo];
    }
    if (F.isBreak) return objs.map((b) => b[0]);
    const me = F.turn === 1 ? 1 : 0;
    const g = F.groups ? F.groups[me] : null;
    const left = (gg) => objs.filter((b) => groupOf(b[0]) === gg).length;
    const on8 = F.open ? left('solids') + left('stripes') === 0 : g !== null && left(g) === 0;
    if (on8) return objs.filter((b) => b[0] === 8).map((b) => b[0]);
    if (F.open || g === null) return objs.filter((b) => b[0] !== 8).map((b) => b[0]);
    return objs.filter((b) => groupOf(b[0]) === g).map((b) => b[0]);
  }
  function cueOf(F) {
    for (const b of F.balls) if (b[0] === 0) return b;
    return null;
  }
  function ballById(objs, id) {
    for (const b of objs) if (b[0] === id) return b;
    return null;
  }

  // ------------------------------------------------------------------ shot candidates (geometry only)
  /** Pot candidates for a cue ball at (cx, cy): direct pots, plus combos / banks / kicks when asked.
      Each: {kind, id, pk, a, tol, d1, d2, cosCut, v (cue speed m/s), via}. */
  function potCands(g, objs, targets, cx, cy, L, more) {
    const out = [];
    const D = g.D, R = g.R;
    const rad = D - 1e-4;
    const cosMax = Math.cos(L.cutMax);
    const pk6 = g.pockets;
    const lines = [];                   // clear object-ball lines to a pocket, reused for kicks
    for (const id of targets) {
      const O = ballById(objs, id);
      if (!O) continue;
      const hang = hanging(g, O);
      if (hang) {
        // a ball sitting in the jaws: just roll the cue ball through its centre toward the hole
        const vx = O[1] - cx, vy = O[2] - cy;
        const d1 = Math.sqrt(vx * vx + vy * vy);
        if (d1 > 1e-6 && (vx * hang.ux + vy * hang.uy) / d1 > 0.75 && laneClear(objs, cx, cy, O[1], O[2], id, 0, rad)) {
          out.push({ kind: 'pot', id, pk: hang.pk, a: Math.atan2(vy, vx), tol: Math.min(0.2, 0.6 * R / d1), d1, d2: 0.1, cosCut: 1,
            v: needSpeed(g, d1, 0.15, 1) });
        }
      }
      for (let pk = 0; pk < 6; pk++) {
        const P = pk6[pk];
        const aim = pocketAim(g, O[1], O[2], P.tips, P.axis, P.corner);
        if (!aim) continue;
        if (!laneClear(objs, O[1], O[2], aim.tx, aim.ty, id, 0, rad)) continue;
        const ux = (aim.tx - O[1]) / aim.d, uy = (aim.ty - O[2]) / aim.d;
        const gx = O[1] - ux * D, gy = O[2] - uy * D;
        if (!inTable(g, gx, gy)) continue;
        lines.push({ id, pk, aim, ux, uy, gx, gy });
        const vx = gx - cx, vy = gy - cy;
        const d1 = Math.sqrt(vx * vx + vy * vy);
        if (d1 < 1e-6) continue;
        const cosCut = (vx * ux + vy * uy) / d1;
        if (cosCut < cosMax) continue;
        if (!laneClear(objs, cx, cy, gx, gy, id, 0, rad)) continue;
        const tol = Math.min(0.2, aim.tol * D * cosCut / d1);
        out.push({ kind: 'pot', id, pk, a: Math.atan2(vy, vx), tol, d1, d2: aim.d, cosCut, v: needSpeed(g, d1, aim.d, cosCut) });
      }
    }
    if (!more) return out;
    // combinations (9-ball): the lowest ball into another ball that drops (Medium: only the 9)
    if (L.combos && targets.length === 1) {
      const Lb = ballById(objs, targets[0]);
      for (const X of objs) {
        if (!Lb || X[0] === Lb[0] || (L.combos < 2 && X[0] !== 9)) continue;
        for (let pk = 0; pk < 6; pk++) {
          const P = pk6[pk];
          const aim = pocketAim(g, X[1], X[2], P.tips, P.axis, P.corner);
          if (!aim || !laneClear(objs, X[1], X[2], aim.tx, aim.ty, X[0], Lb[0], rad)) continue;
          const ux = (aim.tx - X[1]) / aim.d, uy = (aim.ty - X[2]) / aim.d;
          const gxX = X[1] - ux * D, gyX = X[2] - uy * D;
          const wx = gxX - Lb[1], wy = gyX - Lb[2];
          const d2 = Math.sqrt(wx * wx + wy * wy);
          if (d2 < 1e-6 || d2 > 0.9) continue;
          const wux = wx / d2, wuy = wy / d2;
          const cos2 = wux * ux + wuy * uy;
          if (cos2 < Math.cos(55 * DEG)) continue;
          if (!laneClear(objs, Lb[1], Lb[2], gxX, gyX, Lb[0], X[0], rad)) continue;
          const gx = Lb[1] - wux * D, gy = Lb[2] - wuy * D;
          if (!inTable(g, gx, gy)) continue;
          const vx = gx - cx, vy = gy - cy;
          const d1 = Math.sqrt(vx * vx + vy * vy);
          if (d1 < 1e-6) continue;
          const cos1 = (vx * wux + vy * wuy) / d1;
          if (cos1 < cosMax) continue;
          if (!laneClear(objs, cx, cy, gx, gy, Lb[0], 0, rad)) continue;
          const tol = aim.tol * (D * cos2 / d2) * (D * cos1 / d1);
          const v = needSpeed(g, d1, d2 + aim.d, cos1 * cos2);
          out.push({ kind: 'combo', id: Lb[0], via: X[0], pk, a: Math.atan2(vy, vx), tol, d1, d2: d2 + aim.d, cosCut: cos1, v });
        }
      }
    }
    if (!L.banks) return out;
    const K = 0.9;                      // a cushion keeps less normal than tangential speed: the angle comes off shallower
    // one-cushion banks of the object ball
    for (const id of targets) {
      const O = ballById(objs, id);
      if (!O) continue;
      for (let pk = 0; pk < 6; pk++) {
        const P = pk6[pk];
        for (const rail of g.rails) {
          const pc = rail.c === 0 ? P.x : P.y;
          if (Math.abs(pc - rail.v) < 0.15) continue;          // the pocket sits on this rail
          const mt = [mirror(rail, P.tips[0][0], P.tips[0][1], K), mirror(rail, P.tips[1][0], P.tips[1][1], K)];
          const max = rail.c === 0 ? [-P.axis[0], P.axis[1]] : [P.axis[0], -P.axis[1]];
          const aim = pocketAim(g, O[1], O[2], mt, max, P.corner);
          if (!aim) continue;
          const B = railHit(rail, O[1], O[2], aim.tx, aim.ty);
          if (!B) continue;
          const T = mirror(rail, aim.tx, aim.ty, 1 / K);
          if (!laneClear(objs, O[1], O[2], B[0], B[1], id, 0, rad) || !laneClear(objs, B[0], B[1], T[0], T[1], id, 0, rad)) continue;
          const dB = Math.sqrt((B[0] - O[1]) ** 2 + (B[1] - O[2]) ** 2);
          if (dB < 2 * D) continue;
          const ux = (B[0] - O[1]) / dB, uy = (B[1] - O[2]) / dB;
          const gx = O[1] - ux * D, gy = O[2] - uy * D;
          if (!inTable(g, gx, gy)) continue;
          const vx = gx - cx, vy = gy - cy;
          const d1 = Math.sqrt(vx * vx + vy * vy);
          if (d1 < 1e-6) continue;
          const cosCut = (vx * ux + vy * uy) / d1;
          if (cosCut < Math.cos(65 * DEG)) continue;
          if (!laneClear(objs, cx, cy, gx, gy, id, 0, rad)) continue;
          const d2 = dB + Math.sqrt((T[0] - B[0]) ** 2 + (T[1] - B[1]) ** 2);
          const tol = 0.5 * aim.tol * D * cosCut / d1;
          out.push({ kind: 'bank', id, pk, a: Math.atan2(vy, vx), tol, d1, d2, cosCut, v: needSpeed(g, d1, d2, cosCut, 1.25), refine: true });
        }
      }
    }
    // one-cushion kicks: the cue ball off a rail into the ghost ball
    for (const ln of lines) {
      for (const rail of g.rails) {
        const Gm = mirror(rail, ln.gx, ln.gy, K);
        const B = railHit(rail, cx, cy, Gm[0], Gm[1]);
        if (!B) continue;
        if (!laneClear(objs, cx, cy, B[0], B[1], 0, -1, rad) || !laneClear(objs, B[0], B[1], ln.gx, ln.gy, ln.id, 0, rad)) continue;
        const ix = ln.gx - B[0], iy = ln.gy - B[1];
        const dIn = Math.sqrt(ix * ix + iy * iy);
        if (dIn < 1e-6) continue;
        const cosCut = (ix * ln.ux + iy * ln.uy) / dIn;
        if (cosCut < Math.cos(60 * DEG)) continue;
        const dC = Math.sqrt((B[0] - cx) ** 2 + (B[1] - cy) ** 2);
        const d1 = dC + dIn;
        const tol = 0.4 * ln.aim.tol * D * cosCut / d1;
        out.push({ kind: 'kick', id: ln.id, pk: ln.pk, a: Math.atan2(B[1] - cy, B[0] - cx), tol, d1, d2: ln.aim.d, cosCut,
          v: needSpeed(g, d1, ln.aim.d, cosCut, 1.25), refine: true });
      }
    }
    return out;
  }

  /** The best chance (0..1) the shooter of F has with a plain pot from where the cue ball lies. */
  function bestChance(g, F, sigma, L) {
    if (F.over) return 0;
    if (F.inHand) return F.kitchen ? 0.6 : 0.92;
    const cue = cueOf(F);
    if (!cue) return 0.5;
    const objs = F.balls.filter((b) => b[0] !== 0);
    const c = potCands(g, objs, legalTargets(F), cue[1], cue[2], L, false);
    let best = 0;
    for (const k of c) {
      const p = pHit(k.tol, sigma);
      if (p > best) best = p;
    }
    return best;
  }

  // ------------------------------------------------------------------ the search
  function Search(PC, F, L, budget, rand) {
    this.PC = PC; this.F = F; this.L = L; this.rand = rand;
    this.g = geom(PC);
    this.me = F.turn === 1 ? 1 : 0;
    this.t0 = now();
    this.deadline = this.t0 + budget - Math.min(45, Math.max(4, budget * 0.08));
    this.sims = 0;
    this.est = F.isBreak ? 40 : 6;     // a pessimistic guess of one simulation's cost (ms), raised as we go
    this.objs = F.balls.filter((b) => b[0] !== 0);
    this.sigmaPlan = Math.sqrt(L.sigma * L.sigma + (0.1 * DEG) * (0.1 * DEG));
    this.sigmaEval = Math.sqrt(L.sigma * L.sigma + (0.08 * DEG) * (0.08 * DEG));
  }
  Search.prototype.canSim = function () {
    return this.sims < this.L.simCap && now() + this.est * 1.25 + 1 < this.deadline;
  };
  /** Play a shot out and value it (null when out of time / simulations). */
  Search.prototype.value = function (a, p, sx, sy, cx, cy) {
    if (!this.canSim()) return null;
    const t = now();
    const PC = this.PC, F = this.F;
    const o = PC.applyShot(F, PC.makeShot(F, a, p, sx, sy, cx, cy));
    const dt = now() - t;
    this.sims++;
    if (dt > this.est) this.est = dt; else this.est = Math.max(this.est * 0.97, dt, F.isBreak ? 8 : 0.5);
    return this.judge(o);
  };
  Search.prototype.judge = function (o) {
    const r = o && o.result, F2 = o && o.frame;
    if (!r || !F2) return V_FOUL;
    const me = this.me, L = this.L;
    if (r.over) return r.winner === me ? V_WIN : -V_WIN;
    if (r.foul) return V_FOUL;
    if (F2.turn === me) {
      let own = 0;
      if (this.F.mode === '8ball') {
        const g2 = F2.groups[me];
        for (const id of r.potted) if (id !== 0 && groupOf(id) === g2) own++;
      }
      const next = L.position ? bestChance(this.g, F2, this.sigmaPlan, L) : 0.5;
      return 100 + 10 * own + 60 * next;
    }
    const opp = L.safety ? bestChance(this.g, F2, 0.4 * DEG, L) : 0.5;
    return -70 * opp;
  };

  /** Cue-ball placements for ball in hand: behind good ghost balls, plus a grid. */
  Search.prototype.placements = function (targets) {
    const PC = this.PC, F = this.F, g = this.g, L = this.L, objs = this.objs, D = g.D;
    const rad = D - 1e-4;
    const spots = [];
    for (const id of targets) {
      const O = ballById(objs, id);
      if (!O) continue;
      const hang = hanging(g, O);
      if (hang) {
        for (const k of [0.08, 0.2, 0.4]) {
          const x = O[1] - hang.ux * k, y = O[2] - hang.uy * k;
          if (PC.validPlacement(F, x, y) && laneClear(objs, x, y, O[1], O[2], id, 0, rad)) spots.push({ x, y, score: 0.9 });
        }
      }
      for (let pk = 0; pk < 6; pk++) {
        const P = g.pockets[pk];
        const aim = pocketAim(g, O[1], O[2], P.tips, P.axis, P.corner);
        if (!aim || !laneClear(objs, O[1], O[2], aim.tx, aim.ty, id, 0, rad)) continue;
        const ux = (aim.tx - O[1]) / aim.d, uy = (aim.ty - O[2]) / aim.d;
        const gx = O[1] - ux * D, gy = O[2] - uy * D;
        if (!inTable(g, gx, gy)) continue;
        for (const th of L.placeAngles) {
          const c = Math.cos(th), s = Math.sin(th);
          const dx = -(ux * c - uy * s), dy = -(ux * s + uy * c);
          for (const k of [0.1, 0.22, 0.4]) {
            const x = gx + dx * k, y = gy + dy * k;
            if (!PC.validPlacement(F, x, y) || !laneClear(objs, x, y, gx, gy, id, 0, rad)) continue;
            const tol = aim.tol * D * c / k;
            spots.push({ x, y, score: pHit(tol, this.sigmaPlan) - 0.02 * Math.abs(th) });
          }
        }
      }
    }
    // a grid as well (the kitchen, or when nothing pots from behind a ghost ball)
    if (F.kitchen || spots.length < 2) {
      const xs = [], ys = [];
      const xMax = F.kitchen ? PC.HEAD_X - 0.004 : g.W - 0.08;
      for (let x = 0.08; x <= xMax + 1e-9; x += F.kitchen ? (xMax - 0.08) / 3 : 0.16) xs.push(x);
      for (let y = 0.1; y <= g.H - 0.1 + 1e-9; y += (g.H - 0.2) / 6) ys.push(y);
      for (const x of xs) for (const y of ys) {
        if (!PC.validPlacement(F, x, y)) continue;
        const c = potCands(g, objs, targets, x, y, L, false);
        let best = 0;
        for (const k of c) best = Math.max(best, pHit(k.tol, this.sigmaPlan));
        spots.push({ x, y, score: best - 0.05 });
      }
    }
    spots.sort((p, q) => q.score - p.score);
    const out = [];
    for (const s of spots) {
      if (out.length >= L.places) break;
      if (out.every((o) => (o.x - s.x) ** 2 + (o.y - s.y) ** 2 > 0.03 * 0.03)) out.push(s);
    }
    if (!out.length) {
      const p = anyPlacement(PC, F);
      if (p) out.push({ x: p[0], y: p[1], score: 0 });
    }
    return out;
  };

  /** Turn a candidate into the powers worth trying. */
  function powersFor(L, c) {
    const out = [];
    const base = c.v / 7;
    for (const m of L.powerMul) {
      const p = Math.max(0.08, Math.min(1, base * m));
      if (out.every((q) => Math.abs(q - p) > 0.03)) out.push(p);
    }
    return out;
  }

  Search.prototype.run = function () {
    const F = this.F, L = this.L, g = this.g, PC = this.PC;
    if (F.isBreak) return this.breakShot();
    const targets = legalTargets(F);
    const cue = cueOf(F);
    let spots;
    if (F.inHand) spots = this.placements(targets);
    else if (cue) spots = [{ x: cue[1], y: cue[2] }];
    else spots = [];
    if (!spots.length) return null;
    // 1. geometry
    let cands = [];
    for (const s of spots) {
      for (const c of potCands(g, this.objs, targets, s.x, s.y, L, true)) {
        c.cx = s.x; c.cy = s.y;
        const w = c.kind === 'pot' ? 1 : c.kind === 'combo' ? (c.via === 9 ? 1.3 : 0.8) : c.kind === 'bank' ? 0.75 : 0.6;
        c.pg = pHit(c.tol, this.sigmaPlan);
        c.rank = c.pg * w;
        cands.push(c);
      }
    }
    cands.sort((p, q) => q.rank - p.rank);
    cands = cands.slice(0, L.topK);
    // a shot to fall back on if the clock beats us
    let best = null;
    if (cands.length) {
      const c = cands[0];
      best = { a: c.a, p: Math.max(0.1, Math.min(1, c.v * 1.3 / 7)), sx: 0, sy: 0, cx: c.cx, cy: c.cy, score: -1e9, c };
    }
    // 2. play the candidates out (powers x spins)
    const tried = [];
    for (const c of cands) {
      const angles = c.refine && L.safety >= 2 ? [0, 0.5 * DEG, -0.5 * DEG, 1.1 * DEG, -1.1 * DEG] : [0];
      let top = null;
      for (const da of angles) {
        for (const p of powersFor(L, c)) {
          for (const sp of L.spins) {
            const v = this.value(c.a + da, p, sp[0], sp[1], c.cx, c.cy);
            if (v === null) break;
            const potted = v >= 100;
            const sc = potted ? c.pg * v + (1 - c.pg) * V_MISS : v;
            if (!top || sc > top.score) top = { a: c.a + da, p, sx: sp[0], sy: sp[1], cx: c.cx, cy: c.cy, score: sc, v, c };
          }
        }
      }
      if (top) {
        if (L.jitter) top.score += gauss(this.rand) * L.jitter;
        tried.push(top);
      }
    }
    // 3. safeties when no pot is worth it (Hard always looks)
    let bestSc = tried.reduce((m, t) => Math.max(m, t.score), -1e9);
    if (L.safety >= 2 || (L.safety === 1 && bestSc < 0) || !tried.length) {
      for (const t of this.safeties(targets, F.inHand ? this.safetySpot(targets, spots) : spots[0])) tried.push(t);
    }
    if (!tried.length) return best;
    tried.sort((p, q) => q.score - p.score);
    // 4. re-check the best few with aim / power errors
    if (L.robust) {
      const n = Math.min(tried.length, L.safety >= 2 ? 6 : 3);
      const e = this.sigmaEval;
      const errs = L.robust >= 4 ? [[e, 0], [-e, 0], [0, 0.04], [0, -0.04]] : [[e, 0], [-e, 0]];
      let checked = 0;
      for (let i = 0; i < n; i++) {
        const t = tried[i];
        let sum = t.v, k = 1;
        for (const er of errs) {
          const v = this.value(t.a + er[0], t.p * (1 + er[1]), t.sx, t.sy, t.cx, t.cy);
          if (v === null) break;
          sum += v; k++;
        }
        if (k < 2) continue;
        checked = i + 1;
        let sc = sum / k;
        if (t.c && t.v >= 100) {
          // what a miss leaves (a soft miss may not even reach a cushion): aim well outside the tolerance
          const off = Math.max(2.5 * t.c.tol, 1.5 * e) * (i % 2 ? -1 : 1);
          const vm = this.value(t.a + off, t.p, t.sx, t.sy, t.cx, t.cy);
          if (vm !== null) sc = t.c.pg * sc + (1 - t.c.pg) * Math.min(vm, 0);
        }
        t.score = sc;
      }
      // only shots that survived the re-check compete (the rest kept their optimistic first scores)
      if (checked) tried.length = checked;
      tried.sort((p, q) => q.score - p.score);
    }
    return tried[0];
  };

  /** Where to put the cue ball (in hand) for a safety: a spot with a clear line to a legal ball. */
  Search.prototype.safetySpot = function (targets, spots) {
    const g = this.g, objs = this.objs, rad = g.D - 1e-4;
    const clearTo = (x, y) => targets.some((id) => {
      const b = ballById(objs, id);
      return b && laneClear(objs, x, y, b[1], b[2], id, 0, rad);
    });
    for (const s of spots) if (clearTo(s.x, s.y)) return s;
    for (const id of targets) {
      const b = ballById(objs, id);
      if (!b) continue;
      for (const k of [0.25, 0.5]) {
        for (let i = 0; i < 12; i++) {
          const x = b[1] + Math.cos(i * Math.PI / 6) * k, y = b[2] + Math.sin(i * Math.PI / 6) * k;
          if (this.PC.validPlacement(this.F, x, y) && laneClear(objs, x, y, b[1], b[2], id, 0, rad)) return { x, y };
        }
      }
    }
    return spots[0];
  };

  /** Safe shots: soft hits of each legal ball at a few thicknesses, then (if still nothing) a sweep. */
  Search.prototype.safeties = function (targets, spot) {
    const out = [];
    const L = this.L, g = this.g;
    const cx = spot.x, cy = spot.y;
    const balls = targets.map((id) => ballById(this.objs, id)).filter(Boolean)
      .map((b) => ({ b, d: Math.sqrt((b[1] - cx) ** 2 + (b[2] - cy) ** 2), clear: laneClear(this.objs, cx, cy, b[1], b[2], b[0], 0, g.D - 1e-4) }))
      .sort((p, q) => (q.clear - p.clear) || (p.d - q.d));
    const nBalls = L.safety >= 2 ? 4 : L.safety === 1 ? 2 : 1;
    const fulls = L.safety >= 2 ? [0, 0.4, -0.4, 0.8, -0.8] : L.safety === 1 ? [0, 0.6, -0.6] : [0];
    const pows = L.safety >= 2 ? [0.16, 0.26, 0.4] : L.safety === 1 ? [0.2, 0.35] : [0.35];
    let any = false;
    for (const e of balls.slice(0, nBalls)) {
      if (!e.clear) continue;
      const a0 = Math.atan2(e.b[2] - cy, e.b[1] - cx);
      for (const f of fulls) {
        const off = Math.asin(Math.max(-1, Math.min(1, f * g.D / Math.max(e.d, g.D))));
        for (const p of pows) {
          const v = this.value(a0 + off, p, 0, 0, cx, cy);
          if (v === null) return out;
          if (v > V_FOUL) any = true;
          out.push({ a: a0 + off, p, sx: 0, sy: 0, cx, cy, score: v, v, safe: true, id: e.b[0] });
        }
      }
    }
    if (!any) {
      // snookered (or nothing clear): sweep all around and keep whatever is legal
      const n = L.safety >= 1 ? 48 : 20;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI;
        for (const p of L.safety >= 1 ? [0.35, 0.6] : [0.45]) {
          const v = this.value(a, p, 0, 0, cx, cy);
          if (v === null) return out;
          out.push({ a, p, sx: 0, sy: 0, cx, cy, score: v, v, safe: true, kick: true });
        }
      }
    }
    return out;
  };

  /** The break: full power at the apex ball from a few spots in the kitchen. */
  Search.prototype.breakShot = function () {
    const F = this.F, PC = this.PC, g = this.g, L = this.L;
    let apex = null;
    if (F.mode === '9ball') {
      for (const b of this.objs) if (!apex || b[0] < apex[0]) apex = b;
    } else {
      for (const b of this.objs) if (!apex || Math.abs(b[1] - PC.FOOT_X) + Math.abs(b[2] - g.H / 2) < Math.abs(apex[1] - PC.FOOT_X) + Math.abs(apex[2] - g.H / 2)) apex = b;
    }
    if (!apex) return null;
    const spots = [];
    const cue = cueOf(F);
    if (F.inHand) {
      const x = Math.min(PC.HEAD_X - 0.01, g.W - 0.1);
      for (const dy of [0, 0.12, -0.12, 0.24, -0.24, 0.33, -0.33]) {
        if (spots.length >= L.breakOpts) break;
        if (PC.validPlacement(F, x, g.H / 2 + dy)) spots.push([x, g.H / 2 + dy]);
      }
      if (!spots.length) { const p = anyPlacement(PC, F); if (p) spots.push(p); }
    } else if (cue) spots.push([cue[1], cue[2]]);
    if (!spots.length) return null;
    let best = null;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const a = Math.atan2(apex[2] - s[1], apex[1] - s[0]);
      const t = { a, p: 1, sx: 0, sy: -0.2, cx: s[0], cy: s[1], score: -1e9, brk: true };
      if (L.breakOpts > 1) {
        const v = this.value(a, 1, 0, -0.2, s[0], s[1]);
        if (v === null) { if (!best) best = t; break; }
        t.score = v;
      }
      if (!best || t.score > best.score) best = t;
    }
    return best;
  };

  function anyPlacement(PC, F) {
    const cue = cueOf(F);
    const tries = [];
    if (cue) tries.push([cue[1], cue[2]]);
    tries.push([PC.HEAD_SPOT[0], PC.HEAD_SPOT[1]]);
    for (const t of tries) if (PC.validPlacement(F, t[0], t[1])) return t;
    const xMax = F.kitchen ? PC.HEAD_X : PC.W;
    for (let x = PC.R * 2; x <= xMax - PC.R; x += 0.04) {
      for (let y = PC.R * 2; y <= PC.H - PC.R * 2; y += 0.04) if (PC.validPlacement(F, x, y)) return [x, y];
    }
    return null;
  }

  function gauss(rand) {
    let u = rand();
    const v = rand();
    if (!(u > 1e-12)) u = 1e-12;
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(-3, Math.min(3, z));
  }

  function describe(t) {
    if (!t) return 'Just hitting it';
    if (t.brk) return 'Breaking';
    if (t.safe) return t.kick ? 'Kicking for a legal hit' : 'Playing safe';
    const c = t.c;
    if (!c) return 'Taking a shot';
    const where = POCKET_NAMES[c.pk] || 'pocket';
    if (c.kind === 'combo') return `${c.id}-${c.via} combo, ${where}`;
    if (c.kind === 'bank') return `Banking the ${c.id} into the ${where}`;
    if (c.kind === 'kick') return `Kicking the ${c.id} into the ${where}`;
    return `The ${c.id} in the ${where}`;
  }

  /** Choose the CPU's shot. Never throws; always returns finite numbers (cx/cy valid when in hand). */
  function choose(frame, level, opts) {
    const o = opts || {};
    const budget = isNum(o.budgetMs) && o.budgetMs > 0 ? o.budgetMs : 900;
    const userRand = typeof o.rand === 'function' ? o.rand : Math.random;
    const rand = () => {
      let x;
      try { x = +userRand(); } catch (e) { x = 0.5; }
      return x >= 0 && x < 1 ? x : 0.5;
    };
    const L = LEVELS[level] || LEVELS[level === undefined ? 2 : Math.max(1, Math.min(3, Math.round(+level) || 2))] || LEVELS[2];
    let PC = null, F = frame, t = null;
    try {
      PC = core();
      if (PC && F && Array.isArray(F.balls) && !F.over) {
        const S = new Search(PC, F, L, budget, rand);
        t = S.run();
      }
    } catch (e) {
      t = null;
    }
    const out = { a: 0, p: 0.5, sx: 0, sy: 0, think: describe(t) };
    try {
      if (t && isNum(t.a) && isNum(t.p)) {
        out.a = t.a + gauss(rand) * L.sigma;
        out.p = Math.max(0.02, Math.min(1, t.p * (1 + gauss(rand) * L.pNoise)));
        out.sx = Math.max(-1, Math.min(1, (t.sx || 0) + gauss(rand) * L.spinNoise));
        out.sy = Math.max(-1, Math.min(1, (t.sy || 0) + gauss(rand) * L.spinNoise));
      } else if (PC && F && Array.isArray(F.balls)) {
        // nothing found: hit the nearest legal ball
        const cue = cueOf(F) || [0, PC.HEAD_SPOT[0], PC.HEAD_SPOT[1]];
        const ids = legalTargets(F);
        let tb = null, bd = 1e9;
        for (const b of F.balls) {
          if (b[0] === 0 || ids.indexOf(b[0]) < 0) continue;
          const d = (b[1] - cue[1]) ** 2 + (b[2] - cue[2]) ** 2;
          if (d < bd) { bd = d; tb = b; }
        }
        if (tb) out.a = Math.atan2(tb[2] - cue[2], tb[1] - cue[1]);
      }
      if (!isNum(out.a)) out.a = 0;
      if (F && F.inHand && PC) {
        let cx = t && t.cx, cy = t && t.cy;
        if (!PC.validPlacement(F, cx, cy)) {
          const p = anyPlacement(PC, F);
          if (p) { cx = p[0]; cy = p[1]; }
        }
        if (isNum(cx) && isNum(cy)) { out.cx = cx; out.cy = cy; }
      }
    } catch (e) { /* keep the defaults */ }
    if (!isNum(out.p)) out.p = 0.5;
    if (!isNum(out.sx)) out.sx = 0;
    if (!isNum(out.sy)) out.sy = 0;
    return out;
  }

  const PoolAI = { choose, LEVELS, legalTargets };
  root.PoolAI = PoolAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = PoolAI;
})(typeof window !== 'undefined' ? window : globalThis);
