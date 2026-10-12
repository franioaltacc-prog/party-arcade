// Neon Flappy level checks (headless):  node tests/flappytest.js   (from any folder)
// or through tests/run_all.py. Prints one line per check; a failing line contains "DNF".
if (typeof print === 'undefined') globalThis.print = console.log;
if (typeof require === 'function') require(require('path').join(__dirname, '..', 'public', 'js', 'games', 'flappy-core.js'));
else load('public/js/games/flappy-core.js');
const C = globalThis.FlappyCore;
const P = C.P;
let failed = 0;
const check = (ok, label) => { print((ok ? 'ok   ' : 'DNF  ') + label); if (!ok) failed++; };

// ---- the same seed always makes the same level, and the same taps give the same flight
{
  const a = C.level(12345); const b = C.level(12345); const c = C.level(54321);
  let same = true; let diff = false;
  for (let i = 0; i < 300; i++) { if (JSON.stringify(a.pipe(i)) !== JSON.stringify(b.pipe(i))) same = false; if (a.pipe(i).y !== c.pipe(i).y) diff = true; }
  check(same && diff, 'a seed always gives the same pipes (and another seed different ones)');
  const fly = () => {
    const L = C.level(777); const bird = C.newBird(); bird.god = true;
    const rnd = C.mulberry32(99);
    for (let n = 0; n < 120 * 40; n++) C.step(L, bird, rnd() < 0.06);
    return [bird.y, bird.vy, bird.score, bird.flaps].join();
  };
  check(fly() === fly(), 'the physics is deterministic');
}

// ---- level rules: gaps inside the screen, never jumping too far, narrowing gently after pipe 20
{
  let ok = true; let worst = 0;
  for (let s = 1; s <= 200; s++) {
    const L = C.level(s * 2654435761);
    for (let i = 0; i < 260; i++) {
      const p = L.pipe(i);
      if (p.top < P.MARGIN - 0.5 || p.bottom > P.FLOOR - P.MARGIN + 0.5) ok = false;
      if (i > 0) worst = Math.max(worst, Math.abs(p.y - L.pipe(i - 1).y));
      if (p.gap !== C.gapOf(i) || p.cx !== P.FIRST + i * P.SPACING) ok = false;
    }
  }
  check(ok && worst <= P.MAX_SHIFT, `gaps stay on screen and move at most ${P.MAX_SHIFT}px between pipes (worst ${worst})`);
  check(C.gapOf(0) === P.GAP0 && C.gapOf(19) === P.GAP0 && C.gapOf(30) < P.GAP0 && C.gapOf(500) === P.GAP_MIN, `gap ${P.GAP0} for 20 pipes, then down to ${P.GAP_MIN}`);
}

// ---- speed: constant, then a gentle ramp; X(t) is smooth and passed(t) matches the real score
{
  let mono = true; let prev = -1;
  for (let t = 0; t < 300; t += 0.05) { const x = C.X(t); if (x < prev) mono = false; prev = x; }
  const jump = Math.abs(C.X(C.TR + 1e-6) - C.X(C.TR - 1e-6)) + Math.abs(C.X(C.TR + C.TA + 1e-6) - C.X(C.TR + C.TA - 1e-6));
  check(mono && jump < 0.01 && C.speed(5) === P.V0 && C.speed(400) === P.VMAX, `the bird speeds up smoothly from ${P.V0} to ${P.VMAX} after pipe ${P.RAMP_AT}`);
  const L = C.level(4242); const b = C.newBird(); b.god = true;
  let match = true;
  for (let n = 0; n < 120 * 200; n++) {
    C.step(L, b, b.y > L.pipe(L.firstAfter(b.x)).y + 30 && b.vy > 0);
    if (b.score !== C.passed(b.t)) { match = false; break; }
  }
  check(match && b.score === C.passed(200), `a bird's score always equals passed(t) (the server's check): ${b.score} pipes in 200 s`);
}

// ---- hitboxes: a bird in the middle of a gap is safe; touching a pipe isn't; the hitbox is smaller than the drawn bird
{
  const L = C.level(1); const p = L.pipe(3);
  check(!C.touches(p, p.cx, p.y, P.HIT_R), 'the middle of a gap is safe');
  check(C.touches(p, p.cx, p.top + P.HIT_R - 1, P.HIT_R) && C.touches(p, p.cx, p.bottom - P.HIT_R + 1, P.HIT_R), 'touching the top or bottom pipe is a crash');
  check(!C.touches(p, p.cx - P.PW / 2 - P.HIT_R - 0.5, p.top - 40, P.HIT_R), 'just in front of a pipe is safe');
  check(P.HIT_R < P.BODY_R, `forgiving hitbox: pipes only count a ${P.HIT_R}px circle of the ${P.BODY_R}px bird`);
  const b = C.newBird(); b.y = P.FLOOR - P.BODY_R - 1; b.vy = 300; C.step(L, b, false);
  check(!b.alive && b.hit === 'ground', 'hitting the ground is a crash');
  const g = C.newBird(); g.god = true; g.y = P.FLOOR - P.BODY_R - 1; g.vy = 300; C.step(L, g, false);
  check(g.alive && g.vy < 0, 'god mode bounces off the ground');
}

// ---- every level can be flown: search tap timings (one decision every 4 steps ≈ 33 ms, about as
//      precise as a person) with a hitbox 2px BIGGER than the game's
{
  const HIT = P.HIT_R;
  P.HIT_R = HIT + 2;
  const K = 4; const GOAL = 130;
  let worst = 1e9; let all = true; let maxSeen = 0;
  const seeds = 40;
  for (let s = 1; s <= seeds; s++) {
    const seed = (s * 2246822519) >>> 0;
    const L = C.level(seed);
    // depth-first: try not flapping first, never look at the same (time, y, speed) twice
    const seen = new Set();
    const stack = [{ y: P.START_Y, vy: P.FLAP, n: 0 }];
    let reached = 0;
    while (stack.length && reached < GOAL) {
      const st = stack.pop();
      reached = Math.max(reached, C.passed(st.n * K * C.DT));
      for (const flap of [true, false]) {          // pushed in reverse: "no flap" is tried first
        const b = C.newBird(); b.y = st.y; b.vy = st.vy; b.t = st.n * K * C.DT; b.score = C.passed(b.t);
        for (let k = 0; k < K && b.alive; k++) C.step(L, b, flap && k === 0);
        if (!b.alive) continue;
        const key = (st.n + 1) * 1e6 + Math.round(b.y / 2) * 100 + Math.round(b.vy / 30) + 40;
        if (seen.has(key)) continue;
        seen.add(key);
        stack.push({ y: b.y, vy: b.vy, n: st.n + 1 });
      }
    }
    maxSeen = Math.max(maxSeen, seen.size);
    worst = Math.min(worst, reached);
    if (reached < GOAL) { all = false; print(`DNF  seed ${seed}: stuck after ${reached} pipes`); }
  }
  P.HIT_R = HIT;
  check(all, `all ${seeds} levels can be flown to pipe ${GOAL} (deep into the hardest part) even with a bigger hitbox (worst ${worst}, searched up to ${maxSeen} states)`);
}

print(failed ? `FAILED ${failed}` : 'all flappy checks passed');
if (failed) { if (typeof process !== 'undefined') process.exitCode = 1; else throw new Error(failed + ' flappy checks failed'); }
