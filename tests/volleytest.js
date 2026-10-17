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

// 3. hands: gentle touches stay gentle, swipes smash, and a ball can be balanced on a hand
/** Move the hand in a straight line over `steps` physics steps, touching and stepping the ball like the game does. */
function move(b, f, x0, y0, x1, y1, steps) {
  const hvx = (x1 - x0) / (steps * C.DT); const hvy = (y1 - y0) / (steps * C.DT);
  let power = 0;
  for (let i = 1; i <= steps; i++) {
    power = Math.max(power, V.sweep(b, f, x0 + (x1 - x0) * (i - 1) / steps, y0 + (y1 - y0) * (i - 1) / steps,
      x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, hvx, hvy));
    V.step(b, f);
  }
  return power;
}
{
  // a flick so fast the hand jumps right over the ball between two steps still hits it, at full power
  const b = V.ball(0.6, 0.5);
  const missed = V.touch(V.copy(b), L, 0.9, 0.45, 72, -12);
  const p = V.sweep(b, L, 0.3, 0.55, 0.9, 0.45, 72, -12);
  check(missed === 0 && p > 0 && b.vx > 0 && Math.hypot(b.vx, b.vy) > C.MAXV * 0.9, `a flick that jumps over the ball in one step still hits it at full power (v ${b.vx.toFixed(2)}, ${b.vy.toFixed(2)})`);
  const c = V.ball(0.6, 0.5);
  check(V.sweep(c, L, 0.3, 0.75, 0.9, 0.75, 72, 0) === 0 && c.vx === 0 && !V.reaches(c, 0.3, 0.75, 0.9, 0.75), 'a fast swipe that passes close by doesn’t touch it');
  check(V.reaches(c, 0.3, 0.55, 0.9, 0.45), '…and one that goes through it does');
  // the same flick spread over a few steps hits just as hard
  const d = V.ball(0.6, 0.5);
  move(d, L, 0.3, 0.55, 0.9, 0.45, 3);
  check(Math.hypot(d.vx, d.vy) > C.MAXV * 0.85, `fast flicks over a few steps hit hard too (${Math.hypot(d.vx, d.vy).toFixed(2)})`);
}
{
  const min = C.R + C.HAND;
  const b = V.ball(0.6, 0.5);
  move(b, L, 0.6 - 0.25, 0.5 + 0.2, 0.6 + 0.05, 0.5 - 0.04, 8);   // ~5 heights/s up and forward
  check(Math.hypot(b.vx, b.vy) > 2.4 && b.vx > 0 && b.vy < 0, `a fast swipe smashes the ball up and forward (v ${b.vx.toFixed(2)}, ${b.vy.toFixed(2)})`);
  const n = V.ball(0.6, 0.5);
  move(n, L, 0.6 - min - 0.02, 0.5, 0.6 - min + 0.03, 0.5, 6);     // a slow push (~0.6 heights/s) from the side
  check(n.vx > 0.15 && n.vx < 0.7, `a gentle nudge only moves the ball gently (vx ${n.vx.toFixed(2)})`);
  const c = V.ball(0.6, 0.5);
  check(move(c, L, 0.2, 0.9, 0.3, 0.95, 5) === 0, 'a hand that never comes near misses');
  const e = V.ball(0.6, 0.5);
  move(e, L, 0.3, 0.75, 0.62, 0.48, 2);
  check(Math.hypot(e.vx, e.vy) <= C.MAXV + 1e-9, 'no hit is faster than the top speed');
  // drop the ball on a still hand: a small bounce, then it stays there, balanced
  const hx = 0.7; const hy = 0.7;
  const d = V.ball(hx + 0.02, hy - min - 0.15);
  let maxUp = 0; let off = 0; let landed = false;
  for (let i = 0; i < 360; i++) {
    if (V.touch(d, L, hx, hy, 0, 0) > 0 || Math.hypot(d.x - hx, d.y - hy) < min + 1e-6) landed = true;
    V.step(d, L);
    if (landed) maxUp = Math.max(maxUp, (hy - min) - d.y);
    if (i > 240) off = Math.max(off, Math.abs(d.x - hx));
  }
  check(landed && maxUp < 0.02, `a ball dropped on a still hand barely bounces (${maxUp.toFixed(3)})`);
  check(off < 0.01 && d.y < hy && Math.abs(d.vx) < 0.05, `…and then sits on it, balanced (${off.toFixed(4)} off centre)`);
  // carry it slowly sideways: it stays on top
  let worst = 0;
  for (let i = 0; i < 240; i++) {
    const x = hx + 0.3 * i * C.DT;
    V.touch(d, L, x, hy, 0.3, 0); V.step(d, L);
    worst = Math.max(worst, Math.abs(d.x - x));
  }
  check(worst < 0.05 && d.y < hy, `carried slowly sideways, it stays on the hand (at most ${worst.toFixed(3)} off)`);
  // and a quick flick up from under it pops it up
  move(d, L, d.x, hy, d.x, hy - 0.06, 3);
  check(d.vy < -0.8, `a flick from under it pops it up (vy ${d.vy.toFixed(2)})`);
}

// 4. smashes next to the net slow down, so the other screen always gets some warning
{
  let minLead = Infinity;
  for (let i = 0; i < 300; i++) {
    const b = V.ball(L.w - 0.1 - rand() * 0.3, 0.2 + rand() * 0.3);
    move(b, L, b.x - 0.3, b.y + 0.04, b.x - 0.04, b.y + 0.01, 4);
    const p = V.predict(b, L, 600);
    if (p && p.ev === 'cross') minLead = Math.min(minLead, p.steps * C.DT);
  }
  check(minLead >= C.MIN_LEAD - 0.03, `a smash right at the net still takes ${minLead.toFixed(2)}s to go over (at least ${C.MIN_LEAD}s)`);
}

// 5. holding: the ball stays on your side and off the floor, and a throw is capped
{
  const b = V.ball(1.4, 0.5);
  for (let i = 0; i < 60; i++) V.hold(b, L, 1.7, 0.99, 3, 0, 1 / 60);
  check(b.x <= L.w - C.R && b.y <= 1 - C.R, `you can't carry the ball over the net or into the floor (${b.x.toFixed(3)}, ${b.y.toFixed(3)})`);
  const r = V.ball(0.3, 0.5);
  for (let i = 0; i < 60; i++) V.hold(r, Rf, -0.3, 0.4, -3, 0, 1 / 60);
  check(r.x >= C.R, `the same on the right screen (${r.x.toFixed(3)})`);
  const t = V.ball(0.5, 0.5);
  V.hold(t, L, 0.5, 0.6, 5, -5, 1 / 60); V.release(t, L);
  check(Math.hypot(t.vx, t.vy) <= C.THROW_MAX + 1e-9, `a throw is never wild (${Math.hypot(t.vx, t.vy).toFixed(2)})`);
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
