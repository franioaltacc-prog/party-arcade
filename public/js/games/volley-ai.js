/* Screen Volley practice robot. Uses the same ball physics as human players; no DOM or timers here. */
(() => {
  'use strict';
  const V = globalThis.VolleyCore;
  const C = V.C;
  const LEVELS = {
    easy: { name: 'Easy', about: 'Slower reactions, softer lobs and more mistakes.', reaction: 0.28, speed: 1.7,
      error: 0.09, miss: 0.28, wait: 1.35, attempts: 16, vx: [0.75, 1.25], vy: [1.45, 2.05] },
    medium: { name: 'Medium', about: 'Balanced reactions and varied returns.', reaction: 0.16, speed: 2.6,
      error: 0.05, miss: 0.14, wait: 1.1, attempts: 20, vx: [0.95, 2.0], vy: [1.55, 2.4] },
    hard: { name: 'Hard', about: 'Fast reactions, accurate movement and sharper shots.', reaction: 0.05, speed: 4.4,
      error: 0.01, miss: 0.025, wait: 0.8, attempts: 32, vx: [1.7, 2.7], vy: [0.95, 2.3] },
  };
  const level = (id) => LEVELS[id] || LEVELS.medium;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function intercept(b, f) {
    const p = V.copy(b);
    for (let i = 0; i < 720; i++) {
      const ev = V.step(p, f);
      if (ev === 'cross' || ev === 'floor') return null;
      if (p.vy > 0 && p.y >= 0.58) return p.x;
    }
    return null;
  }

  function shot(b, f, id, rand) {
    const cfg = level(id); let best = null; let bestTime = Infinity;
    for (let k = 0; k < cfg.attempts; k++) {
      const t = V.copy(b);
      t.vx = f.dir * (cfg.vx[0] + rand() * (cfg.vx[1] - cfg.vx[0]));
      t.vy = -(cfg.vy[0] + rand() * (cfg.vy[1] - cfg.vy[0])); t.spin = -6 + rand() * 12;
      V.capSpeed(t); V.slowNearNet(t, f);
      const p = V.predict(t, f, 720);
      if (!p || p.ev !== 'cross') continue;
      if (id !== 'hard') return t;
      // Hard favours quicker, lower returns instead of only hitting higher lobs.
      const other = V.field(f.w, f.side === 'right' ? 'left' : 'right');
      const next = V.arrive({ ...p.ball, d: V.overshoot(p.ball, f) }, other);
      const landing = V.predict(next, other, 720);
      const time = p.steps + (landing ? landing.steps : 720);
      if (time < bestTime) { best = t; bestTime = time; }
    }
    return best;
  }

  function create(f, id = 'medium', opts = {}) {
    const difficulty = Object.hasOwn(LEVELS, id) ? id : 'medium';
    const cfg = level(difficulty); const rand = opts.rand || Math.random;
    const now = opts.now || (() => performance.now());
    const R = {
      difficulty, cfg, f, ball: null, hand: { x: f.w * 0.6, y: 0.8 },
      plan: null, wait: 0, reaction: 0, acc: 0, pending: null,
      receive(msg) { R.pending = { due: opts.toLocal ? opts.toLocal(msg.at) : msg.at, msg }; },
      serve() { R.ball = V.ball(R.f.w * 0.6, 0.36); R.wait = cfg.wait; R.plan = null; R.acc = 0; R.reaction = 0; },
      swing() {
        const s = shot(R.ball, R.f, difficulty, rand);
        R.plan = { done: true };
        if (!s) return;
        Object.assign(R.ball, s);
        R.hand.x = R.ball.x - R.f.dir * 0.06; R.hand.y = R.ball.y + 0.1;
        if (opts.onHit) opts.onHit();
      },
      tick(dt) {
        if (R.pending && now() >= R.pending.due) {
          R.ball = V.arrive(R.pending.msg, R.f); R.pending = null;
          R.plan = null; R.reaction = cfg.reaction; R.wait = 0; R.acc = 0;
        }
        if (!R.ball) { R.hand.y += (0.82 - R.hand.y) * Math.min(1, dt * 3); return; }
        R.acc += Math.max(0, Math.min(0.25, dt));
        while (R.ball && R.acc >= C.DT) {
          R.acc -= C.DT;
          const b = R.ball;
          if (R.wait > 0) {
            R.wait -= C.DT;
            R.move(b.x - R.f.dir * 0.06, b.y + 0.1);
            if (R.wait <= 0) R.swing();
            continue;
          }
          if (!R.plan) {
            const x = intercept(b, R.f);
            R.plan = x == null ? { done: true } : {
              x: clamp(x + (rand() * 2 - 1) * cfg.error, C.HAND, R.f.w - C.HAND), miss: rand() < cfg.miss,
            };
          }
          R.reaction = Math.max(0, R.reaction - C.DT);
          if (!R.plan.done && R.reaction === 0) {
            R.move(R.plan.x - R.f.dir * 0.06, 0.74);
            const near = Math.hypot(b.x - R.f.dir * 0.06 - R.hand.x, b.y + 0.1 - R.hand.y) < 0.08;
            if (!R.plan.miss && b.vy > 0 && b.y >= 0.58 && b.y < 0.85 && near) R.swing();
          }
          const ev = V.step(b, R.f);
          if (ev === 'cross') { R.ball = null; if (opts.onCross) opts.onCross(b); }
          else if (ev === 'floor') { R.ball = null; if (opts.onMiss) opts.onMiss(); }
        }
      },
      move(x, y) {
        const dx = x - R.hand.x; const dy = y - R.hand.y;
        const d = Math.hypot(dx, dy); const k = d ? Math.min(1, cfg.speed * C.DT / d) : 0;
        R.hand.x += dx * k; R.hand.y += dy * k;
      },
    };
    return R;
  }

  globalThis.VolleyAI = { LEVELS, level, create };
})();
