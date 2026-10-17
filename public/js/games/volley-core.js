/* Screen Volley physics: the ball, the net, the walls and the hands, with no drawing.
   Every screen measures its court in "heights": the floor is at y = 1, the top at y = 0, and the court is
   w = width / height wide, so screens of any size line up. The net stands on the seam where two screens meet.
   The same steps always give the same result, so a screen can work out exactly when and where the ball will
   cross to the other screen before it gets there (VolleyCore.predict). */
(() => {
  'use strict';
  const C = {
    DT: 1 / 120,        // physics step (seconds)
    G: 1.7,             // gravity (heights per second²): a floaty volleyball
    R: 0.05,            // ball radius
    HAND: 0.055,        // hand (cursor) radius
    NET: 0.3,           // net height above the floor
    MAXV: 3.0,          // top ball speed
    HANDV: 6,           // top hand speed that counts
    // touches: soft ones stay soft (you can nudge, cushion and balance), real swipes still smash
    HARD: 4,            // contact speed (heights per second) that counts as a full-power hit
    E_SOFT: 0.06,       // bounciness of a gentle touch...
    E_HARD: 0.42,       // ...and of a full-power hit
    K_SOFT: 0.45,       // how much of the hand's speed a gentle touch passes on...
    K_HARD: 1,          // ...and a full-power hit
    GRIP: 0.3,          // how much a hand moving sideways under the ball carries it along
    CUP: 14,            // a ball resting on top of your hand is pulled to its middle (so you can balance it)
    CUP_DAMP: 5,
    WALL_E: 0.82,
    NET_E: 0.35,
    DRAG: 0.2,          // air drag per second
    MIN_LEAD: 0.24,     // a hit can't send the ball over the net sooner than this (time for the other screen to hear)
    HOLD_MAX: 2,        // seconds you can hold the ball on your cursor
    THROW: 0.85,        // a throw keeps this much of your hand's speed...
    THROW_MAX: 2.6,     // ...up to this
  };

  /** A court: side 'left' has the net on its right edge, 'right' on its left edge. */
  function field(w, side) {
    const seam = side === 'left' ? w : 0;
    return { w, side, seam, dir: side === 'left' ? 1 : -1 };
  }

  const ball = (x, y, vx = 0, vy = 0) => ({ x, y, vx, vy, a: 0, spin: 0 });
  const copy = (b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, a: b.a, spin: b.spin });

  function capSpeed(b, max = C.MAXV) {
    const s = Math.hypot(b.vx, b.vy);
    if (s > max) { b.vx *= max / s; b.vy *= max / s; }
  }

  /** One step. Returns 'cross' (the centre went over the net onto the other screen), 'floor', a bounce
     ('wall' / 'net' / 'top') or null. */
  function step(b, f) {
    const { DT, R } = C;
    const drag = 1 - C.DRAG * DT;
    b.vy += C.G * DT;
    b.vx *= drag; b.vy *= drag;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.a += b.spin * DT;
    b.spin *= 1 - 0.4 * DT;
    let ev = null;
    if (b.y < R) { b.y = R; if (b.vy < 0) b.vy = -b.vy * 0.6; ev = 'top'; }
    // the outer wall
    const wallX = f.side === 'left' ? 0 : f.w;
    if (f.side === 'left' ? b.x < wallX + R : b.x > wallX - R) {
      b.x = f.side === 'left' ? wallX + R : wallX - R;
      if (f.side === 'left' ? b.vx < 0 : b.vx > 0) { b.vx = -b.vx * C.WALL_E; b.spin = -b.spin * 0.5; }
      ev = 'wall';
    }
    // the net: a post from the floor up to its top, standing on the seam
    const top = 1 - C.NET;
    if (b.y >= top) {
      // beside the net it's a wall
      if ((b.x - f.seam) * f.dir > -R) {
        b.x = f.seam - f.dir * R;
        if (b.vx * f.dir > 0) b.vx = -b.vx * C.NET_E;
        ev = 'net';
      }
    } else {
      // above it the ball can clip the top of the net
      let dx = b.x - f.seam; let dy = b.y - top;
      const d = Math.hypot(dx, dy);
      if (d < R) {
        if (d < 1e-9) { dx = -f.dir; dy = 0; } else { dx /= d; dy /= d; }
        b.x = f.seam + dx * R; b.y = top + dy * R;
        const vn = b.vx * dx + b.vy * dy;
        if (vn < 0) { b.vx -= (1 + C.NET_E) * vn * dx; b.vy -= (1 + C.NET_E) * vn * dy; }
        ev = 'net';
      }
    }
    if ((b.x - f.seam) * f.dir > 0 && b.y < top) return 'cross';
    if (b.y > 1 - R) return 'floor';
    return ev;
  }

  /** Follow the ball (nobody touching it) for up to `max` steps: the first 'cross' or 'floor', with the
     ball as it is at that moment. */
  function predict(b, f, max) {
    const p = copy(b);
    for (let i = 1; i <= max; i++) {
      const ev = step(p, f);
      if (ev === 'cross' || ev === 'floor') return { steps: i, ev, ball: p };
    }
    return null;
  }

  /** The hand (at hx, hy, moving at hvx, hvy) against the ball, once per physics step. Returns how hard they met
     (0 = not touching). Its top is a flat, slightly cupped palm: a ball that lands gently stays on it and slides
     to the middle, so you can balance and carry it. Elsewhere it's round. Gentle touches pass on only part of the
     hand's speed and barely bounce; fast swipes pass on all of it. */
  function touch(b, f, hx, hy, hvx, hvy) {
    const min = C.R + C.HAND;
    const hs = Math.hypot(hvx, hvy);
    if (hs > C.HANDV) { hvx *= C.HANDV / hs; hvy *= C.HANDV / hs; }
    const dx = b.x - hx;
    if (Math.abs(dx) < min * 0.8 && b.y <= hy && b.y > hy - min - 1e-3 && b.vy - hvy < 0.8 && Math.abs(b.vx - hvx) < 1.2) {
      // a gentle landing (or a gentle lift): the ball settles on the palm
      const approach = b.vy - hvy;
      b.y = Math.min(b.y, hy - min);
      if (b.vy > hvy) b.vy = hvy;
      b.vx += ((hx - b.x) * C.CUP - (b.vx - hvx) * C.CUP_DAMP) * C.DT;
      b.spin *= 0.9;
      keepIn(b, f);
      return Math.max(0, approach);
    }
    // anything harder: the hand is round, so where you hit the ball decides where it goes
    let nx = dx; let ny = b.y - hy;
    const d = Math.hypot(nx, ny);
    if (d >= min) return 0;
    if (d < 1e-9) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
    b.x = hx + nx * min; b.y = hy + ny * min;
    return bump(b, f, nx, ny, hvx, hvy, -((b.vx - hvx) * nx + (b.vy - hvy) * ny));
  }

  /** The hand moved from (x0, y0) to (x1, y1) during one step: it meets the ball exactly where it first touches it
     on the way, so even a very fast swipe can't jump over the ball. */
  function sweep(b, f, x0, y0, x1, y1, hvx, hvy) {
    const min = C.R + C.HAND;
    const ex = x1 - x0; const ey = y1 - y0;
    const dx0 = x0 - b.x; const dy0 = y0 - b.y;
    const qa = ex * ex + ey * ey;
    const qc = dx0 * dx0 + dy0 * dy0 - min * min;
    if (qa > 1e-12 && qc > 0) {
      const qb = 2 * (dx0 * ex + dy0 * ey);
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const t = (-qb - Math.sqrt(disc)) / (2 * qa);
        if (t >= 0 && t <= 1) {
          const cx = x0 + ex * t; const cy = y0 + ey * t;
          return touch(b, f, cx + (b.x - cx) * 1e-4, cy + (b.y - cy) * 1e-4, hvx, hvy);   // a hair closer, so they touch
        }
      }
    }
    return touch(b, f, x1, y1, hvx, hvy);
  }

  /** Does a hand moving from (x0, y0) to (x1, y1) touch the ball anywhere on the way? */
  function reaches(b, x0, y0, x1, y1) {
    const ex = x1 - x0; const ey = y1 - y0;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((b.x - x0) * ex + (b.y - y0) * ey) / len2)) : 0;
    return Math.hypot(b.x - (x0 + ex * t), b.y - (y0 + ey * t)) < C.R + C.HAND;
  }

  function bump(b, f, nx, ny, hvx, hvy, approach) {
    if (approach > 0) {
      const s = Math.min(1, approach / C.HARD) ** 2;               // gentle touches stay very gentle
      const e = C.E_SOFT + (C.E_HARD - C.E_SOFT) * s;
      const k = C.K_SOFT + (C.K_HARD - C.K_SOFT) * s;
      const kvx = hvx * k; const kvy = hvy * k;                    // the part of the hand's speed that counts
      const rvx = b.vx - kvx; const rvy = b.vy - kvy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
        // grip: a hand sliding sideways drags the ball a little the same way
        const tx = rvx - vn * nx; const ty = rvy - vn * ny;
        b.vx -= C.GRIP * tx; b.vy -= C.GRIP * ty;
        b.spin += (rvx * -ny + rvy * nx) * 12;
      }
    }
    capSpeed(b);
    slowNearNet(b, f);
    keepIn(b, f);
    return Math.max(0, approach);
  }

  /** The push-out mustn't put the ball through the net, the walls or the floor. */
  function keepIn(b, f) {
    b.y = Math.min(1 - C.R - 1e-6, Math.max(C.R, b.y));
    const wallX = f.side === 'left' ? 0 : f.w;
    if (f.side === 'left') b.x = Math.max(wallX + C.R, b.x); else b.x = Math.min(wallX - C.R, b.x);
    if ((b.x - f.seam) * f.dir > -C.R && b.y >= 1 - C.NET) b.x = f.seam - f.dir * C.R;
  }

  /** Smashes right next to the net slow down, so the other screen always hears about the ball in time. */
  function slowNearNet(b, f) {
    const toNet = (f.seam - b.x) * f.dir;           // distance to the net (positive on this side)
    const vToward = b.vx * f.dir;
    if (vToward > 0 && toNet > 0 && toNet / vToward < C.MIN_LEAD) b.vx = f.dir * toNet / C.MIN_LEAD;
  }

  /** Holding: the ball sits steadily on top of your hand and follows it smoothly. */
  function hold(b, f, hx, hy, hvx, hvy, dt) {
    const tx = hx; const ty = hy - (C.R + C.HAND) * 0.85;
    const k = 1 - Math.exp(-dt / 0.035);
    b.x += (tx - b.x) * k; b.y += (ty - b.y) * k;
    b.vx = hvx; b.vy = hvy;
    b.spin *= 0.9;
    // you can't carry it over the net or into the floor
    const lim = f.seam - f.dir * (C.R + 0.01);
    if ((b.x - lim) * f.dir > 0) b.x = lim;
    b.y = Math.min(1 - C.R - 0.01, Math.max(C.R, b.y));
    const wallX = f.side === 'left' ? 0 : f.w;
    if (f.side === 'left') b.x = Math.max(wallX + C.R, b.x); else b.x = Math.min(wallX - C.R, b.x);
  }

  /** Letting go: a throw keeps most of the hand's speed (capped), slowed near the net like a hit. */
  function release(b, f) {
    b.vx *= C.THROW; b.vy *= C.THROW;
    capSpeed(b, C.THROW_MAX);
    slowNearNet(b, f);
  }

  /** The ball coming over from the other screen, as it was the moment its centre crossed the net. */
  const overshoot = (b, f) => (b.x - f.seam) * f.dir;
  function arrive(msg, f) {
    // d: how far past the net the centre already was on the other screen
    const d = Math.min(0.2, Math.max(1e-6, msg.d || 1e-6));
    const b = ball(f.seam - f.dir * d, msg.y, msg.vx, msg.vy);
    b.a = msg.a || 0; b.spin = msg.spin || 0;
    return b;
  }

  const api = { C, field, ball, copy, step, predict, touch, sweep, reaches, hold, release, arrive, overshoot, capSpeed, slowNearNet };
  if (typeof window !== 'undefined') window.VolleyCore = api;
  if (typeof globalThis !== 'undefined') globalThis.VolleyCore = api;
})();
