// Screen Volley: headless checks of public/js/games/volley-core.js (the ball physics both screens run).
//   node tests/volleytest.js   (or JavaScriptCore via tests/run_all.py on a Mac)
// The prediction has to match what really happens step for step (that's how a screen can tell the other
// one in advance exactly when and where the ball comes over), the net and walls must hold, hands must hit
// even when they move fast, and smashes next to the net must leave the other screen time to hear about them.
'use strict';
const hasNode = typeof require === 'function' && typeof process !== 'undefined';
const say = typeof print === 'function' ? print : console.log;
if (hasNode) require(require('path').join(__dirname, '..', 'public', 'js', 'games', 'volley-core.js'));
else load('public/js/games/volley-core.js');
const V = globalThis.VolleyCore;
const C = V.C;

let failed = 0;
const check = (ok, label) => { say((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failed++; };
const rng = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
const rand = rng(12345);

const L = V.field(1.6, 'left');
const Rf = V.field(1.5, 'right');

// 1. prediction = reality
let same = 0; let tried = 0;
for (let i = 0; i < 300; i++) {
  const b = V.ball(0.2 + rand() * 1.2, 0.1 + rand() * 0.6, -3 + rand() * 6, -3 + rand() * 4);
  V.capSpeed(b);
  const p = V.predict(b, L, 600);
  if (!p) continue;
  tried++;
  const real = V.copy(b);
  let ev = null; let n = 0;
  while (n < 600) { n++; ev = V.step(real, L); if (ev === 'cross' || ev === 'floor') break; }
  if (ev === p.ev && n === p.steps && real.x === p.ball.x && real.y === p.ball.y && real.vx === p.ball.vx) same++;
}
check(tried > 250 && same === tried, `the prediction matches what really happens, step for step (${same}/${tried})`);

// 2. the net holds, and the ball only crosses above it
let leaks = 0; let crosses = 0; let netHits = 0; let escapes = 0; let nan = 0;
for (let i = 0; i < 2000; i++) {
  const f = i % 2 ? L : Rf;
  const b = V.ball(f.side === 'left' ? 0.1 + rand() * (f.w - 0.2) : 0.1 + rand() * (f.w - 0.2), 0.08 + rand() * 0.85, (rand() - 0.5) * 7, (rand() - 0.7) * 6);
  V.capSpeed(b);
  for (let k = 0; k < 900; k++) {
    const ev = V.step(b, f);
    if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) { nan++; break; }
    if (ev === 'net') netHits++;
    if (ev === 'cross') { crosses++; if (b.y >= 1 - C.NET) leaks++; break; }
    if (ev === 'floor') break;
    const wallX = f.side === 'left' ? 0 : f.w;
    if (Math.abs(b.x - wallX) < C.R - 1e-9 || b.y > 1 + 1e-9 || b.y < C.R - 1e-9) { escapes++; break; }
    if ((b.x - f.seam) * f.dir > 0) { leaks++; break; }   // on the other side without crossing above the net
  }
}
check(crosses > 300 && netHits > 50, `random throws: ${crosses} went over, ${netHits} hit the net`);
check(leaks === 0, `nothing gets through or under the net (${leaks})`);
check(escapes === 0 && nan === 0, `the ball never leaves the court or goes wrong (${escapes} escapes, ${nan} NaN)`);

// 3. hands hit the ball, even fast ones that move a long way in one frame
{
  const b = V.ball(0.6, 0.5);
  const hitIt = V.hit(b, L, 0.3, 0.7, 0.9, 0.3, 4, -3);   // swipe straight through the ball in one frame
  check(hitIt && b.vx > 0.5 && b.vy < 0, `a fast swipe through the ball hits it up and forward (v ${b.vx.toFixed(2)}, ${b.vy.toFixed(2)})`);
  const c = V.ball(0.6, 0.5);
  check(!V.hit(c, L, 0.2, 0.9, 0.3, 0.95, 1, 0.5), 'a hand that never comes near misses');
  const d = V.ball(0.6, 0.5, 0, 2);   // falling onto a still hand
  V.hit(d, L, 0.6, 0.5 + C.R + C.HAND - 0.01, 0.6, 0.5 + C.R + C.HAND - 0.01, 0, 0);
  check(d.vy < 0 && Math.abs(d.vy) < 2, `a still hand bounces a falling ball back up, softer (vy ${d.vy.toFixed(2)})`);
  const e = V.ball(0.6, 0.5, 0, 0);
  V.hit(e, L, 0.4, 0.6, 0.55, 0.52, 40, -30);
  check(Math.hypot(e.vx, e.vy) <= C.MAXV + 1e-9, 'no hit is faster than the top speed');
}

// 4. smashes next to the net slow down, so the other screen always gets some warning
{
  let minLead = Infinity;
  for (let i = 0; i < 300; i++) {
    const b = V.ball(L.w - 0.1 - rand() * 0.3, 0.2 + rand() * 0.3);
    V.hit(b, L, b.x - 0.2, b.y + 0.05, b.x - 0.02, b.y + 0.02, 7, -1);
    const p = V.predict(b, L, 600);
    if (p && p.ev === 'cross') minLead = Math.min(minLead, p.steps * C.DT);
  }
  check(minLead >= C.MIN_LEAD - 0.02, `a smash right at the net still takes ${minLead.toFixed(2)}s to go over (at least ${C.MIN_LEAD}s)`);
}

// 5. holding: the ball stays on your side and off the floor
{
  const b = V.ball(1.4, 0.5);
  for (let i = 0; i < 60; i++) V.hold(b, L, 1.7, 0.99, 3, 0);
  check(b.x <= L.w - C.R && b.y <= 1 - C.R, `you can't carry the ball over the net or into the floor (${b.x.toFixed(3)}, ${b.y.toFixed(3)})`);
  const r = V.ball(0.3, 0.5);
  for (let i = 0; i < 60; i++) V.hold(r, Rf, -0.3, 0.4, -3, 0);
  check(r.x >= C.R, `the same on the right screen (${r.x.toFixed(3)})`);
}

// 6. both screens behave the same, mirrored
{
  let ok = true;
  for (let i = 0; i < 100 && ok; i++) {
    const x = 0.2 + rand() * 1.0; const y = 0.1 + rand() * 0.7; const vx = (rand() - 0.5) * 5; const vy = (rand() - 0.6) * 4;
    const a = V.ball(x, y, vx, vy); const b = V.ball(1.6 - x, y, -vx, vy);
    const R2 = V.field(1.6, 'right');
    for (let k = 0; k < 300; k++) {
      const ea = V.step(a, L); const eb = V.step(b, R2);
      if (ea !== eb || Math.abs(a.x - (1.6 - b.x)) > 1e-9 || Math.abs(a.y - b.y) > 1e-9) { ok = false; break; }
      if (ea === 'cross' || ea === 'floor') break;
    }
  }
  check(ok, 'the left and right screens are exact mirror images');
}

// 7. the hand-off: the ball comes out of one screen and into the other where and when it should
{
  let worst = 0; let n = 0; let bumped = 0;
  for (let i = 0; i < 200; i++) {
    const b = V.ball(0.5 + rand() * 0.8, 0.15 + rand() * 0.35, 1 + rand() * 2, -1.5 - rand());
    V.capSpeed(b);
    const p = V.predict(b, L, 600);
    if (!p || p.ev !== 'cross') continue;
    n++;
    const msg = { y: p.ball.y, vx: p.ball.vx, vy: p.ball.vy, a: p.ball.a, spin: p.ball.spin, d: V.overshoot(p.ball, L) };
    const r = V.arrive(msg, Rf);
    // the ball is in exactly the same place, then keeps moving the same way on the new screen
    const same = Math.abs((r.x + L.w) - p.ball.x) < 1e-9 && r.y === p.ball.y;
    const twin = V.copy(p.ball); twin.vy += C.G * C.DT; twin.vx *= 1 - C.DRAG * C.DT; twin.vy *= 1 - C.DRAG * C.DT;
    twin.x += twin.vx * C.DT; twin.y += twin.vy * C.DT;
    const after = V.copy(r);
    const ev = V.step(after, Rf);
    worst = Math.max(worst, same ? 0 : 1);
    if (ev) { bumped++; continue; }   // it touched the net top or the ceiling straight away: real physics, not a jump
    worst = Math.max(worst, Math.abs(after.x + L.w - twin.x), Math.abs(after.y - twin.y), Math.abs(after.vx - twin.vx));
    if (r.x < 0 || r.x > 0.04 || r.vx <= 0) worst = 9;
  }
  check(n > 100 && worst < 1e-6, `a ball passed to the other screen carries on smoothly (${n} hand-offs, ${bumped} clipped the net top, worst jump ${worst.toFixed(6)})`);
  const back = V.arrive({ y: 0.3, vx: -2, vy: 0 }, L);
  check(back.x > L.w - 0.01 && back.x <= L.w && back.vx < 0, 'and the same coming back to the left screen');
}

// 8. a gentle push over the net lands on the other side, a weak one drops on yours
{
  const lob = V.ball(L.w - 0.3, 0.55, 0.9, -1.6);
  const p = V.predict(lob, L, 600);
  check(p && p.ev === 'cross', 'a lob from near the net goes over');
  const weak = V.ball(L.w - 0.5, 0.8, 0.4, -0.3);
  const q = V.predict(weak, L, 600);
  check(q && q.ev === 'floor', 'a weak push falls on your own floor (point to the other player)');
}

say('FAILED: ' + failed);
