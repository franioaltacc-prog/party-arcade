// Deterministic practice-robot checks. Node or JavaScriptCore, like volleytest.js.
'use strict';
const hasNode = typeof require === 'function' && typeof process !== 'undefined';
const say = typeof print === 'function' ? print : console.log;
if (hasNode) {
  require('../public/js/games/volley-core.js'); require('../public/js/games/volley-ai.js');
} else {
  load('public/js/games/volley-core.js'); load('public/js/games/volley-ai.js');
}
const V = globalThis.VolleyCore; const A = globalThis.VolleyAI;
const C = V.C; const L = V.field(1.6, 'left'); const R = V.field(1.6, 'right');
const rng = (s) => () => ((s = s * 16807 % 2147483647) / 2147483647);
let failed = 0;
const check = (ok, label) => { say((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failed++; };
check(A.create(R, 'unknown').difficulty === 'medium', 'unknown difficulty falls back to Medium');

// Give every robot the exact same incoming shots, including above-screen passes.
const rand = rng(45); const shots = [];
for (let i = 0; i < 500 && shots.length < 150; i++) {
  const b = V.ball(0.2 + rand() * 1.1, 0.15 + rand() * 0.4, 1 + rand() * 2, -0.7 - rand() * 2);
  V.capSpeed(b); const p = V.predict(b, L, 720);
  if (p && p.ev === 'cross') shots.push({ ...p.ball, d: V.overshoot(p.ball, L), at: 0 });
}
check(shots.length === 150 && shots.some((s) => s.y < 0), 'the comparison includes 150 real passes and high lobs');

function play(id, msg, seed, dt = C.DT) {
  let now = 0; let hit = false; let result = null; let hitSpeed = 0;
  const bot = A.create(R, id, { now: () => now, rand: rng(seed),
    onHit: () => { hit = true; hitSpeed = Math.hypot(bot.ball.vx, bot.ball.vy); },
    onCross: (b) => { result = { kind: 'cross', ...V.copy(b) }; },
    onMiss: () => { result = { kind: 'floor' }; },
  });
  bot.receive(msg);
  for (let i = 0; i < Math.ceil(8 / dt) && !result; i++) { now += dt * 1000; bot.tick(dt); }
  return { result, hit, hitSpeed };
}

const results = {};
for (const id of ['easy', 'medium', 'hard']) {
  const runs = shots.map((s, i) => play(id, s, 1009 + i * 7919));
  const returns = runs.filter((r) => r.result && r.result.kind === 'cross');
  results[id] = returns.length;
  check(runs.every((r) => r.result), `${id}: every incoming rally ends in a return or a point`);
  check(runs.every((r) => r.hitSpeed <= C.MAXV + 1e-9), `${id}: robot hits obey the player speed cap`);
  check(returns.length > 20, `${id}: can return varied shots (${returns.length}/150)`);
  const first = play(id, shots[30], 77); const again = play(id, shots[30], 77);
  check(JSON.stringify(first) === JSON.stringify(again), `${id}: seeded behaviour is repeatable`);
  const fastFrames = play(id, shots[30], 77, 1 / 240); const slowFrames = play(id, shots[30], 77, 1 / 30);
  check(JSON.stringify(fastFrames.result) === JSON.stringify(slowFrames.result), `${id}: same result at 30 and 240 fps`);
  let served = null; let now = 0;
  const bot = A.create(R, id, { now: () => now, rand: rng(99), onCross: (b) => { served = b; } });
  bot.serve();
  for (let i = 0; i < 900 && bot.ball; i++) { now += C.DT * 1000; bot.tick(C.DT); }
  check(served && served.vx < 0 && served.y < 1 - C.NET, `${id}: serves clear the net`);
}
check(results.easy < results.medium && results.medium < results.hard,
  `difficulty changes the outcome against identical shots (Easy ${results.easy}, Medium ${results.medium}, Hard ${results.hard})`);

{
  let now = 0; const bot = A.create(R, 'hard', { now: () => now });
  bot.receive({ ...shots[0], at: 500 });
  for (now = 0; now < 500; now += 20) bot.tick(0.02);
  check(bot.ball === null && bot.pending != null, 'the robot waits for the announced hand-off time');
  bot.tick(0.02);
  check(bot.ball !== null && bot.pending === null, 'the ball becomes active when the hand-off is due');
}
say('FAILED: ' + failed);
if (hasNode && failed) process.exitCode = 1;
