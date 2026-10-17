/* Screen Volley physics: the ball, the net, the walls and the hands, with no drawing.
   Every screen measures its court in "heights": the floor is at y = 1, the top at y = 0, and the court is
   w = width / height wide, so screens of any size line up. The net stands on the seam where two screens meet.
   The same steps always give the same result, so a screen can work out exactly when and where the ball will
   cross to the other screen before it gets there (VolleyCore.predict). */
(() => {
  'use strict';
  const C = {
    DT: 1 / 120,        // physics step (seconds)
    G: 2.1,             // gravity (heights per second²)
    R: 0.05,            // ball radius
    HAND: 0.055,        // hand (cursor) radius
    NET: 0.3,           // net height above the floor
    MAXV: 3.3,          // top ball speed
    HANDV: 7,           // top hand speed that counts
    HIT_E: 0.5,         // how bouncy a hit is (the hand's own speed is added on top)
    WALL_E: 0.82,
    NET_E: 0.35,
    FLOOR_E: 0.62,      // only used where the floor doesn't end the rally (practice robot's screen)
    DRAG: 0.12,         // air drag per second
    MIN_LEAD: 0.24,     // a hit can't send the ball over the net sooner than this (time for the other screen to hear)
    HOLD_MAX: 1.5,      // seconds you can hold the ball on your cursor
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

  /** The hand moved from (x0, y0) to (x1, y1) this frame at (hvx, hvy): hit the ball if it touched it
     anywhere along the way. Returns true on a hit. */
  function hit(b, f, x0, y0, x1, y1, hvx, hvy) {
    // where along the hand's path did it first touch the ball? (a fast hand can cross the whole ball in one frame)
    const min = C.R + C.HAND;
    const ex = x1 - x0; const ey = y1 - y0;
    const dx0 = x0 - b.x; const dy0 = y0 - b.y;
    const qa = ex * ex + ey * ey; const qb = 2 * (dx0 * ex + dy0 * ey); const qc = dx0 * dx0 + dy0 * dy0 - min * min;
    let t;
    if (qc <= 0) t = 0;                       // it started the frame touching the ball
    else {
      const disc = qb * qb - 4 * qa * qc;
      if (qa < 1e-12 || disc < 0) return false;
      t = (-qb - Math.sqrt(disc)) / (2 * qa);
      if (t < 0 || t > 1) return false;
    }
    const hx = x0 + ex * t; const hy = y0 + ey * t;
    let nx = b.x - hx; let ny = b.y - hy;
    const d = Math.hypot(nx, ny);
    if (d < 1e-9) {   // dead centre: push it the way the hand is going (or up)
      const hs = Math.hypot(hvx, hvy);
      if (hs > 1e-6) { nx = hvx / hs; ny = hvy / hs; } else { nx = 0; ny = -1; }
    } else { nx /= d; ny /= d; }
    const hs = Math.hypot(hvx, hvy);
    if (hs > C.HANDV) { hvx *= C.HANDV / hs; hvy *= C.HANDV / hs; }
    b.x = hx + nx * min; b.y = hy + ny * min;
    const rvx = b.vx - hvx; const rvy = b.vy - hvy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      b.vx -= (1 + C.HIT_E) * vn * nx;
      b.vy -= (1 + C.HIT_E) * vn * ny;
      b.spin += (rvx * -ny + rvy * nx) * 18;
    }
    capSpeed(b);
    slowNearNet(b, f);
    // the push-out mustn't put the ball through the net or the walls
    b.y = Math.min(1 - C.R - 1e-6, Math.max(C.R, b.y));
    const wallX = f.side === 'left' ? 0 : f.w;
    if (f.side === 'left') b.x = Math.max(wallX + C.R, b.x); else b.x = Math.min(wallX - C.R, b.x);
    if ((b.x - f.seam) * f.dir > -C.R && b.y >= 1 - C.NET) b.x = f.seam - f.dir * C.R;
    return true;
  }

  /** Smashes right next to the net slow down, so the other screen always hears about the ball in time. */
  function slowNearNet(b, f) {
    const toNet = (f.seam - b.x) * f.dir;           // distance to the net (positive on this side)
    const vToward = b.vx * f.dir;
    if (vToward > 0 && toNet > 0 && toNet / vToward < C.MIN_LEAD) b.vx = f.dir * toNet / C.MIN_LEAD;
  }

  /** The ball sits on top of the hand while you hold it. */
  function hold(b, f, hx, hy, hvx, hvy) {
    const tx = hx; const ty = hy - (C.R + C.HAND) * 0.8;
    b.x += (tx - b.x) * 0.45; b.y += (ty - b.y) * 0.45;
    const hs = Math.hypot(hvx, hvy);
    const k = hs > C.MAXV ? C.MAXV / hs : 1;
    b.vx = hvx * k; b.vy = hvy * k;
    b.spin *= 0.9;
    // you can't carry it over the net or into the floor
    const lim = f.seam - f.dir * (C.R + 0.01);
    if ((b.x - lim) * f.dir > 0) b.x = lim;
    b.y = Math.min(1 - C.R - 0.01, Math.max(C.R, b.y));
    const wallX = f.side === 'left' ? 0 : f.w;
    if (f.side === 'left') b.x = Math.max(wallX + C.R, b.x); else b.x = Math.min(wallX - C.R, b.x);
  }

  /** Throwing after a hold: the hand's speed, capped, and slowed near the net like a hit. */
  function release(b, f) {
    capSpeed(b);
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

  const api = { C, field, ball, copy, step, predict, hit, hold, release, arrive, overshoot, capSpeed, slowNearNet };
  if (typeof window !== 'undefined') window.VolleyCore = api;
  if (typeof globalThis !== 'undefined') globalThis.VolleyCore = api;
})();
