/* Neon Flappy core: the level (pipes from a seed) and the bird's physics.
   No drawing here, so it also runs in tests outside the browser, and every player of an online
   round who gets the same seed flies exactly the same pipes.

   Units are "world pixels": the view is always 600 tall (the ground starts at 540) and as wide as
   the screen allows. The bird flies right at a speed that only depends on time, so its x is the
   same for everyone at the same moment — games/flappy.py uses the same numbers (X(t), passed(t))
   to check online scores. Keep the two in sync. */
(function (root) {
  'use strict';
  const P = {
    H: 600,           // world height
    FLOOR: 540,       // top of the ground
    CEIL: -28,        // the bird can't go higher than this (the pipes go on forever above the screen)
    G: 1750,          // gravity (px/s²)
    FLAP: -530,       // a flap sets the vertical speed to this (≈ 80 px hop, top after 0.3 s)
    MAX_FALL: 820,
    BODY_R: 16,       // the bird's drawn radius: touching the ground with it is a crash
    HIT_R: 12,        // ...but the pipes only count a smaller circle (a bit forgiving)
    START_Y: 270,
    V0: 165,          // speed for the first 20 pipes
    VMAX: 215,        // ...then it slowly speeds up to this
    ACC: 1.0,         // px/s² of speeding up
    SPACING: 230,     // distance between pipe centres
    FIRST: 460,       // the first pipe's centre, ahead of where the bird starts
    PW: 78,           // pipe width
    GAP0: 152,        // the gap for the first 20 pipes
    GAP_MIN: 124,     // ...narrowing to this
    GAP_STEP: 0.6,    // px narrower per pipe after pipe 20
    RAMP_AT: 20,      // pipes before things get harder
    MARGIN: 58,       // gaps stay this far from the top and the ground
    MAX_SHIFT: 150,   // how far a gap can move from one pipe to the next
    MEDALS: [[10, 'bronze', '🥉'], [20, 'silver', '🥈'], [30, 'gold', '🥇'], [50, 'diamond', '💎']],
  };
  const DT = 1 / 120;
  // time the bird reaches pipe 20's centre (from then on it speeds up), and how long the speed-up lasts
  const TR = (P.FIRST + P.RAMP_AT * P.SPACING) / P.V0;
  const TA = (P.VMAX - P.V0) / P.ACC;

  /** The bird's world x after flying t seconds. */
  function X(t) {
    if (t <= 0) return 0;
    if (t <= TR) return P.V0 * t;
    const u = Math.min(t - TR, TA);
    let x = P.V0 * TR + P.V0 * u + 0.5 * P.ACC * u * u;
    if (t - TR > TA) x += P.VMAX * (t - TR - TA);
    return x;
  }
  /** Speed at time t (for the background and the ghosts). */
  const speed = (t) => (t <= TR ? P.V0 : Math.min(P.VMAX, P.V0 + P.ACC * (t - TR)));
  /** How many pipe centres the bird has flown past after t seconds (the best possible score). */
  function passed(t) {
    const x = X(t);
    return x < P.FIRST ? 0 : Math.floor((x - P.FIRST) / P.SPACING) + 1;
  }
  const gapOf = (i) => (i < P.RAMP_AT ? P.GAP0 : Math.max(P.GAP_MIN, P.GAP0 - (i - P.RAMP_AT) * P.GAP_STEP));

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A level: pipe(i) -> { i, cx, y (gap centre), gap, top, bottom }, made on demand from the seed. */
  function level(seed) {
    const rnd = mulberry32(seed >>> 0 || 1);
    const pipes = [];
    const L = {
      seed,
      pipe(i) {
        while (pipes.length <= i) {
          const k = pipes.length;
          const gap = gapOf(k);
          const lo = P.MARGIN + gap / 2;
          const hi = P.FLOOR - P.MARGIN - gap / 2;
          let y = lo + rnd() * (hi - lo);
          if (k === 0) y = P.START_Y + (y - P.START_Y) * 0.4;      // the first gap is near where you start
          else {
            const prev = pipes[k - 1].y;
            y = Math.max(prev - P.MAX_SHIFT, Math.min(prev + P.MAX_SHIFT, y));
          }
          y = Math.round(Math.max(lo, Math.min(hi, y)));
          pipes.push({ i: k, cx: P.FIRST + k * P.SPACING, y, gap, top: y - gap / 2, bottom: y + gap / 2, hue: rnd() });
        }
        return pipes[i];
      },
      /** Index of the first pipe whose right edge is still ahead of world x. */
      firstAfter(x) { return Math.max(0, Math.ceil((x - P.PW / 2 - P.FIRST) / P.SPACING)); },
    };
    return L;
  }

  function newBird() {
    return { y: P.START_Y, vy: 0, t: 0, x: 0, alive: true, score: 0, flaps: 0, hit: null, god: false };
  }

  /** Does a circle at (x, y) with radius r touch pipe p? */
  function touches(p, x, y, r) {
    const left = p.cx - P.PW / 2; const right = p.cx + P.PW / 2;
    const nx = Math.max(left, Math.min(right, x));
    if (Math.abs(nx - x) >= r) return false;
    // top pipe: from far above down to p.top; bottom pipe: from p.bottom down to the ground
    const ny1 = Math.min(y, p.top);
    const ny2 = Math.max(y, p.bottom);
    const d1 = (nx - x) ** 2 + (ny1 - y) ** 2;
    const d2 = (nx - x) ** 2 + (ny2 - y) ** 2;
    return d1 < r * r || d2 < r * r;
  }

  /** One fixed step of the simulation. flap: a flap happens at the start of this step. */
  function step(L, b, flap, dt = DT) {
    if (!b.alive) return b;
    if (flap) { b.vy = P.FLAP; b.flaps++; }
    b.vy = Math.min(P.MAX_FALL, b.vy + P.G * dt);
    b.y += b.vy * dt;
    b.t += dt;
    b.x = X(b.t);
    if (b.y < P.CEIL) { b.y = P.CEIL; b.vy = Math.max(0, b.vy); }
    while (L.pipe(b.score).cx <= b.x) b.score++;
    if (b.y + P.BODY_R >= P.FLOOR) {
      if (b.god) { b.y = P.FLOOR - P.BODY_R; b.vy = P.FLAP; } else { b.y = P.FLOOR - P.BODY_R; b.alive = false; b.hit = 'ground'; }
      return b;
    }
    if (!b.god) {
      const i = L.firstAfter(b.x - P.HIT_R);
      for (let k = i; k <= i + 1; k++) {
        if (touches(L.pipe(k), b.x, b.y, P.HIT_R)) { b.alive = false; b.hit = 'pipe'; break; }
      }
    }
    return b;
  }

  const medalFor = (score) => { let m = null; for (const x of P.MEDALS) if (score >= x[0]) m = x; return m; };

  root.FlappyCore = { P, DT, TR, TA, X, speed, passed, gapOf, level, newBird, step, touches, medalFor, mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
